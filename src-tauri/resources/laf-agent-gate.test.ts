// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const GATE = new URL('./laf-agent-gate.ts', import.meta.url).pathname

// These tests serve fixtures from 127.0.0.1, which the gate's outbound URL
// guard refuses by design. The gate reads this at module scope, so it must be
// set before the first cache-busted import below.
process.env.LAF_ALLOW_LOCAL_FETCH = '1'

interface CapturedTool {
  name: string
  execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
}

interface Captured {
  tools: Map<string, CapturedTool>
  payloadHook?: (event: { payload: unknown }) => { payload: unknown } | undefined
}

/**
 * Load the gate with a stub host and capture what it registers.
 *
 * The gate reads `LAF_WEB_SEARCH_URL` at module scope, so each load has to be a
 * fresh evaluation — hence the cache-busting query on the dynamic import.
 */
async function loadGate(): Promise<Captured> {
  const captured: Captured = { tools: new Map() }
  const pi = {
    registerTool: (tool: CapturedTool) => captured.tools.set(tool.name, tool),
    registerCommand: () => {},
    on: (event: string, handler: (e: { payload: unknown }) => { payload: unknown } | undefined) => {
      if (event === 'before_provider_request') captured.payloadHook = handler
    },
  }
  const mod = await import(`${GATE}?endpoint=${process.env.LAF_WEB_SEARCH_URL ?? 'none'}`)
  mod.default(pi)
  return captured
}

describe('gate web search', () => {
  let server: Server
  let base: string

  beforeAll(async () => {
    // Stands in for a SearXNG instance: JSON on /search?format=json, 403 elsewhere,
    // which is exactly how an instance with its JSON API switched off behaves.
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/search' || url.searchParams.get('format') !== 'json') {
        res.writeHead(403).end('forbidden')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          results: [
            { title: 'Tauri v2', url: 'https://tauri.app/', content: 'Build smaller desktop apps.' },
            { title: 'No snippet', url: 'https://example.com/' },
          ],
        }),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    delete process.env.LAF_WEB_SEARCH_URL
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('registers web_fetch but not web_search when no endpoint is configured', async () => {
    delete process.env.LAF_WEB_SEARCH_URL
    const { tools } = await loadGate()
    expect(tools.has('web_fetch')).toBe(true)
    expect(tools.has('web_search')).toBe(false)
  })

  it('searches the configured endpoint and formats the results', async () => {
    process.env.LAF_WEB_SEARCH_URL = `${base}/`
    const { tools } = await loadGate()

    const result = (await tools.get('web_search')?.execute('call-1', { query: 'tauri v2' })) as {
      content: { text: string }[]
      details: { results: number }
    }
    const text = result.content[0]?.text ?? ''
    expect(text).toContain('1. Tauri v2')
    expect(text).toContain('https://tauri.app/')
    expect(text).toContain('Build smaller desktop apps.')
    expect(text).toContain('2. No snippet')
    expect(result.details.results).toBe(2)
  })

  it('names the fix when the endpoint serves no JSON', async () => {
    process.env.LAF_WEB_SEARCH_URL = `${base}/wrong-path`
    const { tools } = await loadGate()
    await expect(tools.get('web_search')?.execute('call-2', { query: 'x' })).rejects.toThrow(
      /search\.formats/,
    )
  })

  it('replaces its own web_search with the server-side tool on Anthropic', async () => {
    process.env.LAF_WEB_SEARCH_URL = base
    const { payloadHook } = await loadGate()
    const patched = payloadHook?.({
      payload: {
        model: 'claude-fable-5',
        system: 'You are a coding agent.',
        messages: [],
        tools: [{ name: 'web_search' }, { name: 'read', input_schema: { type: 'object' } }],
      },
    }) as { payload: { tools: Record<string, unknown>[] } } | undefined

    const tools = patched?.payload.tools ?? []
    expect(tools.filter((t) => t.name === 'web_search')).toHaveLength(1)
    expect(tools.find((t) => t.name === 'web_search')?.type).toBe('web_search_20250305')
    expect(tools.some((t) => t.name === 'read')).toBe(true)
  })

  it('leaves a gateway reselling claude-* over chat-completions untouched', async () => {
    // OpenCode Zen lists bare ids like `claude-sonnet-5` on an OpenAI-shaped
    // endpoint. Injecting a Messages-API tool there rejects the whole turn.
    process.env.LAF_WEB_SEARCH_URL = base
    const { payloadHook } = await loadGate()
    const patched = payloadHook?.({
      payload: {
        model: 'claude-sonnet-5',
        messages: [{ role: 'system', content: 'You are a coding agent.' }],
        tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }],
      },
    })
    expect(patched).toBeUndefined()
  })

  it('does not inject when nothing identifies the dialect', async () => {
    process.env.LAF_WEB_SEARCH_URL = base
    const { payloadHook } = await loadGate()
    const patched = payloadHook?.({ payload: { model: 'claude-sonnet-5', messages: [] } })
    expect(patched).toBeUndefined()
  })

  it('replaces its own web_search with the server-side tool on the Responses API', async () => {
    process.env.LAF_WEB_SEARCH_URL = base
    const { payloadHook } = await loadGate()
    const patched = payloadHook?.({
      payload: {
        model: 'gpt-5.2',
        input: [],
        tools: [
          { type: 'function', name: 'web_search' },
          { type: 'function', name: 'read' },
        ],
      },
    }) as { payload: { tools: Record<string, unknown>[] } } | undefined

    const tools = patched?.payload.tools ?? []
    expect(tools.filter((t) => t.type === 'function' && t.name === 'web_search')).toHaveLength(0)
    expect(tools.filter((t) => t.type === 'web_search')).toHaveLength(1)
    expect(tools.some((t) => t.name === 'read')).toBe(true)
  })

  it('leaves a provider without server-side search untouched', async () => {
    process.env.LAF_WEB_SEARCH_URL = base
    const { payloadHook } = await loadGate()
    const patched = payloadHook?.({
      payload: { model: 'llama-3.3-70b', messages: [], tools: [{ name: 'web_search' }] },
    })
    expect(patched).toBeUndefined()
  })
})

/**
 * Article extraction. This replaced a hand-written regex stripper: pulling an
 * article out of a page is a solved problem, and Readability — the library
 * behind Firefox Reader View — solves it for far more of the web than a
 * regex ever could. What the tests pin is the contract around it: a title
 * when there is an article, and a graceful fall back to the whole document
 * when there is not.
 */
describe('gate article extraction', () => {
  let server: Server
  let base: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/article') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(`<!doctype html><html><head><title>Quarterly report</title></head><body>
          <nav>Home About Contact Login Sign up Products Pricing Blog Careers</nav>
          <article><h1>Quarterly report</h1>
          <p>${'Revenue reached four hundred and twenty million won this quarter, up twelve percent. '.repeat(8)}</p>
          <p>${'Growth came from new customers and a higher repeat-purchase rate. '.repeat(8)}</p>
          </article>
          <footer>Copyright notice, terms of service, privacy policy</footer></body></html>`)
        return
      }
      if (url.pathname === '/json') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ name: 'left-pad', version: '1.3.0' }))
        return
      }
      // A fragment with no article structure at all.
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body><div>짧은 안내문</div></body></html>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('returns the article body with its title, and drops the page furniture', async () => {
    const { tools } = await loadGate()
    const result = (await tools.get('web_fetch')?.execute('c', { url: `${base}/article` })) as {
      content: { text: string }[]
      details: { title: string }
    }
    const text = result.content[0]?.text ?? ''
    expect(result.details.title).toBe('Quarterly report')
    expect(text).toContain('four hundred and twenty million won')
    expect(text).not.toContain('privacy policy')
    expect(text).not.toContain('Sign up')
  })

  /** Readability finds no article in an API response; the body still has to arrive. */
  it('falls back to the raw body for a non-article response', async () => {
    const { tools } = await loadGate()
    const result = (await tools.get('web_fetch')?.execute('c', { url: `${base}/json` })) as {
      content: { text: string }[]
      details: { title: string }
    }
    expect(result.details.title).toBe('')
    expect(result.content[0]?.text).toContain('"left-pad"')
  })

  it('falls back for a page too short to be an article', async () => {
    const { tools } = await loadGate()
    const result = (await tools.get('web_fetch')?.execute('c', { url: `${base}/fragment` })) as {
      content: { text: string }[]
      details: { title: string }
    }
    expect(result.content[0]?.text).toContain('짧은 안내문')
  })
})

describe('gate outbound URL guard', () => {
  it('refuses private, loopback, and metadata addresses when the test hook is off', async () => {
    delete process.env.LAF_ALLOW_LOCAL_FETCH
    try {
      const captured: Captured = { tools: new Map() }
      const pi = {
        registerTool: (tool: CapturedTool) => captured.tools.set(tool.name, tool),
        registerCommand: () => {},
        on: () => {},
      }
      const mod = await import(`${GATE}?guard=on`)
      mod.default(pi)
      const fetchTool = captured.tools.get('web_fetch')
      expect(fetchTool).toBeTruthy()
      for (const url of [
        'http://127.0.0.1:8080/secrets',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.5/',
        'http://192.168.1.1/',
        'http://localhost/',
        'http://[::1]/',
        'file:///etc/passwd',
      ]) {
        await expect(fetchTool?.execute('g', { url }), url).rejects.toThrow(/private or local|http\(s\)/)
      }
    } finally {
      process.env.LAF_ALLOW_LOCAL_FETCH = '1'
    }
  })
})
