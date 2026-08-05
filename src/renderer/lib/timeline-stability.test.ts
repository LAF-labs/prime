import { describe, it, expect } from 'vitest'
import { computeStableTimelineRows, EMPTY_STABLE_STATE } from './timeline-stability'
import type { TimelineRow } from './timeline'

describe('computeStableTimelineRows', () => {
  it('returns same state when rows are identical', () => {
    const rows: TimelineRow[] = [
      { kind: 'user-message', id: 'msg-0-user', content: 'hello', timestamp: '2024-01-01' },
      { kind: 'assistant-text', id: 'msg-1-text', content: 'hi', timestamp: '2024-01-01' },
    ]

    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)
    const second = computeStableTimelineRows(rows, first)

    // Same references preserved
    expect(second).toBe(first)
    expect(second.result[0]).toBe(first.result[0])
    expect(second.result[1]).toBe(first.result[1])
  })

  it('preserves unchanged row references when a new row is appended', () => {
    const rows: TimelineRow[] = [
      { kind: 'user-message', id: 'msg-0-user', content: 'hello', timestamp: '2024-01-01' },
      { kind: 'assistant-text', id: 'msg-1-text', content: 'hi', timestamp: '2024-01-01' },
    ]

    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)

    const updatedRows: TimelineRow[] = [
      ...rows,
      { kind: 'working', id: 'working', hasStreamingContent: false },
    ]

    const second = computeStableTimelineRows(updatedRows, first)

    // Existing rows keep their references
    expect(second.result[0]).toBe(first.result[0])
    expect(second.result[1]).toBe(first.result[1])
    // New row is added
    expect(second.result.length).toBe(3)
    // Top-level state is different
    expect(second).not.toBe(first)
  })

  it('replaces row reference when content changes', () => {
    const rows: TimelineRow[] = [
      { kind: 'assistant-text', id: 'live-text', content: 'hel', timestamp: '', isStreaming: true },
    ]

    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)

    const updatedRows: TimelineRow[] = [
      { kind: 'assistant-text', id: 'live-text', content: 'hello world', timestamp: '', isStreaming: true },
    ]

    const second = computeStableTimelineRows(updatedRows, first)

    // Row reference is new because content changed
    expect(second.result[0]).not.toBe(first.result[0])
    expect((second.result[0] as any).content).toBe('hello world')
  })

  it('handles working row hasStreamingContent change', () => {
    const rows: TimelineRow[] = [
      { kind: 'working', id: 'working', hasStreamingContent: false },
    ]

    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)

    const updatedRows: TimelineRow[] = [
      { kind: 'working', id: 'working', hasStreamingContent: true },
    ]

    const second = computeStableTimelineRows(updatedRows, first)
    expect(second.result[0]).not.toBe(first.result[0])
  })

  it('handles empty to non-empty transition', () => {
    const first = computeStableTimelineRows([], EMPTY_STABLE_STATE)
    expect(first).toBe(EMPTY_STABLE_STATE)

    const rows: TimelineRow[] = [
      { kind: 'user-message', id: 'msg-0-user', content: 'hi', timestamp: '2024-01-01' },
    ]
    const second = computeStableTimelineRows(rows, first)
    expect(second.result.length).toBe(1)
  })

  it('handles non-empty to empty transition', () => {
    const rows: TimelineRow[] = [
      { kind: 'user-message', id: 'msg-0-user', content: 'hi', timestamp: '2024-01-01' },
    ]
    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)
    const second = computeStableTimelineRows([], first)
    expect(second.result.length).toBe(0)
    expect(second.byId.size).toBe(0)
  })

  it('handles row removal from the middle', () => {
    const rows: TimelineRow[] = [
      { kind: 'user-message', id: 'msg-0-user', content: 'hello', timestamp: '2024-01-01' },
      { kind: 'working', id: 'working', hasStreamingContent: false },
      { kind: 'assistant-text', id: 'msg-1-text', content: 'hi', timestamp: '2024-01-01' },
    ]

    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)

    // Remove the working row (simulates streaming end)
    const updatedRows: TimelineRow[] = [
      { kind: 'user-message', id: 'msg-0-user', content: 'hello', timestamp: '2024-01-01' },
      { kind: 'assistant-text', id: 'msg-1-text', content: 'hi', timestamp: '2024-01-01' },
    ]

    const second = computeStableTimelineRows(updatedRows, first)
    expect(second.result.length).toBe(2)
    // Preserved rows keep references
    expect(second.result[0]).toBe(first.result[0])
    expect(second.result[1]).toBe(first.result[2]) // was at index 2, now at 1
  })

  it('preserves system-message row when variant unchanged', () => {
    const rows: TimelineRow[] = [
      { kind: 'system-message', id: 'msg-0-system', content: 'Working in worktree', timestamp: '2024-01-01', variant: 'worktree' },
    ]

    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)
    const second = computeStableTimelineRows(rows, first)
    expect(second).toBe(first)
  })

  it('replaces system-message row when variant changes', () => {
    const rows: TimelineRow[] = [
      { kind: 'system-message', id: 'msg-0-system', content: 'info', timestamp: '2024-01-01', variant: 'info' },
    ]
    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)

    const updated: TimelineRow[] = [
      { kind: 'system-message', id: 'msg-0-system', content: 'error!', timestamp: '2024-01-01', variant: 'error' },
    ]
    const second = computeStableTimelineRows(updated, first)
    expect(second.result[0]).not.toBe(first.result[0])
  })

  it('handles rapid streaming updates efficiently', () => {
    // Simulate 100 streaming token updates — only live-text should change
    const baseRows: TimelineRow[] = [
      { kind: 'user-message', id: 'msg-0-user', content: 'hello', timestamp: '2024-01-01' },
      { kind: 'assistant-text', id: 'msg-1-text', content: 'previous response', timestamp: '2024-01-01' },
    ]

    let state = computeStableTimelineRows(baseRows, EMPTY_STABLE_STATE)
    const firstUserRow = state.result[0]
    const firstAssistantRow = state.result[1]

    // Simulate streaming: add live-text row that changes each frame
    for (let i = 0; i < 100; i++) {
      const rows: TimelineRow[] = [
        ...baseRows,
        { kind: 'assistant-text', id: 'live-text', content: 'streaming ' + 'x'.repeat(i), timestamp: '', isStreaming: true },
        { kind: 'working', id: 'working', hasStreamingContent: true },
      ]
      state = computeStableTimelineRows(rows, state)
    }

    // The persisted rows should still be the exact same references
    expect(state.result[0]).toBe(firstUserRow)
    expect(state.result[1]).toBe(firstAssistantRow)
    // The live rows should have the latest content
    expect((state.result[2] as any).content).toBe('streaming ' + 'x'.repeat(99))
  })

  it('handles changed-files row with same toolCalls reference', () => {
    const toolCalls = [{ toolCallId: 'tc1', title: 'Edit', status: 'completed' as const }]
    const rows: TimelineRow[] = [
      { kind: 'changed-files', id: 'msg-0-changed-files', toolCalls },
    ]

    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)
    const second = computeStableTimelineRows(rows, first)
    expect(second).toBe(first)
  })

  it('handles changed-files row with different toolCalls reference', () => {
    const rows1: TimelineRow[] = [
      { kind: 'changed-files', id: 'msg-0-changed-files', toolCalls: [{ toolCallId: 'tc1', title: 'Edit', status: 'completed' as const }] },
    ]
    const first = computeStableTimelineRows(rows1, EMPTY_STABLE_STATE)

    const rows2: TimelineRow[] = [
      { kind: 'changed-files', id: 'msg-0-changed-files', toolCalls: [{ toolCallId: 'tc1', title: 'Edit', status: 'completed' as const }] },
    ]
    const second = computeStableTimelineRows(rows2, first)
    // Different reference for toolCalls array → row is replaced
    expect(second.result[0]).not.toBe(first.result[0])
  })

  it('handles work row with squashed flag change', () => {
    const toolCalls = [{ toolCallId: 'tc1', title: 'Edit', status: 'completed' as const }]
    const rows: TimelineRow[] = [
      { kind: 'work', id: 'msg-0-work', toolCalls, squashed: false },
    ]
    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)

    const updated: TimelineRow[] = [
      { kind: 'work', id: 'msg-0-work', toolCalls, squashed: true },
    ]
    const second = computeStableTimelineRows(updated, first)
    expect(second.result[0]).not.toBe(first.result[0])
  })

  it('handles assistant-text questionsAnswered flag change', () => {
    const rows: TimelineRow[] = [
      { kind: 'assistant-text', id: 'msg-1-text', content: 'question?', timestamp: '2024-01-01', questionsAnswered: false },
    ]
    const first = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)

    const updated: TimelineRow[] = [
      { kind: 'assistant-text', id: 'msg-1-text', content: 'question?', timestamp: '2024-01-01', questionsAnswered: true },
    ]
    const second = computeStableTimelineRows(updated, first)
    expect(second.result[0]).not.toBe(first.result[0])
  })

  it('byId map is correctly populated', () => {
    const rows: TimelineRow[] = [
      { kind: 'user-message', id: 'msg-0-user', content: 'hello', timestamp: '2024-01-01' },
      { kind: 'assistant-text', id: 'msg-1-text', content: 'hi', timestamp: '2024-01-01' },
    ]

    const state = computeStableTimelineRows(rows, EMPTY_STABLE_STATE)
    expect(state.byId.size).toBe(2)
    expect(state.byId.get('msg-0-user')).toBe(state.result[0])
    expect(state.byId.get('msg-1-text')).toBe(state.result[1])
  })
})
