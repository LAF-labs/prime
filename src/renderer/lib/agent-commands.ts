/**
 * CLI parity: the slash commands LAF Agent answers to, and how each one runs.
 *
 * This module is the **only** registry of client-side commands. The slash
 * palette, the autocomplete descriptions, and the dispatchers in
 * `useSlashAction` all read from it, so adding an entry here is enough to make
 * a command discoverable and executable.
 *
 * prime-agent reaches us three different ways, so commands fall into three
 * kinds:
 *
 * - **session** (`/goal`, `/autonomous`, `/compact`, `/refine`) — the agent
 *   session executes these itself on any transport, so sending them verbatim
 *   through the RPC `prompt` command reproduces the CLI exactly. We never
 *   intercept them.
 * - **rpc** — a typed prime-agent RPC command does the same work (`clone`,
 *   `export_html`, `set_session_name`, heartbeats, …). Routed through
 *   `ipc.agentRpcRequest`.
 * - **gui** — TUI chrome a desktop app owns natively: settings, logs,
 *   changelog, shortcuts, analytics, thread lifecycle. We keep the CLI's name
 *   as the entry point so muscle memory carries over.
 *
 * A fourth group arrives at runtime rather than from here: `get_commands`
 * returns the agent's **extensions, prompt templates, and skills** (never its
 * built-ins — see `createAgentConnectionCommands` in prime-agent). Those merge
 * into the palette in `useChatInput` and execute through a plain `prompt`,
 * because `AgentSession` dispatches extension commands and `/skill:` expansion
 * on every transport.
 *
 * ## Deliberately absent
 *
 * These CLI commands drive the terminal UI itself and have no RPC method
 * behind them, so there is nothing for a desktop client to call. Listing them
 * would send the literal text `/fast` to the model, which is worse than
 * leaving them out:
 *
 * | Command | Why not |
 * |---|---|
 * | `/fullscreen` | Alternate-screen rendering — meaningless in a window |
 * | `/scoped-models` | Scopes the TUI's Ctrl+P cycling; the model picker covers it |
 * | `/fast` | Toggles OpenAI Fast mode through TUI state only |
 * | `/share` | Uploads a secret GitHub gist; no RPC method |
 * | `/traces` | Trace upload/config; no RPC method |
 * | `/rlm-max-depth` | No RPC method |
 * | `/heartbeats` | Cross-session heartbeat manager; only the per-session
 *   `get`/`set`/`update_heartbeat` methods are exposed |
 *
 * Descriptions are English source strings translated at render time — see
 * `t()` in `@/lib/i18n`. Keep them short enough to sit on one palette row.
 */

import { ipc } from '@/lib/ipc'
import { t } from '@/lib/i18n'

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
] as const

/** Commands backed by a typed prime-agent RPC call. */
export const RPC_COMMANDS: readonly AgentCommandSpec[] = [
  { name: 'clone', description: 'Duplicate this conversation into a new thread', kind: 'rpc' },
  { name: 'copy', description: 'Copy the last assistant reply to the clipboard', kind: 'rpc' },
  { name: 'export', description: 'Export this session to an HTML file', argumentHint: '[path]', kind: 'rpc' },
  { name: 'name', description: 'Name this session', argumentHint: '<name>', kind: 'rpc' },
  { name: 'rename', description: 'Rename this session', argumentHint: '<name>', kind: 'rpc' },
  { name: 'session', description: 'Show session stats (tokens, cost, context)', kind: 'rpc' },
  { name: 'context', description: 'Show token, cost, and context usage', kind: 'rpc' },
  { name: 'thinking', description: 'Set reasoning effort', argumentHint: 'off | minimal | low | medium | high | xhigh', kind: 'rpc' },
  { name: 'effort', description: 'Set reasoning effort (alias for /thinking)', argumentHint: 'off | minimal | low | medium | high | xhigh', kind: 'rpc' },
  { name: 'heartbeat', description: 'Schedule a recurring nudge for this session', argumentHint: 'status | clear | <schedule> -- <prompt>', kind: 'rpc' },
] as const

/**
 * Commands the desktop app handles itself, dispatched by `useSlashAction`.
 *
 * The first group is native to a GUI; the second keeps the CLI's name for a
 * place the app already had (`/login` opens the
 * provider settings) so someone coming from the terminal finds it by typing
 * what they already know.
 */
export const GUI_COMMANDS: readonly AgentCommandSpec[] = [
  { name: 'new', description: 'Start a new thread in this project', kind: 'gui' },
  { name: 'clear', description: 'Clear the current conversation', kind: 'gui' },
  { name: 'close', description: 'Close and archive the current thread', kind: 'gui' },
  { name: 'exit', description: 'Close and archive the current thread', kind: 'gui' },
  { name: 'btw', description: 'Ask a side question without adding it to the session', argumentHint: '<question>', kind: 'gui' },
  { name: 'tangent', description: 'Ask a side question (alias for /btw)', argumentHint: '<question>', kind: 'gui' },
  { name: 'model', description: 'Switch the active model', kind: 'gui' },
  { name: 'agent', description: 'Switch between agents or list available ones', kind: 'gui' },
  { name: 'plan', description: 'Toggle plan mode on or off', kind: 'gui' },
  { name: 'upload', description: 'Attach images or files', kind: 'gui' },
  { name: 'settings', description: 'Open settings', kind: 'gui' },
  { name: 'login', description: 'Configure provider authentication', kind: 'gui' },
  { name: 'logout', description: 'Remove provider authentication', kind: 'gui' },
  { name: 'mcp', description: 'Manage MCP connections', kind: 'gui' },
  { name: 'hotkeys', description: 'Show all keyboard shortcuts', kind: 'gui' },
  { name: 'changelog', description: 'Show what changed in this release', kind: 'gui' },
  { name: 'usage', description: 'Open the analytics dashboard', kind: 'gui' },
  { name: 'data', description: 'Open the analytics dashboard (alias for /usage)', kind: 'gui' },
] as const

/** Every command this client knows, in palette order. */
export const CLIENT_COMMANDS: readonly AgentCommandSpec[] = [
  ...PASSTHROUGH_COMMANDS,
  ...RPC_COMMANDS,
  ...GUI_COMMANDS,
] as const

/** The palette for a given surface. Simple mode drops developer-only rows. */
export const visibleClientCommands = (): readonly AgentCommandSpec[] => CLIENT_COMMANDS

/** Palette rows the agent advertises but the app never wants shown. */
// `reload` re-reads extensions and themes; `skill:*` is covered below. Both
// are harness plumbing, and this palette is read by people who are not
// operating a harness.
const HIDDEN_COMMANDS = new Set(['reply', 'reload'])

const bareName = (name: string): string => name.replace(/^\/+/, '')

/**
 * Merge the agent's runtime commands (extensions, prompt templates, skills)
 * with this client's registry into one palette.
 *
 * The agent's own commands come first because they are project-specific, and a
 * name it already advertises wins so a project can override a built-in.
 *
 * Skills are not listed at all.
 *
 * A skill is a procedure the model follows when a request matches it — the
 * user asks "tidy up my Downloads" and never types `/skill:organize-files`.
 * What the palette showed was the plumbing: a folder name in kebab-case and a
 * description written to tell a model when to reach for the file. Neither is
 * copy for a person, and translating them would mean maintaining the same
 * procedure twice, in two voices, for two audiences.
 *
 * Hidden, not disabled. Typing `/skill:organize-files` still runs it, which
 * keeps it reachable for us without putting it in front of someone who came
 * here to tidy a folder.
 *
 * `describe` translates a registry description — passed in rather than called
 * here so the caller controls when the active locale is read.
 */
export const mergePaletteCommands = <T extends { name: string; description?: string }>(
  agentCommands: readonly T[],
  describe: (source: string) => string,
): Array<T | { name: string; description: string }> => {
  const fromAgent = agentCommands.filter((c) => {
    const name = bareName(c.name)
    if (HIDDEN_COMMANDS.has(name)) return false
    if (name.startsWith('skill:')) return false
    return true
  })
  const advertised = new Set(fromAgent.map((c) => bareName(c.name)))
  const ours = visibleClientCommands()
    .filter((c) => !advertised.has(c.name) && !HIDDEN_COMMANDS.has(c.name))
    .map((c) => ({ name: c.name, description: describe(c.description) }))
  return [...fromAgent, ...ours]
}

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
  if (data.sessionId) parts.push(t('Session {id}', { id: String(data.sessionId) }))
  if (tokens) {
    parts.push(
      t('Tokens — in {in}, out {out}, cache read {cache} (total {total})', {
        in: String(tokens.input ?? 0), out: String(tokens.output ?? 0),
        cache: String(tokens.cacheRead ?? 0), total: String(tokens.total ?? 0),
      }),
    )
  }
  if (ctx && ctx.contextWindow) {
    parts.push(t('Context — {used} / {window} ({percent}%)', { used: String(ctx.tokens ?? 0), window: String(ctx.contextWindow), percent: String(ctx.percent ?? 0) }))
  }
  if (cost !== undefined) parts.push(t('Cost — ${amount}', { amount: cost.toFixed(4) }))
  if (data.sessionFile) parts.push(t('File — {path}', { path: String(data.sessionFile) }))
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
      return { handled: true, message: t('Cloned this conversation into a new session.') }
    }
    case 'copy': {
      const data = (await ipc.agentRpcRequest(taskId, 'get_last_assistant_text')) as { text?: string | null }
      const text = data?.text ?? ''
      if (!text) return { handled: true, message: t('Nothing to copy yet.') }
      await navigator.clipboard.writeText(text)
      return { handled: true, message: t('Copied {count} characters to the clipboard.', { count: String(text.length) }) }
    }
    case 'export': {
      const data = (await ipc.agentRpcRequest(taskId, 'export_html', rest ? { outputPath: rest } : undefined)) as { path?: string }
      return { handled: true, message: data?.path ? t('Exported to {path}', { path: data.path }) : t('Exported the session.') }
    }
    case 'name':
    case 'rename': {
      if (!rest) return { handled: true, message: t('Usage: /name <session name>') }
      await ipc.agentRpcRequest(taskId, 'set_session_name', { name: rest })
      return { handled: true, message: t('Session renamed to "{name}".', { name: rest }) }
    }
    case 'session':
    case 'context': {
      const data = (await ipc.agentRpcRequest(taskId, 'get_session_stats')) as Record<string, unknown>
      return { handled: true, message: formatStats(data) || t('No session stats available.') }
    }
    case 'thinking':
    case 'effort': {
      const level = rest.trim().toLowerCase()
      if (!isThinkingLevel(level)) {
        return { handled: true, message: t('Usage: /{name} {levels}', { name, levels: THINKING_LEVELS.join(' | ') }) }
      }
      await ipc.setThinkingLevel(taskId, level)
      return { handled: true, message: t('Reasoning effort set to {level}.', { level }) }
    }
    case 'heartbeat': {
      const arg = rest.trim()
      if (!arg || arg === 'status') {
        const data = (await ipc.agentRpcRequest(taskId, 'get_heartbeat')) as { heartbeat?: Record<string, unknown> | null }
        const hb = data?.heartbeat
        return {
          handled: true,
          message: hb ? t('Heartbeat: {schedule} — "{prompt}" ({status})', { schedule: String(hb.schedule), prompt: String(hb.prompt), status: String(hb.status) }) : t('No heartbeat set.'),
        }
      }
      if (arg === 'clear' || arg === 'pause' || arg === 'resume') {
        await ipc.agentRpcRequest(taskId, 'update_heartbeat', { action: arg })
        return { handled: true, message: t('Heartbeat updated: {action}', { action: arg }) }
      }
      const [schedule, prompt] = arg.split('--').map((p) => p.trim())
      if (!schedule || !prompt) {
        return { handled: true, message: t('Usage: /heartbeat <schedule> -- <prompt>   (or status | pause | resume | clear)') }
      }
      await ipc.agentRpcRequest(taskId, 'set_heartbeat', { schedule, prompt })
      return { handled: true, message: t('Heartbeat set: {schedule}', { schedule }) }
    }
    default:
      return { handled: false }
  }
}
