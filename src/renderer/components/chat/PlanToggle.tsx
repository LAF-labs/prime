import { t } from '@/lib/i18n'
import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { IconChevronDown, IconCode, IconListCheck } from '@tabler/icons-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import { usePanelResolvedTaskId } from './PanelContext'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

const MODE_CODE = 'code' as const
const MODE_PLAN = 'plan' as const

interface ModeEntry {
  readonly id: string
  readonly labelKey: 'Code' | 'Plan'
  readonly icon: typeof IconCode
}

const MODES: readonly ModeEntry[] = [
  { id: MODE_CODE, labelKey: 'Code' as const, icon: IconCode },
  { id: MODE_PLAN, labelKey: 'Plan' as const, icon: IconListCheck },
] as const

export const PlanToggle = memo(function PlanToggle() {
  const t = useT()
  const resolvedTaskId = usePanelResolvedTaskId()
  const globalModeId = useSettingsStore((s) => s.currentModeId)
  const taskModeId = useTaskStore((s) => resolvedTaskId ? s.taskModes[resolvedTaskId] ?? null : null)
  const currentModeId = taskModeId ?? globalModeId
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleSelect = useCallback((modeId: string) => {
    if (modeId === currentModeId) {
      setIsOpen(false)
      return
    }
    useSettingsStore.setState({ currentModeId: modeId })
    const taskId = resolvedTaskId
    if (taskId) {
      // Plan mode is applied client-side per message (see ChatPanel's
      // applyPlanMode) — prime-agent has no session modes to switch.
      useTaskStore.getState().setTaskMode(taskId, modeId)
    }
    setIsOpen(false)
  }, [currentModeId, resolvedTaskId])

  const isPlan = currentModeId === MODE_PLAN
  const current = MODES.find((m) => m.id === currentModeId) ?? MODES[0]
  const CurrentIcon = current.icon

  return (
    <div ref={ref} data-testid="plan-toggle" className="relative min-w-0">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={`Current mode: ${t(current.labelKey)}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] font-medium transition-colors',
          isPlan
            ? 'text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <CurrentIcon className="size-3.5" aria-hidden />
        <span className="hidden @[480px]/toolbar:inline">{t(current.labelKey)}</span>
        <IconChevronDown className="hidden size-3 shrink-0 opacity-50 @[480px]/toolbar:block" aria-hidden />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={t('Select mode')}
          className="absolute bottom-full left-0 z-[200] mb-2 min-w-[140px] rounded-xl border border-border bg-popover py-1.5 shadow-xl"
        >
          {MODES.map((m) => {
            const isActive = m.id === currentModeId
            const Icon = m.icon
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  handleSelect(m.id)
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent',
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
                  m.id === MODE_PLAN && isActive && 'text-teal-600 dark:text-teal-400',
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                {t(m.labelKey)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
})
