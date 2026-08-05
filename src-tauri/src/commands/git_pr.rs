//! Pull request / merge request creation via CLI tools.
//!
//! Supports GitHub (`gh`) and GitLab (`glab`) CLIs. Detects which provider
//! is available based on the remote URL and installed CLI tools.

use serde::Serialize;
use std::time::Duration;
use tokio::process::Command as AsyncCommand;
use tokio::time::timeout;

use super::error::AppError;
use super::git_utils::run_git_cmd_async;

/// Hard cap on CLI subprocess wall-clock time. PR creation involves network
/// calls and can hang if the remote is unreachable or the CLI prompts for input.
const CLI_TIMEOUT_SECS: u64 = 30;

/// Supported source control providers.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ScProvider {
    Github,
    Gitlab,
}

/// Result of detecting the source control provider.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDetection {
    pub provider: Option<ScProvider>,
    pub cli_available: bool,
    pub remote_url: String,
    pub authenticated: bool,
}

/// Result of creating a PR/MR.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrCreateResult {
    pub provider: ScProvider,
    pub url: String,
    pub number: u32,
    pub title: String,
}

/// Result of checking existing PR status.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrStatus {
    pub has_open_pr: bool,
    pub pr_url: Option<String>,
    pub pr_number: Option<u32>,
    pub pr_title: Option<String>,
    pub pr_state: Option<String>,
}

// ── Provider detection ───────────────────────────────────────────────────

/// Detect the source control provider from the remote URL.
fn detect_provider_from_url(remote_url: &str) -> Option<ScProvider> {
    let url_lower = remote_url.to_lowercase();
    if url_lower.contains("github.com") || url_lower.contains("github.") {
        Some(ScProvider::Github)
    } else if url_lower.contains("gitlab.com") || url_lower.contains("gitlab.") {
        Some(ScProvider::Gitlab)
    } else {
        None
    }
}

/// Check if a CLI tool is available on PATH.
fn cli_exists(name: &str) -> bool {
    which::which(name).is_ok()
}

/// Check if the GitHub CLI is authenticated.
async fn gh_is_authenticated() -> bool {
    let output = timeout(
        Duration::from_secs(CLI_TIMEOUT_SECS),
        AsyncCommand::new("gh").args(["auth", "status"]).output(),
    )
    .await;
    matches!(output, Ok(Ok(o)) if o.status.success())
}

/// Check if the GitLab CLI is authenticated.
async fn glab_is_authenticated() -> bool {
    let output = timeout(
        Duration::from_secs(CLI_TIMEOUT_SECS),
        AsyncCommand::new("glab").args(["auth", "status"]).output(),
    )
    .await;
    matches!(output, Ok(Ok(o)) if o.status.success())
}

// ── Tauri commands ───────────────────────────────────────────────────────

/// Detect the source control provider for a repository.
#[tauri::command]
pub async fn git_detect_provider(cwd: String) -> Result<ProviderDetection, AppError> {
    let remote_url = run_git_cmd_async(&cwd, &["remote", "get-url", "origin"])
        .await
        .unwrap_or_default();

    let provider = detect_provider_from_url(&remote_url);

    let (cli_available, authenticated) = match &provider {
        Some(ScProvider::Github) => {
            let available = cli_exists("gh");
            let authed = if available { gh_is_authenticated().await } else { false };
            (available, authed)
        }
        Some(ScProvider::Gitlab) => {
            let available = cli_exists("glab");
            let authed = if available { glab_is_authenticated().await } else { false };
            (available, authed)
        }
        None => (false, false),
    };

    Ok(ProviderDetection {
        provider,
        cli_available,
        remote_url,
        authenticated,
    })
}

/// Create a pull request / merge request.
///
/// Uses `gh pr create` for GitHub or `glab mr create` for GitLab.
/// The branch must already be pushed to the remote.
#[tauri::command]
pub async fn git_create_pr(
    cwd: String,
    title: String,
    body: String,
    base: String,
    draft: Option<bool>,
) -> Result<PrCreateResult, AppError> {
    let remote_url = run_git_cmd_async(&cwd, &["remote", "get-url", "origin"])
        .await
        .unwrap_or_default();

    let provider = detect_provider_from_url(&remote_url)
        .ok_or_else(|| AppError::Other(
            "Could not detect provider from remote URL. Only GitHub and GitLab are supported.".to_string()
        ))?;

    match provider {
        ScProvider::Github => create_github_pr(&cwd, &title, &body, &base, draft.unwrap_or(false)).await,
        ScProvider::Gitlab => create_gitlab_mr(&cwd, &title, &body, &base, draft.unwrap_or(false)).await,
    }
}

/// Check if the current branch already has an open PR/MR.
#[tauri::command]
pub async fn git_pr_status(cwd: String) -> Result<PrStatus, AppError> {
    let remote_url = run_git_cmd_async(&cwd, &["remote", "get-url", "origin"])
        .await
        .unwrap_or_default();

    let provider = detect_provider_from_url(&remote_url);

    match provider {
        Some(ScProvider::Github) => check_github_pr_status(&cwd).await,
        Some(ScProvider::Gitlab) => check_gitlab_mr_status(&cwd).await,
        None => Ok(PrStatus {
            has_open_pr: false,
            pr_url: None,
            pr_number: None,
            pr_title: None,
            pr_state: None,
        }),
    }
}

/// Open the PR/MR URL in the default browser.
#[tauri::command]
pub async fn git_pr_open_in_browser(cwd: String) -> Result<(), AppError> {
    let remote_url = run_git_cmd_async(&cwd, &["remote", "get-url", "origin"])
        .await
        .unwrap_or_default();

    let provider = detect_provider_from_url(&remote_url);

    match provider {
        Some(ScProvider::Github) => {
            let output = timeout(
                Duration::from_secs(CLI_TIMEOUT_SECS),
                AsyncCommand::new("gh").args(["pr", "view", "--web"]).current_dir(&cwd).output(),
            )
            .await
            .map_err(|_| AppError::Other("gh pr view --web timed out".to_string()))?
            .map_err(|e| AppError::Other(format!("Failed to spawn gh: {e}")))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(AppError::Other(format!("gh pr view --web failed: {stderr}")));
            }
            Ok(())
        }
        Some(ScProvider::Gitlab) => {
            let output = timeout(
                Duration::from_secs(CLI_TIMEOUT_SECS),
                AsyncCommand::new("glab").args(["mr", "view", "--web"]).current_dir(&cwd).output(),
            )
            .await
            .map_err(|_| AppError::Other("glab mr view --web timed out".to_string()))?
            .map_err(|e| AppError::Other(format!("Failed to spawn glab: {e}")))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(AppError::Other(format!("glab mr view --web failed: {stderr}")));
            }
            Ok(())
        }
        None => Err(AppError::Other("No supported provider detected".to_string())),
    }
}

// ── GitHub implementation ────────────────────────────────────────────────

async fn create_github_pr(
    cwd: &str,
    title: &str,
    body: &str,
    base: &str,
    draft: bool,
) -> Result<PrCreateResult, AppError> {
    if !cli_exists("gh") {
        return Err(AppError::Other(
            "GitHub CLI (gh) is not installed. Install it with: brew install gh".to_string()
        ));
    }

    let mut args = vec!["pr", "create", "--title", title, "--body", body, "--base", base];
    if draft {
        args.push("--draft");
    }

    let output = timeout(
        Duration::from_secs(CLI_TIMEOUT_SECS),
        AsyncCommand::new("gh").args(&args).current_dir(cwd).output(),
    )
    .await
    .map_err(|_| AppError::Other(format!("gh pr create timed out after {CLI_TIMEOUT_SECS}s")))?
    .map_err(|e| AppError::Other(format!("Failed to spawn gh: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Other(format!("gh pr create failed: {stderr}")));
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Extract PR number from URL (e.g., https://github.com/owner/repo/pull/42)
    let number = url
        .rsplit('/')
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    Ok(PrCreateResult {
        provider: ScProvider::Github,
        url,
        number,
        title: title.to_string(),
    })
}

async fn check_github_pr_status(cwd: &str) -> Result<PrStatus, AppError> {
    if !cli_exists("gh") {
        return Ok(PrStatus {
            has_open_pr: false,
            pr_url: None,
            pr_number: None,
            pr_title: None,
            pr_state: None,
        });
    }

    let output = timeout(
        Duration::from_secs(CLI_TIMEOUT_SECS),
        AsyncCommand::new("gh")
            .args(["pr", "view", "--json", "url,number,title,state"])
            .current_dir(cwd)
            .output(),
    )
    .await
    .map_err(|_| AppError::Other("gh pr view timed out".to_string()))?
    .map_err(|e| AppError::Other(format!("Failed to spawn gh: {e}")))?;

    if !output.status.success() {
        // No PR exists for this branch — that's fine
        return Ok(PrStatus {
            has_open_pr: false,
            pr_url: None,
            pr_number: None,
            pr_title: None,
            pr_state: None,
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| AppError::Other(format!("Failed to parse gh output: {e}")))?;

    let state = parsed["state"].as_str().unwrap_or("").to_string();
    let is_open = state == "OPEN";

    Ok(PrStatus {
        has_open_pr: is_open,
        pr_url: parsed["url"].as_str().map(String::from),
        pr_number: parsed["number"].as_u64().map(|n| n as u32),
        pr_title: parsed["title"].as_str().map(String::from),
        pr_state: Some(state),
    })
}

// ── GitLab implementation ────────────────────────────────────────────────

async fn create_gitlab_mr(
    cwd: &str,
    title: &str,
    body: &str,
    base: &str,
    draft: bool,
) -> Result<PrCreateResult, AppError> {
    if !cli_exists("glab") {
        return Err(AppError::Other(
            "GitLab CLI (glab) is not installed. Install it with: brew install glab".to_string()
        ));
    }

    let effective_title = if draft {
        format!("Draft: {title}")
    } else {
        title.to_string()
    };

    let output = timeout(
        Duration::from_secs(CLI_TIMEOUT_SECS),
        AsyncCommand::new("glab")
            .args([
                "mr", "create",
                "--title", &effective_title,
                "--description", body,
                "--target-branch", base,
                "--no-editor",
            ])
            .current_dir(cwd)
            .output(),
    )
    .await
    .map_err(|_| AppError::Other(format!("glab mr create timed out after {CLI_TIMEOUT_SECS}s")))?
    .map_err(|e| AppError::Other(format!("Failed to spawn glab: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Other(format!("glab mr create failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // glab outputs the MR URL on success
    let url = stdout
        .lines()
        .find(|l| l.starts_with("http"))
        .unwrap_or(&stdout)
        .to_string();

    // Extract MR number from URL
    let number = url
        .rsplit('/')
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    Ok(PrCreateResult {
        provider: ScProvider::Gitlab,
        url,
        number,
        title: effective_title,
    })
}

async fn check_gitlab_mr_status(cwd: &str) -> Result<PrStatus, AppError> {
    if !cli_exists("glab") {
        return Ok(PrStatus {
            has_open_pr: false,
            pr_url: None,
            pr_number: None,
            pr_title: None,
            pr_state: None,
        });
    }

    // Get current branch
    let branch = run_git_cmd_async(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .unwrap_or_default();

    let output = timeout(
        Duration::from_secs(CLI_TIMEOUT_SECS),
        AsyncCommand::new("glab")
            .args(["mr", "view", &branch, "--output", "json"])
            .current_dir(cwd)
            .output(),
    )
    .await
    .map_err(|_| AppError::Other("glab mr view timed out".to_string()))?
    .map_err(|e| AppError::Other(format!("Failed to spawn glab: {e}")))?;

    if !output.status.success() {
        return Ok(PrStatus {
            has_open_pr: false,
            pr_url: None,
            pr_number: None,
            pr_title: None,
            pr_state: None,
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| AppError::Other(format!("Failed to parse glab output: {e}")))?;

    let state = parsed["state"].as_str().unwrap_or("").to_string();
    let is_open = state == "opened";

    Ok(PrStatus {
        has_open_pr: is_open,
        pr_url: parsed["web_url"].as_str().map(String::from),
        pr_number: parsed["iid"].as_u64().map(|n| n as u32),
        pr_title: parsed["title"].as_str().map(String::from),
        pr_state: Some(state),
    })
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_github_from_url() {
        assert_eq!(
            detect_provider_from_url("https://github.com/user/repo.git"),
            Some(ScProvider::Github)
        );
        assert_eq!(
            detect_provider_from_url("git@github.com:user/repo.git"),
            Some(ScProvider::Github)
        );
    }

    #[test]
    fn detect_gitlab_from_url() {
        assert_eq!(
            detect_provider_from_url("https://gitlab.com/user/repo.git"),
            Some(ScProvider::Gitlab)
        );
        assert_eq!(
            detect_provider_from_url("git@gitlab.company.com:group/project.git"),
            Some(ScProvider::Gitlab)
        );
    }

    #[test]
    fn detect_unknown_provider() {
        assert_eq!(
            detect_provider_from_url("https://bitbucket.org/user/repo.git"),
            None
        );
        assert_eq!(detect_provider_from_url(""), None);
    }

    #[test]
    fn pr_create_result_serializes_camel_case() {
        let result = PrCreateResult {
            provider: ScProvider::Github,
            url: "https://github.com/user/repo/pull/1".to_string(),
            number: 1,
            title: "Fix bug".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"provider\":\"github\""));
        assert!(json.contains("\"url\""));
    }

    #[test]
    fn pr_status_serializes_camel_case() {
        let status = PrStatus {
            has_open_pr: true,
            pr_url: Some("https://github.com/user/repo/pull/1".to_string()),
            pr_number: Some(1),
            pr_title: Some("Fix bug".to_string()),
            pr_state: Some("OPEN".to_string()),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"hasOpenPr\":true"));
        assert!(json.contains("\"prUrl\""));
        assert!(json.contains("\"prNumber\":1"));
    }
}
