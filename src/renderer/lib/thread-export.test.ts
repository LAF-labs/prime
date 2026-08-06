import { describe, it, expect } from 'vitest'
import { buildThreadMarkdown, exportFileName } from './thread-export'
import type { AgentTask, TaskMessage, ToolCall } from '@/types'

const msg = (over: Partial<TaskMessage>): TaskMessage => ({
  role: 'user',
  content: 'hello',
  timestamp: '2026-08-06T00:00:00Z',
  ...over,
})

const task = (over: Partial<AgentTask>): AgentTask =>
  ({
    id: 't1',
    name: 'Fix the login bug',
    workspace: '/Users/me/proj',
    status: 'paused',
    createdAt: '2026-08-01T00:00:00Z',
    messages: [],
    ...over,
  }) as AgentTask

describe('buildThreadMarkdown', () => {
  it('produces a self-contained document with the conversation in order', () => {
    const md = buildThreadMarkdown(
      task({
        messages: [
          msg({ role: 'user', content: '로그인이 안 돼요' }),
          msg({ role: 'assistant', content: '원인을 찾았습니다.' }),
        ],
      }),
    )
    expect(md).toContain('# Fix the login bug')
    expect(md.indexOf('로그인이 안 돼요')).toBeLessThan(md.indexOf('원인을 찾았습니다.'))
    expect(md).toContain('## User')
    expect(md).toContain('## Assistant')
  })

  it('folds thinking into a collapsed block instead of dropping it', () => {
    const md = buildThreadMarkdown(
      task({ messages: [msg({ role: 'assistant', content: 'done', thinking: 'step by step' })] }),
    )
    expect(md).toContain('<details>')
    expect(md).toContain('step by step')
  })

  it('summarizes tool calls rather than dumping raw payloads', () => {
    const tc = { toolCallId: '1', title: 'bash: ls', kind: 'execute', status: 'completed' } as unknown as ToolCall
    const md = buildThreadMarkdown(
      task({ messages: [msg({ role: 'assistant', content: '', toolCalls: [tc] })] }),
    )
    expect(md).toContain('`bash: ls` — completed')
  })

  it('renders system notes as quoted asides', () => {
    const md = buildThreadMarkdown(
      task({ messages: [msg({ role: 'system', content: 'first line\nsecond line' })] }),
    )
    expect(md).toContain('> first line\n> second line')
  })
})

describe('exportFileName', () => {
  it('keeps a readable name', () => {
    expect(exportFileName('Fix the login bug')).toBe('Fix the login bug.md')
  })

  it('strips characters that break filesystems', () => {
    // A thread named after a path or a question must not become nested
    // directories or an invalid name on export.
    expect(exportFileName('fix src/auth/login.ts: why?')).toBe('fix src auth login.ts why.md')
  })

  it('never returns an empty stem', () => {
    expect(exportFileName('///???')).toBe('conversation.md')
  })

  it('bounds the length', () => {
    const name = exportFileName('가'.repeat(200))
    expect(name.length).toBeLessThanOrEqual(63)
  })
})
