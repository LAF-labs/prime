export type AnalyticsEventKind =
  | 'session'
  | 'message_sent'
  | 'message_received'
  /**
   * Context-window occupancy at a point in time — how full the window is.
   * Goes down after compaction, so it is a gauge, never a total. `value` =
   * tokens in the window, `value2` = window size.
   */
  | 'token_usage'
  /**
   * Billable tokens actually consumed by a completed turn, and what they
   * cost. `detail` = `provider/model`, `value` = tokens, `value2` = USD.
   *
   * Separate from `token_usage` because they answer different questions and
   * summing occupancy would badly overcount: a 100k-token window re-read
   * every turn is 100k of context but only the uncached delta is billed.
   */
  | 'token_spend'
  | 'tool_call'
  | 'file_edited'
  | 'diff_stats'
  | 'slash_cmd'
  | 'model_used'
  | 'mode_switch'
  | 'thread_created'
  | 'mcp_used'
  | 'skill_used'

export interface AnalyticsEvent {
  readonly ts: number
  readonly kind: AnalyticsEventKind
  readonly project?: string
  readonly thread?: string
  readonly detail?: string
  readonly value?: number
  readonly value2?: number
}
