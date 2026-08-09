import { memo, useCallback } from 'react'
import { IconBrain } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { THINKING_LEVELS, type ThinkingLevel } from '@/types'

/**
 * Off is `medium`, NOT `off`. `off` disables reasoning outright and visibly
 * degrades answers — the everyday default has to stay at the harness's middle
 * gear, so the switch trades "normal" for "deeper", never "none" for "some".
 */
const OFF_LEVEL: ThinkingLevel = 'medium'
const ON_LEVEL: ThinkingLevel = 'high'

const rank = (level: ThinkingLevel): number => THINKING_LEVELS.indexOf(level)

/**
 * Read a stored level as a switch position. Anything above `medium` reads as
 * on, so an `xhigh` picked in developer mode shows up honestly here instead of
 * being silently rewritten — the stored value is only ever replaced when the
 * user actually flips the switch.
 */
export const isThinkLongerOn = (level: ThinkingLevel): boolean => rank(level) > rank(OFF_LEVEL)

/**
 * The level to write for a switch position, narrowed to what the model
 * accepts. A model that offers neither `medium` nor `high` still gets its
 * nearest neighbour rather than a level the agent would reject.
 */
export const resolveToggleLevel = (options: readonly ThinkingLevel[], isOn: boolean): ThinkingLevel => {
  const target = isOn ? ON_LEVEL : OFF_LEVEL
  if (options.length === 0 || options.includes(target)) return target
  const ranked = [...options].sort((a, b) => rank(a) - rank(b))
  if (isOn) return ranked.find((level) => rank(level) > rank(OFF_LEVEL)) ?? ranked[ranked.length - 1]
  return [...ranked].reverse().find((level) => rank(level) <= rank(OFF_LEVEL)) ?? ranked[0]
}

interface ThinkLongerToggleProps {
  /** The level currently in effect, already narrowed to `options`. */
  level: ThinkingLevel
  /** Levels this model accepts, from the agent's `availableThinkingLevels`. */
  options: readonly ThinkingLevel[]
  /** Same handler the developer-mode picker uses, so persistence is identical. */
  onChange: (level: ThinkingLevel) => void
}

/**
 * Simple mode's stand-in for the seven-level reasoning picker: one switch.
 * Seven named effort levels are developer detail — everyday users get the one
 * decision that actually changes the answer, "think about this harder".
 */
export const ThinkLongerToggle = memo(function ThinkLongerToggle({
  level,
  options,
  onChange,
}: ThinkLongerToggleProps) {
  const t = useT()
  const isOn = isThinkLongerOn(level)

  const handleToggle = useCallback(() => {
    onChange(resolveToggleLevel(options, !isOn))
  }, [isOn, onChange, options])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-label={t('Think longer')}
          data-testid="think-longer-toggle"
          onClick={handleToggle}
          className={cn(
            'flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
            isOn
              ? 'text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <IconBrain className="size-3.5 shrink-0" aria-hidden />
          <span className="hidden truncate @[480px]/toolbar:inline">{t('Think longer')}</span>
          <span
            className={cn(
              'relative h-3 w-[22px] shrink-0 rounded-full transition-colors',
              isOn ? 'bg-violet-500' : 'bg-input',
            )}
            aria-hidden
          >
            <span
              className={cn(
                'absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-background shadow-sm transition-all',
                isOn ? 'left-3' : 'left-0.5',
              )}
            />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">
        {t('Spend more time reasoning before answering')}
      </TooltipContent>
    </Tooltip>
  )
})
