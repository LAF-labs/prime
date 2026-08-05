//! AI-powered thread title generation.
//!
//! After the first turn completes, the frontend calls this command to generate
//! a concise 3–8 word title from the user's initial message. Uses the same
//! `kiro-cli chat --no-interactive` one-shot pattern as commit message
//! generation.

use serde::{Deserialize, Serialize};

use super::error::AppError;
use super::git_ai::{extract_first_json_object, extract_json_object_with_key, run_kiro_oneshot};
use super::settings::SettingsState;

/// Maximum title length in characters.
const MAX_TITLE_CHARS: usize = 60;

/// Public payload returned to the renderer.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedThreadTitle {
    pub title: String,
}

/// Internal — what we expect the model to emit.
#[derive(Deserialize, Debug)]
struct TitleModelOutput {
    #[serde(default)]
    title: String,
}

/// Tauri command — generate a thread title from the user's first message.
#[tauri::command]
pub async fn generate_thread_title(
    settings_state: tauri::State<'_, SettingsState>,
    message: String,
    workspace: String,
) -> Result<GeneratedThreadTitle, AppError> {
    let (kiro_bin, custom_instructions) = {
        let settings = settings_state.0.lock();
        let instructions = settings.settings.project_prefs
            .as_ref()
            .and_then(|p| p.get(&workspace))
            .and_then(|pp| pp.text_generation_policy.as_ref())
            .and_then(|pol| pol.thread_title_instructions.clone());
        (settings.settings.kiro_bin.clone(), instructions)
    };

    if message.trim().is_empty() {
        return Ok(GeneratedThreadTitle {
            title: "New thread".to_string(),
        });
    }

    let prompt = build_title_prompt(&message, custom_instructions.as_deref());
    let raw_output = run_kiro_oneshot(&kiro_bin, &workspace, &prompt).await?;
    let parsed = parse_title_response(&raw_output)?;
    Ok(sanitize_title(parsed))
}

// ── Prompt ───────────────────────────────────────────────────────────────

/// Strip `<image src="data:..." />` tags from a message. Preserves any
/// `[Attached image: ...]` annotations so the model knows an image was present.
fn strip_image_data(message: &str) -> String {
    let mut result = String::with_capacity(message.len());
    let mut rest = message;
    while let Some(start) = rest.find("<image src=\"data:") {
        result.push_str(&rest[..start]);
        // Find the closing `/>` after the tag start
        if let Some(end) = rest[start..].find("/>") {
            rest = &rest[start + end + 2..];
        } else {
            // Malformed tag — skip the rest
            break;
        }
    }
    result.push_str(rest);
    result.trim().to_string()
}

fn build_title_prompt(message: &str, custom_instructions: Option<&str>) -> String {
    // Strip base64 image tags before truncation so they don't fill the budget
    let cleaned = strip_image_data(message);
    let message = if cleaned.is_empty() { "[Image attachment]" } else { &cleaned };

    // Cap the message to avoid blowing up the context for very long prompts
    let truncated = if message.len() > 2000 {
        // Find a char boundary at or before 2000 bytes
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
        "You write concise thread titles for coding conversations.\n\
        Return ONLY a single JSON object on one line with key: title.\n\
        Do not wrap the JSON in markdown code fences. Do not add commentary before or after.\n\
        Rules:\n\
        - Title should summarize the user's request, not restate it verbatim.\n\
        - Keep it short and specific (3-8 words).\n\
        - Avoid quotes, filler, prefixes like \"Title:\" and trailing punctuation.\n\
        - If the message references files or code, mention the relevant subject.\n\
        - DO NOT speak in the first person.\n\
        {extra}\n\
        User message:\n\
        {truncated}\n",
    )
}

// ── Output parsing ───────────────────────────────────────────────────────

fn parse_title_response(raw: &str) -> Result<TitleModelOutput, AppError> {
    // Prefer a JSON object that actually contains `"title"` so we skip past
    // any chrome-printed brace blocks (e.g. `{MCPSERVERNAME}` in a kiro-cli
    // warning). Falls back to any valid JSON, then to the first balanced
    // block for diagnostic preview text.
    let block = extract_json_object_with_key(raw, "title")
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
            "Could not find JSON in agent output for title generation. Got:\n{}",
            preview
        ))
    })?;

    serde_json::from_str::<TitleModelOutput>(&block).map_err(|e| {
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
            "Failed to parse title JSON: {e}. Got: {}",
            preview
        ))
    })
}

// ── Sanitization ─────────────────────────────────────────────────────────

fn sanitize_title(parsed: TitleModelOutput) -> GeneratedThreadTitle {
    let raw = parsed
        .title
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .trim_end_matches('.')
        .trim()
        .to_string();

    let title = if raw.is_empty() {
        "New thread".to_string()
    } else if raw.chars().count() > MAX_TITLE_CHARS {
        let mut acc = String::new();
        for (i, ch) in raw.chars().enumerate() {
            if i >= MAX_TITLE_CHARS - 1 {
                break;
            }
            acc.push(ch);
        }
        format!("{}\u{2026}", acc.trim_end())
    } else {
        raw
    };

    GeneratedThreadTitle { title }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_includes_message() {
        let p = build_title_prompt("Fix the login bug", None);
        assert!(p.contains("Fix the login bug"));
        assert!(p.contains("title"));
        assert!(p.contains("3-8 words"));
    }

    #[test]
    fn build_prompt_truncates_long_messages() {
        let long = "a".repeat(5000);
        let p = build_title_prompt(&long, None);
        assert!(p.len() < 3000);
    }

    #[test]
    fn build_prompt_contains_rules() {
        let p = build_title_prompt("Fix bug", None);
        assert!(p.contains("3-8 words"));
        assert!(p.contains("Fix bug"));
    }

    #[test]
    fn build_prompt_includes_custom_instructions() {
        let p = build_title_prompt("Fix bug", Some("Always prefix with JIRA ticket"));
        assert!(p.contains("Additional instructions:"));
        assert!(p.contains("Always prefix with JIRA ticket"));
    }

    #[test]
    fn parse_title_response_extracts_json() {
        let raw = "📷 Checkpoints\n\n{\"title\":\"Fix login redirect bug\"}\n\n▸ Credits: 0.01\n";
        let parsed = parse_title_response(raw).unwrap();
        assert_eq!(parsed.title, "Fix login redirect bug");
    }

    #[test]
    fn parse_title_response_errors_on_no_json() {
        let raw = "some error output without json";
        assert!(parse_title_response(raw).is_err());
    }

    #[test]
    fn parse_title_response_skips_kiro_cli_warning_brace_block() {
        // Regression: real kiro-cli output prints a `{MCPSERVERNAME}` token
        // in a `--trust-tools` warning before the actual JSON answer. The
        // previous parser latched onto that and failed every title gen.
        let raw = "WARNING: --trust-tools arg for custom tool needs to be \
                   prepended with @{MCPSERVERNAME}/\nCheckpoints are not \
                   available in this directory. Use '/checkpoint init' to \
                   enable checkpoints.\n> {\"title\":\"Fix login bug\"}\n \
                   ▸ Credits: 0.04 • Time: 2s\n";
        let parsed = parse_title_response(raw).unwrap();
        assert_eq!(parsed.title, "Fix login bug");
    }

    #[test]
    fn parse_title_response_picks_titled_object_over_unrelated_json() {
        // Defensive: even if some chrome contains valid JSON without our
        // key, prefer the object that actually has `title`.
        let raw = "{\"meta\":\"ignore me\"}\n\n{\"title\":\"Real title\"}\n";
        let parsed = parse_title_response(raw).unwrap();
        assert_eq!(parsed.title, "Real title");
    }

    #[test]
    fn sanitize_strips_quotes_and_period() {
        let parsed = TitleModelOutput {
            title: "\"Fix login bug.\"".to_string(),
        };
        let out = sanitize_title(parsed);
        assert_eq!(out.title, "Fix login bug");
    }

    #[test]
    fn sanitize_caps_at_max_chars() {
        let long = "a".repeat(100);
        let parsed = TitleModelOutput { title: long };
        let out = sanitize_title(parsed);
        assert!(out.title.chars().count() <= MAX_TITLE_CHARS);
        assert!(out.title.ends_with('\u{2026}'));
    }

    #[test]
    fn sanitize_falls_back_when_empty() {
        let parsed = TitleModelOutput {
            title: "   ".to_string(),
        };
        let out = sanitize_title(parsed);
        assert_eq!(out.title, "New thread");
    }

    #[test]
    fn strip_image_data_removes_base64_tags() {
        let input = "Fix bug\n<image src=\"data:image/png;base64,iVBORw0KGgo...\" />";
        let actual = strip_image_data(input);
        assert_eq!(actual, "Fix bug");
    }

    #[test]
    fn strip_image_data_preserves_annotation() {
        let input = "[Attached image: shot.png (image/png, 5000 bytes)]\n<image src=\"data:image/png;base64,abc\" />";
        let actual = strip_image_data(input);
        assert!(actual.contains("[Attached image:"));
        assert!(!actual.contains("data:image"));
    }

    #[test]
    fn strip_image_data_returns_empty_for_image_only() {
        let input = "<image src=\"data:image/png;base64,abc123\" />";
        let actual = strip_image_data(input);
        assert!(actual.is_empty());
    }

    #[test]
    fn build_title_prompt_strips_image_data() {
        let msg = "Fix login\n<image src=\"data:image/png;base64,longdata\" />";
        let prompt = build_title_prompt(msg, None);
        assert!(prompt.contains("Fix login"));
        assert!(!prompt.contains("data:image"));
    }

    #[test]
    fn build_title_prompt_uses_fallback_for_image_only() {
        let msg = "<image src=\"data:image/png;base64,abc\" />";
        let prompt = build_title_prompt(msg, None);
        assert!(prompt.contains("[Image attachment]"));
    }
}
