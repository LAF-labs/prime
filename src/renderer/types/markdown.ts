/**
 * Markdown block types returned by `parse_markdown`. Mirrors the Rust types in
 * `src-tauri/src/commands/markdown.rs`.
 *
 * The renderer receives a flat block list and switches on `block.type`. No
 * `react-markdown`, no `remark`, no parser bundle — pure structural rendering.
 */

export interface InlineStyle {
  readonly bold?: boolean
  readonly italic?: boolean
  readonly strike?: boolean
  readonly code?: boolean
  readonly linkHref?: string
  readonly linkTitle?: string
}

export interface InlineSpan {
  readonly text: string
  readonly style?: InlineStyle
}

export interface ListItemModel {
  readonly spans: readonly InlineSpan[]
  readonly checked?: boolean
  readonly children?: readonly MarkdownBlock[]
}

export interface TableRow {
  readonly cells: readonly (readonly InlineSpan[])[]
}

export type MarkdownBlock =
  | { readonly type: 'paragraph'; readonly spans: readonly InlineSpan[] }
  | { readonly type: 'heading'; readonly level: number; readonly spans: readonly InlineSpan[] }
  | { readonly type: 'codeBlock'; readonly language: string; readonly text: string }
  | { readonly type: 'blockquote'; readonly children: readonly MarkdownBlock[] }
  | {
      readonly type: 'list'
      readonly ordered: boolean
      readonly start?: number
      readonly items: readonly ListItemModel[]
    }
  | { readonly type: 'horizontalRule' }
  | {
      readonly type: 'table'
      readonly header: readonly (readonly InlineSpan[])[]
      readonly rows: readonly TableRow[]
    }
  | { readonly type: 'html'; readonly text: string }
  | { readonly type: 'mermaid'; readonly text: string }
  | { readonly type: 'kiroSummary'; readonly json: string }
  | { readonly type: 'kirodexReport'; readonly json: string }

export interface ParsedMarkdown {
  readonly blocks: readonly MarkdownBlock[]
}
