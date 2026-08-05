//! AI-powered branch name generation.
//!
//! After the first turn completes on a worktree thread, the frontend calls
//! this command to generate a semantic branch name from the user's initial
//! message. If the current branch is still the user-provided slug, it gets
//! renamed to the generated name.

use serde::{Deserialize, Serialize};

use super::error::AppError;
use super::git_ai::{extract_first_json_object, extract_json_object_with_key, run_kiro_oneshot};
use super::settings::SettingsState;

/// Maximum branch name length.
const MAX_BRANCH_CHARS: usize = 50;

/// Public payload returned to the renderer.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedBranchName {
    pub branch: String,
}

/// Internal — what we expect the model to emit.
#[derive(Deserialize, Debug)]
struct BranchModelOutput {
    #[serde(default)]
    branch: String,
}

/// Tauri command — generate a branch name from the user's first message.
#[tauri::command]
pub async fn generate_branch_name(
    settings_state: tauri::State<'_, SettingsState>,
    message: String,
    workspace: String,
) -> Result<GeneratedBranchName, AppError> {
    let (kiro_bin, custom_instructions) = {
        let settings = settings_state.0.lock();
        let instructions = settings.settings.project_prefs
            .as_ref()
            .and_then(|p| p.get(&workspace))
            .and_then(|pp| pp.text_generation_policy.as_ref())
            .and_then(|pol| pol.branch_instructions.clone());
        (settings.settings.kiro_bin.clone(), instructions)
    };

    if message.trim().is_empty() {
        return Ok(GeneratedBranchName {
            branch: "feature-branch".to_string(),
        });
    }

    let prompt = build_branch_prompt(&message, custom_instructions.as_deref());
    let raw_output = run_kiro_oneshot(&kiro_bin, &workspace, &prompt).await?;
    let parsed = parse_branch_response(&raw_output)?;
    Ok(sanitize_branch(parsed))
}

/// Tauri command — rename a git branch in a worktree.
#[tauri::command]
pub async fn rename_worktree_branch(
    cwd: String,
    old_branch: String,
    new_branch: String,
) -> Result<GeneratedBranchName, AppError> {
    use super::git_utils::run_git_cmd_async;

    run_git_cmd_async(&cwd, &["branch", "-m", &old_branch, &new_branch]).await?;

    Ok(GeneratedBranchName { branch: new_branch })
}

// ── Prompt ───────────────────────────────────────────────────────────────

/// Strip `<image src="data:..." />` tags from a message.
fn strip_image_data(message: &str) -> String {
    let mut result = String::with_capacity(message.len());
    let mut rest = message;
    while let Some(start) = rest.find("<image src=\"data:") {
        result.push_str(&rest[..start]);
        if let Some(end) = rest[start..].find("/>") {
            rest = &rest[start + end + 2..];
        } else {
            break;
        }
    }
    result.push_str(rest);
    result.trim().to_string()
}

fn build_branch_prompt(message: &str, custom_instructions: Option<&str>) -> String {
    let cleaned = strip_image_data(message);
    let message = if cleaned.is_empty() { "[Image attachment]" } else { &cleaned };

    let truncated = if message.len() > 2000 {
        let mut end = 2000;
        while end > 0 && !message.is_char_boundary(end) {
            end -= 1;
        }
        &message[..end]
    } else {
        message
    };

    let extra = custom_instructions
        .map(|i| format!("\nAdditional instructions:\n{i}\n"))
        .unwrap_or_default();

    format!(
        "You generate concise git branch names.\n\
        Return ONLY a single JSON object on one line with key: branch.\n\
        Do not wrap the JSON in markdown code fences. Do not add commentary before or after.\n\
        Rules:\n\
        - Branch should describe the requested work from the user message.\n\
        - Keep it short and specific (2-6 words, joined by hyphens).\n\
        - Use lowercase, plain words only. No issue prefixes, no punctuation.\n\
        - Use hyphens to separate words (e.g. fix-login-redirect).\n\
        - No slashes, spaces, or special characters.\n\
        {extra}\
        \n\
        User message:\n\
        {truncated}\n",
    )
}

// ── Output parsing ───────────────────────────────────────────────────────

fn parse_branch_response(raw: &str) -> Result<BranchModelOutput, AppError> {
    // Prefer a JSON object that contains `"branch"` so a kiro-cli warning
    // such as `@{MCPSERVERNAME}/` doesn't get parsed as the answer.
    let block = extract_json_object_with_key(raw, "branch")
        .or_else(|| extract_first_json_object(raw))
        .ok_or_else(|| {
        let preview = if raw.len() > 400 {
            let mut end = 400;
            while end > 0 && !raw.is_char_boundary(end) {
                end -= 1;
            }
            &raw[..end]
        } else {
            raw
        };
        AppError::Other(format!(
            "Could not find JSON in agent output for branch name generation. Got:\n{}",
            preview
        ))
    })?;

    serde_json::from_str::<BranchModelOutput>(&block).map_err(|e| {
        let preview = if block.len() > 200 {
            let mut end = 200;
            while end > 0 && !block.is_char_boundary(end) {
                end -= 1;
            }
            &block[..end]
        } else {
            &block
        };
        AppError::Other(format!(
            "Failed to parse branch name JSON: {e}. Got: {}",
            preview
        ))
    })
}

// ── Sanitization ─────────────────────────────────────────────────────────

fn sanitize_branch(parsed: BranchModelOutput) -> GeneratedBranchName {
    let raw = parsed.branch.trim().to_lowercase();

    // Remove any characters that aren't valid in branch names
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            'a'..='z' | '0'..='9' | '-' | '_' | '.' => c,
            ' ' | '/' | '\\' => '-',
            _ => '-',
        })
        .collect();

    // Collapse multiple hyphens and trim leading/trailing hyphens
    let mut result = String::new();
    let mut last_was_hyphen = true; // start true to trim leading
    for ch in cleaned.chars() {
        if ch == '-' {
            if !last_was_hyphen {
                result.push('-');
                last_was_hyphen = true;
            }
        } else {
            result.push(ch);
            last_was_hyphen = false;
        }
    }
    let result = result.trim_end_matches('-').to_string();

    let branch = if result.is_empty() {
        "feature-branch".to_string()
    } else if result.len() > MAX_BRANCH_CHARS {
        // Truncate at a hyphen boundary if possible
        let truncated = &result[..MAX_BRANCH_CHARS];
        match truncated.rfind('-') {
            Some(pos) if pos > 10 => truncated[..pos].to_string(),
            _ => truncated.trim_end_matches('-').to_string(),
        }
    } else {
        result
    };

    GeneratedBranchName { branch }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_includes_message() {
        let p = build_branch_prompt("Fix the login redirect bug", None);
        assert!(p.contains("Fix the login redirect bug"));
        assert!(p.contains("branch"));
        assert!(p.contains("2-6 words"));
    }

    #[test]
    fn build_prompt_includes_custom_instructions() {
        let p = build_branch_prompt("Fix bug", Some("Always prefix with feat/"));
        assert!(p.contains("Additional instructions:"));
        assert!(p.contains("Always prefix with feat/"));
    }

    #[test]
    fn parse_branch_response_extracts_json() {
        let raw = "📷 Checkpoints\n\n{\"branch\":\"fix-login-redirect\"}\n\n▸ Credits: 0.01\n";
        let parsed = parse_branch_response(raw).unwrap();
        assert_eq!(parsed.branch, "fix-login-redirect");
    }

    #[test]
    fn parse_branch_response_skips_kiro_cli_warning_brace_block() {
        // Regression: kiro-cli's `--trust-tools` warning prints a
        // `{MCPSERVERNAME}` token before the answer. Make sure the parser
        // walks past it.
        let raw = "WARNING: --trust-tools arg for custom tool needs to be \
                   prepended with @{MCPSERVERNAME}/\n\
                   > {\"branch\":\"fix-login-bug\"}\n";
        let parsed = parse_branch_response(raw).unwrap();
        assert_eq!(parsed.branch, "fix-login-bug");
    }

    #[test]
    fn sanitize_lowercases_and_cleans() {
        let parsed = BranchModelOutput {
            branch: "Fix Login Redirect Bug".to_string(),
        };
        let out = sanitize_branch(parsed);
        assert_eq!(out.branch, "fix-login-redirect-bug");
    }

    #[test]
    fn sanitize_removes_special_chars() {
        let parsed = BranchModelOutput {
            branch: "feat/fix@login#bug!".to_string(),
        };
        let out = sanitize_branch(parsed);
        assert_eq!(out.branch, "feat-fix-login-bug");
    }

    #[test]
    fn sanitize_collapses_hyphens() {
        let parsed = BranchModelOutput {
            branch: "fix---login---bug".to_string(),
        };
        let out = sanitize_branch(parsed);
        assert_eq!(out.branch, "fix-login-bug");
    }

    #[test]
    fn sanitize_caps_length() {
        let long = "a-".repeat(40);
        let parsed = BranchModelOutput { branch: long };
        let out = sanitize_branch(parsed);
        assert!(out.branch.len() <= MAX_BRANCH_CHARS);
    }

    #[test]
    fn sanitize_falls_back_when_empty() {
        let parsed = BranchModelOutput {
            branch: "   ".to_string(),
        };
        let out = sanitize_branch(parsed);
        assert_eq!(out.branch, "feature-branch");
    }

    #[test]
    fn strip_image_data_removes_base64_tags() {
        let input = "Fix login\n<image src=\"data:image/png;base64,abc123\" />";
        let actual = strip_image_data(input);
        assert_eq!(actual, "Fix login");
    }

    #[test]
    fn strip_image_data_returns_empty_for_image_only() {
        let input = "<image src=\"data:image/png;base64,abc\" />";
        let actual = strip_image_data(input);
        assert!(actual.is_empty());
    }

    #[test]
    fn build_branch_prompt_strips_image_data() {
        let msg = "Add dark mode\n<image src=\"data:image/png;base64,longdata\" />";
        let prompt = build_branch_prompt(msg, None);
        assert!(prompt.contains("Add dark mode"));
        assert!(!prompt.contains("data:image"));
    }

    #[test]
    fn build_branch_prompt_uses_fallback_for_image_only() {
        let msg = "<image src=\"data:image/png;base64,abc\" />";
        let prompt = build_branch_prompt(msg, None);
        assert!(prompt.contains("[Image attachment]"));
    }
}
