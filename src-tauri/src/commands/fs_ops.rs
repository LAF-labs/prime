use std::path::{Path, PathBuf};
use ignore::WalkBuilder;
use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

use super::error::AppError;

/// Write `contents` to `path` atomically: temp file in the same directory,
/// fsync, then rename over the target. A plain `fs::write` truncates first
/// and fills in afterwards, so a crash (or two processes racing) mid-write
/// leaves a torn file — fatal for the files this is used on (`auth.json`,
/// `.gitignore`), where "half the old bytes" is worse than either version.
/// Same-directory temp keeps the rename on one filesystem, which is what
/// makes it atomic.
pub(crate) fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent directory")
    })?;
    let file_name = path
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no file name"))?
        .to_string_lossy()
        .to_string();
    // pid + a counter make the temp name unique across processes and across
    // concurrent calls within this one, without pulling in a tempfile crate.
    static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp_path = dir.join(format!(".{file_name}.tmp.{}.{seq}", std::process::id()));
    let result = (|| {
        let mut tmp = std::fs::File::create(&tmp_path)?;
        tmp.write_all(contents)?;
        // The rename only orders the *name* change; the data must be on disk
        // first or a power cut can leave the new name pointing at zero bytes.
        tmp.sync_all()?;
        drop(tmp);
        std::fs::rename(&tmp_path, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

/// Read a JSON object for a read-modify-write cycle (`auth.json`,
/// `models.json`). A missing or empty file yields an empty map — creating the
/// file is fine. A file that exists with content but does not parse (or is
/// not a JSON object) is an error: the old behavior fell back to `{}` and
/// wrote that back, silently destroying every other provider's stored
/// credentials over one corrupt byte.
pub(crate) fn read_json_object_for_update(
    path: &Path,
) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(serde_json::Map::new()),
        Err(e) => {
            return Err(AppError::Other(format!(
                "Could not read {}: {e}",
                path.display()
            )))
        }
    };
    if content.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        AppError::Other(format!(
            "{} exists but is not valid JSON ({e}). Refusing to overwrite it — fix or remove the file, then try again.",
            path.display()
        ))
    })?;
    match value {
        serde_json::Value::Object(map) => Ok(map),
        _ => Err(AppError::Other(format!(
            "{} is not a JSON object. Refusing to overwrite it — fix or remove the file, then try again.",
            path.display()
        ))),
    }
}

/// Locate the prime-agent CLI binary. The command keeps its historical name
/// (`detect_agent_cli`) because the frontend IPC wrapper calls it by name.
///
/// When the app ships the bundled sidecar, this returns the default name
/// `prime-agent` — the launch resolver maps that to the bundled runtime, and
/// settings stay portable across app updates (no baked-in absolute path).
#[tauri::command]
pub fn detect_agent_cli(app: tauri::AppHandle) -> Option<String> {
    if crate::commands::agent_launch::bundled_sidecar_dir(&app).is_some() {
        return Some("prime-agent".to_string());
    }
    let candidates = [
        dirs::home_dir().map(|h| h.join(".local/bin/prime-agent")),
        Some(PathBuf::from("/usr/local/bin/prime-agent")),
        Some(PathBuf::from("/opt/homebrew/bin/prime-agent")),
        dirs::home_dir().map(|h| h.join(".npm-global/bin/prime-agent")),
        dirs::home_dir().map(|h| h.join(".prime/bin/prime-agent")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    which::which("prime-agent")
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// Build metadata for the bundled agent harness, written by
/// `scripts/build-sidecar.sh` as `HARNESS.json` in the sidecar directory.
#[derive(Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInfo {
    #[serde(rename = "ref")]
    pub r#ref: String,
    pub commit: String,
    pub repo: String,
    pub built_at: String,
}

/// Read the bundled harness build metadata, if present. Returns `Ok(None)`
/// when no sidecar is bundled, the file is missing (e.g. a rebuild is in
/// progress), or it fails to parse — the UI simply hides the version line.
#[tauri::command]
pub fn harness_info(app: tauri::AppHandle) -> Result<Option<HarnessInfo>, AppError> {
    let Some(dir) = crate::commands::agent_launch::bundled_sidecar_dir(&app) else {
        return Ok(None);
    };
    let info = std::fs::read_to_string(dir.join("HARNESS.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<HarnessInfo>(&content).ok());
    Ok(info)
}

/// Paths that should never be readable from the frontend, regardless of workspace.
///
/// This guards only the generic read commands (`read_text_file`,
/// `read_file_base64`). The dedicated `auth_*` commands below read
/// `~/.prime/agent/auth.json` through `std::fs` directly and are unaffected.
const SENSITIVE_PATH_PREFIXES: &[&str] = &[
    ".ssh/", ".gnupg/", ".aws/", ".config/gh/", ".netrc",
    ".prime/agent/auth.json", ".docker/config.json", ".kube/", ".npmrc",
    ".git-credentials", ".config/gcloud/",
];

/// Returns true if the path points to a known sensitive location under the user's home.
fn is_sensitive_path(path: &str) -> bool {
    let home = dirs::home_dir().map(|h| h.to_string_lossy().to_string()).unwrap_or_default();
    if home.is_empty() { return false; }
    // Canonicalize to resolve symlinks and .. traversal
    let resolved = std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.replace('\\', "/"));
    let home_prefix = format!("{}/", home.trim_end_matches('/'));
    if let Some(relative) = resolved.strip_prefix(&home_prefix) {
        return SENSITIVE_PATH_PREFIXES.iter().any(|prefix| relative.starts_with(prefix));
    }
    false
}

#[tauri::command]
pub fn read_text_file(path: String) -> Option<String> {
    log::debug!("[fs] read_text_file called with path: {}", path);
    if is_sensitive_path(&path) {
        log::warn!("[fs] read_text_file blocked sensitive path: {}", path);
        return None;
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => Some(content),
        Err(e) => {
            log::warn!("[fs] read_text_file failed for '{}': {}", path, e);
            None
        }
    }
}

/// Async with the file I/O on the blocking pool: a sync command runs on the
/// main thread, and reading + base64-encoding an arbitrarily large file there
/// freezes the window for the duration.
#[tauri::command]
pub async fn read_file_base64(path: String) -> Option<String> {
    log::debug!("[fs] read_file_base64 called with path: {}", path);
    if is_sensitive_path(&path) {
        log::warn!("[fs] read_file_base64 blocked sensitive path: {}", path);
        return None;
    }
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        match std::fs::read(&path) {
            Ok(bytes) => Some(base64::engine::general_purpose::STANDARD.encode(&bytes)),
            Err(e) => {
                log::warn!("[fs] read_file_base64 failed for '{}': {}", path, e);
                None
            }
        }
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    // Wrap in catch_unwind: objc2-app-kit 0.3+ panics if NSOpenPanel returns NULL
    // (can happen during HMR or before NSApplication is fully initialized).
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        app.dialog().file().pick_folder(move |folder| {
            let _ = tx.send(folder.map(|f| f.to_string()));
        });
    }));
    if result.is_err() {
        log::warn!("[fs] pick_folder panicked (NSOpenPanel NULL) — returning None");
        return None;
    }
    rx.await.ok().flatten()
}

/// Pick a single file of any type (no filter). Used where the target is an
/// executable or otherwise extension-less — `pick_folder` cannot select a
/// file, and `pick_image` filters to images.
#[tauri::command]
pub async fn pick_file(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        app.dialog().file().pick_file(move |file| {
            let _ = tx.send(file.map(|f| f.to_string()));
        });
    }));
    if result.is_err() {
        log::warn!("[fs] pick_file panicked (NSOpenPanel NULL) — returning None");
        return None;
    }
    rx.await.ok().flatten()
}

/// Save user-provided text where the user chooses.
///
/// This is the export path for conversations. Until it existed there was no
/// way to get a conversation out of the app at all — the only copies lived in
/// the app's own data directory, in formats nothing else reads. The renderer
/// cannot write files itself (CSP confines it to IPC), so it builds the
/// document and this command owns the dialog and the disk.
///
/// Returns the written path, or `None` if the user cancelled.
#[tauri::command]
pub async fn export_text_file(
    app: tauri::AppHandle,
    suggested_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        app.dialog()
            .file()
            .set_file_name(&suggested_name)
            .save_file(move |path| {
                let _ = tx.send(path.map(|p| p.to_string()));
            });
    }));
    if result.is_err() {
        return Err("The save dialog could not be opened.".to_string());
    }
    let Some(path) = rx.await.ok().flatten() else {
        return Ok(None); // cancelled — not an error
    };
    std::fs::write(&path, contents).map_err(|e| format!("Could not write the file: {e}"))?;
    Ok(Some(path))
}

#[tauri::command]
pub async fn pick_image(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        app.dialog()
            .file()
            .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
            .pick_file(move |file| {
                let _ = tx.send(file.map(|f| f.to_string()));
            });
    }));
    if result.is_err() {
        log::warn!("[fs] pick_image panicked (NSOpenPanel NULL) — returning None");
        return None;
    }
    rx.await.ok().flatten()
}

#[tauri::command]
pub fn open_in_editor(path: String, editor: String) -> Result<(), AppError> {
    // File manager: reveal the path
    if matches!(editor.as_str(), "finder" | "files" | "explorer") {
        #[cfg(target_os = "macos")]
        std::process::Command::new("open").arg(&path).spawn()
            .map_err(|e| AppError::Other(format!("Failed to open Finder: {e}")))?;
        #[cfg(target_os = "linux")]
        std::process::Command::new("xdg-open").arg(&path).spawn()
            .map_err(|e| AppError::Other(format!("Failed to open file manager: {e}")))?;
        #[cfg(target_os = "windows")]
        std::process::Command::new("explorer").arg(&path).spawn()
            .map_err(|e| AppError::Other(format!("Failed to open Explorer: {e}")))?;
        return Ok(());
    }

    // Terminal editors: cd to the path and open the editor
    const TERMINAL_EDITORS: &[&str] = &["vim", "vi", "nvim", "nano", "emacs"];
    if TERMINAL_EDITORS.iter().any(|&e| editor == e) {
        #[cfg(target_os = "macos")]
        {
            // Use AppleScript's `system attribute` to read the env var set on the osascript process,
            // then `quoted form of` to safely escape it for shell use.
            let script = "tell application \"Terminal\"\n  activate\n  do script (\"cd \" & quoted form of (system attribute \"LAF_AGENT_CD_PATH\"))\nend tell";
            std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .env("LAF_AGENT_CD_PATH", &path)
                .output()
                .map_err(|e| AppError::Other(format!("Failed to open Terminal: {e}")))?;
        }
        #[cfg(not(target_os = "macos"))]
        std::process::Command::new("xterm")
            .arg("-e").arg(&editor).arg(&path)
            .spawn()
            .map_err(|e| AppError::Other(format!("Failed to open {editor}: {e}")))?;
        return Ok(());
    }

    // ── Terminal emulators: open a new window/tab at the workspace ──
    match editor.as_str() {
        "ghostty" => {
            #[cfg(target_os = "macos")]
            std::process::Command::new("open").args(["-a", "Ghostty", &path]).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open Ghostty: {e}")))?;
            #[cfg(target_os = "linux")]
            std::process::Command::new("ghostty").arg(format!("--working-directory={path}")).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open Ghostty: {e}")))?;
            return Ok(());
        }
        "cmux" => {
            #[cfg(target_os = "macos")]
            std::process::Command::new("open").args(["-a", "cmux", &path]).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open cmux: {e}")))?;
            #[cfg(not(target_os = "macos"))]
            return Err(AppError::Other("cmux is macOS only".to_string()));
            #[cfg(target_os = "macos")]
            return Ok(());
        }
        "iterm2" => {
            #[cfg(target_os = "macos")]
            std::process::Command::new("open").args(["-a", "iTerm", &path]).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open iTerm2: {e}")))?;
            #[cfg(not(target_os = "macos"))]
            return Err(AppError::Other("iTerm2 is macOS only".to_string()));
            #[cfg(target_os = "macos")]
            return Ok(());
        }
        "alacritty" => {
            std::process::Command::new("alacritty").args(["--working-directory", &path]).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open Alacritty: {e}")))?;
            return Ok(());
        }
        "kitty" => {
            std::process::Command::new("kitty").args(["--directory", &path]).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open Kitty: {e}")))?;
            return Ok(());
        }
        "wezterm" => {
            std::process::Command::new("wezterm").args(["start", "--cwd", &path]).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open WezTerm: {e}")))?;
            return Ok(());
        }
        "hyper" => {
            #[cfg(target_os = "macos")]
            std::process::Command::new("open").args(["-a", "Hyper", &path]).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open Hyper: {e}")))?;
            #[cfg(not(target_os = "macos"))]
            std::process::Command::new("hyper").arg(&path).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open Hyper: {e}")))?;
            return Ok(());
        }
        #[cfg(target_os = "windows")]
        "wt" => {
            std::process::Command::new("wt").args(["-d", &path]).spawn()
                .map_err(|e| AppError::Other(format!("Failed to open Windows Terminal: {e}")))?;
            return Ok(());
        }
        "tmux" => {
            // Create a detached session named after the directory, then attach in default terminal
            let slug = path.split('/').next_back().unwrap_or("laf-agent")
                .replace(|c: char| !c.is_alphanumeric() && c != '-', "-");
            let session = format!("kdx-{slug}");
            // Try to create session; if it already exists, that's fine
            let _ = std::process::Command::new("tmux")
                .args(["new-session", "-d", "-s", &session, "-c", &path])
                .output();
            // Attach in the default terminal
            let attach_cmd = format!("tmux attach -t {session}");
            #[cfg(target_os = "macos")]
            {
                // Use environment variable to pass the command safely
                let script = "tell application \"Terminal\"\n  activate\n  do script (system attribute \"LAF_AGENT_CMD\")\nend tell";
                std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(script)
                    .env("LAF_AGENT_CMD", &attach_cmd)
                    .output()
                    .map_err(|e| AppError::Other(format!("Failed to open tmux: {e}")))?;
            }
            #[cfg(target_os = "linux")]
            {
                // Try common terminals
                let terminals = ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"];
                let mut launched = false;
                for term in terminals {
                    let result = if term == "gnome-terminal" {
                        std::process::Command::new(term).arg("--").arg("sh").arg("-c").arg(&attach_cmd).spawn()
                    } else {
                        std::process::Command::new(term).arg("-e").arg(&attach_cmd).spawn()
                    };
                    if result.is_ok() { launched = true; break; }
                }
                if !launched {
                    return Err(AppError::Other("No terminal emulator found for tmux".to_string()));
                }
            }
            return Ok(());
        }
        _ => {}
    }

    // ── GUI editors: try CLI binary first, then macOS `open -a` for .app bundles ──
    #[cfg(target_os = "macos")]
    {
        const APP_MAP: &[(&str, &str)] = &[
            ("zed", "Zed"), ("cursor", "Cursor"), ("code", "Visual Studio Code"),
            ("agent", "Agent"), ("trae", "Trae"),
            ("idea", "IntelliJ IDEA"),
        ];
        if let Some((_, app_name)) = APP_MAP.iter().find(|(bin, _)| *bin == editor) {
            if which::which(&editor).is_ok() {
                std::process::Command::new(&editor).arg(&path).spawn()
                    .map_err(|e| AppError::Other(format!("Failed to open {editor}: {e}")))?;
            } else {
                std::process::Command::new("open").arg("-a").arg(app_name).arg(&path).spawn()
                    .map_err(|e| AppError::Other(format!("Failed to open {app_name}: {e}")))?;
            }
            return Ok(());
        }
    }

    // Generic fallback
    std::process::Command::new(&editor).arg(&path).spawn()
        .map_err(|e| AppError::Other(format!("Failed to open '{editor}': {e}")))?;
    Ok(())
}

/// Detect which code editors, terminals, and tools are installed.
/// Tier 1 (fast): CLI binaries in PATH + .app bundle path checks.
/// Returns results in <10ms. Tier 2 (Spotlight) runs separately via detect_editors_background.
#[tauri::command]
pub fn detect_editors() -> Vec<String> {
    let mut found = Vec::new();
    let push_unique = |bin: &str, found: &mut Vec<String>| {
        let s = bin.to_string();
        if !found.contains(&s) {
            found.push(s);
        }
    };

    // ── GUI editors: CLI in PATH ──────────────────────────────────
    for bin in ["cursor", "trae", "code", "zed", "idea"] {
        if which::which(bin).is_ok() {
            push_unique(bin, &mut found);
        }
    }

    // ── Terminals & multiplexers: CLI in PATH ─────────────────────
    #[cfg(not(target_os = "windows"))]
    const TERMINAL_BINS: &[&str] = &[
        "ghostty", "cmux", "alacritty", "kitty", "wezterm", "hyper", "tmux",
    ];
    #[cfg(target_os = "windows")]
    const TERMINAL_BINS: &[&str] = &[
        "wt", "alacritty", "wezterm", "hyper",
    ];
    for bin in TERMINAL_BINS {
        if which::which(bin).is_ok() {
            push_unique(bin, &mut found);
        }
    }

    // ── macOS: .app bundle checks (both /Applications and ~/Applications) ──
    #[cfg(target_os = "macos")]
    {
        const APP_CHECKS: &[(&str, &[&str])] = &[
            // Editors
            ("zed", &["Zed.app", "Zed Preview.app"]),
            ("cursor", &["Cursor.app"]),
            ("code", &["Visual Studio Code.app"]),
            ("agent", &["Agent.app"]),
            ("trae", &["Trae.app"]),
            ("idea", &["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"]),
            // Terminals
            ("ghostty", &["Ghostty.app"]),
            ("cmux", &["cmux.app"]),
            ("iterm2", &["iTerm.app"]),
            ("alacritty", &["Alacritty.app"]),
            ("kitty", &["kitty.app"]),
            ("wezterm", &["WezTerm.app"]),
            ("hyper", &["Hyper.app"]),
        ];
        let app_dirs: Vec<PathBuf> = {
            let mut dirs = vec![PathBuf::from("/Applications")];
            if let Some(home) = dirs::home_dir() {
                dirs.push(home.join("Applications"));
            }
            dirs
        };
        for (bin, app_names) in APP_CHECKS {
            if found.contains(&bin.to_string()) {
                continue;
            }
            let exists = app_names.iter().any(|name| {
                app_dirs.iter().any(|dir| dir.join(name).exists())
            });
            if exists {
                push_unique(bin, &mut found);
            }
        }
    }

    // ── Terminal editors (lower priority) ─────────────────────────
    if which::which("nvim").is_ok() {
        push_unique("nvim", &mut found);
    } else if which::which("vim").is_ok() {
        push_unique("vim", &mut found);
    }

    // ── File manager (always last) ───────────────────────────────
    #[cfg(target_os = "macos")]
    found.push("finder".to_string());
    #[cfg(target_os = "linux")]
    found.push("files".to_string());
    #[cfg(target_os = "windows")]
    found.push("explorer".to_string());

    found
}

/// Tier 2 background discovery: find apps not caught by Tier 1.
/// macOS: uses Spotlight (mdfind) to find apps installed in non-standard locations.
/// Linux: scans XDG .desktop files.
/// Emits "editors-updated" event with any newly discovered apps.
#[tauri::command]
pub async fn detect_editors_background(app: tauri::AppHandle, known: Vec<String>) {
    let new_apps = discover_apps_slow(&known);
    if !new_apps.is_empty() {
        let _ = app.emit("editors-updated", &new_apps);
    }
}

fn discover_apps_slow(known: &[String]) -> Vec<String> {
    let mut found = Vec::new();

    #[cfg(target_os = "macos")]
    {
        // Spotlight lookup by bundle identifier
        const BUNDLE_IDS: &[(&str, &str)] = &[
            ("cursor", "com.todesktop.230313mzl4w4u92"),
            ("code", "com.microsoft.VSCode"),
            ("zed", "dev.zed.Zed"),
            ("agent", "com.amazon.agent"),
            ("idea", "com.jetbrains.intellij"),
            ("ghostty", "com.mitchellh.ghostty"),
            ("cmux", "ai.manaflow.cmux"),
            ("iterm2", "com.googlecode.iterm2"),
            ("alacritty", "org.alacritty"),
            ("kitty", "net.kovidgoyal.kitty"),
            ("wezterm", "com.github.wez.wezterm"),
            ("hyper", "co.zeit.hyper"),
        ];
        for (bin, bundle_id) in BUNDLE_IDS {
            if known.contains(&bin.to_string()) || found.contains(&bin.to_string()) {
                continue;
            }
            if spotlight_app_exists(bundle_id) {
                found.push(bin.to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Scan XDG .desktop files
        const DESKTOP_FILES: &[(&str, &[&str])] = &[
            ("ghostty", &["com.mitchellh.ghostty.desktop", "ghostty.desktop"]),
            ("alacritty", &["Alacritty.desktop", "alacritty.desktop"]),
            ("kitty", &["kitty.desktop"]),
            ("wezterm", &["org.wezfurlong.wezterm.desktop", "wezterm.desktop"]),
            ("hyper", &["hyper.desktop"]),
            ("idea", &["jetbrains-idea.desktop", "jetbrains-idea-ce.desktop"]),
            ("code", &["code.desktop", "visual-studio-code.desktop"]),
            ("cursor", &["cursor.desktop"]),
        ];
        let xdg_dirs = xdg_data_dirs();
        for (bin, desktop_names) in DESKTOP_FILES {
            if known.contains(&bin.to_string()) || found.contains(&bin.to_string()) {
                continue;
            }
            let exists = desktop_names.iter().any(|name| {
                xdg_dirs.iter().any(|dir| dir.join("applications").join(name).exists())
            });
            if exists {
                found.push(bin.to_string());
            }
        }
    }

    found
}

#[cfg(target_os = "macos")]
fn spotlight_app_exists(bundle_id: &str) -> bool {
    // mdfind -count returns just the number of matches — fast and low overhead.
    // Typically completes in <100ms. If Spotlight is unavailable, returns quickly with error.
    let output = std::process::Command::new("mdfind")
        .arg("-count")
        .arg(format!("kMDItemCFBundleIdentifier == '{bundle_id}'"))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();
    match output {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<u32>()
                .unwrap_or(0) > 0
        }
        _ => false,
    }
}

#[cfg(target_os = "linux")]
fn xdg_data_dirs() -> Vec<PathBuf> {
    match std::env::var("XDG_DATA_DIRS") {
        Ok(val) if !val.is_empty() => {
            val.split(':').map(PathBuf::from).collect()
        }
        _ => vec![
            PathBuf::from("/usr/share"),
            PathBuf::from("/usr/local/share"),
        ],
    }
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), AppError> {
    open::that(&url).map_err(AppError::Io)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub is_dir: bool,
    pub ext: String,
    /// File modification time as Unix epoch seconds (0 if unavailable)
    pub modified_at: i64,
}

const MAX_FILES: usize = 25_000;

const IGNORED_DIRS: &[&str] = &[
    ".git", "node_modules", ".next", ".turbo", "dist", "build", "out",
    ".cache", "target", "__pycache__", ".venv", "venv", ".tox",
    ".eggs", "*.egg-info", ".mypy_cache", ".pytest_cache",
    "coverage", ".nyc_output", ".parcel-cache", ".svelte-kit",
    ".nuxt", ".output", ".vercel", ".netlify",
];

fn is_ignored_dir(name: &str) -> bool {
    IGNORED_DIRS.contains(&name)
}

/// Get file modification time as Unix epoch seconds
fn file_mtime(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn list_via_walk(root: &Path, respect_gitignore: bool) -> Vec<ProjectFile> {
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(respect_gitignore)
        .git_global(respect_gitignore)
        .git_exclude(respect_gitignore)
        .filter_entry(|entry| {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                return !is_ignored_dir(&entry.file_name().to_string_lossy());
            }
            true
        })
        .build();

    let mut files: Vec<ProjectFile> = Vec::with_capacity(2048);
    for entry in walker.flatten() {
        if files.len() >= MAX_FILES { break; }
        let Ok(rel) = entry.path().strip_prefix(root) else { continue };
        if rel.as_os_str().is_empty() { continue; }
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let name = rel.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let dir = rel.parent().map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        let ext = if is_dir { String::new() } else { rel.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default() };
        let mtime = file_mtime(entry.path());
        files.push(ProjectFile {
            path: rel_str, name, dir, is_dir, ext, modified_at: mtime,
        });
    }
    files
}

/// Async with the walk on the blocking pool: a sync command runs on the main
/// thread, and a full-repository scan of a large project froze the entire
/// window event loop for its duration.
#[tauri::command]
pub async fn list_project_files(root: String, respect_gitignore: bool) -> Result<Vec<ProjectFile>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = Path::new(&root);
        if !root_path.is_dir() {
            return Err(AppError::Other(format!("Not a directory: {}", root)));
        }

        let mut files = list_via_walk(root_path, respect_gitignore);

        files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.path.cmp(&b.path)));
        Ok(files)
    })
    .await
    .map_err(|e| AppError::Other(format!("project file scan task failed: {e}")))?
}

// ── prime-agent CLI authentication ──────────────────────────────────────

#[derive(Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuthIdentity {
    pub email: Option<String>,
    #[serde(default)]
    pub account_type: Option<String>,
}

#[tauri::command]
pub fn auth_status(agent_bin: Option<String>) -> Result<AuthIdentity, AppError> {
    // prime-agent has no `whoami`. Credentials are provider API keys / OAuth
    // tokens stored in ~/.prime/agent/auth.json, or environment variables.
    let _ = agent_bin;
    let auth_path = dirs::home_dir()
        .map(|h| h.join(".prime/agent/auth.json"))
        .filter(|p| p.exists());

    if let Some(path) = auth_path {
        // Report the configured providers as the "account".
        let providers = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()))
            .unwrap_or_default();
        return Ok(AuthIdentity {
            email: None,
            account_type: Some(if providers.is_empty() {
                "prime-agent".to_string()
            } else {
                providers.join(", ")
            }),
        });
    }

    const KEY_VARS: &[&str] = &[
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
        "PRIME_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY",
    ];
    let env_providers: Vec<&str> = KEY_VARS
        .iter()
        .copied()
        .filter(|k| std::env::var(k).map(|v| !v.is_empty()).unwrap_or(false))
        .collect();
    if !env_providers.is_empty() {
        return Ok(AuthIdentity {
            email: None,
            account_type: Some(format!("env: {}", env_providers.join(", "))),
        });
    }

    Err(AppError::Other(
        "Not authenticated: no ~/.prime/agent/auth.json and no provider API key env vars. Run `prime-agent` in a terminal and use /login.".to_string(),
    ))
}

/// Directory that hosts project-independent chat sessions. Chats run the
/// agent in this neutral workspace so no repository context is scanned or
/// injected — token-lean, like a plain chat app. Conversations themselves are
/// persisted locally by the existing thread store.
#[tauri::command]
pub fn ensure_chats_dir() -> Result<String, AppError> {
    // A visible folder: anything the agent saves during a project-less chat
    // must be findable in Finder, not buried in a dotfolder. Documents is the
    // natural home; fall back to the home directory when it doesn't resolve.
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| AppError::Other("Could not resolve home directory".to_string()))?;
    let dir = base.join("LAF Agent Chats");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Store a provider API key in prime-agent's auth.json so the bundled agent
/// can authenticate without the user ever opening a terminal. The file is a
/// `Record<provider, {type:"api_key", key} | {type:"oauth", ...}>` map; we
/// read-modify-write so OAuth credentials from other providers survive.
#[tauri::command]
pub fn auth_set_api_key(provider: String, key: String) -> Result<(), AppError> {
    let provider = provider.trim().to_lowercase();
    let key = key.trim().to_string();
    // Provider ids are written as object keys in auth.json; keep them to a
    // conservative charset rather than an allow-list so new providers work
    // without an app update.
    if provider.len() > 40
        || !provider
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err(AppError::Other(format!(
            "Invalid provider id '{provider}' (use a-z, 0-9, '-' or '_')"
        )));
    }
    if key.is_empty() {
        return Err(AppError::Other("API key must not be empty".to_string()));
    }

    let dir = dirs::home_dir()
        .map(|h| h.join(".prime/agent"))
        .ok_or_else(|| AppError::Other("Could not resolve home directory".to_string()))?;
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }

    let auth_path = dir.join("auth.json");
    let mut root = read_json_object_for_update(&auth_path)?;
    root.insert(
        provider,
        serde_json::json!({ "type": "api_key", "key": key }),
    );
    write_atomic(&auth_path, serde_json::to_string_pretty(&serde_json::Value::Object(root))?.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&auth_path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// A provider the user has configured, for the settings UI.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredProvider {
    pub name: String,
    /// "api_key" | "oauth"
    pub kind: String,
    /// True when this provider also has a models.json entry (custom endpoint).
    pub is_custom: bool,
    /// Custom endpoint base URL, when applicable.
    pub base_url: Option<String>,
    pub model_count: u32,
}

/// List every provider with stored credentials, merged with models.json so the
/// UI can show custom endpoints alongside the built-in ones.
#[tauri::command]
pub fn auth_list_providers() -> Result<Vec<ConfiguredProvider>, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Other("No home directory".into()))?;
    let agent_dir = home.join(".prime/agent");

    let read_json = |path: std::path::PathBuf| -> Option<serde_json::Map<String, serde_json::Value>> {
        std::fs::read_to_string(path)
            .ok()
            .filter(|c| !c.trim().is_empty())
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .and_then(|v| v.as_object().cloned())
    };

    let auth = read_json(agent_dir.join("auth.json")).unwrap_or_default();
    let models = read_json(agent_dir.join("models.json"))
        .and_then(|m| m.get("providers").and_then(|p| p.as_object().cloned()))
        .unwrap_or_default();

    let mut out: Vec<ConfiguredProvider> = auth
        .iter()
        // `mcp:<name>` entries are MCP integrations, not model providers.
        .filter(|(name, _)| !name.starts_with("mcp:"))
        .map(|(name, cred)| {
            let custom = models.get(name);
            ConfiguredProvider {
                name: name.clone(),
                kind: cred
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("api_key")
                    .to_string(),
                is_custom: custom.is_some(),
                base_url: custom
                    .and_then(|c| c.get("baseUrl"))
                    .and_then(|v| v.as_str())
                    .map(String::from),
                model_count: custom
                    .and_then(|c| c.get("models"))
                    .and_then(|v| v.as_array())
                    .map(|a| a.len() as u32)
                    .unwrap_or(0),
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Compatibility flags for third-party OpenAI-compatible endpoints.
///
/// prime-agent assumes an unknown base URL speaks full OpenAI-platform dialect
/// and sends extras like `store`, the `developer` role, `reasoning_effort`, and
/// strict function schemas. Most compatible servers (Upstage, DeepSeek-style
/// gateways, vLLM, Ollama, …) reject those with `400 Unrecognized request
/// arguments`. Starting from the plain chat-completions subset makes any such
/// endpoint work; users can widen it by editing models.json.
fn conservative_compat() -> serde_json::Value {
    serde_json::json!({
        "supportsStore": false,
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "supportsStrictMode": false,
    })
}

/// Backfill compat flags on providers registered before this defaulting
/// existed. Returns the number of providers repaired.
#[tauri::command]
pub fn repair_custom_providers() -> Result<u32, AppError> {
    let path = match dirs::home_dir().map(|h| h.join(".prime/agent/models.json")) {
        Some(p) if p.exists() => p,
        _ => return Ok(0),
    };
    let content = std::fs::read_to_string(&path)?;
    if content.trim().is_empty() {
        return Ok(0);
    }
    let mut root: serde_json::Value = serde_json::from_str(&content)?;
    let mut repaired = 0u32;
    if let Some(providers) = root.get_mut("providers").and_then(|v| v.as_object_mut()) {
        for (name, cfg) in providers.iter_mut() {
            let Some(obj) = cfg.as_object_mut() else { continue };
            // DeepSeek registrations from before the Responses-API switch:
            // migrate them so provider-side web search starts working.
            if name == "deepseek" && obj.get("api").and_then(|v| v.as_str()) == Some("openai-completions") {
                obj.insert("api".to_string(), serde_json::json!("openai-responses"));
                obj.insert("baseUrl".to_string(), serde_json::json!("https://api.deepseek.com"));
                obj.remove("compat");
                repaired += 1;
                continue;
            }
            // Only OpenAI-compatible entries need the conservative subset.
            if obj.get("api").and_then(|v| v.as_str()) != Some("openai-completions") {
                continue;
            }
            if obj.contains_key("compat") {
                continue;
            }
            obj.insert("compat".to_string(), conservative_compat());
            repaired += 1;
        }
    }
    if repaired > 0 {
        write_atomic(&path, serde_json::to_string_pretty(&root)?.as_bytes())?;
        log::info!("[providers] backfilled compat flags on {repaired} custom provider(s)");
    }
    Ok(repaired)
}

/// Register a custom OpenAI-compatible provider (e.g. Upstage Solar, vLLM,
/// a proxy) in prime-agent's `~/.prime/agent/models.json`, and mirror the key
/// into auth.json so the app's auth status reflects it. models.json schema:
/// `{providers: {<name>: {baseUrl, api, apiKey, models: [{id}]}}}`.
///
/// `api` picks the wire protocol: `openai-completions` (the default) or
/// `openai-responses` for endpoints that serve the Responses API — DeepSeek
/// needs the latter for its server-side `web_search` tool.
#[tauri::command]
pub fn auth_set_custom_provider(
    name: String,
    base_url: String,
    api_key: String,
    model_ids: Vec<String>,
    api: Option<String>,
) -> Result<(), AppError> {
    let api = match api.as_deref() {
        None | Some("") | Some("openai-completions") => "openai-completions",
        Some("openai-responses") => "openai-responses",
        Some(other) => {
            return Err(AppError::Other(format!("Unsupported provider api '{other}'")));
        }
    };
    let name = name.trim().to_lowercase();
    if name.is_empty()
        || name.len() > 32
        || !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err(AppError::Other(
            "Provider name must be 1-32 chars of a-z, 0-9, '-' or '_'".to_string(),
        ));
    }
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err(AppError::Other("Base URL must start with http(s)://".to_string()));
    }
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err(AppError::Other("API key must not be empty".to_string()));
    }
    let models: Vec<String> = model_ids
        .iter()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .collect();
    if models.is_empty() {
        return Err(AppError::Other(
            "At least one model id is required (e.g. solar-pro2)".to_string(),
        ));
    }

    let dir = dirs::home_dir()
        .map(|h| h.join(".prime/agent"))
        .ok_or_else(|| AppError::Other("Could not resolve home directory".to_string()))?;
    std::fs::create_dir_all(&dir)?;

    // Read both files up front: if either is corrupt, abort before writing
    // anything so the two stay consistent.
    let models_path = dir.join("models.json");
    let auth_path = dir.join("auth.json");
    let mut auth_root = read_json_object_for_update(&auth_path)?;

    // models.json: read-modify-write, preserving other providers.
    let mut root = read_json_object_for_update(&models_path)?;
    let providers = root
        .entry("providers".to_string())
        .or_insert_with(|| serde_json::json!({}));
    let providers = providers
        .as_object_mut()
        .ok_or_else(|| AppError::Other("models.json providers is not an object".to_string()))?;
    let mut entry = serde_json::json!({
        "baseUrl": base_url,
        "api": api,
        "apiKey": api_key,
        "models": models.iter().map(|id| serde_json::json!({ "id": id })).collect::<Vec<_>>(),
    });
    // The conservative compat subset exists for quirky chat-completions
    // endpoints; Responses endpoints ignore unknown params on their own.
    if api == "openai-completions" {
        entry["compat"] = conservative_compat();
    }
    providers.insert(name.clone(), entry);
    write_atomic(&models_path, serde_json::to_string_pretty(&serde_json::Value::Object(root))?.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&models_path, std::fs::Permissions::from_mode(0o600));
    }

    // Mirror into auth.json so the connected-status check picks it up.
    auth_root.insert(name, serde_json::json!({ "type": "api_key", "key": api_key }));
    write_atomic(&auth_path, serde_json::to_string_pretty(&serde_json::Value::Object(auth_root))?.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&auth_path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Remove a single provider credential from auth.json.
#[tauri::command]
pub fn auth_remove_provider(provider: String) -> Result<(), AppError> {
    let auth_path = dirs::home_dir()
        .map(|h| h.join(".prime/agent/auth.json"))
        .ok_or_else(|| AppError::Other("Could not resolve home directory".to_string()))?;
    if !auth_path.exists() {
        return Ok(());
    }
    let content = std::fs::read_to_string(&auth_path)?;
    let mut root: serde_json::Value = serde_json::from_str(&content)?;
    if let Some(obj) = root.as_object_mut() {
        obj.remove(provider.trim());
    }
    write_atomic(&auth_path, serde_json::to_string_pretty(&root)?.as_bytes())?;

    // Custom endpoints also live in models.json — drop them together so a
    // removed provider doesn't linger in the model picker without a key.
    if let Some(models_path) = dirs::home_dir().map(|h| h.join(".prime/agent/models.json")) {
        if models_path.exists() {
            if let Ok(text) = std::fs::read_to_string(&models_path) {
                if let Ok(mut models) = serde_json::from_str::<serde_json::Value>(&text) {
                    let removed = models
                        .get_mut("providers")
                        .and_then(|v| v.as_object_mut())
                        .map(|p| p.remove(provider.trim()).is_some())
                        .unwrap_or(false);
                    if removed {
                        let _ = write_atomic(&models_path, serde_json::to_string_pretty(&models)?.as_bytes());
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn auth_logout(agent_bin: Option<String>) -> Result<(), AppError> {
    // Logging out means removing prime-agent's stored credentials.
    let _ = agent_bin;
    let auth_path = dirs::home_dir()
        .map(|h| h.join(".prime/agent/auth.json"))
        .ok_or_else(|| AppError::Other("Could not resolve home directory".to_string()))?;
    if auth_path.exists() {
        std::fs::remove_file(&auth_path)
            .map_err(|e| AppError::Other(format!("Failed to remove auth.json: {e}")))?;
    }
    Ok(())
}

// ── Project icon detection ───────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconInfo {
    pub icon_type: String,
    pub value: String,
}

/// Search for a favicon file in the given directory, returning the first match.
fn find_favicon_in(dir: &Path) -> Option<PathBuf> {
    // Check favicon.svg first (modern, vector format)
    let svg = dir.join("favicon.svg");
    if svg.is_file() { return Some(svg); }
    // Check favicon.ico (most common)
    let ico = dir.join("favicon.ico");
    if ico.is_file() { return Some(ico); }
    // Check favicon.png
    let png = dir.join("favicon.png");
    if png.is_file() { return Some(png); }
    // Check icon.svg / icon.png / icon.ico (Next.js App Router convention)
    let icon_svg = dir.join("icon.svg");
    if icon_svg.is_file() { return Some(icon_svg); }
    let icon_png = dir.join("icon.png");
    if icon_png.is_file() { return Some(icon_png); }
    let icon_ico = dir.join("icon.ico");
    if icon_ico.is_file() { return Some(icon_ico); }
    // Check any .ico file
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("ico") { return Some(p); }
                }
            }
        }
    }
    None
}

/// Extract an icon path from an HTML file by parsing `<link rel="icon" href="...">`.
/// Returns the resolved absolute path if the referenced file exists.
fn extract_icon_from_html(project_root: &Path, html_path: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(html_path).ok()?;
    // Quick bail-out: if there's no <link tag at all, skip the scan.
    let lower = content.to_lowercase();
    if !lower.contains("<link") {
        return None;
    }
    // Work entirely on the lowercased string for tag detection, but extract
    // href values from the original content using the same byte offsets.
    // This is safe because `to_lowercase()` preserves byte length for ASCII
    // characters, and HTML tag syntax (<link, rel=, href=, >) is pure ASCII.
    // Non-ASCII characters only appear in attribute values (like href paths),
    // and we extract those from the original `content` using the same offsets.
    let mut pos = 0;
    while pos < lower.len() {
        let tag_start = match lower[pos..].find("<link") {
            Some(i) => pos + i,
            None => break,
        };
        let tag_end = match lower[tag_start..].find('>') {
            Some(i) => tag_start + i,
            None => break,
        };
        // Verify the slice boundaries are valid UTF-8 char boundaries
        if !lower.is_char_boundary(tag_start) || !lower.is_char_boundary(tag_end + 1) {
            pos = tag_end + 1;
            continue;
        }
        let tag = &lower[tag_start..=tag_end];
        pos = tag_end + 1;

        // Check if this link tag has rel="icon" or rel="shortcut icon"
        let has_icon_rel = tag.contains("rel=\"icon\"")
            || tag.contains("rel='icon'")
            || tag.contains("rel=\"shortcut icon\"")
            || tag.contains("rel='shortcut icon'");
        if !has_icon_rel { continue; }

        // Extract href value from the original (case-preserved) content
        let orig_tag = &content[tag_start..=tag_end];
        let href = match extract_href_value(orig_tag) {
            Some(h) => h,
            None => continue,
        };

        // Resolve the href to an absolute path
        let clean_href = href.trim_start_matches('/');
        // Try public/ first, then project root
        let candidates = [
            project_root.join("public").join(clean_href),
            project_root.join(clean_href),
        ];
        for candidate in &candidates {
            if candidate.is_file() {
                // Security: ensure the path is within the project
                if candidate.starts_with(project_root) {
                    return Some(candidate.clone());
                }
            }
        }
    }
    None
}

/// Extract the href attribute value from a tag string.
fn extract_href_value(tag: &str) -> Option<String> {
    // Find href=" or href='
    let lower = tag.to_lowercase();
    let href_pos = lower.find("href=")?;
    let after_href = &tag[href_pos + 5..];
    let quote = after_href.chars().next()?;
    if quote != '"' && quote != '\'' { return None; }
    let value_start = 1; // skip the opening quote
    let value_end = after_href[value_start..].find(quote)?;
    let value = &after_href[value_start..value_start + value_end];
    // Strip query params
    let clean = value.split('?').next().unwrap_or(value);
    if clean.is_empty() { return None; }
    Some(clean.to_string())
}

/// Detect the framework/language of a project from marker files.
fn detect_framework(root: &Path) -> Option<&'static str> {
    // Check specific framework config files first (most specific → least)
    let checks: &[(&[&str], &str)] = &[
        (&["next.config.js", "next.config.ts", "next.config.mjs"], "nextjs"),
        (&["svelte.config.js", "svelte.config.ts"], "svelte"),
        (&["angular.json"], "angular"),
        (&["Cargo.toml"], "rust"),
        (&["Gemfile"], "ruby"),
        (&["go.mod"], "go"),
        (&["pyproject.toml", "requirements.txt", "setup.py"], "python"),
        (&["pom.xml", "build.gradle", "build.gradle.kts"], "java"),
        (&["composer.json"], "php"),
        (&["Dockerfile"], "docker"),
    ];
    for (files, id) in checks {
        for file in *files {
            if root.join(file).is_file() { return Some(id); }
        }
    }
    // C/C++ detection: CMakeLists.txt or Makefile
    if root.join("CMakeLists.txt").is_file() { return Some("cpp"); }
    // package.json-based detection
    let pkg_path = root.join("package.json");
    if pkg_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&pkg_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let has_dep = |name: &str| -> bool {
                    json.get("dependencies").and_then(|d| d.get(name)).is_some()
                        || json.get("devDependencies").and_then(|d| d.get(name)).is_some()
                };
                if has_dep("vue") || has_dep("nuxt") { return Some("vue"); }
                if has_dep("react") || has_dep("next") { return Some("react"); }
                if has_dep("svelte") { return Some("svelte"); }
                if has_dep("@angular/core") { return Some("angular"); }
            }
        }
        // tsconfig.json → typescript
        if root.join("tsconfig.json").is_file() { return Some("typescript"); }
        return Some("javascript");
    }
    // Standalone tsconfig without package.json
    if root.join("tsconfig.json").is_file() { return Some("typescript"); }
    None
}

#[tauri::command]
pub fn detect_project_icon(cwd: String) -> Option<ProjectIconInfo> {
    let root = Path::new(&cwd);
    if !root.is_dir() { return None; }
    // 1. Search for favicon files in well-known directories
    let favicon_dirs: Vec<PathBuf> = vec![
        root.to_path_buf(),
        root.join("public"),
        root.join("static"),
        root.join("assets"),
        root.join("src").join("app"),
        root.join("app"),
    ];
    for dir in &favicon_dirs {
        if let Some(path) = find_favicon_in(dir) {
            return Some(ProjectIconInfo {
                icon_type: "favicon".to_string(),
                value: path.to_string_lossy().to_string(),
            });
        }
    }
    // 1b. Check .idea/icon.svg (JetBrains project icon)
    let idea_icon = root.join(".idea").join("icon.svg");
    if idea_icon.is_file() {
        return Some(ProjectIconInfo {
            icon_type: "favicon".to_string(),
            value: idea_icon.to_string_lossy().to_string(),
        });
    }
    // 1c. Check assets/logo.svg and assets/logo.png
    for name in &["logo.svg", "logo.png"] {
        let logo = root.join("assets").join(name);
        if logo.is_file() {
            return Some(ProjectIconInfo {
                icon_type: "favicon".to_string(),
                value: logo.to_string_lossy().to_string(),
            });
        }
    }
    // 2. Parse HTML source files for <link rel="icon" href="...">
    let html_sources = [
        root.join("index.html"),
        root.join("public").join("index.html"),
        root.join("src").join("index.html"),
    ];
    for html_path in &html_sources {
        if let Some(icon_path) = extract_icon_from_html(root, html_path) {
            return Some(ProjectIconInfo {
                icon_type: "favicon".to_string(),
                value: icon_path.to_string_lossy().to_string(),
            });
        }
    }
    // 3. Monorepo: check apps/*/public and packages/*/public
    for subdir in &["apps", "packages"] {
        let parent = root.join(subdir);
        if let Ok(entries) = std::fs::read_dir(&parent) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let pub_dir = entry.path().join("public");
                    if let Some(path) = find_favicon_in(&pub_dir) {
                        return Some(ProjectIconInfo {
                            icon_type: "favicon".to_string(),
                            value: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }
    // 4. Detect framework/language
    detect_framework(root).map(|id| ProjectIconInfo {
        icon_type: "framework".to_string(),
        value: id.to_string(),
    })
}

// ── Small image listing for icon picker ──────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SmallImageInfo {
    pub path: String,
    pub width: usize,
    pub height: usize,
}

const ICON_IMAGE_EXTENSIONS: &[&str] = &[".png", ".ico", ".svg", ".jpg", ".jpeg", ".gif", ".webp"];

fn is_icon_image(name: &str) -> bool {
    let lower = name.to_lowercase();
    ICON_IMAGE_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

fn is_svg(name: &str) -> bool {
    name.to_lowercase().ends_with(".svg")
}

/// List image files in a project that are ≤ max_size pixels in both dimensions.
/// SVG files are always included (vector format, no pixel dimensions).
/// Reads only file headers for dimensions (fast, no full decode).
///
/// Async with the tree walk on the blocking pool — same reasoning as
/// [`list_project_files`]: the scan must not run on the main thread.
#[tauri::command]
pub async fn list_small_images(cwd: String, max_size: usize) -> Vec<SmallImageInfo> {
    tauri::async_runtime::spawn_blocking(move || list_small_images_sync(&cwd, max_size))
        .await
        .unwrap_or_default()
}

fn list_small_images_sync(cwd: &str, max_size: usize) -> Vec<SmallImageInfo> {
    let root = std::path::Path::new(cwd);
    if !root.is_dir() { return vec![]; }

    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .filter_entry(|entry| {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                return !is_ignored_dir(&entry.file_name().to_string_lossy());
            }
            true
        })
        .build();

    let mut results = Vec::new();
    for entry in walker.flatten() {
        if results.len() >= 500 { break; } // cap to avoid scanning huge projects
        let path = entry.path();
        if !path.is_file() { continue; }
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !is_icon_image(&name) { continue; }

        let rel = match path.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        // SVG files are vector; include them without dimension checks
        if is_svg(&name) {
            results.push(SmallImageInfo { path: rel, width: 0, height: 0 });
            continue;
        }

        // Read dimensions from file header for raster images
        if let Ok(size) = imagesize::size(path) {
            if max_size == 0 || (size.width <= max_size && size.height <= max_size) {
                results.push(SmallImageInfo {
                    path: rel,
                    width: size.width,
                    height: size.height,
                });
            }
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_creates_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("auth.json");
        // Fresh file.
        write_atomic(&target, b"{\"a\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "{\"a\":1}");
        // Overwrite — the reader must only ever see old or new, and after
        // the call, exactly the new bytes.
        write_atomic(&target, b"{\"a\":2,\"b\":3}").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "{\"a\":2,\"b\":3}");
        // No temp files left behind.
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp."))
            .collect();
        assert!(leftovers.is_empty(), "temp files must not survive: {leftovers:?}");
    }

    #[test]
    fn write_atomic_cleans_up_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        // Renaming onto a path whose parent is a *file* fails after the temp
        // write; the temp must be removed.
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, "x").unwrap();
        let target = blocker.join("auth.json");
        assert!(write_atomic(&target, b"data").is_err());
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp."))
            .collect();
        assert!(leftovers.is_empty(), "failed writes must not leak temp files: {leftovers:?}");
    }

    #[test]
    fn read_json_object_missing_file_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let map = read_json_object_for_update(&dir.path().join("auth.json")).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn read_json_object_empty_file_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, "  \n").unwrap();
        assert!(read_json_object_for_update(&path).unwrap().is_empty());
    }

    #[test]
    fn read_json_object_parses_valid_map() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, r#"{"openai":{"type":"api_key","key":"sk-x"}}"#).unwrap();
        let map = read_json_object_for_update(&path).unwrap();
        assert!(map.contains_key("openai"));
    }

    /// The defect this helper exists for: a corrupt auth.json must error out,
    /// not silently become `{}` and wipe every stored credential on write-back.
    #[test]
    fn read_json_object_corrupt_file_errors_instead_of_defaulting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, r#"{"anthropic":{"type":"oauth","refresh":"tok"#).unwrap();
        let err = read_json_object_for_update(&path).unwrap_err();
        assert!(err.to_string().contains("auth.json"), "error must name the file: {err}");
        // And the file itself is untouched.
        assert!(std::fs::read_to_string(&path).unwrap().starts_with(r#"{"anthropic""#));
    }

    #[test]
    fn read_json_object_non_object_errors() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, "[1,2,3]").unwrap();
        assert!(read_json_object_for_update(&path).is_err());
    }

    #[test]
    fn is_ignored_dir_matches_known_dirs() {
        assert!(is_ignored_dir("node_modules"));
        assert!(is_ignored_dir(".git"));
        assert!(is_ignored_dir("target"));
        assert!(is_ignored_dir("dist"));
        assert!(is_ignored_dir("__pycache__"));
    }

    #[test]
    fn is_ignored_dir_rejects_normal_dirs() {
        assert!(!is_ignored_dir("src"));
        assert!(!is_ignored_dir("lib"));
        assert!(!is_ignored_dir("components"));
    }

    #[test]
    fn detect_framework_rust() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "[package]").unwrap();
        assert_eq!(detect_framework(dir.path()), Some("rust"));
    }

    #[test]
    fn detect_framework_react_from_package_json() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("package.json"), r#"{"dependencies":{"react":"^18"}}"#).unwrap();
        assert_eq!(detect_framework(dir.path()), Some("react"));
    }

    #[test]
    fn detect_framework_nextjs_config() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("next.config.js"), "module.exports = {}").unwrap();
        assert_eq!(detect_framework(dir.path()), Some("nextjs"));
    }

    #[test]
    fn detect_framework_typescript() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("package.json"), r#"{"name":"app"}"#).unwrap();
        std::fs::write(dir.path().join("tsconfig.json"), "{}").unwrap();
        assert_eq!(detect_framework(dir.path()), Some("typescript"));
    }

    #[test]
    fn detect_framework_javascript_fallback() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("package.json"), r#"{"name":"app"}"#).unwrap();
        assert_eq!(detect_framework(dir.path()), Some("javascript"));
    }

    #[test]
    fn detect_framework_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(detect_framework(dir.path()), None);
    }

    #[test]
    fn find_favicon_in_root() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("favicon.ico"), [0u8; 4]).unwrap();
        let result = find_favicon_in(dir.path());
        assert!(result.is_some());
        assert!(result.unwrap().ends_with("favicon.ico"));
    }

    #[test]
    fn detect_project_icon_favicon_over_framework() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "[package]").unwrap();
        std::fs::write(dir.path().join("favicon.ico"), [0u8; 4]).unwrap();
        let result = detect_project_icon(dir.path().to_string_lossy().to_string());
        assert!(result.is_some());
        assert_eq!(result.unwrap().icon_type, "favicon");
    }

    #[test]
    fn detect_project_icon_public_favicon() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("public")).unwrap();
        std::fs::write(dir.path().join("public").join("favicon.ico"), [0u8; 4]).unwrap();
        let result = detect_project_icon(dir.path().to_string_lossy().to_string());
        assert!(result.is_some());
        assert_eq!(result.unwrap().icon_type, "favicon");
    }

    #[test]
    fn detect_project_icon_framework_fallback() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("go.mod"), "module example").unwrap();
        let result = detect_project_icon(dir.path().to_string_lossy().to_string());
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.icon_type, "framework");
        assert_eq!(info.value, "go");
    }

    #[test]
    fn find_favicon_svg_preferred() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("favicon.svg"), "<svg></svg>").unwrap();
        std::fs::write(dir.path().join("favicon.ico"), [0u8; 4]).unwrap();
        let result = find_favicon_in(dir.path());
        assert!(result.is_some());
        assert!(result.unwrap().ends_with("favicon.svg"));
    }

    #[test]
    fn find_favicon_icon_svg_nextjs() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("icon.svg"), "<svg></svg>").unwrap();
        let result = find_favicon_in(dir.path());
        assert!(result.is_some());
        assert!(result.unwrap().ends_with("icon.svg"));
    }

    #[test]
    fn extract_icon_from_html_link_tag() {
        let dir = tempfile::tempdir().unwrap();
        let html = r#"<!DOCTYPE html><html><head><link rel="icon" href="/brand/logo.svg"></head></html>"#;
        std::fs::write(dir.path().join("index.html"), html).unwrap();
        std::fs::create_dir_all(dir.path().join("public").join("brand")).unwrap();
        std::fs::write(dir.path().join("public").join("brand").join("logo.svg"), "<svg></svg>").unwrap();
        let result = extract_icon_from_html(dir.path(), &dir.path().join("index.html"));
        assert!(result.is_some());
        assert!(result.unwrap().to_string_lossy().contains("logo.svg"));
    }

    #[test]
    fn extract_href_value_double_quotes() {
        assert_eq!(extract_href_value(r#"<link rel="icon" href="/icon.png">"#), Some("/icon.png".to_string()));
    }

    #[test]
    fn extract_href_value_single_quotes() {
        assert_eq!(extract_href_value("<link rel='icon' href='/icon.svg'>"), Some("/icon.svg".to_string()));
    }

    #[test]
    fn extract_href_value_strips_query_params() {
        assert_eq!(extract_href_value(r#"<link href="/icon.png?v=2" rel="icon">"#), Some("/icon.png".to_string()));
    }

    #[test]
    fn detect_project_icon_idea_icon() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".idea")).unwrap();
        std::fs::write(dir.path().join(".idea").join("icon.svg"), "<svg></svg>").unwrap();
        let result = detect_project_icon(dir.path().to_string_lossy().to_string());
        assert!(result.is_some());
        assert_eq!(result.unwrap().icon_type, "favicon");
    }
}
