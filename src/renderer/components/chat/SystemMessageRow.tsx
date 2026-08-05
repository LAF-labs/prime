import { memo } from 'react'
import { IconGitBranch, IconInfoCircle, IconAlertTriangle, IconPlugConnectedX } from '@tabler/icons-react'
import type { SystemMessageRow as SystemMessageRowData } from '@/lib/timeline'
import { HighlightText } from './HighlightText'

/** Extract slug and branch from worktree system message content */
const parseWorktreeMessage = (content: string): { slug: string; branch: string } => {
  const pathMatch = content.match(/`([^`]+)`.*?`([^`]+)`/)
  if (!pathMatch) return { slug: content, branch: '' }
  const fullPath = pathMatch[1]
  const branch = pathMatch[2]
  const slug = fullPath.split('/').pop() ?? fullPath
  return { slug, branch }
}

export const SystemMessageRow = memo(function SystemMessageRow({ row }: { row: SystemMessageRowData }) {
  if (row.variant === 'worktree') {
    const { slug, branch } = parseWorktreeMessage(row.content)
    return (
      <div className="pb-4" data-timeline-row-kind="system-message">
        <div className="mx-auto flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground/60">
          <IconGitBranch className="size-3.5 shrink-0" aria-hidden />
          <span>
            Worktree <span className="text-muted-foreground/80 font-medium">{slug}</span>
            {branch && <> on <span className="text-muted-foreground/80 font-medium">{branch}</span></>}
          </span>
        </div>
      </div>
    )
  }

  if (row.variant === 'info') {
    return (
      <div className="pb-4" data-timeline-row-kind="system-message">
        <div className="mx-auto flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground/60">
          <IconInfoCircle className="size-3.5 shrink-0" aria-hidden />
          <span className="break-words"><HighlightText text={row.content} /></span>
        </div>
      </div>
    )
  }

  if (row.variant === 'connection_lost') {
    return (
      <div className="pb-4" data-timeline-row-kind="system-message">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:max-w-4xl xl:max-w-5xl">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <IconPlugConnectedX className="mt-0.5 size-4 shrink-0 text-amber-500/70" aria-hidden />
              <div className="min-w-0 space-y-1 text-[13px]">
                <p className="break-words font-medium text-foreground/90">Connection to the agent was lost</p>
                <p className="break-words text-muted-foreground text-[12px]">Send a new message to reconnect and continue.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Error variant — show a card for multi-line errors (e.g. model errors with tips)
  const cleaned = row.content.replace(/^\u26a0\ufe0f\s*/, '')
  const parts = cleaned.split(/\n\n/)
  const hasDetail = parts.length > 1

  if (hasDetail) {
    return (
      <div className="pb-4" data-timeline-row-kind="system-message">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:max-w-4xl xl:max-w-5xl">
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/70" aria-hidden />
              <div className="min-w-0 space-y-2 text-[13px]">
                <p className="break-words text-foreground/90"><HighlightText text={parts[0]} /></p>
                {parts.slice(1).map((part, i) => (
                  <p key={i} className="break-words text-muted-foreground text-[12px]"><HighlightText text={part} /></p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4" data-timeline-row-kind="system-message">
      <div className="mx-auto flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground/60">
        <IconAlertTriangle className="size-3.5 shrink-0" aria-hidden />
        <span className="break-words"><HighlightText text={cleaned} /></span>
      </div>
    </div>
  )
})

