import { t } from '@/lib/i18n'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { IconBug, IconCheck } from '@tabler/icons-react'
import { getVersion } from '@tauri-apps/api/app'
import { ipc } from '@/lib/ipc'
import { reportFailure } from '@/lib/ipc-report'
import { cn } from '@/lib/utils'
import { SETTINGS_BUTTON_CLASS } from '@/components/settings/settings-shared'

/**
 * Report a problem.
 *
 * There is nowhere to send this yet — the service backend is a later phase —
 * so the report is written next to the app's own logs and revealed in Finder,
 * and the dialog says so plainly instead of showing a Submit button that
 * quietly does nothing. When the backend exists, `handleSubmit` gains an
 * upload and the copy changes; the shape of what gets collected does not.
 *
 * Deliberately excluded from the report: conversation text, file contents and
 * provider keys. A bug report is not a channel for shipping the user's work
 * off their machine, and the fields below are the ones that actually help —
 * app version, platform, and what the user says happened.
 */
export const BugReportDialog = memo(function BugReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    setDescription('')
    setSavedPath(null)
    // Let the dialog paint before stealing focus, or the caret lands nowhere.
    const id = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const handleSubmit = useCallback(async () => {
    const text = description.trim()
    if (!text || saving) return
    setSaving(true)
    try {
      const version = await getVersion().catch(() => 'unknown')
      const report = [
        `LAF Agent bug report`,
        `version: ${version}`,
        `platform: ${navigator.platform}`,
        `when: ${new Date().toISOString()}`,
        '',
        text,
        '',
      ].join('\n')
      const path = await ipc.saveBugReport(report)
      setSavedPath(path)
    } catch (err) {
      reportFailure(t('Could not save the report'), err)
    } finally {
      setSaving(false)
    }
  }, [description, saving])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 backdrop-blur-[2px]"
      role="presentation"
      onClick={() => onOpenChange(false)}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the backdrop closes; the panel must not */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Report a problem')}
        className="w-[min(520px,92vw)] overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 pt-5">
          <IconBug className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-[15px] font-semibold text-foreground">{t('Report a problem')}</h2>
        </div>

        {savedPath ? (
          <div className="px-5 py-5">
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-foreground">
              <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {t('Report saved. Send us the file and we can take a look.')}
            </p>
            <p className="mt-2 break-all rounded-lg bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {savedPath}
            </p>
          </div>
        ) : (
          <div className="px-5 py-4">
            <textarea
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('What went wrong?')}
              rows={6}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t('The report includes the app version and what you wrote here. Your conversations, files and API keys are not included.')}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
          <button type="button" className={SETTINGS_BUTTON_CLASS} onClick={() => onOpenChange(false)}>
            {savedPath ? t('Close') : t('Cancel')}
          </button>
          {!savedPath && (
            <button
              type="button"
              disabled={!description.trim() || saving}
              onClick={handleSubmit}
              className={cn(
                'inline-flex h-7 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors',
                'hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              {saving ? t('Saving…') : t('Save report')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
