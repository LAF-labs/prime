/**
 * Structured diff types returned by `task_diff_structured` / `git_diff_structured`.
 *
 * Mirrors the Rust types in `src-tauri/src/commands/diff_parse.rs`. The renderer
 * never parses diffs; the backend hands them over already structured.
 */

export type DiffLineKind = 'context' | 'addition' | 'deletion'

export interface DiffLine {
  readonly kind: DiffLineKind
  readonly oldLineno?: number
  readonly newLineno?: number
  readonly content: string
}

export interface DiffHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly header?: string
  readonly additionLines: number
  readonly deletionLines: number
  readonly lines: readonly DiffLine[]
}

export type FileChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'

export interface FileDiff {
  readonly path: string
  readonly oldPath?: string
  readonly change: FileChangeKind
  readonly binary: boolean
  readonly additionLines: number
  readonly deletionLines: number
  readonly hunks: readonly DiffHunk[]
}

export interface ParsedDiff {
  readonly files: readonly FileDiff[]
  readonly totalAdditions: number
  readonly totalDeletions: number
}
