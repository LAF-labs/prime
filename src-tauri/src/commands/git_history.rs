//! Git commit history — provides a lightweight commit log for the source
//! control graph UI. All heavy lifting (revwalk, diff stats) happens here
//! in Rust; the frontend just renders the returned data.

use git2::{Repository, Sort};
use serde::Serialize;

use super::error::AppError;

/// A single commit entry for the history timeline.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitEntry {
    /// Short OID (first 7 chars).
    pub short_oid: String,
    /// Full OID hex string.
    pub oid: String,
    /// First line of the commit message.
    pub subject: String,
    /// Full commit message body (after first line).
    pub body: String,
    /// Author name.
    pub author_name: String,
    /// Author email.
    pub author_email: String,
    /// Unix timestamp (seconds) of the commit.
    pub timestamp: i64,
    /// Number of insertions in this commit vs its parent.
    pub additions: u32,
    /// Number of deletions in this commit vs its parent.
    pub deletions: u32,
    /// Number of files changed.
    pub file_count: u32,
    /// Parent OIDs (usually 1, 2 for merges).
    pub parents: Vec<String>,
    /// True if this is the current HEAD commit.
    pub is_head: bool,
}

/// Stash entry for the stash list.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub oid: String,
    pub timestamp: i64,
}

/// Get the commit history for a repository. Returns the most recent `limit`
/// commits starting from HEAD.
///
/// When `include_stats` is `false` (the default), diff stats are omitted for
/// performance — computing tree-to-tree diffs for every commit is expensive on
/// large repos. The frontend can request stats lazily for visible commits via
/// `git_commit_stats`.
#[tauri::command]
pub fn git_commit_history(
    cwd: String,
    limit: Option<u32>,
    skip: Option<u32>,
    include_stats: Option<bool>,
) -> Result<Vec<CommitEntry>, AppError> {
    let limit = limit.unwrap_or(30).min(200) as usize;
    let skip = skip.unwrap_or(0) as usize;
    let include_stats = include_stats.unwrap_or(false);

    let repo = Repository::discover(&cwd)?;
    let head = repo.head()?;
    let head_oid = head.target().ok_or_else(|| AppError::Other("HEAD has no target".into()))?;

    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;

    let mut entries: Vec<CommitEntry> = Vec::with_capacity(limit);
    let mut count = 0;

    for oid_result in revwalk {
        let oid = oid_result?;

        // Skip entries before the offset
        if count < skip {
            count += 1;
            continue;
        }

        // Stop after limit
        if entries.len() >= limit {
            break;
        }

        let commit = repo.find_commit(oid)?;
        let message = commit.message().unwrap_or("");
        let (subject, body) = match message.find('\n') {
            Some(idx) => (message[..idx].to_string(), message[idx + 1..].trim().to_string()),
            None => (message.to_string(), String::new()),
        };

        let author = commit.author();
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let author_email = author.email().unwrap_or("").to_string();
        let timestamp = commit.time().seconds();

        let parents: Vec<String> = commit.parent_ids().map(|id| id.to_string()[..7].to_string()).collect();

        // Only compute diff stats when explicitly requested (expensive on large repos)
        let (additions, deletions, file_count) = if include_stats {
            compute_commit_stats(&repo, &commit)
        } else {
            (0, 0, 0)
        };

        entries.push(CommitEntry {
            short_oid: oid.to_string()[..7].to_string(),
            oid: oid.to_string(),
            subject,
            body,
            author_name,
            author_email,
            timestamp,
            additions,
            deletions,
            file_count,
            parents,
            is_head: oid == head_oid,
        });

        count += 1;
    }

    Ok(entries)
}

/// Compute diff stats for a single commit (vs its first parent).
fn compute_commit_stats(repo: &Repository, commit: &git2::Commit<'_>) -> (u32, u32, u32) {
    if commit.parent_count() > 0 {
        let parent = match commit.parent(0) {
            Ok(p) => p,
            Err(_) => return (0, 0, 0),
        };
        let parent_tree = match parent.tree() {
            Ok(t) => t,
            Err(_) => return (0, 0, 0),
        };
        let commit_tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => return (0, 0, 0),
        };
        match repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), None) {
            Ok(diff) => match diff.stats() {
                Ok(stats) => (
                    stats.insertions() as u32,
                    stats.deletions() as u32,
                    stats.files_changed() as u32,
                ),
                Err(_) => (0, 0, 0),
            },
            Err(_) => (0, 0, 0),
        }
    } else {
        // Root commit — count all files as additions
        let commit_tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => return (0, 0, 0),
        };
        match repo.diff_tree_to_tree(None, Some(&commit_tree), None) {
            Ok(diff) => match diff.stats() {
                Ok(stats) => (
                    stats.insertions() as u32,
                    stats.deletions() as u32,
                    stats.files_changed() as u32,
                ),
                Err(_) => (0, 0, 0),
            },
            Err(_) => (0, 0, 0),
        }
    }
}

/// Get diff stats for a batch of commits by OID. Used by the frontend to
/// lazily load stats for visible commits in the history timeline.
/// Capped at 50 OIDs per call to prevent excessive computation.
#[tauri::command]
pub fn git_commit_stats(
    cwd: String,
    oids: Vec<String>,
) -> Result<Vec<CommitStatEntry>, AppError> {
    let repo = Repository::discover(&cwd)?;
    let capped = if oids.len() > 50 { &oids[..50] } else { &oids };
    let mut results = Vec::with_capacity(capped.len());

    for oid_str in capped {
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|e| AppError::Other(format!("Invalid OID '{}': {e}", oid_str)))?;
        let commit = repo.find_commit(oid)?;
        let (additions, deletions, file_count) = compute_commit_stats(&repo, &commit);
        results.push(CommitStatEntry {
            oid: oid_str.clone(),
            additions,
            deletions,
            file_count,
        });
    }

    Ok(results)
}

/// Diff stats for a single commit (returned by `git_commit_stats`).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitStatEntry {
    pub oid: String,
    pub additions: u32,
    pub deletions: u32,
    pub file_count: u32,
}

/// Get the diff patch for a specific commit (vs its first parent).
#[tauri::command]
pub fn git_commit_diff(cwd: String, oid: String) -> Result<String, AppError> {
    let repo = Repository::discover(&cwd)?;
    let commit_oid = git2::Oid::from_str(&oid)
        .map_err(|e| AppError::Other(format!("Invalid OID: {e}")))?;
    let commit = repo.find_commit(commit_oid)?;
    let commit_tree = commit.tree()?;

    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };

    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), None)?;

    let mut patch = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        match origin {
            'H' | 'F' => {
                patch.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
            }
            '+' | '-' | ' ' => {
                patch.push(origin);
                patch.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
            }
            _ => {
                patch.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
            }
        }
        true
    })?;

    Ok(patch)
}

/// List git stashes for a repository.
#[tauri::command]
pub fn git_stash_list(cwd: String) -> Result<Vec<StashEntry>, AppError> {
    let mut repo = Repository::discover(&cwd)?;
    let mut stashes: Vec<StashEntry> = Vec::new();

    repo.stash_foreach(|index, message, oid| {
        stashes.push(StashEntry {
            index,
            message: message.to_string(),
            oid: oid.to_string(),
            timestamp: 0, // filled below
        });
        true
    })?;

    // Fill timestamps in a second pass to avoid borrow conflict
    for stash in &mut stashes {
        if let Ok(commit) = repo.find_commit(git2::Oid::from_str(&stash.oid).unwrap_or(git2::Oid::zero())) {
            stash.timestamp = commit.time().seconds();
        }
    }

    Ok(stashes)
}

/// Apply and drop a stash by index.
#[tauri::command]
pub fn git_stash_pop(cwd: String, index: Option<usize>) -> Result<(), AppError> {
    let mut repo = Repository::discover(&cwd)?;
    let idx = index.unwrap_or(0);
    repo.stash_pop(idx, None)?;
    Ok(())
}

/// Drop a stash by index without applying.
#[tauri::command]
pub fn git_stash_drop(cwd: String, index: Option<usize>) -> Result<(), AppError> {
    let mut repo = Repository::discover(&cwd)?;
    let idx = index.unwrap_or(0);
    repo.stash_drop(idx)?;
    Ok(())
}

/// Create a new stash with the given message.
#[tauri::command]
pub fn git_stash_save(cwd: String, message: Option<String>) -> Result<String, AppError> {
    let mut repo = Repository::discover(&cwd)?;
    let sig = repo.signature()?;
    let msg = message.as_deref();
    let oid = repo.stash_save(&sig, msg.unwrap_or("kirodex stash"), None)?;
    Ok(oid.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_entry_serializes_camel_case() {
        let entry = CommitEntry {
            short_oid: "abc1234".to_string(),
            oid: "abc1234567890".to_string(),
            subject: "fix: something".to_string(),
            body: String::new(),
            author_name: "Dev".to_string(),
            author_email: "dev@example.com".to_string(),
            timestamp: 1700000000,
            additions: 10,
            deletions: 5,
            file_count: 3,
            parents: vec!["def5678".to_string()],
            is_head: true,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"shortOid\""));
        assert!(json.contains("\"authorName\""));
        assert!(json.contains("\"isHead\":true"));
        assert!(json.contains("\"fileCount\":3"));
    }

    #[test]
    fn stash_entry_serializes_camel_case() {
        let entry = StashEntry {
            index: 0,
            message: "WIP".to_string(),
            oid: "abc123".to_string(),
            timestamp: 1700000000,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"index\":0"));
        assert!(json.contains("\"message\":\"WIP\""));
    }
}
