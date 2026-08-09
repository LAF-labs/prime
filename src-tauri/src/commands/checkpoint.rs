//! Per-turn checkpointing via hidden git refs.
//!
//! Before each agent turn, the working tree is snapshotted into a commit that
//! only `refs/laf-agent/cp/{task_id}/{turn}` points at. The frontend can diff
//! between any two checkpoints to see what a turn changed, and restore the
//! files from one.
//!
//! # Why a real snapshot
//!
//! An earlier version pointed the ref at HEAD instead of snapshotting. Since
//! the agent edits without committing, HEAD does not move between turns — so
//! every checkpoint in a thread pointed at the same commit, and "revert to
//! turn 3" was indistinguishable from "revert to turn 7": both hard-reset to
//! HEAD and discarded every uncommitted change in the thread. The refs cost
//! nothing and bought nothing.
//!
//! # What the snapshot is, and is not
//!
//! The snapshot covers the working tree (tracked and untracked, honoring
//! `.gitignore`). Restoring it rewrites files and the index; it never moves
//! HEAD or rewrites history. If the agent committed during a turn, reverting
//! restores the files but leaves the commit — losing the user's commits to
//! undo an agent turn would be a worse trade than an extra `git reset` they
//! choose themselves.

use git2::{build::CheckoutBuilder, DiffOptions, Index, IndexAddOption, Oid, Repository, Tree};
use parking_lot::Mutex;
use serde::Serialize;

use super::rpc::AgentState;
use super::error::AppError;

/// Serializes snapshot index writes. The scratch index below is per-repo, and
/// two threads in the same workspace would otherwise race on its lock file.
static SNAPSHOT_LOCK: Mutex<()> = Mutex::new(());

/// A single checkpoint entry returned to the frontend.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    /// The turn number (monotonically increasing per task).
    pub turn: u32,
    /// The full ref name (e.g. `refs/laf-agent/cp/task-abc/3`).
    pub ref_name: String,
    /// The commit OID this ref points to.
    pub oid: String,
    /// Commit message of the referenced commit (for context).
    pub message: String,
    /// Unix timestamp (seconds) of the commit.
    pub timestamp: i64,
}

/// Diff stats between two checkpoints.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointDiff {
    pub from_turn: u32,
    pub to_turn: u32,
    pub additions: u32,
    pub deletions: u32,
    pub file_count: u32,
    /// Full unified diff patch text.
    pub patch: String,
    /// Per-file summary.
    pub files: Vec<CheckpointFileStat>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFileStat {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    pub status: String,
}

fn resolve_workspace(state: &AgentState, task_id: &str) -> Result<String, AppError> {
    let tasks = state.tasks.lock();
    tasks
        .get(task_id)
        .map(|t| t.workspace.clone())
        .ok_or_else(|| AppError::TaskNotFound(task_id.to_string()))
}

/// Ref prefix for all laf-agent checkpoints.
const REF_PREFIX: &str = "refs/laf-agent/cp/";

/// Where a pre-restore safety snapshot goes when git cannot stash (see
/// [`protect_before_restore`]). Deliberately outside [`REF_PREFIX`] so it never
/// shows up as a turn in [`checkpoint_list`].
const UNDO_PREFIX: &str = "refs/laf-agent/undo/";

/// Everything this module owns. Used by cleanup and pruning so no namespace we
/// write to can outlive its retention window.
const OWNED_PREFIX: &str = "refs/laf-agent/";

/// Scratch index used to build snapshot trees.
///
/// It lives inside `.git/` (never the workspace) and is deliberately persisted:
/// git's index caches per-file stat data, so reusing the same file means only
/// genuinely changed files get re-hashed. A fresh index every turn would
/// re-hash the entire tree each time.
fn snapshot_index_path(repo: &Repository) -> std::path::PathBuf {
    repo.path().join("laf-agent-snapshot-index")
}

/// Write the current working tree to a tree object without touching the user's
/// index or working tree. Honors `.gitignore`, so build output stays out.
fn write_workdir_tree(repo: &Repository) -> Result<Oid, AppError> {
    let _guard = SNAPSHOT_LOCK.lock();
    let mut index = Index::open(&snapshot_index_path(repo))?;
    // Associates the scratch index with this repo handle so `add_all` can see
    // the working directory. In-memory only — `.git/index` is never rewritten.
    repo.set_index(&mut index)?;
    // `add_all` stages additions and modifications; `update_all` is what drops
    // entries for files that were deleted since the last snapshot. Without the
    // second pass a deleted file would linger in every later snapshot.
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"].iter(), None)?;
    let tree_id = index.write_tree_to(repo)?;
    // Persisting only refreshes the stat cache for the next turn. A failure
    // costs speed, not correctness — the tree object is already written.
    if let Err(e) = index.write() {
        log::warn!("[checkpoint] snapshot index not persisted ({e}); next snapshot will be slower");
    }
    Ok(tree_id)
}

/// Whether checkpointing is available for a workspace — i.e. whether `cwd`
/// is inside a git repository. The frontend uses this to gate the per-message
/// rollback button.
#[tauri::command]
pub fn checkpoint_supported(cwd: String) -> bool {
    Repository::discover(&cwd).is_ok()
}

/// Snapshot the working tree at the given turn number.
///
/// Non-destructive: it writes a commit reachable only from the checkpoint ref
/// and never modifies the working tree, the index, HEAD, or any branch.
///
/// Async with the git2 work on the blocking pool: on Tauri v2 a sync command
/// runs on the main thread, and a full-tree snapshot of a large workspace
/// froze the UI for its duration.
#[tauri::command]
pub async fn checkpoint_create(
    state: tauri::State<'_, AgentState>,
    task_id: String,
    turn: u32,
) -> Result<Checkpoint, AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    tauri::async_runtime::spawn_blocking(move || create_snapshot(&cwd, &task_id, turn))
        .await
        .map_err(|e| AppError::Other(format!("checkpoint snapshot task failed: {e}")))?
}

/// Commit the current working tree and point `ref_name` at the result.
/// Reachable only from that ref — no branch moves, nothing is staged.
fn snapshot_to_ref(repo: &Repository, ref_name: &str, message: &str) -> Result<Oid, AppError> {
    let tree_id = write_workdir_tree(repo)?;
    let tree = repo.find_tree(tree_id)?;

    // Parent the snapshot on HEAD when there is one, so `git log` on the ref
    // reads as history rather than an orphan. A repo with no commits yet still
    // checkpoints — that is exactly when a rollback is most wanted.
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = head_commit.iter().collect();

    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("LAF Agent", "agent@local"))?;
    // `None` for the ref: committing to the ref directly would register it as a
    // branch tip in reflog terms. Create the commit, then move the ref.
    let oid = repo.commit(None, &sig, &sig, message, &tree, &parents)?;
    repo.reference(ref_name, oid, true, message)?;
    Ok(oid)
}

/// Workspace-addressed core of [`checkpoint_create`], split out so the snapshot
/// semantics can be tested against a real repo without Tauri managed state.
pub fn create_snapshot(cwd: &str, task_id: &str, turn: u32) -> Result<Checkpoint, AppError> {
    let repo = Repository::discover(cwd)?;
    let ref_name = format!("{REF_PREFIX}{task_id}/{turn}");
    let message = format!("LAF Agent checkpoint · turn {turn}");
    let oid = snapshot_to_ref(&repo, &ref_name, &message)?;
    let timestamp = repo.find_commit(oid)?.time().seconds();

    Ok(Checkpoint {
        turn,
        ref_name,
        oid: oid.to_string(),
        message,
        timestamp,
    })
}

/// List all checkpoints for a given task, sorted by turn number ascending.
///
/// Async with the git2 work on the blocking pool, like [`checkpoint_create`]:
/// ref enumeration plus commit peeling over a long thread's checkpoints must
/// not run on the main thread.
#[tauri::command]
pub async fn checkpoint_list(
    state: tauri::State<'_, AgentState>,
    task_id: String,
) -> Result<Vec<Checkpoint>, AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    tauri::async_runtime::spawn_blocking(move || list_snapshots(&cwd, &task_id))
        .await
        .map_err(|e| AppError::Other(format!("checkpoint list task failed: {e}")))?
}

/// Workspace-addressed core of [`checkpoint_list`], split out for testing.
pub fn list_snapshots(cwd: &str, task_id: &str) -> Result<Vec<Checkpoint>, AppError> {
    let repo = Repository::discover(cwd)?;
    let prefix = format!("{REF_PREFIX}{task_id}/");

    let mut checkpoints: Vec<Checkpoint> = Vec::new();

    repo.references_glob(&format!("{prefix}*"))?.for_each(|reference| {
        let Ok(reference) = reference else { return };
        let ref_name = match reference.name() {
            Some(n) => n.to_string(),
            None => return,
        };
        // Extract turn number from ref name
        let turn_str = ref_name.strip_prefix(&prefix).unwrap_or("");
        let turn: u32 = match turn_str.parse() {
            Ok(t) => t,
            Err(_) => return,
        };
        let oid = match reference.peel_to_commit() {
            Ok(c) => c.id(),
            Err(_) => return,
        };
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => return,
        };
        let message = commit.message().unwrap_or("").lines().next().unwrap_or("").to_string();
        let timestamp = commit.time().seconds();

        checkpoints.push(Checkpoint {
            turn,
            ref_name,
            oid: oid.to_string(),
            message,
            timestamp,
        });
    });

    checkpoints.sort_by_key(|c| c.turn);
    Ok(checkpoints)
}

/// Compute the diff between two checkpoint turns for a task.
/// If `to_turn` is 0, diffs against the live working tree.
///
/// Async with the git2 work on the blocking pool — tree reads plus a full
/// text diff over every changed file scale with the turn's size.
#[tauri::command]
pub async fn checkpoint_diff(
    state: tauri::State<'_, AgentState>,
    task_id: String,
    from_turn: u32,
    to_turn: u32,
) -> Result<CheckpointDiff, AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    tauri::async_runtime::spawn_blocking(move || diff_snapshots(&cwd, &task_id, from_turn, to_turn))
        .await
        .map_err(|e| AppError::Other(format!("checkpoint diff task failed: {e}")))?
}

/// Workspace-addressed core of [`checkpoint_diff`], split out for testing.
pub fn diff_snapshots(
    cwd: &str,
    task_id: &str,
    from_turn: u32,
    to_turn: u32,
) -> Result<CheckpointDiff, AppError> {
    let repo = Repository::discover(cwd)?;

    let from_ref = format!("{REF_PREFIX}{task_id}/{from_turn}");
    let from_commit = repo.find_reference(&from_ref)?.peel_to_commit()?;
    let from_tree = from_commit.tree()?;

    let to_tree: Option<Tree> = if to_turn == 0 {
        // "Now" is the working tree, not HEAD: the changes a user wants to see
        // after a turn are precisely the ones that were never committed.
        None
    } else {
        let to_ref = format!("{REF_PREFIX}{task_id}/{to_turn}");
        Some(repo.find_reference(&to_ref)?.peel_to_commit()?.tree()?)
    };

    let mut diff_opts = DiffOptions::new();
    // `show_untracked_content` matters: without it a file the agent created is
    // reported as changed but contributes no line stats and no patch text.
    diff_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    let diff = match &to_tree {
        Some(tree) => repo.diff_tree_to_tree(Some(&from_tree), Some(tree), Some(&mut diff_opts))?,
        // Deliberately not the `_with_index` variant: snapshots are unrelated
        // to the user's index, which would misreport every file as untracked.
        None => repo.diff_tree_to_workdir(Some(&from_tree), Some(&mut diff_opts))?,
    };

    // Collect stats
    let stats = diff.stats()?;
    let additions = stats.insertions() as u32;
    let deletions = stats.deletions() as u32;
    let file_count = stats.files_changed() as u32;

    // Collect per-file stats
    let mut files: Vec<CheckpointFileStat> = Vec::new();
    for (idx, delta) in diff.deltas().enumerate() {
        let path = delta.new_file().path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let status = match delta.status() {
            git2::Delta::Added => "A",
            git2::Delta::Deleted => "D",
            git2::Delta::Modified => "M",
            git2::Delta::Renamed => "R",
            _ => "M",
        };
        let (ins, del) = if let Ok(Some(patch)) = git2::Patch::from_diff(&diff, idx) {
            let (_, a, d) = patch.line_stats().unwrap_or((0, 0, 0));
            (a as u32, d as u32)
        } else {
            (0, 0)
        };
        files.push(CheckpointFileStat {
            path,
            additions: ins,
            deletions: del,
            status: status.to_string(),
        });
    }

    // Generate patch text
    let mut patch = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if matches!(origin, '+' | '-' | ' ') {
            patch.push(origin);
        }
        patch.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })?;

    Ok(CheckpointDiff {
        from_turn,
        to_turn,
        additions,
        deletions,
        file_count,
        patch,
        files,
    })
}

/// Restore the working tree to a specific checkpoint turn.
///
/// Rewrites files and the index to match the snapshot; HEAD and every branch
/// stay put. Files created after the snapshot are removed (that is what "roll
/// back to this point" means), but ignored files are left alone, so build
/// output and `node_modules` survive.
///
/// Refuses to run when the working tree is dirty unless `force` is true. On the
/// forced path the current state is stashed first, so the restore is itself
/// recoverable with `git stash pop`.
///
/// Async with the git2 work on the blocking pool — same reasoning as
/// [`checkpoint_create`]: a checkout of a large tree must not run on the
/// main thread.
#[tauri::command]
pub async fn checkpoint_revert(
    state: tauri::State<'_, AgentState>,
    task_id: String,
    turn: u32,
    force: Option<bool>,
) -> Result<(), AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || restore_snapshot(&cwd, &task_id, turn, force))
        .await
        .map_err(|e| AppError::Other(format!("checkpoint restore task failed: {e}")))?
}

/// Does the working tree differ from HEAD (ignoring ignored files)?
fn is_dirty(repo: &Repository) -> Result<bool, AppError> {
    let statuses = repo.statuses(None)?;
    Ok(statuses
        .iter()
        .any(|s| !s.status().is_empty() && s.status() != git2::Status::IGNORED))
}

/// Make the about-to-be-destroyed state recoverable before a forced restore.
///
/// A stash is the right answer when it works — `git stash list` is discoverable
/// and `git stash pop` is muscle memory. It cannot work on an unborn branch
/// ("you do not have the initial commit yet"), which is precisely the fresh
/// repo where a rollback is most likely, so there we fall back to the same
/// snapshot machinery under [`UNDO_PREFIX`].
///
/// Either way a failure aborts the restore: "the user clicked force" is not the
/// same as "the user wanted their edits gone forever".
fn protect_before_restore(cwd: &str, task_id: &str, turn: u32) -> Result<(), AppError> {
    let repo = Repository::discover(cwd)?;
    if !is_dirty(&repo)? {
        return Ok(());
    }

    if repo.head().is_err() {
        let ref_name = format!("{UNDO_PREFIX}{task_id}");
        let message = format!("LAF Agent undo point · before restoring turn {turn}");
        snapshot_to_ref(&repo, &ref_name, &message).map_err(|e| {
            AppError::Other(format!(
                "Restore aborted to protect your uncommitted changes: the undo snapshot failed ({e}). Commit your changes manually, then try again."
            ))
        })?;
        log::info!("[checkpoint] saved undo point at {ref_name} (repo has no commits yet)");
        return Ok(());
    }

    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("LAF Agent", "agent@local"))?;
    let mut repo = Repository::discover(cwd)?; // stash_save needs &mut
    repo.stash_save(
        &sig,
        &format!("laf-agent: before restoring checkpoint turn {turn}"),
        Some(git2::StashFlags::INCLUDE_UNTRACKED),
    )
    .map_err(|e| {
        AppError::Other(format!(
            "Restore aborted to protect your uncommitted changes: the safety stash failed ({e}). Commit or stash your changes manually, then try again."
        ))
    })?;
    log::info!("[checkpoint] stashed dirty tree before forced restore");
    Ok(())
}

/// Delete files that exist now but not in `tree`.
///
/// `checkout_tree` governs paths the tree knows about; this is what makes a
/// rollback also undo file *creation*. Doing it from an explicit diff rather
/// than libgit2's `remove_untracked` is deliberate: that flag swept ignored
/// files too, so a rollback would have deleted the user's build output.
fn remove_paths_absent_from(repo: &Repository, tree: &Tree) -> Result<(), AppError> {
    let workdir = match repo.workdir() {
        Some(w) => w.to_path_buf(),
        None => return Ok(()), // bare repo: nothing to clean
    };
    let mut opts = DiffOptions::new();
    // No `include_ignored` — ignored paths never enter this list, which is the
    // whole guarantee.
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let diff = repo.diff_tree_to_workdir(Some(tree), Some(&mut opts))?;

    for delta in diff.deltas() {
        if delta.status() != git2::Delta::Added {
            continue; // present in the snapshot — checkout_tree restores it
        }
        let Some(rel) = delta.new_file().path() else { continue };
        let path = workdir.join(rel);
        if let Err(e) = std::fs::remove_file(&path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                log::warn!("[checkpoint] could not remove {}: {e}", path.display());
            }
        }
    }
    Ok(())
}

/// Workspace-addressed core of [`checkpoint_revert`], split out for testing.
pub fn restore_snapshot(cwd: &str, task_id: &str, turn: u32, force: bool) -> Result<(), AppError> {
    let repo = Repository::discover(cwd)?;

    if !force && is_dirty(&repo)? {
        return Err(AppError::Other(
            "Working tree has uncommitted changes. Pass force=true to discard them.".to_string(),
        ));
    }

    let ref_name = format!("{REF_PREFIX}{task_id}/{turn}");
    // Resolve before protecting: no point stashing for a checkpoint that is
    // already gone (pruned, or a thread from another workspace).
    let tree = repo.find_reference(&ref_name)?.peel_to_commit()?.tree()?;

    if force {
        protect_before_restore(cwd, task_id, turn)?;
    }

    remove_paths_absent_from(&repo, &tree)?;

    // Restore files + index from the snapshot, leaving HEAD where it is. A hard
    // reset would move the user's branch onto a LAF-Agent-authored commit that
    // exists only to hold this snapshot.
    let mut opts = CheckoutBuilder::new();
    opts.force();
    repo.checkout_tree(tree.as_object(), Some(&mut opts))?;

    Ok(())
}

/// Delete checkpoint refs older than `keep_days`, across all tasks.
///
/// One ref lands per turn and only thread deletion ever removed them, so a
/// year of heavy use leaks tens of thousands of refs — each one pinning its
/// commit against `git gc` forever. Age comes from the ref's own reflog entry
/// (refs are lightweight; the target commit's date says nothing about when
/// the checkpoint was taken).
///
/// Async with the git2 work on the blocking pool: iterating thousands of refs
/// and reading each reflog must not run on the main thread.
#[tauri::command]
pub async fn checkpoint_prune(cwd: String, keep_days: u32) -> Result<u32, AppError> {
    tauri::async_runtime::spawn_blocking(move || prune_snapshots(&cwd, keep_days))
        .await
        .map_err(|e| AppError::Other(format!("checkpoint prune task failed: {e}")))?
}

/// Workspace-addressed core of [`checkpoint_prune`], split out for testing.
pub fn prune_snapshots(cwd: &str, keep_days: u32) -> Result<u32, AppError> {
    let repo = Repository::discover(cwd)?;
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
        - (keep_days as i64) * 24 * 60 * 60;

    let mut deleted: u32 = 0;
    let names: Vec<String> = repo
        .references_glob(&format!("{OWNED_PREFIX}*"))?
        .filter_map(|r| r.ok())
        .filter_map(|r| r.name().map(String::from))
        .collect();
    for name in names {
        let taken_at = repo
            .reflog(&name)
            .ok()
            .and_then(|log| log.get(0).map(|e| e.committer().when().seconds()));
        // `<=` so a keep_days horizon lands exactly on its boundary — and so
        // keep_days=0 (used by tests) really does mean "everything".
        let expired = match taken_at {
            Some(t) => t <= cutoff,
            // No reflog — fall back to the target commit's time rather than
            // keeping the ref forever.
            None => repo
                .find_reference(&name)
                .ok()
                .and_then(|r| r.peel_to_commit().ok())
                .map(|c| c.time().seconds() <= cutoff)
                .unwrap_or(false),
        };
        if expired {
            if let Ok(mut reference) = repo.find_reference(&name) {
                if reference.delete().is_ok() {
                    deleted += 1;
                }
            }
        }
    }
    if deleted > 0 {
        log::info!("[checkpoint] pruned {deleted} checkpoint ref(s) older than {keep_days}d");
    }
    Ok(deleted)
}

/// Delete all checkpoints for a task (cleanup on thread delete).
///
/// Async with the git2 work on the blocking pool — a long thread can own
/// hundreds of refs, and thread deletion should never stall the UI.
#[tauri::command]
pub async fn checkpoint_cleanup(
    state: tauri::State<'_, AgentState>,
    task_id: String,
) -> Result<u32, AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    tauri::async_runtime::spawn_blocking(move || cleanup_snapshots(&cwd, &task_id))
        .await
        .map_err(|e| AppError::Other(format!("checkpoint cleanup task failed: {e}")))?
}

/// Workspace-addressed core of [`checkpoint_cleanup`], split out for testing.
pub fn cleanup_snapshots(cwd: &str, task_id: &str) -> Result<u32, AppError> {
    let repo = Repository::discover(cwd)?;
    let prefix = format!("{REF_PREFIX}{task_id}/");

    let mut deleted: u32 = 0;
    let mut refs: Vec<String> = repo.references_glob(&format!("{prefix}*"))?
        .filter_map(|r| r.ok())
        .filter_map(|r| r.name().map(String::from))
        .collect();
    // The thread's undo point lives outside the checkpoint namespace; deleting
    // the thread has to take it too or it outlives everything it refers to.
    refs.push(format!("{UNDO_PREFIX}{task_id}"));

    for ref_name in refs {
        if let Ok(mut reference) = repo.find_reference(&ref_name) {
            if reference.delete().is_ok() {
                deleted += 1;
            }
        }
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkpoint_serializes_camel_case() {
        let cp = Checkpoint {
            turn: 3,
            ref_name: "refs/laf-agent/cp/task-1/3".to_string(),
            oid: "abc123".to_string(),
            message: "fix bug".to_string(),
            timestamp: 1700000000,
        };
        let json = serde_json::to_string(&cp).unwrap();
        assert!(json.contains("\"refName\""));
        assert!(json.contains("\"turn\":3"));
    }

    #[test]
    fn checkpoint_diff_serializes_camel_case() {
        let diff = CheckpointDiff {
            from_turn: 1,
            to_turn: 2,
            additions: 10,
            deletions: 5,
            file_count: 3,
            patch: String::new(),
            files: vec![],
        };
        let json = serde_json::to_string(&diff).unwrap();
        assert!(json.contains("\"fromTurn\":1"));
        assert!(json.contains("\"toTurn\":2"));
        assert!(json.contains("\"fileCount\":3"));
    }

    #[test]
    fn checkpoint_file_stat_serializes() {
        let stat = CheckpointFileStat {
            path: "src/main.rs".to_string(),
            additions: 5,
            deletions: 2,
            status: "M".to_string(),
        };
        let json = serde_json::to_string(&stat).unwrap();
        assert!(json.contains("\"path\":\"src/main.rs\""));
    }
}

/// Snapshot semantics, exercised against real repositories.
///
/// These exist because the previous implementation passed every serialization
/// test while being unable to restore a single turn: it recorded HEAD, and the
/// agent never commits, so consecutive checkpoints were byte-identical. Only a
/// test that writes files, snapshots, edits, and restores can catch that.
#[cfg(test)]
mod snapshot_tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    const TASK: &str = "task-snap";

    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let sig = git2::Signature::now("t", "t@t").unwrap();
        let tree_id = { let mut idx = repo.index().unwrap(); idx.write_tree().unwrap() };
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, body: &str) {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, body).unwrap();
    }

    fn read(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap()
    }

    fn cwd(dir: &tempfile::TempDir) -> String {
        dir.path().to_string_lossy().into_owned()
    }

    /// The defect that motivated the rewrite: with no commits in between, two
    /// turns must still produce different snapshots.
    #[test]
    fn consecutive_turns_capture_different_states() {
        let dir = init_repo();
        write(dir.path(), "a.txt", "turn one");
        let cp1 = create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "a.txt", "turn two");
        let cp2 = create_snapshot(&cwd(&dir), TASK, 2).unwrap();

        assert_ne!(cp1.oid, cp2.oid, "checkpoints collapsed onto one commit");
    }

    /// Restoring a turn brings back that turn's file contents, not HEAD's.
    #[test]
    fn revert_restores_uncommitted_content() {
        let dir = init_repo();
        write(dir.path(), "a.txt", "original");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "a.txt", "agent rewrote this");

        restore_snapshot(&cwd(&dir), TASK, 1, true).unwrap();
        assert_eq!(read(dir.path(), "a.txt"), "original");
    }

    /// A file the agent created after the checkpoint is gone after a restore.
    #[test]
    fn revert_removes_files_added_after_the_checkpoint() {
        let dir = init_repo();
        write(dir.path(), "keep.txt", "keep");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "added.txt", "added later");

        restore_snapshot(&cwd(&dir), TASK, 1, true).unwrap();
        assert!(!dir.path().join("added.txt").exists());
        assert_eq!(read(dir.path(), "keep.txt"), "keep");
    }

    /// A file the agent deleted after the checkpoint comes back.
    #[test]
    fn revert_restores_files_deleted_after_the_checkpoint() {
        let dir = init_repo();
        write(dir.path(), "gone.txt", "still here");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        fs::remove_file(dir.path().join("gone.txt")).unwrap();

        restore_snapshot(&cwd(&dir), TASK, 1, true).unwrap();
        assert_eq!(read(dir.path(), "gone.txt"), "still here");
    }

    /// Reverting turn 1 must not undo turn 2 only — each turn is its own point.
    #[test]
    fn each_turn_is_independently_addressable() {
        let dir = init_repo();
        write(dir.path(), "a.txt", "v1");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "a.txt", "v2");
        create_snapshot(&cwd(&dir), TASK, 2).unwrap();
        write(dir.path(), "a.txt", "v3");

        restore_snapshot(&cwd(&dir), TASK, 2, true).unwrap();
        assert_eq!(read(dir.path(), "a.txt"), "v2");
        restore_snapshot(&cwd(&dir), TASK, 1, true).unwrap();
        assert_eq!(read(dir.path(), "a.txt"), "v1");
    }

    /// Build output must survive a rollback: it is ignored, so it is neither
    /// snapshotted nor swept away.
    #[test]
    fn ignored_files_are_left_alone() {
        let dir = init_repo();
        write(dir.path(), ".gitignore", "build/\n");
        write(dir.path(), "build/artifact.bin", "expensive");
        write(dir.path(), "src.txt", "v1");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "src.txt", "v2");

        restore_snapshot(&cwd(&dir), TASK, 1, true).unwrap();
        assert_eq!(read(dir.path(), "src.txt"), "v1");
        assert!(dir.path().join("build/artifact.bin").exists(), "ignored file was swept");
    }

    /// Restoring must never move the branch onto our synthetic commit.
    #[test]
    fn revert_leaves_head_and_branches_untouched() {
        let dir = init_repo();
        let repo = Repository::open(dir.path()).unwrap();
        let head_before = repo.head().unwrap().peel_to_commit().unwrap().id();

        write(dir.path(), "a.txt", "v1");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "a.txt", "v2");
        restore_snapshot(&cwd(&dir), TASK, 1, true).unwrap();

        let head_after = repo.head().unwrap().peel_to_commit().unwrap().id();
        assert_eq!(head_before, head_after);
    }

    /// The forced path stashes first, so a mistaken rollback is recoverable.
    #[test]
    fn forced_revert_stashes_the_discarded_work() {
        let dir = init_repo();
        write(dir.path(), "a.txt", "v1");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "a.txt", "work the user may want back");

        restore_snapshot(&cwd(&dir), TASK, 1, true).unwrap();

        let mut repo = Repository::open(dir.path()).unwrap();
        let mut found = 0;
        repo.stash_foreach(|_, _, _| { found += 1; true }).unwrap();
        assert_eq!(found, 1, "forced revert discarded work without a stash");
    }

    /// Without `force`, a dirty tree is refused rather than overwritten.
    #[test]
    fn unforced_revert_refuses_a_dirty_tree() {
        let dir = init_repo();
        write(dir.path(), "a.txt", "v1");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "a.txt", "uncommitted");

        assert!(restore_snapshot(&cwd(&dir), TASK, 1, false).is_err());
        assert_eq!(read(dir.path(), "a.txt"), "uncommitted");
    }

    /// A repo with no commits is exactly when a rollback matters most.
    #[test]
    fn snapshots_work_before_the_first_commit() {
        let dir = tempfile::tempdir().unwrap();
        Repository::init(dir.path()).unwrap();
        write(dir.path(), "a.txt", "v1");

        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "a.txt", "v2");
        restore_snapshot(&cwd(&dir), TASK, 1, true).unwrap();
        assert_eq!(read(dir.path(), "a.txt"), "v1");
    }

    /// `to_turn = 0` means "now", so a turn's changes are visible before any
    /// commit exists to compare against.
    #[test]
    fn diff_against_zero_sees_the_working_tree() {
        let dir = init_repo();
        write(dir.path(), "a.txt", "v1");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "a.txt", "v1\nv2\n");

        let diff = diff_snapshots(&cwd(&dir), TASK, 1, 0).unwrap();
        assert_eq!(diff.file_count, 1);
        assert!(diff.additions > 0);
        assert_eq!(diff.files[0].path, "a.txt");
    }

    /// Diffing two snapshots reports exactly the turn's changes.
    #[test]
    fn diff_between_turns_reports_that_turn() {
        let dir = init_repo();
        write(dir.path(), "a.txt", "v1");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();
        write(dir.path(), "b.txt", "new file");
        create_snapshot(&cwd(&dir), TASK, 2).unwrap();

        let diff = diff_snapshots(&cwd(&dir), TASK, 1, 2).unwrap();
        assert_eq!(diff.file_count, 1);
        assert_eq!(diff.files[0].path, "b.txt");
        assert_eq!(diff.files[0].status, "A");
    }

    /// The scratch index must stay inside .git — never in the user's workspace.
    #[test]
    fn scratch_index_never_lands_in_the_workspace() {
        let dir = init_repo();
        write(dir.path(), "a.txt", "v1");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();

        let entries: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(!entries.iter().any(|n| n.contains("laf-agent")), "found {entries:?}");
        assert!(dir.path().join(".git/laf-agent-snapshot-index").exists());
    }

    /// Snapshot cost against a real repository, since this is the one thing the
    /// rewrite made more expensive than a 41-byte ref write. Ignored by default
    /// (it needs a repo to point at and writes refs into it):
    ///
    /// ```text
    /// LAF_BENCH_REPO=/path/to/repo cargo test --lib snapshot_cost -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "needs LAF_BENCH_REPO; writes refs into it"]
    fn snapshot_cost_on_a_real_repo() {
        let Ok(path) = std::env::var("LAF_BENCH_REPO") else { return };
        const TASK: &str = "bench";
        // First snapshot pays for a cold stat cache; later ones are the steady
        // state, which is what a user actually experiences per turn.
        for turn in 1..=3u32 {
            let start = std::time::Instant::now();
            create_snapshot(&path, TASK, turn).unwrap();
            println!("turn {turn}: {:?}", start.elapsed());
        }
        let repo = Repository::discover(&path).unwrap();
        for turn in 1..=3u32 {
            if let Ok(mut r) = repo.find_reference(&format!("{REF_PREFIX}{TASK}/{turn}")) {
                let _ = r.delete();
            }
        }
    }

    /// Snapshotting must not stage anything in the user's own index.
    #[test]
    fn snapshotting_leaves_the_user_index_alone() {
        let dir = init_repo();
        write(dir.path(), "a.txt", "v1");
        create_snapshot(&cwd(&dir), TASK, 1).unwrap();

        let repo = Repository::open(dir.path()).unwrap();
        let staged = repo
            .statuses(None)
            .unwrap()
            .iter()
            .any(|s| s.status().intersects(git2::Status::INDEX_NEW | git2::Status::INDEX_MODIFIED));
        assert!(!staged, "snapshot leaked into the user's index");
    }
}

#[cfg(test)]
mod prune_tests {
    use super::*;
    use git2::Repository;

    fn repo_with_commit() -> (tempfile::TempDir, Repository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        {
            let sig = git2::Signature::now("t", "t@t").unwrap();
            let tree_id = { let mut idx = repo.index().unwrap(); idx.write_tree().unwrap() };
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        }
        (dir, repo)
    }

    /// Refs created just now must survive; the point is a horizon, not a wipe.
    #[test]
    fn fresh_checkpoints_survive_pruning() {
        let (dir, repo) = repo_with_commit();
        let oid = repo.head().unwrap().peel_to_commit().unwrap().id();
        repo.reference("refs/laf-agent/cp/task-a/1", oid, true, "cp").unwrap();
        repo.reference("refs/laf-agent/cp/task-a/2", oid, true, "cp").unwrap();

        let deleted = prune_snapshots(&dir.path().to_string_lossy(), 30).unwrap();
        assert_eq!(deleted, 0);
        assert!(repo.find_reference("refs/laf-agent/cp/task-a/1").is_ok());
    }

    /// keep_days=0 makes everything expired — the deletion path itself.
    #[test]
    fn expired_checkpoints_are_deleted() {
        let (dir, repo) = repo_with_commit();
        let oid = repo.head().unwrap().peel_to_commit().unwrap().id();
        repo.reference("refs/laf-agent/cp/task-b/1", oid, true, "cp").unwrap();

        let deleted = prune_snapshots(&dir.path().to_string_lossy(), 0).unwrap();
        assert_eq!(deleted, 1);
        assert!(repo.find_reference("refs/laf-agent/cp/task-b/1").is_err());
    }

    /// Only our namespace: a user's own refs are never ours to expire.
    #[test]
    fn pruning_never_touches_foreign_refs() {
        let (dir, repo) = repo_with_commit();
        let oid = repo.head().unwrap().peel_to_commit().unwrap().id();
        repo.reference("refs/heads/feature-x", oid, true, "user branch").unwrap();

        prune_snapshots(&dir.path().to_string_lossy(), 0).unwrap();
        assert!(repo.find_reference("refs/heads/feature-x").is_ok());
    }
}
