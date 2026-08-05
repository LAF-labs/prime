/**
 * Tool call collapsing logic.
 *
 * Consecutive tool calls with the same identity (same tool, same file target)
 * are collapsed into a single entry to reduce visual noise in the timeline.
 *
 * For example, multiple "edit file" calls to the same file during a single
 * turn are shown as one entry with a count badge.
 */

import type { ToolCall } from '@/types'

export interface CollapsedToolGroup {
  /** The representative tool call (latest in the group) */
  representative: ToolCall
  /** All tool calls in this group */
  calls: ToolCall[]
  /** Collapse key used for grouping */
  key: string
}

/**
 * Derive a collapse key for a tool call.
 * Tool calls with the same key will be grouped together.
 *
 * Returns null if the tool call should not be collapsed.
 */
export function deriveCollapseKey(tc: ToolCall): string | null {
  // Don't collapse in-progress/pending/cancelled tool calls — they need individual visibility
  if (tc.status === 'in_progress' || tc.status === 'pending' || tc.status === 'cancelled') return null

  // Group by kind + normalized title
  const kind = tc.kind ?? ''
  const title = normalizeToolTitle(tc.title ?? '')

  if (!kind && !title) return null

  // For file operations, include the file path for finer grouping
  const filePath = extractFilePath(tc)
  if (filePath) {
    return `${kind}:${filePath}`
  }

  return `${kind}:${title}`
}

/**
 * Normalize a tool title for comparison purposes.
 * Strips trailing "complete/completed" suffixes and normalizes whitespace.
 */
function normalizeToolTitle(title: string): string {
  return title
    .replace(/\s+(?:complete|completed)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Extract a file path from a tool call's content items or locations.
 */
function extractFilePath(tc: ToolCall): string | null {
  // Check locations first (structured data)
  if (tc.locations && tc.locations.length > 0) {
    return tc.locations[0].path
  }
  // Check content items for path fields
  if (tc.content) {
    for (const item of tc.content) {
      if (item.path) return item.path
      // Check text content for file path patterns
      if (item.text) {
        const match = item.text.match(/(?:^|\s)((?:[\w./-]+\/)?[\w.-]+\.\w+)/)
        if (match) return match[1]
      }
    }
  }
  return null
}

/**
 * Collapse consecutive tool calls with the same collapse key into groups.
 *
 * Only collapses completed/failed tool calls that are adjacent. In-progress/pending
 * calls are always shown individually.
 */
export function collapseToolCalls(toolCalls: ToolCall[]): CollapsedToolGroup[] {
  if (toolCalls.length === 0) return []

  const groups: CollapsedToolGroup[] = []
  let currentGroup: CollapsedToolGroup | null = null

  for (const tc of toolCalls) {
    const key = deriveCollapseKey(tc)

    if (key === null) {
      // Non-collapsible: flush current group and add as standalone
      if (currentGroup) {
        groups.push(currentGroup)
        currentGroup = null
      }
      groups.push({
        representative: tc,
        calls: [tc],
        key: `standalone:${tc.toolCallId}`,
      })
      continue
    }

    if (currentGroup && currentGroup.key === key) {
      // Same group: merge
      currentGroup.calls.push(tc)
      currentGroup.representative = tc // latest becomes representative
    } else {
      // Different group: flush and start new
      if (currentGroup) {
        groups.push(currentGroup)
      }
      currentGroup = {
        representative: tc,
        calls: [tc],
        key,
      }
    }
  }

  // Flush final group
  if (currentGroup) {
    groups.push(currentGroup)
  }

  return groups
}

/**
 * Get a display count for a collapsed group.
 * Returns null if the group has only one item (no badge needed).
 */
export function getGroupCount(group: CollapsedToolGroup): number | null {
  return group.calls.length > 1 ? group.calls.length : null
}

/**
 * Flatten collapsed groups back to individual tool calls.
 * Useful when the user expands a collapsed group.
 */
export function expandGroup(group: CollapsedToolGroup): ToolCall[] {
  return group.calls
}
