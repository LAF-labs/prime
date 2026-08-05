use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

use parking_lot::Mutex;
use redb::{Database, ReadableTable, TableDefinition};
use serde::{Deserialize, Serialize};

use super::error::AppError;

const TABLE: TableDefinition<u64, &[u8]> = TableDefinition::new("events");
/// Max events returned in a single load to prevent OOM on huge datasets.
const MAX_LOAD_EVENTS: usize = 50_000;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEvent {
    pub ts: u64,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value2: Option<f64>,
}

pub struct AnalyticsState {
    db_path: OnceLock<PathBuf>,
    db: Mutex<Option<Database>>,
    /// Monotonic counter to guarantee unique keys even for same-ms events.
    counter: AtomicU64,
}

impl Default for AnalyticsState {
    fn default() -> Self {
        Self {
            db_path: OnceLock::new(),
            db: Mutex::new(None),
            counter: AtomicU64::new(0),
        }
    }
}

impl AnalyticsState {
    fn resolve_path(&self, app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        if let Some(p) = self.db_path.get() {
            return Ok(p.clone());
        }
        let dir = app.path()
            .app_data_dir()
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("analytics.redb");
        let _ = self.db_path.set(path.clone());
        Ok(path)
    }

    fn open_db(&self, app: &tauri::AppHandle) -> Result<(), AppError> {
        let mut guard = self.db.lock();
        if guard.is_some() {
            return Ok(());
        }
        let path = self.resolve_path(app)?;
        let db = Database::create(&path)
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        // Ensure table exists
        let txn = db.begin_write()
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        { let _ = txn.open_table(TABLE); }
        txn.commit()
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        *guard = Some(db);
        Ok(())
    }

    fn with_db<F, R>(&self, app: &tauri::AppHandle, f: F) -> Result<R, AppError>
    where
        F: FnOnce(&Database) -> Result<R, AppError>,
    {
        self.open_db(app)?;
        let guard = self.db.lock();
        let db = guard.as_ref().ok_or_else(|| {
            AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, "db not open"))
        })?;
        f(db)
    }
}

use tauri::Manager;

#[tauri::command]
pub fn analytics_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    events: Vec<AnalyticsEvent>,
) -> Result<(), AppError> {
    if events.is_empty() {
        return Ok(());
    }
    state.with_db(&app, |db| {
        let txn = db.begin_write()
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        {
            let mut table = txn.open_table(TABLE)
                .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
            for event in &events {
                let bytes = serde_json::to_vec(event)?;
                // Combine timestamp with atomic counter for guaranteed unique keys.
                // High 48 bits = ms timestamp, low 16 bits = counter.
                let seq = state.counter.fetch_add(1, Ordering::Relaxed) & 0xFFFF;
                let key = (event.ts << 16) | seq;
                table.insert(key, bytes.as_slice())
                    .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
            }
        }
        txn.commit()
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        Ok(())
    })
}

#[tauri::command]
pub fn analytics_load(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<Vec<AnalyticsEvent>, AppError> {
    state.with_db(&app, |db| {
        let txn = db.begin_read()
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        let table = txn.open_table(TABLE)
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        let mut results = Vec::new();
        let start_key = if let Some(start) = since { start << 16 } else { 0u64 };
        let iter = table.range(start_key..u64::MAX)
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        for entry in iter {
            let (_, val) = entry
                .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
            if let Ok(event) = serde_json::from_slice::<AnalyticsEvent>(val.value()) {
                results.push(event);
                if results.len() >= MAX_LOAD_EVENTS { break; }
            }
        }
        Ok(results)
    })
}

#[tauri::command]
pub fn analytics_clear(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
) -> Result<(), AppError> {
    // Close db, delete file, reopen
    {
        let mut guard = state.db.lock();
        *guard = None;
    }
    let path = state.resolve_path(&app)?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    // Reopen fresh
    state.open_db(&app)?;
    Ok(())
}

#[tauri::command]
pub fn analytics_db_size(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
) -> Result<u64, AppError> {
    let path = state.resolve_path(&app)?;
    if !path.exists() {
        return Ok(0);
    }
    let meta = std::fs::metadata(&path)?;
    Ok(meta.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_roundtrip() {
        let event = AnalyticsEvent {
            ts: 1713500000000,
            kind: "message_sent".to_string(),
            project: Some("kirodex".to_string()),
            thread: None,
            detail: None,
            value: Some(42.0),
            value2: None,
        };
        let json = serde_json::to_string(&event).unwrap();
        let restored: AnalyticsEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.ts, 1713500000000);
        assert_eq!(restored.kind, "message_sent");
        assert_eq!(restored.project.as_deref(), Some("kirodex"));
        assert!(restored.thread.is_none());
        assert_eq!(restored.value, Some(42.0));
    }

    #[test]
    fn serde_camel_case() {
        let event = AnalyticsEvent {
            ts: 100,
            kind: "session".to_string(),
            project: None,
            thread: None,
            detail: None,
            value: Some(3600.0),
            value2: None,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"ts\""));
        assert!(json.contains("\"kind\""));
        assert!(!json.contains("project")); // skipped when None
    }

    #[test]
    fn redb_write_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.redb");
        let db = Database::create(&path).unwrap();
        // Write
        let txn = db.begin_write().unwrap();
        {
            let mut table = txn.open_table(TABLE).unwrap();
            let event = AnalyticsEvent {
                ts: 1000,
                kind: "test".to_string(),
                project: None,
                thread: None,
                detail: Some("hello".to_string()),
                value: None,
                value2: None,
            };
            let bytes = serde_json::to_vec(&event).unwrap();
            let key = 1000u64 << 16; // shifted key format
            table.insert(key, bytes.as_slice()).unwrap();
        }
        txn.commit().unwrap();
        // Read
        let txn = db.begin_read().unwrap();
        let table = txn.open_table(TABLE).unwrap();
        let val = table.get(1000u64 << 16).unwrap().unwrap();
        let restored: AnalyticsEvent = serde_json::from_slice(val.value()).unwrap();
        assert_eq!(restored.kind, "test");
        assert_eq!(restored.detail.as_deref(), Some("hello"));
    }
}


// ── Aggregations ─────────────────────────────────────────────────────────────
//
// The renderer's `analytics-aggregators.ts` loads every event and groups it in
// JS. With 50k events that's ~5 MB across the IPC bridge plus a heavy O(n)
// scan on the render thread, every dashboard mount.
//
// These commands run the same aggregations in Rust and return ≤ 30 rows per
// chart (one per day in the requested window). The frontend can drop the
// in-memory aggregator entirely once it migrates.

use serde::Serialize as SerializeAgg;
use std::collections::BTreeMap;

#[derive(SerializeAgg, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DayValue {
    pub day: String,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value2: Option<f64>,
}

#[derive(SerializeAgg, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CountedDetail {
    pub detail: String,
    pub count: u64,
}

#[derive(SerializeAgg, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStat {
    pub project: String,
    pub threads: u64,
    pub messages: u64,
}

/// Format a unix-ms timestamp as `YYYY-MM-DD` in *local time*. Matches the
/// renderer's `dayKey` so a switch-over doesn't cause boundary shifts.
fn day_key(ms: u64) -> String {
    // Convert to seconds since epoch, then to a chrono-free local date.
    // We avoid pulling in `chrono` and instead compute via std time math.
    let secs = (ms / 1000) as i64;
    let datetime = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs as u64);
    // SystemTime → local time formatting via libc is platform-dependent;
    // we go through `std::time::SystemTime` and a tiny civil-time conversion.
    let secs_u = datetime
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    civil_local_day(secs_u)
}

/// Convert epoch seconds to `YYYY-MM-DD` in the system's local timezone.
///
/// We deliberately avoid `chrono` to keep the dependency surface small.
/// Algorithm: shift by the local offset (read once at startup via libc),
/// then compute the civil date with Howard Hinnant's algorithm.
fn civil_local_day(epoch_secs: i64) -> String {
    let offset = local_offset_secs();
    let local = epoch_secs.saturating_add(offset);
    let (y, m, d) = civil_from_days(local.div_euclid(86_400));
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Compute (year, month, day) from days-since-epoch. From "Algorithm 199" /
/// Hinnant's `days_from_civil` inverse — well-known, widely reproduced.
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

/// Cached local-timezone offset (seconds east of UTC). Computed once at
/// startup via `time::OffsetDateTime` would be the proper approach, but we
/// stay dependency-free by reading it from `localtime_r` once.
fn local_offset_secs() -> i64 {
    use std::sync::OnceLock;
    static OFFSET: OnceLock<i64> = OnceLock::new();
    *OFFSET.get_or_init(|| {
        // Best-effort: assume the offset is stable for the app's lifetime
        // (dashboards don't really need DST-correct boundaries to the second).
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        platform_local_offset(now)
    })
}

#[cfg(unix)]
fn platform_local_offset(epoch_secs: i64) -> i64 {
    // Use libc's `localtime_r` to get the gmtoff in seconds.
    use std::mem::MaybeUninit;
    extern "C" {
        fn localtime_r(time: *const i64, tm: *mut libc_tm) -> *mut libc_tm;
    }
    #[repr(C)]
    struct libc_tm {
        tm_sec: i32,
        tm_min: i32,
        tm_hour: i32,
        tm_mday: i32,
        tm_mon: i32,
        tm_year: i32,
        tm_wday: i32,
        tm_yday: i32,
        tm_isdst: i32,
        tm_gmtoff: i64,
        tm_zone: *const i8,
    }
    let mut tm: MaybeUninit<libc_tm> = MaybeUninit::uninit();
    unsafe {
        let t = epoch_secs;
        if !localtime_r(&t, tm.as_mut_ptr()).is_null() {
            return tm.assume_init().tm_gmtoff;
        }
    }
    0
}

#[cfg(not(unix))]
fn platform_local_offset(_epoch_secs: i64) -> i64 {
    0
}

/// Group events by day, applying `f` to each bucket to produce the value.
fn group_by_day<F>(events: &[AnalyticsEvent], f: F) -> Vec<DayValue>
where
    F: Fn(&[&AnalyticsEvent]) -> (f64, Option<f64>),
{
    let mut buckets: BTreeMap<String, Vec<&AnalyticsEvent>> = BTreeMap::new();
    for e in events {
        buckets.entry(day_key(e.ts)).or_default().push(e);
    }
    buckets
        .into_iter()
        .map(|(day, bucket)| {
            let (value, value2) = f(&bucket);
            DayValue { day, value, value2 }
        })
        .collect()
}

fn sum_value(events: &[&AnalyticsEvent]) -> f64 {
    events.iter().filter_map(|e| e.value).sum()
}

fn sum_value2(events: &[&AnalyticsEvent]) -> f64 {
    events.iter().filter_map(|e| e.value2).sum()
}

fn load_events_filtered(
    app: &tauri::AppHandle,
    state: &AnalyticsState,
    kinds: &[&str],
    since: Option<u64>,
) -> Result<Vec<AnalyticsEvent>, AppError> {
    state.with_db(app, |db| {
        let txn = db
            .begin_read()
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        let table = txn
            .open_table(TABLE)
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        let start_key = if let Some(start) = since { start << 16 } else { 0u64 };
        let iter = table
            .range(start_key..u64::MAX)
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        let mut results = Vec::new();
        for entry in iter {
            let (_, val) = entry
                .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
            if let Ok(event) = serde_json::from_slice::<AnalyticsEvent>(val.value()) {
                if kinds.is_empty() || kinds.iter().any(|k| *k == event.kind) {
                    results.push(event);
                    if results.len() >= MAX_LOAD_EVENTS {
                        break;
                    }
                }
            }
        }
        Ok(results)
    })
}

#[tauri::command]
pub fn analytics_coding_hours_by_day(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<Vec<DayValue>, AppError> {
    let events = load_events_filtered(&app, &state, &["session"], since)?;
    Ok(group_by_day(&events, |bucket| {
        let hours = (sum_value(bucket) / 3600.0 * 10.0).round() / 10.0;
        (hours, None)
    }))
}

#[tauri::command]
pub fn analytics_messages_by_day(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<Vec<DayValue>, AppError> {
    let events =
        load_events_filtered(&app, &state, &["message_sent", "message_received"], since)?;
    let mut buckets: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    for e in &events {
        let entry = buckets.entry(day_key(e.ts)).or_insert((0, 0));
        if e.kind == "message_sent" {
            entry.0 += 1;
        } else {
            entry.1 += 1;
        }
    }
    Ok(buckets
        .into_iter()
        .map(|(day, (sent, recv))| DayValue {
            day,
            value: sent as f64,
            value2: Some(recv as f64),
        })
        .collect())
}

#[tauri::command]
pub fn analytics_tokens_by_day(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<Vec<DayValue>, AppError> {
    let events = load_events_filtered(&app, &state, &["token_usage"], since)?;
    Ok(group_by_day(&events, |bucket| (sum_value(bucket), None)))
}

#[tauri::command]
pub fn analytics_diff_stats_by_day(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<Vec<DayValue>, AppError> {
    let events = load_events_filtered(&app, &state, &["diff_stats"], since)?;
    Ok(group_by_day(&events, |bucket| {
        (sum_value(bucket), Some(sum_value2(bucket)))
    }))
}

fn count_by_detail(events: &[AnalyticsEvent]) -> Vec<CountedDetail> {
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    for e in events {
        let key = e.detail.clone().unwrap_or_else(|| "unknown".to_string());
        *counts.entry(key).or_insert(0) += 1;
    }
    let mut result: Vec<CountedDetail> = counts
        .into_iter()
        .map(|(detail, count)| CountedDetail { detail, count })
        .collect();
    result.sort_by(|a, b| b.count.cmp(&a.count));
    result
}

#[tauri::command]
pub fn analytics_model_popularity(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<Vec<CountedDetail>, AppError> {
    let events = load_events_filtered(&app, &state, &["model_used"], since)?;
    Ok(count_by_detail(&events))
}

#[tauri::command]
pub fn analytics_tool_call_breakdown(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<Vec<CountedDetail>, AppError> {
    let events = load_events_filtered(&app, &state, &["tool_call"], since)?;
    Ok(count_by_detail(&events))
}

#[tauri::command]
pub fn analytics_mode_usage(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<Vec<CountedDetail>, AppError> {
    let events = load_events_filtered(&app, &state, &["mode_switch"], since)?;
    Ok(count_by_detail(&events))
}

#[tauri::command]
pub fn analytics_project_stats(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<Vec<ProjectStat>, AppError> {
    let events = load_events_filtered(
        &app,
        &state,
        &["thread_created", "message_sent", "message_received"],
        since,
    )?;
    let mut threads: BTreeMap<String, std::collections::HashSet<String>> = BTreeMap::new();
    let mut messages: BTreeMap<String, u64> = BTreeMap::new();
    for e in &events {
        let Some(project) = e.project.as_ref() else { continue };
        if e.kind == "thread_created" {
            if let Some(thread) = e.thread.as_ref() {
                threads
                    .entry(project.clone())
                    .or_default()
                    .insert(thread.clone());
            }
        } else {
            *messages.entry(project.clone()).or_insert(0) += 1;
        }
    }
    let mut all = std::collections::BTreeSet::new();
    all.extend(threads.keys().cloned());
    all.extend(messages.keys().cloned());
    let mut result: Vec<ProjectStat> = all
        .into_iter()
        .map(|project| ProjectStat {
            threads: threads.get(&project).map(|s| s.len() as u64).unwrap_or(0),
            messages: *messages.get(&project).unwrap_or(&0),
            project,
        })
        .collect();
    result.sort_by(|a, b| b.messages.cmp(&a.messages));
    Ok(result)
}

#[derive(SerializeAgg, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsTotals {
    pub coding_hours: f64,
    pub messages_sent: u64,
    pub messages_received: u64,
    pub tokens: f64,
    pub diff_additions: f64,
    pub diff_deletions: f64,
    pub files_edited: u64,
    pub tool_calls: u64,
}

#[tauri::command]
pub fn analytics_totals(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyticsState>,
    since: Option<u64>,
) -> Result<AnalyticsTotals, AppError> {
    let events = load_events_filtered(&app, &state, &[], since)?;
    let mut totals = AnalyticsTotals {
        coding_hours: 0.0,
        messages_sent: 0,
        messages_received: 0,
        tokens: 0.0,
        diff_additions: 0.0,
        diff_deletions: 0.0,
        files_edited: 0,
        tool_calls: 0,
    };
    let mut edited_files: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in &events {
        match e.kind.as_str() {
            "session" => totals.coding_hours += e.value.unwrap_or(0.0) / 3600.0,
            "message_sent" => totals.messages_sent += 1,
            "message_received" => totals.messages_received += 1,
            "token_usage" => totals.tokens += e.value.unwrap_or(0.0),
            "diff_stats" => {
                totals.diff_additions += e.value.unwrap_or(0.0);
                totals.diff_deletions += e.value2.unwrap_or(0.0);
            }
            "file_edited" => {
                if let Some(detail) = e.detail.as_ref() {
                    edited_files.insert(detail.clone());
                }
            }
            "tool_call" => totals.tool_calls += 1,
            _ => {}
        }
    }
    totals.files_edited = edited_files.len() as u64;
    totals.coding_hours = (totals.coding_hours * 10.0).round() / 10.0;
    Ok(totals)
}

#[cfg(test)]
mod aggregator_tests {
    use super::*;

    #[test]
    fn civil_from_days_known_dates() {
        // 1970-01-01 → days = 0
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2000-03-01 → 11017 days from epoch
        assert_eq!(civil_from_days(11017), (2000, 3, 1));
        // 2025-01-01
        let (y, m, d) = civil_from_days(20089);
        assert_eq!((y, m, d), (2025, 1, 1));
    }

    #[test]
    fn day_key_is_iso_format() {
        // Just check the shape; the exact day depends on the host TZ.
        let key = day_key(1_700_000_000_000);
        assert_eq!(key.len(), 10);
        assert!(key.chars().nth(4) == Some('-'));
        assert!(key.chars().nth(7) == Some('-'));
    }

    #[test]
    fn count_by_detail_sorts_descending() {
        let events = vec![
            AnalyticsEvent { ts: 1, kind: "model_used".into(), project: None, thread: None, detail: Some("opus".into()), value: None, value2: None },
            AnalyticsEvent { ts: 2, kind: "model_used".into(), project: None, thread: None, detail: Some("opus".into()), value: None, value2: None },
            AnalyticsEvent { ts: 3, kind: "model_used".into(), project: None, thread: None, detail: Some("haiku".into()), value: None, value2: None },
        ];
        let result = count_by_detail(&events);
        assert_eq!(result[0].detail, "opus");
        assert_eq!(result[0].count, 2);
        assert_eq!(result[1].detail, "haiku");
    }

    #[test]
    fn group_by_day_sums_values() {
        let events = vec![
            AnalyticsEvent { ts: 1_700_000_000_000, kind: "token_usage".into(), project: None, thread: None, detail: None, value: Some(100.0), value2: None },
            AnalyticsEvent { ts: 1_700_000_000_000, kind: "token_usage".into(), project: None, thread: None, detail: None, value: Some(50.0), value2: None },
        ];
        let bucketed = group_by_day(&events, |b| (sum_value(b), None));
        assert_eq!(bucketed.len(), 1);
        assert_eq!(bucketed[0].value, 150.0);
    }
}
