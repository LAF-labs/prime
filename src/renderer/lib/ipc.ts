import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AgentTask, AppSettings, AgentResources, ToolCall, DebugLogEntry, ProjectFile, IpcAttachment } from '@/types'

type UnsubscribeFn = () => void

/**
 * What the user can do about a failed turn.
 *
 * The backend classifies the provider's raw error so the UI can offer the
 * matching affordance instead of printing a JSON blob.
 */
export type TaskErrorAction = 'open-settings' | 'retry' | 'compact' | 'none'

export interface TaskErrorPayload {
  taskId: string
  /** Already phrased for a person. */
  message: string
  action?: TaskErrorAction
  /** The provider's own text, for the debug panel. */
  detail?: string
}

/**
 * One fact the everyday assistant remembers about the user.
 *
 * Written by the gate extension's `remember` tool into
 * `~/.laf-agent/memories.json` and injected into every turn's system prompt,
 * which is why the settings panel can list and delete them.
 *
 * The gate keeps the file within the same budget it injects, so this list is
 * exactly what the assistant is told — never a longer one the model never
 * sees. Saving past the budget drops the oldest entries.
 */
export interface EverydayMemory {
  fact: string
  /** ISO-8601 timestamp. Empty when the entry predates the field. */
  at: string
}

/** What `history_health` reports about a store file on disk. */
export interface HistoryHealth {
  /** False on a first run, which is not a fault. */
  exists: boolean
  bytes: number
  /** False means the bytes are damaged — not that the store is empty. */
  parseable: boolean
  threadCount: number
}

const tauriListen = <T>(event: string, cb: (payload: T) => void): UnsubscribeFn => {
  let unlisten: (() => void) | null = null
  let cleaned = false

  const ready = listen<T>(event, (e) => { if (!cleaned) cb(e.payload) })
  ready.then((fn) => {
    if (cleaned) {
      // Component already unmounted — schedule unlisten on next tick
      // to avoid synchronous throw from Tauri's internal listener map
      setTimeout(() => { try { fn() } catch { /* stale listener */ } }, 0)
    } else {
      unlisten = fn
    }
  }).catch(() => {})

  return () => {
    if (cleaned) return
    cleaned = true
    if (unlisten) {
      // Defer to avoid "listeners[eventId].handlerId" crash during HMR/StrictMode cleanup
      const fn = unlisten
      unlisten = null
      setTimeout(() => { try { fn() } catch { /* already removed */ } }, 0)
    }
    // If ready hasn't resolved yet, the .then() branch above handles it
  }
}

export const ipc = {
  createTask: (params: { name: string; workspace: string; prompt: string; autoApprove?: boolean; modeId?: string; modelId?: string; attachments?: IpcAttachment[]; existingId?: string; existingMessages?: Array<{ role: string; content: string; timestamp: string; thinking?: string; toolCalls?: ToolCall[] }>; sessionFile?: string }): Promise<AgentTask> =>
    invoke('task_create', { params }),
  listTasks: (): Promise<AgentTask[]> =>
    invoke('task_list'),
  sendMessage: (taskId: string, message: string, attachments?: IpcAttachment[]): Promise<void> =>
    invoke('task_send_message', { taskId, message, attachments }),
  pauseTask: (taskId: string): Promise<void> =>
    invoke('task_pause', { taskId }),
  resumeTask: (taskId: string): Promise<void> =>
    invoke('task_resume', { taskId }),
  cancelTask: (taskId: string): Promise<void> =>
    invoke('task_cancel', { taskId }),
  deleteTask: (taskId: string): Promise<void> =>
    invoke('task_delete', { taskId }),
  allowPermission: (taskId: string, requestId: string, optionId?: string): Promise<void> =>
    invoke('task_allow_permission', { taskId, requestId, optionId }),
  denyPermission: (taskId: string, requestId: string, optionId?: string): Promise<void> =>
    invoke('task_deny_permission', { taskId, requestId, optionId }),
  selectPermissionOption: (taskId: string, requestId: string, optionId: string): Promise<void> =>
    invoke('task_allow_permission', { taskId, requestId, optionId }),
  setAutoApprove: (taskId: string, autoApprove: boolean): Promise<void> =>
    invoke('task_set_auto_approve', { taskId, autoApprove }),
  pickFolder: (): Promise<string | null> =>
    invoke('pick_folder'),
  /** Native open dialog for a single file of any type (e.g. an executable). */
  pickFile: (): Promise<string | null> =>
    invoke('pick_file'),
  pickImage: (): Promise<string | null> =>
    invoke('pick_image'),
  /** Native save dialog + write. Returns the path, or null on cancel. */
  exportTextFile: (suggestedName: string, contents: string): Promise<string | null> =>
    invoke('export_text_file', { suggestedName, contents }),
  detectAgentCli: (): Promise<string | null> =>
    invoke('detect_agent_cli'),
  harnessInfo: (): Promise<{ ref: string; commit: string; repo: string; builtAt: string } | null> =>
    invoke('harness_info'),
  listModels: (agentBin?: string): Promise<{ availableModels: Array<{ modelId: string; name: string; description?: string | null }>; currentModelId: string | null }> =>
    invoke('list_models', { agentBin }),
  probeCapabilities: (): Promise<{ ok: boolean }> =>
    invoke('probe_capabilities'),
  getSettings: (): Promise<AppSettings> =>
    invoke('get_settings'),
  saveSettings: (settings: AppSettings): Promise<void> =>
    invoke('save_settings', { settings }),
  /**
   * Install/remove the menu-bar icon and (re)bind the summon shortcut.
   * Rejects when the OS refuses the accelerator — usually another app owns it.
   */
  summonApply: (menuBarIcon: boolean, summonShortcut: string | null): Promise<void> =>
    invoke('summon_apply', { menuBarIcon, summonShortcut }),
  setDockIcon: (iconBase64: string): Promise<void> =>
    invoke('set_dock_icon', { iconBase64 }),
  resetDockIcon: (): Promise<void> =>
    invoke('reset_dock_icon'),

  // ── Everyday memories ────────────────────────────────────────────────────
  /**
   * Facts the everyday assistant has remembered, in the order the gate wrote
   * them (oldest first). Never rejects for a missing or damaged store — both
   * come back as an empty list.
   */
  everydayMemoriesList: (): Promise<EverydayMemory[]> =>
    invoke('everyday_memories_list'),
  /** Forget one fact, matched on its exact text. A miss is a no-op. */
  everydayMemoryDelete: (fact: string): Promise<void> =>
    invoke('everyday_memory_delete', { fact }),
  /** Forget everything: the store file is removed, not emptied. */
  everydayMemoriesClear: (): Promise<void> =>
    invoke('everyday_memories_clear'),

  // ── History integrity ────────────────────────────────────────────────────
  /**
   * Inspect a store file before the store plugin loads it. The plugin
   * discards parse errors, so a damaged file is indistinguishable from an
   * empty one from the renderer's side — this is how we tell them apart.
   */
  historyHealth: (name: string): Promise<HistoryHealth> =>
    invoke('history_health', { name }),
  /** Move a damaged store aside instead of letting it be overwritten. */
  historyQuarantine: (name: string): Promise<string | null> =>
    invoke('history_quarantine', { name }),
  /** Delete analytics events older than keepDays. Maintenance. */
  analyticsPrune: (keepDays: number): Promise<number> =>
    invoke('analytics_prune', { keepDays }),
  openInEditor: (path: string, editor: string): Promise<void> =>
    invoke('open_in_editor', { path, editor }),
  detectEditors: (): Promise<string[]> =>
    invoke('detect_editors'),
  detectEditorsBackground: (known: string[]): Promise<void> =>
    invoke('detect_editors_background', { known }),
  /** Send any prime-agent RPC command to a live thread and await its data. */
  agentRpcRequest: (taskId: string, command: string, params?: Record<string, unknown>): Promise<unknown> =>
    invoke('agent_rpc_request', { taskId, command, params: params ?? null }),
  setThinkingLevel: (taskId: string, level: string): Promise<void> =>
    invoke('set_thinking_level', { taskId, level }),
  compactContext: (taskId: string): Promise<void> =>
    invoke('compact_context', { taskId }),
  setMode: (taskId: string, modeId: string): Promise<void> =>
    invoke('set_mode', { taskId, modeId }),
  ptyCreate: (id: string, cwd: string): Promise<void> =>
    invoke('pty_create', { id, cwd }),
  ptyWrite: (id: string, data: string): Promise<void> =>
    invoke('pty_write', { id, data }),
  ptyResize: (id: string, cols: number, rows: number): Promise<void> =>
    invoke('pty_resize', { id, cols, rows }),
  ptyKill: (id: string): Promise<void> =>
    invoke('pty_kill', { id }),
  ptyCount: (): Promise<number> =>
    invoke('pty_count'),
  getAgentResources: (projectPath?: string): Promise<AgentResources> =>
    invoke('get_agent_resources', { projectPath }),
  saveMcpServerConfig: (filePath: string, serverName: string, patch: { disabled?: boolean; disabledTools?: string[] }): Promise<void> =>
    invoke('save_mcp_server_config', { filePath, serverName, patch }),
  /**
   * Run `prime-agent mcp add` as a subprocess.
   *
   * Prefer this over a raw mcp.json edit so the CLI's validation, registry-mode
   * enforcement, and any side effects (caching, telemetry) all run.
   *
   * @param request.scope `"global"`, `"workspace"`, or `"agent:<name>"`
   * @param request.command stdio binary (mutually exclusive with `url`)
   * @param request.url    remote MCP endpoint (mutually exclusive with `command`)
   * @param request.env    `KEY=VALUE` strings; the CLI expands `${VAR}` refs at server-launch time
   */
  mcpAddServer: (request: {
    name: string
    scope: string
    command?: string
    args: string[]
    url?: string
    env: string[]
    force: boolean
  }, workspace?: string, agentBin?: string): Promise<string> =>
    invoke('mcp_add_server', { request, workspace, agentBin }),
  /** Run `prime-agent mcp remove` for the given scope. */
  mcpRemoveServer: (request: { name: string; scope: string }, workspace?: string, agentBin?: string): Promise<string> =>
    invoke('mcp_remove_server', { request, workspace, agentBin }),
  watchResourcePath: (path: string): Promise<void> =>
    invoke('watch_resource_path', { path }),
  unwatchResourcePath: (path: string): Promise<void> =>
    invoke('unwatch_resource_path', { path }),
  readFile: (filePath: string): Promise<string | null> =>
    invoke('read_text_file', { path: filePath }),
  readFileBase64: (filePath: string): Promise<string | null> =>
    invoke('read_file_base64', { path: filePath }),
  isDirectory: (path: string): Promise<boolean> =>
    invoke('is_directory', { path }),
  listProjectFiles: (root: string, respectGitignore: boolean = true): Promise<ProjectFile[]> =>
    invoke('list_project_files', { root, respectGitignore }),
  // Project tree (new lazy-loading API)
  scanRoot: (workspace: string, respectGitignore: boolean = true): Promise<any[]> =>
    invoke('scan_root', { workspace, respectGitignore }),
  scanDirectory: (workspace: string, relPath: string, respectGitignore: boolean = true): Promise<any[]> =>
    invoke('scan_directory', { workspace, relPath, respectGitignore }),
  watchProjectTree: (workspace: string): Promise<void> =>
    invoke('watch_project_tree', { workspace }),
  unwatchProjectTree: (workspace: string): Promise<void> =>
    invoke('unwatch_project_tree', { workspace }),
  createFile: (workspace: string, relPath: string): Promise<any> =>
    invoke('create_file', { workspace, relPath }),
  createDirectory: (workspace: string, relPath: string): Promise<any> =>
    invoke('create_directory', { workspace, relPath }),
  deleteEntry: (workspace: string, relPath: string, permanent: boolean = false): Promise<void> =>
    invoke('delete_entry', { workspace, relPath, permanent }),
  renameEntry: (workspace: string, oldRelPath: string, newRelPath: string): Promise<any> =>
    invoke('rename_entry', { workspace, oldRelPath, newRelPath }),
  copyEntry: (workspace: string, srcRelPath: string, destRelPath: string): Promise<any> =>
    invoke('copy_entry', { workspace, srcRelPath, destRelPath }),
  duplicateEntry: (workspace: string, relPath: string): Promise<any> =>
    invoke('duplicate_entry', { workspace, relPath }),
  copyEntryPath: (workspace: string, relPath: string, relative: boolean): Promise<string> =>
    invoke('copy_entry_path', { workspace, relPath, relative }),
  revealInFinder: (workspace: string, relPath: string): Promise<void> =>
    invoke('reveal_in_finder', { workspace, relPath }),
  openInDefaultApp: (workspace: string, relPath: string): Promise<void> =>
    invoke('open_in_default_app', { workspace, relPath }),
  /** Open a Finder window scoped to `path`. Rejects when Finder declines. */
  openFinderSearch: (path: string): Promise<void> =>
    invoke('open_finder_search', { path }),
  /** Wipe this app's data directory. Used only by the recovery path in main.tsx. */
  resetAppData: (): Promise<void> => invoke('reset_app_data'),
  openTerminalAt: (workspace: string, relPath: string): Promise<void> =>
    invoke('open_terminal_at', { workspace, relPath }),
  /** Write a bug report beside the app logs; returns the file path. */
  saveBugReport: (body: string): Promise<string> =>
    invoke('save_bug_report', { body }),
  openUrl: (url: string): Promise<void> =>
    invoke('open_url', { url }),
  detectProjectIcon: (cwd: string): Promise<{ iconType: string; value: string } | null> =>
    invoke('detect_project_icon', { cwd }),
  listSmallImages: (cwd: string, maxSize: number): Promise<Array<{ path: string; width: number; height: number }>> =>
    invoke('list_small_images', { cwd, maxSize }),
  // Auth
  authStatus: (agentBin?: string): Promise<{ email?: string | null; accountType?: string }> =>
    invoke('auth_status', { agentBin }),
  authLogout: (agentBin?: string): Promise<void> =>
    invoke('auth_logout', { agentBin }),
  ensureChatsDir: (): Promise<string> =>
    invoke('ensure_chats_dir'),
  authSetApiKey: (provider: string, key: string): Promise<void> =>
    invoke('auth_set_api_key', { provider, key }),
  authListProviders: (): Promise<Array<{ name: string; kind: string; isCustom: boolean; baseUrl?: string | null; modelCount: number }>> =>
    invoke('auth_list_providers'),
  // (kernel_status / kernel_setup wrappers removed: the agent runs without
  // ipython, so there is no Python kernel to provision — see OnboardingSetupStep.)
  repairCustomProviders: (): Promise<number> =>
    invoke('repair_custom_providers'),
  authSetCustomProvider: (name: string, baseUrl: string, apiKey: string, modelIds: string[], api?: 'openai-completions' | 'openai-responses'): Promise<void> =>
    invoke('auth_set_custom_provider', { name, baseUrl, apiKey, modelIds, api: api ?? null }),
  providerDiscoverModels: (args: { provider?: string; baseUrl?: string; apiKey: string }): Promise<Array<{ id: string; name: string }>> =>
    invoke('provider_discover_models', { provider: args.provider ?? null, baseUrl: args.baseUrl ?? null, apiKey: args.apiKey }),
  authRemoveProvider: (provider: string): Promise<void> =>
    invoke('auth_remove_provider', { provider }),
  // Relaunch
  setRelaunchFlag: (): Promise<void> =>
    invoke('set_relaunch_flag'),
  // Recent projects
  getRecentProjects: (): Promise<string[]> =>
    invoke('get_recent_projects'),
  addRecentProject: (path: string): Promise<void> =>
    invoke('add_recent_project', { path }),
  clearRecentProjects: (): Promise<void> =>
    invoke('clear_recent_projects'),
  rebuildRecentMenu: (): Promise<void> =>
    invoke('rebuild_recent_menu'),
  // Analytics
  analyticsSave: (events: import('@/types/analytics').AnalyticsEvent[]): Promise<void> =>
    invoke('analytics_save', { events }),
  analyticsLoad: (since?: number): Promise<import('@/types/analytics').AnalyticsEvent[]> =>
    invoke('analytics_load', { since: since ?? null }),
  analyticsClear: (): Promise<void> =>
    invoke('analytics_clear'),
  analyticsDbSize: (): Promise<number> =>
    invoke('analytics_db_size'),
  // Event listeners
  onTaskUpdate: (cb: (task: AgentTask) => void): UnsubscribeFn =>
    tauriListen('task_update', cb),
  onMessageChunk: (cb: (data: { taskId: string; chunk: string }) => void): UnsubscribeFn =>
    tauriListen('message_chunk', cb),
  onPtyData: (cb: (data: { id: string; data: string }) => void): UnsubscribeFn =>
    tauriListen('pty_data', cb),
  onPtyExit: (cb: (data: { id: string }) => void): UnsubscribeFn =>
    tauriListen('pty_exit', cb),
  onToolCall: (cb: (data: { taskId: string; toolCall: ToolCall }) => void): UnsubscribeFn =>
    tauriListen('tool_call', cb),
  onToolCallUpdate: (cb: (data: { taskId: string; toolCall: ToolCall }) => void): UnsubscribeFn =>
    tauriListen('tool_call_update', cb),
  onThinkingChunk: (cb: (data: { taskId: string; chunk: string }) => void): UnsubscribeFn =>
    tauriListen('thinking_chunk', cb),
  onUsageUpdate: (cb: (data: { taskId: string; used: number; size: number }) => void): UnsubscribeFn =>
    tauriListen('usage_update', cb),
  onTurnEnd: (cb: (data: { taskId: string; stopReason?: string }) => void): UnsubscribeFn =>
    tauriListen('turn_end', cb),
  onDebugLog: (cb: (entry: DebugLogEntry) => void): UnsubscribeFn =>
    tauriListen('debug_log', cb),
  onSessionInit: (cb: (data: { taskId: string; sessionId?: string; sessionFile?: string | null; models: unknown; modes: unknown; configOptions: unknown; thinkingLevel?: string | null; availableThinkingLevels?: string[] | null }) => void): UnsubscribeFn =>
    tauriListen('session_init', cb),
  onCommandsUpdate: (cb: (data: { taskId: string; commands: Array<{ name: string; description?: string; inputType?: string }>; mcpServers?: Array<{ name: string; status: string; toolCount: number }> | Record<string, Array<{ name: string; status: string; toolCount: number }>> }) => void): UnsubscribeFn =>
    tauriListen('commands_update', cb),
  onTaskError: (cb: (data: TaskErrorPayload) => void): UnsubscribeFn =>
    tauriListen('task_error', cb),
  // (onSubagentUpdate removed: no renderer code ever subscribed — SubagentDisplay
  // derives everything from tool calls. The Rust emit still exists; drop it when
  // touching src-tauri to keep the surface symmetric.)
  /** `/name` or an agent-initiated rename — keep the sidebar title in sync. */
  onSessionNameChanged: (cb: (data: { taskId: string; name: string }) => void): UnsubscribeFn =>
    tauriListen('session_name_changed', cb),
  onCompactionStatus: (cb: (data: { taskId: string; status: string; summary: unknown }) => void): UnsubscribeFn =>
    tauriListen('compaction_status', cb),
  onRefineStatus: (cb: (data: { taskId: string; status: 'completed' | 'failed'; appliedCount?: number; error?: string }) => void): UnsubscribeFn =>
    tauriListen('refine_status', cb),
  onThinkingLevelChanged: (cb: (data: { taskId: string; level: string }) => void): UnsubscribeFn =>
    tauriListen('thinking_level_changed', cb),
  /** Emitted after a model switch: the levels the new model supports. */
  onThinkingLevels: (cb: (data: { taskId: string; levels: string[] | null; current: string | null }) => void): UnsubscribeFn =>
    tauriListen('thinking_levels', cb),
  onEditorsUpdated: (cb: (bins: string[]) => void): UnsubscribeFn =>
    tauriListen('editors-updated', cb),
  onAgentResourcesChanged: (cb: (data: { projectPath: string | null }) => void): UnsubscribeFn =>
    tauriListen('agent-resources-changed', cb),

  // ── Analytics aggregations (server-side rollups) ────────────────────────────
  analyticsCodingHoursByDay: (since?: number): Promise<Array<{ day: string; value: number; value2?: number }>> =>
    invoke('analytics_coding_hours_by_day', { since: since ?? null }),
  analyticsMessagesByDay: (since?: number): Promise<Array<{ day: string; value: number; value2?: number }>> =>
    invoke('analytics_messages_by_day', { since: since ?? null }),
  analyticsTokensByDay: (since?: number): Promise<Array<{ day: string; value: number; value2?: number }>> =>
    invoke('analytics_tokens_by_day', { since: since ?? null }),
  analyticsDiffStatsByDay: (since?: number): Promise<Array<{ day: string; value: number; value2?: number }>> =>
    invoke('analytics_diff_stats_by_day', { since: since ?? null }),
  analyticsModelPopularity: (since?: number): Promise<Array<{ detail: string; count: number }>> =>
    invoke('analytics_model_popularity', { since: since ?? null }),
  analyticsToolCallBreakdown: (since?: number): Promise<Array<{ detail: string; count: number }>> =>
    invoke('analytics_tool_call_breakdown', { since: since ?? null }),
  analyticsModeUsage: (since?: number): Promise<Array<{ detail: string; count: number }>> =>
    invoke('analytics_mode_usage', { since: since ?? null }),
  analyticsProjectStats: (since?: number): Promise<Array<{ project: string; threads: number; messages: number }>> =>
    invoke('analytics_project_stats', { since: since ?? null }),
  analyticsTotals: (since?: number): Promise<{ codingHours: number; messagesSent: number; messagesReceived: number; tokens: number; cost: number; diffAdditions: number; diffDeletions: number; filesEdited: number; toolCalls: number }> =>
    invoke('analytics_totals', { since: since ?? null }),

  // ── Thread title generation ──────────────────────────────────────────────────
  generateThreadTitle: (message: string, workspace: string): Promise<{ title: string }> =>
    invoke('generate_thread_title', { message, workspace }),

  // ── Thread Database (SQLite persistence) ────────────────────────────────────
  threadDbList: (): Promise<Array<{ id: string; name: string; workspace: string; status: string; createdAt: string; updatedAt: string; parentThreadId?: string; autoApprove: boolean; metadata?: unknown; messageCount: number }>> =>
    invoke('thread_db_list'),
  threadDbLoad: (threadId: string): Promise<{ id: string; name: string; workspace: string; status: string; createdAt: string; updatedAt: string; parentThreadId?: string; autoApprove: boolean; metadata?: unknown; messageCount?: number } | null> =>
    invoke('thread_db_load', { threadId }),
  threadDbSave: (thread: { id: string; name: string; workspace: string; status: string; createdAt: string; updatedAt: string; parentThreadId?: string; autoApprove: boolean; metadata?: unknown }): Promise<void> =>
    invoke('thread_db_save', { thread }),
  threadDbDelete: (threadId: string): Promise<void> =>
    invoke('thread_db_delete', { threadId }),
  threadDbMessages: (threadId: string): Promise<Array<{ id: number; threadId: string; role: string; content: string; timestamp: string; thinking?: string; toolCalls?: unknown }>> =>
    invoke('thread_db_messages', { threadId }),
  threadDbSaveMessage: (message: { id: number; threadId: string; role: string; content: string; timestamp: string; thinking?: string; toolCalls?: unknown }): Promise<number> =>
    invoke('thread_db_save_message', { message }),
  threadDbSaveMessagesBatch: (messages: Array<{ id: number; threadId: string; role: string; content: string; timestamp: string; thinking?: string; toolCalls?: unknown }>): Promise<number[]> =>
    invoke('thread_db_save_messages_batch', { messages }),
  threadDbReplaceMessages: (threadId: string, messages: Array<{ id: number; threadId: string; role: string; content: string; timestamp: string; thinking?: string; toolCalls?: unknown }>): Promise<void> =>
    invoke('thread_db_replace_messages', { threadId, messages }),
  threadDbSearch: (query: string, limit?: number): Promise<Array<{ threadId: string; threadName: string; messageContent: string; messageTimestamp: string; rank: number }>> =>
    invoke('thread_db_search', { query, limit }),
  threadDbStats: (): Promise<{ totalThreads: number; totalMessages: number; threadsByWorkspace: Array<[string, number]> }> =>
    invoke('thread_db_stats'),
  threadDbClearAll: (): Promise<void> =>
    invoke('thread_db_clear_all'),
  threadDbAutoArchive: (days: number): Promise<Array<{ id: string; name: string; workspace: string; createdAt: string; lastActivityAt: string; messageCount: number; parentTaskId?: string }>> =>
    invoke('thread_db_auto_archive', { days }),

  listChildProcesses: (): Promise<{ processes: Array<{ pid: number; ppid: number; cpuPercent: number; rssMb: number; elapsed: string; command: string; status: string }>; totalRssMb: number; processCount: number }> =>
    invoke('list_child_processes'),
  signalProcess: (pid: number, signal: string): Promise<void> =>
    invoke('signal_process', { pid, signal }),

  // ── Structured tracing (NDJSON debug traces) ────────────────────────────
  traceReadRecent: (limit?: number): Promise<Array<{ name: string; timestamp: string; durationMs: number; attributes: Record<string, unknown>; exit: string }>> =>
    invoke('trace_read_recent', { limit }),
  traceFileLocation: (): Promise<string> =>
    invoke('trace_file_location'),
  traceClear: (): Promise<void> =>
    invoke('trace_clear'),

  // ── Agent: model selection ───────────────────────────────────────────────
  setModel: (taskId: string, modelId: string): Promise<void> =>
    invoke('set_model', { taskId, modelId }),

}
