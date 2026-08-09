import { useSettingsStore } from '@/stores/settingsStore'
import type { AppSettings } from '@/types'

/**
 * Which surface the app presents.
 *
 * `simple` is the default product: chat-first, with developer chrome — git
 * branches, worktrees, diff panel, terminal, debug log — hidden. `developer`
 * is the full harness. Everything stays in the codebase; the mode only decides
 * what renders, so flipping the toggle never loses state.
 */
export type UiMode = 'simple' | 'developer'

/**
 * Resolve the effective mode.
 *
 * Installs that predate the split have no `uiMode` but were using the full
 * developer surface — for them absence means `developer`, keyed off the
 * onboarding flag those installs necessarily have set. A fresh install
 * resolves to `simple`, and onboarding completion writes the choice
 * explicitly so it never depends on this inference again.
 */
export const resolveUiMode = (settings: Pick<AppSettings, 'uiMode' | 'hasOnboardedV2'>): UiMode => {
  if (settings.uiMode === 'simple' || settings.uiMode === 'developer') return settings.uiMode
  return settings.hasOnboardedV2 ? 'developer' : 'simple'
}

/** Reactive form for components. Subscribes to exactly the two inputs. */
export const useUiMode = (): UiMode =>
  useSettingsStore((s) => resolveUiMode(s.settings))

export const useIsSimpleMode = (): boolean => useUiMode() === 'simple'
