import { t } from '@/lib/i18n'
import { useState } from 'react'
import { IconDownload, IconRefresh, IconLoader2 } from '@tabler/icons-react'
import { useUpdateStore } from '@/stores/updateStore'
import { useTaskStore } from '@/stores/taskStore'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { SettingRow, SETTINGS_BUTTON_CLASS } from './settings-shared'

/** Filled variant of the shared control shape, for the one primary action. */
const PRIMARY_BUTTON_CLASS =
  'inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50'

export const UpdatesCard = () => {
  // `error` is deliberately not selected. The updater's own message is what
  // this row used to show, and it is written for whoever can fix it, not for
  // whoever is reading it; the log keeps it.
  const { status, updateInfo, progress, triggerDownload, triggerRestart } = useUpdateStore(
    useShallow((s) => ({
      status: s.status,
      updateInfo: s.updateInfo,
      progress: s.progress,
      triggerDownload: s.triggerDownload,
      triggerRestart: s.triggerRestart,
    })),
  )
  const [isChecking, setIsChecking] = useState(false)

  const handleCheck = async () => {
    setIsChecking(true)
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      useUpdateStore.getState().setStatus('checking')
      const update = await check()
      if (update) {
        useUpdateStore.getState().setUpdateInfo({
          version: update.version,
          date: update.date ?? undefined,
          body: update.body ?? undefined,
        })
        useUpdateStore.getState().setStatus('available')
      } else {
        useUpdateStore.getState().setStatus('idle')
        useUpdateStore.getState().setUpdateInfo(null)
      }
    } catch (err) {
      useUpdateStore.getState().setError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setIsChecking(false)
    }
  }

  const handleDownload = () => {
    if (!triggerDownload) return
    // Close settings so the UpdateAvailableDialog can show above everything
    useTaskStore.getState().setSettingsOpen(false)
    triggerDownload()
  }

  const handleRestart = async () => {
    if (!triggerRestart) return
    try {
      await triggerRestart()
    } catch (err) {
      console.error('[updater] restart failed:', err)
      useUpdateStore.getState().setError(err instanceof Error ? err.message : t('Restart failed'))
    }
  }

  const isCheckingState = isChecking || status === 'checking'
  const pct = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : null

  const statusText = (() => {
    if (status === 'checking') return t('Checking for updates...')
    if (status === 'available' && updateInfo) return t('v{version} available', { version: updateInfo.version })
    if (status === 'downloading') return pct !== null ? t('Downloading... {pct}%', { pct }) : t('Downloading...')
    if (status === 'ready') return t('Update installed — restart to finish')
    // `error` is whatever the updater plugin threw, and what it throws most is
    // `update endpoint did not respond with a successful status code` — which
    // is what a user sees today, on every launch, because the only release is
    // still a draft and GitHub does not serve `releases/latest` from drafts.
    // It reads as something broken on their machine that they should fix. The
    // raw text stays in the log, where whoever can act on it is looking.
    if (status === 'error') return t('Could not check for updates right now')
    return t('LAF Agent is up to date')
  })()

  return (
    <SettingRow label={t('Software updates')} description={statusText}>
      <div className="flex items-center gap-2">
        {status === 'available' && (
          <button
            type="button"
            onClick={handleDownload}
            disabled={!triggerDownload}
            className={PRIMARY_BUTTON_CLASS}
          >
            <IconDownload className="size-3.5" />
            {t('Update now')}
          </button>
        )}
        {status === 'ready' && (
          <button
            type="button"
            onClick={handleRestart}
            disabled={!triggerRestart}
            className={PRIMARY_BUTTON_CLASS}
          >
            <IconRefresh className="size-3.5" />
            {t('Restart')}
          </button>
        )}
        {(status === 'idle' || status === 'error') && (
          <button
            type="button"
            onClick={handleCheck}
            disabled={isCheckingState}
            className={cn(SETTINGS_BUTTON_CLASS, 'disabled:pointer-events-none disabled:opacity-50')}
          >
            {isCheckingState ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconRefresh className="size-3.5" />}
            {t('Check')}
          </button>
        )}
        {status === 'downloading' && <IconLoader2 className="size-4 animate-spin text-primary" />}
      </div>
    </SettingRow>
  )
}
