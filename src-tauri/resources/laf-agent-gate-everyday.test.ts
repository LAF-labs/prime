// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const GATE = new URL('./laf-agent-gate.ts', import.meta.url).pathname

interface CapturedTool {
  name: string
  execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<{
    content: { text: string }[]
    details?: Record<string, unknown>
  }>
}

interface ToolCallEvent {
  type: 'tool_call'
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

interface Captured {
  tools: Map<string, CapturedTool>
  toolCall?: (
    event: ToolCallEvent,
    ctx: unknown,
  ) => Promise<{ block?: boolean; reason?: string } | undefined>
  beforeAgentStart?: (event: {
    systemPromptOptions?: { cwd?: string }
  }) => { systemPrompt?: string } | undefined
}

/**
 * Load the gate with a stub host and capture what it registers.
 *
 * Every knob the everyday profile reads — `LAF_PROFILE`, `LAF_MEMORY_PATH`,
 * `LAF_WORKSPACE` — is read at module scope, so each load has to be a fresh
 * evaluation. The cache-busting query is what forces that.
 */
let loadCounter = 0
async function loadGate(): Promise<Captured> {
  const captured: Captured = { tools: new Map() }
  const pi = {
    registerTool: (tool: CapturedTool) => captured.tools.set(tool.name, tool),
    registerCommand: () => {},
    on: (event: string, handler: unknown) => {
      if (event === 'tool_call') captured.toolCall = handler as Captured['toolCall']
      if (event === 'before_agent_start') {
        captured.beforeAgentStart = handler as Captured['beforeAgentStart']
      }
    },
  }
  const mod = await import(`${GATE}?everyday=${(loadCounter += 1)}`)
  mod.default(pi)
  return captured
}

/**
 * A fake home directory, so the tests never touch the real one.
 *
 * `os.homedir()` reads `$HOME` on POSIX, which is what lets the gate's own
 * confinement boundary be pointed at a temp dir. The real value is restored
 * afterwards — leaving `$HOME` rewritten would be a booby trap for any test
 * that happens to share the worker.
 */
let home: string
let memoryPath: string
let realHome: string | undefined

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'laf-everyday-'))
  memoryPath = join(home, 'memories.json')
  realHome = process.env.HOME
  process.env.LAF_PROFILE = 'everyday'
  process.env.LAF_MEMORY_PATH = memoryPath
  process.env.LAF_WORKSPACE = home
  process.env.HOME = home
})

afterAll(() => {
  delete process.env.LAF_PROFILE
  delete process.env.LAF_MEMORY_PATH
  delete process.env.LAF_WORKSPACE
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
})

afterEach(() => {
  rmSync(memoryPath, { force: true })
})

describe('everyday profile', () => {
  it('registers the everyday tools and never a shell', async () => {
    const { tools } = await loadGate()
    for (const name of ['read_file', 'list_dir', 'write_file', 'organize', 'remember']) {
      expect(tools.has(name)).toBe(true)
    }
    expect(tools.has('bash')).toBe(false)
    expect(tools.has('ipython')).toBe(false)
  })

  it('replaces the RLM prompt with a conversational one', async () => {
    const { beforeAgentStart } = await loadGate()
    const prompt = beforeAgentStart?.({ systemPromptOptions: { cwd: '/tmp/x' } })?.systemPrompt ?? ''
    expect(prompt).toContain('personal AI assistant')
    // The RLM prefix is what makes a session assume it must write Python.
    expect(prompt).not.toContain('uses code to solve tasks')
  })

  /**
   * Every fixed token is paid on every request of every session, which is the
   * whole reason this profile exists. A regression here is a cost regression,
   * so the budget is asserted rather than trusted.
   */
  it('keeps the fixed prompt small', async () => {
    const { beforeAgentStart } = await loadGate()
    const prompt = beforeAgentStart?.({ systemPromptOptions: { cwd: '/tmp/x' } })?.systemPrompt ?? ''
    expect(prompt.length).toBeLessThan(2000)
  })

  it('carries remembered facts into the next prompt', async () => {
    const { tools, beforeAgentStart } = await loadGate()
    await tools.get('remember')?.execute('c', { fact: 'Prefers green tea' })
    expect(JSON.parse(readFileSync(memoryPath, 'utf8'))).toHaveLength(1)
    const prompt = beforeAgentStart?.({ systemPromptOptions: { cwd: '/x' } })?.systemPrompt ?? ''
    expect(prompt).toContain('Prefers green tea')
  })

  it('does not remember the same fact twice', async () => {
    const { tools } = await loadGate()
    await tools.get('remember')?.execute('c', { fact: 'Lives in Seoul' })
    await tools.get('remember')?.execute('c', { fact: 'Lives in Seoul' })
    expect(JSON.parse(readFileSync(memoryPath, 'utf8'))).toHaveLength(1)
  })

  it('survives a corrupt memory file instead of failing the turn', async () => {
    writeFileSync(memoryPath, 'not json at all')
    const { tools, beforeAgentStart } = await loadGate()
    expect(() => beforeAgentStart?.({ systemPromptOptions: { cwd: '/x' } })).not.toThrow()
    await tools.get('remember')?.execute('c', { fact: 'Recovered' })
    expect(JSON.parse(readFileSync(memoryPath, 'utf8'))).toHaveLength(1)
  })
})

describe('everyday file confinement', () => {
  it.each([
    ['outside the home directory', '/etc/passwd', /outside your home/],
    ['a dotfile', '~/.ssh/id_ed25519', /hidden or system/],
    ['the Library folder', '~/Library/Cookies/x', /hidden or system/],
    ['a traversal escape', '~/Documents/../../../etc/hosts', /outside your home/],
  ])('refuses to read %s', async (_label, path, message) => {
    const { tools } = await loadGate()
    await expect(tools.get('read_file')?.execute('c', { path })).rejects.toThrow(message)
  })

  it('reads a normal text file', async () => {
    const file = join(home, 'note.txt')
    writeFileSync(file, '메모 내용입니다')
    const { tools } = await loadGate()
    const result = await tools.get('read_file')?.execute('c', { path: file })
    expect(result?.content[0]?.text).toContain('메모')
  })

  it('refuses a binary file rather than returning mojibake', async () => {
    const file = join(home, 'archive.bin')
    writeFileSync(file, Buffer.from([0x50, 0x4b, 0x00, 0x01]))
    const { tools } = await loadGate()
    await expect(tools.get('read_file')?.execute('c', { path: file })).rejects.toThrow(/not text/)
  })
})

describe('everyday organize', () => {
  it('moves a file and creates the destination folder', async () => {
    const from = join(home, 'a.txt')
    const to = join(home, 'sorted', 'a.txt')
    writeFileSync(from, 'hello')
    const { tools } = await loadGate()
    await tools.get('organize')?.execute('c', { operations: [{ from, to }] })
    expect(existsSync(to)).toBe(true)
    expect(existsSync(from)).toBe(false)
  })

  /** Overwriting is how a tidy-up turns into data loss, so it is never allowed. */
  it('refuses to overwrite an existing file', async () => {
    const from = join(home, 'b.txt')
    const to = join(home, 'taken.txt')
    writeFileSync(from, 'x')
    writeFileSync(to, 'occupied')
    const { tools } = await loadGate()
    await expect(
      tools.get('organize')?.execute('c', { operations: [{ from, to }] }),
    ).rejects.toThrow(/never overwrites/)
    expect(readFileSync(to, 'utf8')).toBe('occupied')
  })

  /**
   * A batch that dies halfway has already changed the filesystem. Saying so is
   * what lets the model — and the user — reason about what actually happened.
   */
  it('reports what it already did when a later operation fails', async () => {
    mkdirSync(join(home, 'batch'), { recursive: true })
    const first = join(home, 'batch', 'one.txt')
    const second = join(home, 'batch', 'two.txt')
    const blocked = join(home, 'batch', 'blocked.txt')
    writeFileSync(first, '1')
    writeFileSync(second, '2')
    writeFileSync(blocked, 'occupied')
    const { tools } = await loadGate()
    await expect(
      tools.get('organize')?.execute('c', {
        operations: [
          { from: first, to: join(home, 'batch', 'moved.txt') },
          { from: second, to: blocked },
        ],
      }),
    ).rejects.toThrow(/Already completed before the failure/)
    expect(existsSync(join(home, 'batch', 'moved.txt'))).toBe(true)
  })
})
