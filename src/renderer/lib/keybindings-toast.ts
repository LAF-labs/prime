/**
 * Keybindings toast notifications.
 *
 * Shows toast notifications when keybinding configuration files are updated
 * or contain errors. Coalesces rapid consecutive updates.
 */
import { toast } from 'sonner'
import { t } from '@/lib/i18n'

let lastToastTime = 0
let pendingTimer: ReturnType<typeof setTimeout> | null = null
const COALESCE_MS = 1000

/**
 * Show a toast notification for a keybindings config update.
 * Coalesces rapid consecutive calls within 1 second.
 */
export function notifyKeybindingsUpdated(): void {
  const now = Date.now()
  if (now - lastToastTime < COALESCE_MS) {
    // Coalesce: cancel pending and reschedule
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      lastToastTime = Date.now()
      toast.success(t('Keybindings updated'), {
        description: t('Your keyboard shortcuts have been reloaded.'),
        duration: 2000,
      })
    }, COALESCE_MS)
    return
  }

  lastToastTime = now
  toast.success(t('Keybindings updated'), {
    description: t('Your keyboard shortcuts have been reloaded.'),
    duration: 2000,
  })
}

/**
 * Show a warning toast for malformed keybindings config.
 */
export function notifyKeybindingsError(detail?: string): void {
  toast.error(t('Keybindings config error'), {
    description: detail ?? t('Your keybindings file contains syntax errors. Some shortcuts may not work.'),
    duration: 5000,
  })
}
