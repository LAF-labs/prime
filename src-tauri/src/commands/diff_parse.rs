//! Structured diff representation.
//! (`crates/buffer_diff/src/buffer_diff.rs`).
//!
//! The renderer currently consumes a raw unified-diff string from `task_diff`
//! and re-parses it with `@pierre/diffs` to extract per-file hunks. That parse
//! happens on the render thread on every refresh.
//!
//! This module exposes the same data the renderer needs, but built directly
//! from libgit2's diff stream — no string-roundtrip required. The resulting
//! shape mirrors `parsePatchFiles`'s output so the renderer can swap it in
//! field-for-field and stop loading `@pierre/diffs` for parsing.

use git2::{DiffOptions, Repository};
use serde::Serialize;

use super::acp::AcpState;
use super::error::AppError;

// ── Public types ─────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineKind {
    Context,
    Addition,
    Deletion,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffLineKind,
    /// 1-based line number in the *old* file. `None` for additions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_lineno: Option<u32>,
    /// 1-based line number in the *new* file. `None` for deletions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_lineno: Option<u32>,
    pub content: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// Optional section header (the `@@ … @@ <header>` text).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    pub addition_lines: u32,
    pub deletion_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChange,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// Path in the new tree (or old tree for deletions).
    pub path: String,
    /// Original path for renames/copies.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub change: FileChangeKind,
    /// True when the file is binary (no per-line diff is emitted).
    pub binary: bool,
    pub addition_lines: u32,
    pub deletion_lines: u32,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDiff {
    pub files: Vec<FileDiff>,
    pub total_additions: u32,
    pub total_deletions: u32,
}

// ── Diff walker ──────────────────────────────────────────────────────────────

fn change_kind(status: git2::Delta) -> FileChangeKind {
    match status {
        git2::Delta::Added => FileChangeKind::Added,
        git2::Delta::Deleted => FileChangeKind::Deleted,
        git2::Delta::Renamed => FileChangeKind::Renamed,
        git2::Delta::Copied => FileChangeKind::Copied,
        git2::Delta::Typechange => FileChangeKind::TypeChange,
        _ => FileChangeKind::Modified,
    }
}

/// Walk a libgit2 `Diff` and produce a `ParsedDiff`. Files are grouped by
/// delta index; hunks and lines are appended in the order libgit2 emits them.
fn parse_git_diff(diff: &git2::Diff<'_>) -> Result<ParsedDiff, AppError> {
    use std::cell::RefCell;
    // git2's `foreach` takes four independent `FnMut` closures, each requiring
    // exclusive `&mut` access. Wrap the shared state in a `RefCell` so the
    // borrow checker is happy without cloning per event.
    let files: RefCell<Vec<FileDiff>> = RefCell::new(Vec::new());

    diff.foreach(
        &mut |delta, _progress| {
            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let old_path_str = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned());
            let path = if !new_path.is_empty() {
                new_path
            } else {
                old_path_str.clone().unwrap_or_default()
            };
            let kind = change_kind(delta.status());
            let old_path = match kind {
                FileChangeKind::Renamed | FileChangeKind::Copied => old_path_str,
                _ => None,
            };
            files.borrow_mut().push(FileDiff {
                path,
                old_path,
                change: kind,
                binary: delta.flags().contains(git2::DiffFlags::BINARY),
                addition_lines: 0,
                deletion_lines: 0,
                hunks: Vec::new(),
            });
            true
        },
        None, // binary callback: skipped, we already mark binary via flags
        Some(&mut |_delta, hunk| {
            // git2 fires the file callback before its hunks, so the *last*
            // file in `files` is always the current one.
            let mut files = files.borrow_mut();
            if let Some(file) = files.last_mut() {
                let header = std::str::from_utf8(hunk.header()).ok().and_then(|h| {
                    // Strip the leading "@@ … @@ " prefix; keep just the
                    // section title libgit2 stuffed in (e.g. function name).
                    let trimmed = h.trim_end_matches('\n');
                    let parts: Vec<&str> = trimmed.splitn(3, "@@").collect();
                    parts.get(2).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
                });
                file.hunks.push(DiffHunk {
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    header,
                    addition_lines: 0,
                    deletion_lines: 0,
                    lines: Vec::new(),
                });
            }
            true
        }),
        Some(&mut |_delta, _hunk_opt, line| {
            let mut files = files.borrow_mut();
            let Some(file) = files.last_mut() else { return true };
            let Some(current_hunk) = file.hunks.last_mut() else { return true };

            let kind = match line.origin() {
                '+' => DiffLineKind::Addition,
                '-' => DiffLineKind::Deletion,
                ' ' => DiffLineKind::Context,
                // Skip file-header / hunk-header / context-no-newline markers.
                _ => return true,
            };
            let content = std::str::from_utf8(line.content()).unwrap_or("").to_string();
            let old_lineno = line.old_lineno();
            let new_lineno = line.new_lineno();
            match kind {
                DiffLineKind::Addition => {
                    current_hunk.addition_lines += 1;
                    file.addition_lines += 1;
                }
                DiffLineKind::Deletion => {
                    current_hunk.deletion_lines += 1;
                    file.deletion_lines += 1;
                }
                DiffLineKind::Context => {}
            }
            current_hunk.lines.push(DiffLine {
                kind,
                old_lineno,
                new_lineno,
                content,
            });
            true
        }),
    )?;

    let files = files.into_inner();
    let total_additions = files.iter().map(|f| f.addition_lines).sum();
    let total_deletions = files.iter().map(|f| f.deletion_lines).sum();
    Ok(ParsedDiff {
        files,
        total_additions,
        total_deletions,
    })
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Combined staged + unstaged diff, structured as `ParsedDiff`. This is the
/// replacement for the renderer's `parsePatchFiles(getTaskDiff(taskId))` call.
#[tauri::command]
pub fn task_diff_structured(
    state: tauri::State<'_, AcpState>,
    task_id: String,
) -> Result<ParsedDiff, AppError> {
    let cwd = {
        let tasks = state.tasks.lock();
        tasks
            .get(&task_id)
            .map(|t| t.workspace.clone())
            .ok_or_else(|| AppError::TaskNotFound(task_id.clone()))?
    };
    let repo = Repository::open(&cwd)?;
    let mut opts = DiffOptions::new();
    opts.context_lines(3);

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut combined = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?;
    let unstaged = repo.diff_index_to_workdir(None, Some(&mut opts))?;
    combined.merge(&unstaged)?;
    parse_git_diff(&combined)
}

/// Same shape as `task_diff_structured` but addressed by raw workspace path.
#[tauri::command]
pub fn git_diff_structured(cwd: String) -> Result<ParsedDiff, AppError> {
    let repo = Repository::open(&cwd)?;
    let mut opts = DiffOptions::new();
    opts.context_lines(3);

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut combined = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?;
    let unstaged = repo.diff_index_to_workdir(None, Some(&mut opts))?;
    combined.merge(&unstaged)?;
    parse_git_diff(&combined)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn change_kind_maps_status() {
        assert_eq!(change_kind(git2::Delta::Added), FileChangeKind::Added);
        assert_eq!(change_kind(git2::Delta::Deleted), FileChangeKind::Deleted);
        assert_eq!(change_kind(git2::Delta::Modified), FileChangeKind::Modified);
        assert_eq!(change_kind(git2::Delta::Renamed), FileChangeKind::Renamed);
        assert_eq!(change_kind(git2::Delta::Untracked), FileChangeKind::Modified);
    }

    fn init_repo_with_initial_commit(dir: &std::path::Path, content: &str) -> Repository {
        let repo = Repository::init(dir).unwrap();
        // Configure user
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.email", "test@example.com").unwrap();
            cfg.set_str("user.name", "test").unwrap();
        }

        std::fs::write(dir.join("hello.txt"), content).unwrap();
        let tree_id = {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("hello.txt")).unwrap();
            index.write().unwrap();
            index.write_tree().unwrap()
        };
        {
            let tree = repo.find_tree(tree_id).unwrap();
            let sig = repo.signature().unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        }
        repo
    }

    #[test]
    fn parses_modification() {
        let dir = tempfile::tempdir().unwrap();
        let repo = init_repo_with_initial_commit(dir.path(), "line one\nline two\nline three\n");

        // Modify the working copy
        std::fs::write(dir.path().join("hello.txt"), "line one\nLINE TWO\nline three\n").unwrap();

        let mut opts = DiffOptions::new();
        let head_tree = repo.head().unwrap().peel_to_tree().unwrap();
        let diff = repo
            .diff_tree_to_workdir(Some(&head_tree), Some(&mut opts))
            .unwrap();
        let parsed = parse_git_diff(&diff).unwrap();

        assert_eq!(parsed.files.len(), 1);
        let file = &parsed.files[0];
        assert_eq!(file.path, "hello.txt");
        assert_eq!(file.change, FileChangeKind::Modified);
        assert_eq!(file.addition_lines, 1);
        assert_eq!(file.deletion_lines, 1);
        assert!(!file.hunks.is_empty());
        let total_lines: usize = file.hunks.iter().map(|h| h.lines.len()).sum();
        assert!(total_lines >= 3, "expected at least 3 hunk lines");
    }

    #[test]
    fn parses_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let repo = init_repo_with_initial_commit(dir.path(), "x\n");

        std::fs::write(dir.path().join("new.txt"), "alpha\nbeta\n").unwrap();
        // Stage so it shows up
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("new.txt")).unwrap();
        index.write().unwrap();

        let head_tree = repo.head().unwrap().peel_to_tree().unwrap();
        let diff = repo
            .diff_tree_to_index(Some(&head_tree), None, None)
            .unwrap();
        let parsed = parse_git_diff(&diff).unwrap();

        let new_file = parsed.files.iter().find(|f| f.path == "new.txt").unwrap();
        assert_eq!(new_file.change, FileChangeKind::Added);
        assert_eq!(new_file.deletion_lines, 0);
        assert!(new_file.addition_lines >= 2);
    }

    #[test]
    fn empty_diff_yields_empty_parsed() {
        let dir = tempfile::tempdir().unwrap();
        let repo = init_repo_with_initial_commit(dir.path(), "stable\n");

        let head_tree = repo.head().unwrap().peel_to_tree().unwrap();
        let diff = repo.diff_tree_to_workdir(Some(&head_tree), None).unwrap();
        let parsed = parse_git_diff(&diff).unwrap();
        assert!(parsed.files.is_empty());
        assert_eq!(parsed.total_additions, 0);
        assert_eq!(parsed.total_deletions, 0);
    }
}
