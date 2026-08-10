import type { AgentTask } from '@/types'
import { ipc } from '@/lib/ipc'
import { joinChunk } from '@/lib/utils'
import { sendTaskNotification } from '@/lib/notifications'
import { useDebugStore } from '@/stores/debugStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useResourceStore } from '@/stores/resourceStore'
import { useTaskStore } from './taskStore'
import type { TaskStore } from './task-store-types'
import { t as msg } from '@/lib/i18n'
import { attempt, reportFailure } from '@/lib/ipc-report'
import { record } from '@/lib/analytics-collector'
import { consumeTurnClaim, releaseTurn } from '@/lib/turn-ownership'
import { syncPlanEnforcement } from '@/lib/plan-enforcement'
import { syncAgentBehavior } from '@/lib/agent-behavior'
import {
  EMPTY_SNAPSHOT, snapshotOf, spendDelta, providerOf,
  type SessionStats, type SpendSnapshot,
} from '@/lib/token-spend'
import { stripImageDataForTitleGen } from '@/lib/message-utils'
import { getReceiptBus, createTurnQuiescedReceipt } from '@/lib/typed-receipts'
import * as threadDb from '@/lib/thread-db'

/** Get the project basename from a workspace path (privacy: no full paths). */
const projectName = (workspace: string): string => {
  const parts = workspace.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || workspace
}

// ── Billable token accounting ────────────────────────────────────
//
// `usage_update` carries context-window occupancy, which is a gauge, not a
// total — charting it as consumption overstates it badly and bears no
// relation to a bill. The billable figures live in the agent's cumulative
// session stats, so after each turn we snapshot them and record the delta.
// See lib/token-spend.ts for the cost rules.

/** Last observed cumulative totals per thread, to diff the next turn against. */
const spendSnapshots: Record<string, SpendSnapshot> = {}

const recordTurnSpend = async (taskId: string): Promise<void> => {
  let stats: SessionStats | null = null
  try {
    stats = (await ipc.agentRpcRequest(taskId, 'get_session_stats')) as SessionStats
  } catch {
    // A torn-down connection is the common case here; usage simply goes
    // unrecorded for that turn rather than surfacing an error to the user.
    return
  }

  const current = snapshotOf(stats)
  const previous = spendSnapshots[taskId] ?? EMPTY_SNAPSHOT
  spendSnapshots[taskId] = current

  const modelId = useTaskStore.getState().taskModels[taskId]
    ?? useSettingsStore.getState().currentModelId
  const provider = providerOf(modelId)
  const rate = provider ? useSettingsStore.getState().settings.providerRates?.[provider] : undefined

  const delta = spendDelta(previous, current, rate)
  if (delta.tokens <= 0) return

  const task = useTaskStore.getState().tasks[taskId]
  record('token_spend', {
    project: task ? projectName(task.workspace) : undefined,
    thread: taskId,
    detail: modelId ?? undefined,
    value: delta.tokens,
    value2: delta.cost,
  })
}

/** Drop a thread's running totals when it goes away. */
export const forgetSpendSnapshot = (taskId: string): void => {
  delete spendSnapshots[taskId]
}

// ── Throttled periodic backup ────────────────────────────────────

const BACKUP_THROTTLE_MS = 5 * 60 * 1000 // 5 minutes
let lastBackupTime = 0

/** Best-effort backup, throttled to once per 5 minutes */
const throttledBackup = (): void => {
  const now = Date.now()
  if (now - lastBackupTime < BACKUP_THROTTLE_MS) return
  lastBackupTime = now
  import('@/lib/history-store').then((hs) =>
    hs.createBackup(useSettingsStore.getState().settings),
  ).catch(() => {})
}

// ── Throttled mid-turn persist ───────────────────────────────────
// Persist history periodically while a turn is in progress so that
// a dev hot-reload or crash doesn't lose all streamed content.
// Throttled to once per 10 s to avoid hammering the disk on every chunk.

const MID_TURN_PERSIST_MS = 10_000
let lastMidTurnPersistMs = 0

const throttledMidTurnPersist = (): void => {
  const now = Date.now()
  if (now - lastMidTurnPersistMs < MID_TURN_PERSIST_MS) return
  lastMidTurnPersistMs = now
  useTaskStore.getState().persistHistory()
}

/**
 * Apply turn_end and write every message it appended through to SQLite.
 *
 * `applyTurnEnd` can add more than the assistant reply — refusal and
 * connection-lost system notes ride along — and the refusal/watchdog paths
 * used to skip persistence entirely. With the JSON index thin, a message that
 * misses SQLite has no durable home, so the save must cover the exact delta
 * on every path that ends a turn. Dedupe keys make re-saves no-ops.
 */
/**
 * Seed the effort picker from session state, then re-assert the user's saved
 * per-model preference.
 *
 * The agent owns the truth about which levels exist (it derives them from the
 * model) and boots with its own default, so a fresh session would silently drop
 * a preference the user set on a previous run. Anything the agent won't accept
 * is skipped rather than sent and rejected.
 */
const applyThinkingLevel = (
  taskId: string,
  modelId: string | null,
  level: string | null | undefined,
  available: string[] | null | undefined,
): void => {
  if (!taskId || taskId === '__probe__') return
  const store = useTaskStore.getState()
  const options = Array.isArray(available) && available.length > 0 ? available : null
  if (options) store.setAvailableThinkingLevels(taskId, options)
  if (level) store.setThinkingLevel(taskId, level)

  const saved = modelId ? useSettingsStore.getState().settings.modelEfforts?.[modelId] : undefined
  if (!saved || saved === level) return
  if (options && !options.includes(saved)) return
  store.setThinkingLevel(taskId, saved)
  ipc.setThinkingLevel(taskId, saved).catch(() => {})
}

const applyTurnEndPersisting = (taskId: string, stopReason?: string, refusalRetry?: boolean): void => {
  const before = useTaskStore.getState().tasks[taskId]?.messages.length ?? 0
  useTaskStore.setState((s) => applyTurnEnd(s, taskId, stopReason, refusalRetry))
  const after = useTaskStore.getState().tasks[taskId]
  if (!after) return
  const appended = after.messages.slice(before)
  if (appended.length > 0) {
    attempt(msg('Could not save the conversation'), threadDb.saveAllMessages(taskId, appended))
  }
}

/**
 * Pure state reducer for turn_end — exported for testing.
 */
export const applyTurnEnd = (
  s: Pick<TaskStore, 'tasks' | 'streamingChunks' | 'thinkingChunks' | 'liveToolCalls' | 'liveToolSplits'>,
  taskId: string,
  stopReason?: string,
  refusalRetry?: boolean,
): Partial<TaskStore> => {
  const chunk = s.streamingChunks[taskId] ?? ''
  const thinking = s.thinkingChunks[taskId] ?? ''
  const liveTools = s.liveToolCalls[taskId] ?? []
  const liveSplits = s.liveToolSplits[taskId] ?? []
  const task = s.tasks[taskId]
  if (!task) return {}
  const fallbackStatus = stopReason === 'refusal' ? 'failed' as const
    : stopReason === 'cancelled' ? 'cancelled' as const
    : 'completed' as const
  const finalizedTools = liveTools.map((tc) =>
    tc.status === 'completed' || tc.status === 'failed' || tc.status === 'cancelled' ? tc : { ...tc, status: fallbackStatus },
  )
  // Filter splits to those that reference one of the finalized tool calls
  // and sort by offset, breaking ties by the tool call's `createdAt` so the
  // persisted order matches the order the agent emitted batched tools in.
  // `.filter` returns a fresh array, so we can sort in place.
  const toolIds = new Set(finalizedTools.map((tc) => tc.toolCallId))
  const toolCreatedAt = new Map(finalizedTools.map((tc) => [tc.toolCallId, tc.createdAt ?? '']))
  const finalizedSplits = liveSplits
    .filter((split) => toolIds.has(split.toolCallId))
    .sort((a, b) => {
      if (a.at !== b.at) return a.at - b.at
      const aAt = toolCreatedAt.get(a.toolCallId) ?? ''
      const bAt = toolCreatedAt.get(b.toolCallId) ?? ''
      return aAt.localeCompare(bAt)
    })
  const newMessages = [...task.messages]
  if (chunk || finalizedTools.length > 0) {
    newMessages.push({
      role: 'assistant' as const,
      content: chunk,
      timestamp: new Date().toISOString(),
      ...(thinking ? { thinking } : {}),
      ...(finalizedTools.length > 0 ? { toolCalls: finalizedTools } : {}),
      ...(finalizedSplits.length > 0 ? { toolCallSplits: finalizedSplits } : {}),
    })
  }
  if (stopReason === 'refusal') {
    const refusalMsg = refusalRetry
      ? msg('\u26a0\ufe0f The agent refused to continue. Retrying automatically\u2026')
      : msg('\u26a0\ufe0f The agent refused to continue. You can try rephrasing your request or sending a new message.')
    newMessages.push({
      role: 'system' as const,
      content: refusalMsg,
      timestamp: new Date().toISOString(),
    })
  }
  // `connection_lost` deliberately adds nothing to the transcript. It fires
  // whenever the agent process goes away — including the ordinary case of
  // quitting the app mid-turn — and a permanent "connection lost" line for a
  // transient, self-healing event was pure noise. Live connection state has
  // its own transient banner; a genuine failure arrives as `task_error`.
  const updatedTask: AgentTask = {
    ...task,
    // Both refusal and normal end leave the task `paused` so the user can
    // send a new message. We surface the refusal as a system message in
    // `newMessages` rather than via a sticky 'error' status (which would
    // feel like the task is unrecoverable).
    status: 'paused',
    messages: newMessages,
    pendingPermission: undefined,
  }
  return {
    tasks: { ...s.tasks, [taskId]: updatedTask },
    streamingChunks: { ...s.streamingChunks, [taskId]: '' },
    thinkingChunks: { ...s.thinkingChunks, [taskId]: '' },
    liveToolCalls: { ...s.liveToolCalls, [taskId]: [] },
    liveToolSplits: { ...s.liveToolSplits, [taskId]: [] },
  }
}

export function initTaskListeners(): () => void {
  useTaskStore.getState().setConnected(true)

  // ── Activity watchdog ────────────────────────────────────────────────────────
  // If a task stays in `running` with no streaming chunk, tool-call update, or
  // plan update for WATCHDOG_WARN_MS, we surface a warning in the debug panel.
  // After WATCHDOG_KILL_MS we auto-clear the spinner via a synthetic turn_end.
  // This catches the common dev-reload case where the Tauri webview restarts
  // mid-turn and the backend never fires `turn_end`.
  const WATCHDOG_WARN_MS = 60_000   // 60 s — surface warning
  const WATCHDOG_KILL_MS = 300_000  // 5 min — auto-clear spinner

  // Per-task timestamp of the last observed activity (chunk / tool / plan)
  const lastActivityMs: Record<string, number> = {}

  // Track refusal retries per task — allows one automatic retry before giving up
  const refusalRetried: Record<string, boolean> = {}

  const touchActivity = (taskId: string) => {
    lastActivityMs[taskId] = Date.now()
  }

  const watchdogInterval = setInterval(() => {
    const now = Date.now()
    const state = useTaskStore.getState()
    for (const [taskId, task] of Object.entries(state.tasks)) {
      if (task.status !== 'running') {
        delete lastActivityMs[taskId]
        continue
      }
      const last = lastActivityMs[taskId] ?? now
      const idle = now - last
      if (idle >= WATCHDOG_KILL_MS) {
        // Five minutes of a running turn with no token, no tool call, nothing:
        // this is not a connection that will heal itself, it is a hang. Clear
        // the spinner and say so in the error surface — the same card a
        // provider failure gets, with the same retry affordance.
        applyTurnEndPersisting(taskId, 'connection_lost')
        useTaskStore.setState((s) => {
          const stalled = s.tasks[taskId]
          if (!stalled) return s
          return {
            tasks: {
              ...s.tasks,
              [taskId]: {
                ...stalled,
                status: 'error',
                messages: [...stalled.messages, {
                  role: 'system' as const,
                  content: `⚠️ ${msg('The agent stopped responding. Send your message again to retry.')}`,
                  timestamp: new Date().toISOString(),
                  errorAction: 'retry' as const,
                }],
              },
            },
          }
        })
        useTaskStore.getState().persistHistory()
        delete lastActivityMs[taskId]
        useDebugStore.getState().addEntry({
          id: 0,
          direction: 'in',
          category: 'error',
          type: 'watchdog',
          taskId,
          summary: `Task stuck for ${Math.round(idle / 1000)}s with no activity — auto-cleared spinner`,
          payload: { idleMs: idle },
          isError: true,
          timestamp: new Date().toISOString(),
        })
      } else if (idle >= WATCHDOG_WARN_MS) {
        useDebugStore.getState().addEntry({
          id: 0,
          direction: 'in',
          category: 'error',
          type: 'watchdog',
          taskId,
          summary: `Task has been running with no activity for ${Math.round(idle / 1000)}s — may be stuck`,
          payload: { idleMs: idle },
          isError: false,
          timestamp: new Date().toISOString(),
        })
      }
    }
    // Prune orphaned records for tasks that no longer exist in state
    for (const id of Object.keys(lastActivityMs)) {
      if (!state.tasks[id]) delete lastActivityMs[id]
    }
    for (const id of Object.keys(refusalRetried)) {
      if (!state.tasks[id]) delete refusalRetried[id]
    }
  }, 10_000) // check every 10 s

  // Batch task_update events with rAF — multiple threads can fire status changes rapidly
  let taskUpdateBuf: Record<string, AgentTask> = {}
  let taskUpdateRaf: number | null = null
  const flushTaskUpdates = () => {
    const buf = taskUpdateBuf; taskUpdateBuf = {}; taskUpdateRaf = null
    const store = useTaskStore.getState()
    for (const task of Object.values(buf)) {
      store.upsertTask({ ...task, messages: [] })
    }
  }
  const unsub1 = ipc.onTaskUpdate((task) => {
    // Keep only the latest update per task, strip messages
    taskUpdateBuf[task.id] = task
    if (!taskUpdateRaf) taskUpdateRaf = requestAnimationFrame(flushTaskUpdates)
  })

  // Batch streaming chunks with rAF to reduce state updates
  let chunkBuf: Record<string, string> = {}
  let chunkRaf: number | null = null
  const flushChunks = () => {
    const buf = chunkBuf; chunkBuf = {}; chunkRaf = null
    useTaskStore.setState((s) => {
      const next = { ...s.streamingChunks }
      for (const [id, text] of Object.entries(buf)) {
        if (s.tasks[id]?.status !== 'running') continue
        next[id] = joinChunk(next[id] ?? '', text)
      }
      return { streamingChunks: next }
    })
  }
  const unsub2 = ipc.onMessageChunk(({ taskId, chunk }) => {
    if (useTaskStore.getState().tasks[taskId]?.status !== 'running') return
    touchActivity(taskId)
    chunkBuf[taskId] = (chunkBuf[taskId] ?? '') + chunk
    if (!chunkRaf) chunkRaf = requestAnimationFrame(flushChunks)
    throttledMidTurnPersist()
  })

  let thinkBuf: Record<string, string> = {}
  let thinkRaf: number | null = null
  const flushThinking = () => {
    const buf = thinkBuf; thinkBuf = {}; thinkRaf = null
    useTaskStore.setState((s) => {
      const next = { ...s.thinkingChunks }
      for (const [id, text] of Object.entries(buf)) {
        if (s.tasks[id]?.status !== 'running') continue
        next[id] = joinChunk(next[id] ?? '', text)
      }
      return { thinkingChunks: next }
    })
  }
  const unsub3 = ipc.onThinkingChunk(({ taskId, chunk }) => {
    if (useTaskStore.getState().tasks[taskId]?.status !== 'running') return
    touchActivity(taskId)
    thinkBuf[taskId] = (thinkBuf[taskId] ?? '') + chunk
    if (!thinkRaf) thinkRaf = requestAnimationFrame(flushThinking)
  })

  /**
   * Synchronously commit any pending streaming text so callers that read
   * `streamingChunks[taskId].length` immediately afterwards see the
   * up-to-date value. Used by `onToolCall` so the offset recorded for
   * inline tool-call rendering matches the text the agent had already
   * emitted at that point.
   *
   * The flush is global (commits every buffered task) because the
   * underlying `flushChunks` is — committing extra clean text is harmless
   * and avoids keeping two near-identical flush paths in sync. We do *not*
   * early-return when `chunkBuf[taskId]` is empty: if another task has
   * pending chunks, skipping the flush would leave stale data in the
   * buffer until the next rAF tick.
   */
  const flushPendingChunks = (): void => {
    if (chunkRaf === null) return
    cancelAnimationFrame(chunkRaf)
    chunkRaf = null
    flushChunks()
  }

  const unsub4 = ipc.onToolCall(({ taskId, toolCall }) => {
    flushPendingChunks()
    touchActivity(taskId)
    useTaskStore.getState().upsertToolCall(taskId, toolCall)
  })

  const unsub5 = ipc.onToolCallUpdate(({ taskId, toolCall }) => {
    // Only the first sighting of a tool call records a split offset. For
    // updates to a known tool, the existing split is preserved verbatim
    // and skipping the synchronous flush avoids a setState per token-tick.
    const liveTools = useTaskStore.getState().liveToolCalls[taskId]
    const isKnown = liveTools?.some((tc) => tc.toolCallId === toolCall.toolCallId) === true
    if (!isKnown) flushPendingChunks()
    touchActivity(taskId)
    useTaskStore.getState().upsertToolCall(taskId, toolCall)
    // Analytics: record completed tool calls
    if (toolCall.status === 'completed') {
      const task = useTaskStore.getState().tasks[taskId]
      const proj = task ? projectName(task.workspace) : undefined
      record('tool_call', { project: proj, thread: taskId, detail: toolCall.kind ?? 'other' })
      // Edit line counts come from the RPC client's diff annotation on the
      // tool call itself (see Rust `diff_stats`), recorded incrementally per
      // completed edit rather than from a workspace snapshot.
      if (toolCall.kind === 'edit' || toolCall.kind === 'delete' || toolCall.kind === 'move') {
        let additions = 0
        let deletions = 0
        for (const item of toolCall.content ?? []) {
          if (item.type !== 'diff') continue
          additions += item.linesAdded ?? 0
          deletions += item.linesRemoved ?? 0
        }
        if (additions > 0 || deletions > 0) {
          record('diff_stats', { project: proj, thread: taskId, value: additions, value2: deletions })
        }
      }
      if (toolCall.kind === 'edit' || toolCall.kind === 'delete' || toolCall.kind === 'move') {
        const filePath = toolCall.locations?.[0]?.path
        const fileName = filePath ? filePath.split('/').pop() ?? filePath : undefined
        record('file_edited', { project: proj, thread: taskId, detail: fileName })
      }
    }
  })


  const unsub7 = ipc.onUsageUpdate(({ taskId, used, size }) => {
    useTaskStore.getState().updateUsage(taskId, used, size)
    const task = useTaskStore.getState().tasks[taskId]
    record('token_usage', {
      project: task ? projectName(task.workspace) : undefined,
      thread: taskId,
      value: used,
      value2: size,
    })
  })

  // Guard against duplicate title generation requests for the same task
  const titleGenerationInFlight = new Set<string>()

  const unsub8 = ipc.onTurnEnd(({ taskId, stopReason }) => {
    // Flush any pending rAF-buffered chunks synchronously so turn_end sees them
    if (chunkBuf[taskId] || Object.keys(chunkBuf).length > 0) {
      if (chunkRaf) { cancelAnimationFrame(chunkRaf); chunkRaf = null }
      flushChunks()
    }
    if (thinkBuf[taskId] || Object.keys(thinkBuf).length > 0) {
      if (thinkRaf) { cancelAnimationFrame(thinkRaf); thinkRaf = null }
      flushThinking()
    }

    // On refusal: auto-retry once, then give up and let the user send a new message
    if (stopReason === 'refusal') {
      const alreadyRetried = !!refusalRetried[taskId]

      // Apply turn end with retry flag so the system message is appropriate
      applyTurnEndPersisting(taskId, stopReason, !alreadyRetried)
      useTaskStore.getState().persistHistory()
      throttledBackup()

      if (!alreadyRetried) {
        // First refusal: mark as retried and auto-retry the last user message
        refusalRetried[taskId] = true
        const task = useTaskStore.getState().tasks[taskId]
        if (task) {
          // Find the last user message to retry
          const lastUserMsg = [...task.messages].reverse().find((m) => m.role === 'user')
          if (lastUserMsg) {
            useTaskStore.getState().upsertTask({ ...task, status: 'running' })
            useTaskStore.getState().clearTurn(taskId)
            // If the resend rejects, the thread would sit on 'running' until
            // the watchdog: restore it to paused and tell the user.
            ipc.sendMessage(taskId, lastUserMsg.content).catch((err) => {
              const current = useTaskStore.getState().tasks[taskId]
              if (current) useTaskStore.getState().upsertTask({ ...current, status: 'paused' })
              useTaskStore.getState().setDispatchSnapshot(taskId, null)
              reportFailure(msg('Could not retry the message'), err)
            })
            return // skip notification and queue processing — we're retrying
          }
        }
      } else {
        // Second refusal: reset the retry tracker and let the user recover
        delete refusalRetried[taskId]
      }

      // Notify on refusal (only if we didn't auto-retry)
      const settings = useSettingsStore.getState().settings
      const task = useTaskStore.getState().tasks[taskId]
      if (task) {
        sendTaskNotification({
          task,
          status: 'error',
          isNotificationsEnabled: settings.notifications ?? true,
          isSoundEnabled: settings.soundNotifications ?? true,
          onNotified: (tid) => {
            useTaskStore.setState((s) => ({
              notifiedTaskIds: s.notifiedTaskIds.includes(tid) ? s.notifiedTaskIds : [...s.notifiedTaskIds, tid],
            }))
          },
        })
      }
      return // don't process queue on refusal
    }

    // Non-refusal turn end: clear any refusal tracker for this task
    delete refusalRetried[taskId]

    // `turn_end` is broadcast to every window. Only the one that sent the
    // message counts it, so two open windows don't report every turn — and
    // every dollar — twice.
    const isDispatchingWindow = consumeTurnClaim(taskId)

    // Single atomic apply (avoids stale reads between getState() calls),
    // persisting every appended message — not just the assistant reply.
    applyTurnEndPersisting(taskId, stopReason)

    if (isDispatchingWindow) void recordTurnSpend(taskId)

    // Clear dispatch snapshot — turn is complete
    useTaskStore.getState().setDispatchSnapshot(taskId, null)

    // Generate an AI title after the first turn if the thread still has the
    // default "Thread HH:MM" name. Fire-and-forget — a failure just keeps
    // the default name. Guard: skip if a title generation is already in-flight.
    {
      const t = useTaskStore.getState().tasks[taskId]
      if (t && !titleGenerationInFlight.has(taskId)) {
        const isDefaultName = /^Thread \d{1,2}:\d{2}/.test(t.name)
        const userMessages = t.messages.filter((m) => m.role === 'user')
        if (isDefaultName && userMessages.length === 1) {
          const firstMsg = stripImageDataForTitleGen(userMessages[0].content)
          titleGenerationInFlight.add(taskId)
          ipc.generateThreadTitle(firstMsg, t.workspace).then(({ title }) => {
            if (title && title.trim()) {
              // Re-check: user might have renamed while we were generating
              const current = useTaskStore.getState().tasks[taskId]
              if (current && /^Thread \d{1,2}:\d{2}/.test(current.name)) {
                useTaskStore.getState().renameTask(taskId, title.trim())
              }
            }
          }).catch((e) => {
            if (import.meta.env.DEV) console.warn('[task-listeners] generateThreadTitle failed:', e)
          }).finally(() => {
            titleGenerationInFlight.delete(taskId)
          })
        }
      }
    }

    // Emit turn quiesced receipt
    {
      const t = useTaskStore.getState().tasks[taskId]
      if (t) {
        const lastMsg = t.messages[t.messages.length - 1]
        const toolCallCount = lastMsg?.toolCalls?.length ?? 0
        getReceiptBus().publish(createTurnQuiescedReceipt(taskId, t.messages.length, toolCallCount))
      }
    }

    // Analytics: record assistant output word count and diff stats.
    // Same reason as the spend above — one window counts the turn.
    if (isDispatchingWindow) {
      const t = useTaskStore.getState().tasks[taskId]
      if (t) {
        const proj = projectName(t.workspace)
        const lastMsg = t.messages[t.messages.length - 1]
        if (lastMsg?.role === 'assistant' && lastMsg.content) {
          record('message_received', {
            project: proj,
            thread: taskId,
            value: lastMsg.content.split(/\s+/).filter(Boolean).length,
          })
        }
        const model = useSettingsStore.getState().currentModelId
        if (model) record('model_used', { project: proj, thread: taskId, detail: model })
      }
    }

    // Persist history after turn ends
    useTaskStore.getState().persistHistory()
    throttledBackup()

    // Send a native notification when the window is not focused and notifications are enabled
    const settings = useSettingsStore.getState().settings
    const task = useTaskStore.getState().tasks[taskId]
    if (task) {
      const notifStatus = task.status === 'error' ? 'error' : 'completed'
      sendTaskNotification({
        task,
        status: notifStatus,
        isNotificationsEnabled: settings.notifications ?? true,
        isSoundEnabled: settings.soundNotifications ?? true,
        onNotified: (tid) => {
          useTaskStore.setState((s) => ({
            notifiedTaskIds: s.notifiedTaskIds.includes(tid) ? s.notifiedTaskIds : [...s.notifiedTaskIds, tid],
          }))
        },
      })
    }

    // Auto-send the first queued message if any exist
    const state = useTaskStore.getState()
    const queue = state.queuedMessages[taskId] ?? []
    if (queue.length > 0) {
      const nextMsg = queue[0]
      // Remove the first message from the queue
      useTaskStore.setState((s) => ({
        queuedMessages: {
          ...s.queuedMessages,
          [taskId]: (s.queuedMessages[taskId] ?? []).slice(1),
        },
      }))
      // Send it — add as user message and dispatch to backend
      const task = useTaskStore.getState().tasks[taskId]
      if (task) {
        const userMsg: import('@/types').TaskMessage = {
          role: 'user' as const,
          content: nextMsg.text,
          timestamp: new Date().toISOString(),
        }
        useTaskStore.getState().upsertTask({
          ...task,
          status: 'running',
          messages: [...task.messages, userMsg],
        })
        useTaskStore.getState().clearTurn(taskId)
        // Same contract as a hand-typed send (ChatPanel): the user message is
        // written to SQLite at dispatch time, not left for a later bulk save.
        attempt(msg('Could not save the conversation'), threadDb.saveMessage(taskId, userMsg))
        ipc.sendMessage(taskId, nextMsg.text, nextMsg.attachments ? [...nextMsg.attachments] : undefined)
      }
    }
  })

  const unsub9 = ipc.onDebugLog((entry) => {
    useDebugStore.getState().addEntry(entry)
    if (entry.category === 'stderr') {
      const text = typeof entry.payload === 'string' ? entry.payload : JSON.stringify(entry.payload)
      if (text.includes('Dynamic registration failed') || text.includes('invalid_redirect_uri')) {
        const knownServers = ['slack', 'figma', 'github', 'notion', 'linear', 'jira', 'atlassian']
        const serverName = entry.mcpServerName
          ?? knownServers.find((s) => text.toLowerCase().includes(s))
          ?? 'unknown'
        useResourceStore.getState().setMcpError(serverName, 'OAuth setup needed — add http://127.0.0.1 as a redirect URI in your OAuth app, or disable it in ~/.lafagent/settings.json')
      }
    }
  })

  const unsub10 = ipc.onSessionInit(({ taskId, sessionId, sessionFile, models, modes, thinkingLevel, availableThinkingLevels }) => {
    // Re-arm plan-mode enforcement: the /plan-guard flag lives in the gate
    // extension's process, so a restarted agent comes back with it off even
    // though the UI still shows plan mode. session_init is the reconnect
    // signal, so this closes that window.
    if (taskId && taskId !== '__probe__') {
      const modeId = useTaskStore.getState().taskModes[taskId] ?? useSettingsStore.getState().currentModeId
      void syncPlanEnforcement(taskId, modeId ?? null)
      // Same lifecycle as the plan guard: behavior toggles live in the agent
      // process and reset on every (re)spawn.
      void syncAgentBehavior(taskId, useSettingsStore.getState().settings)
    }
    // Store the agent CLI session ID for this task
    if (sessionId && taskId && taskId !== '__probe__') {
      const s = useTaskStore.getState()
      useTaskStore.setState({ sessionIds: { ...s.sessionIds, [taskId]: sessionId } })
    }
    // Remember the agent's session file so the thread can be resumed/forked
    // natively (full model context) after a reconnect or app restart.
    if (sessionFile && taskId && taskId !== '__probe__') {
      const state = useTaskStore.getState()
      const task = state.tasks[taskId]
      if (task && task.sessionFile !== sessionFile) {
        useTaskStore.setState({ tasks: { ...state.tasks, [taskId]: { ...task, sessionFile } } })
        state.persistHistory()
      }
    }
    let applied = false
    if (models && typeof models === 'object') {
      const m = models as { availableModels?: Array<{ modelId: string; name: string; description?: string | null }>; currentModelId?: string }
      if (m.availableModels) {
        const settingsState = useSettingsStore.getState()
        const existingModel = settingsState.currentModelId
        const validExistingModel = existingModel && m.availableModels.some((mod) => mod.modelId === existingModel)
        // Fall back to the persisted defaultModel if the existing in-memory id
        // is empty or invalid. Only use the CLI's reported currentModelId as a
        // last resort so the user's stored choice survives a fresh session.
        const persistedDefault = settingsState.settings.defaultModel ?? null
        const validPersistedDefault = persistedDefault && m.availableModels.some((mod) => mod.modelId === persistedDefault)
        let nextModelId: string | null
        if (validExistingModel) nextModelId = existingModel
        else if (validPersistedDefault) nextModelId = persistedDefault
        else nextModelId = m.currentModelId ?? null
        useSettingsStore.setState({
          availableModels: m.availableModels,
          currentModelId: nextModelId,
        })
        // If the CLI's session boots with a different model than the user
        // chose, push the choice through so the next prompt uses the right
        // one. Skip the probe session and any unmatched ids.
        if (taskId !== '__probe__' && nextModelId && nextModelId !== m.currentModelId) {
          ipc.setModel(taskId, nextModelId).catch(() => {})
        }
        applyThinkingLevel(taskId, nextModelId, thinkingLevel, availableThinkingLevels)
        applied = true
      }
    }
    // No model block (or no list in it) — still seed effort from session state.
    if (!applied) applyThinkingLevel(taskId, null, thinkingLevel, availableThinkingLevels)
    if (modes && typeof modes === 'object') {
      const md = modes as { availableModes?: Array<{ id: string; name: string; description?: string | null }>; currentModeId?: string }
      if (md.availableModes) {
        const existingMode = useSettingsStore.getState().currentModeId
        const validExistingMode = existingMode && md.availableModes.some((m) => m.id === existingMode)
        useSettingsStore.setState({
          availableModes: md.availableModes,
          ...(validExistingMode ? {} : { currentModeId: md.currentModeId ?? null }),
        })
        if (validExistingMode && existingMode !== md.currentModeId && taskId !== '__probe__') {
          ipc.setMode(taskId, existingMode).catch(() => {})
        }
      }
    }
  })

  const unsub11 = ipc.onCommandsUpdate(({ commands, mcpServers }) => {
    // mcpServers may arrive as a flat array or a grouped object (e.g. { "other": [...] }).
    // Normalize to a flat LiveMcpServer[] so the UI can always .map() over it.
    let flatServers: import('@/stores/settingsStore').LiveMcpServer[] | undefined
    if (mcpServers) {
      if (Array.isArray(mcpServers)) {
        flatServers = mcpServers
      } else if (typeof mcpServers === 'object') {
        flatServers = Object.values(mcpServers as Record<string, import('@/stores/settingsStore').LiveMcpServer[]>).flat()
      }
    }
    useSettingsStore.setState({
      availableCommands: commands,
      ...(flatServers ? { liveMcpServers: flatServers } : {}),
    })
  })

  const unsub12 = ipc.onTaskError(({ taskId, message, action }) => {
    // A task_error can arrive with no message (an agent-side error whose text
    // the backend couldn't classify). Interpolating that produced a literal
    // "\u26a0\ufe0f undefined" card. Fall back to a real sentence instead.
    const text = (typeof message === 'string' && message.trim().length > 0)
      ? message
      : msg('The agent hit an error. You can send a new message to continue.')
    const errorMsg: import('@/types').TaskMessage = {
        role: 'system' as const,
        content: `\u26a0\ufe0f ${text}`,
        timestamp: new Date().toISOString(),
        // Carried so the error card can offer the matching button rather than
        // leaving the user to work out where to go.
        ...(action && action !== 'none' ? { errorAction: action } : {}),
    }
    useTaskStore.setState((s) => {
      const task = s.tasks[taskId]
      if (!task) return s
      // Drop the dispatch snapshot — the turn is dead.
      const { [taskId]: _drop, ...remainingSnapshots } = s.dispatchSnapshots
      return {
        tasks: { ...s.tasks, [taskId]: { ...task, messages: [...task.messages, errorMsg], status: 'error' } },
        streamingChunks: { ...s.streamingChunks, [taskId]: '' },
        thinkingChunks: { ...s.thinkingChunks, [taskId]: '' },
        liveToolCalls: { ...s.liveToolCalls, [taskId]: [] },
        liveToolSplits: { ...s.liveToolSplits, [taskId]: [] },
        dispatchSnapshots: remainingSnapshots,
      }
    })
    // The error note must survive a restart like any other message, and the
    // turn claim must not linger — an errored turn never reaches turn_end,
    // and a stale claim would double-count this thread's next turn.
    if (useTaskStore.getState().tasks[taskId]) {
      attempt(msg('Could not save the conversation'), threadDb.saveMessage(taskId, errorMsg))
    }
    releaseTurn(taskId)
    // Notify on errors while backgrounded
    const errSettings = useSettingsStore.getState().settings
    const errTask = useTaskStore.getState().tasks[taskId]
    if (errTask) {
      sendTaskNotification({
        task: errTask,
        status: 'error',
        isNotificationsEnabled: errSettings.notifications ?? true,
        isSoundEnabled: errSettings.soundNotifications ?? true,
        onNotified: (tid) => {
          useTaskStore.setState((s) => ({
            notifiedTaskIds: s.notifiedTaskIds.includes(tid) ? s.notifiedTaskIds : [...s.notifiedTaskIds, tid],
          }))
        },
      })
    }
  })

  const unsub13 = ipc.onCompactionStatus(({ taskId, status }) => {
    const mapped = status === 'started' ? 'compacting'
      : status === 'completed' ? 'completed'
      : status === 'failed' ? 'failed'
      : null
    if (mapped) {
      useTaskStore.getState().updateCompactionStatus(taskId, mapped as import('@/types').CompactionStatus)
    }
  })

  const unsub14 = ipc.onRefineStatus(({ taskId, status, appliedCount, error }) => {
    // /refine passes through as a session command; this is the only place its
    // outcome becomes visible. Persist the note like any other message —
    // with the thin JSON index, SQLite is its only durable home.
    const task = useTaskStore.getState().tasks[taskId]
    if (!task) return
    const content = status === 'completed'
      ? msg('✅ Refinement applied ({count} edit(s))', { count: String(appliedCount ?? 0) })
      : msg('⚠️ Refinement failed: {error}', { error: error ?? msg('unknown error') })
    const note: import('@/types').TaskMessage = {
      role: 'system' as const,
      content,
      timestamp: new Date().toISOString(),
    }
    useTaskStore.setState((s) => {
      const current = s.tasks[taskId]
      if (!current) return s
      return { tasks: { ...s.tasks, [taskId]: { ...current, messages: [...current.messages, note] } } }
    })
    attempt(msg('Could not save the conversation'), threadDb.saveMessage(taskId, note))
  })

  const unsub15 = ipc.onThinkingLevelChanged(({ taskId, level }) => {
    // The agent can change its own reasoning effort (goal autonomy, cycling);
    // without this the UI's notion of the level silently goes stale.
    if (level) useTaskStore.getState().setThinkingLevel(taskId, level)
  })

  const unsub16 = ipc.onThinkingLevels(({ taskId, levels, current }) => {
    // Emitted after a model switch. Which levels are legal is a property of the
    // model, so the picker has to re-learn them or it offers rejected options.
    if (Array.isArray(levels) && levels.length > 0) {
      useTaskStore.getState().setAvailableThinkingLevels(taskId, levels)
    }
    if (current) useTaskStore.getState().setThinkingLevel(taskId, current)
  })

  const unsub17 = ipc.onSessionNameChanged(({ taskId, name }) => {
    // `/name` (and agent-initiated renames) only reported "Session renamed"
    // before — the sidebar kept the stale client-side name forever.
    if (!name) return
    const task = useTaskStore.getState().tasks[taskId]
    if (task && task.name !== name) useTaskStore.getState().renameTask(taskId, name)
  })

  return () => {
    clearInterval(watchdogInterval)
    unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub7(); unsub8(); unsub9(); unsub10(); unsub11(); unsub12()
    unsub13(); unsub14(); unsub15(); unsub16(); unsub17()
  }
}
