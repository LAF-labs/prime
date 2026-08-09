import { t } from '@/lib/i18n'
import { IconPaint, IconArrowRight, IconSparkles, IconCode } from '@tabler/icons-react'
import ThemeSelector from '@/components/settings/ThemeSelector'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '@/types'
import type { UiMode } from '@/lib/ui-mode'
import type { Step } from '@/components/onboarding-shared'

interface OnboardingThemeStepProps {
  themeChoice: ThemeMode
  onThemeChange: (mode: ThemeMode) => void
  modeChoice: UiMode
  onModeChange: (mode: UiMode) => void
  onNext: (step: Step) => void
}

const MODE_CARDS = [
  {
    id: 'simple' as const,
    icon: IconSparkles,
    label: 'Everyday',
    desc: 'A clean chat that gets things done. No developer chrome.',
  },
  {
    id: 'developer' as const,
    icon: IconCode,
    label: 'Developer',
    desc: 'The full harness: git, worktrees, diffs, terminal.',
  },
] as const

export const OnboardingThemeStep = ({ themeChoice, onThemeChange, modeChoice, onModeChange, onNext }: OnboardingThemeStepProps) => (
  <div className="flex w-full flex-col items-center gap-8">
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
      <IconPaint size={32} stroke={1.5} className="text-primary" />
    </div>
    <div>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">{t('Choose your theme')}</h2>
      <p className="mt-2 text-[14px] text-muted-foreground">
        {t('Pick a look that suits you. You can change this later in Settings.')}
      </p>
    </div>
    <div className="w-full">
      <ThemeSelector value={themeChoice} onChange={onThemeChange} />
    </div>

    {/* Surface choice — the top-right toggle flips this any time later */}
    <div className="w-full text-left">
      <p className="mb-2 text-[13px] font-medium text-foreground/80">{t('How will you use it?')}</p>
      <div className="grid grid-cols-2 gap-3">
        {MODE_CARDS.map(({ id, icon: Icon, label, desc }) => (
          <button
            key={id}
            type="button"
            onClick={() => onModeChange(id)}
            aria-pressed={modeChoice === id}
            data-testid={`mode-card-${id}`}
            className={cn(
              'flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors',
              modeChoice === id
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-border/80 hover:bg-muted/30',
            )}
          >
            <Icon size={20} stroke={1.5} className={modeChoice === id ? 'text-primary' : 'text-muted-foreground'} />
            <span className="text-[14px] font-medium text-foreground">{t(label)}</span>
            <span className="text-[12px] leading-snug text-muted-foreground">{t(desc)}</span>
          </button>
        ))}
      </div>
    </div>
    <button
      type="button"
      onClick={() => onNext('setup')}
      className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 py-3 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {t('Continue')} <IconArrowRight size={18} />
    </button>
  </div>
)
