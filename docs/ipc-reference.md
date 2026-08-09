# LAF Agent IPC reference

All frontend-to-backend communication in LAF Agent uses Tauri's IPC bridge:

- **Commands** use `invoke()` to call Rust `#[tauri::command]` functions from the renderer. Each command has a TypeScript wrapper in `src/renderer/lib/ipc.ts`.
- **Events** use `listen()` to subscribe to backend-emitted events. The `tauriListen` wrapper defers the `unlisten` call to avoid crashes during HMR and React StrictMode double-mount cycles.

> **Note:** This reference covers the core IPC commands. Additional commands exist for analytics, project file tree watching, thread database, goal mode, checkpoints, syntax highlighting, pattern extraction, and tracing. See `src-tauri/src/lib.rs` for the full registered command list.

---

## 1. Task management commands

| Rust command | TypeScript wrapper | Parameters | Return type | Description |
|---|---|---|---|---|
| `task_create` | `ipc.createTask` | `params: { name, workspace, prompt, autoApprove?, modeId? }` | `AgentTask` | Create a new agent task in the given workspace. |
| `task_list` | `ipc.listTasks` | none | `AgentTask[]` | List all existing tasks. |
| `task_send_message` | `ipc.sendMessage` | `taskId: string, message: string` | `void` | Send a user message to a running task. |
| `task_pause` | `ipc.pauseTask` | `taskId: string` | `void` | Pause a running task. |
| `task_resume` | `ipc.resumeTask` | `taskId: string` | `void` | Resume a paused task. |
| `task_cancel` | `ipc.cancelTask` | `taskId: string` | `void` | Cancel a running task. |
| `task_delete` | `ipc.deleteTask` | `taskId: string` | `void` | Delete a task and its history. |
| `task_fork` | `ipc.forkTask` | `taskId: string, workspace?: string, parentName?: string` | `AgentTask` | Fork an existing task into a new independent task. |
| `task_allow_permission` | `ipc.allowPermission` | `taskId: string, requestId: string, optionId?: string` | `void` | Approve a pending permission request. |
| `task_deny_permission` | `ipc.denyPermission` | `taskId: string, requestId: string, optionId?: string` | `void` | Deny a pending permission request. |
| `task_set_auto_approve` | `ipc.setAutoApprove` | `taskId: string, autoApprove: boolean` | `void` | Toggle auto-approve for tool calls on a task. |
| `set_mode` | `ipc.setMode` | `taskId: string, modeId: string` | `void` | Switch the agent mode for a task. |

## 2. Terminal (PTY) commands

| Rust command | TypeScript wrapper | Parameters | Return type | Description |
|---|---|---|---|---|
| `pty_create` | `ipc.ptyCreate` | `id: string, cwd: string` | `void` | Spawn a new pseudo-terminal session. |
| `pty_write` | `ipc.ptyWrite` | `id: string, data: string` | `void` | Write data (keystrokes) to a PTY session. |
| `pty_resize` | `ipc.ptyResize` | `id: string, cols: number, rows: number` | `void` | Resize a PTY session's terminal dimensions. |
| `pty_kill` | `ipc.ptyKill` | `id: string` | `void` | Kill a PTY session. |
| `open_terminal_with_command` | `ipc.openTerminalWithCommand` | `command: string` | `void` | Open the system terminal and run a command. |

## 3. Settings and config commands

| Rust command | TypeScript wrapper | Parameters | Return type | Description |
|---|---|---|---|---|
| `get_settings` | `ipc.getSettings` | none | `AppSettings` | Load the persisted application settings. |
| `save_settings` | `ipc.saveSettings` | `settings: AppSettings` | `void` | Persist updated application settings. |
| `get_agent_resources` | `ipc.getAgentResources` | `projectPath?: string` | `AgentResources` | Read the Agent configuration for a project. |
| `list_models` | `ipc.listModels` | `agentBin?: string` | `{ availableModels: Model[], currentModelId: string }` | List available AI models and the currently selected one. |
| `probe_capabilities` | `ipc.probeCapabilities` | none | `{ ok: boolean }` | Check whether the backend capabilities are available. |
| `detect_agent_cli` | `ipc.detectAgentCli` | none | `string \| null` | Locate the prime-agent CLI binary on the system. |

## 4. File system commands

| Rust command | TypeScript wrapper | Parameters | Return type | Description |
|---|---|---|---|---|
| `pick_folder` | `ipc.pickFolder` | none | `string \| null` | Open a native folder picker dialog. |
| `read_text_file` | `ipc.readFile` | `path: string` | `string \| null` | Read a file as UTF-8 text; returns null if it doesn't exist. |
| `read_file_base64` | `ipc.readFileBase64` | `path: string` | `string \| null` | Read a file as base64; returns null if it doesn't exist. |
| `list_project_files` | `ipc.listProjectFiles` | `root: string, respectGitignore: boolean` | `ProjectFile[]` | List files in a project directory, optionally respecting `.gitignore`. |
| `open_url` | `ipc.openUrl` | `url: string` | `void` | Open a URL in the system default browser. |

## 5. Editor integration commands

| Rust command | TypeScript wrapper | Parameters | Return type | Description |
|---|---|---|---|---|
| `open_in_editor` | `ipc.openInEditor` | `path: string, editor: string` | `void` | Open a file in the specified external editor. |
| `detect_editors` | `ipc.detectEditors` | none | `string[]` | Detect installed code editors on the system. |
| `detect_editors_background` | `ipc.detectEditorsBackground` | `known: string[]` | `void` | Re-scan for editors in the background, given the already-known list. |

## 6. Auth commands

| Rust command | TypeScript wrapper | Parameters | Return type | Description |
|---|---|---|---|---|
| `auth_status` | `ipc.authStatus` | `agentBin?: string` | `{ email?: string, accountType?: string, region?: string, startUrl?: string }` | Get the currently authenticated Agent user's identity. |
| `auth_logout` | `ipc.authLogout` | `agentBin?: string` | `void` | Log out the current Agent user. |

## 7. Events reference

All events are subscribed to via the `tauriListen(eventName, callback)` helper, which returns an unlisten function for cleanup.

### Task lifecycle events

| Event name | Payload type | Description |
|---|---|---|
| `task_update` | `AgentTask` | Emitted when a task's state changes (status, progress, metadata). |
| `task_error` | `{ taskId: string, message: string }` | Emitted when a task encounters an error. |
| `turn_end` | `{ taskId: string, stopReason?: string }` | Emitted when the agent finishes a turn. |
| `session_init` | `{ taskId: string, models: Model[], modes: Mode[], configOptions: ConfigOption[] }` | Emitted once when a task session initializes with available models, modes, and config. |

### Streaming events

| Event name | Payload type | Description |
|---|---|---|
| `message_chunk` | `{ taskId: string, chunk: string }` | Streamed text chunk from the agent's response. |
| `thinking_chunk` | `{ taskId: string, chunk: string }` | Streamed text chunk from the agent's reasoning/thinking trace. |

### Tool and plan events

| Event name | Payload type | Description |
|---|---|---|
| `tool_call` | `{ taskId: string, toolCall: ToolCall }` | Emitted when the agent initiates a tool call. |
| `tool_call_update` | `{ taskId: string, toolCall: ToolCall }` | Emitted when a tool call's status or result updates. |
| `commands_update` | `{ taskId: string, commands: Command[], mcpServers?: McpServer[] }` | Emitted when available slash commands or MCP servers change. |

### Subagent and context events

| Event name | Payload type | Description |
|---|---|---|
| `subagent_update` | `{ taskId: string, subagents: Subagent[], pendingStages: Stage[] }` | Emitted when subagent orchestration state changes. |
| `compaction_status` | `{ taskId: string, status: string, summary: string }` | Emitted during context compaction with progress and summary. |
| `usage_update` | `{ taskId: string, used: number, size: number }` | Emitted when context window usage changes. |
| `goal_update` | `{ taskId: string, goal: unknown }` | Emitted when the session's persistent goal changes. |
| `session_name_changed` | `{ taskId: string, name: string }` | Emitted when the session display name changes. |

### MCP status

prime-agent's RPC protocol has no MCP status stream, so there are no MCP events.
Server status is derived from the configured credentials when
`load_mcp_file` reads the config, and live tool counts ride along on
`commands_update`.

### Terminal events

| Event name | Payload type | Description |
|---|---|---|
| `pty_data` | `{ id: string, data: string }` | Output data from a PTY session. |
| `pty_exit` | `{ id: string }` | Emitted when a PTY session exits. |

### Setup events

| Event name | Payload type | Description |
|---|---|---|
| `kernel_setup_progress` | `{ line: string }` | A progress line from the Python kernel bootstrap. |

### System events

| Event name | Payload type | Description |
|---|---|---|
| `debug_log` | `DebugLogEntry` | Backend debug log entry for the dev tools panel. |
| `editors-updated` | `string[]` | Emitted when the background editor scan completes with an updated list. |
