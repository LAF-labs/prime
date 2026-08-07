/**
 * Plan-mode enforcement sync.
 *
 * Plan mode has two layers. The first is the prompt prefix ChatPanel applies
 * to every plan-mode message — a request the model can ignore. The second is
 * the `/plan-guard` extension command registered by the bundled gate
 * (`src-tauri/resources/laf-agent-gate.ts`), which hard-blocks mutating tool
 * calls inside the agent process. This module keeps the second layer in sync
 * with the UI's mode toggle.
 *
 * Transport: the RPC `prompt` command. `AgentSession._normalizeSubmission`
 * dispatches text starting with `/` to registered extension commands on every
 * transport WITHOUT starting a model turn, and the daemon acks the prompt
 * with a correlated success response — so `agentRpcRequest(taskId, 'prompt',
 * { message })` executes the command and resolves without touching the
 * transcript (task_send_message is NOT used precisely because it would).
 */

import { ipc } from '@/lib/ipc'

type GuardState = 'on' | 'off'

/**
 * Last state we successfully delivered, per task. Used only to skip the
 * redundant initial "off" (the gate boots with the guard off); "on" is always
 * re-sent so a restarted agent process gets re-armed on the next sync.
 */
const delivered = new Map<string, GuardState>()

/**
 * Align the gate's plan guard with the UI mode. Safe to call eagerly — it
 * no-ops when the thread has no live agent connection yet (the guard will be
 * synced again on the next mode change or toggle mount), and it never throws.
 */
export const syncPlanEnforcement = async (taskId: string, modeId: string | null): Promise<void> => {
  if (!taskId) return
  const desired: GuardState = modeId === 'plan' ? 'on' : 'off'

  // The gate's default is off — don't wake a connection just to say "off"
  // when we never turned it on.
  if (desired === 'off' && delivered.get(taskId) !== 'on') return

  try {
    await ipc.agentRpcRequest(taskId, 'prompt', { message: `/plan-guard ${desired}` })
    delivered.set(taskId, desired)
  } catch {
    // No live connection (deferred spawn, agent restarting) — expected.
    // The prompt prefix still applies, and we re-sync on the next call.
    delivered.delete(taskId)
  }
}
