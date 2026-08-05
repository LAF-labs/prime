import { useState, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '@/types'
import { applyTheme, persistTheme } from '@/lib/theme'
import type { Step } from '@/components/onboarding-shared'
import { OnboardingWelcomeStep } from '@/components/OnboardingWelcomeStep'
import { OnboardingThemeStep } from '@/components/OnboardingThemeStep'
import { OnboardingSetupStep } from '@/components/OnboardingSetupStep'

const STEPS: Step[] = ['welcome', 'theme', 'setup']

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome')
  const [themeChoice, setThemeChoice] = useState<ThemeMode>(
    useSettingsStore.getState().settings.theme ?? 'dark',
  )
  const [isAnalyticsEnabled, setIsAnalyticsEnabled] = useState(true)

  const handleThemeChange = useCallback((mode: ThemeMode) => {
    setThemeChoice(mode)
    applyTheme(mode)
    persistTheme(mode)
  }, [])

  const currentIdx = STEPS.indexOf(step)

  return (
    <div data-testid="onboarding-section" className="fixed inset-0 z-[999] flex items-center justify-center overflow-y-auto bg-background">
      <div className="fixed inset-x-0 top-0 h-10" data-tauri-drag-region />

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

      <div className="flex flex-col items-center gap-8 py-12 text-center max-w-lg w-full px-6">
        {step === 'welcome' && <OnboardingWelcomeStep onNext={setStep} />}
        {step === 'theme' && <OnboardingThemeStep themeChoice={themeChoice} onThemeChange={handleThemeChange} onNext={setStep} />}
        {step === 'setup' && <OnboardingSetupStep themeChoice={themeChoice} isAnalyticsEnabled={isAnalyticsEnabled} onAnalyticsChange={setIsAnalyticsEnabled} />}
      </div>
    </div>
  )
}
