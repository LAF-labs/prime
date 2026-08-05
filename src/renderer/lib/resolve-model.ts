/**
 * Shared model resolution logic.
 *
 * The model to use for a new or resumed ACP session is resolved in this order:
 * 1. Per-task model pick (from the model picker while a thread is active)
 * 2. Project preference (persisted per-workspace)
 * 3. Global `defaultModel` setting (persisted across workspaces)
 * 4. In-memory `currentModelId` (transient, set by session_init or picker)
 *
 * Returns `undefined` when no preference is set — the CLI subprocess will
 * boot with its own built-in default.
 */
import type { ProjectPrefs, AppSettings } from '@/types'

export function resolveModelId(opts: {
  taskModelId?: string | null
  projectPrefs?: ProjectPrefs | null
  settings: AppSettings
  currentModelId?: string | null
}): string | undefined {
  const { taskModelId, projectPrefs, settings, currentModelId } = opts
  return (
    taskModelId ??
    projectPrefs?.modelId ??
    settings.defaultModel ??
    currentModelId ??
    undefined
  ) || undefined
}
