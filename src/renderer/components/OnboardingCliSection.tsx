import { t } from '@/lib/i18n'
import { useState, useCallback, useEffect } from 'react'
import {
  IconCircleCheck, IconExternalLink, IconFolderOpen,
  IconLoader2, IconRefresh, IconTerminal, IconAlertTriangle,
} from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { reportFailure } from '@/lib/ipc-report'
import { cn } from '@/lib/utils'
import { handleExternalLinkClick, handleExternalLinkKeyDown } from '@/lib/open-external'
import type { DetectState } from '@/components/onboarding-shared'

interface OnboardingCliSectionProps {
  onCliReady: (bin: string) => void
}

export const OnboardingCliSection = ({ onCliReady }: OnboardingCliSectionProps) => {
  const [detectState, setDetectState] = useState<DetectState>('detecting')
  const [cliPath, setCliPath] = useState('')
  const [manualPath, setManualPath] = useState('')
  const isCliReady = detectState === 'found' || manualPath.length > 0

  const detect = useCallback(async () => {
    setDetectState('detecting')
    try {
      const path = await ipc.detectAgentCli()
      if (path) { setCliPath(path); setDetectState('found') }
      else { setDetectState('not-found') }
    } catch { setDetectState('not-found') }
  }, [])

  useEffect(() => { detect() }, [detect])

  useEffect(() => {
    if (isCliReady) onCliReady(cliPath || manualPath || 'prime-agent')
  }, [isCliReady, cliPath, manualPath, onCliReady])

  // The target is the prime-agent executable — a FILE. The folder picker
  // could never select it, so Browse was a dead end on the recovery path.
  const handleBrowse = useCallback(async () => {
    try {
      const picked = await ipc.pickFile()
      if (picked) setManualPath(picked)
    } catch (err) {
      reportFailure(t('Could not open the file picker'), err)
    }
  }, [])

  return (
    <div className="w-full rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className={cn('flex size-7 items-center justify-center rounded-full transition-colors', isCliReady ? 'bg-emerald-500/10' : 'bg-muted/40')}>
          {detectState === 'detecting' ? (
            <IconLoader2 size={14} className="animate-spin text-muted-foreground" />
          ) : isCliReady ? (
            <IconCircleCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
          ) : (
            <IconTerminal size={14} className="text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 text-left">
          <p className="text-[13px] font-medium text-foreground/90">{t('Agent runtime')}</p>
          <p className="text-[11px] text-muted-foreground">
            {detectState === 'detecting' && t('Looking for the agent runtime…')}
            {/* The bundled sidecar reports as the bare name; anything else is a
                path the user pointed us at. */}
            {detectState === 'found' && (cliPath === 'prime-agent' ? t('Bundled with the app — nothing to install.') : cliPath)}
            {detectState === 'not-found' && !manualPath && t('Missing from this build.')}
            {detectState === 'not-found' && manualPath && manualPath}
          </p>
        </div>
        {detectState !== 'detecting' && (
          <button type="button" onClick={detect} aria-label={t('Retry CLI detection')} tabIndex={0}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground/70">
            <IconRefresh size={14} />
          </button>
        )}
      </div>
      {/* LAF Agent ships the runtime inside the bundle, so reaching this branch
          means the app itself is incomplete — a damaged download or a
          quarantined copy. Reinstalling is the fix; pointing at your own
          prime-agent build is the escape hatch. */}
      {detectState === 'not-found' && !manualPath && (
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-start gap-2.5 rounded-lg bg-muted/30 px-3 py-2.5">
            <IconAlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t('The agent runtime should ship inside this app. Reinstalling from the DMG usually fixes this. You can also point at your own prime-agent build below.')}
            </p>
          </div>
          <div className="flex gap-1.5">
            <input type="text" value={manualPath} onChange={(e) => setManualPath(e.target.value)} placeholder="/path/to/prime-agent"
              className="flex-1 rounded-lg border border-border bg-background/50 px-3 py-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50" />
            <button type="button" onClick={handleBrowse} aria-label={t('Browse for prime-agent')} tabIndex={0}
              className="rounded-lg border border-border px-2.5 py-2 text-muted-foreground transition-colors hover:text-foreground/70">
              <IconFolderOpen size={16} />
            </button>
          </div>
          <a href="https://github.com/PrimeIntellect-ai/prime-agent#readme" onClick={handleExternalLinkClick} onKeyDown={handleExternalLinkKeyDown}
            className="flex items-center justify-center gap-1.5 text-[12px] text-primary transition-colors hover:text-primary">
            {t('About the agent runtime')} <IconExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  )
}
