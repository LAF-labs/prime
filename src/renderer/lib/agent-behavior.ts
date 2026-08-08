import { ipc } from '@/lib/ipc'
import type { AppSettings } from '@/types'

/**
 * Push the user's agent-behavior settings into a live session.
 *
 * The harness keeps these per session process (auto-compaction, auto-retry,
 * steering mode), so they reset whenever an agent is (re)spawned. Called from
 * the session_init listener — the reconnect signal — mirroring the plan-guard
 * re-arm. Only values that differ from the harness defaults are sent, so an
 * untouched install stays byte-identical to the CLI.
 *
 * Harness contract (verified in the bundled dispatch):
 *   set_auto_compaction { enabled }   default: true
 *   set_auto_retry      { enabled }   default: true
 *   set_steering_mode   { mode }      "one-at-a-time" (default) | "all"
 */
export const syncAgentBehavior = async (
  taskId: string,
  settings: Pick<AppSettings, 'agentAutoCompaction' | 'agentAutoRetry' | 'steeringMode'>,
): Promise<void> => {
  const sends: Array<Promise<unknown>> = []
  if (settings.agentAutoCompaction === false) {
    sends.push(ipc.agentRpcRequest(taskId, 'set_auto_compaction', { enabled: false }))
  }
  if (settings.agentAutoRetry === false) {
    sends.push(ipc.agentRpcRequest(taskId, 'set_auto_retry', { enabled: false }))
  }
  if (settings.steeringMode === 'all') {
    sends.push(ipc.agentRpcRequest(taskId, 'set_steering_mode', { mode: 'all' }))
  }
  if (sends.length === 0) return
  // Best-effort: a failed toggle must not break the session; the harness
  // default simply remains in effect.
  await Promise.allSettled(sends)
}
