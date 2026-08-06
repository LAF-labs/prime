import { useState, useCallback, useEffect, useRef } from 'react'
import { IconCircleCheck, IconLoader2, IconCpu, IconAlertTriangle, IconDownload } from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

interface OnboardingKernelSectionProps {
  /** Reports readiness so the wizard can gate its finish button. */
  onReady: (ready: boolean) => void
}

/**
 * First-run setup of the agent's Python kernel.
 *
 * Every tool the agent has — editing files, running commands, searching —
 * executes inside a Python kernel that prime-agent provisions on demand
 * (~350 MB of CPython and packages, fetched with the bundled uv). Doing it
 * here, with progress, beats a silent stall on the user's first request.
 */
export const OnboardingKernelSection = ({ onReady }: OnboardingKernelSectionProps) => {
  const [state, setState] = useState<'checking' | 'ready' | 'needed' | 'installing' | 'error'>('checking')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    ipc.kernelStatus()
      .then((s) => {
        setState(s.ready ? 'ready' : 'needed')
        onReady(s.ready)
      })
      .catch(() => { setState('needed'); onReady(false) })
  }, [onReady])

  useEffect(() => () => { unsubRef.current?.() }, [])

  const handleInstall = useCallback(async () => {
    setState('installing')
    setError('')
    setProgress(t('Preparing the agent runtime…'))
    unsubRef.current = ipc.onKernelSetupProgress(({ line }) => setProgress(line))
    try {
      await ipc.kernelSetup()
      setState('ready')
      onReady(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
      onReady(false)
    } finally {
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [onReady])

  return (
    <div className="w-full rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3">
        <div className={cn(
          'flex size-7 items-center justify-center rounded-full transition-colors',
          state === 'ready' ? 'bg-emerald-500/10' : 'bg-muted/40',
        )}>
          {state === 'checking' || state === 'installing' ? (
            <IconLoader2 size={14} className="animate-spin text-muted-foreground" />
          ) : state === 'ready' ? (
            <IconCircleCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
          ) : state === 'error' ? (
            <IconAlertTriangle size={14} className="text-destructive" />
          ) : (
            <IconCpu size={14} className="text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-[13px] font-medium text-foreground/90">{t('Agent tools')}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {state === 'checking' && t('Checking…')}
            {state === 'ready' && t('Ready — the agent can edit files and run commands.')}
            {state === 'needed' && t('One-time setup downloads the tool runtime (about 350 MB).')}
            {state === 'installing' && (progress || t('Preparing the agent runtime…'))}
            {state === 'error' && t('Setup did not finish.')}
          </p>
        </div>
        {(state === 'needed' || state === 'error') && (
          <button
            type="button"
            onClick={handleInstall}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <IconDownload size={13} />
            {state === 'error' ? t('Try again') : t('Set up')}
          </button>
        )}
      </div>
      {error && (
        <div className="border-t border-border px-5 py-2.5">
          <p className="text-[11px] text-destructive leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  )
}
