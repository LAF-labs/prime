import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { IconChevronDown, IconBrain } from '@tabler/icons-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import { usePanelResolvedTaskId } from './PanelContext'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { THINKING_LEVELS, isThinkingLevel, type ThinkingLevel } from '@/types'

/** Short label + one-line description per level, mirroring the harness's own copy. */
const LEVEL_META: Record<ThinkingLevel, { label: string; desc: string }> = {
  off: { label: 'Off', desc: 'No reasoning' },
  minimal: { label: 'Minimal', desc: 'Very brief reasoning' },
  low: { label: 'Low', desc: 'Light reasoning' },
  medium: { label: 'Medium', desc: 'Moderate reasoning' },
  high: { label: 'High', desc: 'Deep reasoning' },
  xhigh: { label: 'Extra high', desc: 'Very deep reasoning' },
  max: { label: 'Max', desc: 'Maximum reasoning' },
}

/** Levels above `medium` get a warmer tint — they cost visibly more. */
const isElevatedLevel = (level: ThinkingLevel): boolean =>
  level === 'high' || level === 'xhigh' || level === 'max'

/**
 * The levels the picker offers.
 *
 * The harness accepts seven; three is what anyone actually decides between.
 * `off` is deliberately absent — it disables reasoning outright and visibly
 * degrades answers, which is not a trade to make by accident. The floor here
 * is `low`, not `none`.
 *
 * `/thinking <level>` still reaches the full list for anyone who wants
 * `xhigh` or `max`, and a level set that way is displayed honestly as its
 * nearest neighbour rather than being rewritten.
 */
const OFFERED_LEVELS: readonly ThinkingLevel[] = ['low', 'medium', 'high']

const rank = (level: ThinkingLevel): number => THINKING_LEVELS.indexOf(level)

/**
 * Show a stored level as its nearest visible neighbour.
 *
 * A stored level with no button of its own (`xhigh`, `off` — e.g. carried
 * over from an older version) would leave the picker matching nothing, which
 * reads as broken. This only affects what is displayed; the stored value is
 * replaced solely when the user picks something.
 */
export const clampToVisible = (
  level: ThinkingLevel,
  visible: readonly ThinkingLevel[],
): ThinkingLevel => {
  if (visible.length === 0 || visible.includes(level)) return level
  return [...visible].sort(
    (a, b) => Math.abs(rank(a) - rank(level)) - Math.abs(rank(b) - rank(level)),
  )[0]
}

/**
 * Read the effort remembered for `modelId`. Effort is stored per model because
 * models differ in which levels they even accept, and in what a level costs.
 */
export const getModelEffort = (modelId: string | null | undefined): ThinkingLevel | undefined => {
  if (!modelId) return undefined
  const saved = useSettingsStore.getState().settings.modelEfforts?.[modelId]
  return isThinkingLevel(saved) ? saved : undefined
}

/**
 * Which levels this panel's model accepts, and which one is in effect.
 *
 * The option list comes from the agent (`availableThinkingLevels` on session
 * state), not from a hardcoded array: a model with no reasoning mode reports
 * just `["off"]`, and Codex-class models expose levels others reject. Until a
 * session reports its list we fall back to the full set, so the control is
 * never dead on a thread that hasn't connected yet.
 */
export const useEffortOptions = () => {
  const resolvedTaskId = usePanelResolvedTaskId()
  const globalModelId = useSettingsStore((s) => s.currentModelId)
  const taskModelId = useTaskStore((s) => (resolvedTaskId ? s.taskModels[resolvedTaskId] ?? null : null))
  const modelId = taskModelId ?? globalModelId
  const liveLevel = useTaskStore((s) => (resolvedTaskId ? s.thinkingLevels[resolvedTaskId] : undefined))
  const reported = useTaskStore((s) => (resolvedTaskId ? s.availableThinkingLevels[resolvedTaskId] : undefined))
  const savedLevel = useSettingsStore((s) => (modelId ? s.settings.modelEfforts?.[modelId] : undefined))

  const options: readonly ThinkingLevel[] = reported?.filter(isThinkingLevel) ?? THINKING_LEVELS
  const resolved = liveLevel ?? savedLevel
  const current: ThinkingLevel =
    (isThinkingLevel(resolved) && options.includes(resolved) ? resolved : undefined) ??
    (options.includes('medium') ? 'medium' : options[0] ?? 'medium')

  // A model with a single level is not worth a dropdown.
  return { options, current, modelId, taskId: resolvedTaskId, hasChoice: options.length > 1 }
}

/**
 * Reasoning-effort picker for the active thread.
 *
 * Narrowed to three steps (see {@link OFFERED_LEVELS}) — the harness's full
 * seven remain reachable through `/thinking`.
 */
export const EffortPicker = memo(function EffortPicker() {
  const t = useT()
  const { options: allOptions, current: reportedCurrent, modelId, taskId: resolvedTaskId } = useEffortOptions()
  const options = allOptions.filter((level) => OFFERED_LEVELS.includes(level))
  const current = clampToVisible(reportedCurrent, options)
  // A model that accepts only one of the three is not worth a picker.
  const hasChoice = options.length > 1
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

  const handleSelect = useCallback((level: ThinkingLevel) => {
    setIsOpen(false)
    if (modelId) {
      const { settings, saveSettings } = useSettingsStore.getState()
      if (settings.modelEfforts?.[modelId] !== level) {
        saveSettings({ ...settings, modelEfforts: { ...settings.modelEfforts, [modelId]: level } }).catch(() => {})
      }
    }
    if (!resolvedTaskId) return
    // Optimistic: the agent echoes thinking_level_changed, but a live session is
    // not guaranteed (a thread can be idle), and the label should move now.
    useTaskStore.getState().setThinkingLevel(resolvedTaskId, level)
    ipc.setThinkingLevel(resolvedTaskId, level).catch(() => {})
  }, [modelId, resolvedTaskId])

  if (!hasChoice) return null

  const meta = LEVEL_META[current]

  return (
    <div ref={ref} data-testid="effort-picker" className="relative min-w-0">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={`${t('Reasoning effort')}: ${t(meta.label)}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          'flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] font-medium transition-colors',
          isElevatedLevel(current)
            ? 'text-primary hover:text-primary/80'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <IconBrain className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden truncate @[480px]/toolbar:inline">{t(meta.label)}</span>
        <IconChevronDown className="hidden size-3 shrink-0 opacity-50 @[480px]/toolbar:block" aria-hidden />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={t('Select reasoning effort')}
          className="absolute bottom-full left-0 z-[200] mb-2 w-52 rounded-lg border border-border bg-popover py-1 shadow-xl"
        >
          {options.map((level) => {
            const isActive = level === current
            const info = LEVEL_META[level]
            return (
              <button
                key={level}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  handleSelect(level)
                }}
                className={cn(
                  'flex w-full items-start gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
                  isActive && isElevatedLevel(level) && 'text-primary',
                )}
              >
                <span className="min-w-0">
                  <span className="block">{t(info.label)}</span>
                  <span className="block text-[10.5px] font-normal text-muted-foreground">{t(info.desc)}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
})
