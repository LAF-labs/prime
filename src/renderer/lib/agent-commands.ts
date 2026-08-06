/**
 * CLI parity: every prime-agent slash command, available in the GUI.
 *
 * prime-agent classifies its commands three ways, and so do we:
 *
 * - **session** (`/goal`, `/autonomous`, `/compact`, `/refine`) — the agent
 *   session executes these itself on any transport, so sending them verbatim
 *   through the RPC `prompt` command reproduces the CLI exactly. We never
 *   intercept them.
 * - **rpc** — a typed RPC command does the same work (`clone`, `export_html`,
 *   `set_session_name`, heartbeats, …). Routed through `ipc.agentRpcRequest`.
 * - **gui** — TUI chrome that a desktop app owns natively (settings, logs,
 *   changelog, keyboard shortcuts, analytics).
 *
 * `PASSTHROUGH` and `RPC_COMMANDS` are the source of truth for the slash
 * palette, so a command added here shows up in autocomplete automatically.
 */

import { ipc } from '@/lib/ipc'

export type CommandKind = 'session' | 'rpc' | 'gui'

export interface AgentCommandSpec {
  name: string
  description: string
  /** Shown in autocomplete after the name, e.g. "<objective>". */
  argumentHint?: string
  kind: CommandKind
}

/**
 * Commands the agent session executes itself — forwarded untouched so the
 * behavior is byte-identical to the CLI (same parser, same state machine).
 */
export const PASSTHROUGH_COMMANDS: readonly AgentCommandSpec[] = [
  { name: 'goal', description: 'Set a persistent objective the agent pursues across turns', argumentHint: '[--budget <tokens>] <objective> | status | pause | resume | clear', kind: 'session' },
  { name: 'autonomous', description: 'Keep working through quality gates without asking', argumentHint: 'on | off | status', kind: 'session' },
  { name: 'compact', description: 'Compact the conversation context now', argumentHint: '[instructions]', kind: 'session' },
  { name: 'refine', description: 'Apply an evidence-backed refinement to the agent harness', argumentHint: '[instructions]', kind: 'session' },
] as const

/** Commands backed by a typed prime-agent RPC call. */
export const RPC_COMMANDS: readonly AgentCommandSpec[] = [
  { name: 'clone', description: 'Duplicate this conversation into a new thread', kind: 'rpc' },
  { name: 'copy', description: 'Copy the last assistant reply to the clipboard', kind: 'rpc' },
  { name: 'export', description: 'Export this session to an HTML file', argumentHint: '[path]', kind: 'rpc' },
  { name: 'name', description: 'Name this session', argumentHint: '<name>', kind: 'rpc' },
  { name: 'rename', description: 'Rename this session', argumentHint: '<name>', kind: 'rpc' },
  { name: 'session', description: 'Show session stats (tokens, cost, context)', kind: 'rpc' },
  { name: 'thinking', description: 'Set reasoning effort', argumentHint: 'off | minimal | low | medium | high | xhigh', kind: 'rpc' },
  { name: 'effort', description: 'Set reasoning effort (alias for /thinking)', argumentHint: 'off | minimal | low | medium | high | xhigh', kind: 'rpc' },
  { name: 'heartbeat', description: 'Schedule a recurring nudge for this session', argumentHint: 'status | clear | <schedule> -- <prompt>', kind: 'rpc' },
] as const

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

const isThinkingLevel = (v: string): v is ThinkingLevel =>
  (THINKING_LEVELS as readonly string[]).includes(v)

/** Strip leading slashes and split "name rest". */
export const parseCommand = (input: string): { name: string; rest: string } => {
  const text = input.trim().replace(/^\/+/, '')
  const space = text.search(/\s/)
  if (space < 0) return { name: text.toLowerCase(), rest: '' }
  return { name: text.slice(0, space).toLowerCase(), rest: text.slice(space + 1).trim() }
}

export const isPassthroughCommand = (name: string): boolean =>
  PASSTHROUGH_COMMANDS.some((c) => c.name === name)

export interface RpcCommandResult {
  /** Text to surface in the transcript as a system message. */
  message?: string
  /** True when the command was recognized and executed. */
  handled: boolean
}

const formatStats = (data: Record<string, unknown>): string => {
  const tokens = data.tokens as Record<string, number> | undefined
  const ctx = data.contextUsage as Record<string, number> | undefined
  const cost = typeof data.cost === 'number' ? data.cost : undefined
  const parts: string[] = []
  if (data.sessionId) parts.push(`Session ${String(data.sessionId)}`)
  if (tokens) {
    parts.push(
      `Tokens — in ${tokens.input ?? 0}, out ${tokens.output ?? 0}, cache read ${tokens.cacheRead ?? 0} (total ${tokens.total ?? 0})`,
    )
  }
  if (ctx && ctx.contextWindow) {
    parts.push(`Context — ${ctx.tokens ?? 0} / ${ctx.contextWindow} (${ctx.percent ?? 0}%)`)
  }
  if (cost !== undefined) parts.push(`Cost — $${cost.toFixed(4)}`)
  if (data.sessionFile) parts.push(`File — ${String(data.sessionFile)}`)
  return parts.join('\n')
}

/**
 * Execute an RPC-backed command against a live thread.
 * Returns `handled: false` when the name isn't one of ours so the caller can
 * fall through to its own handling.
 */
export const runRpcCommand = async (
  taskId: string,
  name: string,
  rest: string,
): Promise<RpcCommandResult> => {
  switch (name) {
    case 'clone': {
      await ipc.agentRpcRequest(taskId, 'clone')
      return { handled: true, message: 'Cloned this conversation into a new session.' }
    }
    case 'copy': {
      const data = (await ipc.agentRpcRequest(taskId, 'get_last_assistant_text')) as { text?: string | null }
      const text = data?.text ?? ''
      if (!text) return { handled: true, message: 'Nothing to copy yet.' }
      await navigator.clipboard.writeText(text)
      return { handled: true, message: `Copied ${text.length} characters to the clipboard.` }
    }
    case 'export': {
      const data = (await ipc.agentRpcRequest(taskId, 'export_html', rest ? { outputPath: rest } : undefined)) as { path?: string }
      return { handled: true, message: data?.path ? `Exported to ${data.path}` : 'Exported the session.' }
    }
    case 'name':
    case 'rename': {
      if (!rest) return { handled: true, message: 'Usage: /name <session name>' }
      await ipc.agentRpcRequest(taskId, 'set_session_name', { name: rest })
      return { handled: true, message: `Session renamed to "${rest}".` }
    }
    case 'session': {
      const data = (await ipc.agentRpcRequest(taskId, 'get_session_stats')) as Record<string, unknown>
      return { handled: true, message: formatStats(data) || 'No session stats available.' }
    }
    case 'thinking':
    case 'effort': {
      const level = rest.trim().toLowerCase()
      if (!isThinkingLevel(level)) {
        return { handled: true, message: `Usage: /${name} ${THINKING_LEVELS.join(' | ')}` }
      }
      await ipc.setThinkingLevel(taskId, level)
      return { handled: true, message: `Reasoning effort set to ${level}.` }
    }
    case 'heartbeat': {
      const arg = rest.trim()
      if (!arg || arg === 'status') {
        const data = (await ipc.agentRpcRequest(taskId, 'get_heartbeat')) as { heartbeat?: Record<string, unknown> | null }
        const hb = data?.heartbeat
        return {
          handled: true,
          message: hb ? `Heartbeat: ${String(hb.schedule)} — "${String(hb.prompt)}" (${String(hb.status)})` : 'No heartbeat set.',
        }
      }
      if (arg === 'clear' || arg === 'pause' || arg === 'resume') {
        await ipc.agentRpcRequest(taskId, 'update_heartbeat', { action: arg })
        return { handled: true, message: `Heartbeat ${arg}ed.` }
      }
      const [schedule, prompt] = arg.split('--').map((p) => p.trim())
      if (!schedule || !prompt) {
        return { handled: true, message: 'Usage: /heartbeat <schedule> -- <prompt>   (or status | pause | resume | clear)' }
      }
      await ipc.agentRpcRequest(taskId, 'set_heartbeat', { schedule, prompt })
      return { handled: true, message: `Heartbeat set: ${schedule}` }
    }
    default:
      return { handled: false }
  }
}
