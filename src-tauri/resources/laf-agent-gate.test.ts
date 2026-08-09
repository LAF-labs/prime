// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const GATE = new URL('./laf-agent-gate.ts', import.meta.url).pathname

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
      payload: { model: 'claude-fable-5', messages: [], tools: [{ name: 'web_search' }, { name: 'read' }] },
    }) as { payload: { tools: Record<string, unknown>[] } } | undefined

    const tools = patched?.payload.tools ?? []
    expect(tools.filter((t) => t.name === 'web_search')).toHaveLength(1)
    expect(tools.find((t) => t.name === 'web_search')?.type).toBe('web_search_20250305')
    expect(tools.some((t) => t.name === 'read')).toBe(true)
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
