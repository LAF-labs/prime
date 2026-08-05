import { useState, useCallback, useEffect } from 'react'
import {
  IconCircleCheck, IconLoader2, IconLogin, IconRefresh,
  IconUser, IconBrandGoogle, IconBrandGithub, IconBuilding,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { type AuthState, accountTypeLabel, LoginMethod, CopyButton } from '@/components/onboarding-shared'

interface OnboardingAuthSectionProps {
  bin: string
  isCliReady: boolean
  onAuthChange: (isAuthenticated: boolean) => void
}

export const OnboardingAuthSection = ({ bin, isCliReady, onAuthChange }: OnboardingAuthSectionProps) => {
  const [authState, setAuthState] = useState<AuthState>('not-authenticated')
  const [authEmail, setAuthEmail] = useState('')
  const [authAccountType, setAuthAccountType] = useState('')
  const [authRegion, setAuthRegion] = useState('')
  const [loginError, setLoginError] = useState('')

  const isNonStandardPath = bin !== 'kiro-cli' && bin.includes('/')

  const checkAuth = useCallback(async () => {
    setAuthState('checking')
    try {
      const identity = await ipc.kiroWhoami(bin)
      if (identity.accountType) {
        setAuthEmail(identity.email ?? '')
        setAuthAccountType(identity.accountType)
        setAuthRegion(identity.region ?? '')
        setAuthState('authenticated')
        onAuthChange(true)
      } else {
        setAuthState('not-authenticated')
        onAuthChange(false)
      }
    } catch {
      setAuthState('not-authenticated')
      onAuthChange(false)
    }
  }, [bin, onAuthChange])

  useEffect(() => { if (isCliReady) checkAuth() }, [isCliReady, checkAuth])

  const handleLogin = useCallback(() => {
    setLoginError('')
    ipc.openTerminalWithCommand(`${bin} login`).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      setLoginError(message)
    })
  }, [bin])

  return (
    <div className={cn('w-full rounded-xl border overflow-hidden transition-colors', !isCliReady ? 'border-border bg-card opacity-50 pointer-events-none' : 'border-border bg-card')}>
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className={cn('flex size-7 items-center justify-center rounded-full transition-colors', authState === 'authenticated' ? 'bg-emerald-500/10' : 'bg-muted/40')}>
          {authState === 'checking' ? (
            <IconLoader2 size={14} className="animate-spin text-muted-foreground" />
          ) : authState === 'authenticated' ? (
            <IconCircleCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
          ) : (
            <IconUser size={14} className="text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 text-left">
          <p className="text-[13px] font-medium text-foreground/90">Authentication</p>
          <p className="text-[11px] text-muted-foreground">
            {authState === 'checking' && 'Checking...'}
            {authState === 'authenticated' && (authEmail || 'Signed in')}
            {authState === 'not-authenticated' && 'Sign in to access AI models'}
          </p>
        </div>
        {authState === 'authenticated' && authAccountType && (
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            {accountTypeLabel(authAccountType)}
          </span>
        )}
      </div>
      {authState === 'not-authenticated' && isCliReady && (
        <div className="flex flex-col gap-3 px-5 py-4">
          <button type="button" onClick={handleLogin}
            className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            <IconLogin size={16} /> Sign in with Kiro CLI
          </button>
          {loginError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2">
              <IconAlertTriangle size={14} className="mt-0.5 shrink-0 text-destructive" />
              <p className="text-[11px] text-destructive leading-relaxed">{loginError}</p>
            </div>
          )}
          <div className="flex items-center justify-center gap-4 py-0.5">
            <LoginMethod Icon={IconBuilding} label="Builder ID" />
            <LoginMethod Icon={IconBuilding} label="Identity Center" />
            <LoginMethod Icon={IconBrandGoogle} label="Google" />
            <LoginMethod Icon={IconBrandGithub} label="GitHub" />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Opens a terminal to run <code className="rounded bg-muted/50 px-1 py-0.5 font-mono text-[10px]">kiro-cli login</code>. Come back and click below when done.
          </p>
          {isNonStandardPath && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground/80">kiro-cli isn't on your PATH.</span>{' '}
                If the terminal can't find it, run the full path instead:
              </p>
              <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5">
                <code className="flex-1 truncate font-mono text-[11px] text-muted-foreground">{bin} login</code>
                <CopyButton text={`${bin} login`} />
              </div>
            </div>
          )}
          <button type="button" onClick={checkAuth}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-[12px] text-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground/80">
            <IconRefresh size={14} /> I've signed in — check again
          </button>
        </div>
      )}
      {authState === 'authenticated' && authRegion && (
        <div className="px-5 py-2.5 text-left">
          <span className="text-[11px] text-muted-foreground">Region: {authRegion}</span>
        </div>
      )}
    </div>
  )
}
