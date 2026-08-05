import { useEffect, useState, memo } from 'react'
import { IconX, IconExternalLink } from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { getPreferredEditor } from '@/components/OpenInEditorGroup'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import MarkdownViewer from '@/components/MarkdownViewer'

interface KiroFileViewerProps {
  filePath: string
  title: string
  onClose: () => void
}

export const KiroFileViewer = memo(function KiroFileViewer({ filePath, title, onClose }: KiroFileViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!filePath) { setContent(null); setLoading(false); return }
    setLoading(true)
    ipc.readFile(filePath).then((c) => { setContent(c); setLoading(false) })
  }, [filePath])

  const shortPath = (filePath ?? '').replace(/^\/Users\/[^/]+/, '~')
  const isJson = filePath.endsWith('.json')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative flex h-[80vh] w-[680px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{title}</p>
            <p className="truncate text-[10px] font-mono text-muted-foreground mt-0.5">{shortPath}</p>
          </div>
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
            <TooltipContent side="bottom">Close</TooltipContent>
          </Tooltip>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {!loading && content === null && (
            <p className="text-sm text-muted-foreground">Could not read file.</p>
          )}
          {!loading && content !== null && isJson && (
            <pre className={cn(
              'text-[12px] leading-relaxed font-mono text-foreground/80',
              'rounded-lg bg-muted/30 p-4 overflow-auto',
            )}>
              {content}
            </pre>
          )}
          {!loading && content !== null && !isJson && (
            <MarkdownViewer content={content} fontSize={13} />
          )}
        </div>
      </div>
    </div>
  )
})
