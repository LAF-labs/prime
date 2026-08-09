import { t } from '@/lib/i18n'
import { useCallback, useEffect, useState } from 'react'
import { IconDownload, IconLoader2, IconRefresh, IconSparkles } from '@tabler/icons-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'

export const UpdateAvailableDialog = () => {
  const { status, updateInfo, progress, dismissedVersion, downloadAndInstall, restart, dismissVersion } = useUpdateChecker()
  const [isRestarting, setIsRestarting] = useState(false)
  // Closing the dialog mid-download hides it while the download keeps going —
  // the updateStore tracks progress and Settings → Updates shows the state.
  const [isBackgrounded, setIsBackgrounded] = useState(false)

  const isAvailable = status === 'available' && updateInfo !== null && dismissedVersion !== updateInfo.version
  const isDownloading = status === 'downloading'
  const isReady = status === 'ready'
  const isOpen = (isAvailable || isDownloading || isReady) && !(isDownloading && isBackgrounded)

  // Re-surface the dialog once the download finishes so the restart prompt
  // is not lost behind a backgrounded download.
  useEffect(() => {
    if (!isDownloading) setIsBackgrounded(false)
  }, [isDownloading])

  const downloadPercent = progress?.total
    ? Math.round((progress.downloaded / progress.total) * 100)
    : null

  const handleDismiss = useCallback(() => {
    if (isRestarting) return
    if (isDownloading) {
      setIsBackgrounded(true)
      return
    }
    if (updateInfo?.version) {
      dismissVersion(updateInfo.version)
    }
  }, [isDownloading, isRestarting, updateInfo?.version, dismissVersion])

  const handleUpdate = useCallback(() => {
    downloadAndInstall()
  }, [downloadAndInstall])

  const handleRestart = useCallback(async () => {
    if (isRestarting) return
    setIsRestarting(true)
    try {
      await restart()
    } catch {
      setIsRestarting(false)
    }
  }, [restart, isRestarting])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) handleDismiss()
  }, [handleDismiss])

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="z-[60] max-w-sm" overlayClassName="z-[60]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isReady
              ? <IconRefresh className="size-5 text-primary" aria-hidden />
              : <IconSparkles className="size-5 text-primary" aria-hidden />}
            {isReady ? t('Update ready') : t('LAF Agent v{version} available', { version: updateInfo?.version ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {isReady
              ? t('The update has been downloaded. Restart to apply.')
              : isDownloading
                ? downloadPercent !== null
                  ? t('Downloading update... {percent}%', { percent: downloadPercent })
                  : t('Downloading update...')
                : t('A new version is ready to install.')}
          </DialogDescription>
        </DialogHeader>

        {isDownloading && (
          <div className="px-6 pb-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${downloadPercent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {isReady ? (
            <>
              <Button variant="ghost" size="sm" onClick={handleDismiss} disabled={isRestarting}>
                {t('Later')}
              </Button>
              <Button size="sm" onClick={handleRestart} disabled={isRestarting}>
                {isRestarting ? (
                  <><IconLoader2 className="size-4 animate-spin" aria-hidden /> {t('Restarting…')}</>
                ) : (
                  <><IconRefresh className="size-4" aria-hidden /> {t('Restart now')}</>
                )}
              </Button>
            </>
          ) : isDownloading ? (
            <>
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                {t('Continue in background')}
              </Button>
              <Button variant="ghost" size="sm" disabled>
                <IconLoader2 className="size-4 animate-spin" aria-hidden />
                {t('Downloading…')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                {t('Dismiss')}
              </Button>
              <Button size="sm" onClick={handleUpdate}>
                <IconDownload className="size-4" aria-hidden />
                {t('Update now')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
