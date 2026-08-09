import { useState, useCallback, useEffect } from 'react'
import { IconArrowRight, IconCircleCheck } from '@tabler/icons-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { ipc } from '@/lib/ipc'
import type { ThemeMode } from '@/types'
import type { UiMode } from '@/lib/ui-mode'
import { OnboardingCliSection } from '@/components/OnboardingCliSection'
import { OnboardingAuthSection } from '@/components/OnboardingAuthSection'
import { OnboardingKernelSection } from '@/components/OnboardingKernelSection'
import { useT } from '@/lib/i18n'
import { reportFailure } from '@/lib/ipc-report'
import { withTimeout } from '@/lib/with-timeout'

/** Detection reads the bundle and the PATH; anything slower than this is stuck. */
const DETECT_TIMEOUT_MS = 8000

interface OnboardingSetupStepProps {
  themeChoice: ThemeMode
  modeChoice: UiMode
}

export const OnboardingSetupStep = ({ themeChoice, modeChoice }: OnboardingSetupStepProps) => {
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
    // Bounded: a detection call that never settles would leave `isBundled`
    // null forever, and every card and button below is gated on it — the
    // step rendered a heading, a gap, and no way forward at all.
    withTimeout(ipc.detectAgentCli(), DETECT_TIMEOUT_MS)
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
      .catch((err) => {
        if (cancelled) return
        console.warn('[onboarding] agent detection failed:', err)
        setIsBundled(false)
      })
    return () => { cancelled = true }
  }, [])

  const finish = useCallback(async () => {
    const settings = useSettingsStore.getState().settings
    try {
      // uiMode is written explicitly at onboarding so the effective mode never
      // again depends on inference: absent uiMode + completed onboarding is
      // how resolveUiMode recognizes a pre-split install (→ developer), and
      // this write is what keeps fresh installs out of that bucket.
      await useSettingsStore.getState().saveSettings({ ...settings, agentBin: bin, hasOnboardedV2: true, theme: themeChoice, uiMode: modeChoice })
    } catch (err) {
      // A silently rejected write here left a dead "Launch" button on first
      // run — the wizard never advanced and never said why. Surface it and
      // leave the button live so the user can retry.
      reportFailure(t('Could not save settings'), err)
      return
    }
    useSettingsStore.getState().checkAuth()
    ipc.probeCapabilities().catch(() => {})
  }, [bin, themeChoice, modeChoice, t])

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
            <p className="text-[11px] text-muted-foreground">{t('The agent runtime is bundled with the app — nothing to install.')}</p>
          </div>
        </div>
      ) : isBundled === false ? (
        <OnboardingCliSection onCliReady={handleCliReady} />
      ) : (
        <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-5 py-3">
          <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/80" />
          <p className="text-[13px] text-muted-foreground">{t('Looking for the agent runtime…')}</p>
        </div>
      )}

      <OnboardingAuthSection bin={bin} isCliReady={isCliReady} onAuthChange={setIsAuthenticated} />

      {/* The Python kernel only exists for developer-mode sessions; everyday
          sessions run without ipython, so surfacing kernel provisioning to a
          non-developer would be setup for a feature they can never reach. */}
      {modeChoice === 'developer' && <OnboardingKernelSection onReady={setIsKernelReady} />}

      {/* Actions */}
      <div className="flex flex-col items-center gap-2 pt-2">
        {isAuthenticated && isCliReady ? (
          <button type="button" onClick={finish}
            className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 py-3 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            {t('Launch LAF Agent')} <IconArrowRight size={18} />
          </button>
        ) : isBundled !== null ? (
          // Available whether or not a CLI was found. Everything here can be
          // fixed later in Settings, and there must always be a way out of
          // this step — being unable to reach the app at all is worse than
          // reaching it unconfigured.
          <button type="button" onClick={finish}
            className="text-[13px] text-muted-foreground transition-colors hover:text-foreground/70">
            {isCliReady ? t('Skip sign-in for now') : t('Continue without setup')}
          </button>
        ) : null}
      </div>
    </div>
  )
}