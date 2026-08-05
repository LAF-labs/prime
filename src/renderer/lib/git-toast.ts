/**
 * Git operation toast notifications.
 *
 * Shows toast notifications when keybinding configuration files are updated
 * or contain errors. Coalesces rapid consecutive updates.
 *
 * Features:
 * - Progress tracking for long-running operations with elapsed time
 * - Descriptive success/error messages
 * - Copy-to-clipboard for error details
 * - Stacked action support (commit + push)
 */
import { toast } from 'sonner'

export type GitToastId = string | number

/**
 * Show a loading toast for a git operation in progress.
 * Returns the toast ID so it can be dismissed/updated later.
 */
export function gitProgressToast(label: string, description?: string): GitToastId {
  return toast.loading(label, {
    description: description ?? `Running ${label.toLowerCase()}…`,
  })
}

/**
 * Update a progress toast to show success.
 */
export function gitSuccessToast(toastId: GitToastId, label: string, description?: string): void {
  toast.success(label, {
    id: toastId,
    description: description ?? 'Done',
    duration: 3000,
  })
}

/**
 * Update a progress toast to show an error.
 */
export function gitErrorToast(toastId: GitToastId, label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  toast.error(label, {
    id: toastId,
    description: message,
    duration: 8000,
    action: {
      label: 'Copy',
      onClick: () => void navigator.clipboard.writeText(message),
    },
  })
}

/**
 * Show a standalone success toast for a git operation.
 */
export function gitSuccess(label: string, detail?: string): void {
  toast.success(label, {
    description: detail,
    duration: 3000,
  })
}

/**
 * Show a standalone error toast for a git operation with copy action.
 */
export function gitError(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  toast.error(label, {
    description: message,
    duration: 8000,
    action: {
      label: 'Copy',
      onClick: () => void navigator.clipboard.writeText(message),
    },
  })
}

/**
 * Show an info toast (e.g., "Already up to date").
 */
export function gitInfo(label: string, detail?: string): void {
  toast.info(label, {
    description: detail,
    duration: 3000,
  })
}

/**
 * Format elapsed time for progress display.
 */
export function formatElapsed(startedAtMs: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
  if (elapsedSeconds < 60) return `Running for ${elapsedSeconds}s`
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return `Running for ${minutes}m ${seconds}s`
}

/**
 * Run a git action with automatic progress → success/error toast transitions.
 * Includes elapsed time tracking for long-running operations.
 */
export async function withGitToast<T>(
  label: string,
  action: () => Promise<T>,
  options?: { successDetail?: string | ((result: T) => string) },
): Promise<T> {
  const toastId = gitProgressToast(label)
  const startedAt = Date.now()

  // Update elapsed time every second for long operations
  const interval = setInterval(() => {
    const elapsed = Date.now() - startedAt
    if (elapsed > 3000) {
      toast.loading(label, {
        id: toastId,
        description: formatElapsed(startedAt),
      })
    }
  }, 1000)

  try {
    const result = await action()
    clearInterval(interval)
    const detail = typeof options?.successDetail === 'function'
      ? options.successDetail(result)
      : options?.successDetail
    gitSuccessToast(toastId, label, detail ?? 'Done')
    return result
  } catch (e) {
    clearInterval(interval)
    gitErrorToast(toastId, `${label} failed`, e)
    throw e
  }
}

/**
 * Run a stacked git action (e.g., commit + push) with combined progress.
 */
export async function withStackedGitToast(
  steps: Array<{ label: string; action: () => Promise<unknown> }>,
): Promise<void> {
  const overallLabel = steps.map((s) => s.label).join(' + ')
  const toastId = gitProgressToast(overallLabel)
  const startedAt = Date.now()

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      toast.loading(overallLabel, {
        id: toastId,
        description: `${step.label}… (${i + 1}/${steps.length})`,
      })
      await step.action()
    }
    gitSuccessToast(toastId, overallLabel, `Completed in ${Math.ceil((Date.now() - startedAt) / 1000)}s`)
  } catch (e) {
    gitErrorToast(toastId, `${overallLabel} failed`, e)
    throw e
  }
}
