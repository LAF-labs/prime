export type TaskStatus = 'running' | 'paused' | 'completed' | 'error' | 'cancelled' | 'pending_permission'

// ── Tool calls (mirrors prime-agent tool_call / tool_call_update) ────────────

export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other'
export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

export interface ToolCallLocation {
  path: string
  line?: number | null
}

export interface ToolCallContentItem {
  type: 'content' | 'diff' | 'terminal'
  /** For type=content: text block */
  text?: string
  /** For type=diff */
  path?: string
  oldText?: string | null
  newText?: string
  /**
   * For type=diff: pre-computed line-level stats annotated by the Rust RPC
   * client (`commands::diff_stats::annotate_diff_content`). Equivalent to
   * `git diff --numstat` for the (oldText, newText) pair. Present on
   * `type === 'diff'` entries from live tool calls; may be absent on older
   * persisted data — treat absent values as 0.
   */
  linesAdded?: number
  linesRemoved?: number
  /** For type=terminal */
  terminalId?: string
}

export interface ToolCall {
  toolCallId: string
  title: string
  status: ToolCallStatus
  kind?: ToolKind
  locations?: ToolCallLocation[]
  content?: ToolCallContentItem[]
  rawInput?: unknown
  rawOutput?: unknown
  /** ISO timestamp of when the tool call first appeared.
   *  Used by the inline-tool-calls layout to order tool entries
   *  relative to the surrounding text. Optional for back-compat. */
  createdAt?: string
  /** ISO timestamp of when the tool call reached a terminal status
   *  (completed or failed). Used to compute and display the elapsed
   *  duration on web/fetch tool entries. Optional for back-compat. */
  completedAt?: string
}

/**
 * Anchor that records where a tool call appeared in the assistant prose
 * stream, so the timeline can interleave tool entries between text segments
 * when "Inline tool calls" is enabled. `at` is a UTF-16 character offset
 * into {@link TaskMessage.content}; `toolCallId` matches an entry in
 * {@link TaskMessage.toolCalls}.
 */
export interface ToolCallSplit {
  at: number
  toolCallId: string
}

// ── Plan (mirrors prime-agent plan entries) ───────────────────────────

export type PlanEntryStatus = 'pending' | 'in_progress' | 'completed'
export type PlanEntryPriority = 'high' | 'medium' | 'low'

export interface PlanStep {
  content: string
  status: PlanEntryStatus
  priority: PlanEntryPriority
}

// ── Messages ──────────────────────────────────────────────────────

export interface TaskMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  toolCalls?: ToolCall[]
  thinking?: string
  questionAnswers?: { question: string; answer: string }[]
  /**
   * Anchors recording where each tool call appeared in {@link content}
   * during streaming. Sorted ascending by `at`. Used by the inline-tool-calls
   * layout to interleave tool entries with text segments. Optional — older
   * persisted messages without splits fall back to grouped rendering.
   */
  toolCallSplits?: ToolCallSplit[]
  /**
   * For a system message reporting a failed turn: what the user can do about
   * it, as classified by the backend. Drives the action button on the error
   * card so a rejected key isn't just text saying to go somewhere.
   */
  errorAction?: import('@/lib/ipc').TaskErrorAction
}

// ── Task ──────────────────────────────────────────────────────────

export type CompactionStatus = 'idle' | 'compacting' | 'completed' | 'failed'

export interface AgentTask {
  id: string
  name: string
  workspace: string
  status: TaskStatus
  createdAt: string
  messages: TaskMessage[]
  pendingPermission?: {
    requestId: string
    toolName: string
    description: string
    options: Array<{ optionId: string; name: string; kind: string }>
  }
  /** Live tool calls for the current turn (cleared on turn end) */
  liveToolCalls?: ToolCall[]
  /** Live thinking text for the current turn */
  liveThinking?: string
  /** Current plan */
  plan?: PlanStep[]
  /** Context usage: used / size */
  contextUsage?: { used: number; size: number } | null
  /** Current compaction status */
  compactionStatus?: CompactionStatus
  agentProfileId?: string
  /** True only when the user explicitly hit Pause mid-run (not draft/idle) */
  userPaused?: boolean
  /** Task ID of the parent thread this was forked from */
  parentTaskId?: string
  /** prime-agent session JSONL path — enables native resume/fork */
  sessionFile?: string
  /** True for threads restored from persisted history. The thread renders
   *  immediately but its prime-agent connection has been torn down — the
   *  next send spawns a fresh subprocess (stateless resumption)
   *  and the historical transcript is replayed as preamble context. */
  isArchived?: boolean
  /** Path to the git worktree directory, if this thread uses one */
  worktreePath?: string
  /** Original workspace path before worktree was created */
  originalWorkspace?: string
  /** Canonical project workspace path — threads always group under this */
  projectId?: string
  /** True for restored threads whose backend connection was destroyed */
  needsNewConnection?: boolean
}

// ── Soft-deleted threads ──────────────────────────────────────────

export interface SoftDeletedThread {
  readonly task: AgentTask
  readonly deletedAt: string
}

// ── Profiles ──────────────────────────────────────────────────────

export interface AgentProfile {
  id: string
  name: string
  agentId: string
  tags: string[]
  isDefault: boolean
}

export interface ActivityEntry {
  taskId: string
  taskName: string
  status: TaskStatus
  timestamp: string
}

export interface TextGenerationPolicy {
  commitInstructions?: string
  branchInstructions?: string
  threadTitleInstructions?: string
  prInstructions?: string
}

/** Three-tier permission model. See `lib/permission-rules.ts`. */
export type PermissionMode = 'ask' | 'acceptEdits' | 'auto'

/**
 * A persistent allow-rule. `tool` matches the tool name exactly; `argPattern`,
 * when set, is a simple glob (`*` wildcard) matched against the tool's primary
 * argument (command for bash, first code line for ipython, path for edits).
 * A rule with no `argPattern` is tool-wide.
 */
export interface PermissionRule {
  tool: string
  argPattern?: string
}

/**
 * Reasoning effort levels, mirroring the harness's `THINKING_LEVELS`. Which of
 * these a session actually accepts depends on the model, so the picker asks the
 * agent (`availableThinkingLevels`) instead of offering all seven blindly.
 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export const isThinkingLevel = (v: unknown): v is ThinkingLevel =>
  typeof v === 'string' && (THINKING_LEVELS as readonly string[]).includes(v)

export interface ProjectPrefs {
  modelId?: string | null
  autoApprove?: boolean
  /** Per-project permission mode override. */
  permissionMode?: PermissionMode
  /** Per-project allow-rules, merged on top of the global list at spawn. */
  permissionRules?: PermissionRule[]
  worktreeEnabled?: boolean
  symlinkDirectories?: string[]
  tightSandbox?: boolean
  iconOverride?: { type: 'framework'; id: string } | { type: 'file'; path: string } | { type: 'emoji'; emoji: string } | null
  textGenerationPolicy?: TextGenerationPolicy
}

export type SidebarPosition = 'left' | 'right'
export type ThemeMode = 'dark' | 'light' | 'system'

export interface AppSettings {
  agentBin: string
  agentProfiles: AgentProfile[]
  /** Global UI font size in px (sidebar, file tree, header, dialogs, etc.). */
  fontSize: number
  /**
   * Chat content font size in px (markdown body, assistant text, user message bubble,
   * and the chat textarea / "Type a message" affordance). Falls back to {@link fontSize}.
   */
  chatFontSize?: number
  defaultModel?: string | null
  autoApprove?: boolean
  /**
   * Permission mode: 'ask' (prompt on every mutating tool), 'acceptEdits'
   * (auto-allow file edits, still prompt for exec/others), or 'auto' (allow
   * everything). When absent, derived from {@link autoApprove} for backward
   * compatibility. Kept in sync with autoApprove ('auto' ⟺ true).
   */
  permissionMode?: PermissionMode
  /** Persistent allow-rules the gate evaluates before prompting. */
  permissionRules?: PermissionRule[]
  respectGitignore?: boolean
  coAuthor?: boolean
  coAuthorJsonReport?: boolean
  /** When true, render an AI sparkle button next to the commit input. Default: true. */
  aiCommitMessages?: boolean
  notifications?: boolean
  soundNotifications?: boolean
  /** Agent auto-compaction (harness default: on). Applied per session over RPC. */
  agentAutoCompaction?: boolean
  /** Agent auto-retry on transient provider errors (harness default: on). */
  agentAutoRetry?: boolean
  /** Queued-message steering: 'one-at-a-time' (harness default) or 'all'. */
  steeringMode?: 'one-at-a-time' | 'all'
  projectPrefs?: Record<string, ProjectPrefs>
  /**
   * Reasoning effort remembered per model id (`provider/id` → level). Effort is
   * a property of the model, not the project — a cheap model and a frontier
   * model want different budgets in the same repo.
   */
  modelEfforts?: Record<string, ThinkingLevel>
  hasOnboardedV2?: boolean
  sidebarPosition?: SidebarPosition
  /** Theme mode: dark, light, or system (follows OS preference). Default: dark. */
  theme?: ThemeMode
  /** App display language: 'system' follows the OS; 'en' | 'ko' force a locale. */
  language?: 'system' | 'en' | 'ko'
  /** Max character limit for /btw side questions. Default: 1220. */
  btwMaxChars?: number
  /** Base64 data URL for a user-supplied app icon (About dialog + dock). */
  customAppIcon?: string | null
  /** Last app version whose changelog the user has seen. Used to show the "What's New" dialog once per upgrade. */
  lastSeenChangelogVersion?: string | null
  /** Terminal scrollback line cap. Lower = less memory per open terminal. Default: 2000. */
  terminalScrollback?: number
  /** Auto-close background terminal tabs after this many minutes of no PTY activity. null = disabled. Default: null. */
  terminalAutoCloseIdleMins?: number | null
  /**
   * Which surface the app presents. `simple` is chat-first with developer
   * chrome (git, terminal, diff) hidden; `developer` shows everything.
   * Absent on installs that predate the split — see `resolveUiMode`.
   */
  uiMode?: 'simple' | 'developer'
  /**
   * Keep a menu-bar icon so the app stays reachable with every window closed.
   * Default off — a status item the user did not ask for is clutter.
   */
  menuBarIcon?: boolean
  /**
   * System-wide summon shortcut in Tauri accelerator syntax
   * (`CmdOrCtrl+Shift+A`). Empty/absent registers nothing: while registered the
   * combination is taken from every other app, so it stays opt-in.
   */
  summonShortcut?: string | null
  /**
   * When true, tool calls render inline within the assistant's prose at the
   * exact point where the agent invoked them — similar to Cursor.
   * When false (default), tool calls are grouped into a single card after
   * the assistant text. Only affects rendering; persisted data is the same.
   */
  inlineToolCalls?: boolean
  /**
   * Auto-archive threads older than this many days of inactivity.
   * null or 0 = disabled. Default: null (disabled).
   */
  autoArchiveDays?: number | null
  /**
   * Local usage statistics. Everything stays on this machine either way —
   * there is no telemetry client — but off means nothing is recorded at all.
   * Absent means enabled, matching the Rust default.
   */
  analyticsEnabled?: boolean
  /**
   * How many agent processes may run at once. Each live thread is a Node
   * process with its own Python kernel. Undefined uses the backend default
   * (8); 0 removes the limit.
   */
  maxConcurrentAgents?: number | null
  /**
   * Manual token pricing keyed by provider name, in **USD per 1M tokens**.
   * prime-agent only prices its built-in providers, so a user-registered
   * OpenAI-compatible provider always reports a cost of 0 without this.
   */
  providerRates?: Record<string, ProviderRate>
}

/** Token pricing for one provider. Every field is **USD per 1M tokens**. */
export interface ProviderRate {
  /** Price per 1M input (prompt) tokens. */
  input: number
  /** Price per 1M output (completion) tokens. */
  output: number
  /** Price per 1M cache-read tokens. Omitted when the user left it blank. */
  cacheRead?: number
  /** Price per 1M cache-write tokens. Omitted when the user left it blank. */
  cacheWrite?: number
}

export interface ProjectFile {
  path: string
  name: string
  dir: string
  isDir: boolean
  ext: string
  /** Git status: "M" modified, "A" added/new, "D" deleted, "R" renamed, "" clean */
  gitStatus?: string
  /** Lines added in working copy (0 if unchanged) */
  linesAdded?: number
  /** Lines deleted in working copy (0 if unchanged) */
  linesDeleted?: number
  /** File modification time as Unix epoch seconds */
  modifiedAt: number
}

// ── Agent Configuration Types ──────────────────────────────────────

export interface AgentAgentHook {
  command: string
  matcher?: string
}

export interface AgentAgentHooks {
  agentSpawn?: AgentAgentHook[]
  userPromptSubmit?: AgentAgentHook[]
  preToolUse?: AgentAgentHook[]
  postToolUse?: AgentAgentHook[]
  stop?: AgentAgentHook[]
}

export interface AgentAgent {
  name: string
  description: string
  tools: string[]
  source: 'global' | 'local'
  filePath: string
  welcomeMessage?: string
  keyboardShortcut?: string
  model?: string
  resources?: string[]
  hooks?: AgentAgentHooks
}

export interface AgentSkill {
  name: string
  source: 'global' | 'local'
  filePath: string
}

export interface AgentSteeringRule {
  name: string
  alwaysApply: boolean
  source: 'global' | 'local'
  excerpt: string
  filePath: string
}

export interface McpServerConfig {
  name: string
  enabled: boolean
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  error?: string
  disabledTools?: string[]
  filePath: string
  status?: 'connecting' | 'ready' | 'needs-auth' | 'error'
  oauthUrl?: string
  source: 'global' | 'local'
}

export interface AgentPrompt {
  name: string
  content: string
  source: 'global' | 'local'
  filePath: string
}

export interface AgentResources {
  agents: AgentAgent[]
  skills: AgentSkill[]
  steeringRules: AgentSteeringRule[]
  mcpServers?: McpServerConfig[]
  prompts: AgentPrompt[]
}

// ── Attachments ───────────────────────────────────────────────────

export type AttachmentType = 'image' | 'text' | 'binary'

export interface Attachment {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly type: AttachmentType
  readonly size: number
  readonly mimeType: string
  /** Base64 data URL for image previews */
  preview?: string
  /** Text content for text files */
  textContent?: string
  /** Base64 content for binary embedding */
  base64Content?: string
}

/** Structured image attachment data sent to the Rust backend via IPC (fix #14). */
export interface IpcAttachment {
  readonly base64: string
  readonly mimeType: string
  readonly name: string
}

// ── Debug Panel Types ─────────────────────────────────────────────

export type DebugCategory = 'notification' | 'request' | 'response' | 'error' | 'stderr' | 'lifecycle'

export interface DebugLogEntry {
  id: number
  timestamp: string
  direction: 'in' | 'out'
  category: DebugCategory
  type: string
  taskId: string | null
  summary: string
  payload: unknown
  isError: boolean
  mcpServerName?: string
}

// ── JS Debug Panel Types ──────────────────────────────────────────

export type JsDebugCategory = 'log' | 'warn' | 'error' | 'exception' | 'network' | 'rust'

export interface JsDebugEntry {
  readonly id: number
  readonly timestamp: string
  readonly category: JsDebugCategory
  readonly message: string
  readonly detail: string
  readonly isError: boolean
  /** Active task ID at capture time */
  readonly taskId?: string | null
  /** Active thread name at capture time */
  readonly threadName?: string | null
  /** Active project (workspace basename) at capture time */
  readonly projectName?: string | null
  /** Network request fields */
  readonly url?: string
  readonly method?: string
  readonly status?: number
  readonly duration?: number
}
