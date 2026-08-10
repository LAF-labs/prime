import { t } from '@/lib/i18n'
import { useState, useEffect, useCallback } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import {
  IconBrandGithub, IconDownload, IconRefresh, IconLoader2, IconCheck,
} from '@tabler/icons-react'
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { useUpdateStore } from '@/stores/updateStore'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { handleExternalLinkClick, handleExternalLinkKeyDown } from '@/lib/open-external'
import { useSettingsStore } from '@/stores/settingsStore'
import { ipc } from '@/lib/ipc'
import defaultAppIcon from '../../../../src-tauri/icons/prod/icon.png'

interface HarnessInfo {
  ref: string
  commit: string
  repo: string
  builtAt: string
}

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const AboutDialog = ({ open, onOpenChange }: AboutDialogProps) => {
  const [appVersion, setAppVersion] = useState('')
  const [harness, setHarness] = useState<HarnessInfo | null>(null)
  const { status, updateInfo, progress, error, triggerDownload, triggerRestart } = useUpdateStore(
    useShallow((s) => ({
      status: s.status,
      updateInfo: s.updateInfo,
      progress: s.progress,
      error: s.error,
      triggerDownload: s.triggerDownload,
      triggerRestart: s.triggerRestart,
    })),
  )
  const customAppIcon = useSettingsStore((s) => s.settings.customAppIcon)
  const displayIcon = customAppIcon || defaultAppIcon

  useEffect(() => {
    if (!open) return
    getVersion().then(setAppVersion).catch(() => {})
    ipc.harnessInfo().then(setHarness).catch(() => {})
  }, [open])

  const handleCheck = useCallback(async () => {
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
    }
  }, [])

  const handleDownload = useCallback(() => {
    onOpenChange(false)
    triggerDownload?.()
  }, [triggerDownload, onOpenChange])

  const handleRestart = useCallback(async () => {
    if (!triggerRestart) return
    try {
      await triggerRestart()
    } catch (err) {
      console.error('[updater] restart failed:', err)
      useUpdateStore.getState().setError(err instanceof Error ? err.message : 'Restart failed')
    }
  }, [triggerRestart])

  const isChecking = status === 'checking'
  const isAvailable = status === 'available'
  const isDownloading = status === 'downloading'
  const isReady = status === 'ready'
  const isError = status === 'error'
  const pct = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs gap-0 p-0" showCloseButton={false}>
        <div className="flex flex-col items-center px-6 pt-8 pb-6">
          <img
            src={displayIcon}
            alt="LAF Agent"
            className="size-20 rounded-2xl shadow-lg"
            draggable={false}
          />
          <DialogTitle className="mt-4 text-center text-lg font-semibold">
            LAF Agent
          </DialogTitle>
          <DialogDescription className="mt-1 text-center text-[13px] text-muted-foreground">
            {appVersion ? t('Version {version}', { version: appVersion }) : t('Loading…')}
          </DialogDescription>
          {/* The MIT attribution the bundled runtime requires lives in the
              third-party notices below, which is the right place for it. A
              "Powered by" line is a different claim — a brand endorsement —
              and it stopped being accurate once the everyday profile replaced
              the runtime's tools, prompt, and skills. */}
          {harness && (
            <p className="mt-0.5 text-center text-[11px] text-muted-foreground/60">
              {t('Harness {version} ({commit})', { version: harness.ref, commit: harness.commit.slice(0, 7) })}
            </p>
          )}
          <a
            href="https://github.com/LAF-labs/prime/blob/main/THIRD-PARTY-NOTICES.md"
            onClick={handleExternalLinkClick}
            onKeyDown={handleExternalLinkKeyDown}
            tabIndex={0}
            className="mt-1 text-center text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground hover:underline"
          >
            {t('Third-party notices')}
          </a>

          {/* Update status */}
          <div className="mt-4 flex flex-col items-center gap-2">
            {isChecking && (
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <IconLoader2 className="size-3.5 animate-spin" />
                {t('Checking for updates...')}
              </span>
            )}
            {isAvailable && updateInfo && (
              <button
                type="button"
                onClick={handleDownload}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <IconDownload className="size-3.5" />
                {t('Update to v{version}', { version: updateInfo.version })}
              </button>
            )}
            {isDownloading && (
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <IconLoader2 className="size-3.5 animate-spin" />
                {pct !== null ? t('Downloading… {pct}%', { pct }) : t('Downloading…')}
              </span>
            )}
            {isReady && (
              <button
                type="button"
                onClick={handleRestart}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <IconRefresh className="size-3.5" />
                {t('Restart to finish')}
              </button>
            )}
            {isError && (
              <span className="text-[12px] text-destructive">{error ?? t('Update check failed')}</span>
            )}
            {status === 'idle' && (
              <button
                type="button"
                onClick={handleCheck}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <IconCheck className="size-3.5" />
                {t('Check for updates')}
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/40 px-6 py-3">
          <span className="text-[11px] text-muted-foreground">
            © 2026 LAF
          </span>
          <a
            href="https://laf-co.com/"
            onClick={handleExternalLinkClick}
            onKeyDown={handleExternalLinkKeyDown}
            aria-label={t('LAF Agent on GitHub')}
            tabIndex={0}
            className={cn(
              'inline-flex size-6 items-center justify-center rounded-md',
              'text-muted-foreground transition-colors hover:text-foreground',
            )}
          >
            <IconBrandGithub className="size-4" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
