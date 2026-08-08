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
        // The shell is a session leader, so its pid is also its process-group
        // id. Killing only that pid leaves whatever the user was running in
        // the terminal — a dev server, a build — alive with no terminal to
        // stop it from. Signal the group first, then reap the leader.
        //
        // The polling here must reap with `try_wait()`, not probe with
        // `kill(pid, 0)`: we own the child, so until someone waits on it the
        // exited shell stays a zombie and `kill(pid, 0)` keeps succeeding —
        // which used to burn the full 500ms grace on every teardown.
        #[cfg(unix)]
        if let Some(pid) = self.child.process_id() {
            super::process_group::signal_group_term(pid);
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
            let mut exited = false;
            while std::time::Instant::now() < deadline {
                if matches!(self.child.try_wait(), Ok(Some(_))) {
                    exited = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            if !exited {
                super::process_group::signal_group_kill(pid);
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Decode a chunk of a UTF-8 byte stream, carrying incomplete trailing
/// sequences over to the next chunk.
///
/// A 16KB read routinely lands mid-character (Korean text, emoji, box-drawing
/// output), and `from_utf8_lossy` on the raw chunk turns the split character
/// into replacement characters. Same pattern as the agent stderr reader in
/// `rpc/connection.rs`: an incomplete trailing sequence waits in `carry` for
/// more bytes; genuinely invalid bytes are lossy-decoded so a broken stream
/// still surfaces something.
pub(crate) fn decode_utf8_chunk(carry: &mut Vec<u8>, chunk: &[u8]) -> String {
    carry.extend_from_slice(chunk);
    match std::str::from_utf8(carry) {
        Ok(s) => {
            let s = s.to_string();
            carry.clear();
            s
        }
        Err(e) if e.error_len().is_none() => {
            // Only an incomplete sequence at the end: emit the valid prefix,
            // keep the tail for the next read.
            let good = e.valid_up_to();
            let s = String::from_utf8_lossy(&carry[..good]).to_string();
            carry.drain(..good);
            s
        }
        Err(_) => {
            // Genuinely invalid bytes mid-buffer: decode the lot lossily
            // rather than stalling the stream.
            let s = String::from_utf8_lossy(carry).to_string();
            carry.clear();
            s
        }
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
        // The path stays in the log; the UI-facing string must not leak it.
        log::warn!("[pty] cwd is not a directory: {cwd}");
        return Err(AppError::Other(
            "The terminal working directory does not exist.".to_string(),
        ));
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
            log::warn!("[pty] cwd outside allowed locations: {cwd}");
            return Err(AppError::Other(
                "The terminal working directory must be under your home directory or a known project location."
                    .to_string(),
            ));
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
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = event_window.emit("pty_exit", PtyExitPayload { id: event_id.clone() });
                    break;
                }
                Ok(n) => {
                    let data = decode_utf8_chunk(&mut carry, &buf[..n]);
                    if data.is_empty() {
                        continue;
                    }
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

#[cfg(test)]
mod tests {
    use super::decode_utf8_chunk;

    /// A multi-byte character split across two reads must come out whole,
    /// not as replacement characters.
    #[test]
    fn split_multibyte_character_survives_chunk_boundary() {
        let bytes = "안녕하세요".as_bytes(); // 15 bytes, 3 per character
        let mut carry = Vec::new();
        // Split mid-"녕": first chunk ends one byte into the character.
        let first = decode_utf8_chunk(&mut carry, &bytes[..4]);
        assert_eq!(first, "안");
        assert_eq!(carry.len(), 1);
        let second = decode_utf8_chunk(&mut carry, &bytes[4..]);
        assert_eq!(second, "녕하세요");
        assert!(carry.is_empty());
    }

    #[test]
    fn emoji_split_across_three_chunks() {
        let bytes = "🙂".as_bytes(); // 4 bytes
        let mut carry = Vec::new();
        assert_eq!(decode_utf8_chunk(&mut carry, &bytes[..1]), "");
        assert_eq!(decode_utf8_chunk(&mut carry, &bytes[1..3]), "");
        assert_eq!(decode_utf8_chunk(&mut carry, &bytes[3..]), "🙂");
        assert!(carry.is_empty());
    }

    #[test]
    fn plain_ascii_passes_through() {
        let mut carry = Vec::new();
        assert_eq!(decode_utf8_chunk(&mut carry, b"hello"), "hello");
        assert!(carry.is_empty());
    }

    /// Genuinely invalid bytes must not wedge the carry buffer — the stream
    /// keeps flowing, lossily.
    #[test]
    fn invalid_bytes_are_lossy_decoded_not_stalled() {
        let mut carry = Vec::new();
        let out = decode_utf8_chunk(&mut carry, &[b'a', 0xFF, b'b']);
        assert!(out.starts_with('a') && out.ends_with('b'));
        assert!(out.contains('\u{FFFD}'));
        assert!(carry.is_empty());
        // The next chunk decodes cleanly.
        assert_eq!(decode_utf8_chunk(&mut carry, "다음".as_bytes()), "다음");
    }
}
