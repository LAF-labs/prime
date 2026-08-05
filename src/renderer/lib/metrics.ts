/**
 * Observability metrics.
 *
 * Lightweight metric collection for performance monitoring and debugging.
 * Tracks durations, counts, and gauges for key operations.
 */

export interface MetricEntry {
  name: string
  value: number
  timestamp: number
  attributes?: Record<string, string>
}

interface MetricBucket {
  count: number
  sum: number
  min: number
  max: number
  lastValue: number
  lastTimestamp: number
}

const buckets = new Map<string, MetricBucket>()
const listeners: Array<(entry: MetricEntry) => void> = []

/**
 * Record a metric value (counter increment or gauge observation).
 */
export function recordMetric(
  name: string,
  value: number,
  attributes?: Record<string, string>,
): void {
  const now = Date.now()
  const key = attributes ? `${name}:${JSON.stringify(attributes)}` : name

  const bucket = buckets.get(key) ?? { count: 0, sum: 0, min: Infinity, max: -Infinity, lastValue: 0, lastTimestamp: 0 }
  bucket.count += 1
  bucket.sum += value
  bucket.min = Math.min(bucket.min, value)
  bucket.max = Math.max(bucket.max, value)
  bucket.lastValue = value
  bucket.lastTimestamp = now
  buckets.set(key, bucket)

  const entry: MetricEntry = { name, value, timestamp: now, attributes }
  for (const listener of listeners) {
    try { listener(entry) } catch { /* best-effort */ }
  }
}

/**
 * Record a duration metric (in milliseconds).
 */
export function recordDuration(
  name: string,
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  recordMetric(`${name}.duration_ms`, durationMs, attributes)
}

/**
 * Increment a counter metric.
 */
export function incrementCounter(
  name: string,
  attributes?: Record<string, string>,
): void {
  recordMetric(name, 1, attributes)
}

/**
 * Time an async operation and record its duration.
 */
export async function timeAsync<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string>,
): Promise<T> {
  const start = performance.now()
  try {
    const result = await fn()
    recordDuration(name, performance.now() - start, { ...attributes, outcome: 'success' })
    return result
  } catch (err) {
    recordDuration(name, performance.now() - start, { ...attributes, outcome: 'error' })
    throw err
  }
}

/**
 * Get a snapshot of all metric buckets (for debug panel display).
 */
export function getMetricSnapshot(): Array<{
  key: string
  count: number
  sum: number
  min: number
  max: number
  avg: number
  lastValue: number
  lastTimestamp: number
}> {
  return Array.from(buckets.entries()).map(([key, bucket]) => ({
    key,
    count: bucket.count,
    sum: bucket.sum,
    min: bucket.min === Infinity ? 0 : bucket.min,
    max: bucket.max === -Infinity ? 0 : bucket.max,
    avg: bucket.count > 0 ? bucket.sum / bucket.count : 0,
    lastValue: bucket.lastValue,
    lastTimestamp: bucket.lastTimestamp,
  }))
}

/**
 * Subscribe to metric events (for real-time display).
 */
export function onMetric(listener: (entry: MetricEntry) => void): () => void {
  listeners.push(listener)
  return () => {
    const idx = listeners.indexOf(listener)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

/**
 * Reset all metrics (for testing).
 */
export function resetMetrics(): void {
  buckets.clear()
}

// ── Pre-defined metric names ─────────────────────────────────────

export const METRICS = {
  /** IPC command round-trip time */
  IPC_DURATION: 'ipc.command',
  /** Agent turn duration (from send to turn_end) */
  TURN_DURATION: 'agent.turn',
  /** Title generation duration */
  TITLE_GENERATION: 'ai.title_generation',
  /** Branch name generation duration */
  BRANCH_GENERATION: 'ai.branch_generation',
  /** Commit message generation duration */
  COMMIT_GENERATION: 'ai.commit_generation',
  /** PR content generation duration */
  PR_GENERATION: 'ai.pr_generation',
  /** Git operation duration */
  GIT_OPERATION: 'git.operation',
  /** Terminal session count */
  TERMINAL_SESSIONS: 'terminal.sessions',
  /** VCS status refresh duration */
  VCS_STATUS_REFRESH: 'vcs.status_refresh',
} as const
