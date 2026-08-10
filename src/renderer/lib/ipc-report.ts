/**
 * Making IPC failures visible by default.
 *
 * Of the ~275 `ipc.*` call sites in the renderer, 14 showed the user anything
 * on failure. The rest ended in `.catch(() => {})`, `.catch(console.error)`,
 * or a floated promise — so a failed file delete left the row in the tree, a
 * failed settings write showed the toggle applied and reverted it on next
 * launch, and a failed thread delete brought the thread back after restart.
 * The user's mental model corrupts silently in all three.
 *
 * This is deliberately not a blanket interceptor inside `ipc.ts`. Background
 * polling (connection health, capability probes) fails repeatedly and
 * legitimately when the agent is down; toasting every rejection would bury
 * the one that matters. Instead, user-initiated actions call these helpers,
 * and repeated identical failures are collapsed.
 */
import { toast } from 'sonner'

/** Suppress an identical (action, message) pair within this window. */
const DEDUPE_MS = 5_000

const recentFailures = new Map<string, number>()

/**
 * Show a failure to the user, once per identical failure per window.
 *
 * `action` is the already-translated name of what failed ("Could not delete
 * the file"); the raw error becomes the description so the toast says both
 * what broke and why.
 */
export const reportFailure = (action: string, err: unknown): void => {
  const detail = err instanceof Error ? err.message : String(err)
  const key = `${action}\u{1f}${detail}`
  const now = Date.now()
  const last = recentFailures.get(key) ?? 0
  if (now - last < DEDUPE_MS) return
  recentFailures.set(key, now)

  // Keep the map from growing over a long session.
  if (recentFailures.size > 64) {
    for (const [k, ts] of recentFailures) {
      if (now - ts >= DEDUPE_MS) recentFailures.delete(k)
    }
  }

  console.error(`[ipc] ${action}:`, err)
  toast.error(action, { description: detail })
}

/**
 * Fire-and-forget with a visible failure.
 *
 * The replacement for `void somePromise` and `.catch(() => {})` at call sites
 * where the user asked for something: the action stays non-blocking, but a
 * failure reaches them instead of a console they cannot open.
 */
export const attempt = (action: string, promise: Promise<unknown>): void => {
  promise.catch((err) => reportFailure(action, err))
}

/**
 * Background work whose failure the user cannot act on.
 *
 * The third tier, between `attempt` (toast it) and a bare `.catch(() => {})`
 * (lose it). Startup probes, dock icons, listener registration and shutdown
 * acks all fail in ways no user can fix, so toasting them would bury the
 * failures that matter — the reasoning in this module's header. But silence
 * costs support the one clue they had: a menu listener that failed to
 * register turns into "the New Thread menu item does nothing", with nothing
 * anywhere to say why.
 *
 * These go to the Rust log file (`~/Library/Logs/<bundle>/LAF Agent.log`)
 * through tauri-plugin-log, which is the only durable sink the app has now
 * that the in-app debug panel is gone. `console.warn` is kept alongside so a
 * developer sees it in the WebView inspector, and so this still works in the
 * browser preview where the Tauri globals are absent.
 *
 * `context` should name the thing that broke, not the symptom:
 * "register menu listeners", not "listener error".
 */
export const ignoreFailure = (context: string, promise: Promise<unknown>): void => {
  promise.catch((err) => {
    const detail = err instanceof Error ? err.message : String(err)
    const line = `[background] ${context} failed: ${detail}`
    console.warn(line, err)
    // Fire-and-forget into the log file. Nested failure is ignored on purpose:
    // this is the error path, and a logger that throws here would replace a
    // background failure with an unhandled rejection.
    void import('@tauri-apps/plugin-log')
      .then(({ warn }) => warn(line))
      .catch(() => {})
  })
}

/** Test hook: forget past failures so dedup state doesn't leak across tests. */
export const resetFailureDedup = (): void => {
  recentFailures.clear()
}
