import { t } from '@/lib/i18n'
import { memo } from 'react'
import { IconPaperclip } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MOD_KEY } from '@/lib/platform'
import { BranchSelector } from './BranchSelector'
import { ModelPicker } from './ModelPicker'
import { PlanToggle } from './PlanToggle'
import { AutoApproveToggle } from './AutoApproveToggle'
import { EffortPicker, useEffortOptions } from './EffortPicker'
import { useIsSimpleMode } from '@/lib/ui-mode'

/** Pill-shaped group wrapper for toolbar items */
const ToolbarGroup = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('flex min-w-0 items-center gap-0.5 rounded-lg bg-muted/50 px-0.5 py-0.5', className)}>
    {children}
  </div>
)

/** Thin dot separator within a group */
const Dot = () => <span className="mx-0.5 size-[3px] shrink-0 rounded-full bg-border" aria-hidden />



interface ChatToolbarProps {
  isPlanMode: boolean
  isRunning?: boolean
  canSend: boolean
  hasQueuedMessages?: boolean
  workspace: string | null
  isWorktree?: boolean
  isMetaHeld?: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFilePickerClick: () => void
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onSend: () => void
  onPause?: () => void
}

export const ChatToolbar = memo(function ChatToolbar({
  isPlanMode,
  isRunning,
  canSend,
  hasQueuedMessages,
  workspace,
  isWorktree,
  isMetaHeld,
  fileInputRef,
  onFilePickerClick,
  onFileInputChange,
  onSend,
  onPause,
}: ChatToolbarProps) {
  const buttonBg = isPlanMode ? 'bg-teal-500/90 hover:bg-teal-500' : 'bg-blue-500/90 hover:bg-blue-500'
  // Non-reasoning models report a single level, and EffortPicker hides itself —
  // the separator has to disappear with it or the group renders "· ·".
  const { hasChoice: hasEffortChoice } = useEffortOptions()
  // Simple mode is the daily-agent surface: a git branch pill in a chat
  // toolbar is developer chrome, so it renders only in developer mode.
  const isSimpleMode = useIsSimpleMode()

  return (
    <div className="relative z-10 flex min-w-0 items-center justify-between gap-2 overflow-visible px-3 pb-3 sm:px-4 @container/toolbar">
      {/* Left: AI controls (mode + model) */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <ToolbarGroup className="min-w-0">
          <ModelPicker />
          {hasEffortChoice && (
            <>
              <Dot />
              <EffortPicker />
            </>
          )}
          <Dot />
          <AutoApproveToggle />
        </ToolbarGroup>
      </div>

      {/* Right: plan/code + attach + git + send/pause. Plan mode moved out of
          the left group so that group reads model → effort → permissions. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <PlanToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onFilePickerClick}
              aria-label={t('Attach files')}
              data-testid="attach-files-button"
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-muted-foreground/70"
            >
              <IconPaperclip className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[11px]">{t('Attach files or images')}</TooltipContent>
        </Tooltip>
        {!isSimpleMode && <BranchSelector workspace={workspace ?? null} isWorktree={isWorktree} />}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFileInputChange}
          tabIndex={-1}
          aria-hidden
        />
        {/* Send hint — visible only when Cmd is held */}
        {isMetaHeld && (
          <kbd className="rounded-sm bg-muted px-1 font-mono text-[10px] text-muted-foreground">{MOD_KEY}⏎</kbd>
        )}
        {isRunning ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onPause}
                aria-label={t('Pause agent (Escape)')}
                data-testid="pause-button"
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-white transition-all duration-150 hover:scale-105',
                  isPlanMode ? 'bg-teal-500/90 hover:bg-teal-500' : 'bg-blue-500/90 hover:bg-blue-500',
                )}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                  <rect x="1.5" y="1" width="3" height="10" rx="1" />
                  <rect x="7.5" y="1" width="3" height="10" rx="1" />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">
              {t('Pause agent')} <kbd className="ml-1 rounded-sm bg-background/15 px-1 text-[10px]">{t('Esc')}</kbd>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onSend}
                disabled={!canSend}
                aria-label={isRunning ? t('Queue message (Enter)') : t('Send message (Enter)')}
                data-testid="send-button"
                className={cn(
                  'relative flex h-8 w-8 items-center justify-center rounded-full text-white transition-all duration-200 ease-out',
                  canSend ? buttonBg : 'bg-muted/60',
                  canSend && 'hover:scale-105',
                  'disabled:pointer-events-none disabled:hover:scale-100',
                )}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {hasQueuedMessages && (
                  <span className="absolute -top-1 -right-1 flex size-3 items-center justify-center rounded-full bg-amber-500" aria-label={t('Messages queued')}>
                    <span className="size-1.5 rounded-full bg-white" />
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">
              {t('Send message')} <kbd className="ml-1 rounded-sm bg-background/15 px-1 text-[10px]">⏎</kbd>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
})
