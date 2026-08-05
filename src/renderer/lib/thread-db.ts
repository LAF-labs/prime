/**
 * SQLite-backed thread persistence layer.
 *
 * Replaces the JSON-based history-store as the primary persistence mechanism.
 *
 * Design:
 * - Per-message rows for granular persistence — each message is
 *   saved individually as it arrives, so a crash mid-turn only loses the
 *   in-flight streaming chunk, not the entire conversation.
 * - Simple schema without event-sourcing complexity.
 * - Thread metadata in a separate row for fast sidebar listing.
 * - Full-text search via FTS5 (already in our Rust backend).
 * - The JSON history-store is retained as a fallback/backup layer.
 */
import type { AgentTask, TaskMessage, ToolCall, ToolCallSplit } from '@/types'
import { ipc } from '@/lib/ipc'

// ── Types matching the Rust backend ──────────────────────────────

interface DbThread {
  id: string
  name: string
  workspace: string
  status: string
  createdAt: string
  updatedAt: string
  parentThreadId?: string
  autoApprove: boolean
  metadata?: unknown
}

interface DbMessage {
  id: number
  threadId: string
  role: string
  content: string
  timestamp: string
  thinking?: string
  toolCalls?: unknown
}

// ── Conversion helpers ───────────────────────────────────────────

/** Max size for raw tool call fields to prevent DB bloat */
const MAX_RAW_FIELD_CHARS = 64 * 1024

function truncateRawField(value: unknown): unknown {
  if (value === undefined || value === null) return value
  if (typeof value === 'string') {
    return value.length > MAX_RAW_FIELD_CHARS
      ? `${value.slice(0, MAX_RAW_FIELD_CHARS)}\n…(truncated for persistence)`
      : value
  }
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length <= MAX_RAW_FIELD_CHARS) return value
  } catch { /* fall through */ }
  return '[truncated for persistence]'
}

function truncateToolCall(tc: ToolCall): ToolCall {
  if (tc.rawInput === undefined && tc.rawOutput === undefined) return tc
  const rawInput = truncateRawField(tc.rawInput)
  const rawOutput = truncateRawField(tc.rawOutput)
  if (rawInput === tc.rawInput && rawOutput === tc.rawOutput) return tc
  return { ...tc, ...(rawInput !== undefined ? { rawInput } : {}), ...(rawOutput !== undefined ? { rawOutput } : {}) }
}

function taskMessageToDbMessage(threadId: string, msg: TaskMessage): DbMessage {
  const toolCalls = msg.toolCalls?.map(truncateToolCall)
  // Pack toolCalls and toolCallSplits together in the tool_calls JSON column
  const toolData = (toolCalls && toolCalls.length > 0) || (msg.toolCallSplits && msg.toolCallSplits.length > 0)
    ? { toolCalls: toolCalls ?? [], toolCallSplits: msg.toolCallSplits ?? [] }
    : undefined
  return {
    id: 0, // auto-increment on insert
    threadId,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    thinking: msg.thinking,
    toolCalls: toolData,
  }
}

function dbMessageToTaskMessage(msg: DbMessage): TaskMessage {
  const toolData = msg.toolCalls as { toolCalls?: ToolCall[]; toolCallSplits?: ToolCallSplit[] } | null
  return {
    role: msg.role as TaskMessage['role'],
    content: msg.content,
    timestamp: msg.timestamp,
    ...(msg.thinking ? { thinking: msg.thinking } : {}),
    ...(toolData?.toolCalls && toolData.toolCalls.length > 0 ? { toolCalls: toolData.toolCalls } : {}),
    ...(toolData?.toolCallSplits && toolData.toolCallSplits.length > 0 ? { toolCallSplits: toolData.toolCallSplits } : {}),
  }
}

function taskToDbThread(task: AgentTask): DbThread {
  return {
    id: task.id,
    name: task.name,
    workspace: task.workspace,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: new Date().toISOString(),
    parentThreadId: task.parentTaskId,
    autoApprove: false,
    metadata: {
      ...(task.worktreePath ? { worktreePath: task.worktreePath } : {}),
      ...(task.originalWorkspace ? { originalWorkspace: task.originalWorkspace } : {}),
      ...(task.projectId ? { projectId: task.projectId } : {}),
    },
  }
}

// ── Public API ───────────────────────────────────────────────────

/** Check if the SQLite thread DB is available (backend responds) */
export async function isAvailable(): Promise<boolean> {
  try {
    await ipc.threadDbStats()
    return true
  } catch {
    return false
  }
}

/** Save a thread's metadata to the SQLite database */
export async function saveThread(task: AgentTask): Promise<void> {
  const dbThread = taskToDbThread(task)
  await ipc.threadDbSave(dbThread)
}

/** Save a single message to the SQLite database (incremental persistence).
 *  Ensures the parent thread exists in SQLite before inserting (FK constraint).
 *  Callers are responsible for not calling this multiple times for the same
 *  message. The function is idempotent at the application level because:
 *  - User messages are saved once on send (ChatPanel)
 *  - Assistant messages are saved once on turn end (listeners)
 *  - Migration checks for existing threads before saving
 */
export async function saveMessage(threadId: string, msg: TaskMessage): Promise<number> {
  const dbMsg = taskMessageToDbMessage(threadId, msg)
  try {
    return await ipc.threadDbSaveMessage(dbMsg)
  } catch (err) {
    // If the insert failed due to FK constraint (thread doesn't exist yet),
    // create a minimal thread row and retry. This handles the case where
    // saveMessage is called before persistHistory has saved the thread metadata.
    const errStr = String(err)
    if (errStr.includes('FOREIGN KEY') || errStr.includes('foreign key')) {
      await ipc.threadDbSave({
        id: threadId,
        name: '',
        workspace: '',
        status: 'running',
        createdAt: msg.timestamp,
        updatedAt: msg.timestamp,
        autoApprove: false,
      })
      return ipc.threadDbSaveMessage(dbMsg)
    }
    throw err
  }
}

/** Save all messages for a thread (batch — used for initial sync from JSON) */
export async function saveAllMessages(threadId: string, messages: TaskMessage[]): Promise<void> {
  // Save messages sequentially to preserve order (auto-increment IDs)
  for (const msg of messages) {
    await saveMessage(threadId, msg)
  }
}

/** Save a complete thread (metadata + all messages) */
export async function saveFullThread(task: AgentTask): Promise<void> {
  await saveThread(task)
  // Only save messages if the thread has any
  if (task.messages.length > 0) {
    await saveAllMessages(task.id, task.messages)
  }
}

/** Load a thread's metadata from SQLite */
export async function loadThread(threadId: string): Promise<DbThread | null> {
  return ipc.threadDbLoad(threadId)
}

/** Load all messages for a thread from SQLite */
export async function loadMessages(threadId: string): Promise<TaskMessage[]> {
  const dbMessages = await ipc.threadDbMessages(threadId)
  return dbMessages.map(dbMessageToTaskMessage)
}

/** Load a full AgentTask from SQLite (metadata + messages) */
export async function loadFullThread(threadId: string): Promise<AgentTask | null> {
  const dbThread = await loadThread(threadId)
  if (!dbThread) return null

  const messages = await loadMessages(threadId)

  // If the thread metadata exists but has no messages, return null so the
  // caller can fall through to the JSON history store. This handles the case
  // where `persistHistory` saved thread metadata to SQLite but the one-time
  // message migration hasn't completed yet (it's async/best-effort).
  if (messages.length === 0) return null

  const metadata = dbThread.metadata as Record<string, string> | undefined

  return {
    id: dbThread.id,
    name: dbThread.name,
    workspace: dbThread.workspace,
    status: 'completed' as const,
    createdAt: dbThread.createdAt,
    messages,
    isArchived: true,
    ...(dbThread.parentThreadId ? { parentTaskId: dbThread.parentThreadId } : {}),
    ...(metadata?.worktreePath ? { worktreePath: metadata.worktreePath } : {}),
    ...(metadata?.originalWorkspace ? { originalWorkspace: metadata.originalWorkspace } : {}),
    ...(metadata?.projectId ? { projectId: metadata.projectId } : {}),
  }
}

/** List all threads (metadata only, no messages) */
export async function listThreads(): Promise<DbThread[]> {
  return ipc.threadDbList()
}

/** Delete a thread and all its messages */
export async function deleteThread(threadId: string): Promise<void> {
  await ipc.threadDbDelete(threadId)
}

/** Delete ALL threads, messages, and search index data from SQLite */
export async function clearAll(): Promise<void> {
  await ipc.threadDbClearAll()
}

/** Search messages across all threads */
export async function searchMessages(query: string, limit = 20) {
  return ipc.threadDbSearch(query, limit)
}

/** Get database statistics */
export async function getStats() {
  return ipc.threadDbStats()
}

// ── Sync: Migrate from JSON history to SQLite ────────────────────

/**
 * One-time migration: reads all threads from the JSON history store and
 * writes them into SQLite. Idempotent — skips threads that already exist.
 */
export async function migrateFromJsonHistory(
  loadThreadsFn: () => Promise<Array<{ id: string; name: string; workspace: string; createdAt: string; messages: Array<{ role: string; content: string; timestamp: string; thinking?: string; toolCalls?: ToolCall[]; toolCallSplits?: ToolCallSplit[] }>; parentTaskId?: string; worktreePath?: string; originalWorkspace?: string; projectId?: string }>>,
): Promise<{ migrated: number; skipped: number; failed: number }> {
  const threads = await loadThreadsFn()
  let migrated = 0
  let skipped = 0
  let failed = 0

  for (const saved of threads) {
    try {
      // Check if already in SQLite
      const existing = await loadThread(saved.id)
      if (existing) {
        skipped++
        continue
      }

      // Save thread metadata
      const dbThread: DbThread = {
        id: saved.id,
        name: saved.name,
        workspace: saved.workspace,
        status: 'completed',
        createdAt: saved.createdAt,
        updatedAt: saved.messages.length > 0
          ? saved.messages[saved.messages.length - 1].timestamp
          : saved.createdAt,
        autoApprove: false,
        metadata: {
          ...(saved.parentTaskId ? { parentTaskId: saved.parentTaskId } : {}),
          ...(saved.worktreePath ? { worktreePath: saved.worktreePath } : {}),
          ...(saved.originalWorkspace ? { originalWorkspace: saved.originalWorkspace } : {}),
          ...(saved.projectId ? { projectId: saved.projectId } : {}),
        },
      }
      await ipc.threadDbSave(dbThread)

      // Save messages
      for (const msg of saved.messages) {
        const taskMsg: TaskMessage = {
          role: msg.role as TaskMessage['role'],
          content: msg.content,
          timestamp: msg.timestamp,
          ...(msg.thinking ? { thinking: msg.thinking } : {}),
          ...(msg.toolCalls && msg.toolCalls.length > 0 ? { toolCalls: msg.toolCalls } : {}),
          ...(msg.toolCallSplits && msg.toolCallSplits.length > 0 ? { toolCallSplits: msg.toolCallSplits } : {}),
        }
        await saveMessage(saved.id, taskMsg)
      }

      migrated++
    } catch (err) {
      console.warn(`[thread-db] Failed to migrate thread ${saved.id}:`, err)
      failed++
    }
  }

  return { migrated, skipped, failed }
}
