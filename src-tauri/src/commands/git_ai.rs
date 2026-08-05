//! AI-powered git text generation (commit messages, etc.).
//!
//! Spawns the user's configured agent CLI (`kiro-cli chat --no-interactive`)
//! as a one-shot subprocess, hands it a prompt + the staged diff, and parses
//! a JSON response of the shape `{ "subject": "...", "body": "..." }`.
//!
//! Design notes:
//!
//! * The subprocess runs **outside** the user's chat thread so we never touch
//!   the active ACP session or pollute `turn_end`.
//! * No new credential surface — reuses whatever auth `kiro-cli` already has.
//! * The diff is compressed (per-line truncation + iterative shrink) to fit a
//!   conservative byte budget.
//! * The CLI prints a few decorative status lines (`📷 Checkpoints…`,
//!   `▸ Credits: …`, a leading `> ` prompt echo). We extract the JSON from
//!   the body, so it tolerates surrounding chrome.

use std::process::Stdio;
use std::time::Duration;

use git2::{DiffOptions, Repository};
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::time::timeout;

use super::error::AppError;
use super::settings::SettingsState;

/// Maximum number of bytes of diff text we feed the model. Larger diffs are
/// compressed first, then iteratively truncated.
const MAX_DIFF_BYTES: usize = 20_000;

/// Per-line truncation threshold during the first compression pass.
const MAX_LINE_BYTES: usize = 256;

/// Hard cap on the subprocess wall-clock time. Generation should normally take
/// 2–5 seconds; anything longer is almost certainly stuck.
const SUBPROCESS_TIMEOUT_SECS: u64 = 60;

/// Hard cap on the subject line returned to the caller.
const MAX_SUBJECT_CHARS: usize = 72;

/// Public payload returned to the renderer.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedCommitMessage {
    pub subject: String,
    pub body: String,
}

/// Internal — what we expect the model to emit.
#[derive(Deserialize, Debug)]
struct ModelOutput {
    #[serde(default)]
    subject: String,
    #[serde(default)]
    body: String,
}

/// Tauri command — generate a commit message for the working tree at `cwd`.
///
/// Prefers the staged diff (HEAD ↔ index). Falls back to the worktree diff
/// (HEAD ↔ workdir) when nothing is staged.
#[tauri::command]
pub async fn git_generate_commit_message(
    settings_state: tauri::State<'_, SettingsState>,
    cwd: String,
) -> Result<GeneratedCommitMessage, AppError> {
    let (kiro_bin, current_branch, diff_text, custom_instructions) = {
        // Lock + repo work happens synchronously; release before the await.
        let settings = settings_state.0.lock();
        let kiro_bin = settings.settings.kiro_bin.clone();
        let instructions = settings.settings.project_prefs
            .as_ref()
            .and_then(|p| p.get(&cwd))
            .and_then(|pp| pp.text_generation_policy.as_ref())
            .and_then(|pol| pol.commit_instructions.clone());
        let (branch, diff) = collect_diff_for_prompt(&cwd)?;
        (kiro_bin, branch, diff, instructions)
    };

    if diff_text.trim().is_empty() {
        return Err(AppError::Other(
            "No changes to summarize. Stage some files or edit the working tree first.".to_string(),
        ));
    }

    let compressed = compress_commit_diff(&diff_text, MAX_DIFF_BYTES);
    let prompt = build_commit_prompt(current_branch.as_deref(), &compressed, custom_instructions.as_deref());

    let raw_output = run_kiro_oneshot(&kiro_bin, &cwd, &prompt).await?;
    let parsed = parse_commit_response(&raw_output)?;
    Ok(sanitize(parsed))
}

// ── Diff collection ──────────────────────────────────────────────────────

/// Reads the diff to feed the model. Tries the staged diff first; falls back
/// to the worktree diff so the feature still works for users who don't pre-
/// stage. Returns `(current_branch, diff_text)`.
fn collect_diff_for_prompt(cwd: &str) -> Result<(Option<String>, String), AppError> {
    let repo = Repository::open(cwd)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from));

    let mut diff_opts = DiffOptions::new();
    let staged = repo
        .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut diff_opts))?;
    let staged_text = render_patch(&staged)?;

    if !staged_text.trim().is_empty() {
        return Ok((branch, staged_text));
    }

    // Nothing staged — show the worktree diff so the feature still works for
    // a "stage everything via git add ." style commit flow.
    let mut diff_opts = DiffOptions::new();
    let worktree = repo.diff_index_to_workdir(None, Some(&mut diff_opts))?;
    let worktree_text = render_patch(&worktree)?;
    Ok((branch, worktree_text))
}

fn render_patch(diff: &git2::Diff<'_>) -> Result<String, AppError> {
    let mut out = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if matches!(origin, '+' | '-' | ' ') {
            out.push(origin);
        }
        out.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })?;
    Ok(out)
}

// ── Diff compression ─────────────────────────────────────────────────────────

/// Compress a unified-diff to fit under `max_bytes`:
/// 1. Truncate lines longer than [`MAX_LINE_BYTES`] with `...[truncated]`.
/// 2. If still over budget, take a head + tail slice.
pub(crate) fn compress_commit_diff(diff_text: &str, max_bytes: usize) -> String {
    if diff_text.len() <= max_bytes {
        return diff_text.to_string();
    }

    let mut compressed = String::with_capacity(diff_text.len().min(max_bytes));
    for line in diff_text.lines() {
        if line.len() > MAX_LINE_BYTES {
            let cut = floor_char_boundary(line, MAX_LINE_BYTES);
            compressed.push_str(&line[..cut]);
            compressed.push_str("...[truncated]");
        } else {
            compressed.push_str(line);
        }
        compressed.push('\n');
    }

    if compressed.len() <= max_bytes {
        return compressed;
    }

    truncate_iteratively(&compressed, max_bytes)
}

/// Replicates the unstable `str::floor_char_boundary` so we never split a
/// multi-byte UTF-8 sequence when truncating.
fn floor_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    let mut i = index;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn truncate_iteratively(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    // Keep the first `head` bytes + the last `tail` bytes with a marker in
    // between. Reserves a few hundred bytes for the marker line.
    let marker = "\n... [diff truncated for length] ...\n";
    if max_bytes <= marker.len() + 64 {
        let cut = floor_char_boundary(text, max_bytes);
        return text[..cut].to_string();
    }
    let budget = max_bytes - marker.len();
    let head_len = budget * 2 / 3;
    let tail_len = budget - head_len;

    let head_cut = floor_char_boundary(text, head_len);
    let tail_start = floor_char_boundary_from_right(text, text.len() - tail_len);

    let mut out = String::with_capacity(max_bytes);
    out.push_str(&text[..head_cut]);
    out.push_str(marker);
    out.push_str(&text[tail_start..]);
    out
}

fn floor_char_boundary_from_right(s: &str, mut i: usize) -> usize {
    if i > s.len() {
        return s.len();
    }
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

// ── Prompt ───────────────────────────────────────────────────────────────

pub(crate) fn build_commit_prompt(branch: Option<&str>, diff_text: &str, custom_instructions: Option<&str>) -> String {
    let branch_line = branch.unwrap_or("(detached)");
    let extra = custom_instructions
        .map(|i| format!("\nAdditional instructions:\n{i}\n"))
        .unwrap_or_default();
    format!(
        "You write concise git commit messages.\n\
        Return ONLY a single JSON object on one line with keys: subject, body.\n\
        Do not wrap the JSON in markdown code fences. Do not add commentary before or after.\n\
        Rules:\n\
        - subject: imperative mood, <= {MAX_SUBJECT_CHARS} chars, no trailing period\n\
        - body: short bullet points or empty string when the subject is enough\n\
        - capture the primary user-visible or developer-visible change\n\
        - never invent changes that aren't in the diff\n\
        {extra}\
        \n\
        Branch: {branch_line}\n\
        \n\
        Diff:\n\
        {diff_text}\n",
    )
}

// ── Subprocess invocation (shared by branch_ai, thread_title, pr_ai) ────

pub(crate) async fn run_kiro_oneshot(kiro_bin: &str, cwd: &str, prompt: &str) -> Result<String, AppError> {
    // `--trust-tools=` (empty list) prevents the model from spawning tools we
    // don't want it to touch in a one-shot text generation context.
    // `--no-interactive` makes it exit after the response.
    let path_env = format!(
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{}",
        std::env::var("PATH").unwrap_or_default()
    );

    let child = Command::new(kiro_bin)
        .arg("chat")
        .arg("--no-interactive")
        .arg("--trust-tools=")
        .arg(prompt)
        .current_dir(cwd)
        .env("PATH", path_env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to spawn '{kiro_bin}': {e}")))?;

    let output = match timeout(
        Duration::from_secs(SUBPROCESS_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(AppError::Other(format!("Subprocess error: {e}"))),
        Err(_) => {
            return Err(AppError::Other(format!(
                "Commit message generation timed out after {SUBPROCESS_TIMEOUT_SECS}s"
            )));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!(
            "kiro-cli exited with status {}: {}",
            output.status,
            stderr.trim()
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ── Output parsing ───────────────────────────────────────────────────────

/// Strip kiro-cli decoration and extract the JSON `{ subject, body }` payload.
///
/// `kiro-cli chat --no-interactive` emits something like:
///
/// ```text
/// 📷 Checkpoints are enabled! (took 0.15s)
///
/// > json
/// {"subject":"...","body":"..."}
///
///  ▸ Credits: 0.03 • Time: 2s
/// ```
///
/// We scan for the first balanced `{ ... }` block in the body and parse it.
pub(crate) fn parse_commit_response(raw: &str) -> Result<ModelOutput, AppError> {
    // Prefer a JSON object that actually has `subject` (or `body`) so we
    // don't latch onto an unrelated brace block (e.g. `{MCPSERVERNAME}` in
    // a kiro-cli warning). Falls back to any valid JSON, then to the first
    // balanced block for diagnostic purposes.
    let block = extract_json_object_with_key(raw, "subject")
        .or_else(|| extract_json_object_with_key(raw, "body"))
        .or_else(|| extract_first_json_object(raw))
        .ok_or_else(|| {
            AppError::Other(format!(
                "Could not find JSON in agent output. Got:\n{}",
                truncate_for_error(raw, 400)
            ))
        })?;

    serde_json::from_str::<ModelOutput>(&block).map_err(|e| {
        AppError::Other(format!(
            "Failed to parse agent JSON: {e}. Got: {}",
            truncate_for_error(&block, 200)
        ))
    })
}

/// Iterate every balanced `{ ... }` block in `text` (top-level only — nested
/// objects are returned as part of their parent, not separately). Tolerates
/// braces inside string literals (handles `\"` escapes).
///
/// kiro-cli sometimes prints brace-bracketed text in pre-amble warnings (e.g.
/// `--trust-tools arg ... needs to be prepended with @{MCPSERVERNAME}/`),
/// which the previous "first balanced block" heuristic captured instead of the
/// real JSON answer that came afterwards. Iterating all candidates lets the
/// caller skip past those with `serde_json` validation.
pub(crate) fn iter_json_objects(text: &str) -> JsonObjectIter<'_> {
    JsonObjectIter { text, bytes: text.as_bytes(), pos: 0 }
}

pub(crate) struct JsonObjectIter<'a> {
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Iterator for JsonObjectIter<'a> {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        let rel = self.bytes.get(self.pos..)?.iter().position(|&b| b == b'{')?;
        let start = self.pos + rel;

        let mut depth: i32 = 0;
        let mut in_string = false;
        let mut escape = false;

        for (i, &b) in self.bytes.iter().enumerate().skip(start) {
            if in_string {
                if escape {
                    escape = false;
                } else if b == b'\\' {
                    escape = true;
                } else if b == b'"' {
                    in_string = false;
                }
                continue;
            }
            match b {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        // ASCII braces are 1-byte so inclusive slice is safe.
                        let block = self.text[start..=i].to_string();
                        self.pos = i + 1;
                        return Some(block);
                    }
                }
                _ => {}
            }
        }

        // Unbalanced — abandon the rest of the buffer.
        self.pos = self.bytes.len();
        None
    }
}

/// Find the first balanced `{ ... }` block that parses as valid JSON.
///
/// Falls back to the first balanced block when nothing parses, so error
/// messages remain useful for genuinely-broken output. Shared by `branch_ai`,
/// `thread_title`, `pr_ai`, and `git_ai`'s own commit-message path.
pub(crate) fn extract_first_json_object(text: &str) -> Option<String> {
    let mut first_block: Option<String> = None;
    for candidate in iter_json_objects(text) {
        if first_block.is_none() {
            first_block = Some(candidate.clone());
        }
        if serde_json::from_str::<serde_json::Value>(&candidate).is_ok() {
            return Some(candidate);
        }
    }
    first_block
}

/// Like [`extract_first_json_object`] but also requires the parsed object to
/// contain the named top-level key. Use this when the caller knows the
/// expected schema (e.g. `"title"` for thread titles, `"branch"` for branch
/// names) so warnings or chrome that happen to contain valid JSON don't get
/// mistaken for the real answer.
///
/// Falls back to the first valid JSON object, then to the first balanced
/// block, so error preview text is still meaningful.
pub(crate) fn extract_json_object_with_key(text: &str, key: &str) -> Option<String> {
    let mut first_valid: Option<String> = None;
    let mut first_block: Option<String> = None;

    for candidate in iter_json_objects(text) {
        if first_block.is_none() {
            first_block = Some(candidate.clone());
        }
        match serde_json::from_str::<serde_json::Value>(&candidate) {
            Ok(value) => {
                if first_valid.is_none() {
                    first_valid = Some(candidate.clone());
                }
                if value.as_object().is_some_and(|o| o.contains_key(key)) {
                    return Some(candidate);
                }
            }
            Err(_) => continue,
        }
    }

    first_valid.or(first_block)
}

fn truncate_for_error(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let cut = floor_char_boundary(s, max);
    format!("{}…", &s[..cut])
}

// ── Sanitization ─────────────────────────────────────────────────────────

fn sanitize(parsed: ModelOutput) -> GeneratedCommitMessage {
    let subject_raw = parsed
        .subject
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .trim_end_matches('.')
        .trim()
        .to_string();

    let subject = if subject_raw.is_empty() {
        "Update project files".to_string()
    } else if subject_raw.chars().count() > MAX_SUBJECT_CHARS {
        // char-aware truncation
        let mut acc = String::new();
        for (i, ch) in subject_raw.chars().enumerate() {
            if i >= MAX_SUBJECT_CHARS {
                break;
            }
            acc.push(ch);
        }
        acc.trim_end().to_string()
    } else {
        subject_raw
    };

    GeneratedCommitMessage {
        subject,
        body: parsed.body.trim().to_string(),
    }
}

// ── Smoke test helper (used by examples/git_ai_smoke.rs) ─────────────────

/// Standalone commit message generation for the smoke-test example binary.
/// Bypasses Tauri state by accepting kiro_bin and cwd directly.
pub async fn generate_for_smoke(kiro_bin: &str, cwd: &str) -> Result<GeneratedCommitMessage, AppError> {
    let (_, diff_text) = collect_diff_for_prompt(cwd)?;
    if diff_text.trim().is_empty() {
        return Err(AppError::Other("No changes to summarize".to_string()));
    }
    let compressed = compress_commit_diff(&diff_text, MAX_DIFF_BYTES);
    let branch = git2::Repository::open(cwd).ok()
        .and_then(|r| r.head().ok().and_then(|h| h.shorthand().map(String::from)));
    let prompt = build_commit_prompt(branch.as_deref(), &compressed, None);
    let raw_output = run_kiro_oneshot(kiro_bin, cwd, &prompt).await?;
    let parsed = parse_commit_response(&raw_output)?;
    Ok(sanitize(parsed))
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compress_passthrough_when_under_budget() {
        let diff = "diff --git a/x b/x\n+hello\n-world\n";
        let out = compress_commit_diff(diff, 1024);
        assert_eq!(out, diff);
    }

    #[test]
    fn compress_truncates_long_lines() {
        let long_line = format!("+{}", "a".repeat(1_000));
        let diff = format!("diff --git a/x b/x\n{long_line}\n+ok\n");
        let out = compress_commit_diff(&diff, 600);
        assert!(out.contains("...[truncated]"));
        assert!(out.contains("+ok"), "tail should still be present, got:\n{out}");
    }

    #[test]
    fn compress_iterative_truncation_for_many_lines() {
        let diff: String = (0..2_000)
            .map(|i| format!("+line {i}\n"))
            .collect();
        let out = compress_commit_diff(&diff, 5_000);
        assert!(out.len() <= 5_000);
        assert!(out.contains("[diff truncated for length]"));
    }

    #[test]
    fn floor_char_boundary_handles_multibyte() {
        let s = "héllo"; // h=1 é=2 l=1 l=1 o=1
        // index 2 lands inside é — should fall back to 1
        assert_eq!(floor_char_boundary(s, 2), 1);
        assert_eq!(floor_char_boundary(s, 3), 3);
    }

    #[test]
    fn build_prompt_includes_branch_and_diff() {
        let p = build_commit_prompt(Some("feat/x"), "diff body", None);
        assert!(p.contains("Branch: feat/x"));
        assert!(p.contains("diff body"));
        assert!(p.contains("subject"));
        assert!(p.contains("body"));
    }

    #[test]
    fn build_prompt_handles_detached_head() {
        let p = build_commit_prompt(None, "d", None);
        assert!(p.contains("Branch: (detached)"));
    }

    #[test]
    fn extract_json_finds_simple_object() {
        let raw = r#"prefix {"subject":"x","body":""} suffix"#;
        let block = extract_first_json_object(raw).unwrap();
        assert_eq!(block, r#"{"subject":"x","body":""}"#);
    }

    #[test]
    fn extract_json_handles_braces_in_strings() {
        let raw = r#"junk {"subject":"a } b","body":"{ nested }"} tail"#;
        let block = extract_first_json_object(raw).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&block).unwrap();
        assert_eq!(parsed["subject"], "a } b");
        assert_eq!(parsed["body"], "{ nested }");
    }

    #[test]
    fn extract_json_handles_escaped_quotes() {
        let raw = r#"x {"subject":"with \"quotes\"","body":""} y"#;
        let block = extract_first_json_object(raw).unwrap();
        let parsed: ModelOutput = serde_json::from_str(&block).unwrap();
        assert_eq!(parsed.subject, r#"with "quotes""#);
    }

    #[test]
    fn extract_json_returns_none_when_missing() {
        assert!(extract_first_json_object("no braces here").is_none());
    }

    #[test]
    fn extract_json_skips_invalid_block_before_real_answer() {
        // Mirrors real kiro-cli output: a warning containing `{MCPSERVERNAME}`
        // (not valid JSON) followed by the actual answer.
        let raw = "WARNING: --trust-tools arg ... prepended with @{MCPSERVERNAME}/\n\
                   > {\"subject\":\"Fix login\",\"body\":\"\"}\n";
        let block = extract_first_json_object(raw).unwrap();
        assert_eq!(block, r#"{"subject":"Fix login","body":""}"#);
    }

    #[test]
    fn extract_with_key_skips_unrelated_valid_json() {
        // Even when the noise IS valid JSON, prefer the block that has the
        // expected schema key.
        let raw = "{\"unrelated\":1}\n\n{\"title\":\"The real answer\"}\n";
        let block = extract_json_object_with_key(raw, "title").unwrap();
        assert_eq!(block, r#"{"title":"The real answer"}"#);
    }

    #[test]
    fn extract_with_key_falls_back_to_first_valid_when_key_missing() {
        // No object has the requested key — degrade to the first parseable
        // block so the caller still gets a useful error preview.
        let raw = "{\"foo\":1} {\"bar\":2}";
        let block = extract_json_object_with_key(raw, "title").unwrap();
        assert_eq!(block, r#"{"foo":1}"#);
    }

    #[test]
    fn extract_with_key_falls_back_to_first_block_when_nothing_parses() {
        // Pathological case: nothing valid; still hand back the first block
        // for diagnostic preview text.
        let raw = "{not json} {also-not-json}";
        let block = extract_json_object_with_key(raw, "title").unwrap();
        assert_eq!(block, "{not json}");
    }

    #[test]
    fn iter_json_objects_walks_top_level_blocks() {
        let raw = "prefix {\"a\":1} middle {\"b\":{\"nested\":2}} tail";
        let blocks: Vec<String> = iter_json_objects(raw).collect();
        assert_eq!(blocks, vec![
            r#"{"a":1}"#.to_string(),
            r#"{"b":{"nested":2}}"#.to_string(),
        ]);
    }

    #[test]
    fn iter_json_objects_handles_braces_in_strings() {
        let raw = r#"{"a":"} not really }"} {"b":2}"#;
        let blocks: Vec<String> = iter_json_objects(raw).collect();
        assert_eq!(blocks.len(), 2);
        assert!(blocks[0].contains(r#""a""#));
        assert_eq!(blocks[1], r#"{"b":2}"#);
    }

    #[test]
    fn parse_commit_response_extracts_from_kiro_cli_chrome() {
        let raw = "📷 Checkpoints are enabled! (took 0.15s)\n\n> json\n{\"subject\":\"add foo\",\"body\":\"\"}\n\n ▸ Credits: 0.03 • Time: 2s\n";
        let parsed = parse_commit_response(raw).unwrap();
        assert_eq!(parsed.subject, "add foo");
        assert_eq!(parsed.body, "");
    }

    #[test]
    fn parse_commit_response_skips_kiro_cli_warning_brace_block() {
        // Regression: `{MCPSERVERNAME}` from kiro-cli's `--trust-tools`
        // warning was being parsed as the answer, breaking commit message
        // generation alongside thread titles, branch names, and PR content.
        let raw = "WARNING: --trust-tools arg for custom tool needs to be \
                   prepended with @{MCPSERVERNAME}/\n\
                   > {\"subject\":\"Fix login\",\"body\":\"\"}\n \
                   ▸ Credits: 0.04\n";
        let parsed = parse_commit_response(raw).unwrap();
        assert_eq!(parsed.subject, "Fix login");
        assert_eq!(parsed.body, "");
    }

    #[test]
    fn parse_commit_response_errors_when_no_json() {
        let raw = "kiro-cli error: not authenticated\n";
        let err = parse_commit_response(raw).unwrap_err();
        assert!(err.to_string().contains("Could not find JSON"));
    }

    #[test]
    fn sanitize_strips_trailing_period() {
        let parsed = ModelOutput {
            subject: "Add foo.".to_string(),
            body: "  body text  ".to_string(),
        };
        let out = sanitize(parsed);
        assert_eq!(out.subject, "Add foo");
        assert_eq!(out.body, "body text");
    }

    #[test]
    fn sanitize_caps_subject_at_72_chars() {
        let long = "a".repeat(200);
        let parsed = ModelOutput { subject: long, body: String::new() };
        let out = sanitize(parsed);
        assert_eq!(out.subject.chars().count(), MAX_SUBJECT_CHARS);
    }

    #[test]
    fn sanitize_uses_first_nonempty_line() {
        let parsed = ModelOutput {
            subject: "\n\n  Subject here  \nIgnored line".to_string(),
            body: String::new(),
        };
        let out = sanitize(parsed);
        assert_eq!(out.subject, "Subject here");
    }

    #[test]
    fn sanitize_falls_back_when_subject_empty() {
        let parsed = ModelOutput { subject: "   ".to_string(), body: String::new() };
        let out = sanitize(parsed);
        assert_eq!(out.subject, "Update project files");
    }

    #[test]
    fn generated_serializes_camel_case() {
        let g = GeneratedCommitMessage {
            subject: "x".to_string(),
            body: "y".to_string(),
        };
        let json = serde_json::to_string(&g).unwrap();
        // No camelCase rename on these particular fields, but we want stability.
        assert!(json.contains("\"subject\":\"x\""));
        assert!(json.contains("\"body\":\"y\""));
    }

    /// End-to-end smoke test against a real `kiro-cli` install.
    ///
    /// Ignored by default — run explicitly with:
    ///
    /// ```sh
    /// cargo test --manifest-path kirodex/src-tauri/Cargo.toml \
    ///   --lib commands::git_ai::tests::end_to_end_against_real_kiro_cli \
    ///   -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "requires a working kiro-cli on PATH and network"]
    async fn end_to_end_against_real_kiro_cli() {
        use std::process::Command as StdCommand;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();

        // Bootstrap a tiny repo with a real diff.
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
        ] {
            let st = StdCommand::new("git").args(&args).current_dir(path).status().unwrap();
            assert!(st.success());
        }
        std::fs::write(path.join("hello.txt"), "hello\n").unwrap();
        StdCommand::new("git").args(["add", "."]).current_dir(path).status().unwrap();
        StdCommand::new("git").args(["commit", "-q", "-m", "init"]).current_dir(path).status().unwrap();
        std::fs::write(path.join("hello.txt"), "hello world\nadded line\n").unwrap();

        let (branch, diff) = collect_diff_for_prompt(path.to_str().unwrap()).unwrap();
        assert!(!diff.is_empty());
        let prompt = build_commit_prompt(branch.as_deref(), &diff, None);
        let raw = run_kiro_oneshot("kiro-cli", path.to_str().unwrap(), &prompt)
            .await
            .expect("kiro-cli oneshot failed");
        let parsed = parse_commit_response(&raw).expect("failed to parse model output");
        let result = sanitize(parsed);
        assert!(!result.subject.is_empty());
        assert!(result.subject.chars().count() <= MAX_SUBJECT_CHARS);
        assert!(!result.subject.ends_with('.'));
        eprintln!("subject: {}", result.subject);
        if !result.body.is_empty() {
            eprintln!("body:\n{}", result.body);
        }
    }
}
