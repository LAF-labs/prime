import { useState, useCallback } from 'react'
import { IconArrowLeft } from '@tabler/icons-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '@/types'
import { applyTheme, persistTheme } from '@/lib/theme'
import type { Step } from '@/components/onboarding-shared'
import { OnboardingWelcomeStep } from '@/components/OnboardingWelcomeStep'
import { OnboardingThemeStep } from '@/components/OnboardingThemeStep'
import { OnboardingSetupStep } from '@/components/OnboardingSetupStep'

const STEPS: Step[] = ['welcome', 'theme', 'setup']

export function Onboarding() {
  const t = useT()
  const [step, setStep] = useState<Step>('welcome')
  const [themeChoice, setThemeChoice] = useState<ThemeMode>(
    useSettingsStore.getState().settings.theme ?? 'dark',
  )
  const handleThemeChange = useCallback((mode: ThemeMode) => {
    setThemeChoice(mode)
    applyTheme(mode)
    persistTheme(mode)
  }, [])

  const currentIdx = STEPS.indexOf(step)

  const handleBack = useCallback(() => {
    setStep((prev) => {
      const idx = STEPS.indexOf(prev)
      return idx > 0 ? STEPS[idx - 1] : prev
    })
  }, [])

  return (
    <div data-testid="onboarding-section" className="fixed inset-0 z-[999] flex items-center justify-center overflow-y-auto bg-background">
      <div className="fixed inset-x-0 top-0 h-10" data-tauri-drag-region />

      {/* Back — the wizard used to be one-way; a mis-click on the theme was permanent */}
      {currentIdx > 0 && (
        <button
          type="button"
          onClick={handleBack}
          aria-label={t('Go back to the previous step')}
          className="fixed left-6 top-13 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconArrowLeft className="size-3.5" aria-hidden />
          {t('Back')}
        </button>
      )}

      {/* Step indicator */}
      <div className="fixed top-14 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {STEPS.map((s, i) => {
          const isPast = i < currentIdx
          const isCurrent = step === s
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className={cn('h-px w-8', isPast || isCurrent ? 'bg-primary/40' : 'bg-border')} />}
              <div className={cn(
                'flex size-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors',
                isCurrent
                  ? 'bg-primary text-primary-foreground'
                  : isPast
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted/50 text-muted-foreground',
              )}>
                {i + 1}
              </div>
            </div>
          )
        })}
      </div>

      <div
        key={step}
        className="onboarding-step flex min-h-[560px] w-full max-w-xl flex-col items-center justify-center gap-8 px-8 py-24 text-center"
      >
        {step === 'welcome' && <OnboardingWelcomeStep onNext={setStep} />}
        {step === 'theme' && <OnboardingThemeStep themeChoice={themeChoice} onThemeChange={handleThemeChange} onNext={setStep} />}
        {step === 'setup' && <OnboardingSetupStep themeChoice={themeChoice} />}
      </div>
    </div>
  )
}
