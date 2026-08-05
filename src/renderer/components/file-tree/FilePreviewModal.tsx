import { memo, useCallback, useEffect, useState } from 'react'
import { IconX, IconExternalLink, IconCode, IconPhoto } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ipc } from '@/lib/ipc'
import { getPreferredEditor } from '@/components/OpenInEditorGroup'
import { cn } from '@/lib/utils'
import MarkdownViewer from '@/components/MarkdownViewer'

const RASTER_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])
const MD_EXTS = new Set(['md', 'mdx', 'markdown'])
const CSV_EXTS = new Set(['csv', 'tsv'])

type FileKind = 'image' | 'svg' | 'markdown' | 'csv' | 'json' | 'code'

function detectKind(ext: string): FileKind {
  if (RASTER_EXTS.has(ext)) return 'image'
  if (ext === 'svg') return 'svg'
  if (MD_EXTS.has(ext)) return 'markdown'
  if (CSV_EXTS.has(ext)) return 'csv'
  if (ext === 'json') return 'json'
  return 'code'
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
    svg: 'image/svg+xml',
  }
  return map[ext] ?? 'application/octet-stream'
}

// Language-aware keyword sets (module-level, built once)
const KW_MAP: Record<string, string> = {
  ts: 'import|export|from|const|let|var|function|return|if|else|for|while|class|interface|type|extends|implements|new|this|async|await|try|catch|throw|typeof|instanceof|in|of|default|switch|case|break|continue|null|undefined|true|false|void|enum|readonly|abstract|static|public|private|protected',
  tsx: 'import|export|from|const|let|var|function|return|if|else|for|while|class|interface|type|extends|implements|new|this|async|await|try|catch|throw|typeof|instanceof|in|of|default|switch|case|break|continue|null|undefined|true|false|void|enum|readonly|abstract|static|public|private|protected',
  js: 'import|export|from|const|let|var|function|return|if|else|for|while|class|extends|new|this|async|await|try|catch|throw|typeof|instanceof|in|of|default|switch|case|break|continue|null|undefined|true|false|void',
  jsx: 'import|export|from|const|let|var|function|return|if|else|for|while|class|extends|new|this|async|await|try|catch|throw|typeof|instanceof|in|of|default|switch|case|break|continue|null|undefined|true|false|void',
  py: 'import|from|def|return|if|elif|else|for|while|class|with|as|try|except|raise|finally|pass|break|continue|and|or|not|in|is|None|True|False|lambda|yield|global|nonlocal|async|await',
  rs: 'use|mod|pub|fn|let|mut|const|if|else|for|while|loop|match|struct|enum|impl|trait|type|where|return|self|Self|super|crate|async|await|move|ref|true|false|None|Some|Ok|Err|unsafe|extern|dyn|static',
  go: 'package|import|func|return|if|else|for|range|switch|case|default|var|const|type|struct|interface|map|chan|go|defer|select|break|continue|nil|true|false',
  rb: 'require|include|def|end|if|elsif|else|unless|for|while|do|class|module|return|self|nil|true|false|yield|begin|rescue|ensure|raise|attr_accessor|attr_reader',
  java: 'import|package|class|interface|extends|implements|public|private|protected|static|final|void|return|if|else|for|while|new|this|super|try|catch|throw|throws|null|true|false|abstract|synchronized',
  c: 'include|define|if|else|for|while|do|switch|case|default|return|struct|typedef|enum|union|void|int|char|float|double|long|short|unsigned|signed|const|static|extern|sizeof|NULL|break|continue',
  cpp: 'include|define|if|else|for|while|do|switch|case|default|return|class|struct|typedef|enum|union|namespace|using|template|typename|virtual|override|public|private|protected|new|delete|this|nullptr|true|false|const|static|void|int|char|float|double|auto|break|continue',
  h: 'include|define|if|else|for|while|do|switch|case|default|return|struct|typedef|enum|union|void|int|char|float|double|long|short|unsigned|signed|const|static|extern|sizeof|NULL|break|continue',
  css: '@import|@media|@keyframes|@font-face|!important',
  html: 'DOCTYPE|html|head|body|div|span|script|style|link|meta|title|class|id|src|href',
  sql: 'SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|NULL|IN|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|UNION|SET|VALUES|INTO|DISTINCT|COUNT|SUM|AVG|MAX|MIN|BETWEEN|LIKE|EXISTS|CASE|WHEN|THEN|ELSE|END|IS',
  sh: 'if|then|else|elif|fi|for|while|do|done|case|esac|function|return|local|export|source|echo|exit|test|true|false',
  bash: 'if|then|else|elif|fi|for|while|do|done|case|esac|function|return|local|export|source|echo|exit|test|true|false',
  toml: 'true|false',
  yaml: 'true|false|null|yes|no',
  yml: 'true|false|null|yes|no',
}

// Cached combined tokenizer regexes per extension (single-pass to avoid double-wrapping)
const tokenRegexCache = new Map<string, RegExp>()
function getTokenRegex(ext: string): RegExp {
  if (tokenRegexCache.has(ext)) return tokenRegexCache.get(ext)!
  const keywords = KW_MAP[ext] ?? KW_MAP['ts'] ?? ''
  // Order matters: strings first (captures quotes), then comments, then numbers, then keywords
  const parts = [
    `(["'\`])(?:(?!\\1|\\\\).|\\\\.)*?\\1`, // strings (group 1 = quote char)
    `(\\/\\/.*$|#.*$)`,                       // comments (group 2)
    `(\\b\\d+\\.?\\d*(?:e[+-]?\\d+)?\\b)`,   // numbers (group 3)
  ]
  if (keywords) parts.push(`(\\b(?:${keywords})\\b)`) // keywords (group 4)
  const re = new RegExp(parts.join('|'), 'gm')
  tokenRegexCache.set(ext, re)
  return re
}

// Single-pass syntax highlighting — no double-wrapping possible
function tokenize(code: string, ext: string): string {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const re = getTokenRegex(ext)
  re.lastIndex = 0
  return escaped.replace(re, (match, _q, comment, num, kw) => {
    if (comment !== undefined) return `<span class="tok-cmt">${match}</span>`
    if (num !== undefined) return `<span class="tok-num">${match}</span>`
    if (kw !== undefined) return `<span class="tok-kw">${match}</span>`
    // First alternative matched — it's a string
    return `<span class="tok-str">${match}</span>`
  })
}

// CSV parser that handles quoted fields containing delimiters
function parseCsv(content: string): string[][] {
  const lines = content.trim().split('\n')
  const sep = content.includes('\t') ? '\t' : ','
  return lines.map((line) => {
    const cells: string[] = []
    let i = 0
    while (i <= line.length) {
      if (i === line.length) { cells.push(''); break }
      if (line[i] === '"') {
        // Quoted field — find closing quote (doubled quotes are escaped)
        let end = i + 1
        while (end < line.length) {
          if (line[end] === '"') {
            if (end + 1 < line.length && line[end + 1] === '"') { end += 2; continue }
            break
          }
          end++
        }
        cells.push(line.slice(i + 1, end).replace(/""/g, '"'))
        i = end + 2 // skip closing quote + separator
      } else {
        const next = line.indexOf(sep, i)
        if (next === -1) { cells.push(line.slice(i)); break }
        cells.push(line.slice(i, next))
        i = next + 1
      }
    }
    return cells
  })
}

// JSON colorizer
function colorizeJson(content: string): string {
  try {
    const formatted = JSON.stringify(JSON.parse(content), null, 2)
    return formatted
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"([^"]+)"(?=\s*:)/g, '<span class="tok-key">"$1"</span>')
      .replace(/:\s*"([^"]*?)"/g, ': <span class="tok-str">"$1"</span>')
      .replace(/:\s*(\d+\.?\d*)/g, ': <span class="tok-num">$1</span>')
      .replace(/:\s*(true|false|null)/g, ': <span class="tok-kw">$1</span>')
  } catch {
    return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

interface FilePreviewModalProps {
  filePath: string
  onClose: () => void
}

export const FilePreviewModal = memo(function FilePreviewModal({ filePath, onClose }: FilePreviewModalProps) {
  const [content, setContent] = useState<string | null>(null)
  const [base64, setBase64] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [svgShowSource, setSvgShowSource] = useState(false)

  const fileName = filePath.split('/').pop() ?? ''
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const kind = detectKind(ext)
  const shortPath = filePath.replace(/^\/Users\/[^/]+/, '~')

  useEffect(() => {
    setLoading(true)
    setContent(null)
    setBase64(null)
    setSvgShowSource(false)

    if (kind === 'image') {
      ipc.readFileBase64(filePath)
        .then((b) => { setBase64(b); setLoading(false) })
        .catch((err) => { console.error('[FilePreview] readFileBase64 error:', err); setLoading(false) })
    } else {
      ipc.readFile(filePath)
        .then((c) => { setContent(c); setLoading(false) })
        .catch((err) => { console.error('[FilePreview] readFile error:', err); setLoading(false) })
    }
  }, [filePath, kind])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() }
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative flex h-[85vh] w-[750px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{fileName}</p>
            <p className="truncate text-[10px] font-mono text-muted-foreground mt-0.5">{shortPath}</p>
          </div>
          {kind === 'svg' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setSvgShowSource((v) => !v)}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                    svgShowSource ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {svgShowSource ? <IconPhoto className="size-3.5" /> : <IconCode className="size-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{svgShowSource ? 'Preview' : 'View source'}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => ipc.openInEditor(filePath, getPreferredEditor()).catch(() => {})}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <IconExternalLink className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open in editor</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClose}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <IconX className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Close (Esc)</TooltipContent>
          </Tooltip>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}

          {!loading && kind === 'image' && base64 && (
            <div className="flex h-full items-center justify-center p-6 bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
              <img
                src={`data:${getMimeType(ext)};base64,${base64}`}
                alt={fileName}
                className="max-h-full max-w-full object-contain rounded-lg"
              />
            </div>
          )}

          {!loading && kind === 'svg' && content !== null && !svgShowSource && (
            <div className="flex h-full items-center justify-center p-6 bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
              <img
                src={`data:image/svg+xml;base64,${btoa(Array.from(new TextEncoder().encode(content), (b) => String.fromCharCode(b)).join(''))}`}
                alt={fileName}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}

          {!loading && kind === 'svg' && content !== null && svgShowSource && (
            <CodeView content={content} ext="svg" />
          )}

          {!loading && kind === 'markdown' && content !== null && (
            <div className="p-6">
              <MarkdownViewer content={content} fontSize={14} />
            </div>
          )}

          {!loading && kind === 'csv' && content !== null && (
            <CsvView content={content} />
          )}

          {!loading && kind === 'json' && content !== null && (
            <div className="p-4 overflow-auto">
              <pre
                className="text-[12px] leading-relaxed font-mono"
                dangerouslySetInnerHTML={{ __html: colorizeJson(content) }}
              />
            </div>
          )}

          {!loading && kind === 'code' && content !== null && (
            <CodeView content={content} ext={ext} />
          )}

          {!loading && content === null && base64 === null && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">Could not read file.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

const CodeView = memo(function CodeView({ content, ext }: { content: string; ext: string }) {
  const lines = content.split('\n')
  const gutterWidth = String(lines.length).length

  return (
    <div className="flex overflow-auto text-[12px] font-mono leading-[1.6]">
      {/* Line numbers */}
      <div className="sticky left-0 shrink-0 select-none border-r border-border/40 bg-muted/20 px-3 py-3 text-right text-muted-foreground/50">
        {lines.map((_, i) => (
          <div key={i} style={{ minWidth: `${gutterWidth}ch` }}>{i + 1}</div>
        ))}
      </div>
      {/* Code */}
      <pre className="flex-1 py-3 px-4 overflow-x-auto">
        {lines.map((line, i) => (
          <div key={i} dangerouslySetInnerHTML={{ __html: tokenize(line, ext) || '&nbsp;' }} />
        ))}
      </pre>
    </div>
  )
})

const CsvView = memo(function CsvView({ content }: { content: string }) {
  const rows = parseCsv(content)
  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">Empty file</p>
  const [header, ...body] = rows

  return (
    <div className="overflow-auto p-4">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="border-b border-border">
            {header.map((cell, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-foreground/90 bg-muted/30 whitespace-nowrap">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className={cn('border-b border-border/30', ri % 2 === 1 && 'bg-muted/10')}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-foreground/80 whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})
