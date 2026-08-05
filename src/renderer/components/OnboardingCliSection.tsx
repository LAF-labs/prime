import { useState, useCallback, useEffect } from 'react'
import {
  IconCircleCheck, IconExternalLink, IconFolderOpen,
  IconLoader2, IconRefresh, IconBrandApple, IconTerminal,
  IconChevronDown, IconChevronUp,
} from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { handleExternalLinkClick, handleExternalLinkKeyDown } from '@/lib/open-external'
import {
  type DetectState, type Platform,
  INSTALL_COMMANDS, PLATFORM_LABELS, detectPlatform, CommandRow,
} from '@/components/onboarding-shared'

interface OnboardingCliSectionProps {
  onCliReady: (bin: string) => void
}

export const OnboardingCliSection = ({ onCliReady }: OnboardingCliSectionProps) => {
  const [detectState, setDetectState] = useState<DetectState>('detecting')
  const [cliPath, setCliPath] = useState('')
  const [manualPath, setManualPath] = useState('')
  const [showAlternatives, setShowAlternatives] = useState(false)
  const [platform] = useState<Platform>(detectPlatform)
  const isCliReady = detectState === 'found' || manualPath.length > 0
  const installCommands = INSTALL_COMMANDS[platform]

  const detect = useCallback(async () => {
    setDetectState('detecting')
    try {
      const path = await ipc.detectKiroCli()
      if (path) { setCliPath(path); setDetectState('found') }
      else { setDetectState('not-found') }
    } catch { setDetectState('not-found') }
  }, [])

  useEffect(() => { detect() }, [detect])

  useEffect(() => {
    if (isCliReady) onCliReady(cliPath || manualPath || 'kiro-cli')
  }, [isCliReady, cliPath, manualPath, onCliReady])

  const handleBrowse = useCallback(async () => {
    const picked = await ipc.pickFolder()
    if (picked) setManualPath(picked)
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
          <p className="text-[13px] font-medium text-foreground/90">Kiro CLI</p>
          <p className="text-[11px] text-muted-foreground">
            {detectState === 'detecting' && 'Searching for kiro-cli...'}
            {detectState === 'found' && cliPath}
            {detectState === 'not-found' && !manualPath && 'Not found — install or set path below'}
            {detectState === 'not-found' && manualPath && manualPath}
          </p>
        </div>
        {detectState !== 'detecting' && (
          <button type="button" onClick={detect} aria-label="Retry CLI detection" tabIndex={0}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground/70">
            <IconRefresh size={14} />
          </button>
        )}
      </div>
      {detectState === 'not-found' && !manualPath && (
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            {platform === 'macos' ? <IconBrandApple size={14} className="text-muted-foreground" /> : <IconTerminal size={14} className="text-muted-foreground" />}
            <span className="text-[11px] font-medium text-muted-foreground">Install for {PLATFORM_LABELS[platform]}</span>
          </div>
          <CommandRow cmd={installCommands.primary} />
          {installCommands.alternatives.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowAlternatives((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-muted-foreground">
                {showAlternatives ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
                Other install methods
              </button>
              {showAlternatives && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {installCommands.alternatives.map((cmd) => <CommandRow key={cmd.label} cmd={cmd} />)}
                </div>
              )}
            </div>
          )}
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center"><span className="bg-card px-2 text-[10px] text-muted-foreground">or set path manually</span></div>
          </div>
          <div className="flex gap-1.5">
            <input type="text" value={manualPath} onChange={(e) => setManualPath(e.target.value)} placeholder="/path/to/kiro-cli"
              className="flex-1 rounded-lg border border-border bg-background/50 px-3 py-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/40" />
            <button type="button" onClick={handleBrowse} aria-label="Browse for kiro-cli" tabIndex={0}
              className="rounded-lg border border-border px-2.5 py-2 text-muted-foreground transition-colors hover:text-foreground/70">
              <IconFolderOpen size={16} />
            </button>
          </div>
          <a href="https://kiro.dev/docs/cli/installation/" onClick={handleExternalLinkClick} onKeyDown={handleExternalLinkKeyDown}
            className="flex items-center justify-center gap-1.5 text-[12px] text-primary transition-colors hover:text-primary">
            Full installation guide <IconExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  )
}
