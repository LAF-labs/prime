use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use parking_lot::Mutex;
use std::thread::JoinHandle;
use tauri::Emitter;

use super::error::AppError;

#[derive(Serialize, Clone)]
struct PtyDataPayload {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct PtyExitPayload {
    id: String,
}

pub struct PtyInstance {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    _reader_thread: JoinHandle<()>,
}

impl Drop for PtyInstance {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// PTYs are keyed by the owning window's label so closing one window only
/// kills its terminals — other windows keep theirs alive.
pub struct PtyState(pub Mutex<HashMap<String, HashMap<String, PtyInstance>>>);

impl Default for PtyState {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

impl PtyState {
    /// Drop every PTY belonging to `window_label`. Returns the number killed.
    pub fn kill_window(&self, window_label: &str) -> usize {
        let mut map = self.0.lock();
        match map.remove(window_label) {
            Some(inner) => inner.len(), // Drop impl on each PtyInstance kills its child
            None => 0,
        }
    }
}

#[tauri::command]
pub fn pty_create(
    state: tauri::State<'_, PtyState>,
    window: tauri::Window,
    id: String,
    cwd: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), AppError> {
    // Validate cwd: must exist, be a directory, and be under a reasonable location
    let cwd_path = std::path::Path::new(&cwd);
    if !cwd_path.is_dir() {
        return Err(AppError::Other(format!("PTY cwd is not a directory: {cwd}")));
    }
    if let Ok(canonical) = cwd_path.canonicalize() {
        #[cfg(not(target_os = "windows"))]
        let home = std::env::var("HOME").unwrap_or_else(|_| "/nonexistent".to_string());
        #[cfg(target_os = "windows")]
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| "C:\\nonexistent".to_string());
        let home_path = std::path::Path::new(&home);
        let allowed = canonical.starts_with(home_path)
            || canonical.starts_with("/tmp")
            || canonical.starts_with("/private/tmp")  // macOS /tmp symlink target
            || canonical.starts_with("/Volumes");     // macOS external drives
        #[cfg(target_os = "linux")]
        let allowed = allowed
            || canonical.starts_with("/opt")
            || canonical.starts_with("/srv")
            || canonical.starts_with("/var/www");
        #[cfg(target_os = "windows")]
        let allowed = allowed
            || canonical.starts_with("C:\\Users")
            || canonical.starts_with("D:\\");
        if !allowed {
            return Err(AppError::Other(format!("PTY cwd must be under home directory or a known project location: {cwd}")));
        }
    }

    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    // Spawn as login shell so it sources the user's profile (~/.zprofile, ~/.zshrc)
    // which sets up PATH (Homebrew, etc.) that GUI apps don't inherit
    cmd.arg("-l");
    cmd.cwd(&cwd);
    // Ensure HOME and SHELL are set — macOS GUI apps sometimes lack these
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
    }
    cmd.env("SHELL", &shell);
    cmd.env("TERM", "xterm-256color");
    let child = pair.slave.spawn_command(cmd).map_err(|e| AppError::Other(e.to_string()))?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| AppError::Other(e.to_string()))?;
    let writer = pair.master.take_writer().map_err(|e| AppError::Other(e.to_string()))?;
    let event_id = id.clone();
    let event_window = window.clone();
    let reader_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = event_window.emit("pty_exit", PtyExitPayload { id: event_id.clone() });
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = event_window.emit(
                        "pty_data",
                        PtyDataPayload { id: event_id.clone(), data },
                    );
                }
                Err(_) => {
                    let _ = event_window.emit("pty_exit", PtyExitPayload { id: event_id.clone() });
                    break;
                }
            }
        }
    });
    let instance = PtyInstance {
        master: pair.master,
        writer,
        child,
        _reader_thread: reader_thread,
    };
    let label = window.label().to_string();
    let mut ptys = state.0.lock();
    ptys.entry(label).or_default().insert(id, instance);
    Ok(())
}

#[tauri::command]
pub fn pty_write(
    state: tauri::State<'_, PtyState>,
    window: tauri::Window,
    id: String,
    data: String,
) -> Result<(), AppError> {
    let label = window.label();
    let mut ptys = state.0.lock();
    let inner = ptys
        .get_mut(label)
        .ok_or_else(|| AppError::Other("PTY not found".to_string()))?;
    let instance = inner
        .get_mut(&id)
        .ok_or_else(|| AppError::Other("PTY not found".to_string()))?;
    instance.writer.write_all(data.as_bytes()).map_err(AppError::Io)?;
    instance.writer.flush().map_err(AppError::Io)?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyState>,
    window: tauri::Window,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    let label = window.label();
    let ptys = state.0.lock();
    let inner = ptys
        .get(label)
        .ok_or_else(|| AppError::Other("PTY not found".to_string()))?;
    let instance = inner
        .get(&id)
        .ok_or_else(|| AppError::Other("PTY not found".to_string()))?;
    instance.master.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(
    state: tauri::State<'_, PtyState>,
    window: tauri::Window,
    id: String,
) -> Result<(), AppError> {
    let label = window.label().to_string();
    let mut ptys = state.0.lock();
    let removed = match ptys.get_mut(&label) {
        Some(inner) => inner.remove(&id),
        None => None,
    };
    removed.ok_or_else(|| AppError::Other("PTY not found".to_string()))?;
    // Tidy: drop the per-window entry once it's empty so the map doesn't grow forever
    if ptys.get(&label).map(|m| m.is_empty()).unwrap_or(false) {
        ptys.remove(&label);
    }
    // PtyInstance Drop kills the child and waits for it
    Ok(())
}

#[tauri::command]
pub fn pty_count(
    state: tauri::State<'_, PtyState>,
    window: tauri::Window,
) -> u32 {
    let label = window.label();
    let ptys = state.0.lock();
    ptys.get(label).map(|m| m.len() as u32).unwrap_or(0)
}
