use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Payload emitted to the frontend when .kiro files change.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct KiroConfigChanged {
    /// The project path whose .kiro changed, or null for global ~/.kiro
    project_path: Option<String>,
}

type Debouncer = notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>;

/// Maximum number of concurrent project watchers to prevent leaks.
const MAX_PROJECT_WATCHERS: usize = 5;

/// Subdirectories inside .kiro that contain config we care about.
/// We watch these individually (non-recursive) instead of the entire
/// .kiro tree to avoid tracking node_modules inside skills, etc.
const WATCHED_SUBDIRS: &[&str] = &["agents", "skills", "steering", "settings"];

/// Holds active file watchers keyed by the .kiro directory path.
/// Each entry owns one debouncer that watches multiple subdirs.
pub struct KiroWatcherState {
    watchers: Mutex<HashMap<PathBuf, Debouncer>>,
}

impl Default for KiroWatcherState {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

/// Start watching the global ~/.kiro directory. Called once at app setup.
pub fn watch_global_kiro(app: &AppHandle) {
    let Some(home) = dirs::home_dir() else { return };
    let global_kiro = home.join(".kiro");
    if !global_kiro.is_dir() {
        return;
    }
    let state = app.state::<KiroWatcherState>();
    start_watcher(&state, &global_kiro, None, app.clone());
}

/// Start watching a project's .kiro directory.
#[tauri::command]
pub fn watch_kiro_path(path: String, app: AppHandle) {
    let kiro_dir = PathBuf::from(&path).join(".kiro");
    if !kiro_dir.is_dir() {
        return;
    }
    let state = app.state::<KiroWatcherState>();
    // Enforce max project watchers (global watcher doesn't count toward limit)
    {
        let watchers = state.watchers.lock();
        let home_kiro = dirs::home_dir().map(|h| h.join(".kiro"));
        let project_count = watchers.keys()
            .filter(|k| home_kiro.as_ref().map_or(true, |g| *k != g))
            .count();
        if project_count >= MAX_PROJECT_WATCHERS {
            log::warn!("Max project watchers ({}) reached, skipping {}", MAX_PROJECT_WATCHERS, kiro_dir.display());
            return;
        }
    }
    start_watcher(&state, &kiro_dir, Some(path), app.clone());
}

/// Stop watching a project's .kiro directory.
#[tauri::command]
pub fn unwatch_kiro_path(path: String, app: AppHandle) {
    let kiro_dir = PathBuf::from(&path).join(".kiro");
    let state = app.state::<KiroWatcherState>();
    let mut watchers = state.watchers.lock();
    if watchers.remove(&kiro_dir).is_some() {
        log::info!("Stopped watching {}", kiro_dir.display());
    }
}

/// Stop all watchers. Called during app shutdown.
pub fn stop_all(app: &AppHandle) {
    if let Some(state) = app.try_state::<KiroWatcherState>() {
        let mut watchers = state.watchers.lock();
        let count = watchers.len();
        watchers.clear();
        if count > 0 {
            log::info!("Stopped {} kiro watcher(s)", count);
        }
    }
}

fn start_watcher(
    state: &KiroWatcherState,
    kiro_dir: &Path,
    project_path: Option<String>,
    app: AppHandle,
) {
    let mut watchers = state.watchers.lock();
    if watchers.contains_key(kiro_dir) {
        return;
    }
    let app_handle = app.clone();
    let project = Arc::new(project_path);
    let debouncer = new_debouncer(Duration::from_millis(500), move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
        let Ok(events) = result else { return };
        if !events.iter().any(|e| e.kind == DebouncedEventKind::Any) {
            return;
        }
        let payload = KiroConfigChanged {
            project_path: (*project).clone(),
        };
        log::debug!("Kiro config changed: {:?}", payload.project_path);
        let _ = app_handle.emit("kiro-config-changed", payload);
    });
    match debouncer {
        Ok(mut watcher) => {
            use notify::Watcher;
            let mut watched = 0;
            // Watch the .kiro root itself (for root-level .md steering files)
            if watcher.watcher().watch(kiro_dir, notify::RecursiveMode::NonRecursive).is_ok() {
                watched += 1;
            }
            // Watch each relevant subdir non-recursively
            for subdir in WATCHED_SUBDIRS {
                let path = kiro_dir.join(subdir);
                if path.is_dir() {
                    if watcher.watcher().watch(&path, notify::RecursiveMode::NonRecursive).is_ok() {
                        watched += 1;
                    }
                }
            }
            if watched == 0 {
                log::warn!("No watchable subdirs in {}", kiro_dir.display());
                return;
            }
            log::info!("Watching {} ({} paths)", kiro_dir.display(), watched);
            watchers.insert(kiro_dir.to_path_buf(), watcher);
        }
        Err(e) => {
            log::error!("Failed to create watcher for {}: {}", kiro_dir.display(), e);
        }
    }
}
