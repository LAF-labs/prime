// ── prime-agent RPC connection ─────────────────────────────────────────
//
// Spawns `prime-agent --mode rpc` as a subprocess per task and speaks the
// prime-agent RPC protocol (JSONL over stdin/stdout, LF-delimited). Events
// from the agent are translated into the same Tauri events the frontend
// already consumes (`message_chunk`, `tool_call`, `turn_end`, ...), so the
// renderer is agnostic to the backend swap from prime-agent/ACP.
//
// Permission approval rides on prime-agent's extension UI protocol: a bundled
// gate extension (resources/laf-agent-gate.ts) intercepts tool calls and
// raises a `select` dialog, which arrives here as an `extension_ui_request`
// line. We surface it through the existing PendingPermission flow and write
// the user's decision back as an `extension_ui_response` line.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

use crate::commands::agent_launch::AgentLaunch;
use super::types::{
    AgentCommand, AgentState, AttachmentData, ConnectionHandle, LaunchOptions, PendingPermission,
    PendingRequests, PermissionOption, PermissionReply, SessionMode,
};

/// Strip embedded `<image src="data:..." />` tags and their `[Attached image: ...]` prefixes
/// from the text so the model doesn't receive raw base64 in the text content block.
pub(crate) fn strip_image_tags(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut i = 0;
    let bytes = text.as_bytes();
    while i < bytes.len() {
        // Try to match [Attached image: ...]\n<image src="data:..." />
        if bytes[i] == b'[' && text[i..].starts_with("[Attached image: ") {
            if let Some(bracket_end) = text[i..].find("]\n<image src=\"data:") {
                let tag_start = i + bracket_end + 1; // skip past ']'
                if text[tag_start..].starts_with("\n<image src=\"data:") {
                    if let Some(tag_end) = text[tag_start..].find(" />") {
                        i = tag_start + tag_end + 3; // skip past ' />'
                        // Skip trailing newlines
                        while i < bytes.len() && bytes[i] == b'\n' { i += 1; }
                        continue;
                    }
                }
            }
        }
        // Try to match standalone <image src="data:..." />
        if bytes[i] == b'<' && text[i..].starts_with("<image src=\"data:") {
            if let Some(tag_end) = text[i..].find(" />") {
                i += tag_end + 3;
                while i < bytes.len() && bytes[i] == b'\n' { i += 1; }
                continue;
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    // Collapse multiple consecutive newlines into at most two
    while result.contains("\n\n\n") {
        result = result.replace("\n\n\n", "\n\n");
    }
    result.trim().to_string()
}

/// Build the JSON payload for an RPC `prompt` command: text (with image tags
/// stripped) plus base64 image blocks in prime-agent's `ImageContent` format.
pub(crate) fn build_prompt_payload(
    text: String,
    attachments: &[AttachmentData],
    steer: bool,
) -> Value {
    let clean_text = if attachments.is_empty() { text } else { strip_image_tags(&text) };
    let mut payload = json!({ "type": "prompt", "message": clean_text });
    if !attachments.is_empty() {
        let images: Vec<Value> = attachments
            .iter()
            .map(|att| json!({ "type": "image", "data": att.base64, "mimeType": att.mime_type }))
            .collect();
        payload["images"] = Value::Array(images);
    }
    if steer {
        payload["streamingBehavior"] = Value::String("steer".to_string());
    }
    payload
}

/// Map a prime-agent tool name to an ACP-style tool kind so the frontend's
/// existing icon/rendering logic keeps working.
pub(crate) fn tool_kind(tool_name: &str) -> &'static str {
    match tool_name {
        "bash" | "ipython" => "execute",
        "edit" | "write" | "multi_edit" | "str_replace" => "edit",
        "read" | "read_file" | "ls" | "grep" | "glob" | "find" => "read",
        "fetch" | "web_search" | "websearch" => "fetch",
        _ => "other",
    }
}

/// Human-friendly one-line title for a tool call, derived from its args.
pub(crate) fn tool_title(tool_name: &str, args: &Value) -> String {
    let arg_str = |key: &str| args.get(key).and_then(|v| v.as_str()).map(str::to_string);
    let title = match tool_name {
        "bash" => arg_str("command"),
        "ipython" => arg_str("code").map(|c| c.lines().next().unwrap_or("").to_string()),
        "edit" | "write" | "read" | "str_replace" => {
            arg_str("path").or_else(|| arg_str("file_path")).or_else(|| arg_str("filePath"))
        }
        _ => None,
    };
    let mut t = match title {
        Some(t) if !t.trim().is_empty() => format!("{tool_name}: {}", t.trim()),
        _ => tool_name.to_string(),
    };
    if t.len() > 200 {
        t.truncate(200);
        t.push('…');
    }
    t
}

/// Wrap plain text as an ACP-style tool-call content array so the existing
/// ToolCallDisplay component renders it unchanged.
pub(crate) fn text_content(text: &str) -> Value {
    json!([{ "type": "content", "content": { "type": "text", "text": text } }])
}

/// Extract the concatenated text out of a prime-agent tool result
/// (`{content: [{type: "text", text}, ...]}`).
pub(crate) fn result_text(result: &Value) -> String {
    result
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|b| {
                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                        b.get("text").and_then(|t| t.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// Map a prime-agent `Model` object to the `{modelId, name, description}`
/// shape the frontend model picker expects. The composite id is
/// `provider/modelId`, which `set_model` splits back apart.
pub(crate) fn map_model(model: &Value) -> Option<Value> {
    let id = model.get("id").and_then(|v| v.as_str())?;
    let provider = model.get("provider").and_then(|v| v.as_str()).unwrap_or("unknown");
    let name = model.get("name").and_then(|v| v.as_str()).unwrap_or(id);
    Some(json!({
        "modelId": format!("{provider}/{id}"),
        "name": name,
        "description": provider,
    }))
}

/// Composite `provider/id` for the model currently reported by `get_state`.
pub(crate) fn composite_model_id(model: &Value) -> Option<String> {
    let id = model.get("id").and_then(|v| v.as_str())?;
    let provider = model.get("provider").and_then(|v| v.as_str())?;
    Some(format!("{provider}/{id}"))
}

/// PATH for agent subprocesses: the sidecar directory first, so prime-agent
/// finds the `uv` we ship before any system copy, then the usual user paths so
/// tools it spawns (git, node, npx) resolve as they would in a shell.
pub(crate) fn agent_path_env(launch: &AgentLaunch) -> String {
    let system = std::env::var("PATH").unwrap_or_default();
    // A bare program name has an empty parent, and an empty PATH entry means
    // "current directory" on POSIX — never put one there.
    let sidecar_dir = std::path::Path::new(&launch.program)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .filter(|d| !d.is_empty());
    match sidecar_dir {
        Some(dir) => format!("{dir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{system}"),
        None => format!("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{system}"),
    }
}

/// Locate the bundled permission-gate extension. Checked relative to the
/// resource dir in production and to `src-tauri/` in dev.
fn gate_extension_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    if let Ok(p) = app
        .path()
        .resolve("resources/laf-agent-gate.ts", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return Some(p);
        }
    }
    // Dev fallback: CARGO_MANIFEST_DIR/resources
    let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/laf-agent-gate.ts");
    if dev.exists() {
        return Some(dev);
    }
    None
}

// ── Spawn a prime-agent RPC connection ─────────────────────────────────

/// Configuration for spawning a new RPC connection.
#[allow(dead_code)]
pub(crate) struct ConnectionConfig {
    pub task_id: String,
    pub workspace: String,
    pub launch: AgentLaunch,
    pub auto_approve: bool,
    pub app: tauri::AppHandle,
    pub initial_mode_id: Option<String>,
    pub initial_model_id: Option<String>,
    pub tight_sandbox: bool,
    pub pending_preamble: Option<String>,
}

pub(crate) fn spawn_connection(
    task_id: String,
    workspace: String,
    launch: AgentLaunch,
    auto_approve: bool,
    app: tauri::AppHandle,
    initial_mode_id: Option<String>,
    initial_model_id: Option<String>,
    tight_sandbox: bool,
    session_mode: SessionMode,
    options: LaunchOptions,
) -> Result<ConnectionHandle, String> {
    spawn_connection_with_preamble(
        task_id, workspace, launch, auto_approve, app,
        initial_mode_id, initial_model_id, tight_sandbox, session_mode, options, None,
    )
}

/// Spawn a connection and stash a one-shot preamble that will be prepended to
/// the very first `Prompt` command this connection receives. Used by
/// `task_fork` and thread resumption so the freshly spawned prime-agent
/// subprocess inherits the prior transcript on the user's next message.
pub(crate) fn spawn_connection_with_preamble(
    task_id: String,
    workspace: String,
    launch: AgentLaunch,
    auto_approve: bool,
    app: tauri::AppHandle,
    _initial_mode_id: Option<String>,
    initial_model_id: Option<String>,
    tight_sandbox: bool,
    session_mode: SessionMode,
    options: LaunchOptions,
    pending_preamble: Option<String>,
) -> Result<ConnectionHandle, String> {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<AgentCommand>();
    let alive = Arc::new(AtomicBool::new(true));
    let auto_approve_flag = Arc::new(AtomicBool::new(auto_approve));
    let pending: PendingRequests = Arc::new(parking_lot::Mutex::new(std::collections::HashMap::new()));
    let pending_task = pending.clone();

    let alive_task = alive.clone();
    let auto_approve_task = auto_approve_flag.clone();
    let app_task = app.clone();
    let tid_task = task_id.clone();

    tauri::async_runtime::spawn(async move {
        let result = run_rpc_connection(
            tid_task.clone(),
            workspace,
            launch,
            auto_approve_task,
            app_task.clone(),
            cmd_rx,
            initial_model_id,
            tight_sandbox,
            session_mode,
            options,
            pending_preamble,
            pending_task,
        )
        .await;

        alive_task.store(false, Ordering::SeqCst);

        // If the connection died while the task was still running, the
        // frontend never receives a `turn_end` event and the spinner gets
        // stuck forever. Emit a synthetic `turn_end` with stopReason
        // "connection_lost" so the frontend can clear the working row.
        use tauri::Manager;
        if let Some(managed_state) = app_task.try_state::<AgentState>() {
            let task_was_running = {
                let tasks = managed_state.tasks.lock();
                tasks
                    .get(&tid_task)
                    .map(|t| t.status == "running" || t.status == "pending_permission")
                    .unwrap_or(false)
            };
            if task_was_running {
                {
                    let mut tasks = managed_state.tasks.lock();
                    if let Some(task) = tasks.get_mut(&tid_task) {
                        task.status = "paused".to_string();
                        task.pending_permission = None;
                    }
                }
                use tauri::Emitter;
                let _ = app_task.emit("turn_end", json!({
                    "taskId": tid_task,
                    "stopReason": "connection_lost"
                }));
                log::warn!("[RPC] Connection for task {tid_task} died while running — emitted synthetic turn_end");
            }
        }

        if let Err(e) = result {
            use tauri::Emitter;
            let _ = app_task.emit("debug_log", json!({
                "direction": "in", "category": "error", "type": "connection-error",
                "taskId": tid_task, "summary": e, "payload": { "error": e }, "isError": true
            }));
        }
    });

    Ok(ConnectionHandle { cmd_tx, alive, auto_approve: auto_approve_flag, pending })
}

/// Shared state for the stdout reader task.
struct ReaderCtx {
    task_id: String,
    app: tauri::AppHandle,
    auto_approve: Arc<AtomicBool>,
    stdin_tx: mpsc::UnboundedSender<String>,
    /// True while the agent is processing a prompt (between agent_start and agent_end).
    streaming: Arc<AtomicBool>,
    /// session_init aggregation: models response and state response.
    init_models: parking_lot::Mutex<Option<Value>>,
    init_state: parking_lot::Mutex<Option<Value>>,
    init_emitted: AtomicBool,
    /// Generic RPC requests awaiting their response line.
    pending: PendingRequests,
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_rpc_connection(
    task_id: String,
    workspace: String,
    launch: AgentLaunch,
    auto_approve: Arc<AtomicBool>,
    app: tauri::AppHandle,
    mut cmd_rx: mpsc::UnboundedReceiver<AgentCommand>,
    initial_model_id: Option<String>,
    tight_sandbox: bool,
    session_mode: SessionMode,
    options: LaunchOptions,
    mut pending_preamble: Option<String>,
    pending: PendingRequests,
) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new(&launch.program);
    cmd.args(&launch.prefix_args);
    cmd.arg("--mode").arg("rpc");
    // Native session continuity: resume/fork the prime-agent session file so
    // the model keeps its full prior context (tool results, compaction state)
    // instead of a lossy transcript replay.
    match &session_mode {
        SessionMode::Resume(file) => { cmd.arg("-r").arg(file); }
        SessionMode::Fork(file) => { cmd.arg("--fork").arg(file); }
        SessionMode::New => {}
    }
    // Goal / autonomous only exist as spawn-time flags — the GUI reaches them
    // by relaunching the same session file with the flags applied.
    if let Some(goal) = options.goal.as_deref().filter(|g| !g.trim().is_empty()) {
        cmd.arg("--goal").arg(goal);
        if let Some(budget) = options.goal_token_budget {
            cmd.arg("--goal-token-budget").arg(budget.to_string());
        }
    }
    if options.autonomous || !options.autonomous_gates.is_empty() {
        cmd.arg("--autonomous");
        for gate in &options.autonomous_gates {
            cmd.arg("--autonomous-gate").arg(gate);
        }
        if let Some(n) = options.autonomous_max_turns {
            cmd.arg("--autonomous-max-turns").arg(n.to_string());
        }
        if let Some(n) = options.autonomous_max_tokens {
            cmd.arg("--autonomous-max-tokens").arg(n.to_string());
        }
    }
    if let Some(model) = initial_model_id.as_deref().filter(|m| m.contains('/')) {
        cmd.arg("--model").arg(model);
    }
    if let Some(gate) = gate_extension_path(&app) {
        cmd.arg("-e").arg(gate);
    } else {
        log::warn!("[RPC] permission-gate extension not found — tool calls will run ungated");
    }
    // The bundled gate extension enforces the workspace sandbox when asked:
    // file-mutating tools targeting paths outside the workspace are blocked
    // outright instead of prompting.
    cmd.env("LAF_WORKSPACE", &workspace);
    if tight_sandbox {
        cmd.env("LAF_TIGHT_SANDBOX", "1");
    }
    let mut child = cmd
        .current_dir(&workspace)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env("PATH", agent_path_env(&launch))
        // prime-agent provisions its Python kernel with uv, which we ship in
        // the sidecar. The flag is a fallback for installs that resolve an
        // external prime-agent: without it a GUI session can never install uv,
        // because the interactive consent prompt only exists on a TTY.
        .env("PRIME_AGENT_INSTALL_UV", "1")
        .spawn()
        .map_err(|e| format!("Failed to spawn prime-agent: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;

    // stdin writer task: single owner of the pipe, fed by an unbounded channel
    // so both the command loop and the reader (auto-approve replies, stats
    // queries) can write lines without contention.
    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(line) = stdin_rx.recv().await {
            if stdin.write_all(line.as_bytes()).await.is_err() {
                break;
            }
            if stdin.write_all(b"\n").await.is_err() {
                break;
            }
            let _ = stdin.flush().await;
        }
    });

    // Pipe stderr to debug log
    let app_stderr = app.clone();
    let tid_stderr = task_id.clone();
    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut stderr = stderr;
        let mut buf = vec![0u8; 4096];
        loop {
            match stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    use tauri::Emitter;
                    let _ = app_stderr.emit("debug_log", json!({
                        "direction": "in", "category": "stderr", "type": "stderr",
                        "taskId": tid_stderr, "summary": &text[..text.len().min(120)],
                        "payload": text, "isError": false
                    }));
                }
                Err(_) => break,
            }
        }
    });

    let streaming = Arc::new(AtomicBool::new(false));

    let ctx = Arc::new(ReaderCtx {
        task_id: task_id.clone(),
        app: app.clone(),
        auto_approve: auto_approve.clone(),
        stdin_tx: stdin_tx.clone(),
        streaming: streaming.clone(),
        init_models: parking_lot::Mutex::new(None),
        init_state: parking_lot::Mutex::new(None),
        init_emitted: AtomicBool::new(false),
        pending: pending.clone(),
    });

    // Kick off session_init data collection.
    let _ = stdin_tx.send(json!({ "id": "__init_models", "type": "get_available_models" }).to_string());
    let _ = stdin_tx.send(json!({ "id": "__init_state", "type": "get_state" }).to_string());
    let _ = stdin_tx.send(json!({ "id": "__commands", "type": "get_commands" }).to_string());

    // stdout reader task
    let reader_ctx = ctx.clone();
    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim_end_matches('\r');
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(line) {
                Ok(event) => handle_rpc_line(&reader_ctx, event),
                Err(e) => log::debug!("[RPC] non-JSON stdout line ({e}): {line}"),
            }
        }
        // EOF — subprocess exited or closed stdout.
    });

    // Command loop: translate AgentCommand into RPC lines.
    let mut killed = false;
    loop {
        tokio::select! {
            maybe_cmd = cmd_rx.recv() => {
                match maybe_cmd {
                    Some(AgentCommand::Prompt(text, attachments)) => {
                        let text = if let Some(preamble) = pending_preamble.take() {
                            format!("{preamble}{text}")
                        } else {
                            text
                        };
                        let steer = streaming.load(Ordering::SeqCst);
                        let payload = build_prompt_payload(text, &attachments, steer);
                        let _ = stdin_tx.send(payload.to_string());
                    }
                    Some(AgentCommand::Cancel) => {
                        let _ = stdin_tx.send(json!({ "type": "abort" }).to_string());
                    }
                    Some(AgentCommand::SetModel(model_id)) => {
                        if let Some((provider, id)) = model_id.split_once('/') {
                            let _ = stdin_tx.send(json!({
                                "type": "set_model", "provider": provider, "modelId": id
                            }).to_string());
                        } else {
                            log::warn!("[RPC] set_model expects provider/id, got '{model_id}'");
                        }
                    }
                    Some(AgentCommand::Raw(payload)) => {
                        let _ = stdin_tx.send(payload.to_string());
                    }
                    Some(AgentCommand::SetThinkingLevel(level)) => {
                        let _ = stdin_tx.send(json!({
                            "type": "set_thinking_level", "level": level
                        }).to_string());
                    }
                    Some(AgentCommand::Compact) => {
                        let _ = stdin_tx.send(json!({ "type": "compact" }).to_string());
                    }
                    Some(AgentCommand::SetMode(mode_id)) => {
                        // prime-agent has no session modes; plan mode is applied
                        // client-side as a prompt directive.
                        log::debug!("[RPC] set_mode('{mode_id}') ignored — modes unsupported");
                    }
                    Some(AgentCommand::Kill) | None => {
                        killed = true;
                        break;
                    }
                }
            }
            status = child.wait() => {
                log::info!("[RPC] prime-agent for task {task_id} exited: {status:?}");
                break;
            }
        }
    }

    if killed {
        let _ = child.kill().await;
    }
    reader.abort();
    Ok(())
}

/// Dispatch one parsed stdout line from the agent.
fn handle_rpc_line(ctx: &Arc<ReaderCtx>, event: Value) {
    use tauri::Emitter;
    let tid = &ctx.task_id;
    let app = &ctx.app;
    let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        "message_update" => {
            if let Some(delta_event) = event.get("assistantMessageEvent") {
                let delta_type = delta_event.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let delta = delta_event.get("delta").and_then(|v| v.as_str()).unwrap_or("");
                match delta_type {
                    "text_delta" if !delta.is_empty() => {
                        let _ = app.emit("message_chunk", json!({ "taskId": tid, "chunk": delta }));
                    }
                    "thinking_delta" if !delta.is_empty() => {
                        let _ = app.emit("thinking_chunk", json!({ "taskId": tid, "chunk": delta }));
                    }
                    "error" => {
                        let reason = delta_event.get("reason").and_then(|v| v.as_str()).unwrap_or("error");
                        if reason != "aborted" {
                            let _ = app.emit("task_error", json!({
                                "taskId": tid,
                                "message": format!("The model stream failed ({reason}). Check the debug panel for details.")
                            }));
                        }
                    }
                    _ => {}
                }
            }
        }
        "agent_start" => {
            ctx.streaming.store(true, Ordering::SeqCst);
        }
        "agent_end" => {
            ctx.streaming.store(false, Ordering::SeqCst);
            // Derive stop reason from the last assistant message of the run.
            let stop_reason = event
                .get("messages")
                .and_then(|m| m.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .rev()
                        .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("assistant"))
                })
                .and_then(|m| m.get("stopReason"))
                .and_then(|s| s.as_str())
                .unwrap_or("stop");
            let acp_stop = match stop_reason {
                "aborted" => "cancelled",
                "error" => "error",
                _ => "end_turn",
            };
            let _ = app.emit("turn_end", json!({ "taskId": tid, "stopReason": acp_stop }));
            // Refresh context usage after every run.
            let _ = ctx.stdin_tx.send(json!({ "id": "__stats", "type": "get_session_stats" }).to_string());
        }
        "tool_execution_start" => {
            let tool_name = event.get("toolName").and_then(|v| v.as_str()).unwrap_or("tool");
            let default_args = json!({});
            let args = event.get("args").unwrap_or(&default_args);
            let mut payload = json!({
                "toolCallId": event.get("toolCallId"),
                "title": tool_title(tool_name, args),
                "status": "in_progress",
                "kind": tool_kind(tool_name),
                "rawInput": args,
            });
            crate::commands::diff_stats::annotate_diff_content(&mut payload);
            let _ = app.emit("tool_call", json!({ "taskId": tid, "toolCall": payload }));
        }
        "tool_execution_update" => {
            let text = event.get("partialResult").map(result_text).unwrap_or_default();
            let mut payload = json!({
                "toolCallId": event.get("toolCallId"),
                "status": "in_progress",
                "content": text_content(&text),
            });
            crate::commands::diff_stats::annotate_diff_content(&mut payload);
            let _ = app.emit("tool_call_update", json!({ "taskId": tid, "toolCall": payload }));
        }
        "tool_execution_end" => {
            let is_error = event.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
            let default_result = json!({});
            let result = event.get("result").unwrap_or(&default_result);
            let text = result_text(result);
            let mut payload = json!({
                "toolCallId": event.get("toolCallId"),
                "status": if is_error { "failed" } else { "completed" },
                "content": text_content(&text),
                "rawOutput": result,
            });
            crate::commands::diff_stats::annotate_diff_content(&mut payload);
            let _ = app.emit("tool_call_update", json!({ "taskId": tid, "toolCall": payload }));
        }
        "compaction_start" => {
            let _ = app.emit("compaction_status", json!({
                "taskId": tid, "status": "started", "summary": Value::Null
            }));
        }
        "compaction_end" => {
            let summary = event
                .get("result")
                .and_then(|r| r.get("summary"))
                .cloned()
                .unwrap_or(Value::Null);
            let _ = app.emit("compaction_status", json!({
                "taskId": tid, "status": "completed", "summary": summary
            }));
        }
        "goal_update" => {
            let _ = app.emit("goal_update", json!({ "taskId": tid, "goal": event.get("goal") }));
        }
        "rlm_child_update" => {
            // prime-agent's RLM subagents map onto the existing subagent panel.
            if let Some(child) = event.get("child") {
                let _ = app.emit("subagent_update", json!({
                    "taskId": tid,
                    "subagents": [child],
                    "pendingStages": Value::Array(vec![]),
                }));
            }
        }
        "session_info_changed" => {
            if let Some(name) = event.get("name").and_then(|v| v.as_str()) {
                let _ = app.emit("session_name_changed", json!({ "taskId": tid, "name": name }));
            }
        }
        "auto_retry_start" => {
            let attempt = event.get("attempt").and_then(|v| v.as_u64()).unwrap_or(1);
            let max = event.get("maxAttempts").and_then(|v| v.as_u64()).unwrap_or(0);
            let _ = app.emit("task_error", json!({
                "taskId": tid,
                "message": format!("Transient provider error — retrying ({attempt}/{max})…")
            }));
        }
        "auto_retry_end" => {
            let success = event.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            if !success {
                let final_error = event.get("finalError").and_then(|v| v.as_str()).unwrap_or("retries exhausted");
                let _ = app.emit("task_error", json!({
                    "taskId": tid, "message": format!("Provider request failed: {final_error}")
                }));
            }
        }
        "session_action_update" | "extension_error" => {
            // Surfaced only in the debug panel (below).
        }
        "response" => {
            handle_rpc_response(ctx, &event);
        }
        "extension_ui_request" => {
            handle_extension_ui_request(ctx, &event);
        }
        _ => {
            log::debug!("[RPC] unhandled event: {event_type}");
        }
    }

    // Mirror everything into the debug panel, mirroring the old ACP behavior.
    let _ = app.emit("debug_log", json!({
        "direction": "in", "category": "notification", "type": event_type,
        "taskId": tid, "summary": event_type, "payload": event, "isError": event_type == "extension_error"
    }));
}

/// Handle a `response` line: session_init aggregation and usage stats.
fn handle_rpc_response(ctx: &Arc<ReaderCtx>, event: &Value) {
    use tauri::Emitter;
    let id = event.get("id").and_then(|v| v.as_str()).unwrap_or("");

    // Generic request/response bridge: any UI-issued RPC command resolves here.
    if let Some(tx) = ctx.pending.lock().remove(id) {
        let _ = tx.send(event.clone());
        return;
    }

    let data = event.get("data").cloned().unwrap_or(Value::Null);

    match id {
        "__init_models" => {
            *ctx.init_models.lock() = Some(data);
            try_emit_session_init(ctx);
        }
        "__init_state" => {
            *ctx.init_state.lock() = Some(data);
            try_emit_session_init(ctx);
        }
        "__commands" => {
            // Surface the agent's real command catalog (extensions, prompt
            // templates, skills) so the slash panel lists what actually works.
            let commands = data.get("commands").cloned().unwrap_or(Value::Array(vec![]));
            let _ = ctx.app.emit("commands_update", json!({
                "taskId": ctx.task_id,
                "commands": commands,
                "mcpServers": Value::Array(vec![]),
            }));
        }
        "__stats" => {
            if let Some(cu) = data.get("contextUsage") {
                let used = cu.get("tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let size = cu.get("contextWindow").and_then(|v| v.as_u64()).unwrap_or(0);
                if size > 0 {
                    let _ = ctx.app.emit("usage_update", json!({
                        "taskId": ctx.task_id, "used": used, "size": size
                    }));
                }
            }
        }
        _ => {
            let success = event.get("success").and_then(|v| v.as_bool()).unwrap_or(true);
            if !success {
                let err = event.get("error").and_then(|v| v.as_str()).unwrap_or("unknown error");
                log::warn!("[RPC] command failed ({id}): {err}");
            }
        }
    }
}

/// Emit `session_init` once both the models and state responses arrived.
fn try_emit_session_init(ctx: &Arc<ReaderCtx>) {
    use tauri::Emitter;
    if ctx.init_emitted.load(Ordering::SeqCst) {
        return;
    }
    let models = ctx.init_models.lock().clone();
    let state = ctx.init_state.lock().clone();
    let (Some(models), Some(state)) = (models, state) else { return };
    if ctx.init_emitted.swap(true, Ordering::SeqCst) {
        return;
    }

    let available: Vec<Value> = models
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| arr.iter().filter_map(map_model).collect())
        .unwrap_or_default();
    let current = state.get("model").and_then(composite_model_id);
    let session_id = state.get("sessionId").and_then(|v| v.as_str());
    let session_file = state.get("sessionFile").and_then(|v| v.as_str());

    // Persist the session file on the task so resume/fork can go native.
    if let Some(file) = session_file {
        use tauri::Manager;
        if let Some(managed_state) = ctx.app.try_state::<AgentState>() {
            let mut tasks = managed_state.tasks.lock();
            if let Some(task) = tasks.get_mut(&ctx.task_id) {
                if task.session_file.as_deref() != Some(file) {
                    task.session_file = Some(file.to_string());
                    let _ = ctx.app.emit("task_update", task.clone());
                }
            }
        }
    }

    let _ = ctx.app.emit("session_init", json!({
        "taskId": ctx.task_id,
        "sessionId": session_id,
        "sessionFile": session_file,
        "models": {
            "availableModels": available,
            "currentModelId": current,
        },
        "modes": { "availableModes": [], "currentModeId": Value::Null },
        "thinkingLevel": state.get("thinkingLevel"),
        "configOptions": Value::Null,
    }));
}

/// Handle an `extension_ui_request` line: surface dialogs through the
/// PendingPermission flow, honor auto-approve, ignore fire-and-forget ones.
fn handle_extension_ui_request(ctx: &Arc<ReaderCtx>, event: &Value) {
    let method = event.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let id = match event.get("id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return,
    };

    match method {
        "select" | "confirm" => {
            let title = event.get("title").and_then(|v| v.as_str())
                .or_else(|| event.get("message").and_then(|v| v.as_str()))
                .unwrap_or("Permission requested");

            // The bundled gate extension encodes structured info in the title.
            let (tool_name, description) = match serde_json::from_str::<Value>(title) {
                Ok(v) if v.get("__lafGate").is_some() => (
                    v.get("tool").and_then(|t| t.as_str()).unwrap_or("tool").to_string(),
                    v.get("summary").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                ),
                _ => {
                    let first_line = title.lines().next().unwrap_or(title);
                    let mut t = first_line.to_string();
                    if t.len() > 120 { t.truncate(120); t.push('…'); }
                    (t, title.to_string())
                }
            };

            let options: Vec<PermissionOption> = if method == "confirm" {
                vec![
                    PermissionOption { option_id: "__confirm_yes".into(), name: "Yes".into(), kind: "allow_once".into() },
                    PermissionOption { option_id: "__confirm_no".into(), name: "No".into(), kind: "reject_once".into() },
                ]
            } else {
                event.get("options")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|o| o.as_str())
                            .map(|name| {
                                let lower = name.to_lowercase();
                                let kind = if lower.contains("allow") || lower.contains("yes") || lower.contains("approve") {
                                    "allow_once"
                                } else if lower.contains("deny") || lower.contains("no") || lower.contains("block") || lower.contains("reject") {
                                    "reject_once"
                                } else {
                                    "other"
                                };
                                PermissionOption { option_id: name.to_string(), name: name.to_string(), kind: kind.to_string() }
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            };

            // Auto-approve short-circuit: answer without involving the UI.
            if ctx.auto_approve.load(Ordering::SeqCst) {
                let response = if method == "confirm" {
                    json!({ "type": "extension_ui_response", "id": id, "confirmed": true })
                } else {
                    let allow = options.iter().find(|o| o.kind == "allow_once")
                        .map(|o| o.option_id.clone())
                        .or_else(|| options.first().map(|o| o.option_id.clone()))
                        .unwrap_or_else(|| "Allow".to_string());
                    json!({ "type": "extension_ui_response", "id": id, "value": allow })
                };
                let _ = ctx.stdin_tx.send(response.to_string());
                return;
            }

            let pending = PendingPermission {
                request_id: id.clone(),
                tool_name,
                description,
                options,
            };

            // Register the pending permission on the managed state and notify the UI.
            use tauri::Manager;
            let (reply_tx, reply_rx) = oneshot::channel::<PermissionReply>();
            if let Some(managed_state) = ctx.app.try_state::<AgentState>() {
                {
                    let mut tasks = managed_state.tasks.lock();
                    if let Some(task) = tasks.get_mut(&ctx.task_id) {
                        task.status = "pending_permission".to_string();
                        task.pending_permission = Some(pending);
                        use tauri::Emitter;
                        let _ = ctx.app.emit("task_update", task.clone());
                    }
                }
                managed_state.permission_resolvers.lock().insert(id.clone(), reply_tx);
            }

            // Wait for the user's decision (5 min timeout), then answer the agent.
            let stdin_tx = ctx.stdin_tx.clone();
            let is_confirm = method == "confirm";
            tauri::async_runtime::spawn(async move {
                let response = match tokio::time::timeout(std::time::Duration::from_secs(300), reply_rx).await {
                    Ok(Ok(reply)) => {
                        if is_confirm {
                            json!({
                                "type": "extension_ui_response", "id": id,
                                "confirmed": reply.option_id == "__confirm_yes"
                            })
                        } else {
                            json!({ "type": "extension_ui_response", "id": id, "value": reply.option_id })
                        }
                    }
                    _ => {
                        log::warn!("[RPC] permission request {id} timed out or was dropped");
                        json!({ "type": "extension_ui_response", "id": id, "cancelled": true })
                    }
                };
                let _ = stdin_tx.send(response.to_string());
            });
        }
        "input" | "editor" => {
            // No UI affordance for free-form dialogs yet — cancel so the
            // extension gets a deterministic `undefined` instead of hanging.
            let _ = ctx.stdin_tx.send(json!({
                "type": "extension_ui_response", "id": id, "cancelled": true
            }).to_string());
        }
        _ => {
            // notify / setStatus / setWidget / setTitle — fire-and-forget.
        }
    }
}
