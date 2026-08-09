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
  createTask: (params: { name: string; workspace: string; prompt: string; autoApprove?: boolean; modeId?: string; modelId?: string; attachments?: IpcAttachment[]; existingId?: string; existingMessages?: Array<{ role: string; content: string; timestamp: string; thinking?: string; toolCalls?: ToolCall[] }>; deferSpawn?: boolean; sessionFile?: string }): Promise<AgentTask> =>
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
  forkTask: (taskId: string, workspace?: string, parentName?: string, sessionFile?: string): Promise<AgentTask> =>
    invoke('task_fork', { params: { taskId, workspace, parentName, sessionFile } }),
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
  setDockIcon: (iconBase64: string): Promise<void> =>
    invoke('set_dock_icon', { iconBase64 }),
  resetDockIcon: (): Promise<void> =>
    invoke('reset_dock_icon'),

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
  /** Delete checkpoint refs older than keepDays in one repo. Maintenance. */
  checkpointPrune: (cwd: string, keepDays: number): Promise<number> =>
    invoke('checkpoint_prune', { cwd, keepDays }),
  /** Delete analytics events older than keepDays. Maintenance. */
  analyticsPrune: (keepDays: number): Promise<number> =>
    invoke('analytics_prune', { keepDays }),
  gitDetect: (path: string): Promise<boolean> =>
    invoke('git_detect', { path }),
  gitInit: (path: string): Promise<void> =>
    invoke('git_init', { path }),
  gitClone: (url: string, targetDir: string): Promise<string> =>
    invoke('git_clone', { url, targetDir }),
  gitListBranches: (cwd: string): Promise<{
    local: Array<{ name: string; current: boolean; worktreeLocked: boolean }>;
    remotes: Record<string, Array<{ name: string; fullRef: string }>>;
    currentBranch: string;
  }> =>
    invoke('git_list_branches', { cwd }),
  gitCheckout: (cwd: string, branch: string, force?: boolean): Promise<{ branch: string }> =>
    invoke('git_checkout', { cwd, branch, force }),
  gitCheckoutRemote: (cwd: string, remoteRef: string, force?: boolean): Promise<{ branch: string }> =>
    invoke('git_checkout_remote', { cwd, remoteRef, force }),
  gitCreateBranch: (cwd: string, branch: string): Promise<{ branch: string }> =>
    invoke('git_create_branch', { cwd, branch }),
  gitDeleteBranch: (cwd: string, branch: string): Promise<{ branch: string }> =>
    invoke('git_delete_branch', { cwd, branch }),
  getTaskDiff: (taskId: string): Promise<string> =>
    invoke('task_diff', { taskId }),
  getTaskDiffStats: (taskId: string): Promise<{ additions: number; deletions: number; fileCount: number }> =>
    invoke('task_diff_stats', { taskId }),
  gitDiff: (cwd: string): Promise<string> =>
    invoke('git_diff', { cwd }),
  gitDiffFile: (taskId: string, filePath: string): Promise<string> =>
    invoke('git_diff_file', { taskId, filePath }),
  gitDiffStats: (cwd: string): Promise<{ additions: number; deletions: number; fileCount: number }> =>
    invoke('git_diff_stats', { cwd }),
  gitStagedStats: (cwd: string): Promise<{ additions: number; deletions: number; fileCount: number }> =>
    invoke('git_staged_stats', { cwd }),
  gitRemoteUrl: (cwd: string): Promise<string> =>
    invoke('git_remote_url', { cwd }),
  gitWorktreeCreate: (cwd: string, slug: string): Promise<{ worktreePath: string; branch: string }> =>
    invoke('git_worktree_create', { cwd, slug }),
  gitWorktreeRemove: (cwd: string, worktreePath: string): Promise<void> =>
    invoke('git_worktree_remove', { cwd, worktreePath }),
  gitWorktreeSetup: (cwd: string, worktreePath: string, symlinkDirs: string[]): Promise<{ symlinkCount: number; copiedFiles: string[] }> =>
    invoke('git_worktree_setup', { cwd, worktreePath, symlinkDirs }),
  gitWorktreeHasChanges: (worktreePath: string): Promise<boolean> =>
    invoke('git_worktree_has_changes', { worktreePath }),
  openInEditor: (path: string, editor: string): Promise<void> =>
    invoke('open_in_editor', { path, editor }),
  detectEditors: (): Promise<string[]> =>
    invoke('detect_editors'),
  detectEditorsBackground: (known: string[]): Promise<void> =>
    invoke('detect_editors_background', { known }),
  gitCommit: (cwd: string, message: string): Promise<void> =>
    invoke('git_commit', { cwd, message }),
  gitPush: (cwd: string): Promise<string> =>
    invoke('git_push', { cwd }),
  gitPull: (cwd: string): Promise<string> =>
    invoke('git_pull', { cwd }),
  gitFetch: (cwd: string): Promise<string> =>
    invoke('git_fetch', { cwd }),
  gitStage: (taskId: string, filePath: string): Promise<void> =>
    invoke('git_stage', { taskId, filePath }),
  gitRevert: (taskId: string, filePath: string): Promise<void> =>
    invoke('git_revert', { taskId, filePath }),
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
  openTerminalAt: (workspace: string, relPath: string): Promise<void> =>
    invoke('open_terminal_at', { workspace, relPath }),
  addToGitignore: (workspace: string, relPath: string): Promise<void> =>
    invoke('add_to_gitignore', { workspace, relPath }),
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
  kernelStatus: (): Promise<{ ready: boolean; venvPath: string; hasUv: boolean }> =>
    invoke('kernel_status'),
  kernelSetup: (): Promise<void> =>
    invoke('kernel_setup'),
  onKernelSetupProgress: (cb: (data: { line: string }) => void): UnsubscribeFn =>
    tauriListen('kernel_setup_progress', cb),
  disableSerperWebsearch: (): Promise<boolean> =>
    invoke('disable_serper_websearch'),
  repairCustomProviders: (): Promise<number> =>
    invoke('repair_custom_providers'),
  authSetCustomProvider: (name: string, baseUrl: string, apiKey: string, modelIds: string[]): Promise<void> =>
    invoke('auth_set_custom_provider', { name, baseUrl, apiKey, modelIds }),
  providerDiscoverModels: (args: { provider?: string; baseUrl?: string; apiKey: string }): Promise<Array<{ id: string; name: string }>> =>
    invoke('provider_discover_models', { provider: args.provider ?? null, baseUrl: args.baseUrl ?? null, apiKey: args.apiKey }),
  authRemoveProvider: (provider: string): Promise<void> =>
    invoke('auth_remove_provider', { provider }),
  openTerminalWithCommand: (command: string): Promise<void> =>
    invoke('open_terminal_with_command', { command }),
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
  onSubagentUpdate: (cb: (data: { taskId: string; subagents: unknown[]; pendingStages: unknown[] }) => void): UnsubscribeFn =>
    tauriListen('subagent_update', cb),
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

  // ── Structured diff parsing (replaces @pierre/diffs parsePatchFiles) ────────
  taskDiffStructured: (taskId: string): Promise<import('@/types/diff').ParsedDiff> =>
    invoke('task_diff_structured', { taskId }),
  gitDiffStructured: (cwd: string): Promise<import('@/types/diff').ParsedDiff> =>
    invoke('git_diff_structured', { cwd }),

  // ── Markdown parsing (replaces react-markdown for assistant messages) ───────
  parseMarkdown: (text: string): Promise<import('@/types/markdown').ParsedMarkdown> =>
    invoke('parse_markdown', { text }),

  // ── Fuzzy match (replaces fuzzy-search.ts) ──────────────────────────────────
  fuzzyMatch: (query: string, candidates: Array<{ id: string; text: string; secondary?: string }>, limit?: number): Promise<Array<{ id: string; score: number; indices: number[]; secondaryMatched: boolean }>> =>
    invoke('fuzzy_match', { query, candidates, limit }),

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
  generateBranchName: (message: string, workspace: string): Promise<{ branch: string }> =>
    invoke('generate_branch_name', { message, workspace }),
  renameWorktreeBranch: (cwd: string, oldBranch: string, newBranch: string): Promise<{ branch: string }> =>
    invoke('rename_worktree_branch', { cwd, oldBranch, newBranch }),
  generatePrContent: (cwd: string, baseBranch: string, workspace?: string): Promise<{ title: string; body: string }> =>
    invoke('generate_pr_content', { cwd, baseBranch, workspace }),

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

  // ── Git: commit dialog & VCS status ────────────────────────────────────
  gitVcsStatus: (cwd: string): Promise<{ branch: string; aheadCount: number; behindCount: number; isDirty: boolean; changedFileCount: number; hasUpstream: boolean }> =>
    invoke('git_vcs_status', { cwd }),
  gitListStack: (cwd: string): Promise<{ baseBranch: string; entries: Array<{ branch: string; isCurrent: boolean; commitsAhead: number; hasRemote: boolean }> }> =>
    invoke('git_list_stack', { cwd }),
  gitStackedPush: (cwd: string): Promise<{ branch: string; remoteUrl: string; pushed: boolean }> =>
    invoke('git_stacked_push', { cwd }),
  listChildProcesses: (): Promise<{ processes: Array<{ pid: number; ppid: number; cpuPercent: number; rssMb: number; elapsed: string; command: string; status: string }>; totalRssMb: number; processCount: number }> =>
    invoke('list_child_processes'),
  signalProcess: (pid: number, signal: string): Promise<void> =>
    invoke('signal_process', { pid, signal }),
  gitChangedFiles: (cwd: string): Promise<Array<{ path: string; insertions: number; deletions: number; status: string }>> =>
    invoke('git_changed_files', { cwd }),
  gitStageFiles: (cwd: string, filePaths: string[]): Promise<void> =>
    invoke('git_stage_files', { cwd, filePaths }),
  gitCommitFiles: (cwd: string, message: string, filePaths: string[]): Promise<string> =>
    invoke('git_commit_files', { cwd, message, filePaths }),
  gitCreateAndCheckoutBranch: (cwd: string, branch: string): Promise<{ branch: string }> =>
    invoke('git_create_and_checkout_branch', { cwd, branch }),
  gitAddRemote: (cwd: string, name: string, url: string): Promise<void> =>
    invoke('git_add_remote', { cwd, name, url }),
  gitGenerateCommitMessage: (cwd: string): Promise<{ subject: string; body: string }> =>
    invoke('git_generate_commit_message', { cwd }),

  // ── PR / MR creation (GitHub + GitLab) ──────────────────────────────────
  gitDetectProvider: (cwd: string): Promise<{ provider: 'github' | 'gitlab' | null; cliAvailable: boolean; remoteUrl: string; authenticated: boolean }> =>
    invoke('git_detect_provider', { cwd }),
  gitCreatePr: (cwd: string, title: string, body: string, base: string, draft?: boolean): Promise<{ provider: string; url: string; number: number; title: string }> =>
    invoke('git_create_pr', { cwd, title, body, base, draft }),
  gitPrStatus: (cwd: string): Promise<{ hasOpenPr: boolean; prUrl?: string; prNumber?: number; prTitle?: string; prState?: string }> =>
    invoke('git_pr_status', { cwd }),
  gitPrOpenInBrowser: (cwd: string): Promise<void> =>
    invoke('git_pr_open_in_browser', { cwd }),

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

  // ── Checkpoints (per-turn snapshots) ────────────────────────────────────
  checkpointCreate: (taskId: string, turn: number): Promise<{ turn: number; refName: string; oid: string; message: string; timestamp: number }> =>
    invoke('checkpoint_create', { taskId, turn }),
  checkpointList: (taskId: string): Promise<Array<{ turn: number; refName: string; oid: string; message: string; timestamp: number }>> =>
    invoke('checkpoint_list', { taskId }),
  checkpointDiff: (taskId: string, fromTurn: number, toTurn: number): Promise<{
    fromTurn: number; toTurn: number; additions: number; deletions: number;
    fileCount: number; patch: string;
    files: Array<{ path: string; additions: number; deletions: number; status: string }>;
  }> =>
    invoke('checkpoint_diff', { taskId, fromTurn, toTurn }),
  checkpointRevert: (taskId: string, turn: number, force?: boolean): Promise<void> =>
    invoke('checkpoint_revert', { taskId, turn, force }),
  checkpointCleanup: (taskId: string): Promise<number> =>
    invoke('checkpoint_cleanup', { taskId }),

  // ── Git History (commit log, stash) ─────────────────────────────────────
  gitCommitHistory: (cwd: string, limit?: number, skip?: number, includeStats?: boolean): Promise<Array<{
    shortOid: string; oid: string; subject: string; body: string;
    authorName: string; authorEmail: string; timestamp: number;
    additions: number; deletions: number; fileCount: number;
    parents: string[]; isHead: boolean;
  }>> =>
    invoke('git_commit_history', { cwd, limit, skip, includeStats }),
  gitCommitDiff: (cwd: string, oid: string): Promise<string> =>
    invoke('git_commit_diff', { cwd, oid }),
  gitCommitStats: (cwd: string, oids: string[]): Promise<Array<{ oid: string; additions: number; deletions: number; fileCount: number }>> =>
    invoke('git_commit_stats', { cwd, oids }),
  gitStashList: (cwd: string): Promise<Array<{ index: number; message: string; oid: string; timestamp: number }>> =>
    invoke('git_stash_list', { cwd }),
  gitStashPop: (cwd: string, index?: number): Promise<void> =>
    invoke('git_stash_pop', { cwd, index }),
  gitStashDrop: (cwd: string, index?: number): Promise<void> =>
    invoke('git_stash_drop', { cwd, index }),
  gitStashSave: (cwd: string, message?: string): Promise<string> =>
    invoke('git_stash_save', { cwd, message }),
}
