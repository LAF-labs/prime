import { useState, useCallback, useEffect } from 'react'
import { IconCircleCheck, IconLoader2, IconUser } from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { ProviderKeyManager } from '@/components/ProviderKeyManager'
import type { AuthState } from '@/components/onboarding-shared'

interface OnboardingAuthSectionProps {
  bin: string
  isCliReady: boolean
  onAuthChange: (isAuthenticated: boolean) => void
}

export const OnboardingAuthSection = ({ bin, isCliReady, onAuthChange }: OnboardingAuthSectionProps) => {
  const t = useT()
  const [authState, setAuthState] = useState<AuthState>('not-authenticated')
  const [authAccountType, setAuthAccountType] = useState('')

  const checkAuth = useCallback(async () => {
    setAuthState('checking')
    try {
      const identity = await ipc.authStatus(bin)
      if (identity.accountType) {
        setAuthAccountType(identity.accountType)
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
          <p className="text-[13px] font-medium text-foreground/90">{t('AI provider')}</p>
          <p className="text-[11px] text-muted-foreground">
            {authState === 'checking' && t('Checking...')}
            {authState === 'authenticated' && t('Connected')}
            {authState === 'not-authenticated' && t('Pick a provider and add its API key')}
          </p>
        </div>
        {authState === 'authenticated' && authAccountType && (
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            {authAccountType}
          </span>
        )}
      </div>
      {authState !== 'checking' && isCliReady && (
        <div className="flex flex-col gap-3 px-5 py-4">
          <ProviderKeyManager onChange={checkAuth} showConfigured={false} />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t('Keys are stored locally in ~/.lafagent/auth.json; custom endpoints in models.json. Nothing is sent anywhere except the provider you choose.')}
          </p>
        </div>
      )}
    </div>
  )
}
