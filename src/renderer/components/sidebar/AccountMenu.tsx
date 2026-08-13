import { t } from '@/lib/i18n'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  IconChartBar, IconSettings, IconLogout, IconLogin, IconUser, IconDownload, IconVectorTriangle,
} from '@tabler/icons-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import { useUpdateStore } from '@/stores/updateStore'
import { cn } from '@/lib/utils'

/**
 * The sidebar's account row: who is signed in, and the things you do to an
 * account rather than to a thread.
 *
 * The menu opens *upward and left-aligned to the row*, not at the cursor. It
 * sits at the bottom of a narrow sidebar, so a cursor-anchored popup opened
 * over the chat and its right edge fell outside the window on a narrow one.
 */
export const AccountMenu = memo(function AccountMenu({
  appVersion,
}: {
  appVersion: string | null
}) {
  const [open, setOpen] = useState(false)
  const rowRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const displayName = useSettingsStore((s) => s.settings.displayName)
  const agentAuth = useSettingsStore((s) => s.agentAuth)
  const logout = useSettingsStore((s) => s.logout)
  const openLogin = useSettingsStore((s) => s.openLogin)
  const setSettingsOpen = useTaskStore((s) => s.setSettingsOpen)
  const setView = useTaskStore((s) => s.setView)
  const isUpdateAvailable = useUpdateStore((s) => s.status) === 'available'
  const triggerDownload = useUpdateStore((s) => s.triggerDownload)

  // The account name is the user's own, once they have one. Falling back to
  // the provider identity keeps the row honest rather than inventing a name.
  const label = displayName?.trim() || agentAuth?.email || agentAuth?.accountType || t('Not signed in')
  const isSignedIn = !!displayName?.trim() || !!agentAuth

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || rowRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = useCallback(() => setOpen(false), [])

  const handleUsage = useCallback(() => { close(); setView('analytics') }, [close, setView])
  const handleKnowledge = useCallback(() => { close(); setView('knowledge') }, [close, setView])
  const handleSettings = useCallback(() => { close(); setSettingsOpen(true) }, [close, setSettingsOpen])
  const handleLogout = useCallback(() => { close(); void logout() }, [close, logout])
  const handleLogin = useCallback(() => { close(); openLogin() }, [close, openLogin])
  const handleUpdate = useCallback(() => { close(); triggerDownload?.() }, [close, triggerDownload])

  return (
    <div className="relative min-w-0 flex-1">
      <button
        ref={rowRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open ? 'bg-accent text-foreground' : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
        )}
      >
        <span className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase',
          isSignedIn ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}>
          {isSignedIn ? label.slice(0, 1) : <IconUser className="size-3" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{label}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute bottom-full left-0 z-[200] mb-1.5 w-[220px] overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-xl shadow-black/20"
        >
          {isSignedIn ? (
            <>
              <button type="button" role="menuitem" onClick={handleKnowledge} className={MENU_ITEM}>
                <IconVectorTriangle className="size-3.5" aria-hidden /> {t('Knowledge')}
              </button>
              <button type="button" role="menuitem" onClick={handleUsage} className={MENU_ITEM}>
                <IconChartBar className="size-3.5" aria-hidden /> {t('Usage')}
              </button>
              <button type="button" role="menuitem" onClick={handleSettings} className={MENU_ITEM}>
                <IconSettings className="size-3.5" aria-hidden /> {t('Settings')}
              </button>
              {isUpdateAvailable && (
                <button type="button" role="menuitem" onClick={handleUpdate} className={MENU_ITEM}>
                  <IconDownload className="size-3.5" aria-hidden /> {t('Install update')}
                </button>
              )}
              <div className="my-1 border-t border-border/50" />
              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-destructive transition-colors hover:bg-destructive/10"
              >
                <IconLogout className="size-3.5" aria-hidden /> {t('Log out')}
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={handleLogin} className={MENU_ITEM}>
                <IconLogin className="size-3.5" aria-hidden /> {t('Sign in')}
              </button>
              <button type="button" role="menuitem" onClick={handleSettings} className={MENU_ITEM}>
                <IconSettings className="size-3.5" aria-hidden /> {t('Settings')}
              </button>
            </>
          )}
          {appVersion && (
            <>
              <div className="my-1 border-t border-border/50" />
              <div className="px-3 py-1 text-[11px] tabular-nums text-muted-foreground/70">v{appVersion}</div>
            </>
          )}
        </div>
      )}
    </div>
  )
})

const MENU_ITEM =
  'flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent'
