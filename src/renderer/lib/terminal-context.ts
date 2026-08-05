/**
 * Terminal context management.
 *
 * Allows users to select text from terminal output and attach it as context
 * to their next message. The selection gets formatted as <terminal_context>
 * blocks with line numbers.
 */

export interface TerminalContextSelection {
  terminalId: string
  terminalLabel: string
  lineStart: number
  lineEnd: number
  text: string
}

export interface TerminalContextDraft {
  id: string
  taskId: string
  terminalId: string
  terminalLabel: string
  lineStart: number
  lineEnd: number
  text: string
  createdAt: string
}

export interface ParsedTerminalContextEntry {
  header: string
  body: string
}

/**
 * Normalize terminal context text (strip CR, trim leading/trailing newlines).
 */
export function normalizeTerminalContextText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
}

/**
 * Check if a terminal context selection has meaningful text.
 */
export function hasTerminalContextText(context: { text: string }): boolean {
  return normalizeTerminalContextText(context.text).length > 0
}

/**
 * Normalize a terminal context selection, returning null if invalid.
 */
export function normalizeTerminalContextSelection(
  selection: TerminalContextSelection,
): TerminalContextSelection | null {
  const text = normalizeTerminalContextText(selection.text)
  const terminalId = selection.terminalId.trim()
  const terminalLabel = selection.terminalLabel.trim()
  if (text.length === 0 || terminalId.length === 0 || terminalLabel.length === 0) {
    return null
  }
  const lineStart = Math.max(1, Math.floor(selection.lineStart))
  const lineEnd = Math.max(lineStart, Math.floor(selection.lineEnd))
  return { terminalId, terminalLabel, lineStart, lineEnd, text }
}

/**
 * Format a terminal context range for display.
 * Example: "line 5" or "lines 5-12"
 */
export function formatTerminalContextRange(selection: { lineStart: number; lineEnd: number }): string {
  return selection.lineStart === selection.lineEnd
    ? `line ${selection.lineStart}`
    : `lines ${selection.lineStart}-${selection.lineEnd}`
}

/**
 * Format a terminal context label for display.
 * Example: "Terminal 1 lines 5-12"
 */
export function formatTerminalContextLabel(selection: {
  terminalLabel: string
  lineStart: number
  lineEnd: number
}): string {
  return `${selection.terminalLabel} ${formatTerminalContextRange(selection)}`
}

/**
 * Build the <terminal_context> block to append to a prompt.
 */
export function buildTerminalContextBlock(
  contexts: readonly TerminalContextSelection[],
): string {
  const normalized = contexts
    .map((c) => normalizeTerminalContextSelection(c))
    .filter((c): c is TerminalContextSelection => c !== null)
  if (normalized.length === 0) return ''

  const lines: string[] = []
  for (let i = 0; i < normalized.length; i++) {
    const ctx = normalized[i]
    lines.push(`- ${formatTerminalContextLabel(ctx)}:`)
    const textLines = normalizeTerminalContextText(ctx.text).split('\n')
    for (let j = 0; j < textLines.length; j++) {
      lines.push(`  ${ctx.lineStart + j} | ${textLines[j]}`)
    }
    if (i < normalized.length - 1) lines.push('')
  }

  return ['<terminal_context>', ...lines, '</terminal_context>'].join('\n')
}

/**
 * Append terminal context blocks to a prompt.
 */
export function appendTerminalContextsToPrompt(
  prompt: string,
  contexts: readonly TerminalContextSelection[],
): string {
  const trimmedPrompt = prompt.trim()
  const contextBlock = buildTerminalContextBlock(contexts)
  if (contextBlock.length === 0) return trimmedPrompt
  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${contextBlock}` : contextBlock
}

/**
 * Extract trailing terminal context blocks from a prompt.
 * Returns the prompt text without the context block and the parsed contexts.
 */
export function extractTrailingTerminalContexts(prompt: string): {
  promptText: string
  contextCount: number
  contexts: ParsedTerminalContextEntry[]
} {
  const pattern = /\n*<terminal_context>\n([\s\S]*?)\n<\/terminal_context>\s*$/
  const match = pattern.exec(prompt)
  if (!match) {
    return { promptText: prompt, contextCount: 0, contexts: [] }
  }
  const promptText = prompt.slice(0, match.index).replace(/\n+$/, '')
  const parsed = parseTerminalContextEntries(match[1] ?? '')
  return { promptText, contextCount: parsed.length, contexts: parsed }
}

/**
 * Build a preview title for terminal contexts (for tooltip display).
 */
export function buildTerminalContextPreviewTitle(
  contexts: readonly TerminalContextSelection[],
): string | null {
  if (contexts.length === 0) return null
  const previews = contexts
    .map((ctx) => {
      const normalized = normalizeTerminalContextSelection(ctx)
      if (!normalized) return null
      const text = normalizeTerminalContextText(normalized.text)
      const previewLines = text.split('\n').slice(0, 3)
      if (text.split('\n').length > 3) previewLines.push('...')
      const preview = previewLines.join('\n')
      const truncated = preview.length > 180 ? `${preview.slice(0, 177)}...` : preview
      return `${formatTerminalContextLabel(normalized)}\n${truncated}`
    })
    .filter((v): v is string => v !== null)
    .join('\n\n')
  return previews.length > 0 ? previews : null
}

function parseTerminalContextEntries(block: string): ParsedTerminalContextEntry[] {
  const entries: ParsedTerminalContextEntry[] = []
  let current: { header: string; bodyLines: string[] } | null = null

  const commitCurrent = () => {
    if (!current) return
    entries.push({ header: current.header, body: current.bodyLines.join('\n').trimEnd() })
    current = null
  }

  for (const rawLine of block.split('\n')) {
    const headerMatch = /^- (.+):$/.exec(rawLine)
    if (headerMatch) {
      commitCurrent()
      current = { header: headerMatch[1]!, bodyLines: [] }
      continue
    }
    if (!current) continue
    if (rawLine.startsWith('  ')) {
      current.bodyLines.push(rawLine.slice(2))
    } else if (rawLine.length === 0) {
      current.bodyLines.push('')
    }
  }

  commitCurrent()
  return entries
}
