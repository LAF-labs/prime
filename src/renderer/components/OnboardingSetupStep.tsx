import { t } from '@/lib/i18n'
import { useState, useCallback, useEffect } from 'react'
import { IconArrowRight, IconCircleCheck } from '@tabler/icons-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { ipc } from '@/lib/ipc'
import type { ThemeMode } from '@/types'
import { OnboardingCliSection } from '@/components/OnboardingCliSection'
import { OnboardingAuthSection } from '@/components/OnboardingAuthSection'
import { OnboardingKernelSection } from '@/components/OnboardingKernelSection'
import { useT } from '@/lib/i18n'

interface OnboardingSetupStepProps {
  themeChoice: ThemeMode
  isAnalyticsEnabled: boolean
  onAnalyticsChange: (v: boolean) => void
}

export const OnboardingSetupStep = ({ themeChoice, isAnalyticsEnabled }: OnboardingSetupStepProps) => {
  const t = useT()
  const [bin, setBin] = useState('prime-agent')
  const [isCliReady, setIsCliReady] = useState(false)
  const [isBundled, setIsBundled] = useState<boolean | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [, setIsKernelReady] = useState(false)

  const handleCliReady = useCallback((resolvedBin: string) => {
    setBin(resolvedBin)
    setIsCliReady(true)
  }, [])

  // The app ships prime-agent inside the bundle: when detection resolves to
  // the default name we can skip the whole CLI card and show a one-line
  // confirmation instead of an install flow.
  useEffect(() => {
    let cancelled = false
    ipc.detectAgentCli()
      .then((path) => {
        if (cancelled) return
        if (path === 'prime-agent') {
          setIsBundled(true)
          setBin('prime-agent')
          setIsCliReady(true)
        } else {
          setIsBundled(false)
        }
      })
      .catch(() => { if (!cancelled) setIsBundled(false) })
    return () => { cancelled = true }
  }, [])

  const finish = useCallback(async () => {
    const settings = useSettingsStore.getState().settings
    await useSettingsStore.getState().saveSettings({ ...settings, agentBin: bin, hasOnboardedV2: true, theme: themeChoice, analyticsEnabled: isAnalyticsEnabled })
    useSettingsStore.getState().checkAuth()
    ipc.probeCapabilities().catch(() => {})
  }, [bin, themeChoice, isAnalyticsEnabled])

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{t('Set up LAF Agent')}</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">{t('Add an AI provider key and you’re ready to go.')}</p>
      </div>

      {isBundled ? (
        <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-5 py-3">
          <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500/10">
            <IconCircleCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-[13px] font-medium text-foreground/90">{t('Agent runtime')}</p>
            <p className="text-[11px] text-muted-foreground">{t('Prime Agent is bundled with the app — nothing to install.')}</p>
          </div>
        </div>
      ) : isBundled === false ? (
        <OnboardingCliSection onCliReady={handleCliReady} />
      ) : null}

      <OnboardingAuthSection bin={bin} isCliReady={isCliReady} onAuthChange={setIsAuthenticated} />

      <OnboardingKernelSection onReady={setIsKernelReady} />

      {/* Actions */}
      <div className="flex flex-col items-center gap-2 pt-2">
        {isAuthenticated && isCliReady ? (
          <button type="button" onClick={finish}
            className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 py-3 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            {t('Launch LAF Agent')} <IconArrowRight size={18} />
          </button>
        ) : isCliReady ? (
          <button type="button" onClick={finish}
            className="text-[13px] text-muted-foreground transition-colors hover:text-foreground/70">
            {t('Skip sign-in for now')}
          </button>
        ) : null}
      </div>
    </div>
  )
}