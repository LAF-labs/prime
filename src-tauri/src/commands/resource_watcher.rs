use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Payload emitted to the frontend when .agent files change.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentResourcesChanged {
    /// The project path whose .agent changed, or null for global ~/.agent
    project_path: Option<String>,
}

type Debouncer = notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>;

/// Maximum number of concurrent project watchers to prevent leaks.
const MAX_PROJECT_WATCHERS: usize = 5;

/// Subdirectories inside .agent that contain config we care about.
/// We watch these individually (non-recursive) instead of the entire
/// .agent tree to avoid tracking node_modules inside skills, etc.
const WATCHED_SUBDIRS: &[&str] = &["agents", "skills", "steering", "settings"];

/// Holds active file watchers keyed by the .agent directory path.
/// Each entry owns one debouncer that watches multiple subdirs.
pub struct ResourceWatcherState {
    watchers: Mutex<HashMap<PathBuf, Debouncer>>,
}

impl Default for ResourceWatcherState {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

/// Start watching the global ~/.agent directory. Called once at app setup.
pub fn watch_global_resources(app: &AppHandle) {
    let Some(home) = dirs::home_dir() else { return };
    let global_dir = home.join(".prime").join("agent");
    if !global_dir.is_dir() {
        return;
    }
    let state = app.state::<ResourceWatcherState>();
    start_watcher(&state, &global_dir, None, app.clone());
}

/// Start watching a project's .agent directory.
///
/// Known limitation, on purpose: if `.prime/agent` does not exist yet, this
/// is a no-op — we do not create directories inside the user's project as a
/// side effect of opening it, and `notify` cannot watch a path that isn't
/// there. A `.prime/agent` created later is picked up on the next call (the
/// frontend re-invokes this on project activation and on resource refresh).
#[tauri::command]
pub fn watch_resource_path(path: String, app: AppHandle) {
    let agent_dir = PathBuf::from(&path).join(".prime").join("agent");
    if !agent_dir.is_dir() {
        log::info!(
            "[resource-watcher] no .prime/agent under this project yet — not watching (re-checked on next activation)"
        );
        return;
    }
    let state = app.state::<ResourceWatcherState>();
    // The project-watcher cap is enforced inside start_watcher, under the
    // same lock acquisition that inserts the new watcher — checking it here
    // and re-locking there let concurrent calls race past the cap.
    start_watcher(&state, &agent_dir, Some(path), app.clone());
}

/// Stop watching a project's .agent directory.
#[tauri::command]
pub fn unwatch_resource_path(path: String, app: AppHandle) {
    let agent_dir = PathBuf::from(&path).join(".prime").join("agent");
    let state = app.state::<ResourceWatcherState>();
    let mut watchers = state.watchers.lock();
    if watchers.remove(&agent_dir).is_some() {
        log::info!("Stopped watching {}", agent_dir.display());
    }
}

/// Stop all watchers. Called during app shutdown.
pub fn stop_all(app: &AppHandle) {
    if let Some(state) = app.try_state::<ResourceWatcherState>() {
        let mut watchers = state.watchers.lock();
        let count = watchers.len();
        watchers.clear();
        if count > 0 {
            log::info!("Stopped {} agent watcher(s)", count);
        }
    }
}

fn start_watcher(
    state: &ResourceWatcherState,
    agent_dir: &Path,
    project_path: Option<String>,
    app: AppHandle,
) {
    let mut watchers = state.watchers.lock();
    if watchers.contains_key(agent_dir) {
        return;
    }
    // Cap check and insert happen under this one lock acquisition so
    // concurrent calls cannot both observe "one slot left" and both insert.
    // The global ~/.prime/agent watcher does not count toward the limit.
    if project_path.is_some() {
        let home_agent = dirs::home_dir().map(|h| h.join(".prime").join("agent"));
        let project_count = watchers.keys()
            .filter(|k| home_agent.as_ref().map_or(true, |g| *k != g))
            .count();
        if project_count >= MAX_PROJECT_WATCHERS {
            log::warn!(
                "Max project watchers ({}) reached, skipping {}",
                MAX_PROJECT_WATCHERS,
                agent_dir.display()
            );
            return;
        }
    }
    let app_handle = app.clone();
    let project = Arc::new(project_path);
    let debouncer = new_debouncer(Duration::from_millis(500), move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
        let Ok(events) = result else { return };
        if !events.iter().any(|e| e.kind == DebouncedEventKind::Any) {
            return;
        }
        let payload = AgentResourcesChanged {
            project_path: (*project).clone(),
        };
        log::debug!("Agent config changed: {:?}", payload.project_path);
        let _ = app_handle.emit("agent-resources-changed", payload);
    });
    match debouncer {
        Ok(mut watcher) => {
            let mut watched = 0;
            // Watch the .agent root itself (for root-level .md steering files)
            if watcher.watcher().watch(agent_dir, notify::RecursiveMode::NonRecursive).is_ok() {
                watched += 1;
            }
            // Watch each relevant subdir non-recursively
            for subdir in WATCHED_SUBDIRS {
                let path = agent_dir.join(subdir);
                if path.is_dir() {
                    if watcher.watcher().watch(&path, notify::RecursiveMode::NonRecursive).is_ok() {
                        watched += 1;
                    }
                }
            }
            if watched == 0 {
                log::warn!("No watchable subdirs in {}", agent_dir.display());
                return;
            }
            log::info!("Watching {} ({} paths)", agent_dir.display(), watched);
            watchers.insert(agent_dir.to_path_buf(), watcher);
        }
        Err(e) => {
            log::error!("Failed to create watcher for {}: {}", agent_dir.display(), e);
        }
    }
}
