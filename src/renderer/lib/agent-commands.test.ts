import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseCommand,
  isPassthroughCommand,
  runRpcCommand,
  PASSTHROUGH_COMMANDS,
  RPC_COMMANDS,
  THINKING_LEVELS,
} from './agent-commands'

vi.mock('@/lib/ipc', () => ({
  ipc: {
    agentRpcRequest: vi.fn().mockResolvedValue({}),
    setThinkingLevel: vi.fn().mockResolvedValue(undefined),
  },
}))

import { ipc } from '@/lib/ipc'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseCommand', () => {
  it('splits the name from its arguments', () => {
    expect(parseCommand('/goal --budget 100 ship it')).toEqual({
      name: 'goal',
      rest: '--budget 100 ship it',
    })
  })

  it('handles a bare command', () => {
    expect(parseCommand('/clone')).toEqual({ name: 'clone', rest: '' })
  })

  it('tolerates repeated slashes and casing', () => {
    expect(parseCommand('//Compact')).toEqual({ name: 'compact', rest: '' })
  })
})

describe('passthrough commands', () => {
  it('routes the four session-executed commands to the agent', () => {
    // These must never be intercepted: prime-agent's session parses them
    // itself, so forwarding them verbatim reproduces the CLI exactly.
    for (const name of ['goal', 'autonomous', 'compact', 'refine']) {
      expect(isPassthroughCommand(name)).toBe(true)
    }
  })

  it('does not claim RPC-backed command names', () => {
    expect(isPassthroughCommand('clone')).toBe(false)
    expect(isPassthroughCommand('unknown')).toBe(false)
  })

  it('exposes an argument hint for /goal so the picker leaves room to type', () => {
    const goal = PASSTHROUGH_COMMANDS.find((c) => c.name === 'goal')
    expect(goal?.argumentHint).toContain('objective')
  })
})

describe('runRpcCommand', () => {
  it('returns handled: false for names it does not own', async () => {
    expect(await runRpcCommand('t1', 'branch', '')).toEqual({ handled: false })
  })

  it('clones through the RPC bridge', async () => {
    const result = await runRpcCommand('t1', 'clone', '')
    expect(ipc.agentRpcRequest).toHaveBeenCalledWith('t1', 'clone')
    expect(result.handled).toBe(true)
  })

  it('renames the session with the supplied name', async () => {
    await runRpcCommand('t1', 'name', 'release prep')
    expect(ipc.agentRpcRequest).toHaveBeenCalledWith('t1', 'set_session_name', { name: 'release prep' })
  })

  it('rejects a rename with no name instead of calling the agent', async () => {
    const result = await runRpcCommand('t1', 'name', '')
    expect(ipc.agentRpcRequest).not.toHaveBeenCalled()
    expect(result.message).toMatch(/Usage/)
  })

  it('validates thinking levels before sending them', async () => {
    await runRpcCommand('t1', 'thinking', 'high')
    expect(ipc.setThinkingLevel).toHaveBeenCalledWith('t1', 'high')

    vi.clearAllMocks()
    const bad = await runRpcCommand('t1', 'effort', 'turbo')
    expect(ipc.setThinkingLevel).not.toHaveBeenCalled()
    expect(bad.message).toContain(THINKING_LEVELS[0])
  })

  it('passes an explicit export path through', async () => {
    vi.mocked(ipc.agentRpcRequest).mockResolvedValueOnce({ path: '/tmp/s.html' })
    const result = await runRpcCommand('t1', 'export', '/tmp/s.html')
    expect(ipc.agentRpcRequest).toHaveBeenCalledWith('t1', 'export_html', { outputPath: '/tmp/s.html' })
    expect(result.message).toContain('/tmp/s.html')
  })

  it('formats session stats into a readable summary', async () => {
    vi.mocked(ipc.agentRpcRequest).mockResolvedValueOnce({
      sessionId: 'abc',
      tokens: { input: 10, output: 5, cacheRead: 2, total: 17 },
      contextUsage: { tokens: 17, contextWindow: 200000, percent: 1 },
      cost: 0.0123,
    })
    const result = await runRpcCommand('t1', 'session', '')
    expect(result.message).toContain('abc')
    expect(result.message).toContain('17')
    expect(result.message).toContain('$0.0123')
  })

  it('reports an unset heartbeat rather than failing', async () => {
    vi.mocked(ipc.agentRpcRequest).mockResolvedValueOnce({ heartbeat: null })
    const result = await runRpcCommand('t1', 'heartbeat', 'status')
    expect(result.message).toBe('No heartbeat set.')
  })

  it('parses a heartbeat schedule and prompt', async () => {
    await runRpcCommand('t1', 'heartbeat', '0 9 * * 1-5 -- check CI')
    expect(ipc.agentRpcRequest).toHaveBeenCalledWith('t1', 'set_heartbeat', {
      schedule: '0 9 * * 1-5',
      prompt: 'check CI',
    })
  })
})

describe('command catalog', () => {
  it('has no duplicate names across the two groups', () => {
    const names = [...PASSTHROUGH_COMMANDS, ...RPC_COMMANDS].map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives every command a description for the palette', () => {
    for (const c of [...PASSTHROUGH_COMMANDS, ...RPC_COMMANDS]) {
      expect(c.description.length).toBeGreaterThan(0)
    }
  })
})
