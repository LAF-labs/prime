/**
 * Syntax highlighting types returned by `highlight_code`. Mirrors the Rust
 * types in `src-tauri/src/commands/highlight.rs`.
 *
 * The renderer receives a flat `Vec<HighlightSpan>` and styles them — no Shiki
 * WASM, no client-side grammar, no main-thread tree-sitter parse.
 */

export interface HighlightSpan {
  readonly start: number
  readonly end: number
  readonly color: string
  readonly bg?: string
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
}

export interface HighlightResult {
  readonly spans: readonly HighlightSpan[]
  readonly language: string
  readonly cached: boolean
}
