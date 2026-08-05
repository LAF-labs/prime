//! Shared git command utilities.
//!
//! Provides a common `run_git_cmd` helper used by `pr_ai`, `git_stack`,
//! `branch_ai`, and other modules that shell out to `git`.

use std::process::Command;
use tokio::process::Command as AsyncCommand;

use super::error::AppError;

/// Run a synchronous git command and return trimmed stdout on success.
///
/// Prefer `run_git_cmd_async` in `async` Tauri commands to avoid blocking
/// the async runtime.
pub fn run_git_cmd(cwd: &str, args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(AppError::Other(format!("git {} failed: {stderr}", args.join(" "))))
    }
}

/// Run an async git command and return trimmed stdout on success.
///
/// Uses `tokio::process::Command` so it doesn't block the Tauri async runtime.
/// Use this in `async fn` Tauri commands.
pub async fn run_git_cmd_async(cwd: &str, args: &[&str]) -> Result<String, AppError> {
    let output = AsyncCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(AppError::Other(format!("git {} failed: {stderr}", args.join(" "))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_git_cmd_succeeds_on_version() {
        let result = run_git_cmd(".", &["--version"]);
        assert!(result.is_ok());
        assert!(result.unwrap().contains("git version"));
    }

    #[test]
    fn run_git_cmd_fails_on_invalid_command() {
        let result = run_git_cmd(".", &["not-a-real-command"]);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn run_git_cmd_async_succeeds_on_version() {
        let result = run_git_cmd_async(".", &["--version"]).await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("git version"));
    }
}
