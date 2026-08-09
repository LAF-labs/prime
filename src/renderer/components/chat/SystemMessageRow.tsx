import { t } from '@/lib/i18n'
import { memo } from 'react'
import { IconGitBranch, IconInfoCircle, IconAlertTriangle } from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import type { SystemMessageRow as SystemMessageRowData } from '@/lib/timeline'
import { HighlightText } from './HighlightText'

/**
 * The one thing to do about a failed turn, rendered as a real control.
 *
 * A provider error used to arrive as the provider's own JSON, printed as small
 * centred grey text — the same treatment whether the API key was rejected or
 * the provider had a 500. The backend now classifies it; this turns that
 * classification into something clickable.
 */
const ErrorActionButton = memo(function ErrorActionButton({
  action,
}: {
  action: NonNullable<SystemMessageRowData['errorAction']>
}) {
  if (action === 'open-settings') {
    return (
      <button
        type="button"
        onClick={() => useTaskStore.getState().setSettingsOpen(true, 'providers')}
        className="rounded-md border border-destructive/30 px-2.5 py-1 text-[12px] font-medium text-destructive/90 transition-colors hover:bg-destructive/10"
      >
        {t('Open provider settings')}
      </button>
    )
  }
  if (action === 'compact') {
    return (
      <p className="text-[12px] text-muted-foreground">
        {t('Run /compact to shorten the thread, or start a new one.')}
      </p>
    )
  }
  // 'retry': there is no button to press — sending again is the retry.
  return (
    <p className="text-[12px] text-muted-foreground">
      {t('Send your message again to retry.')}
    </p>
  )
})

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
            {t('Worktree')} <span className="text-muted-foreground/80 font-medium">{slug}</span>
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

  // Error variant — show a card for multi-line errors (e.g. model errors with tips)
  const cleaned = row.content.replace(/^\u26a0\ufe0f\s*/, '')
  const parts = cleaned.split(/\n\n/)
  // Anything the user can act on gets the card, whether or not the message
  // happens to contain a blank line.
  const hasDetail = parts.length > 1 || !!row.errorAction

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
                {row.errorAction && <ErrorActionButton action={row.errorAction} />}
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

