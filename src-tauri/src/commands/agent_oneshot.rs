//! One-shot agent subprocess invocation and JSON answer extraction.
//!
//! Spawns the resolved agent (`prime-agent --print --no-tools --no-session`)
//! as a one-shot subprocess and hands back its raw stdout. Callers (e.g.
//! thread title generation) then extract a JSON object from the output.
//!
//! Design notes:
//!
//! * The subprocess runs **outside** the user's chat thread so we never touch
//!   the active agent session or pollute `turn_end`.
//! * No new credential surface — reuses whatever auth `prime-agent` already has.
//! * The CLI prints a few decorative status lines (`📷 Checkpoints…`,
//!   `▸ Credits: …`, a leading `> ` prompt echo). The extraction helpers scan
//!   the body for JSON, so they tolerate surrounding chrome.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

use super::error::AppError;

/// Hard cap on the subprocess wall-clock time. Generation should normally take
/// 2–5 seconds; anything longer is almost certainly stuck.
const SUBPROCESS_TIMEOUT_SECS: u64 = 60;

// ── Subprocess invocation ────────────────────────────────────────────────

pub(crate) async fn run_agent_oneshot(launch: &crate::commands::agent_launch::AgentLaunch, cwd: &str, prompt: &str) -> Result<String, AppError> {
    // `--print` answers once and exits, `--no-tools` keeps a text-generation
    // run from touching the workspace, and `--no-session` keeps it out of the
    // user's session history. `--` stops flag parsing so a prompt can never be
    // read as an option or an `@file` mention.
    let mut cmd = Command::new(&launch.program);
    cmd.args(&launch.prefix_args);
    // On timeout the future below is dropped, and a dropped Child without this
    // flag is *detached*, not killed — a wedged one-shot generator (thread
    // titles run this in the background) would keep running forever with no
    // UI that knows it exists.
    cmd.kill_on_drop(true);
    let child = cmd
        .arg("--print")
        .arg("--no-tools")
        .arg("--no-session")
        .arg("--")
        .arg(prompt)
        .current_dir(cwd)
        .env("PATH", crate::commands::agent_launch::agent_path_env(launch))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to spawn '{}': {e}", launch.program)))?;

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
                "Text generation timed out after {SUBPROCESS_TIMEOUT_SECS}s"
            )));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!(
            "prime-agent exited with status {}: {}",
            output.status,
            stderr.trim()
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ── JSON extraction ──────────────────────────────────────────────────────

/// Iterate every balanced `{ ... }` block in `text` (top-level only — nested
/// objects are returned as part of their parent, not separately). Tolerates
/// braces inside string literals (handles `\"` escapes).
///
/// prime-agent sometimes prints brace-bracketed text in pre-amble warnings (e.g.
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
/// messages remain useful for genuinely-broken output.
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
/// expected schema (e.g. `"title"` for thread titles) so warnings or chrome
/// that happen to contain valid JSON don't get mistaken for the real answer.
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

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
        let parsed: serde_json::Value = serde_json::from_str(&block).unwrap();
        assert_eq!(parsed["subject"], r#"with "quotes""#);
    }

    #[test]
    fn extract_json_returns_none_when_missing() {
        assert!(extract_first_json_object("no braces here").is_none());
    }

    #[test]
    fn extract_json_skips_invalid_block_before_real_answer() {
        // Mirrors real prime-agent output: a warning containing `{MCPSERVERNAME}`
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
}
