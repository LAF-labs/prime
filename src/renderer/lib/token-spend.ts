/**
 * Billable token accounting.
 *
 * `usage_update` reports context-window occupancy — how full the window is
 * right now. That is a gauge: it drops after compaction and re-counts the same
 * tokens every turn. Charting it as "tokens used" overstates consumption and
 * has no relationship to a bill.
 *
 * What is billable comes from the agent's own session stats, which are
 * cumulative per session. So we snapshot after each turn and record the
 * delta — the tokens this turn actually added.
 *
 * ## Cost
 *
 * prime-agent prices the providers it knows about and reports `cost` directly;
 * we use that whenever it moves. Providers a user added themselves — an
 * OpenAI-compatible endpoint — carry no rates in `models.json`, so the agent
 * reports 0 forever. For those we price the delta from user-supplied rates
 * (Settings → provider rates, USD per million tokens). A provider with
 * neither is recorded with tokens and no cost, which is honest: we would
 * rather show nothing than a confident zero.
 */

/** Cumulative token counters as reported by `get_session_stats`. */
export interface SessionTokens {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}

export interface SessionStats {
  tokens?: SessionTokens
  cost?: number
}

/** USD per 1,000,000 tokens. */
export interface ProviderRate {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** The running totals we compare each turn against. */
export interface SpendSnapshot {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export const EMPTY_SNAPSHOT: SpendSnapshot = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
}

export const snapshotOf = (stats: SessionStats | null | undefined): SpendSnapshot => ({
  input: stats?.tokens?.input ?? 0,
  output: stats?.tokens?.output ?? 0,
  cacheRead: stats?.tokens?.cacheRead ?? 0,
  cacheWrite: stats?.tokens?.cacheWrite ?? 0,
  cost: stats?.cost ?? 0,
})

export interface SpendDelta {
  /** Billable tokens added by this turn. */
  tokens: number
  /** USD, or undefined when nothing can price it. */
  cost?: number
}

const MILLION = 1_000_000

/**
 * Difference between two snapshots.
 *
 * Counters only ever grow within a session, but a resumed or forked session
 * starts its own count — so a negative delta means "new session, not negative
 * usage" and the current value is treated as the whole delta.
 */
export const spendDelta = (
  previous: SpendSnapshot,
  current: SpendSnapshot,
  rate?: ProviderRate,
): SpendDelta => {
  const advance = (before: number, after: number) => (after >= before ? after - before : after)

  const input = advance(previous.input, current.input)
  const output = advance(previous.output, current.output)
  const cacheRead = advance(previous.cacheRead, current.cacheRead)
  const cacheWrite = advance(previous.cacheWrite, current.cacheWrite)
  const tokens = input + output + cacheRead + cacheWrite

  // The agent's own figure wins when it produced one.
  const reported = advance(previous.cost, current.cost)
  if (reported > 0) return { tokens, cost: reported }

  if (!rate) return { tokens }

  // Cache reads are usually far cheaper than fresh input and cache writes a
  // little dearer; fall back to the input rate when a provider doesn't
  // distinguish them rather than silently dropping those tokens.
  const cost =
    (input * rate.input +
      output * rate.output +
      cacheRead * (rate.cacheRead ?? rate.input) +
      cacheWrite * (rate.cacheWrite ?? rate.input)) /
    MILLION

  return { tokens, cost }
}

/** `provider/model` for attribution, tolerating a bare model id. */
export const spendDetail = (modelId: string | null | undefined): string | undefined =>
  modelId && modelId.length > 0 ? modelId : undefined

/** The provider half of a `provider/model` id, used to look up a rate. */
export const providerOf = (modelId: string | null | undefined): string | undefined => {
  if (!modelId) return undefined
  const slash = modelId.indexOf('/')
  return slash > 0 ? modelId.slice(0, slash) : undefined
}
