//! AI-powered PR/MR content generation.
//!
//! Generates a PR title and body from the diff between the current branch
//! and a base branch. Uses the same `kiro-cli chat --no-interactive` one-shot
//! pattern as commit message generation.

use serde::{Deserialize, Serialize};

use super::error::AppError;
use super::git_ai::{extract_first_json_object, extract_json_object_with_key, run_kiro_oneshot};
use super::git_utils::run_git_cmd_async;
use super::settings::SettingsState;

/// Maximum diff bytes to feed the model for PR generation.
const MAX_PR_DIFF_BYTES: usize = 40_000;

/// Public payload returned to the renderer.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedPrContent {
    pub title: String,
    pub body: String,
}

/// Internal — what we expect the model to emit.
#[derive(Deserialize, Debug)]
struct PrModelOutput {
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: String,
}

/// Tauri command — generate PR title and body for the current branch.
#[tauri::command]
pub async fn generate_pr_content(
    settings_state: tauri::State<'_, SettingsState>,
    cwd: String,
    base_branch: String,
    workspace: Option<String>,
) -> Result<GeneratedPrContent, AppError> {
    let (kiro_bin, custom_instructions) = {
        let settings = settings_state.0.lock();
        // Look up policy by workspace (original project root) first, then cwd
        let lookup_key = workspace.as_deref().unwrap_or(&cwd);
        let instructions = settings.settings.project_prefs
            .as_ref()
            .and_then(|p| p.get(lookup_key).or_else(|| p.get(&*cwd)))
            .and_then(|pp| pp.text_generation_policy.as_ref())
            .and_then(|pol| pol.pr_instructions.clone());
        (settings.settings.kiro_bin.clone(), instructions)
    };

    let (head_branch, commit_log, diff_stat, diff_patch) = collect_pr_context(&cwd, &base_branch).await?;

    if diff_patch.trim().is_empty() && commit_log.trim().is_empty() {
        return Err(AppError::Other(
            "No changes between branches. Nothing to summarize.".to_string(),
        ));
    }

    let prompt = build_pr_prompt(
        &base_branch,
        &head_branch,
        &commit_log,
        &diff_stat,
        &diff_patch,
        custom_instructions.as_deref(),
    );

    let raw_output = run_kiro_oneshot(&kiro_bin, &cwd, &prompt).await?;
    let parsed = parse_pr_response(&raw_output)?;
    Ok(sanitize_pr(parsed))
}

// ── Context collection ───────────────────────────────────────────────────

/// Collect PR context: head branch, commit log, diff stat, and diff patch.
/// Uses async git commands to avoid blocking the Tauri runtime.
async fn collect_pr_context(
    cwd: &str,
    base_branch: &str,
) -> Result<(String, String, String, String), AppError> {
    // Get current branch name
    let head_branch = run_git_cmd_async(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;

    // Get commit log between base and head
    let range = format!("{base_branch}..HEAD");
    let commit_log = run_git_cmd_async(cwd, &["log", "--oneline", "--no-decorate", &range]).await
        .unwrap_or_default();

    // Get diff stat and diff patch in parallel
    let range_clone = range.clone();
    let cwd_owned = cwd.to_string();
    let cwd_owned2 = cwd.to_string();

    let (diff_stat, diff_patch) = tokio::join!(
        async { run_git_cmd_async(&cwd_owned, &["diff", "--stat", &range_clone]).await.unwrap_or_default() },
        async { run_git_cmd_async(&cwd_owned2, &["diff", &range]).await.unwrap_or_default() },
    );

    // Truncate diff if too large
    let truncated_patch = if diff_patch.len() > MAX_PR_DIFF_BYTES {
        let mut end = MAX_PR_DIFF_BYTES;
        while end > 0 && !diff_patch.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n\n... [diff truncated for length] ...", &diff_patch[..end])
    } else {
        diff_patch
    };

    Ok((head_branch, commit_log, diff_stat, truncated_patch))
}

// ── Prompt ───────────────────────────────────────────────────────────────

fn build_pr_prompt(
    base_branch: &str,
    head_branch: &str,
    commit_log: &str,
    diff_stat: &str,
    diff_patch: &str,
    custom_instructions: Option<&str>,
) -> String {
    let extra = custom_instructions
        .map(|i| format!("\nAdditional instructions:\n{i}\n"))
        .unwrap_or_default();

    // Limit sections to avoid blowing up context
    let commits = if commit_log.len() > 6000 {
        let mut end = 6000;
        while end > 0 && !commit_log.is_char_boundary(end) { end -= 1; }
        &commit_log[..end]
    } else {
        commit_log
    };

    let stat = if diff_stat.len() > 4000 {
        let mut end = 4000;
        while end > 0 && !diff_stat.is_char_boundary(end) { end -= 1; }
        &diff_stat[..end]
    } else {
        diff_stat
    };

    format!(
        "You write GitHub pull request content.\n\
        Return ONLY a single JSON object on one line with keys: title, body.\n\
        Do not wrap the JSON in markdown code fences. Do not add commentary before or after.\n\
        Rules:\n\
        - title should be concise and specific (like a good commit subject)\n\
        - body must be markdown with headings '## Summary' and '## Changes'\n\
        - under Summary, provide 1-3 sentences describing the overall change\n\
        - under Changes, provide short bullet points of what was done\n\
        - be factual — only describe changes visible in the diff\n\
        {extra}\
        \n\
        Base branch: {base_branch}\n\
        Head branch: {head_branch}\n\
        \n\
        Commits:\n\
        {commits}\n\
        \n\
        Diff stat:\n\
        {stat}\n\
        \n\
        Diff patch:\n\
        {diff_patch}\n",
    )
}

// ── Output parsing ───────────────────────────────────────────────────────

fn parse_pr_response(raw: &str) -> Result<PrModelOutput, AppError> {
    // Prefer a JSON object that contains `"title"` (or `"body"`) so a kiro-cli
    // warning like `@{MCPSERVERNAME}/` doesn't get parsed as the answer.
    let block = extract_json_object_with_key(raw, "title")
        .or_else(|| extract_json_object_with_key(raw, "body"))
        .or_else(|| extract_first_json_object(raw))
        .ok_or_else(|| {
        let preview = if raw.len() > 400 {
            let mut end = 400;
            while end > 0 && !raw.is_char_boundary(end) { end -= 1; }
            &raw[..end]
        } else {
            raw
        };
        AppError::Other(format!(
            "Could not find JSON in agent output for PR generation. Got:\n{}",
            preview
        ))
    })?;

    serde_json::from_str::<PrModelOutput>(&block).map_err(|e| {
        let preview = if block.len() > 200 {
            let mut end = 200;
            while end > 0 && !block.is_char_boundary(end) { end -= 1; }
            &block[..end]
        } else {
            &block
        };
        AppError::Other(format!(
            "Failed to parse PR content JSON: {e}. Got: {}",
            preview
        ))
    })
}

// ── Sanitization ─────────────────────────────────────────────────────────

fn sanitize_pr(parsed: PrModelOutput) -> GeneratedPrContent {
    let title = parsed.title
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("Update")
        .trim()
        .trim_matches('"')
        .trim_end_matches('.')
        .to_string();

    let body = parsed.body.trim().to_string();

    GeneratedPrContent {
        title: if title.is_empty() { "Update".to_string() } else { title },
        body: if body.is_empty() { "## Summary\n\nUpdates to the codebase.\n\n## Changes\n\n- Various improvements".to_string() } else { body },
    }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_includes_branches() {
        let p = build_pr_prompt("main", "feat/login", "abc123 Fix login", "1 file changed", "+hello", None);
        assert!(p.contains("Base branch: main"));
        assert!(p.contains("Head branch: feat/login"));
        assert!(p.contains("abc123 Fix login"));
    }

    #[test]
    fn build_prompt_includes_custom_instructions() {
        let p = build_pr_prompt("main", "feat/x", "", "", "", Some("Always mention JIRA ticket"));
        assert!(p.contains("Additional instructions:"));
        assert!(p.contains("Always mention JIRA ticket"));
    }

    #[test]
    fn parse_pr_response_extracts_json() {
        let raw = "📷 Checkpoints\n\n{\"title\":\"Fix login redirect\",\"body\":\"## Summary\\n\\nFixes the redirect.\\n\\n## Changes\\n\\n- Fixed redirect logic\"}\n\n▸ Credits: 0.05";
        let parsed = parse_pr_response(raw).unwrap();
        assert_eq!(parsed.title, "Fix login redirect");
        assert!(parsed.body.contains("## Summary"));
    }

    #[test]
    fn parse_pr_response_skips_kiro_cli_warning_brace_block() {
        // Regression: `{MCPSERVERNAME}` from kiro-cli's `--trust-tools`
        // warning is not valid JSON; the parser must walk past it.
        let raw = "WARNING: --trust-tools arg ... prepended with @{MCPSERVERNAME}/\n\
                   > {\"title\":\"Fix login\",\"body\":\"## Summary\\n\\nFix.\"}\n";
        let parsed = parse_pr_response(raw).unwrap();
        assert_eq!(parsed.title, "Fix login");
        assert!(parsed.body.contains("## Summary"));
    }

    #[test]
    fn sanitize_pr_strips_quotes() {
        let parsed = PrModelOutput {
            title: "\"Fix login.\"".to_string(),
            body: "## Summary\n\nDone.".to_string(),
        };
        let out = sanitize_pr(parsed);
        assert_eq!(out.title, "Fix login");
    }

    #[test]
    fn sanitize_pr_falls_back_on_empty() {
        let parsed = PrModelOutput {
            title: "".to_string(),
            body: "".to_string(),
        };
        let out = sanitize_pr(parsed);
        assert_eq!(out.title, "Update");
        assert!(out.body.contains("## Summary"));
    }
}
