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

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>()

export function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
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
      if (language === 'text') throw err
      return getHighlighterPromise('text')
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
    void getHighlighterPromise('text').catch(() => undefined)
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
