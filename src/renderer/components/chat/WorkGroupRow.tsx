import { memo } from 'react'
import { ToolCallDisplay } from './ToolCallDisplay'
import { isTaskListToolCall } from './TaskListDisplay'
import type { WorkRow as WorkRowData } from '@/lib/timeline'

export const WorkGroupRow = memo(function WorkGroupRow({ row }: { row: WorkRowData }) {
  // In inline mode, a work row composed entirely of task-list tool calls
  // is rendered by the StickyTaskList above the chat input instead. Skip
  // the row entirely so we don't leave an empty padded gap between text
  // segments.
  if (row.inline) {
    const allTaskList = row.toolCalls.length > 0 && row.toolCalls.every(isTaskListToolCall)
    if (allTaskList) return null
  }
  return (
    <div className={row.squashed ? 'pb-2.5' : 'pb-4'} data-timeline-row-kind="work">
      <ToolCallDisplay toolCalls={row.toolCalls} inline={row.inline === true} />
    </div>
  )
})
