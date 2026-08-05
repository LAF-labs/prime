import type { AnalyticsEvent, AnalyticsEventKind } from '@/types/analytics'
import { ipc } from '@/lib/ipc'

const FLUSH_INTERVAL_MS = 60_000

let buffer: AnalyticsEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null

/** Record an analytics event into the in-memory buffer. */
export const record = (kind: AnalyticsEventKind, fields?: Omit<AnalyticsEvent, 'ts' | 'kind'>): void => {
  buffer.push({ ts: Date.now(), kind, ...fields })
}

/** Flush buffered events to the Rust backend. Fire-and-forget. */
export const flush = (): void => {
  if (buffer.length === 0) return
  const batch = buffer.splice(0)
  ipc.analyticsSave(batch).catch(() => {
    // On failure, push events back so they aren't lost
    buffer.unshift(...batch)
  })
}

/** Start the auto-flush interval and beforeunload listener. */
export const startAutoFlush = (): void => {
  if (flushTimer) return
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS)
  window.addEventListener('beforeunload', flush)
}

/** Stop auto-flush and remove the listener. */
export const stopAutoFlush = (): void => {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  window.removeEventListener('beforeunload', flush)
  flush() // final flush
}

/** Return the current buffer length (for testing). */
export const bufferSize = (): number => buffer.length

/** Clear the buffer without flushing (for testing). */
export const resetBuffer = (): void => { buffer = [] }
