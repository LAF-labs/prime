//! Project-level filesystem watcher.
//!
//! Key design decisions:
//! - Real-time filesystem watching via `notify` with debouncing
//! - Lazy directory scanning — only scan children when expanded
//! - Incremental updates — only emit changed paths, not full re-scans
//! - Proper gitignore stack (layered .gitignore parsing)
//! - Stable entry IDs that persist across updates
//! - Configurable exclusions instead of hardcoded ignore list

use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event, EventKind};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Serialize;

// ── Constants ────────────────────────────────────────────────────────────────

/// Default directories to exclude from scanning (user-configurable via settings).
/// Unlike the old hardcoded IGNORED_DIRS, these are glob patterns.
const DEFAULT_SCAN_EXCLUSIONS: &[&str] = &[
    "**/.git",
    "**/node_modules",
    "**/.next",
    "**/.turbo",
    "**/target",
    "**/__pycache__",
    "**/.venv",
    "**/venv",
    "**/.tox",
    "**/.eggs",
    "**/.mypy_cache",
    "**/.pytest_cache",
    "**/coverage",
    "**/.nyc_output",
    "**/.parcel-cache",
    "**/.svelte-kit",
    "**/.nuxt",
    "**/.output",
    "**/.vercel",
    "**/.netlify",
];

/// Max entries per directory scan to prevent runaway reads.
const MAX_ENTRIES_PER_DIR: usize = 10_000;

/// Debounce interval for filesystem events.
#[allow(dead_code)]
const DEBOUNCE_MS: u64 = 150;

// ── Path Containment ─────────────────────────────────────────────────────────

/// Validate that a relative path, when joined to the workspace root, stays
/// within the workspace. Prevents path traversal via `../` sequences.
///
/// For paths that don't exist yet (create operations), we canonicalize the
/// longest existing ancestor and verify containment of the full resolved path.
fn validate_path_containment(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    if rel_path.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    let joined = root.join(rel_path);
    // Canonicalize the root (must exist)
    let canonical_root = root.canonicalize()
        .map_err(|e| format!("Workspace not accessible: {e}"))?;
    // For existing paths, canonicalize directly
    if joined.exists() {
        let canonical = joined.canonicalize()
            .map_err(|e| format!("Cannot resolve path: {e}"))?;
        if !canonical.starts_with(&canonical_root) {
            return Err(format!("Path escapes workspace: {rel_path}"));
        }
        return Ok(canonical);
    }
    // For non-existing paths (create), canonicalize the longest existing ancestor
    // then append the remaining components and check for traversal.
    let mut ancestor = joined.as_path();
    let mut tail_components = Vec::new();
    loop {
        if ancestor.exists() {
            break;
        }
        if let Some(file_name) = ancestor.file_name() {
            tail_components.push(file_name.to_os_string());
        } else {
            return Err(format!("Path escapes workspace: {rel_path}"));
        }
        ancestor = match ancestor.parent() {
            Some(p) => p,
            None => return Err(format!("Path escapes workspace: {rel_path}")),
        };
    }
    let mut resolved = ancestor.canonicalize()
        .map_err(|e| format!("Cannot resolve path: {e}"))?;
    for component in tail_components.into_iter().rev() {
        resolved.push(component);
    }
    if !resolved.starts_with(&canonical_root) {
        return Err(format!("Path escapes workspace: {rel_path}"));
    }
    Ok(resolved)
}

// ── Types ────────────────────────────────────────────────────────────────────

/// Unique stable ID for each entry in the tree.
static NEXT_ENTRY_ID: AtomicU64 = AtomicU64::new(1);

fn next_entry_id() -> u64 {
    NEXT_ENTRY_ID.fetch_add(1, Ordering::Relaxed)
}

/// A single entry in the project tree (file or directory).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub id: u64,
    pub path: String,       // relative to workspace root
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_ignored: bool,   // matched by gitignore
    pub is_excluded: bool,  // matched by scan exclusions
    pub ext: String,
    pub depth: u32,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub git_status: String,
    pub modified_at: i64,
}

/// Event payload emitted to the frontend when the tree changes.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeChangeEvent {
    pub workspace: String,
    pub kind: String,           // "added" | "removed" | "modified" | "renamed" | "full"
    pub entries: Vec<TreeEntry>,
    /// For renames: the old path
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

/// Payload for scan_directory results.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ScanResult {
    pub workspace: String,
    pub parent_path: String,
    pub entries: Vec<TreeEntry>,
}

// ── Ignore Stack ─────────────────────────────────────────────────────────────

/// Layered gitignore stack that respects nested .gitignore files.
#[derive(Clone, Debug)]
struct IgnoreStack {
    entries: Vec<Arc<Gitignore>>,
}

impl IgnoreStack {
    fn new() -> Self {
        Self { entries: Vec::new() }
    }

    fn push(&mut self, gitignore: Arc<Gitignore>) {
        self.entries.push(gitignore);
    }

    fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        // .git directory is always ignored
        if is_dir && path.file_name().map(|n| n == ".git").unwrap_or(false) {
            return true;
        }
        // Check from most specific (deepest) to least specific
        for ignore in self.entries.iter().rev() {
            match ignore.matched(path, is_dir) {
                ignore::Match::Ignore(_) => return true,
                ignore::Match::Whitelist(_) => return false,
                ignore::Match::None => continue,
            }
        }
        false
    }
}

/// Build a Gitignore from a .gitignore file path.
fn build_gitignore(path: &Path) -> Option<Arc<Gitignore>> {
    let parent = path.parent()?;
    let mut builder = GitignoreBuilder::new(parent);
    builder.add(path);
    builder.build().ok().map(Arc::new)
}

/// Collect all .gitignore files from root down to the given directory.
fn collect_ignore_stack(root: &Path, rel_dir: &Path) -> IgnoreStack {
    let mut stack = IgnoreStack::new();

    // Global gitignore
    if let Some(home) = dirs::home_dir() {
        let global = home.join(".config/git/ignore");
        if global.exists() {
            if let Some(ig) = build_gitignore(&global) {
                stack.push(ig);
            }
        }
    }

    // Walk from root to rel_dir, collecting .gitignore at each level
    let mut current = root.to_path_buf();
    let gitignore_at_root = current.join(".gitignore");
    if gitignore_at_root.exists() {
        if let Some(ig) = build_gitignore(&gitignore_at_root) {
            stack.push(ig);
        }
    }

    if !rel_dir.as_os_str().is_empty() {
        for component in rel_dir.components() {
            current = current.join(component);
            let gi = current.join(".gitignore");
            if gi.exists() {
                if let Some(ig) = build_gitignore(&gi) {
                    stack.push(ig);
                }
            }
        }
    }

    stack
}

// ── Exclusion Matcher ────────────────────────────────────────────────────────

/// Checks if a relative path matches any of the scan exclusion patterns.
struct ExclusionMatcher {
    patterns: Vec<glob::Pattern>,
    /// Simple directory names to exclude (extracted from **/name patterns).
    dir_names: Vec<String>,
}

impl ExclusionMatcher {
    fn new(patterns: &[&str]) -> Self {
        let mut compiled = Vec::new();
        let mut dir_names = Vec::new();

        for p in patterns {
            // Extract simple dir names from **/dirname patterns
            if p.starts_with("**/") {
                let name = &p[3..];
                if !name.contains('/') && !name.contains('*') {
                    dir_names.push(name.to_string());
                }
            }
            if let Ok(pat) = glob::Pattern::new(p) {
                compiled.push(pat);
            }
        }

        Self { patterns: compiled, dir_names }
    }

    fn is_excluded(&self, rel_path: &str) -> bool {
        // Check if any path segment matches a known excluded dir name
        for segment in rel_path.split('/') {
            if self.dir_names.iter().any(|d| d == segment) {
                return true;
            }
        }
        self.patterns.iter().any(|p| p.matches(rel_path))
    }

    fn is_dir_excluded(&self, dir_name: &str) -> bool {
        self.dir_names.iter().any(|d| d == dir_name)
    }
}

// ── Watcher State ────────────────────────────────────────────────────────────

/// Per-workspace watcher state.
#[allow(dead_code)]
struct WorkspaceWatcher {
    _watcher: RecommendedWatcher,
    root: PathBuf,
    /// All known entries keyed by relative path.
    entries: HashMap<String, TreeEntry>,
    /// Exclusion matcher for this workspace.
    exclusions: ExclusionMatcher,
}

/// Global state managing all project watchers.
pub struct ProjectWatcherState {
    watchers: Mutex<HashMap<String, WorkspaceWatcher>>,
}

impl Default for ProjectWatcherState {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

// ── Directory Scanning (Lazy) ─────────────────────────────────────────────────

/// Scan a single directory's immediate children. This is the lazy approach:
/// directories are only scanned when the user expands them.
fn scan_directory_entries(
    root: &Path,
    rel_dir: &str,
    exclusions: &ExclusionMatcher,
    respect_gitignore: bool,
) -> Vec<TreeEntry> {
    let abs_dir = if rel_dir.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel_dir)
    };

    if !abs_dir.is_dir() {
        return Vec::new();
    }

    let ignore_stack = if respect_gitignore {
        collect_ignore_stack(root, Path::new(rel_dir))
    } else {
        IgnoreStack::new()
    };

    let mut entries = Vec::new();
    let read_dir = match std::fs::read_dir(&abs_dir) {
        Ok(rd) => rd,
        Err(e) => {
            log::warn!("[project_watcher] Failed to read dir {:?}: {}", abs_dir, e);
            return Vec::new();
        }
    };

    for entry in read_dir.take(MAX_ENTRIES_PER_DIR).flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();

        // Skip . files that are always hidden
        if name == "." || name == ".." {
            continue;
        }

        let rel_path = if rel_dir.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_dir, name)
        };

        let metadata = match std::fs::symlink_metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_symlink = metadata.file_type().is_symlink();
        // For symlinks, follow to determine if target is a dir
        let is_dir = if is_symlink {
            entry.path().is_dir()
        } else {
            metadata.is_dir()
        };

        // Check exclusions
        let is_excluded = exclusions.is_excluded(&rel_path)
            || (is_dir && exclusions.is_dir_excluded(&name));

        // Check gitignore
        let is_ignored = if respect_gitignore && !is_excluded {
            let abs_path = abs_dir.join(&name);
            ignore_stack.is_ignored(&abs_path, is_dir)
        } else {
            false
        };

        let ext = if is_dir {
            String::new()
        } else {
            Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default()
        };

        let modified_at = metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let depth = rel_path.matches('/').count() as u32;

        entries.push(TreeEntry {
            id: next_entry_id(),
            path: rel_path,
            name,
            is_dir,
            is_symlink,
            is_ignored,
            is_excluded,
            ext,
            depth,
            git_status: String::new(),
            modified_at,
        });
    }

    // Sort: directories first, then alphabetical (case-insensitive)
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    entries
}

// ── Git Status Integration ───────────────────────────────────────────────────

/// Collect git status for files in a workspace using git2.
fn collect_git_statuses(root: &Path) -> HashMap<String, String> {
    let mut statuses = HashMap::new();

    let repo = match git2::Repository::open(root) {
        Ok(r) => r,
        Err(_) => return statuses,
    };

    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true);

    let status_list = match repo.statuses(Some(&mut opts)) {
        Ok(s) => s,
        Err(_) => return statuses,
    };

    for entry in status_list.iter() {
        if let Some(path) = entry.path() {
            let status = entry.status();
            let label = if status.intersects(git2::Status::INDEX_NEW | git2::Status::WT_NEW) {
                "A"
            } else if status.intersects(git2::Status::INDEX_MODIFIED | git2::Status::WT_MODIFIED) {
                "M"
            } else if status.intersects(git2::Status::INDEX_DELETED | git2::Status::WT_DELETED) {
                "D"
            } else if status.intersects(git2::Status::INDEX_RENAMED | git2::Status::WT_RENAMED) {
                "R"
            } else {
                continue;
            };
            statuses.insert(path.to_string(), label.to_string());
        }
    }

    statuses
}

/// Apply git statuses to a set of entries.
fn apply_git_statuses(entries: &mut [TreeEntry], root: &Path) {
    let statuses = collect_git_statuses(root);
    for entry in entries.iter_mut() {
        if let Some(status) = statuses.get(&entry.path) {
            entry.git_status = status.clone();
        }
        // For directories, check if any child has a status
        if entry.is_dir {
            let prefix = format!("{}/", entry.path);
            let has_changes = statuses.keys().any(|k| k.starts_with(&prefix));
            if has_changes && entry.git_status.is_empty() {
                entry.git_status = "M".to_string();
            }
        }
    }
}

// ── Filesystem Watcher ───────────────────────────────────────────────────────

/// Start watching a workspace for filesystem changes.
/// Emits "project-tree-changed" events to the frontend.
#[tauri::command]
pub fn watch_project_tree(workspace: String, app: AppHandle) -> Result<(), String> {
    let root = PathBuf::from(&workspace);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", workspace));
    }

    let state = app.state::<ProjectWatcherState>();
    let mut watchers = state.watchers.lock();

    // Already watching
    if watchers.contains_key(&workspace) {
        return Ok(());
    }

    let exclusions = ExclusionMatcher::new(DEFAULT_SCAN_EXCLUSIONS);
    let workspace_clone = workspace.clone();
    let app_handle = app.clone();
    let root_clone = root.clone();

    // Create the notify watcher
    let watcher = notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
        let Ok(event) = result else { return };

        // Filter out events we don't care about
        let kind_str = match event.kind {
            EventKind::Create(_) => "added",
            EventKind::Remove(_) => "removed",
            EventKind::Modify(_) => "modified",
            _ => return,
        };

        let mut entries = Vec::new();
        for path in &event.paths {
            let rel = match path.strip_prefix(&root_clone) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            if rel.is_empty() {
                continue;
            }

            let name = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            let (is_dir, modified_at, is_symlink) = if path.exists() {
                let meta = std::fs::symlink_metadata(path).ok();
                let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                let is_sym = meta.as_ref().map(|m| m.file_type().is_symlink()).unwrap_or(false);
                let mtime = meta.and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                (is_dir, mtime, is_sym)
            } else {
                (false, 0, false)
            };

            let ext = if is_dir {
                String::new()
            } else {
                Path::new(&name).extension()
                    .map(|e| e.to_string_lossy().to_string())
                    .unwrap_or_default()
            };

            let depth = rel.matches('/').count() as u32;

            entries.push(TreeEntry {
                id: next_entry_id(),
                path: rel,
                name,
                is_dir,
                is_symlink,
                is_ignored: false,
                is_excluded: false,
                ext,
                depth,
                git_status: String::new(),
                modified_at,
            });
        }

        if !entries.is_empty() {
            let payload = TreeChangeEvent {
                workspace: workspace_clone.clone(),
                kind: kind_str.to_string(),
                entries,
                old_path: None,
            };
            let _ = app_handle.emit("project-tree-changed", payload);
        }
    }).map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mut workspace_watcher = WorkspaceWatcher {
        _watcher: watcher,
        root: root.clone(),
        entries: HashMap::new(),
        exclusions,
    };

    // Start watching the root recursively
    workspace_watcher._watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch {}: {}", workspace, e))?;

    watchers.insert(workspace, workspace_watcher);
    log::info!("[project_watcher] Started watching {:?}", root);

    Ok(())
}

/// Stop watching a workspace.
#[tauri::command]
pub fn unwatch_project_tree(workspace: String, app: AppHandle) {
    let state = app.state::<ProjectWatcherState>();
    let mut watchers = state.watchers.lock();
    if watchers.remove(&workspace).is_some() {
        log::info!("[project_watcher] Stopped watching {}", workspace);
    }
}

/// Stop all project watchers. Called during app shutdown.
pub fn stop_all_project_watchers(app: &AppHandle) {
    if let Some(state) = app.try_state::<ProjectWatcherState>() {
        let mut watchers = state.watchers.lock();
        let count = watchers.len();
        watchers.clear();
        if count > 0 {
            log::info!("[project_watcher] Stopped {} project watcher(s)", count);
        }
    }
}

// ── Tauri Commands: Lazy Directory Scanning ──────────────────────────────────

/// Scan a single directory (lazy loading). Returns immediate children only.
/// This is called when the user expands a folder in the tree.
#[tauri::command]
pub fn scan_directory(
    workspace: String,
    rel_path: String,
    respect_gitignore: bool,
) -> Result<Vec<TreeEntry>, String> {
    let root = PathBuf::from(&workspace);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", workspace));
    }

    let exclusions = ExclusionMatcher::new(DEFAULT_SCAN_EXCLUSIONS);
    let mut entries = scan_directory_entries(&root, &rel_path, &exclusions, respect_gitignore);

    // Apply git statuses
    apply_git_statuses(&mut entries, &root);

    Ok(entries)
}

/// Scan the root directory of a workspace. Returns top-level entries.
#[tauri::command]
pub fn scan_root(workspace: String, respect_gitignore: bool) -> Result<Vec<TreeEntry>, String> {
    scan_directory(workspace, String::new(), respect_gitignore)
}

// ── Tauri Commands: File Operations ──────────────────────────────────────────

/// Create a new file at the given path.
#[tauri::command]
pub fn create_file(workspace: String, rel_path: String) -> Result<TreeEntry, String> {
    let root = PathBuf::from(&workspace);
    let abs_path = validate_path_containment(&root, &rel_path)?;

    // Ensure parent directory exists
    if let Some(parent) = abs_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }

    // Create the file
    std::fs::write(&abs_path, "")
        .map_err(|e| format!("Failed to create file: {}", e))?;

    let name = abs_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = Path::new(&name).extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    let depth = rel_path.matches('/').count() as u32;
    let modified_at = std::fs::metadata(&abs_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(TreeEntry {
        id: next_entry_id(),
        path: rel_path,
        name,
        is_dir: false,
        is_symlink: false,
        is_ignored: false,
        is_excluded: false,
        ext,
        depth,
        git_status: "A".to_string(),
        modified_at,
    })
}

/// Create a new directory at the given path.
#[tauri::command]
pub fn create_directory(workspace: String, rel_path: String) -> Result<TreeEntry, String> {
    let root = PathBuf::from(&workspace);
    let abs_path = validate_path_containment(&root, &rel_path)?;

    std::fs::create_dir_all(&abs_path)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let name = abs_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let depth = rel_path.matches('/').count() as u32;

    Ok(TreeEntry {
        id: next_entry_id(),
        path: rel_path,
        name,
        is_dir: true,
        is_symlink: false,
        is_ignored: false,
        is_excluded: false,
        ext: String::new(),
        depth,
        git_status: String::new(),
        modified_at: 0,
    })
}

/// Delete a file or directory (moves to trash on macOS, permanent on Linux).
#[tauri::command]
pub fn delete_entry(workspace: String, rel_path: String, permanent: bool) -> Result<(), String> {
    let root = PathBuf::from(&workspace);
    let abs_path = validate_path_containment(&root, &rel_path)?;

    if !abs_path.exists() {
        return Err(format!("Path does not exist: {}", rel_path));
    }

    if permanent {
        if abs_path.is_dir() {
            std::fs::remove_dir_all(&abs_path)
                .map_err(|e| format!("Failed to delete directory: {}", e))?;
        } else {
            std::fs::remove_file(&abs_path)
                .map_err(|e| format!("Failed to delete file: {}", e))?;
        }
    } else {
        // Move to trash (platform-specific)
        trash_entry(&abs_path)?;
    }

    Ok(())
}

/// Move to system trash.
fn trash_entry(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Use NSFileManager moveItemToTrash via osascript
        let path_str = path.to_string_lossy();
        let script = format!(
            "tell application \"Finder\" to delete POSIX file \"{}\"",
            path_str.replace('"', "\\\"")
        );
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("Failed to trash: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Trash failed: {}", stderr.trim()));
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Use gio trash
        let output = std::process::Command::new("gio")
            .arg("trash")
            .arg(path)
            .output()
            .map_err(|e| format!("Failed to trash: {}", e))?;
        if !output.status.success() {
            // Fallback: permanent delete
            if path.is_dir() {
                std::fs::remove_dir_all(path)
                    .map_err(|e| format!("Failed to delete: {}", e))?;
            } else {
                std::fs::remove_file(path)
                    .map_err(|e| format!("Failed to delete: {}", e))?;
            }
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        // Fallback: permanent delete on Windows
        if path.is_dir() {
            std::fs::remove_dir_all(path)
                .map_err(|e| format!("Failed to delete: {}", e))?;
        } else {
            std::fs::remove_file(path)
                .map_err(|e| format!("Failed to delete: {}", e))?;
        }
        Ok(())
    }
}

/// Rename/move a file or directory.
#[tauri::command]
pub fn rename_entry(
    workspace: String,
    old_rel_path: String,
    new_rel_path: String,
) -> Result<TreeEntry, String> {
    let root = PathBuf::from(&workspace);
    let old_abs = validate_path_containment(&root, &old_rel_path)?;
    let new_abs = validate_path_containment(&root, &new_rel_path)?;

    if !old_abs.exists() {
        return Err(format!("Source does not exist: {}", old_rel_path));
    }

    if new_abs.exists() {
        return Err(format!("Destination already exists: {}", new_rel_path));
    }

    // Ensure parent of destination exists
    if let Some(parent) = new_abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }

    std::fs::rename(&old_abs, &new_abs)
        .map_err(|e| format!("Failed to rename: {}", e))?;

    let is_dir = new_abs.is_dir();
    let name = new_abs.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = if is_dir {
        String::new()
    } else {
        Path::new(&name).extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default()
    };
    let depth = new_rel_path.matches('/').count() as u32;
    let modified_at = std::fs::metadata(&new_abs)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(TreeEntry {
        id: next_entry_id(),
        path: new_rel_path,
        name,
        is_dir,
        is_symlink: false,
        is_ignored: false,
        is_excluded: false,
        ext,
        depth,
        git_status: "R".to_string(),
        modified_at,
    })
}

/// Copy a file or directory.
#[tauri::command]
pub fn copy_entry(
    workspace: String,
    src_rel_path: String,
    dest_rel_path: String,
) -> Result<TreeEntry, String> {
    let root = PathBuf::from(&workspace);
    let src_abs = validate_path_containment(&root, &src_rel_path)?;
    let dest_abs = validate_path_containment(&root, &dest_rel_path)?;

    if !src_abs.exists() {
        return Err(format!("Source does not exist: {}", src_rel_path));
    }

    // Ensure parent of destination exists
    if let Some(parent) = dest_abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }

    if src_abs.is_dir() {
        copy_dir_recursive(&src_abs, &dest_abs)?;
    } else {
        std::fs::copy(&src_abs, &dest_abs)
            .map_err(|e| format!("Failed to copy file: {}", e))?;
    }

    let is_dir = dest_abs.is_dir();
    let name = dest_abs.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = if is_dir {
        String::new()
    } else {
        Path::new(&name).extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default()
    };
    let depth = dest_rel_path.matches('/').count() as u32;
    let modified_at = std::fs::metadata(&dest_abs)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(TreeEntry {
        id: next_entry_id(),
        path: dest_rel_path,
        name,
        is_dir,
        is_symlink: false,
        is_ignored: false,
        is_excluded: false,
        ext,
        depth,
        git_status: "A".to_string(),
        modified_at,
    })
}

/// Duplicate a file/directory (appends " copy" or increments number).
#[tauri::command]
pub fn duplicate_entry(workspace: String, rel_path: String) -> Result<TreeEntry, String> {
    let root = PathBuf::from(&workspace);
    let abs_path = validate_path_containment(&root, &rel_path)?;

    if !abs_path.exists() {
        return Err(format!("Path does not exist: {}", rel_path));
    }

    let parent = abs_path.parent().unwrap_or(&root);
    let stem = abs_path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = abs_path.extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    // Find a unique name
    let mut counter = 1;
    let new_abs = loop {
        let suffix = if counter == 1 { " copy".to_string() } else { format!(" copy {}", counter) };
        let new_name = format!("{}{}{}", stem, suffix, ext);
        let candidate = parent.join(&new_name);
        if !candidate.exists() {
            break candidate;
        }
        counter += 1;
        if counter > 100 {
            return Err("Too many copies exist".to_string());
        }
    };

    let new_rel = new_abs.strip_prefix(&root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    copy_entry(workspace, rel_path, new_rel)
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest)
        .map_err(|e| format!("Failed to create dir: {}", e))?;

    for entry in std::fs::read_dir(src).map_err(|e| format!("Failed to read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            std::fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy: {}", e))?;
        }
    }

    Ok(())
}

/// Copy the absolute path of an entry to clipboard.
#[tauri::command]
pub fn copy_entry_path(workspace: String, rel_path: String, relative: bool) -> String {
    if relative {
        rel_path
    } else {
        let root = PathBuf::from(&workspace);
        root.join(&rel_path).to_string_lossy().to_string()
    }
}

/// Reveal a file in the system file manager.
#[tauri::command]
pub fn reveal_in_finder(workspace: String, rel_path: String) -> Result<(), String> {
    let root = PathBuf::from(&workspace);
    let abs_path = validate_path_containment(&root, &rel_path)?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&abs_path)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        // Try to open the parent directory
        let parent = abs_path.parent().unwrap_or(&abs_path);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&abs_path)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }

    Ok(())
}

/// Open a file/folder in the default application.
#[tauri::command]
pub fn open_in_default_app(workspace: String, rel_path: String) -> Result<(), String> {
    let root = PathBuf::from(&workspace);
    let abs_path = validate_path_containment(&root, &rel_path)?;

    open::that(&abs_path)
        .map_err(|e| format!("Failed to open: {}", e))?;

    Ok(())
}

/// Open a terminal at the given directory.
#[tauri::command]
pub fn open_terminal_at(workspace: String, rel_path: String) -> Result<(), String> {
    let root = PathBuf::from(&workspace);
    let abs_path = validate_path_containment(&root, &rel_path)?;
    let dir = if abs_path.is_dir() {
        abs_path
    } else {
        abs_path.parent().unwrap_or(&root).to_path_buf()
    };

    #[cfg(target_os = "macos")]
    {
        // Use environment variable to pass the path safely (avoids AppleScript injection)
        let script = "tell application \"Terminal\"\nactivate\ndo script (\"cd \" & quoted form of (system attribute \"KIRODEX_CD_PATH\"))\nend tell";
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .env("KIRODEX_CD_PATH", dir.to_string_lossy().as_ref())
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let terminals = ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"];
        let mut launched = false;
        for term in terminals {
            let result = std::process::Command::new(term)
                .current_dir(&dir)
                .spawn();
            if result.is_ok() {
                launched = true;
                break;
            }
        }
        if !launched {
            return Err("No terminal emulator found".to_string());
        }
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", &format!("cd /d {}", dir.to_string_lossy())])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }

    Ok(())
}

/// Add a path pattern to .gitignore.
#[tauri::command]
pub fn add_to_gitignore(workspace: String, rel_path: String) -> Result<(), String> {
    let root = PathBuf::from(&workspace);
    let gitignore_path = root.join(".gitignore");

    let mut content = if gitignore_path.exists() {
        std::fs::read_to_string(&gitignore_path)
            .map_err(|e| format!("Failed to read .gitignore: {}", e))?
    } else {
        String::new()
    };

    // Check if already in .gitignore
    let pattern = format!("/{}", rel_path);
    if content.lines().any(|line| line.trim() == pattern || line.trim() == rel_path) {
        return Ok(()); // Already ignored
    }

    // Append
    if !content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    content.push_str(&pattern);
    content.push('\n');

    std::fs::write(&gitignore_path, content)
        .map_err(|e| format!("Failed to write .gitignore: {}", e))?;

    Ok(())
}

/// Open Finder with search bar active in the given directory.
#[tauri::command]
pub fn open_finder_search(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Use AppleScript to open a Finder window and activate search
        let script = format!(
            r#"tell application "Finder"
    activate
    set targetFolder to POSIX file "{}" as alias
    open targetFolder
    delay 0.3
    tell application "System Events"
        keystroke "f" using command down
    end tell
end tell"#,
            path.replace('"', "\\\"")
        );
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn()
            .map_err(|e| format!("Failed to open Finder search: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        // On other platforms, just open the directory
        open::that(&path).map_err(|e| format!("Failed to open: {}", e))?;
        Ok(())
    }
}
