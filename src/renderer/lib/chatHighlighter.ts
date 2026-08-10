/**
 * Lazy-loaded chat code-block highlighter.
 *
 * `@pierre/diffs` is dynamically imported so the Shiki WASM runtime stays
 * out of the initial bundle. The first call for a given language fetches
 * the runtime, instantiates the highlighter, and caches the resulting
 * promise so subsequent calls (or theme switches that re-render code
 * blocks) share work.
 *
 * Fallback chain:
 *   1. If `language` fails to load, retry as `'text'` and cache that promise.
 *   2. The failed promise is removed from the cache so we don't keep
 *      handing out a rejected promise on subsequent calls.
 *   3. If `'text'` itself fails, surface the error — Shiki cannot init.
 */
import type { DiffsHighlighter, SupportedLanguages } from '@pierre/diffs'
import { resolveDiffThemeName } from './diffRendering'

/**
 * Grammars this app ships, by canonical shiki module name.
 *
 * LAF Agent is an everyday agent — its users write documents, query data and
 * run the occasional script. Shiki bundles 332 languages, and every one of
 * them was emitted as its own chunk: 10.5 MB of the 12.4 MB frontend build
 * was grammars like emacs-lisp (764 kB) and Wolfram (260 kB) that this
 * audience will never open a code fence for.
 *
 * `vite.config.ts` stubs out every grammar module missing from this list, so
 * the list and the build are one decision. Anything not here highlights as
 * plain text, which is what an unknown language already did.
 *
 * `html` embeds `javascript` and `css`; both are here. No other entry embeds
 * a language, so the set is closed.
 */
export const BUNDLED_GRAMMARS = [
  'css', 'diff', 'html', 'javascript', 'json', 'jsonc', 'jsx',
  'markdown', 'python', 'shellscript', 'sql', 'tsx', 'typescript',
] as const

/**
 * Fence tags mapped to the grammar that renders them. Shiki accepts these as
 * aliases, but we resolve them here so the allowlist is checked against one
 * canonical name rather than every spelling a user might type.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'shellscript', sh: 'shellscript', shell: 'shellscript', zsh: 'shellscript',
  console: 'shellscript', 'shell-session': 'shellscript',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', python3: 'python',
  md: 'markdown', mdown: 'markdown',
  htm: 'html',
  json5: 'jsonc',
  psql: 'sql', mysql: 'sql', sqlite: 'sql',
}

/** Shiki renders this without loading a grammar. */
export const PLAIN_TEXT = 'text'

/**
 * Resolve a code fence's tag to a grammar this build actually ships.
 *
 * Returns [`PLAIN_TEXT`] for anything unknown or excluded — the same
 * treatment an unrecognised tag has always had, so a Rust or Go block still
 * renders, just without colour.
 */
export function normalizeLanguage(language: string): string {
  const tag = language.trim().toLowerCase()
  if (!tag) return PLAIN_TEXT
  const canonical = LANGUAGE_ALIASES[tag] ?? tag
  return (BUNDLED_GRAMMARS as readonly string[]).includes(canonical) ? canonical : PLAIN_TEXT
}

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>()

export function getHighlighterPromise(requestedLanguage: string): Promise<DiffsHighlighter> {
  // Normalizing here rather than at the call sites means no path can ask for
  // a grammar the build stubbed out.
  const language = normalizeLanguage(requestedLanguage)
  const cached = highlighterPromiseCache.get(language)
  if (cached) return cached

  const promise = import('@pierre/diffs')
    .then(({ getSharedHighlighter }) =>
      getSharedHighlighter({
        themes: [resolveDiffThemeName('dark'), resolveDiffThemeName('light')],
        langs: [language as SupportedLanguages],
        // shiki-wasm uses the Oniguruma WASM regex engine. Compiled grammars
        // are smaller than shiki-js's pure-JS engine, so cold start once the
        // chunk arrives is faster.
        preferredHighlighter: 'shiki-wasm',
      }),
    )
    .catch((err: unknown) => {
      highlighterPromiseCache.delete(language)
      if (language === PLAIN_TEXT) throw err
      return getHighlighterPromise(PLAIN_TEXT)
    })
  highlighterPromiseCache.set(language, promise)
  return promise
}

/**
 * Warm the highlighter cache in the background so the first real chat code
 * block doesn't have to wait for the shiki chunk + runtime + grammar to
 * download from cold.
 *
 * Schedules itself on `requestIdleCallback` when available, falling back to
 * `setTimeout(..., 0)` (Safari, older WebViews). Intended to be called
 * exactly once after first paint.
 *
 * The returned cleanup cancels the pending idle callback if the caller
 * unmounts before the work runs. The fetch itself is not cancelable, but a
 * stray preload is harmless — it just populates a cache that the chat
 * component will read later.
 */
export function preloadHighlighterIdle(): () => void {
  if (typeof window === 'undefined') return () => {}

  const w = window as Window & {
    requestIdleCallback?: (
      cb: () => void,
      opts?: { timeout: number },
    ) => number
    cancelIdleCallback?: (id: number) => void
  }

  let cancelled = false
  let idleId: number | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const run = () => {
    if (cancelled) return
    // Swallow rejections — `getHighlighterPromise` already handles its own
    // error path and we don't want an unhandled-rejection log just because
    // a pre-warm failed.
    void getHighlighterPromise(PLAIN_TEXT).catch(() => undefined)
  }

  if (typeof w.requestIdleCallback === 'function') {
    idleId = w.requestIdleCallback(run, { timeout: 4000 })
  } else {
    timeoutId = setTimeout(run, 0)
  }

  return () => {
    cancelled = true
    if (idleId !== null && typeof w.cancelIdleCallback === 'function') {
      w.cancelIdleCallback(idleId)
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }
}
