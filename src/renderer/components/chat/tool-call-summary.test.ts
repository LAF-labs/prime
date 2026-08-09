import { describe, it, expect } from 'vitest'
import { getToolCallSummary, unwrapResultText, toolNameFromTitle, shortPath } from './tool-call-summary'
import type { ToolCall } from '@/types'

const call = (patch: Partial<ToolCall>): ToolCall => ({
  toolCallId: 'tc1',
  title: 'bash',
  status: 'completed',
  ...patch,
})

describe('toolNameFromTitle', () => {
  it('splits on the first ": " so arguments containing one are safe', () => {
    expect(toolNameFromTitle('bash: cd /tmp && echo "a: b"')).toBe('bash')
  })

  it('handles a bare tool name', () => {
    expect(toolNameFromTitle('web_search')).toBe('web_search')
  })
})

describe('shortPath', () => {
  it('keeps the last two segments', () => {
    expect(shortPath('/a/b/c/chat/EffortPicker.tsx')).toBe('chat/EffortPicker.tsx')
  })
})

describe('unwrapResultText', () => {
  it('unwraps the prime-agent content envelope', () => {
    expect(unwrapResultText({ content: [{ type: 'text', text: 'hello' }] })).toBe('hello')
  })

  it('joins multiple content blocks', () => {
    expect(unwrapResultText({ content: [{ text: 'a' }, { text: 'b' }] })).toBe('a\nb')
  })

  it('passes a plain string through', () => {
    expect(unwrapResultText('raw output')).toBe('raw output')
  })

  it('returns null for a shape it cannot read, so the caller can fall back', () => {
    expect(unwrapResultText({ weird: 1 })).toBeNull()
  })
})

describe('getToolCallSummary', () => {
  it('renders a shell call as Bash(command) without repeating the title', () => {
    const s = getToolCallSummary(call({
      title: 'bash: usage generate --help',
      kind: 'execute',
      rawInput: { command: 'usage generate --help' },
    }))
    expect(s.label).toBe('Bash')
    expect(s.arg).toBe('usage generate --help')
  })

  it('collapses a multi-line command to its first line', () => {
    const s = getToolCallSummary(call({
      title: 'bash: cat > /tmp/x.sh',
      kind: 'execute',
      rawInput: { command: 'cat > /tmp/x.sh <<EOF\nline two\nline three\nEOF' },
    }))
    expect(s.arg).toBe('cat > /tmp/x.sh <<EOF …')
    expect(s.arg).not.toContain('\n')
  })

  it('falls back to the stored title when rawInput never arrived', () => {
    const s = getToolCallSummary(call({ title: 'bash: echo hi', kind: 'execute' }))
    expect(s.label).toBe('Bash')
    expect(s.arg).toBe('echo hi')
  })

  it('labels an edit as Update and shows the short path', () => {
    const s = getToolCallSummary(call({
      title: 'edit: /repo/src/renderer/components/chat/ChatToolbar.tsx',
      kind: 'edit',
      rawInput: { path: '/repo/src/renderer/components/chat/ChatToolbar.tsx' },
    }))
    expect(s.label).toBe('Update')
    expect(s.arg).toBe('chat/ChatToolbar.tsx')
    expect(s.argIsPath).toBe(true)
  })

  it('summarises an edit with its line stats', () => {
    const s = getToolCallSummary(call({
      title: 'edit: a.ts',
      kind: 'edit',
      rawInput: { path: 'a.ts' },
      content: [{ type: 'diff', path: 'a.ts', linesAdded: 12, linesRemoved: 3 }],
    }))
    expect(s.result).toBe('+12 −3')
  })

  it('quotes a search pattern and counts results', () => {
    const s = getToolCallSummary(call({
      title: 'grep: thinkingLevel',
      kind: 'search',
      rawInput: { pattern: 'thinkingLevel' },
      rawOutput: { results: [1, 2, 3] },
    }))
    expect(s.label).toBe('Search')
    expect(s.arg).toBe('"thinkingLevel"')
    expect(s.result).toBe('3 results')
  })

  it('counts output lines when the tool reports no richer result', () => {
    const s = getToolCallSummary(call({
      title: 'read: a.ts',
      kind: 'read',
      rawInput: { path: 'a.ts' },
      rawOutput: { content: [{ type: 'text', text: 'a\nb\nc\n' }] },
    }))
    expect(s.result).toBe('3 lines')
  })

  it('reports no result while the call is still running', () => {
    const s = getToolCallSummary(call({
      title: 'bash: sleep 5',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'sleep 5' },
      rawOutput: { content: [{ text: 'partial\noutput' }] },
    }))
    expect(s.result).toBeNull()
  })

  it('titles an unmapped tool readably instead of showing a raw identifier', () => {
    const s = getToolCallSummary(call({ title: 'mcp__linear__list_issues', kind: 'other' }))
    expect(s.label).toBe('Linear List Issues')
  })

  it('prefers the tool name over the kind fallback', () => {
    const s = getToolCallSummary(call({
      title: 'ipython: import os',
      kind: 'execute',
      rawInput: { code: 'import os' },
    }))
    expect(s.label).toBe('Python')
    expect(s.arg).toBe('import os')
  })
})
