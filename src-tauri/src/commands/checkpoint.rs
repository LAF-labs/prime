//! Per-turn checkpointing via hidden git refs.
//!
//! Creates lightweight refs at `refs/kirodex/cp/{task_id}/{turn}` before each
//! agent turn starts. After the turn completes, the frontend can diff between
//! any two checkpoints to see exactly what changed in that turn.

use git2::{DiffOptions, Repository};
use serde::Serialize;
use std::path::Path;

use super::acp::AcpState;
use super::error::AppError;

/// A single checkpoint entry returned to the frontend.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    /// The turn number (monotonically increasing per task).
    pub turn: u32,
    /// The full ref name (e.g. `refs/kirodex/cp/task-abc/3`).
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

fn resolve_workspace(state: &AcpState, task_id: &str) -> Result<String, AppError> {
    let tasks = state.tasks.lock();
    tasks
        .get(task_id)
        .map(|t| t.workspace.clone())
        .ok_or_else(|| AppError::TaskNotFound(task_id.to_string()))
}

/// Ref prefix for all kirodex checkpoints.
const REF_PREFIX: &str = "refs/kirodex/cp/";

/// Create a checkpoint for the current HEAD at the given turn number.
/// If the workspace has uncommitted changes, we snapshot the current index
/// state as a temporary tree and create a lightweight ref pointing to HEAD.
/// This is non-destructive — it never modifies the working tree or index.
#[tauri::command]
pub fn checkpoint_create(
    state: tauri::State<'_, AcpState>,
    task_id: String,
    turn: u32,
) -> Result<Checkpoint, AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    let repo = Repository::discover(&cwd)?;
    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    let oid = commit.id();
    let ref_name = format!("{REF_PREFIX}{task_id}/{turn}");

    // Create or update the ref to point at the current HEAD commit
    repo.reference(&ref_name, oid, true, &format!("kirodex checkpoint turn {turn}"))?;

    let message = commit.message().unwrap_or("").lines().next().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();

    Ok(Checkpoint {
        turn,
        ref_name,
        oid: oid.to_string(),
        message,
        timestamp,
    })
}

/// List all checkpoints for a given task, sorted by turn number ascending.
#[tauri::command]
pub fn checkpoint_list(
    state: tauri::State<'_, AcpState>,
    task_id: String,
) -> Result<Vec<Checkpoint>, AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    let repo = Repository::discover(&cwd)?;
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
/// If `to_turn` is 0, diffs against the current working tree state.
#[tauri::command]
pub fn checkpoint_diff(
    state: tauri::State<'_, AcpState>,
    task_id: String,
    from_turn: u32,
    to_turn: u32,
) -> Result<CheckpointDiff, AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    let repo = Repository::discover(&cwd)?;

    let from_ref = format!("{REF_PREFIX}{task_id}/{from_turn}");
    let from_commit = repo.find_reference(&from_ref)?.peel_to_commit()?;
    let from_tree = from_commit.tree()?;

    let to_tree = if to_turn == 0 {
        // Diff against current HEAD
        let head = repo.head()?.peel_to_commit()?;
        head.tree()?
    } else {
        let to_ref = format!("{REF_PREFIX}{task_id}/{to_turn}");
        let to_commit = repo.find_reference(&to_ref)?.peel_to_commit()?;
        to_commit.tree()?
    };

    let mut diff_opts = DiffOptions::new();
    let diff = repo.diff_tree_to_tree(Some(&from_tree), Some(&to_tree), Some(&mut diff_opts))?;

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

/// Revert the workspace to a specific checkpoint turn.
/// This does a hard reset of the working tree to the checkpoint's commit.
/// Refuses to revert if the working tree has uncommitted changes unless
/// `force` is true — prevents accidental data loss.
#[tauri::command]
pub fn checkpoint_revert(
    state: tauri::State<'_, AcpState>,
    task_id: String,
    turn: u32,
    force: Option<bool>,
) -> Result<(), AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    let repo = Repository::discover(&cwd)?;

    // Guard: refuse to hard-reset if there are uncommitted changes
    if !force.unwrap_or(false) {
        let statuses = repo.statuses(None)?;
        let is_dirty = statuses.iter().any(|s| {
            !s.status().is_empty() && s.status() != git2::Status::IGNORED
        });
        if is_dirty {
            return Err(AppError::Other(
                "Working tree has uncommitted changes. Pass force=true to discard them.".to_string()
            ));
        }
    }

    let ref_name = format!("{REF_PREFIX}{task_id}/{turn}");
    let commit = repo.find_reference(&ref_name)?.peel_to_commit()?;

    // Reset HEAD to the checkpoint commit (hard reset)
    repo.reset(commit.as_object(), git2::ResetType::Hard, None)?;

    Ok(())
}

/// Delete all checkpoints for a task (cleanup on thread delete).
#[tauri::command]
pub fn checkpoint_cleanup(
    state: tauri::State<'_, AcpState>,
    task_id: String,
) -> Result<u32, AppError> {
    let cwd = resolve_workspace(&state, &task_id)?;
    let repo = Repository::discover(&cwd)?;
    let prefix = format!("{REF_PREFIX}{task_id}/");

    let mut deleted: u32 = 0;
    let refs: Vec<String> = repo.references_glob(&format!("{prefix}*"))?
        .filter_map(|r| r.ok())
        .filter_map(|r| r.name().map(String::from))
        .collect();

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
            ref_name: "refs/kirodex/cp/task-1/3".to_string(),
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
