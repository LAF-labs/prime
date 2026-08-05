import { useState, useCallback } from 'react'
import { IconArrowRight, IconShieldCheck } from '@tabler/icons-react'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'
import { ipc } from '@/lib/ipc'
import type { ThemeMode } from '@/types'
import { OnboardingCliSection } from '@/components/OnboardingCliSection'
import { OnboardingAuthSection } from '@/components/OnboardingAuthSection'

interface OnboardingSetupStepProps {
  themeChoice: ThemeMode
  isAnalyticsEnabled: boolean
  onAnalyticsChange: (v: boolean) => void
}

export const OnboardingSetupStep = ({ themeChoice, isAnalyticsEnabled, onAnalyticsChange }: OnboardingSetupStepProps) => {
  const [bin, setBin] = useState('kiro-cli')
  const [isCliReady, setIsCliReady] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const handleCliReady = useCallback((resolvedBin: string) => {
    setBin(resolvedBin)
    setIsCliReady(true)
  }, [])

  const finish = useCallback(async () => {
    const settings = useSettingsStore.getState().settings
    await useSettingsStore.getState().saveSettings({ ...settings, kiroBin: bin, hasOnboardedV2: true, theme: themeChoice, analyticsEnabled: isAnalyticsEnabled })
    useSettingsStore.getState().checkAuth()
    ipc.probeCapabilities().catch(() => {})
  }, [bin, themeChoice, isAnalyticsEnabled])

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Set up Kirodex</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">Connect to kiro-cli and sign in to get started.</p>
      </div>

      <OnboardingCliSection onCliReady={handleCliReady} />
      <OnboardingAuthSection bin={bin} isCliReady={isCliReady} onAuthChange={setIsAuthenticated} />

      {/* Privacy */}
      <div className="w-full rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="flex size-7 items-center justify-center rounded-full bg-muted/40">
            <IconShieldCheck size={14} className="text-muted-foreground" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-[13px] font-medium text-foreground/90">Share anonymous usage data</p>
            <p className="text-[11px] text-muted-foreground">
              Feature usage and app version only. No prompts, code, file paths, branch names, or commit messages are ever sent.
            </p>
          </div>
          <Switch checked={isAnalyticsEnabled} onCheckedChange={onAnalyticsChange} aria-label="Toggle anonymous usage data" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col items-center gap-2 pt-2">
        {isAuthenticated && isCliReady ? (
          <button type="button" onClick={finish}
            className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 py-3 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Launch Kirodex <IconArrowRight size={18} />
          </button>
        ) : isCliReady ? (
          <button type="button" onClick={finish}
            className="text-[13px] text-muted-foreground transition-colors hover:text-foreground/70">
            Skip sign-in for now
          </button>
        ) : null}
      </div>
    </div>
  )
}
