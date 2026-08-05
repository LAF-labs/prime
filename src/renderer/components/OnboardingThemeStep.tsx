import { IconPaint, IconArrowRight } from '@tabler/icons-react'
import ThemeSelector from '@/components/settings/ThemeSelector'
import type { ThemeMode } from '@/types'
import type { Step } from '@/components/onboarding-shared'

interface OnboardingThemeStepProps {
  themeChoice: ThemeMode
  onThemeChange: (mode: ThemeMode) => void
  onNext: (step: Step) => void
}

export const OnboardingThemeStep = ({ themeChoice, onThemeChange, onNext }: OnboardingThemeStepProps) => (
  <div className="flex w-full max-w-md flex-col items-center gap-8">
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
      <IconPaint size={32} stroke={1.5} className="text-primary" />
    </div>
    <div>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">Choose your theme</h2>
      <p className="mt-2 text-[14px] text-muted-foreground">
        Pick a look that suits you. You can change this later in Settings.
      </p>
    </div>
    <div className="w-full">
      <ThemeSelector value={themeChoice} onChange={onThemeChange} />
    </div>
    <button
      type="button"
      onClick={() => onNext('setup')}
      className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 py-3 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      Continue <IconArrowRight size={18} />
    </button>
  </div>
)
