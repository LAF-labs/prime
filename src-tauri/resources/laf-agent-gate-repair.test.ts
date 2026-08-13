// @vitest-environment node
import { describe, expect, it } from 'vitest'

const GATE = new URL('./laf-agent-gate.ts', import.meta.url).pathname

type ToolCallHandler = (
  event: { type: 'tool_call'; toolCallId: string; toolName: string; input: Record<string, unknown> },
  ctx: unknown,
) => Promise<{ block?: boolean; reason?: string } | undefined>

let loadCounter = 0
async function loadToolCall(): Promise<ToolCallHandler> {
  let handler: ToolCallHandler | undefined
  const pi = {
    registerTool: () => {},
    registerCommand: () => {},
    on: (event: string, fn: unknown) => {
      if (event === 'tool_call') handler = fn as ToolCallHandler
    },
  }
  process.env.LAF_PROFILE = 'everyday'
  const mod = await import(`${GATE}?repair=${(loadCounter += 1)}`)
  mod.default(pi)
  if (!handler) throw new Error('gate registered no tool_call handler')
  return handler
}

/**
 * A UI that always allows, so the only thing that can block a call here is the
 * repair layer — which is what these tests are about.
 *
 * This was `{ hasUI: false }`, back when a session with no way to ask for
 * approval was allowed to mutate files anyway. It is denied now, so "no UI"
 * would make every mutating case below fail for a reason that has nothing to
 * do with argument repair.
 */
const CTX = { hasUI: true, ui: { select: async () => 'Allow' } }

/** Run one tool call through the gate and report the repaired input. */
async function call(toolName: string, input: Record<string, unknown>) {
  const handler = await loadToolCall()
  const event = { type: 'tool_call' as const, toolCallId: 'c', toolName, input }
  const result = await handler(event, CTX)
  return { input: event.input, blocked: Boolean(result?.block), reason: result?.reason ?? '' }
}

/**
 * Small models get tool *intent* right far more often than tool *arguments*.
 * Every case below is a shape a cheap model actually reaches for; repairing it
 * in place saves the round trip that a schema error would have cost.
 */
describe('everyday tool-argument repair', () => {
  it.each([
    ['a filename alias', 'read_file', { filename: '~/a.txt' }, { path: '~/a.txt' }],
    ['a file_path alias', 'read_file', { file_path: '/x/a.txt' }, { path: '/x/a.txt' }],
    ['an arguments envelope', 'read_file', { arguments: { path: '~/a.txt' } }, { path: '~/a.txt' }],
    ['a JSON-string envelope', 'read_file', { arguments: '{"path":"~/a.txt"}' }, { path: '~/a.txt' }],
    ['a single-element array', 'read_file', { path: ['~/a.txt'] }, { path: '~/a.txt' }],
    ['a folder alias', 'list_dir', { folder: '~/Downloads' }, { path: '~/Downloads' }],
    ['a directory alias', 'list_dir', { directory: '~/Docs' }, { path: '~/Docs' }],
    ['a text alias', 'write_file', { path: '~/n.txt', text: 'hi' }, { path: '~/n.txt', content: 'hi' }],
    [
      'two aliases at once',
      'write_file',
      { filename: '~/n.txt', contents: 'hi' },
      { path: '~/n.txt', content: 'hi' },
    ],
    ['a memory alias', 'remember', { memory: 'likes tea' }, { fact: 'likes tea' }],
    ['a note alias', 'remember', { note: 'likes tea' }, { fact: 'likes tea' }],
  ])('repairs %s', async (_label, tool, input, expected) => {
    const result = await call(tool, input)
    expect(result.blocked).toBe(false)
    expect(result.input).toEqual(expected)
  })

  it('serializes structured content instead of refusing to write it', async () => {
    const result = await call('write_file', { path: '~/n.json', content: { a: 1 } })
    expect(result.blocked).toBe(false)
    expect(result.input.content).toBe('{\n  "a": 1\n}')
  })

  /** Writing an empty file is a legitimate request, not a missing argument. */
  it('accepts empty content', async () => {
    const result = await call('write_file', { path: '~/n.txt', content: '' })
    expect(result.blocked).toBe(false)
    expect(result.input).toEqual({ path: '~/n.txt', content: '' })
  })
})

describe('organize argument repair', () => {
  const MOVE = { operations: [{ from: '/a', to: '/b', op: 'move' }] }

  it.each([
    ['a lone operation object', { operations: { from: '/a', to: '/b' } }, MOVE],
    ['from/to hoisted to the top level', { from: '/a', to: '/b' }, MOVE],
    ['an ops alias', { ops: [{ from: '/a', to: '/b' }] }, MOVE],
    ['JSON-string operations', { operations: '[{"from":"/a","to":"/b"}]' }, MOVE],
    ['source/destination aliases', { operations: [{ source: '/a', destination: '/b' }] }, MOVE],
    ['rename normalized to move', { operations: [{ op: 'rename', from: '/a', to: '/b' }] }, MOVE],
    [
      'cp normalized to copy',
      { operations: [{ action: 'cp', src: '/a', dst: '/b' }] },
      { operations: [{ from: '/a', to: '/b', op: 'copy' }] },
    ],
  ])('repairs %s', async (_label, input, expected) => {
    const result = await call('organize', input)
    expect(result.blocked).toBe(false)
    expect(result.input).toEqual(expected)
  })
})

/**
 * When a call cannot be repaired unambiguously, guessing would be worse than
 * failing. The block message states the exact shape, which teaches the model
 * more than the harness's generic schema error does.
 */
describe('unrepairable calls', () => {
  it.each([
    ['read_file with no path', 'read_file', { foo: 'bar' }, '"path": "<file path>"'],
    ['write_file with no content', 'write_file', { path: '~/a.txt' }, '"content"'],
    ['organize with an empty list', 'organize', { operations: [] }, '"operations" must be a list'],
    ['organize with a half-written entry', 'organize', { operations: [{ from: '/a' }] }, '"op" is either'],
    ['remember with a blank fact', 'remember', { fact: '   ' }, 'one short sentence'],
  ])('blocks %s and names the right shape', async (_label, tool, input, needle) => {
    const result = await call(tool, input)
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain(needle)
  })
})

describe('repair scope', () => {
  it.each([
    ['read_file', { path: '~/a.txt' }],
    ['write_file', { path: '~/a.txt', content: 'x' }],
    ['remember', { fact: 'x' }],
  ])('leaves a correct %s call byte-identical', async (tool, input) => {
    const result = await call(tool, { ...input })
    expect(result.blocked).toBe(false)
    expect(result.input).toEqual(input)
  })

  /**
   * Developer-mode tools are driven by models that get their schemas right,
   * and silently rewriting a shell command's arguments is not a trade worth
   * making. The repair layer must not reach them at all.
   */
  it('never touches developer-mode tool arguments', async () => {
    const original = { command: 'ls', filename: 'keep-me' }
    const result = await call('bash', { ...original })
    expect(result.input).toEqual(original)
  })
})
