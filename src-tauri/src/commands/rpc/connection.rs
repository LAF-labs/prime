// ── prime-agent RPC connection ─────────────────────────────────────────
//
// Spawns `prime-agent --mode rpc` as a subprocess per task and speaks the
// prime-agent RPC protocol (JSONL over stdin/stdout, LF-delimited). Events
// from the agent are translated into the same Tauri events the frontend
// already consumes (`message_chunk`, `tool_call`, `turn_end`, ...), so the
// renderer never had to change when the backend was swapped.
//
// Permission approval rides on prime-agent's extension UI protocol: a bundled
// gate extension (resources/laf-agent-gate.ts) intercepts tool calls and
// raises a `select` dialog, which arrives here as an `extension_ui_request`
// line. We surface it through the existing PendingPermission flow and write
// the user's decision back as an `extension_ui_response` line.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, oneshot};

use crate::commands::agent_launch::{agent_path_env, AgentLaunch};
use super::types::{
    AgentCommand, AgentState, AttachmentData, ConnectionHandle, LaunchOptions, PendingPermission,
    PendingRequests, PermissionConfig, PermissionOption, PermissionReply, SessionMode,
};

/// Build the environment variables that carry the permission model to the
/// bundled gate. `LAF_PERMISSION_MODE` is always set (defaulting to "ask");
/// `LAF_PERMISSION_RULES` only when there are rules to pass. Pure so the spawn
/// wiring can be unit-tested without launching a subprocess.
pub(crate) fn permission_env_vars(config: &PermissionConfig) -> Vec<(&'static str, String)> {
    let mode = if config.mode.is_empty() { "ask" } else { config.mode.as_str() };
    let mut vars = vec![("LAF_PERMISSION_MODE", mode.to_string())];
    if !config.rules_json.is_empty() {
        vars.push(("LAF_PERMISSION_RULES", config.rules_json.clone()));
    }
    vars
}

/// Strip embedded `<image src="data:..." />` tags and their `[Attached image: ...]` prefixes
/// from the text so the model doesn't receive raw base64 in the text content block.
/// First `max` characters of `text`, never splitting one in half.
///
/// Slicing by byte index is what a `&text[..120]` does, and it panics the
/// moment byte 120 lands inside a multi-byte character.
pub(crate) fn truncate_chars(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((byte_idx, _)) => text[..byte_idx].to_string(),
        None => text.to_string(),
    }
}

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
        // Copy one whole character, not one byte. `bytes[i] as char` reads a
        // UTF-8 byte as a Latin-1 code point, which turns every non-ASCII
        // prompt into mojibake the moment an attachment is present.
        let ch = text[i..].chars().next().expect("index is on a char boundary");
        result.push(ch);
        i += ch.len_utf8();
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

/// Map a prime-agent tool name to the tool kind the frontend's
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
    // `String::truncate` cuts at a byte index and panics mid-character, which
    // any Korean or emoji tool title hits. Truncate by characters instead.
    if t.chars().count() > 200 {
        t = truncate_chars(&t, 200);
        t.push('…');
    }
    t
}

/// Wrap plain text as the tool-call content array shape the existing
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

/// Locate the bundled permission-gate extension.
///
/// The copy inside the sidecar wins: it sits next to the sidecar's
/// node_modules, so the gate's value imports (@anthropic-ai/sandbox-runtime)
/// resolve. The bare resources copy is the tracked source and the fallback
/// for dev runs or user-supplied harnesses — there the sandbox import fails
/// gracefully and the gate degrades to prompt-only.
fn gate_extension_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    if let Some(sidecar) = crate::commands::agent_launch::bundled_sidecar_dir(app) {
        let in_sidecar = sidecar.join("laf-gate.ts");
        if in_sidecar.exists() {
            return Some(in_sidecar);
        }
    }
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
    pub permission_config: PermissionConfig,
    pub pending_preamble: Option<String>,
}

#[allow(clippy::too_many_arguments)]
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
    permission_config: PermissionConfig,
) -> Result<ConnectionHandle, String> {
    spawn_connection_with_preamble(
        task_id, workspace, launch, auto_approve, app,
        initial_mode_id, initial_model_id, tight_sandbox, session_mode, options,
        permission_config, None,
    )
}

/// Spawn a connection and stash a one-shot preamble that will be prepended to
/// the very first `Prompt` command this connection receives. Used by
/// `task_fork` and thread resumption so the freshly spawned prime-agent
/// subprocess inherits the prior transcript on the user's next message.
#[allow(clippy::too_many_arguments)]
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
    permission_config: PermissionConfig,
    pending_preamble: Option<String>,
) -> Result<ConnectionHandle, String> {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<AgentCommand>();
    let alive = Arc::new(AtomicBool::new(true));
    let auto_approve_flag = Arc::new(AtomicBool::new(auto_approve));
    let pending: PendingRequests = Arc::new(parking_lot::Mutex::new(std::collections::HashMap::new()));
    let pending_task = pending.clone();
    let pending_epilogue = pending.clone();

    let alive_task = alive.clone();
    let auto_approve_task = auto_approve_flag.clone();
    let app_task = app.clone();
    let tid_task = task_id.clone();
    let pid = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let pid_task = pid.clone();

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
            permission_config,
            pending_preamble,
            pending_task,
            pid_task.clone(),
        )
        .await;

        alive_task.store(false, Ordering::SeqCst);
        pid_task.store(0, Ordering::SeqCst);

        // Release everyone still waiting on a reply that is never coming.
        // Dropping the responders makes their receivers fail immediately, so
        // the caller reports "the agent connection closed" instead of spinning
        // for the full 120-second timeout — which is what the user saw when
        // the agent crashed mid-request.
        {
            let mut waiting = pending_epilogue.lock();
            if !waiting.is_empty() {
                log::warn!(
                    "[RPC] connection for task {tid_task} ended with {} request(s) in flight",
                    waiting.len()
                );
                waiting.clear();
            }
        }

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
            // `task_error` is what the chat surface renders. Sending this only
            // to `debug_log` meant a failure to start the agent — a wrong
            // binary path, a sidecar without its exec bit, a broken PATH —
            // showed up as a thread that silently does nothing, with the
            // actual cause buried in a panel behind an overflow menu.
            let _ = app_task.emit("task_error", json!({
                "taskId": tid_task,
                "error": e,
            }));
            let _ = app_task.emit("debug_log", json!({
                "direction": "in", "category": "error", "type": "connection-error",
                "taskId": tid_task, "summary": e, "payload": { "error": e }, "isError": true
            }));
        }
    });

    Ok(ConnectionHandle { cmd_tx, alive, auto_approve: auto_approve_flag, pending, pid })
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
    permission_config: PermissionConfig,
    mut pending_preamble: Option<String>,
    pending: PendingRequests,
    pid_slot: Arc<std::sync::atomic::AtomicU32>,
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
        // Research children inherit the model rather than falling back to the
        // CLI default, which could be a different provider entirely.
        cmd.env("LAF_MODEL", model);
    }
    if let Some(gate) = gate_extension_path(&app) {
        cmd.arg("-e").arg(&gate);
        // The gate's research tool re-spawns this same binary for its child
        // agents, and a child needs the gate too — without it a child comes up
        // with no tools and the RLM prompt. Hand it the resolved path rather
        // than making it guess.
        cmd.env("LAF_GATE_PATH", gate);
    } else {
        log::warn!("[RPC] permission-gate extension not found — tool calls will run ungated");
    }
    // Everyday profile: in simple mode the session drops the coding toolchain.
    // `--no-builtin-tools` removes ipython (and with it the kernel spawn), and
    // LAF_PROFILE tells the gate to swap in the everyday system prompt and
    // register the plain-language file tools. Read at spawn time on purpose:
    // flipping the mode toggle affects newly started threads, never a live one.
    let everyday = {
        use tauri::Manager;
        app.try_state::<crate::commands::settings::SettingsState>()
            .map(|s| s.0.lock().settings.effective_ui_mode() == "simple")
            .unwrap_or(false)
    };
    if everyday {
        cmd.arg("--no-builtin-tools");
        cmd.env("LAF_PROFILE", "everyday");
    }
    // The bundled gate extension enforces the workspace sandbox when asked:
    // file-mutating tools targeting paths outside the workspace are blocked
    // outright instead of prompting.
    cmd.env("LAF_WORKSPACE", &workspace);
    // Hand the permission model to the gate: mode (ask/acceptEdits/auto) plus
    // the JSON allow-rules. Parsed once at gate init, so this is spawn-time by
    // design — a mode or rule change applies to newly-started threads.
    for (key, value) in permission_env_vars(&permission_config) {
        cmd.env(key, value);
    }
    if tight_sandbox && !everyday {
        cmd.env("LAF_TIGHT_SANDBOX", "1");
        // The gate can only reach `bash`. `ipython` runs in a kernel process
        // the harness spawns itself, so confine it at the interpreter: point
        // PRIME_AGENT_KERNEL_PYTHON at a wrapper that re-execs the venv python
        // under a Seatbelt profile. Skipped until the kernel is bootstrapped —
        // setting the override makes the harness skip its own bootstrap, and
        // that bootstrap is our code, not the model's.
        match crate::commands::kernel_sandbox::wrapper_for(&workspace) {
            Ok(Some(wrapper)) => {
                cmd.env("PRIME_AGENT_KERNEL_PYTHON", &wrapper);
                // Byte-code caching would need writes inside the venv, which
                // the profile denies — and a writable venv is a persistence
                // vector we would rather not open.
                cmd.env("PYTHONDONTWRITEBYTECODE", "1");
                log::info!("[RPC] kernel confined via {}", wrapper.display());
            }
            Ok(None) => log::info!("[RPC] kernel sandbox unavailable (not bootstrapped, or not macOS)"),
            Err(e) => log::warn!("[RPC] could not build the kernel sandbox, running unconfined: {e}"),
        }
    }
    // The agent goes on to spawn a Python kernel, `uv`, MCP servers, and the
    // model's own bash commands. Giving it its own process group is what lets
    // teardown reach all of them instead of just the Node process.
    crate::commands::process_group::lead_new_group(&mut cmd);

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

    if let Some(id) = child.id() {
        pid_slot.store(id, Ordering::SeqCst);
    }

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
    let stderr_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut stderr = stderr;
        let mut buf = vec![0u8; 4096];
        // The agent prints box-drawing banners and emoji, so a 4096-byte read
        // routinely lands mid-character. Carry the remainder into the next
        // read instead of decoding it as replacement characters.
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let text = match std::str::from_utf8(&carry) {
                        Ok(s) => {
                            let s = s.to_string();
                            carry.clear();
                            s
                        }
                        Err(e) => {
                            let good = e.valid_up_to();
                            // A trailing incomplete sequence waits for more
                            // bytes; genuinely invalid bytes are lossy-decoded
                            // so a broken stream still surfaces something.
                            let s = String::from_utf8_lossy(&carry[..good]).to_string();
                            if e.error_len().is_some() {
                                carry.clear();
                            } else {
                                carry.drain(..good);
                            }
                            s
                        }
                    };
                    if text.is_empty() {
                        continue;
                    }
                    use tauri::Emitter;
                    let _ = app_stderr.emit("debug_log", json!({
                        "direction": "in", "category": "stderr", "type": "stderr",
                        // Truncating by byte index panics when byte 120 falls
                        // inside a character — which it does for any Korean or
                        // emoji output, killing this task and with it every
                        // diagnostic for the rest of the session.
                        "taskId": tid_stderr, "summary": truncate_chars(&text, 120),
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
        // 64 MB is far beyond any legitimate RPC line while still bounding a
        // runaway one; past it the codec errors and the connection ends
        // visibly instead of the process ballooning.
        const MAX_LINE_BYTES: usize = 64 * 1024 * 1024;
        use futures_util::StreamExt;
        let mut lines = tokio_util::codec::FramedRead::new(
            stdout,
            tokio_util::codec::LinesCodec::new_with_max_length(MAX_LINE_BYTES),
        );
        loop {
            // `while let Ok(Some(line))` silently exits on a read error, which
            // is indistinguishable from EOF — the process stays up, `alive`
            // stays true, and the thread accepts prompts it will never render.
            // One non-UTF-8 byte was enough to produce that.
            let line = match lines.next().await {
                Some(Ok(line)) => line,
                None => break, // EOF — the agent exited or closed stdout.
                Some(Err(e)) => {
                    log::warn!("[RPC] stdout read failed, ending the reader: {e}");
                    break;
                }
            };
            let line = line.trim_end_matches('\r');
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(line) {
                Ok(event) => handle_rpc_line(&reader_ctx, event),
                Err(e) => log::debug!("[RPC] non-JSON stdout line ({e}): {line}"),
            }
        }
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
                            // Tagged so the reader can chain a state refresh:
                            // the set of supported reasoning levels is a
                            // property of the model, so it changes here.
                            let _ = stdin_tx.send(json!({
                                "id": "__set_model",
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
                // Exit 137 (OOM-killed) and exit 0 were reported identically,
                // so a crash looked like a clean finish to the whole UI.
                if let Ok(status) = status {
                    if !status.success() {
                        reader.abort();
                        stderr_task.abort();
                        return Err(describe_exit(status));
                    }
                }
                break;
            }
        }
    }

    if killed {
        let _ = child.kill().await;
    }
    reader.abort();
    stderr_task.abort();
    Ok(())
}

/// Turn a non-zero exit into something a user can act on.
fn describe_exit(status: std::process::ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            // 9 is what the OOM killer sends, and it is the common case here:
            // the agent holds the whole conversation in memory.
            if signal == 9 {
                return "The agent was killed — most likely it ran out of memory. \
                        Try compacting the thread or starting a new one."
                    .to_string();
            }
            return format!("The agent was terminated by signal {signal}.");
        }
    }
    match status.code() {
        Some(code) => format!("The agent exited unexpectedly (code {code})."),
        None => "The agent exited unexpectedly.".to_string(),
    }
}

/// Build the `refine_status` event for a `refine_complete`/`refine_failed`
/// notification. Payload shapes verified against the bundled harness:
/// complete carries `result.appliedEdits[].applied`, failed carries `error`.
pub(crate) fn refine_status_payload(task_id: &str, event: &Value) -> Value {
    let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if event_type == "refine_failed" {
        let error = event.get("error").and_then(|v| v.as_str()).unwrap_or("unknown error");
        return json!({ "taskId": task_id, "status": "failed", "error": error });
    }
    let applied = event
        .get("result")
        .and_then(|r| r.get("appliedEdits"))
        .and_then(|a| a.as_array())
        .map(|edits| {
            edits
                .iter()
                .filter(|e| e.get("applied").and_then(|v| v.as_bool()).unwrap_or(false))
                .count()
        })
        .unwrap_or(0);
    json!({ "taskId": task_id, "status": "completed", "appliedCount": applied })
}

/// Max serialized size an event may have before the debug-panel mirror
/// replaces its payload with a placeholder. Tool results routinely carry
/// whole files; shipping them to the webview twice (once as the real event,
/// once as `debug_log`) doubled IPC volume on the streaming hot path.
pub(crate) const DEBUG_MIRROR_MAX_BYTES: usize = 32 * 1024;

/// Decide what (if anything) the debug panel gets for `event`.
///
/// - `message_update` deltas are not mirrored at all: the renderer already
///   receives every delta as `message_chunk` / `thinking_chunk`, and
///   mirroring each one duplicated per-token IPC traffic while streaming.
/// - Error events (`extension_error`) are always mirrored in full — they are
///   exactly what the debug panel exists for.
/// - Anything else larger than [`DEBUG_MIRROR_MAX_BYTES`] serialized is
///   replaced by a placeholder recording the type and original size.
pub(crate) fn debug_mirror_payload(event_type: &str, event: Value) -> Option<Value> {
    if event_type == "message_update" {
        return None;
    }
    if event_type == "extension_error" {
        return Some(event);
    }
    let size = serde_json::to_string(&event).map(|s| s.len()).unwrap_or(0);
    if size > DEBUG_MIRROR_MAX_BYTES {
        return Some(json!({
            "type": event_type,
            "truncated": true,
            "originalBytes": size,
            "note": format!(
                "payload over {} KB omitted from the debug mirror",
                DEBUG_MIRROR_MAX_BYTES / 1024
            ),
        }));
    }
    Some(event)
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
                            // `reason` is an agent-internal token. Run it
                            // through the same classifier rather than telling
                            // the user to open a panel buried in a menu.
                            let classified = crate::commands::provider_errors::classify(reason);
                            let _ = app.emit("task_error", json!({
                                "taskId": tid,
                                "message": classified.message,
                                "action": classified.action,
                                "detail": classified.detail,
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
            let stop = match stop_reason {
                "aborted" => "cancelled",
                "error" => "error",
                _ => "end_turn",
            };
            let _ = app.emit("turn_end", json!({ "taskId": tid, "stopReason": stop }));
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
                // Passing the provider's raw JSON straight through made a
                // rejected key indistinguishable from a 500 — both rendered as
                // a grey one-liner with no hint of what to do.
                let classified = crate::commands::provider_errors::classify(final_error);
                let _ = app.emit("task_error", json!({
                    "taskId": tid,
                    "message": classified.message,
                    "action": classified.action,
                    "detail": classified.detail,
                }));
            }
        }
        "refine_complete" | "refine_failed" => {
            // /refine passes through as a session command; without this its
            // outcome never reached the UI at all.
            let _ = app.emit("refine_status", refine_status_payload(tid, &event));
        }
        "thinking_level_changed" => {
            // The agent can change its own reasoning effort (goal autonomy,
            // cycling); mirror it so the UI's notion of the level stays true.
            let level = event.get("level").and_then(|v| v.as_str()).unwrap_or("");
            let _ = app.emit("thinking_level_changed", json!({ "taskId": tid, "level": level }));
        }
        "session_action_update" | "extension_error" | "service_tier_changed" => {
            // Surfaced only in the debug panel (below). Service tiers have no
            // GUI surface (the /fast dead end) — acknowledged, not lost.
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

    // Mirror into the debug panel — gated, not wholesale: streaming deltas
    // are skipped and oversized payloads truncated (`debug_mirror_payload`).
    let is_error = event_type == "extension_error";
    let event_type = event_type.to_string();
    if let Some(payload) = debug_mirror_payload(&event_type, event) {
        let _ = app.emit("debug_log", json!({
            "direction": "in", "category": "notification", "type": event_type,
            "taskId": tid, "summary": event_type, "payload": payload, "isError": is_error
        }));
    }
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
        "__set_model" => {
            // `set_model` returns the model, not the session state, and the
            // harness emits no model-changed notification. Chain an explicit
            // get_state so the effort picker learns which levels this model
            // supports. Sent only after the switch completed, so the state we
            // read back is the post-switch one.
            let _ = ctx.stdin_tx.send(
                json!({ "id": "__levels_refresh", "type": "get_state" }).to_string(),
            );
        }
        "__levels_refresh" => {
            let _ = ctx.app.emit("thinking_levels", json!({
                "taskId": ctx.task_id,
                "levels": data.get("availableThinkingLevels").cloned().unwrap_or(Value::Null),
                "current": data.get("thinkingLevel").cloned().unwrap_or(Value::Null),
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
        // Which reasoning levels this model actually supports. The harness
        // derives it per model, so a picker that hardcoded the full list would
        // offer levels the provider rejects.
        "availableThinkingLevels": state.get("availableThinkingLevels"),
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
                    // Byte-index truncation panics mid-character (Korean/emoji
                    // permission titles); truncate by characters instead.
                    if t.chars().count() > 120 {
                        t = truncate_chars(&t, 120);
                        t.push('…');
                    }
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
                                // "Always allow" must sort/route as allow_always,
                                // not allow_once — check the "always" prefix first.
                                let is_always = lower.contains("always");
                                let is_allow = lower.contains("allow") || lower.contains("yes") || lower.contains("approve");
                                let is_reject = lower.contains("deny") || lower.contains("no") || lower.contains("block") || lower.contains("reject");
                                let kind = if is_always && is_allow {
                                    "allow_always"
                                } else if is_always && is_reject {
                                    "reject_always"
                                } else if is_allow {
                                    "allow_once"
                                } else if is_reject {
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
