import { memo, useState, useMemo } from 'react'
import {
  IconChevronDown, IconChevronRight, IconCheck, IconX, IconBolt, IconPlayerStop,
} from '@tabler/icons-react'
import type { ToolCall } from '@/types'
import { ToolCallEntry } from './ToolCallEntry'
import { isTaskListToolCall } from './TaskListDisplay'
import { SubagentDisplay, isSubagentToolCall } from './SubagentDisplay'

const MAX_VISIBLE_DEFAULT = 6

interface ToolCallDisplayProps {
  toolCalls: ToolCall[]
  /**
   * When true, the calls are rendered in their inline-with-prose context
   * (one or two tool entries between paragraphs). The aggregate header and
   * truncation chrome are dropped because they make a single tool call feel
   * like a heavyweight section break.
   */
  inline?: boolean
}

export const ToolCallDisplay = memo(function ToolCallDisplay({ toolCalls, inline = false }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)

  if (!toolCalls.length) return null

  const { completedCount, runningCount, failedCount, cancelledCount } = useMemo(() => {
    let completed = 0, running = 0, failed = 0, cancelled = 0
    for (const tc of toolCalls) {
      if (tc.status === 'completed') completed++
      else if (tc.status === 'in_progress') running++
      else if (tc.status === 'failed') failed++
      else if (tc.status === 'cancelled') cancelled++
    }
    return { completedCount: completed, runningCount: running, failedCount: failed, cancelledCount: cancelled }
  }, [toolCalls])

  const hasSubagent = useMemo(() => toolCalls.some(isSubagentToolCall), [toolCalls])

  // Inline layout: render each tool entry directly, no aggregate header.
  if (inline) {
    const visibleInline = toolCalls.filter((tc) => !isTaskListToolCall(tc))
    if (visibleInline.length === 0 && !hasSubagent) return null
    return (
      <div data-testid="tool-call-display" data-inline="true" className="space-y-0.5">
        {visibleInline.map((tc) => (
          <ToolCallEntry key={tc.toolCallId} toolCall={tc} />
        ))}
        {hasSubagent && (
          <div className="pt-1">
            <SubagentDisplay allToolCalls={toolCalls} />
          </div>
        )}
      </div>
    )
  }

  const visibleCalls = showAll ? toolCalls : toolCalls.slice(0, MAX_VISIBLE_DEFAULT)
  const hasMore = toolCalls.length > MAX_VISIBLE_DEFAULT

  // Determine header accent color based on overall status
  const headerAccent = runningCount > 0
    ? 'border-l-blue-500/60'
    : failedCount > 0
      ? 'border-l-red-500/60'
      : cancelledCount > 0 && completedCount === 0
        ? 'border-l-orange-500/60'
        : 'border-l-emerald-500/60'

  return (
    <div data-testid="tool-call-display" className={`rounded-lg border border-border/50 border-l-[3px] ${headerAccent} bg-card/80`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/5"
        style={{ fontSize: 'calc(var(--chat-font-size, 15px) - 2px)' }}
      >
        {expanded ? (
          <IconChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
        ) : (
          <IconChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
        )}
        <span className="flex size-5 items-center justify-center rounded-md bg-amber-500/10">
          <IconBolt className="size-3 text-amber-500" />
        </span>
        <span className="font-medium text-foreground/80">
          {runningCount > 0 ? 'Working' : 'Tool calls'}
        </span>
        <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {toolCalls.length}
        </span>

        <div className="flex-1" />

        {/* Status summary pills */}
        {runningCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-400">
            <span className="relative flex size-3 items-center justify-center">
              <svg viewBox="0 0 16 16" className="absolute inset-0 animate-spin" style={{ animationDuration: '1.2s' }} aria-hidden>
                <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="2" />
                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 6}`} strokeDashoffset={`${2 * Math.PI * 6 * 0.7}`} />
              </svg>
            </span>
            {runningCount} running
          </span>
        )}
        {failedCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-500">
            <IconX className="size-2.5" />
            {failedCount} failed
          </span>
        )}
        {cancelledCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-500">
            <IconPlayerStop className="size-2.5" />
            {cancelledCount} cancelled
          </span>
        )}
        {completedCount > 0 && runningCount === 0 && failedCount === 0 && cancelledCount === 0 && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
            <IconCheck className="size-2.5" strokeWidth={3} />
            Done
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/40 py-0.5">
          {visibleCalls.map((tc) => (
            <ToolCallEntry key={tc.toolCallId} toolCall={tc} />
          ))}
          {hasMore && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full px-3 py-1.5 text-[11px] font-medium text-primary/70 transition-colors hover:text-primary"
            >
              Show {toolCalls.length - MAX_VISIBLE_DEFAULT} more…
            </button>
          )}
        </div>
      )}

      {hasSubagent && (
        <div className={expanded ? 'px-1.5 pb-1.5' : 'border-t border-border/40 px-1.5 py-1.5'}>
          <SubagentDisplay allToolCalls={toolCalls} />
        </div>
      )}
    </div>
  )
})
