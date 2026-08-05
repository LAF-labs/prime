//! Line-level diff statistics for ACP tool-call diff content.
//!
//! The ACP `tool_call` / `tool_call_update` notifications carry per-file
//! diff blobs (`{ type: "diff", oldText, newText }`). The renderer used to
//! re-derive `+N / -M` per file by line-multiset diffing in JavaScript, which:
//!   - fell back to "+1" for any tool call without a structured diff
//!     (most file-creates), inflating real counts dramatically;
//!   - was not LCS-correct for reorderings or duplicate lines.
//!
//! This module computes the same numbers `git diff --numstat` produces —
//! Histogram diff over interned lines, summing hunk widths — so the frontend
//! can stay a dumb display.

use imara_diff::intern::InternedInput;
use imara_diff::{diff, Algorithm};
use std::ops::Range;

/// Count lines in a buffer the way `git diff --numstat` does — `\n`-separated,
/// final newline does not introduce a phantom empty line, and a fully empty
/// string contributes zero.
fn line_count(s: &str) -> u32 {
    if s.is_empty() {
        0
    } else {
        // `str::lines()` already collapses the trailing newline if present.
        s.lines().count() as u32
    }
}

/// Compute `(lines_added, lines_removed)` for a single before/after pair.
///
/// Every diff hunk contributes `before.len()` to removed and `after.len()`
/// to added, summed across all hunks. For pure creates / deletes, takes a
/// fast path that matches `count_lines` from `fs::fake_git_repo`.
pub fn count_diff_lines(old_text: &str, new_text: &str) -> (u32, u32) {
    if old_text.is_empty() && new_text.is_empty() {
        return (0, 0);
    }
    if old_text.is_empty() {
        return (line_count(new_text), 0);
    }
    if new_text.is_empty() {
        return (0, line_count(old_text));
    }
    if old_text == new_text {
        return (0, 0);
    }

    let input = InternedInput::new(old_text, new_text);
    let mut added: u32 = 0;
    let mut removed: u32 = 0;
    let sink = |before: Range<u32>, after: Range<u32>| {
        removed = removed.saturating_add(before.end - before.start);
        added = added.saturating_add(after.end - after.start);
    };
    diff(Algorithm::Histogram, &input, sink);
    (added, removed)
}

/// Walk an ACP `tool_call` / `tool_call_update` JSON payload in place and
/// annotate every `content[i]` entry of `type == "diff"` with `linesAdded`
/// and `linesRemoved` numbers. Idempotent: re-annotating the same payload
/// recomputes the same values. No-op when `content` is missing or not an
/// array.
///
/// `value` must be the `sessionUpdate` object (the one with a top-level
/// `content` array), not the outer ACP envelope. In `client.rs` this is
/// `update.clone()` — the value obtained via `val.get("update")`.
///
/// We mutate the JSON value the ACP client received from kiro-cli rather
/// than introducing a typed struct: kiro-cli is free to add fields and
/// touching the JSON in place keeps every other field byte-identical for
/// the renderer.
///
/// # Line-ending note
/// Lines are interned as raw byte slices by imara-diff, so `\r\n` and `\n`
/// endings are treated as distinct. This matches git's behaviour when
/// `core.autocrlf` is off. kiro-cli normalises to `\n` before sending diffs,
/// so in practice this is not an issue.
pub fn annotate_diff_content(value: &mut serde_json::Value) {
    let Some(content) = value.get_mut("content").and_then(|c| c.as_array_mut()) else {
        return;
    };
    for item in content.iter_mut() {
        let Some(obj) = item.as_object_mut() else { continue };
        let is_diff = obj.get("type").and_then(|t| t.as_str()) == Some("diff");
        if !is_diff {
            continue;
        }
        let old_text = obj.get("oldText").and_then(|v| v.as_str()).unwrap_or("");
        let new_text = obj.get("newText").and_then(|v| v.as_str()).unwrap_or("");
        let (added, removed) = count_diff_lines(old_text, new_text);
        obj.insert(
            "linesAdded".to_string(),
            serde_json::Value::from(added),
        );
        obj.insert(
            "linesRemoved".to_string(),
            serde_json::Value::from(removed),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_inputs() {
        assert_eq!(count_diff_lines("", ""), (0, 0));
    }

    #[test]
    fn pure_create_counts_new_lines() {
        let new = "alpha\nbeta\ngamma\n";
        assert_eq!(count_diff_lines("", new), (3, 0));
    }

    #[test]
    fn pure_delete_counts_old_lines() {
        let old = "alpha\nbeta\ngamma\n";
        assert_eq!(count_diff_lines(old, ""), (0, 3));
    }

    #[test]
    fn identical_inputs_have_no_change() {
        let s = "fn main() {\n    println!(\"hi\");\n}\n";
        assert_eq!(count_diff_lines(s, s), (0, 0));
    }

    #[test]
    fn simple_modification_matches_git_numstat() {
        // Equivalent to `git diff --numstat` between these two: 1 added, 1 removed.
        let old = "line one\nline two\nline three\n";
        let new = "line one\nLINE TWO\nline three\n";
        assert_eq!(count_diff_lines(old, new), (1, 1));
    }

    #[test]
    fn pure_insertion_in_middle() {
        let old = "a\nb\nc\n";
        let new = "a\nb\nb2\nb3\nc\n";
        // Two pure-insert lines, no removal.
        assert_eq!(count_diff_lines(old, new), (2, 0));
    }

    #[test]
    fn pure_deletion_in_middle() {
        let old = "a\nb\nb2\nb3\nc\n";
        let new = "a\nb\nc\n";
        assert_eq!(count_diff_lines(old, new), (0, 2));
    }

    #[test]
    fn trailing_newline_does_not_add_phantom_line() {
        // Both "a\nb\n" and "a\nb" should count as 2 lines for the purposes of pure-create.
        assert_eq!(line_count("a\nb\n"), 2);
        assert_eq!(line_count("a\nb"), 2);
        assert_eq!(line_count(""), 0);
    }

    #[test]
    fn annotate_skips_non_diff_entries() {
        let mut v = serde_json::json!({
            "content": [
                { "type": "content", "text": "ignore me" },
                { "type": "terminal", "terminalId": "t1" },
            ]
        });
        annotate_diff_content(&mut v);
        let arr = v["content"].as_array().unwrap();
        assert!(arr[0].get("linesAdded").is_none());
        assert!(arr[1].get("linesRemoved").is_none());
    }

    #[test]
    fn annotate_populates_diff_entries() {
        let mut v = serde_json::json!({
            "content": [
                {
                    "type": "diff",
                    "path": "a.txt",
                    "oldText": "x\ny\n",
                    "newText": "x\nY\nz\n"
                }
            ]
        });
        annotate_diff_content(&mut v);
        let entry = &v["content"][0];
        // y -> Y (1/1) plus added z (+1).
        assert_eq!(entry["linesAdded"].as_u64().unwrap(), 2);
        assert_eq!(entry["linesRemoved"].as_u64().unwrap(), 1);
    }

    #[test]
    fn annotate_handles_pure_create() {
        let mut v = serde_json::json!({
            "content": [
                {
                    "type": "diff",
                    "path": "new.md",
                    "oldText": null,
                    "newText": "# title\n\nbody\n"
                }
            ]
        });
        annotate_diff_content(&mut v);
        let entry = &v["content"][0];
        assert_eq!(entry["linesAdded"].as_u64().unwrap(), 3);
        assert_eq!(entry["linesRemoved"].as_u64().unwrap(), 0);
    }

    #[test]
    fn annotate_is_idempotent() {
        let mut v = serde_json::json!({
            "content": [
                {
                    "type": "diff",
                    "path": "f",
                    "oldText": "a\n",
                    "newText": "b\n"
                }
            ]
        });
        annotate_diff_content(&mut v);
        let first_added = v["content"][0]["linesAdded"].as_u64().unwrap();
        let first_removed = v["content"][0]["linesRemoved"].as_u64().unwrap();
        annotate_diff_content(&mut v);
        assert_eq!(v["content"][0]["linesAdded"].as_u64().unwrap(), first_added);
        assert_eq!(v["content"][0]["linesRemoved"].as_u64().unwrap(), first_removed);
    }

    #[test]
    fn annotate_no_content_field_is_noop() {
        let mut v = serde_json::json!({ "title": "no content" });
        annotate_diff_content(&mut v);
        assert!(v.get("linesAdded").is_none());
        assert_eq!(v["title"], "no content");
    }
}
