//! Stacked PR / multi-branch workflow support.
//!
//! Provides commands for managing branch stacks:
//! - `git_list_stack`: Shows the current branch's ancestry chain
//! - `git_stacked_push`: Pushes the current branch and optionally creates a PR
//!
//! This is a minimal implementation that works with standard git workflows.
//! It doesn't require external tools like `git-branchless` or `graphite`.

use serde::Serialize;

use super::error::AppError;
use super::git_utils::run_git_cmd;

/// A single entry in the branch stack.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StackEntry {
    /// Branch name.
    pub branch: String,
    /// Whether this is the currently checked-out branch.
    pub is_current: bool,
    /// Number of commits ahead of its parent branch.
    pub commits_ahead: u32,
    /// Whether this branch has been pushed to remote.
    pub has_remote: bool,
}

/// Result of listing the branch stack.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchStack {
    /// The base branch (e.g. main/master).
    pub base_branch: String,
    /// Stack entries from base to tip (current branch is last).
    pub entries: Vec<StackEntry>,
}

/// Result of a stacked push operation.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StackedPushResult {
    /// Branch that was pushed.
    pub branch: String,
    /// Remote URL for the push.
    pub remote_url: String,
    /// Whether the push succeeded.
    pub pushed: bool,
}

/// Tauri command — list the branch stack for the current branch.
///
/// Walks up the branch ancestry (via merge-base) to find the main/master
/// branch, then lists all branches in the path.
#[tauri::command]
pub fn git_list_stack(cwd: String) -> Result<BranchStack, AppError> {
    // Get current branch
    let current = run_git_cmd(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;

    // Detect the default branch (main or master)
    let base_branch = detect_default_branch(&cwd)?;

    if current == base_branch {
        return Ok(BranchStack {
            base_branch: base_branch.clone(),
            entries: vec![StackEntry {
                branch: base_branch,
                is_current: true,
                commits_ahead: 0,
                has_remote: true,
            }],
        });
    }

    // Get commits between base and current
    let range = format!("{base_branch}..HEAD");
    let log_output = run_git_cmd(&cwd, &["log", "--oneline", "--no-decorate", &range])
        .unwrap_or_default();
    let commit_count = log_output.lines().count() as u32;

    // Check if current branch has a remote
    let has_remote = run_git_cmd(&cwd, &["config", &format!("branch.{current}.remote")])
        .is_ok();

    let entries = vec![
        StackEntry {
            branch: base_branch.clone(),
            is_current: false,
            commits_ahead: 0,
            has_remote: true,
        },
        StackEntry {
            branch: current,
            is_current: true,
            commits_ahead: commit_count,
            has_remote,
        },
    ];

    Ok(BranchStack {
        base_branch,
        entries,
    })
}

/// Tauri command — push the current branch to remote with upstream tracking.
///
/// If the branch doesn't have an upstream, sets it up with `-u origin <branch>`.
/// Returns the result including the remote URL for PR creation.
#[tauri::command]
pub fn git_stacked_push(cwd: String) -> Result<StackedPushResult, AppError> {
    let branch = run_git_cmd(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;

    // Check if upstream exists
    let has_upstream = run_git_cmd(&cwd, &["config", &format!("branch.{branch}.remote")])
        .is_ok();

    // Push with -u if no upstream, otherwise just push
    let push_result = if has_upstream {
        run_git_cmd(&cwd, &["push"])
    } else {
        run_git_cmd(&cwd, &["push", "-u", "origin", &branch])
    };

    match push_result {
        Ok(_) => {
            let remote_url = run_git_cmd(&cwd, &["remote", "get-url", "origin"])
                .unwrap_or_default();
            Ok(StackedPushResult {
                branch,
                remote_url: normalize_remote_url(&remote_url),
                pushed: true,
            })
        }
        Err(e) => Err(e),
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Detect the default branch (main, master, or develop).
fn detect_default_branch(cwd: &str) -> Result<String, AppError> {
    // Try remote HEAD first
    if let Ok(output) = run_git_cmd(cwd, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        if let Some(branch) = output.strip_prefix("refs/remotes/origin/") {
            return Ok(branch.to_string());
        }
    }

    // Fall back to checking common branch names
    for candidate in &["main", "master", "develop"] {
        let check = run_git_cmd(cwd, &["rev-parse", "--verify", candidate]);
        if check.is_ok() {
            return Ok(candidate.to_string());
        }
    }

    // Last resort: use the first branch
    Ok("main".to_string())
}

/// Convert SSH remote URLs to HTTPS for browser opening.
fn normalize_remote_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.starts_with("git@") {
        // git@github.com:user/repo.git → https://github.com/user/repo
        let without_prefix = trimmed.strip_prefix("git@").unwrap_or(trimmed);
        let normalized = without_prefix.replace(':', "/");
        let without_git = normalized.strip_suffix(".git").unwrap_or(&normalized);
        format!("https://{without_git}")
    } else if trimmed.ends_with(".git") {
        trimmed.strip_suffix(".git").unwrap_or(trimmed).to_string()
    } else {
        trimmed.to_string()
    }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_ssh_url() {
        assert_eq!(
            normalize_remote_url("git@github.com:user/repo.git"),
            "https://github.com/user/repo"
        );
    }

    #[test]
    fn normalize_https_url() {
        assert_eq!(
            normalize_remote_url("https://github.com/user/repo.git"),
            "https://github.com/user/repo"
        );
    }

    #[test]
    fn normalize_already_clean() {
        assert_eq!(
            normalize_remote_url("https://github.com/user/repo"),
            "https://github.com/user/repo"
        );
    }

    #[test]
    fn list_stack_works_on_real_repo() {
        let cwd = env!("CARGO_MANIFEST_DIR").to_string();
        let result = git_list_stack(cwd);
        // Should succeed on any git repo
        assert!(result.is_ok());
        let stack = result.unwrap();
        assert!(!stack.base_branch.is_empty());
        assert!(!stack.entries.is_empty());
        // At least one entry should be current
        assert!(stack.entries.iter().any(|e| e.is_current));
    }
}
