import { memo, useMemo } from 'react'
import { useTaskStore } from '@/stores/taskStore'
import type { TaskMessage, ToolCall } from '@/types'
import { TaskListDisplay, isTaskListToolCall } from './TaskListDisplay'

const EMPTY_TOOL_CALLS: ToolCall[] = []

interface StickyTaskListProps {
  taskId: string | null
}

// Per-message cache of the task-list-only subset, keyed by the message's
// `toolCalls` array reference. Persisted threads keep the same array
// reference across re-renders, so this cache means we walk a message's
// tool calls exactly once.
const _perMessageCache = new WeakMap<readonly ToolCall[], ToolCall[]>()

function taskListCallsFor(toolCalls: readonly ToolCall[] | undefined): ToolCall[] | null {
  if (!toolCalls || toolCalls.length === 0) return null
  const cached = _perMessageCache.get(toolCalls)
  if (cached) return cached.length > 0 ? cached : null
  const out: ToolCall[] = []
  for (const tc of toolCalls) {
    if (isTaskListToolCall(tc)) out.push(tc)
  }
  _perMessageCache.set(toolCalls, out)
  return out.length > 0 ? out : null
}

/**
 * Renders the latest aggregated task-list state for the active thread,
 * pinned just above the chat input. Subscribes to both persisted message
 * tool calls and the in-flight `liveToolCalls` so updates during a turn
 * (`create` → `add` → `complete`) keep mutating one card rather than
 * spawning a new card per inline tool entry.
 *
 * Renders `null` when the thread has no task-list activity, so it doesn't
 * take up space until the agent actually creates one.
 */
export const StickyTaskList = memo(function StickyTaskList({ taskId }: StickyTaskListProps) {
  const messages = useTaskStore((s) => taskId ? s.tasks[taskId]?.messages : undefined)
  const liveToolCalls = useTaskStore((s) =>
    taskId ? s.liveToolCalls[taskId] ?? EMPTY_TOOL_CALLS : EMPTY_TOOL_CALLS,
  )

  // Walk only the task-list tool calls in chronological order. Each
  // message's filtered list is memoized via WeakMap so repeated renders
  // (which happen on every streaming chunk) don't re-scan history.
  const allTaskListCalls = useMemo(() => {
    const out: ToolCall[] = []
    if (messages) {
      for (const msg of messages as TaskMessage[]) {
        const filtered = taskListCallsFor(msg.toolCalls)
        if (filtered) out.push(...filtered)
      }
    }
    const liveFiltered = taskListCallsFor(liveToolCalls)
    if (liveFiltered) out.push(...liveFiltered)
    return out
  }, [messages, liveToolCalls])

  if (allTaskListCalls.length === 0) return null

  return (
    <div className="shrink-0 px-4 pt-2 pb-1 sm:px-6" data-testid="sticky-task-list">
      <div className="mx-auto w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl">
        <TaskListDisplay allToolCalls={allTaskListCalls} compact />
      </div>
    </div>
  )
})
