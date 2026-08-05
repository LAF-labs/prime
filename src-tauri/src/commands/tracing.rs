//! Structured tracing — NDJSON trace file for debugging.
//!
//! Writes completed spans as NDJSON records to
//! `~/Library/Application Support/rs.kirodex/traces.ndjson`.
//!
//! Each record contains:
//! - `name`: span name (e.g. "acp.send_message", "git.commit")
//! - `durationMs`: elapsed time in milliseconds
//! - `timestamp`: ISO 8601 start time
//! - `attributes`: structured context (task_id, cwd, etc.)
//! - `exit`: "success" or error message
//!
//! The frontend can read the trace file via the debug panel for diagnosing
//! slow operations, stuck ACP connections, or git failures.

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use super::error::AppError;

/// Maximum trace file size before rotation (10 MB).
const MAX_TRACE_BYTES: u64 = 10 * 1024 * 1024;

/// Number of rotated files to keep.
const MAX_ROTATED_FILES: u32 = 5;

/// A single trace record written to the NDJSON file.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TraceRecord {
    pub name: String,
    pub timestamp: String,
    pub duration_ms: f64,
    pub attributes: serde_json::Value,
    pub exit: String,
}

/// Global trace state — holds the file path and a write lock.
pub struct TraceState {
    file_path: PathBuf,
    writer: Mutex<Option<std::fs::File>>,
}

impl Default for TraceState {
    fn default() -> Self {
        let file_path = trace_file_path();
        Self {
            file_path,
            writer: Mutex::new(None),
        }
    }
}

impl TraceState {
    /// Write a trace record to the NDJSON file.
    pub fn write_record(&self, record: &TraceRecord) {
        let mut writer = self.writer.lock().unwrap_or_else(|e| e.into_inner());

        // Lazy-open the file
        if writer.is_none() {
            if let Some(parent) = self.file_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            match OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.file_path)
            {
                Ok(f) => *writer = Some(f),
                Err(_) => return,
            }
        }

        if let Some(ref mut file) = *writer {
            // Check rotation
            if let Ok(meta) = file.metadata() {
                if meta.len() > MAX_TRACE_BYTES {
                    *writer = None;
                    rotate_trace_file(&self.file_path);
                    // Re-open
                    match OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&self.file_path)
                    {
                        Ok(f) => *writer = Some(f),
                        Err(_) => return,
                    }
                    if let Some(ref mut new_file) = *writer {
                        let _ = write_ndjson_line(new_file, record);
                    }
                    return;
                }
            }
            let _ = write_ndjson_line(file, record);
        }
    }
}

fn write_ndjson_line(file: &mut std::fs::File, record: &TraceRecord) -> std::io::Result<()> {
    let json = serde_json::to_string(record)?;
    writeln!(file, "{}", json)?;
    file.flush()
}

fn trace_file_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rs.kirodex")
        .join("traces.ndjson")
}

fn rotate_trace_file(path: &PathBuf) {
    // Shift existing rotated files
    for i in (1..MAX_ROTATED_FILES).rev() {
        let from = path.with_extension(format!("ndjson.{}", i));
        let to = path.with_extension(format!("ndjson.{}", i + 1));
        let _ = fs::rename(&from, &to);
    }
    // Move current to .1
    let rotated = path.with_extension("ndjson.1");
    let _ = fs::rename(path, &rotated);
}

// ── Span helper ──────────────────────────────────────────────────────────

/// A lightweight span that records timing and writes to the trace file on drop.
pub struct Span {
    name: String,
    start: Instant,
    start_time: SystemTime,
    attributes: serde_json::Value,
    state: Option<&'static TraceState>,
    exit: Option<String>,
}

impl Span {
    /// Create a new span. Call `end()` or let it drop to record.
    pub fn new(name: &str, state: &'static TraceState) -> Self {
        Self {
            name: name.to_string(),
            start: Instant::now(),
            start_time: SystemTime::now(),
            attributes: serde_json::json!({}),
            state: Some(state),
            exit: None,
        }
    }

    /// Add an attribute to the span.
    pub fn attr(mut self, key: &str, value: impl Into<serde_json::Value>) -> Self {
        if let serde_json::Value::Object(ref mut map) = self.attributes {
            map.insert(key.to_string(), value.into());
        }
        self
    }

    /// Mark the span as failed.
    pub fn fail(mut self, error: &str) -> Self {
        self.exit = Some(format!("error: {}", error));
        self
    }

    /// End the span and write the record.
    pub fn end(mut self) {
        self.write_record();
        self.state = None; // Prevent double-write on drop
    }

    fn write_record(&self) {
        if let Some(state) = self.state {
            let duration = self.start.elapsed();
            let timestamp = self.start_time
                .duration_since(UNIX_EPOCH)
                .map(|d| {
                    // Simple ISO-ish timestamp
                    let secs = d.as_secs();
                    format!("{}Z", secs)
                })
                .unwrap_or_else(|_| "0Z".to_string());

            let record = TraceRecord {
                name: self.name.clone(),
                timestamp,
                duration_ms: duration.as_secs_f64() * 1000.0,
                attributes: self.attributes.clone(),
                exit: self.exit.clone().unwrap_or_else(|| "success".to_string()),
            };
            state.write_record(&record);
        }
    }
}

impl Drop for Span {
    fn drop(&mut self) {
        if self.state.is_some() {
            self.write_record();
        }
    }
}

// ── Tauri commands ───────────────────────────────────────────────────────

/// Read the most recent trace records from the trace file.
#[tauri::command]
pub fn trace_read_recent(limit: Option<u32>) -> Result<Vec<TraceRecord>, AppError> {
    let limit = limit.unwrap_or(100).min(1000) as usize;
    let path = trace_file_path();

    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::Other(format!("Failed to read trace file: {e}")))?;

    let records: Vec<TraceRecord> = content
        .lines()
        .rev()
        .take(limit)
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();

    Ok(records)
}

/// Get the trace file path (for the debug panel to show).
#[tauri::command]
pub fn trace_file_location() -> String {
    trace_file_path().to_string_lossy().to_string()
}

/// Clear the trace file.
#[tauri::command]
pub fn trace_clear() -> Result<(), AppError> {
    let path = trace_file_path();
    if path.exists() {
        fs::write(&path, "")
            .map_err(|e| AppError::Other(format!("Failed to clear trace file: {e}")))?;
    }
    Ok(())
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_record_serializes_camel_case() {
        let record = TraceRecord {
            name: "git.commit".to_string(),
            timestamp: "1700000000Z".to_string(),
            duration_ms: 42.5,
            attributes: serde_json::json!({"cwd": "/tmp/repo"}),
            exit: "success".to_string(),
        };
        let json = serde_json::to_string(&record).unwrap();
        assert!(json.contains("\"durationMs\":42.5"));
        assert!(json.contains("\"name\":\"git.commit\""));
    }

    #[test]
    fn trace_file_path_is_reasonable() {
        let path = trace_file_path();
        assert!(path.to_string_lossy().contains("rs.kirodex"));
        assert!(path.to_string_lossy().ends_with("traces.ndjson"));
    }
}
