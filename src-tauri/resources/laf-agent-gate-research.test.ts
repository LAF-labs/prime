// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const GATE = new URL('./laf-agent-gate.ts', import.meta.url).pathname

interface CapturedTool {
  name: string
  execute: (id: string, params: Record<string, unknown>) => Promise<{
    content: { text: string }[]
    details?: Record<string, unknown>
  }>
}

interface Captured {
  tools: Map<string, CapturedTool>
  toolCall?: (
    event: { type: 'tool_call'; toolCallId: string; toolName: string; input: Record<string, unknown> },
    ctx: unknown,
  ) => Promise<{ block?: boolean; reason?: string } | undefined>
}

let loadCounter = 0
async function loadGate(): Promise<Captured> {
  const captured: Captured = { tools: new Map() }
  const pi = {
    registerTool: (tool: CapturedTool) => captured.tools.set(tool.name, tool),
    registerCommand: () => {},
    on: (event: string, handler: unknown) => {
      if (event === 'tool_call') captured.toolCall = handler as Captured['toolCall']
    },
  }
  const mod = await import(`${GATE}?research=${(loadCounter += 1)}`)
  mod.default(pi)
  return captured
}

let home: string
let realHome: string | undefined

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'laf-research-'))
  realHome = process.env.HOME
  process.env.HOME = home
  process.env.LAF_PROFILE = 'everyday'
  process.env.LAF_WORKSPACE = home
  process.env.LAF_MEMORY_PATH = join(home, 'memories.json')
})

afterAll(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  for (const key of ['LAF_PROFILE', 'LAF_WORKSPACE', 'LAF_MEMORY_PATH']) delete process.env[key]
  rmSync(home, { recursive: true, force: true })
})

afterEach(() => {
  delete process.env.LAF_RESEARCH_DEPTH
  delete process.env.LAF_READONLY
})

describe('research fan-out', () => {
  it('is offered to a top-level everyday session', async () => {
    const { tools } = await loadGate()
    expect(tools.has('research')).toBe(true)
  })

  /**
   * A child that could fan out again is an exponential process tree one
   * prompt injection away. Depth is the hard stop.
   */
  it('is not offered to a research child', async () => {
    process.env.LAF_RESEARCH_DEPTH = '1'
    const { tools } = await loadGate()
    expect(tools.has('research')).toBe(false)
  })

  it.each([
    ['an empty list', []],
    ['blank questions', ['  ', '']],
  ])('rejects %s instead of spawning nothing', async (_label, questions) => {
    const { tools } = await loadGate()
    await expect(tools.get('research')?.execute('c', { questions })).rejects.toThrow(
      /needs a list of questions/,
    )
  })
})

/**
 * A research child's stdout is consumed by the parent's research tool, not by
 * a UI. Verified live: an approval dialog raised inside a child is a request
 * nothing can answer, and the child waits on it until the timeout. Read-only
 * mode is what makes skipping the dialog safe — the mutating tools are
 * neither registered for a child nor allowed through.
 */
describe('read-only research children', () => {
  it('registers only the reading tools', async () => {
    process.env.LAF_READONLY = '1'
    const { tools } = await loadGate()
    expect(tools.has('read_file')).toBe(true)
    expect(tools.has('list_dir')).toBe(true)
    expect(tools.has('web_fetch')).toBe(true)
    expect(tools.has('write_file')).toBe(false)
    expect(tools.has('organize')).toBe(false)
    expect(tools.has('remember')).toBe(false)
    expect(tools.has('research')).toBe(false)
  })

  it.each(['write_file', 'organize', 'remember'])(
    'blocks %s even if the model calls it anyway',
    async (toolName) => {
      process.env.LAF_READONLY = '1'
      const { toolCall } = await loadGate()
      const result = await toolCall?.(
        {
          type: 'tool_call',
          toolCallId: 'c',
          toolName,
          input: { path: '~/x', content: 'y', fact: 'z', operations: [{ from: '/a', to: '/b' }] },
        },
        { hasUI: false },
      )
      expect(result?.block).toBe(true)
      expect(result?.reason).toMatch(/not available while researching/)
    },
  )

  /** Availability precedes argument validity — including for a child. */
  it('refuses an unavailable tool without discussing its arguments', async () => {
    process.env.LAF_READONLY = '1'
    const { toolCall } = await loadGate()
    const result = await toolCall?.(
      { type: 'tool_call', toolCallId: 'c', toolName: 'organize', input: { nonsense: true } },
      { hasUI: false },
    )
    expect(result?.reason).toMatch(/not available while researching/)
    expect(result?.reason).not.toMatch(/Wrong arguments/)
  })

  it('lets a read through without raising a dialog nothing can answer', async () => {
    const file = join(home, 'source.txt')
    writeFileSync(file, '조사 대상 문서')
    process.env.LAF_READONLY = '1'
    const { tools, toolCall } = await loadGate()
    const verdict = await toolCall?.(
      { type: 'tool_call', toolCallId: 'c', toolName: 'web_fetch', input: { url: 'https://example.com' } },
      // `hasUI` is true in RPC mode — the transport claims a UI even though
      // nothing is listening. That is exactly the trap this guard avoids.
      { hasUI: true, ui: { select: () => new Promise(() => {}) } },
    )
    expect(verdict).toBeUndefined()
    const result = await tools.get('read_file')?.execute('c', { path: file })
    expect(result?.content[0]?.text).toContain('조사 대상')
  })
})
