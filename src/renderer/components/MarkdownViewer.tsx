import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Children,
  isValidElement,
  type ReactNode,
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { IconCheck, IconCopy, IconSquare, IconSquareCheckFilled } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { handleExternalLinkClick, handleExternalLinkKeyDown } from '@/lib/open-external'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToPlainText).join('')
  if (isValidElement<{ children?: ReactNode }>(node))
    return nodeToPlainText(node.props.children)
  return ''
}

function extractCodeBlock(
  children: ReactNode,
): { className?: string; code: string } | null {
  const nodes = Children.toArray(children)
  if (nodes.length !== 1) return null
  const child = nodes[0]
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(child) ||
    child.type !== 'code'
  )
    return null
  return {
    className: child.props.className,
    code: nodeToPlainText(child.props.children),
  }
}

function extractLanguage(className?: string): string {
  return className?.match(/language-(\S+)/)?.[1] ?? 'text'
}

/** Generate a slug from heading text for anchor links */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

const CopyButton = memo(function CopyButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 1200)
    })
  }, [text])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      aria-label={copied ? 'Copied' : 'Copy code'}
    >
      {copied ? (
        <IconCheck className="size-3.5" />
      ) : (
        <IconCopy className="size-3.5" />
      )}
    </button>
  )
})

// ─── MarkdownViewer ───────────────────────────────────────────────────────────

interface MarkdownViewerProps {
  /** The raw markdown string to render */
  readonly content: string
  /** Optional className for the outer wrapper */
  readonly className?: string
  /** Font size in px (default 14) */
  readonly fontSize?: number
}

const remarkPlugins = [remarkGfm]

const MarkdownViewer = memo(function MarkdownViewer({
  content,
  className,
  fontSize = 14,
}: MarkdownViewerProps) {
  const components = useMemo<Components>(
    () => ({
      h1({ node, children, ...props }) {
        const text = nodeToPlainText(children)
        const id = slugify(text)
        return (
          <h1 id={id} {...props}>
            <a href={`#${id}`} className="no-underline hover:underline">{children}</a>
          </h1>
        )
      },
      h2({ node, children, ...props }) {
        const text = nodeToPlainText(children)
        const id = slugify(text)
        return (
          <h2 id={id} {...props}>
            <a href={`#${id}`} className="no-underline hover:underline">{children}</a>
          </h2>
        )
      },
      h3({ node, children, ...props }) {
        const text = nodeToPlainText(children)
        const id = slugify(text)
        return (
          <h3 id={id} {...props}>
            <a href={`#${id}`} className="no-underline hover:underline">{children}</a>
          </h3>
        )
      },
      h4({ node, children, ...props }) {
        const text = nodeToPlainText(children)
        const id = slugify(text)
        return (
          <h4 id={id} {...props}>
            <a href={`#${id}`} className="no-underline hover:underline">{children}</a>
          </h4>
        )
      },
      pre({ node, children, ...props }) {
        const block = extractCodeBlock(children)
        if (!block) return <pre {...props}>{children}</pre>
        const lang = extractLanguage(block.className)
        return (
          <div className="group relative my-3 overflow-hidden rounded-lg border border-border/50 bg-muted/50 dark:bg-muted/30">
            <div className="flex items-center justify-between border-b border-border/40 px-3.5 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {lang}
              </span>
              <CopyButton text={block.code} />
            </div>
            <pre className="overflow-x-auto px-4 py-3.5 text-[13px] leading-[1.6] text-foreground">
              <code className={block.className}>{block.code}</code>
            </pre>
          </div>
        )
      },
      code({ node, className: codeClassName, children, ...props }) {
        if (codeClassName?.startsWith('language-'))
          return (
            <code className={codeClassName} {...props}>
              {children}
            </code>
          )
        return (
          <code
            className="rounded-md border border-border/50 bg-muted px-1.5 py-0.5 text-[0.9em] text-foreground"
            {...props}
          >
            {children}
          </code>
        )
      },
      a({ node, href, children, ...props }) {
        return (
          <a
            href={href}
            onClick={handleExternalLinkClick}
            onKeyDown={handleExternalLinkKeyDown}
            tabIndex={0}
            role="link"
            className="text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary/60"
            {...props}
          >
            {children}
          </a>
        )
      },
      input({ node, type, checked, ...props }) {
        if (type === 'checkbox') {
          return (
            <span className="mr-1.5 inline-flex align-text-bottom">
              {checked ? (
                <IconSquareCheckFilled className="size-4 text-primary" />
              ) : (
                <IconSquare className="size-4 text-muted-foreground" />
              )}
            </span>
          )
        }
        return <input type={type} checked={checked} {...props} />
      },
      table({ node, children, ...props }) {
        return (
          <div className="my-3 overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full" {...props}>{children}</table>
          </div>
        )
      },
      img({ node, src, alt, ...props }) {
        return (
          <img
            src={src}
            alt={alt ?? ''}
            className="my-3 max-w-full rounded-lg border border-border/30"
            loading="lazy"
            {...props}
          />
        )
      },
      hr({ node, ...props }) {
        return <hr className="my-6 border-border/50" {...props} />
      },
    }),
    [],
  )

  return (
    <div
      className={cn('md-viewer w-full min-w-0 leading-[1.7] text-foreground', className)}
      style={{ fontSize }}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownViewer
