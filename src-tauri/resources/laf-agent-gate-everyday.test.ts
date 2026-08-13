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
  it('registers the everyday tools, and no shell without a tight sandbox', async () => {
    const { tools } = await loadGate()
    for (const name of ['read_file', 'list_dir', 'write_file', 'organize', 'remember']) {
      expect(tools.has(name)).toBe(true)
    }
    // ipython is gone for good — `--no-builtin-tools` removes it. bash is not:
    // it is registered whenever the OS sandbox can confine it, which is the
    // default. This assertion is about the sandbox being off, not about the
    // profile never having a shell; the test below covers the other half.
    expect(tools.has('bash')).toBe(false)
    expect(tools.has('ipython')).toBe(false)
  })

  /**
   * The prompt has to describe the session the user actually got.
   *
   * It used to claim outright that files could not be deleted. True of the
   * everyday tools; false of the shell, which deletes anything inside the
   * workspace — measured against the real sandbox, which blocks writes outside
   * the working folder and permits them inside it. Someone was being promised
   * their files were safe by the same paragraph that handed out `rm`.
   */
  it('tells the truth about deleting, in both shell and no-shell sessions', async () => {
    const withoutShell = await loadGate()
    const quiet = withoutShell.beforeAgentStart?.({})?.systemPrompt ?? ''
    expect(withoutShell.tools.has('bash')).toBe(false)
    expect(quiet).toContain('You cannot delete files')
    expect(quiet).not.toContain('A shell is available')

    process.env.LAF_TIGHT_SANDBOX = '1'
    try {
      const withShell = await loadGate()
      const armed = withShell.beforeAgentStart?.({})?.systemPrompt ?? ''
      expect(withShell.tools.has('bash')).toBe(true)
      expect(armed).not.toContain('You cannot delete files')
      expect(armed).toContain('A shell is available')
      expect(armed).toContain('cannot be undone')
    } finally {
      delete process.env.LAF_TIGHT_SANDBOX
    }
  })

  /**
   * Asked when a video was made, the assistant handed the user a `stat`
   * command to run in a terminal and paste back — a non-answer for someone who
   * does not use a terminal.
   */
  it('never offers to have the user run a command', async () => {
    const { beforeAgentStart } = await loadGate()
    const prompt = beforeAgentStart?.({})?.systemPrompt ?? ''
    expect(prompt).toContain('Never hand the user a command to run on your behalf')
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

  /**
   * Memories are fixed input: paid on every request of every session. The
   * store used to allow 200 of them at 500 characters each, all injected —
   * about 25k tokens a turn, arrived at slowly enough that nobody would
   * connect the bill to the feature.
   */
  it('bounds the prompt no matter how much has been remembered', async () => {
    const { tools, beforeAgentStart } = await loadGate()
    const remember = tools.get('remember')!
    for (let i = 0; i < 80; i++) {
      await remember.execute('c', { fact: `Fact number ${i} ${'x'.repeat(200)}` })
    }
    const prompt = beforeAgentStart?.({ systemPromptOptions: { cwd: '/x' } })?.systemPrompt ?? ''
    expect(prompt.length).toBeLessThan(4200)
  })

  /** What Settings lists and what the model is told have to be the same set. */
  it('stores only what it injects, so the two never disagree', async () => {
    const { tools, beforeAgentStart } = await loadGate()
    const remember = tools.get('remember')!
    for (let i = 0; i < 40; i++) {
      await remember.execute('c', { fact: `Fact number ${i} ${'y'.repeat(150)}` })
    }
    const stored = JSON.parse(readFileSync(memoryPath, 'utf8')) as { fact: string }[]
    const prompt = beforeAgentStart?.({ systemPromptOptions: { cwd: '/x' } })?.systemPrompt ?? ''
    for (const memory of stored) expect(prompt).toContain(memory.fact)
  })

  /** The newest facts survive; the user hears that the oldest did not. */
  it('drops the oldest first and says so', async () => {
    const { tools } = await loadGate()
    const remember = tools.get('remember')!
    let lastText = ''
    for (let i = 0; i < 40; i++) {
      const result = await remember.execute('c', { fact: `Fact number ${i} ${'z'.repeat(150)}` })
      lastText = result.content[0].text
    }
    expect(lastText).toMatch(/dropped to make room/)
    const stored = JSON.parse(readFileSync(memoryPath, 'utf8')) as { fact: string }[]
    expect(stored.at(-1)!.fact).toContain('Fact number 39')
    expect(stored.some((m) => m.fact.includes('Fact number 0 '))).toBe(false)
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

describe('the approval dialog names a replacement', () => {
  /**
   * The everyday prompt promises the assistant cannot delete files, and
   * `organize` keeps that literally by refusing a move onto an existing name.
   * `write_file` replaces the contents instead — the same loss by another
   * route — and the dialog showed only a path, so "save the tidied version"
   * and "erase what is there" looked identical to the person approving.
   */
  it('says so when the file already exists', async () => {
    const { toolCall } = await loadGate()
    const path = join(home, 'draft.md')
    writeFileSync(path, 'the original')
    const seen: string[] = []
    await toolCall?.(
      { type: 'tool_call', toolCallId: '1', toolName: 'write_file', input: { path, content: 'new' } },
      { hasUI: true, ui: { select: async (title: string) => { seen.push(title); return 'Allow' } } },
    )
    expect(seen[0]).toContain('replaces the file that is already there')
  })

  it('says nothing of the sort for a new file', async () => {
    const { toolCall } = await loadGate()
    const seen: string[] = []
    await toolCall?.(
      {
        type: 'tool_call',
        toolCallId: '1',
        toolName: 'write_file',
        input: { path: join(home, 'brand-new.md'), content: 'x' },
      },
      { hasUI: true, ui: { select: async (title: string) => { seen.push(title); return 'Allow' } } },
    )
    expect(seen[0]).not.toContain('replaces')
  })
})

describe('list_dir reports dates', () => {
  /**
   * "When did I save that" is an everyday question, and without a date here
   * the only answer the agent could give was a shell command for the user to
   * run and paste back. `find-file` also tells the model to match on a rough
   * date, which it cannot do if the listing does not carry one.
   */
  it('shows a date next to every file', async () => {
    const { tools } = await loadGate()
    writeFileSync(join(home, 'clip.mp4'), 'x')
    const result = await tools.get('list_dir')!.execute('c', { path: home })
    expect(result.content[0].text).toMatch(/clip\.mp4 \([^,]+, \d{4}-\d{2}-\d{2}\)/)
  })

  it('says what the listing does and does not carry', async () => {
    const { tools } = await loadGate()
    writeFileSync(join(home, 'note.txt'), 'x')
    const result = await tools.get('list_dir')!.execute('c', { path: home })
    expect(result.content[0].text).toContain('Names, sizes and dates only')
  })
})

describe('everyday file confinement', () => {
  it.each([
    ['outside every allowed root', '/etc/passwd', /outside your home folder/],
    ['a dotfile', '~/.ssh/id_ed25519', /hidden or system/],
    ['the Library folder', '~/Library/Cookies/x', /hidden or system/],
    ['a traversal escape', '~/Documents/../../../etc/hosts', /outside your home folder/],
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

  /**
   * A big archive used to be decoded whole before anything cut it to 40k
   * characters. Measured on a real 938 MB file: eight seconds, about a
   * gigabyte resident, and then V8's `Invalid string length` — an error with
   * no `code`, so it fell through every branch and reached the user verbatim.
   * Both halves matter: the answer has to be the plain-language one, and it
   * has to arrive without reading the file.
   */
  it('recognizes a huge binary file without decoding all of it', async () => {
    const file = join(home, 'huge.bin')
    const block = Buffer.alloc(1024 * 1024)
    block[0] = 0x50
    block[1] = 0x4b
    // Nulls throughout, as any archive has — the point is that only the head
    // is looked at, not that the tail is special.
    writeFileSync(file, Buffer.concat(Array.from({ length: 6 }, () => block)))
    const { tools } = await loadGate()
    const started = Date.now()
    await expect(tools.get('read_file')?.execute('c', { path: file })).rejects.toThrow(/not text/)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('returns the head of a text file too large to read whole, and says so', async () => {
    const file = join(home, 'huge.log')
    writeFileSync(file, 'a'.repeat(5 * 1024 * 1024))
    const { tools } = await loadGate()
    const result = await tools.get('read_file')?.execute('c', { path: file })
    expect(result?.details?.truncated).toBe(true)
    expect(result?.content[0]?.text).toContain('Cut off here')
  })
})

/**
 * A live run against a small model produced both failures below within three
 * turns: it translated `보고서.txt` to `report.txt`, and it re-typed a long
 * absolute path one character off. Both ended the turn with "the file does
 * not exist" and no attempt to recover. Naming what the folder actually
 * contains is what turns each into a self-correcting step — which is the
 * whole difference between an assistant that feels capable and one that
 * gives up.
 */
describe('everyday not-found recovery', () => {
  it('lists the real names when a file name was guessed', async () => {
    writeFileSync(join(home, '보고서.txt'), '분기 매출')
    const { tools } = await loadGate()
    await expect(
      tools.get('read_file')?.execute('c', { path: join(home, 'report.txt') }),
    ).rejects.toThrow(/보고서\.txt/)
  })

  it('tells the model not to translate or re-spell the name', async () => {
    writeFileSync(join(home, '자료.txt'), 'x')
    const { tools } = await loadGate()
    await expect(
      tools.get('read_file')?.execute('c', { path: join(home, 'data.txt') }),
    ).rejects.toThrow(/do not translate or re-spell/)
  })

  it('says the folder is empty rather than listing nothing', async () => {
    const empty = join(home, 'empty-folder')
    mkdirSync(empty, { recursive: true })
    const { tools } = await loadGate()
    await expect(
      tools.get('read_file')?.execute('c', { path: join(empty, 'nope.txt') }),
    ).rejects.toThrow(/that folder is empty/)
  })

  it('reports a missing parent folder as such', async () => {
    const { tools } = await loadGate()
    await expect(
      tools.get('read_file')?.execute('c', { path: join(home, 'no-such-dir', 'x.txt') }),
    ).rejects.toThrow(/There is no folder at/)
  })

  it('redirects read_file at a folder to list_dir', async () => {
    mkdirSync(join(home, 'a-folder'), { recursive: true })
    const { tools } = await loadGate()
    await expect(
      tools.get('read_file')?.execute('c', { path: join(home, 'a-folder') }),
    ).rejects.toThrow(/is a folder, not a file/)
  })

  it('redirects list_dir at a file to read_file', async () => {
    writeFileSync(join(home, 'a-file.txt'), 'x')
    const { tools } = await loadGate()
    await expect(
      tools.get('list_dir')?.execute('c', { path: join(home, 'a-file.txt') }),
    ).rejects.toThrow(/is a file, not a folder/)
  })

  it('names the real files when organize is pointed at a guessed one', async () => {
    mkdirSync(join(home, 'tidy'), { recursive: true })
    writeFileSync(join(home, 'tidy', '사진.jpg'), 'x')
    const { tools } = await loadGate()
    await expect(
      tools.get('organize')?.execute('c', {
        operations: [{ from: join(home, 'tidy', 'photo.jpg'), to: join(home, 'tidy', 'moved.jpg') }],
      }),
    ).rejects.toThrow(/사진\.jpg/)
  })

  /**
   * Long absolute paths are both a token cost on every tool result and,
   * observed live, something a small model re-types incorrectly.
   */
  it('reports paths relative to the workspace, not as absolute ones', async () => {
    const { tools } = await loadGate()
    const result = await tools.get('write_file')?.execute('c', {
      path: join(home, 'short.txt'),
      content: 'hi',
    })
    const text = result?.content[0]?.text ?? ''
    expect(text).toBe('Created short.txt (2 B).')
    expect(text).not.toContain(home)
  })
})

/**
 * Regression: confining to the home directory alone left a session unable to
 * read the very folder it was opened on. A live run against a small model
 * caught it immediately — the model called `list_dir` on its own workspace
 * and was refused. Workspaces legitimately live outside the home directory
 * (an external drive, a temp folder, the app's own chat workspaces under a
 * dot-directory), so the workspace is an allowed root in its own right.
 */
describe('everyday workspace root', () => {
  let outside: string
  let realHomeForBlock: string | undefined

  beforeAll(() => {
    outside = mkdtempSync(join(tmpdir(), 'laf-outside-ws-'))
    realHomeForBlock = process.env.LAF_WORKSPACE
    process.env.LAF_WORKSPACE = outside
  })

  afterAll(() => {
    if (realHomeForBlock === undefined) delete process.env.LAF_WORKSPACE
    else process.env.LAF_WORKSPACE = realHomeForBlock
    rmSync(outside, { recursive: true, force: true })
  })

  it('reads a file in a workspace that sits outside the home directory', async () => {
    const file = join(outside, 'report.txt')
    writeFileSync(file, '분기 매출 보고')
    const { tools } = await loadGate()
    const result = await tools.get('read_file')?.execute('c', { path: file })
    expect(result?.content[0]?.text).toContain('분기 매출')
  })

  it('still reaches the home directory from an outside workspace', async () => {
    const file = join(home, 'from-home.txt')
    writeFileSync(file, 'home file')
    const { tools } = await loadGate()
    const result = await tools.get('read_file')?.execute('c', { path: file })
    expect(result?.content[0]?.text).toContain('home file')
  })

  it('still refuses hidden entries inside that workspace', async () => {
    const secret = join(outside, '.env')
    writeFileSync(secret, 'API_KEY=leak-me')
    const { tools } = await loadGate()
    await expect(tools.get('read_file')?.execute('c', { path: secret })).rejects.toThrow(
      /hidden or system/,
    )
  })

  it('still refuses a path outside both roots', async () => {
    const { tools } = await loadGate()
    await expect(tools.get('read_file')?.execute('c', { path: '/etc/passwd' })).rejects.toThrow(
      /outside/,
    )
  })

  /** A home path seen from an outside workspace is reported in `~/…` form. */
  it('abbreviates a home path with a tilde', async () => {
    const { tools } = await loadGate()
    const result = await tools.get('write_file')?.execute('c', {
      path: join(home, 'tilde.txt'),
      content: 'hi',
    })
    expect(result?.content[0]?.text).toBe('Created ~/tilde.txt (2 B).')
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
