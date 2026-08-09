import { t } from '@/lib/i18n'
import { memo, useCallback } from 'react'
import { IconX } from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { useProjectIcon } from '@/hooks/useProjectIcon'
import { ProjectIcon } from '@/components/sidebar/ProjectIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface SplitPanelHeaderProps {
  readonly taskId: string
  readonly isFocused: boolean
  readonly onClose: () => void
  readonly onFocus: () => void
}

export const SplitPanelHeader = memo(function SplitPanelHeader({
  taskId,
  isFocused,
  onClose,
  onFocus,
}: SplitPanelHeaderProps) {
  const taskName = useTaskStore((s) => s.tasks[taskId]?.name ?? 'Thread')
  const workspace = useTaskStore((s) => {
    const t = s.tasks[taskId]
    return t ? (t.workspace) : null
  })
  const projectName = useTaskStore((s) => {
    const t = s.tasks[taskId]
    const ws = t ? (t.workspace) : null
    if (!ws) return ''
    return s.projectNames[ws] ?? ws.split('/').pop() ?? ''
  })
  const icon = useProjectIcon(workspace ?? '')

  const handleClick = useCallback(() => onFocus(), [onFocus])
  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose()
  }, [onClose])

  return (
    <div
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- header row contains a nested close <button>; nested buttons are invalid HTML
      role="button"
      tabIndex={0}
      aria-label={`Focus ${taskName} panel`}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter') handleClick() }}
      className={cn(
        'group/header relative flex h-10 shrink-0 items-center gap-2 border-b px-3 select-none cursor-pointer transition-colors',
        isFocused
          ? 'border-primary/20 bg-primary/[0.03]'
          : 'border-border bg-card/30 hover:bg-card/60',
      )}
    >
      <ProjectIcon icon={icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-0">
        <span className={cn(
          'min-w-0 truncate text-[12.5px] leading-tight transition-colors',
          isFocused ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}>
          {taskName}
        </span>
        <span className="min-w-0 max-w-[160px] truncate text-[11px] leading-tight text-muted-foreground/50">
          {projectName}
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('Close panel')}
            onClick={handleClose}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconX className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('Close panel')}</TooltipContent>
      </Tooltip>
      {isFocused && (
        <div className="absolute inset-x-0 bottom-0 h-[1.5px] bg-primary/70" />
      )}
    </div>
  )
})
