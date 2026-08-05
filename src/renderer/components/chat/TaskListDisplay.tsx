import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconCircleCheck, IconCircle, IconListCheck,
  IconChevronDown, IconChevronRight,
} from '@tabler/icons-react'
import type { ToolCall } from '@/types'

interface TaskItem {
  id: string
  completed: boolean
  task_description: string
}

/** Extract task list from a tool call's rawOutput */
function extractTasks(rawOutput: unknown): TaskItem[] | null {
  if (!rawOutput || typeof rawOutput !== 'object') return null
  const out = rawOutput as Record<string, unknown>
  // Direct shape: { tasks: [...] }
  if (Array.isArray(out.tasks)) return out.tasks as TaskItem[]
  // Nested shape: { items: [{ Json: { tasks: [...] } }] }
  if (Array.isArray(out.items)) {
    const first = out.items[0] as Record<string, unknown> | undefined
    if (first?.Json && typeof first.Json === 'object') {
      const json = first.Json as Record<string, unknown>
      if (Array.isArray(json.tasks)) return json.tasks as TaskItem[]
    }
  }
  return null
}

function extractDescription(rawOutput: unknown): string | null {
  if (!rawOutput || typeof rawOutput !== 'object') return null
  const out = rawOutput as Record<string, unknown>
  if (typeof out.description === 'string' && out.description) return out.description
  if (Array.isArray(out.items)) {
    const first = out.items[0] as Record<string, unknown> | undefined
    if (first?.Json && typeof first.Json === 'object') {
      const json = first.Json as Record<string, unknown>
      if (typeof json.description === 'string' && json.description) return json.description
    }
  }
  return null
}

/** Check if a tool call is a task list operation */
export function isTaskListToolCall(tc: ToolCall): boolean {
  if (!tc.rawInput || typeof tc.rawInput !== 'object') return false
  const input = tc.rawInput as Record<string, unknown>
  return input.command === 'create' || input.command === 'complete' || input.command === 'add' || input.command === 'list'
}

/** Extract completed_task_ids from a tool call's rawInput or rawOutput */
function extractCompletedIds(raw: unknown): string[] | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (Array.isArray(obj.completed_task_ids)) return obj.completed_task_ids as string[]
  if (Array.isArray(obj.items)) {
    const first = obj.items[0] as Record<string, unknown> | undefined
    if (first?.Json && typeof first.Json === 'object') {
      const json = first.Json as Record<string, unknown>
      if (Array.isArray(json.completed_task_ids)) return json.completed_task_ids as string[]
    }
  }
  return null
}

/**
 * Aggregate the latest task state from all task-list tool calls in the group.
 * Later tool calls (complete/add) override earlier ones by task id.
 * Handles complete commands that return only completed_task_ids without a tasks array.
 */
export function aggregateLatestTasks(allToolCalls: ToolCall[]): { tasks: TaskItem[]; description: string | null } {
  const taskMap = new Map<string, TaskItem>()
  let description: string | null = null

  for (const tc of allToolCalls) {
    if (!isTaskListToolCall(tc)) continue
    const tasks = extractTasks(tc.rawOutput)
    const desc = extractDescription(tc.rawOutput)
    if (desc) description = desc
    if (tasks && tasks.length > 0) {
      for (const t of tasks) {
        taskMap.set(t.id, t)
      }
    } else {
      // Handle complete commands — completed_task_ids may be in rawInput or rawOutput
      const completedIds = extractCompletedIds(tc.rawOutput) ?? extractCompletedIds(tc.rawInput)
      if (completedIds) {
        for (const id of completedIds) {
          const existing = taskMap.get(id)
          if (existing) {
            taskMap.set(id, { ...existing, completed: true })
          }
        }
      }
    }
  }

  // Preserve insertion order (create order) for display
  return { tasks: Array.from(taskMap.values()), description }
}

interface TaskListDisplayProps {
  allToolCalls: ToolCall[]
  /** When true, start collapsed and cap the expanded body at ~3 tasks with scroll. */
  compact?: boolean
}

/** Max height for the compact task list body (fits content up to this cap). */
const COMPACT_MAX_HEIGHT_PX = 600

export const TaskListDisplay = memo(function TaskListDisplay({ allToolCalls, compact = false }: TaskListDisplayProps) {
  const [expanded, setExpanded] = useState(false)

  const { tasks, description } = useMemo(() => aggregateLatestTasks(allToolCalls), [allToolCalls])

  // When new tasks arrive (or the agent ticks one off), scroll the next
  // incomplete task into view inside the compact scroll viewport so the
  // "currently working on" row stays visible.
  const scrollRef = useRef<HTMLDivElement>(null)
  const firstIncompleteIndex = useMemo(
    () => tasks.findIndex((t) => !t.completed),
    [tasks],
  )
  useEffect(() => {
    if (!compact || !expanded) return
    if (firstIncompleteIndex < 0) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-task-index="${firstIncompleteIndex}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [compact, expanded, firstIncompleteIndex])

  if (!tasks.length) return null

  const completed = tasks.filter((t) => t.completed).length

  return (
    <div className="rounded-lg border border-border/60 bg-card/60">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-accent/5"
      >
        {expanded ? (
          <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" />
        ) : (
          <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <IconListCheck className="size-3.5 shrink-0 text-primary" />
        <span className="flex-1 truncate text-[13px] font-medium text-muted-foreground">
          {description ?? 'Task list'}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {completed}/{tasks.length}
        </span>
      </button>
      {expanded && (
        <div
          ref={scrollRef}
          className="overflow-y-auto border-t border-border/50 px-3 py-2"
          style={compact ? { maxHeight: `${COMPACT_MAX_HEIGHT_PX}px` } : undefined}
        >
          {tasks.map((task, idx) => (
            <div
              key={task.id}
              data-task-index={idx}
              className="flex items-start gap-2 px-1.5 py-1"
            >
              {task.completed
                ? <IconCircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                : <IconCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              }
              <span className={`text-[13px] leading-[1.6] ${task.completed ? 'text-muted-foreground line-through' : 'text-foreground/85'}`}>
                {task.task_description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
