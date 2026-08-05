import { describe, it, expect } from 'vitest'
import { buildInlineSegments, deriveTimeline } from './timeline'
import type { TaskMessage, ToolCall, ToolCallSplit } from '@/types'

const makeMsg = (role: TaskMessage['role'], content: string, extra?: Partial<TaskMessage>): TaskMessage => ({
  role,
  content,
  timestamp: '2026-01-01T00:00:00Z',
  ...extra,
})

const makeTool = (overrides?: Partial<ToolCall>): ToolCall => ({
  toolCallId: 'tc-1',
  title: 'read file',
  status: 'completed',
  ...overrides,
})

describe('deriveTimeline', () => {
  it('returns empty array for no messages and no streaming', () => {
    const actual = deriveTimeline([], undefined, undefined, undefined, false)
    expect(actual).toEqual([])
  })

  it('maps a user message to a user-message row', () => {
    const msgs = [makeMsg('user', 'hello')]
    const rows = deriveTimeline(msgs, undefined, undefined, undefined, false)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('user-message')
    expect((rows[0] as { content: string }).content).toBe('hello')
  })

  it('maps a system message to a system-message row', () => {
    const msgs = [makeMsg('system', 'warning')]
    const rows = deriveTimeline(msgs, undefined, undefined, undefined, false)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('system-message')
  })

  it('maps assistant text + tool calls to separate rows', () => {
    const msgs = [makeMsg('assistant', 'thinking...', {
      toolCalls: [makeTool({ kind: 'read' })],
    })]
    const rows = deriveTimeline(msgs, undefined, undefined, undefined, false)
    expect(rows.map((r) => r.kind)).toEqual(['assistant-text', 'work'])
  })

  it('adds changed-files row after work with file mutations', () => {
    const msgs = [makeMsg('assistant', 'done', {
      toolCalls: [makeTool({ kind: 'edit', status: 'completed' })],
    })]
    const rows = deriveTimeline(msgs, undefined, undefined, undefined, false)
    expect(rows.map((r) => r.kind)).toEqual(['assistant-text', 'work', 'changed-files'])
  })

  it('does not add changed-files for non-mutation tools', () => {
    const msgs = [makeMsg('assistant', 'done', {
      toolCalls: [makeTool({ kind: 'read', status: 'completed' })],
    })]
    const rows = deriveTimeline(msgs, undefined, undefined, undefined, false)
    expect(rows.map((r) => r.kind)).toEqual(['assistant-text', 'work'])
  })

  it('adds streaming text as live assistant-text row', () => {
    const rows = deriveTimeline([], 'streaming...', undefined, undefined, false)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('assistant-text')
    expect((rows[0] as { isStreaming?: boolean }).isStreaming).toBe(true)
  })

  it('adds live tool calls as live work row', () => {
    const rows = deriveTimeline([], undefined, [makeTool()], undefined, false)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('work')
  })

  it('adds working indicator when running', () => {
    const rows = deriveTimeline([], undefined, undefined, undefined, true)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('working')
  })

  it('shows thinking as live assistant-text', () => {
    const rows = deriveTimeline([], undefined, undefined, 'hmm...', false)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('assistant-text')
    expect((rows[0] as { thinking?: string }).thinking).toBe('hmm...')
  })

  it('combines persisted messages with live state', () => {
    const msgs = [makeMsg('user', 'hi')]
    // 'working' row appears before live tool calls with hasStreamingContent flag
    const rows = deriveTimeline(msgs, 'responding...', [makeTool()], undefined, true)
    expect(rows.map((r) => r.kind)).toEqual(['user-message', 'assistant-text', 'working', 'work'])
  })

  it('shows working indicator alongside live tool calls when running', () => {
    const rows = deriveTimeline([], undefined, [makeTool()], undefined, true)
    expect(rows.map((r) => r.kind)).toEqual(['working', 'work'])
  })

  it('shows working indicator with hasStreamingContent when streaming text is active', () => {
    const rows = deriveTimeline([], 'typing...', [makeTool()], undefined, true)
    expect(rows.map((r) => r.kind)).toEqual(['assistant-text', 'working', 'work'])
    const workingRow = rows.find((r) => r.kind === 'working') as { hasStreamingContent?: boolean }
    expect(workingRow.hasStreamingContent).toBe(true)
  })

  describe('inline tool calls', () => {
    it('falls back to grouped layout when splits are missing', () => {
      const msgs = [makeMsg('assistant', 'before after', {
        toolCalls: [makeTool({ toolCallId: 'tc-1', kind: 'read' })],
      })]
      const rows = deriveTimeline(msgs, undefined, undefined, undefined, false, { inlineToolCalls: true })
      expect(rows.map((r) => r.kind)).toEqual(['assistant-text', 'work'])
    })

    it('interleaves text and tool calls based on splits', () => {
      const msgs = [makeMsg('assistant', 'before middle after', {
        toolCalls: [
          makeTool({ toolCallId: 'tc-1', kind: 'read' }),
          makeTool({ toolCallId: 'tc-2', kind: 'execute' }),
        ],
        toolCallSplits: [
          { at: 6, toolCallId: 'tc-1' }, // after "before"
          { at: 13, toolCallId: 'tc-2' }, // after "before middle"
        ],
      })]
      const rows = deriveTimeline(msgs, undefined, undefined, undefined, false, { inlineToolCalls: true })
      // text "before" -> work tc-1 -> text " middle" -> work tc-2 -> text " after"
      expect(rows.map((r) => r.kind)).toEqual([
        'assistant-text', 'work', 'assistant-text', 'work', 'assistant-text',
      ])
      expect((rows[0] as { content: string }).content).toBe('before')
      expect((rows[2] as { content: string }).content).toBe(' middle')
      expect((rows[4] as { content: string }).content).toBe(' after')
    })

    it('flags non-trailing inline segments with isInlineSegment', () => {
      const msgs = [makeMsg('assistant', 'before after', {
        toolCalls: [makeTool({ toolCallId: 'tc-1', kind: 'read' })],
        toolCallSplits: [{ at: 6, toolCallId: 'tc-1' }],
      })]
      const rows = deriveTimeline(msgs, undefined, undefined, undefined, false, { inlineToolCalls: true })
      expect((rows[0] as { isInlineSegment?: boolean }).isInlineSegment).toBe(true)
      expect((rows[2] as { isInlineSegment?: boolean }).isInlineSegment).toBe(false)
    })

    it('groups adjacent tool calls into a single work row', () => {
      const msgs = [makeMsg('assistant', 'doing things', {
        toolCalls: [
          makeTool({ toolCallId: 'a', kind: 'read' }),
          makeTool({ toolCallId: 'b', kind: 'read' }),
        ],
        toolCallSplits: [
          { at: 5, toolCallId: 'a' },
          { at: 5, toolCallId: 'b' },
        ],
      })]
      const rows = deriveTimeline(msgs, undefined, undefined, undefined, false, { inlineToolCalls: true })
      // text "doing" -> work [a,b] -> text " things"
      expect(rows.map((r) => r.kind)).toEqual(['assistant-text', 'work', 'assistant-text'])
      const workRow = rows[1] as { toolCalls: ToolCall[] }
      expect(workRow.toolCalls.map((tc) => tc.toolCallId)).toEqual(['a', 'b'])
    })

    it('appends file-changes row after the inline-rendered message', () => {
      const msgs = [makeMsg('assistant', 'editing now', {
        toolCalls: [makeTool({ toolCallId: 'tc-1', kind: 'edit', status: 'completed' })],
        toolCallSplits: [{ at: 7, toolCallId: 'tc-1' }],
      })]
      const rows = deriveTimeline(msgs, undefined, undefined, undefined, false, { inlineToolCalls: true })
      expect(rows.map((r) => r.kind)).toEqual([
        'assistant-text', 'work', 'assistant-text', 'changed-files',
      ])
    })

    it('appends tool calls without matching splits at the end', () => {
      const msgs = [makeMsg('assistant', 'hi there', {
        toolCalls: [
          makeTool({ toolCallId: 'tc-1', kind: 'read' }),
          makeTool({ toolCallId: 'tc-2', kind: 'execute' }),
        ],
        toolCallSplits: [{ at: 2, toolCallId: 'tc-1' }],
      })]
      const rows = deriveTimeline(msgs, undefined, undefined, undefined, false, { inlineToolCalls: true })
      // text "hi" -> work tc-1 -> text " there" -> work tc-2 (orphan)
      expect(rows.map((r) => r.kind)).toEqual([
        'assistant-text', 'work', 'assistant-text', 'work',
      ])
    })

    it('clamps splits whose offset exceeds the content length', () => {
      const msgs = [makeMsg('assistant', 'hello', {
        toolCalls: [makeTool({ toolCallId: 'tc-1', kind: 'read' })],
        toolCallSplits: [{ at: 999, toolCallId: 'tc-1' }],
      })]
      const rows = deriveTimeline(msgs, undefined, undefined, undefined, false, { inlineToolCalls: true })
      // text "hello" -> work tc-1
      expect(rows.map((r) => r.kind)).toEqual(['assistant-text', 'work'])
    })

    it('inline streaming uses liveToolSplits to interleave the live transcript', () => {
      const splits: ToolCallSplit[] = [{ at: 5, toolCallId: 'tc-1' }]
      const liveTools = [makeTool({ toolCallId: 'tc-1', kind: 'read', status: 'in_progress' })]
      const rows = deriveTimeline([], 'plan: do thing', liveTools, undefined, true, {
        inlineToolCalls: true,
        liveToolSplits: splits,
      })
      // text "plan:" -> work tc-1 -> text " do thing" -> working
      expect(rows.map((r) => r.kind)).toEqual([
        'assistant-text', 'work', 'assistant-text', 'working',
      ])
    })

    it('inline streaming without splits falls back to grouped live layout', () => {
      const liveTools = [makeTool({ toolCallId: 'tc-1', kind: 'read', status: 'in_progress' })]
      const rows = deriveTimeline([], 'thinking', liveTools, undefined, true, {
        inlineToolCalls: true,
        liveToolSplits: [],
      })
      expect(rows.map((r) => r.kind)).toEqual(['assistant-text', 'working', 'work'])
    })
  })
})

describe('buildInlineSegments', () => {
  it('returns a single text segment when there are no tool calls', () => {
    const segs = buildInlineSegments('hello', [], [])
    expect(segs).toEqual([{ kind: 'text', text: 'hello' }])
  })

  it('returns nothing when content is empty and there are no tools', () => {
    expect(buildInlineSegments('', [], [])).toEqual([])
  })

  it('orders tool calls by split.at ascending', () => {
    const tools = [
      { toolCallId: 'a', title: '', status: 'completed' as const },
      { toolCallId: 'b', title: '', status: 'completed' as const },
    ]
    const splits = [
      { at: 5, toolCallId: 'b' },
      { at: 2, toolCallId: 'a' },
    ]
    const segs = buildInlineSegments('hello world', tools, splits)
    expect(segs.map((s) => s.kind)).toEqual(['text', 'tool', 'text', 'tool', 'text'])
    expect((segs[1] as { toolCall?: ToolCall }).toolCall?.toolCallId).toBe('a')
    expect((segs[3] as { toolCall?: ToolCall }).toolCall?.toolCallId).toBe('b')
  })

  it('handles multiple tools at the same offset', () => {
    const tools = [
      { toolCallId: 'a', title: '', status: 'completed' as const },
      { toolCallId: 'b', title: '', status: 'completed' as const },
    ]
    const splits = [
      { at: 3, toolCallId: 'a' },
      { at: 3, toolCallId: 'b' },
    ]
    const segs = buildInlineSegments('abcdef', tools, splits)
    // text "abc" -> tool a -> tool b -> text "def"  (no empty intermediate text segment)
    expect(segs.map((s) => s.kind)).toEqual(['text', 'tool', 'tool', 'text'])
  })

  it('snaps a mid-paragraph offset back to the paragraph start', () => {
    const tools = [{ toolCallId: 'a', title: '', status: 'completed' as const }]
    // Two paragraphs. An offset of 17 sits inside "second paragraph" — snap
    // should pull it back to the start of that paragraph (after "\n\n").
    const content = 'first para\n\nsecond paragraph here'
    const splits = [{ at: 17, toolCallId: 'a' }]
    const segs = buildInlineSegments(content, tools, splits)
    expect(segs.map((s) => s.kind)).toEqual(['text', 'tool', 'text'])
    expect((segs[0] as { text: string }).text).toBe('first para\n\n')
    expect((segs[2] as { text: string }).text).toBe('second paragraph here')
  })

  it('snaps to the start of the current line when no paragraph break exists', () => {
    const tools = [{ toolCallId: 'a', title: '', status: 'completed' as const }]
    // One newline only — snap should fall back to start-of-line.
    const content = 'one line\nsecond line'
    const splits = [{ at: 13, toolCallId: 'a' }] // mid "second line"
    const segs = buildInlineSegments(content, tools, splits)
    expect(segs.map((s) => s.kind)).toEqual(['text', 'tool', 'text'])
    expect((segs[0] as { text: string }).text).toBe('one line\n')
    expect((segs[2] as { text: string }).text).toBe('second line')
  })

  it('breaks same-offset ties by tool createdAt', () => {
    const tools = [
      { toolCallId: 'b', title: '', status: 'completed' as const, createdAt: '2026-01-01T00:00:02Z' },
      { toolCallId: 'a', title: '', status: 'completed' as const, createdAt: '2026-01-01T00:00:01Z' },
    ]
    const splits = [
      { at: 3, toolCallId: 'b' },
      { at: 3, toolCallId: 'a' },
    ]
    const segs = buildInlineSegments('abcdef', tools, splits)
    expect(segs.map((s) => s.kind)).toEqual(['text', 'tool', 'tool', 'text'])
    expect((segs[1] as { toolCall?: ToolCall }).toolCall?.toolCallId).toBe('a')
    expect((segs[2] as { toolCall?: ToolCall }).toolCall?.toolCallId).toBe('b')
  })

  it('steps a split offset back when it lands between UTF-16 surrogates', () => {
    // U+1F600 ("😀") is a surrogate pair: 0xD83D 0xDE00. An offset of 1
    // sits between the high and low surrogate. With no newline before it,
    // `snapToBlockBoundary` should step back by one to escape the pair so
    // we don't slice into half of a code point.
    const tools = [{ toolCallId: 'a', title: '', status: 'completed' as const }]
    const segs = buildInlineSegments('😀tail', tools, [{ at: 1, toolCallId: 'a' }])
    expect(segs.map((s) => s.kind)).toEqual(['tool', 'text'])
    // The text segment must contain the whole emoji, not a stray low
    // surrogate left behind by an off-by-one slice.
    expect((segs[1] as { text: string }).text).toBe('😀tail')
  })
})

describe('inline-mode streaming cursor', () => {
  it('marks only the trailing live text segment with isStreaming', () => {
    // Reproduces the multi-cursor bug: when the agent streams "before
    // <tool> after" with `inlineToolCalls` enabled, only the trailing
    // " after" segment should render the blinking cursor — middle
    // segments are frozen as soon as a tool call splits past them.
    const liveTools = [makeTool({ toolCallId: 'tc-1', kind: 'read', status: 'in_progress' })]
    const splits: ToolCallSplit[] = [{ at: 6, toolCallId: 'tc-1' }]
    const rows = deriveTimeline([], 'before after', liveTools, undefined, true, {
      inlineToolCalls: true,
      liveToolSplits: splits,
    })
    const textRows = rows.filter((r) => r.kind === 'assistant-text') as Array<{ isStreaming?: boolean; isInlineSegment?: boolean }>
    expect(textRows).toHaveLength(2)
    // Leading segment is frozen — the cursor would otherwise sit at the
    // end of "before" forever.
    expect(textRows[0].isStreaming).toBe(false)
    expect(textRows[0].isInlineSegment).toBe(true)
    // Trailing segment carries the cursor.
    expect(textRows[1].isStreaming).toBe(true)
    expect(textRows[1].isInlineSegment).toBe(false)
  })
})
