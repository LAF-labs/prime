import { memo, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { SettingRow, SETTINGS_BUTTON_CLASS } from './settings-shared'
import { ipc } from '@/lib/ipc'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AppSettings } from '@/types'
import { IS_MAC } from '@/lib/platform'

/**
 * Turn a keydown into Tauri's accelerator syntax (`CmdOrCtrl+Shift+A`).
 *
 * Returns null while the user is still holding only modifiers, so the recorder
 * can show progress without committing a useless binding.
 */
export const accelFromEvent = (e: {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | null => {
  const parts: string[] = []
  // Cmd and Ctrl both map to CmdOrCtrl so the same setting works if the user
  // moves between platforms; the OS resolves it locally.
  if (e.metaKey || e.ctrlKey) parts.push('CmdOrCtrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const key = e.code.startsWith('Key')
    ? e.code.slice(3)
    : e.code.startsWith('Digit')
      ? e.code.slice(5)
      : /^F\d{1,2}$/.test(e.key)
        ? e.key
        : e.key.length === 1
          ? e.key.toUpperCase()
          : null
  if (!key) return null
  // A bare key is a global hotkey that would swallow that letter everywhere.
  if (parts.length === 0) return null
  parts.push(key)
  return parts.join('+')
}

/** `CmdOrCtrl+Shift+A` → `⌘⇧A` on macOS, `Ctrl+Shift+A` elsewhere. */
export const formatAccel = (accel: string): string => {
  if (!IS_MAC) return accel.replace('CmdOrCtrl', 'Ctrl')
  return accel
    .split('+')
    .map((p) => (p === 'CmdOrCtrl' ? '⌘' : p === 'Shift' ? '⇧' : p === 'Alt' ? '⌥' : p))
    .join('')
}

interface SummonCardProps {
  draft: AppSettings
  updateDraft: (patch: Partial<AppSettings>) => void
}

/**
 * Menu-bar presence and the system-wide summon shortcut.
 *
 * Both are applied to the running app immediately rather than on save: a
 * shortcut the OS refuses (another app already owns it) has to be reported
 * while the user is still looking at the field, not silently dropped.
 */
export const SummonCard = memo(function SummonCard({ draft, updateDraft }: SummonCardProps) {
  const t = useT()
  const [isRecording, setIsRecording] = useState(false)
  const iconOn = draft.menuBarIcon ?? false
  const shortcut = draft.summonShortcut ?? null

  const apply = useCallback(async (nextIcon: boolean, nextShortcut: string | null) => {
    try {
      await ipc.summonApply(nextIcon, nextShortcut)
      return true
    } catch (err) {
      toast.error(t('Could not apply the shortcut'), {
        description: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }, [t])

  const handleIconChange = useCallback((checked: boolean) => {
    updateDraft({ menuBarIcon: checked })
    void apply(checked, shortcut)
  }, [apply, shortcut, updateDraft])

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setIsRecording(false)
      return
    }
    const accel = accelFromEvent(e)
    if (!accel) return
    setIsRecording(false)
    // Only keep it if the OS accepted it — otherwise the field would show a
    // binding that does nothing.
    if (await apply(iconOn, accel)) updateDraft({ summonShortcut: accel })
  }, [apply, iconOn, updateDraft])

  const handleClear = useCallback(async () => {
    setIsRecording(false)
    if (await apply(iconOn, null)) updateDraft({ summonShortcut: null })
  }, [apply, iconOn, updateDraft])

  return (
    <>
      <SettingRow
        label={t('Menu bar icon')}
        description={t('Keep LAF Agent reachable with every window closed')}
      >
        <Switch checked={iconOn} onCheckedChange={handleIconChange} aria-label={t('Toggle menu bar icon')} />
      </SettingRow>
      <SettingRow
        label={t('Summon shortcut')}
        description={t('Works system-wide, so it is taken from other apps while set')}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsRecording((v) => !v)}
            onKeyDown={isRecording ? handleKeyDown : undefined}
            data-testid="summon-shortcut-recorder"
            aria-label={t('Record summon shortcut')}
            className={cn(
              SETTINGS_BUTTON_CLASS,
              'min-w-[7rem] justify-center font-mono',
              isRecording && 'border-primary bg-primary/10 text-primary',
            )}
          >
            {isRecording ? t('Press keys…') : shortcut ? formatAccel(shortcut) : t('Not set')}
          </button>
          {shortcut && !isRecording && (
            <button
              type="button"
              onClick={handleClear}
              aria-label={t('Clear summon shortcut')}
              className="rounded-lg px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('Clear')}
            </button>
          )}
        </div>
      </SettingRow>
    </>
  )
})
