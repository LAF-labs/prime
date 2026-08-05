import { memo } from 'react'
import { IconFileText, IconFolder } from '@tabler/icons-react'

interface ReadOperation {
  readonly path: string
  readonly offset: number
  readonly limit: number
  readonly mode: string
}

/** Extract operations from read tool call rawInput */
export const parseReadInput = (rawInput: unknown): ReadOperation[] | null => {
  if (!rawInput || typeof rawInput !== 'object') return null
  const input = rawInput as Record<string, unknown>
  const ops = input.operations
  if (!Array.isArray(ops) || ops.length === 0) return null
  const parsed: ReadOperation[] = []
  for (const op of ops) {
    if (!op || typeof op !== 'object') return null
    const o = op as Record<string, unknown>
    const path = typeof o.path === 'string' ? o.path : ''
    const mode = typeof o.mode === 'string' ? o.mode : 'Line'
    const offset = typeof o.offset === 'number' ? o.offset : 0
    const limit = typeof o.limit === 'number' ? o.limit : 0
    parsed.push({ path, offset, limit, mode })
  }
  return parsed
}

/** Extract text lines from read tool call rawOutput */
export const parseReadOutput = (rawOutput: unknown): string[] | null => {
  if (!rawOutput || typeof rawOutput !== 'object') return null
  const output = rawOutput as Record<string, unknown>
  const items = output.items
  if (!Array.isArray(items) || items.length === 0) return null
  const texts: string[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const text = entry.Text ?? entry.text
    if (typeof text === 'string') texts.push(text)
  }
  if (texts.length === 0) return null
  return texts.join('\n').split('\n')
}

/** Generate a compact human-readable summary from parsed operations */
export const formatReadSummary = (ops: ReadOperation[]): string => {
  if (ops.length > 1) return `Read ${ops.length} files`
  const op = ops[0]
  const fileName = op.path.split('/').pop() || op.path
  if (op.mode === 'Directory') return `List ${fileName}`
  if (op.mode === 'Image') return `View ${fileName}`
  if (op.offset > 0 && op.limit > 0) {
    return `Read ${fileName} lines ${op.offset + 1}–${op.offset + op.limit}`
  }
  if (op.limit > 0) return `Read ${fileName} (${op.limit} lines)`
  return `Read ${fileName}`
}

interface ReadOutputProps {
  readonly rawInput: unknown
  readonly rawOutput: unknown
}

export const ReadOutput = memo(function ReadOutput({ rawInput, rawOutput }: ReadOutputProps) {
  const ops = parseReadInput(rawInput)
  const lines = parseReadOutput(rawOutput)
  if (!ops || !lines) return null
  const offset = ops[0].offset
  const isDirectory = ops[0].mode === 'Directory'
  const summary = formatReadSummary(ops)
  // Remove trailing empty line from split
  const displayLines = lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
  const gutterWidth = String(offset + displayLines.length).length

  return (
    <div className="ml-6 mr-2 mb-1.5 mt-1 rounded-md border border-border/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 text-[11px] text-muted-foreground">
        {isDirectory ? <IconFolder className="size-3" /> : <IconFileText className="size-3" />}
        <span>{summary}</span>
        <span className="flex-1" />
        <span>{displayLines.length} lines</span>
      </div>
      <pre className="max-h-[200px] overflow-auto py-1 font-mono text-[12px] leading-[1.55]">
        {displayLines.map((line, i) => {
          const lineNum = offset + i + 1
          return (
            <div key={i} className="flex">
              <span
                className="shrink-0 select-none text-right text-muted-foreground pr-3 pl-2"
                style={{ minWidth: `${gutterWidth + 2}ch` }}
              >
                {lineNum}
              </span>
              <span className="flex-1 text-foreground/70 whitespace-pre overflow-x-auto pr-3">
                {line || ' '}
              </span>
            </div>
          )
        })}
      </pre>
    </div>
  )
})
