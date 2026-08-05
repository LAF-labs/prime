//! Process diagnostics.
//!
//! Provides process tree inspection for debugging stuck agent processes.
//! Queries the OS process table and returns child processes with CPU/memory usage.

use serde::Serialize;
use std::process::Command;

use super::error::AppError;

/// A single process entry in the diagnostics output.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessEntry {
    pub pid: u32,
    pub ppid: u32,
    pub cpu_percent: f32,
    pub rss_mb: f32,
    pub elapsed: String,
    pub command: String,
    pub status: String,
}

/// Result of process diagnostics query.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDiagnosticsResult {
    pub processes: Vec<ProcessEntry>,
    pub total_rss_mb: f32,
    pub process_count: u32,
}

/// Tauri command — list child processes of the current app.
///
/// Uses `ps` on macOS/Linux to query the process tree rooted at the
/// current process. Returns CPU, memory, and command info for each.
#[tauri::command]
pub fn list_child_processes() -> Result<ProcessDiagnosticsResult, AppError> {
    let current_pid = std::process::id();
    let processes = query_process_tree(current_pid)?;
    let total_rss_mb = processes.iter().map(|p| p.rss_mb).sum();
    let process_count = processes.len() as u32;

    Ok(ProcessDiagnosticsResult {
        processes,
        total_rss_mb,
        process_count,
    })
}

/// Tauri command — send a signal to a child process.
///
/// Only allows signalling processes that are descendants of the current app
/// process. This prevents the frontend from killing arbitrary system processes.
#[tauri::command]
pub fn signal_process(pid: u32, signal: String) -> Result<(), AppError> {
    let sig = match signal.as_str() {
        "SIGTERM" | "term" => "TERM",
        "SIGKILL" | "kill" => "KILL",
        "SIGINT" | "int" => "INT",
        _ => return Err(AppError::Other(format!("Unknown signal: {signal}"))),
    };

    // Security: verify the target PID is a descendant of this app process
    let current_pid = std::process::id();
    let children = query_process_tree(current_pid)?;
    let is_descendant = children.iter().any(|p| p.pid == pid);

    if !is_descendant {
        return Err(AppError::Other(format!(
            "Process {pid} is not a child of this application. Refusing to signal."
        )));
    }

    let output = Command::new("kill")
        .args([&format!("-{sig}"), &pid.to_string()])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Other(format!("Failed to signal process {pid}: {stderr}")));
    }

    Ok(())
}

/// Query the process tree using `ps`.
fn query_process_tree(root_pid: u32) -> Result<Vec<ProcessEntry>, AppError> {
    // Get all processes with relevant fields
    let output = Command::new("ps")
        .args(["-eo", "pid,ppid,stat,pcpu,rss,etime,command"])
        .output()?;

    if !output.status.success() {
        return Err(AppError::Other("Failed to query process table".to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let all_processes = parse_ps_output(&stdout);

    // Build set of descendant PIDs (BFS from root)
    let mut descendants = std::collections::HashSet::new();
    descendants.insert(root_pid);
    let mut queue = vec![root_pid];

    while let Some(parent) = queue.pop() {
        for proc in &all_processes {
            if proc.ppid == parent && !descendants.contains(&proc.pid) {
                descendants.insert(proc.pid);
                queue.push(proc.pid);
            }
        }
    }

    // Filter to descendants only (exclude the root process itself)
    let result: Vec<ProcessEntry> = all_processes
        .into_iter()
        .filter(|p| descendants.contains(&p.pid) && p.pid != root_pid)
        .collect();

    Ok(result)
}

/// Parse `ps -eo pid,ppid,stat,pcpu,rss,etime,command` output.
fn parse_ps_output(output: &str) -> Vec<ProcessEntry> {
    let mut entries = Vec::new();

    for line in output.lines().skip(1) {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        // Split on whitespace, collecting at most 7 fields (command gets the rest)
        let mut parts: Vec<&str> = Vec::new();
        let mut rest = trimmed;
        for _ in 0..6 {
            rest = rest.trim_start();
            if rest.is_empty() { break; }
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            parts.push(&rest[..end]);
            rest = &rest[end..];
        }
        rest = rest.trim_start();
        if !rest.is_empty() {
            parts.push(rest);
        }

        if parts.len() < 7 { continue; }

        let pid = parts[0].parse::<u32>().unwrap_or(0);
        let ppid = parts[1].parse::<u32>().unwrap_or(0);
        let status = parts[2].to_string();
        let cpu_percent = parts[3].parse::<f32>().unwrap_or(0.0);
        let rss_kb = parts[4].parse::<f32>().unwrap_or(0.0);
        let elapsed = parts[5].to_string();
        let command = parts[6].to_string();

        if pid == 0 { continue; }

        entries.push(ProcessEntry {
            pid,
            ppid,
            cpu_percent,
            rss_mb: rss_kb / 1024.0,
            elapsed,
            command,
            status,
        });
    }

    entries
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ps_output_basic() {
        let output = "  PID  PPID STAT  %CPU   RSS     ELAPSED COMMAND\n  123   100 S      1.2  4096    00:05:30 /usr/bin/kiro-cli chat\n  456   123 S      0.0  2048    00:01:00 node --max-old-space-size=4096\n";
        let entries = parse_ps_output(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].pid, 123);
        assert_eq!(entries[0].ppid, 100);
        assert!((entries[0].rss_mb - 4.0).abs() < 0.01);
        assert!(entries[0].command.contains("kiro-cli"));
    }

    #[test]
    fn list_child_processes_runs() {
        // Should succeed even if there are no children
        let result = list_child_processes();
        assert!(result.is_ok());
    }
}
