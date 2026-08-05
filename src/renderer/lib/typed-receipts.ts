/**
 * Typed Receipts — Structured signals for async operation completion.
 *
 * Instead of polling or guessing when async operations complete, the backend
 * emits typed receipts that the frontend subscribes to. This enables:
 *   - Deterministic UI updates (update only when work is done)
 *   - Clean separation between "work happened" and "UI should update"
 *   - Testable async coordination without timers
 *
 * Receipt types map to meaningful milestones in the app lifecycle.
 */

// ── Receipt types ─────────────────────────────────────────────────

export interface DiffReadyReceipt {
  readonly type: 'diff.ready'
  readonly taskId: string
  readonly fileCount: number
  readonly additions: number
  readonly deletions: number
  readonly timestamp: number
}

export interface GitCommittedReceipt {
  readonly type: 'git.committed'
  readonly taskId: string
  readonly commitHash: string
  readonly message: string
  readonly timestamp: number
}

export interface WorktreeCreatedReceipt {
  readonly type: 'worktree.created'
  readonly taskId: string
  readonly worktreePath: string
  readonly branch: string
  readonly timestamp: number
}

export interface WorktreeRemovedReceipt {
  readonly type: 'worktree.removed'
  readonly taskId: string
  readonly worktreePath: string
  readonly timestamp: number
}

export interface TurnQuiescedReceipt {
  readonly type: 'turn.quiesced'
  readonly taskId: string
  readonly messageCount: number
  readonly toolCallCount: number
  readonly timestamp: number
}

export interface SessionReadyReceipt {
  readonly type: 'session.ready'
  readonly taskId: string
  readonly timestamp: number
}

export interface CompactionCompleteReceipt {
  readonly type: 'compaction.complete'
  readonly taskId: string
  readonly previousSize: number
  readonly newSize: number
  readonly timestamp: number
}

export type Receipt =
  | DiffReadyReceipt
  | GitCommittedReceipt
  | WorktreeCreatedReceipt
  | WorktreeRemovedReceipt
  | TurnQuiescedReceipt
  | SessionReadyReceipt
  | CompactionCompleteReceipt

export type ReceiptType = Receipt['type']

// ── Receipt Bus ───────────────────────────────────────────────────

type ReceiptListener<T extends Receipt = Receipt> = (receipt: T) => void
type UnsubscribeFn = () => void

export interface ReceiptBus {
  /** Publish a receipt to all matching subscribers. */
  publish: (receipt: Receipt) => void
  /** Subscribe to all receipts. */
  subscribeAll: (listener: ReceiptListener) => UnsubscribeFn
  /** Subscribe to receipts of a specific type. */
  subscribe: <T extends ReceiptType>(
    type: T,
    listener: ReceiptListener<Extract<Receipt, { type: T }>>,
  ) => UnsubscribeFn
  /** Subscribe to receipts for a specific task. */
  subscribeTask: (
    taskId: string,
    listener: ReceiptListener,
  ) => UnsubscribeFn
  /** Wait for the next receipt matching a predicate (with timeout). */
  waitFor: (
    predicate: (receipt: Receipt) => boolean,
    timeoutMs?: number,
  ) => Promise<Receipt>
  /** Dispose the bus and clear all subscriptions. */
  dispose: () => void
}

export function createReceiptBus(): ReceiptBus {
  const allListeners = new Set<ReceiptListener>()
  const typeListeners = new Map<ReceiptType, Set<ReceiptListener<any>>>()
  const taskListeners = new Map<string, Set<ReceiptListener>>()
  let disposed = false

  const publish = (receipt: Receipt): void => {
    if (disposed) return

    // Snapshot the listener sets so an unsubscribe triggered by a listener
    // (e.g. `waitFor` removing itself) doesn't mutate the iteration.
    // We invoke listeners synchronously so callers that expect the receipt
    // to land in the same tick (e.g. test code that publishes then asserts
    // on a state update) still work, but we catch and surface failures via
    // console.warn so one bad subscriber can't take down the whole bus.
    const all = Array.from(allListeners)
    for (const listener of all) {
      try { listener(receipt) } catch (err) {
        console.warn('[ReceiptBus] all-listener threw for', receipt.type, err)
      }
    }

    // Notify type-specific listeners
    const typed = typeListeners.get(receipt.type)
    if (typed) {
      for (const listener of Array.from(typed)) {
        try { listener(receipt) } catch (err) {
          console.warn('[ReceiptBus] type-listener threw for', receipt.type, err)
        }
      }
    }

    // Notify task-specific listeners
    const taskId = 'taskId' in receipt ? receipt.taskId : null
    if (taskId) {
      const taskSubs = taskListeners.get(taskId)
      if (taskSubs) {
        for (const listener of Array.from(taskSubs)) {
          try { listener(receipt) } catch (err) {
            console.warn('[ReceiptBus] task-listener threw for', taskId, receipt.type, err)
          }
        }
      }
    }
  }

  const subscribeAll = (listener: ReceiptListener): UnsubscribeFn => {
    allListeners.add(listener)
    return () => { allListeners.delete(listener) }
  }

  const subscribe = <T extends ReceiptType>(
    type: T,
    listener: ReceiptListener<Extract<Receipt, { type: T }>>,
  ): UnsubscribeFn => {
    let set = typeListeners.get(type)
    if (!set) {
      set = new Set()
      typeListeners.set(type, set)
    }
    set.add(listener)
    return () => { set!.delete(listener) }
  }

  const subscribeTask = (taskId: string, listener: ReceiptListener): UnsubscribeFn => {
    let set = taskListeners.get(taskId)
    if (!set) {
      set = new Set()
      taskListeners.set(taskId, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (set!.size === 0) taskListeners.delete(taskId)
    }
  }

  const waitFor = (
    predicate: (receipt: Receipt) => boolean,
    timeoutMs = 30_000,
  ): Promise<Receipt> => {
    return new Promise<Receipt>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null

      const unsub = subscribeAll((receipt) => {
        if (predicate(receipt)) {
          if (timer) clearTimeout(timer)
          unsub()
          resolve(receipt)
        }
      })

      timer = setTimeout(() => {
        unsub()
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })
  }

  const dispose = (): void => {
    disposed = true
    allListeners.clear()
    typeListeners.clear()
    taskListeners.clear()
  }

  return { publish, subscribeAll, subscribe, subscribeTask, waitFor, dispose }
}

// ── Singleton ─────────────────────────────────────────────────────

let _bus: ReceiptBus | null = null

export function getReceiptBus(): ReceiptBus {
  if (!_bus) {
    _bus = createReceiptBus()
  }
  return _bus
}

/** Reset the singleton (for testing). */
export function resetReceiptBus(): void {
  if (_bus) {
    _bus.dispose()
    _bus = null
  }
}

// ── Helper: Create receipts from IPC events ───────────────────────

export function createTurnQuiescedReceipt(
  taskId: string,
  messageCount: number,
  toolCallCount: number,
): TurnQuiescedReceipt {
  return {
    type: 'turn.quiesced',
    taskId,
    messageCount,
    toolCallCount,
    timestamp: Date.now(),
  }
}

export function createDiffReadyReceipt(
  taskId: string,
  stats: { fileCount: number; additions: number; deletions: number },
): DiffReadyReceipt {
  return {
    type: 'diff.ready',
    taskId,
    ...stats,
    timestamp: Date.now(),
  }
}

export function createSessionReadyReceipt(taskId: string): SessionReadyReceipt {
  return {
    type: 'session.ready',
    taskId,
    timestamp: Date.now(),
  }
}
