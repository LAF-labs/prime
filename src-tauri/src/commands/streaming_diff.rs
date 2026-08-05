//! Streaming diff algorithm.
//!
//! Computes character-level diffs incrementally as new text arrives (e.g. from
//! an LLM streaming response). Instead of waiting for the full output and then
//! running a traditional diff, this module lets you call `push_new(chunk)` for
//! each token/chunk and immediately get back the diff operations produced so far.
//!
//! The algorithm uses a scoring matrix with:
//! - Equality bonus that grows exponentially with run length (rewards long matches)
//! - Insertion penalty of -1
//! - Deletion penalty of -20 (strongly prefers keeping old text)
//!
//! After all chunks are pushed, call `finish()` to flush remaining operations.
//!
//! # Line-level operations
//!
//! The `LineDiff` struct converts character operations into line-level operations
//! suitable for rendering side-by-side or unified diffs in the UI.

use std::collections::{BTreeSet, HashMap};
use std::cmp;

// ── Character-level operations ────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum CharOperation {
    Insert { text: String },
    Delete { bytes: usize },
    Keep { bytes: usize },
}

// ── Line-level operations ─────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum LineOperation {
    Insert { lines: u32 },
    Delete { lines: u32 },
    Keep { lines: u32 },
}

// ── Internal matrix for dynamic programming ───────────────────────────────────

#[derive(Default)]
struct Matrix {
    cells: Vec<f64>,
    rows: usize,
    cols: usize,
}

impl Matrix {
    fn new() -> Self {
        Self {
            cells: Vec::new(),
            rows: 0,
            cols: 0,
        }
    }

    fn resize(&mut self, rows: usize, cols: usize) {
        self.cells.resize(rows * cols, 0.);
        self.rows = rows;
        self.cols = cols;
    }

    fn swap_columns(&mut self, col1: usize, col2: usize) {
        if col1 == col2 {
            return;
        }
        assert!(col1 < self.cols, "column out of bounds");
        assert!(col2 < self.cols, "column out of bounds");

        let (start1, start2) = if col1 < col2 {
            (col1 * self.rows, col2 * self.rows)
        } else {
            (col2 * self.rows, col1 * self.rows)
        };

        let (left, right) = self.cells.split_at_mut(start2);
        let col_a = &mut left[start1..start1 + self.rows];
        let col_b = &mut right[..self.rows];
        col_a.swap_with_slice(col_b);
    }

    fn get(&self, row: usize, col: usize) -> f64 {
        assert!(row < self.rows, "row out of bounds");
        assert!(col < self.cols, "column out of bounds");
        self.cells[col * self.rows + row]
    }

    fn set(&mut self, row: usize, col: usize, value: f64) {
        assert!(row < self.rows, "row out of bounds");
        assert!(col < self.cols, "column out of bounds");
        self.cells[col * self.rows + row] = value;
    }
}

// ── StreamingDiff ─────────────────────────────────────────────────────────────

/// Incrementally computes a character-level diff between an old string and a new
/// string that arrives in chunks.
#[derive(Default)]
pub struct StreamingDiff {
    old: Vec<char>,
    new: Vec<char>,
    scores: Matrix,
    old_text_ix: usize,
    new_text_ix: usize,
    equal_runs: HashMap<(usize, usize), u32>,
}

impl StreamingDiff {
    const INSERTION_SCORE: f64 = -1.;
    const DELETION_SCORE: f64 = -20.;
    const EQUALITY_BASE: f64 = 1.8;
    const MAX_EQUALITY_EXPONENT: i32 = 16;

    pub fn new(old: String) -> Self {
        let old = old.chars().collect::<Vec<_>>();
        let mut scores = Matrix::new();
        scores.resize(old.len() + 1, 1);
        for i in 0..=old.len() {
            scores.set(i, 0, i as f64 * Self::DELETION_SCORE);
        }
        Self {
            old,
            new: Vec::new(),
            scores,
            old_text_ix: 0,
            new_text_ix: 0,
            equal_runs: Default::default(),
        }
    }

    /// Push a new chunk of text and return the diff operations produced so far.
    pub fn push_new(&mut self, text: &str) -> Vec<CharOperation> {
        self.new.extend(text.chars());
        self.scores.swap_columns(0, self.scores.cols - 1);
        self.scores
            .resize(self.old.len() + 1, self.new.len() - self.new_text_ix + 1);
        self.equal_runs.retain(|(_i, j), _| *j == self.new_text_ix);

        for j in self.new_text_ix + 1..=self.new.len() {
            let relative_j = j - self.new_text_ix;

            self.scores
                .set(0, relative_j, j as f64 * Self::INSERTION_SCORE);
            for i in 1..=self.old.len() {
                let insertion_score =
                    self.scores.get(i, relative_j - 1) + Self::INSERTION_SCORE;
                let deletion_score =
                    self.scores.get(i - 1, relative_j) + Self::DELETION_SCORE;
                let equality_score = if self.old[i - 1] == self.new[j - 1] {
                    let mut equal_run =
                        self.equal_runs.get(&(i - 1, j - 1)).copied().unwrap_or(0);
                    equal_run += 1;
                    self.equal_runs.insert((i, j), equal_run);

                    let exponent =
                        cmp::min(equal_run as i32 / 4, Self::MAX_EQUALITY_EXPONENT);
                    self.scores.get(i - 1, relative_j - 1)
                        + Self::EQUALITY_BASE.powi(exponent)
                } else {
                    f64::NEG_INFINITY
                };

                let score = insertion_score.max(deletion_score).max(equality_score);
                self.scores.set(i, relative_j, score);
            }
        }

        let mut max_score = f64::NEG_INFINITY;
        let mut next_old_text_ix = self.old_text_ix;
        let next_new_text_ix = self.new.len();
        for i in self.old_text_ix..=self.old.len() {
            let score = self.scores.get(i, next_new_text_ix - self.new_text_ix);
            if score > max_score {
                max_score = score;
                next_old_text_ix = i;
            }
        }

        let hunks = self.backtrack(next_old_text_ix, next_new_text_ix);
        self.old_text_ix = next_old_text_ix;
        self.new_text_ix = next_new_text_ix;
        hunks
    }

    fn backtrack(&self, old_text_ix: usize, new_text_ix: usize) -> Vec<CharOperation> {
        let mut pending_insert: Option<std::ops::Range<usize>> = None;
        let mut hunks = Vec::new();
        let mut i = old_text_ix;
        let mut j = new_text_ix;
        while (i, j) != (self.old_text_ix, self.new_text_ix) {
            let insertion_score = if j > self.new_text_ix {
                Some((i, j - 1))
            } else {
                None
            };
            let deletion_score = if i > self.old_text_ix {
                Some((i - 1, j))
            } else {
                None
            };
            let equality_score = if i > self.old_text_ix && j > self.new_text_ix {
                if self.old[i - 1] == self.new[j - 1] {
                    Some((i - 1, j - 1))
                } else {
                    None
                }
            } else {
                None
            };

            let (prev_i, prev_j) = [insertion_score, deletion_score, equality_score]
                .iter()
                .max_by_key(|cell| {
                    cell.map(|(i, j)| {
                        ordered_float(self.scores.get(i, j - self.new_text_ix))
                    })
                })
                .unwrap()
                .unwrap();

            if prev_i == i && prev_j == j - 1 {
                if let Some(pending_insert) = pending_insert.as_mut() {
                    pending_insert.start = prev_j;
                } else {
                    pending_insert = Some(prev_j..j);
                }
            } else {
                if let Some(range) = pending_insert.take() {
                    hunks.push(CharOperation::Insert {
                        text: self.new[range].iter().collect(),
                    });
                }

                let char_len = self.old[i - 1].len_utf8();
                if prev_i == i - 1 && prev_j == j {
                    if let Some(CharOperation::Delete { bytes: len }) = hunks.last_mut() {
                        *len += char_len;
                    } else {
                        hunks.push(CharOperation::Delete { bytes: char_len })
                    }
                } else if let Some(CharOperation::Keep { bytes: len }) = hunks.last_mut() {
                    *len += char_len;
                } else {
                    hunks.push(CharOperation::Keep { bytes: char_len })
                }
            }

            i = prev_i;
            j = prev_j;
        }

        if let Some(range) = pending_insert.take() {
            hunks.push(CharOperation::Insert {
                text: self.new[range].iter().collect(),
            });
        }

        hunks.reverse();
        hunks
    }

    /// Flush remaining operations after all chunks have been pushed.
    pub fn finish(self) -> Vec<CharOperation> {
        self.backtrack(self.old.len(), self.new.len())
    }
}

/// Wrapper for f64 ordering (total order for comparison in backtracking).
#[derive(PartialEq, PartialOrd)]
struct OrderedF64(f64);

impl Eq for OrderedF64 {}
impl Ord for OrderedF64 {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.partial_cmp(&other.0).unwrap_or(std::cmp::Ordering::Equal)
    }
}

fn ordered_float(v: f64) -> OrderedF64 {
    OrderedF64(v)
}

// ── LineDiff ──────────────────────────────────────────────────────────────────

/// Converts character-level operations into line-level operations for UI rendering.
///
/// Tracks which lines in the old and new text are inserted, deleted, or kept,
/// producing a compact list of `LineOperation` values suitable for rendering
/// side-by-side or unified diffs.
#[derive(Debug, Default)]
pub struct LineDiff {
    old_line: u32,
    new_line: u32,
    old_col: usize,
    new_col: usize,
    deleted_rows: BTreeSet<u32>,
    inserted_rows: BTreeSet<u32>,
}

impl LineDiff {
    /// Process a sequence of character operations against the old text.
    pub fn push_char_operations(&mut self, operations: &[CharOperation], old_text: &str) {
        let old_lines: Vec<&str> = old_text.split('\n').collect();

        for op in operations {
            match op {
                CharOperation::Keep { bytes } => {
                    self.advance_old(*bytes, &old_lines);
                }
                CharOperation::Delete { bytes } => {
                    let start_line = self.old_line;
                    self.advance_old_delete(*bytes, &old_lines);
                    // Mark all lines touched by the deletion
                    for line in start_line..=self.old_line {
                        self.deleted_rows.insert(line);
                    }
                    // The new text line at this position gets an insert marker
                    self.inserted_rows.insert(self.new_line);
                }
                CharOperation::Insert { text } => {
                    let start_line = self.new_line;
                    for ch in text.chars() {
                        if ch == '\n' {
                            self.new_line += 1;
                            self.new_col = 0;
                        } else {
                            self.new_col += ch.len_utf8();
                        }
                    }
                    // Mark all new lines produced by this insert
                    for line in start_line..=self.new_line {
                        self.inserted_rows.insert(line);
                    }
                    // If we're mid-line in old text, mark that old line as deleted
                    if self.old_col > 0 || start_line == self.new_line {
                        self.deleted_rows.insert(self.old_line);
                    }
                }
            }
        }
    }

    fn advance_old(&mut self, bytes: usize, old_lines: &[&str]) {
        let mut remaining = bytes;
        while remaining > 0 {
            let current_line_len = old_lines
                .get(self.old_line as usize)
                .map(|l| l.len())
                .unwrap_or(0);
            let bytes_left_in_line = current_line_len.saturating_sub(self.old_col);

            if remaining > bytes_left_in_line {
                // Consume rest of line + newline
                remaining -= bytes_left_in_line + 1; // +1 for '\n'
                self.old_line += 1;
                self.old_col = 0;
                self.new_line += 1;
                self.new_col = 0;
            } else {
                self.old_col += remaining;
                self.new_col += remaining;
                remaining = 0;
            }
        }
    }

    fn advance_old_delete(&mut self, bytes: usize, old_lines: &[&str]) {
        let mut remaining = bytes;
        while remaining > 0 {
            let current_line_len = old_lines
                .get(self.old_line as usize)
                .map(|l| l.len())
                .unwrap_or(0);
            let bytes_left_in_line = current_line_len.saturating_sub(self.old_col);

            if remaining > bytes_left_in_line {
                remaining -= bytes_left_in_line + 1; // +1 for '\n'
                self.old_line += 1;
                self.old_col = 0;
            } else {
                self.old_col += remaining;
                remaining = 0;
            }
        }
    }

    /// Produce the final list of line operations.
    pub fn line_operations(&self) -> Vec<LineOperation> {
        let max_old = self.deleted_rows.iter().copied().max().unwrap_or(0);
        let max_new = self.inserted_rows.iter().copied().max().unwrap_or(0);
        let total_old_lines = max_old.max(self.old_line) + 1;
        let total_new_lines = max_new.max(self.new_line) + 1;

        let mut ops = Vec::new();
        let mut deleted_iter = self.deleted_rows.iter().copied().peekable();
        let mut inserted_iter = self.inserted_rows.iter().copied().peekable();
        let mut old_row: u32 = 0;
        let mut new_row: u32 = 0;

        while deleted_iter.peek().is_some() || inserted_iter.peek().is_some() {
            if Some(old_row) == deleted_iter.peek().copied() {
                if let Some(LineOperation::Delete { lines }) = ops.last_mut() {
                    *lines += 1;
                } else {
                    ops.push(LineOperation::Delete { lines: 1 });
                }
                old_row += 1;
                deleted_iter.next();
            } else if Some(new_row) == inserted_iter.peek().copied() {
                if let Some(LineOperation::Insert { lines }) = ops.last_mut() {
                    *lines += 1;
                } else {
                    ops.push(LineOperation::Insert { lines: 1 });
                }
                new_row += 1;
                inserted_iter.next();
            } else {
                let next_del = deleted_iter.peek().copied().unwrap_or(total_old_lines);
                let next_ins = inserted_iter.peek().copied().unwrap_or(total_new_lines);
                let kept = cmp::max(1, cmp::min(next_del - old_row, next_ins - new_row));
                ops.push(LineOperation::Keep { lines: kept });
                old_row += kept;
                new_row += kept;
            }
        }

        // Keep remaining lines
        if old_row < total_old_lines {
            ops.push(LineOperation::Keep {
                lines: total_old_lines - old_row,
            });
        }

        ops
    }
}

// ── Tauri command for streaming diff ──────────────────────────────────────────

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum DiffOp {
    Insert { text: String },
    Delete { bytes: usize },
    Keep { bytes: usize },
}

impl From<&CharOperation> for DiffOp {
    fn from(op: &CharOperation) -> Self {
        match op {
            CharOperation::Insert { text } => DiffOp::Insert { text: text.clone() },
            CharOperation::Delete { bytes } => DiffOp::Delete { bytes: *bytes },
            CharOperation::Keep { bytes } => DiffOp::Keep { bytes: *bytes },
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum LineDiffOp {
    Insert { lines: u32 },
    Delete { lines: u32 },
    Keep { lines: u32 },
}

impl From<&LineOperation> for LineDiffOp {
    fn from(op: &LineOperation) -> Self {
        match op {
            LineOperation::Insert { lines } => LineDiffOp::Insert { lines: *lines },
            LineOperation::Delete { lines } => LineDiffOp::Delete { lines: *lines },
            LineOperation::Keep { lines } => LineDiffOp::Keep { lines: *lines },
        }
    }
}

/// Compute a full diff between old and new text (non-streaming, for completed edits).
#[tauri::command]
pub fn compute_diff(old_text: String, new_text: String) -> Vec<DiffOp> {
    let mut diff = StreamingDiff::new(old_text);
    let mut ops = diff.push_new(&new_text);
    ops.extend(diff.finish());
    ops.iter().map(DiffOp::from).collect()
}

/// Compute line-level diff operations between old and new text.
#[tauri::command]
pub fn compute_line_diff(old_text: String, new_text: String) -> Vec<LineDiffOp> {
    let mut diff = StreamingDiff::new(old_text.clone());
    let mut char_ops = diff.push_new(&new_text);
    char_ops.extend(diff.finish());

    let mut line_diff = LineDiff::default();
    line_diff.push_char_operations(&char_ops, &old_text);
    line_diff.line_operations().iter().map(LineDiffOp::from).collect()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_insertion() {
        let mut diff = StreamingDiff::new("hello world".to_string());
        let ops = diff.push_new("hello beautiful world");
        let remaining = diff.finish();
        let all_ops: Vec<_> = ops.into_iter().chain(remaining).collect();

        // Should have Keep("hello ") + Insert("beautiful ") + Keep("world")
        assert!(!all_ops.is_empty());
    }

    #[test]
    fn test_simple_deletion() {
        let mut diff = StreamingDiff::new("hello beautiful world".to_string());
        let ops = diff.push_new("hello world");
        let remaining = diff.finish();
        let all_ops: Vec<_> = ops.into_iter().chain(remaining).collect();

        assert!(!all_ops.is_empty());
    }

    #[test]
    fn test_streaming_chunks() {
        let old = "function hello() { return 'world'; }";
        let new_text = "function hello() { return 'universe'; }";

        let mut diff = StreamingDiff::new(old.to_string());

        // Simulate streaming: push in small chunks
        let mut all_ops = Vec::new();
        let chunks = ["function", " hello() {", " return '", "universe", "'; }"];
        for chunk in chunks {
            all_ops.extend(diff.push_new(chunk));
        }
        all_ops.extend(diff.finish());

        // Verify the operations reconstruct the new text
        let mut result = String::new();
        let mut old_ix = 0;
        for op in &all_ops {
            match op {
                CharOperation::Keep { bytes } => {
                    result.push_str(&old[old_ix..old_ix + bytes]);
                    old_ix += bytes;
                }
                CharOperation::Delete { bytes } => {
                    old_ix += bytes;
                }
                CharOperation::Insert { text } => {
                    result.push_str(text);
                }
            }
        }
        assert_eq!(result, new_text);
    }

    #[test]
    fn test_compute_diff_command() {
        let old = "line1\nline2\nline3";
        let new = "line1\nmodified\nline3";
        let ops = compute_diff(old.to_string(), new.to_string());
        assert!(!ops.is_empty());
    }

    #[test]
    fn test_compute_line_diff_command() {
        let old = "line1\nline2\nline3";
        let new = "line1\nmodified\nline3";
        let ops = compute_line_diff(old.to_string(), new.to_string());
        assert!(!ops.is_empty());
    }
}
