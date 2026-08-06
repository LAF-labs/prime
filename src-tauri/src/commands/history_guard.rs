//! Guarding the conversation history file against silent loss.
//!
//! `tauri-plugin-store` writes `history.json` with a plain `fs::write` — an
//! in-place truncate with no temp file and no fsync — and discards the parse
//! error when it loads a damaged one. The result is that a file truncated by a
//! crash or a power cut comes back as an *empty store with no error*: the
//! sidebar is blank, and the next autosave a few seconds later writes that
//! emptiness over whatever bytes were left.
//!
//! The renderer cannot tell the two apart, because a corrupt store resolves
//! `get('threads')` to `undefined` exactly like an empty one. So we look at the
//! file itself before the store is allowed to write, and quarantine it rather
//! than let it be overwritten.

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryHealth {
    /// False for a first run, which is not a fault.
    pub exists: bool,
    pub bytes: u64,
    /// Whether the bytes on disk actually parse as the JSON object the store
    /// expects. A `false` here with `bytes > 0` is the damaged case.
    pub parseable: bool,
    /// How many threads the file claims, for reporting what is at stake.
    pub thread_count: usize,
}

/// Inspect a store file in the app data directory without loading it.
pub fn inspect(path: &std::path::Path) -> HistoryHealth {
    let Ok(meta) = std::fs::metadata(path) else {
        return HistoryHealth { exists: false, bytes: 0, parseable: true, thread_count: 0 };
    };
    let bytes = meta.len();
    if bytes == 0 {
        // A zero-byte file is what an interrupted truncate leaves behind. The
        // store would read it as "no history" and happily carry on.
        return HistoryHealth { exists: true, bytes: 0, parseable: false, thread_count: 0 };
    }
    let Ok(text) = std::fs::read_to_string(path) else {
        return HistoryHealth { exists: true, bytes, parseable: false, thread_count: 0 };
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(value) => {
            let thread_count = value
                .get("threads")
                .and_then(|t| t.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            HistoryHealth { exists: true, bytes, parseable: true, thread_count }
        }
        Err(_) => HistoryHealth { exists: true, bytes, parseable: false, thread_count: 0 },
    }
}

fn store_path(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    // Reject anything that could climb out of the app data directory — the
    // name comes from the renderer.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("invalid store name: {name}"));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

#[tauri::command]
pub fn history_health(app: tauri::AppHandle, name: String) -> Result<HistoryHealth, String> {
    Ok(inspect(&store_path(&app, &name)?))
}

/// Move a damaged file aside so the store starts clean without destroying the
/// bytes. Returns the quarantine path, or `None` if there was nothing to move.
///
/// This mirrors what the SQLite layer already does with `threads.db.corrupt.*`,
/// and it is the difference between "we can try to recover this later" and
/// "it was overwritten thirty seconds after launch".
#[tauri::command]
pub fn history_quarantine(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = store_path(&app, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let target = path.with_extension(format!("corrupt.{stamp}.json"));
    std::fs::rename(&path, &target).map_err(|e| e.to_string())?;
    log::warn!(
        "[history] quarantined a damaged store: {} -> {}",
        path.display(),
        target.display()
    );
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp(contents: Option<&[u8]>) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("history.json");
        if let Some(bytes) = contents {
            let mut f = std::fs::File::create(&path).expect("create");
            f.write_all(bytes).expect("write");
        }
        (dir, path)
    }

    #[test]
    fn a_missing_file_is_a_first_run_not_a_fault() {
        let (_d, path) = temp(None);
        let h = inspect(&path);
        assert!(!h.exists);
        assert!(h.parseable, "absence must not read as corruption");
    }

    #[test]
    fn a_healthy_file_reports_its_threads() {
        let (_d, path) = temp(Some(br#"{"threads":[{"id":"a"},{"id":"b"}],"projects":[]}"#));
        let h = inspect(&path);
        assert!(h.parseable);
        assert_eq!(h.thread_count, 2);
    }

    /// The exact shape a crash mid-`fs::write` leaves behind.
    #[test]
    fn a_truncated_file_is_not_mistaken_for_an_empty_one() {
        let (_d, path) = temp(Some(br#"{"threads":[{"id":"a"},{"id":"#));
        let h = inspect(&path);
        assert!(h.exists);
        assert!(!h.parseable, "a half-written file must not read as healthy");
    }

    #[test]
    fn a_zero_byte_file_counts_as_damaged() {
        let (_d, path) = temp(Some(b""));
        let h = inspect(&path);
        assert!(h.exists);
        assert!(!h.parseable);
    }

    /// An empty-but-valid store is a legitimate state (a user with no threads)
    /// and must not trigger quarantine.
    #[test]
    fn a_legitimately_empty_store_is_healthy() {
        let (_d, path) = temp(Some(br#"{"threads":[]}"#));
        let h = inspect(&path);
        assert!(h.parseable);
        assert_eq!(h.thread_count, 0);
    }
}
