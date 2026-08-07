use serde_json::Value;
use uuid::Uuid;

use crate::commands::agent_launch::{resolve as resolve_launch, AgentLaunch};
use super::connection::{composite_model_id, map_model, spawn_connection};
use super::types::*;
use super::types::{LaunchOptions, SessionMode};
use super::now_rfc3339;

/// Resolve the model id that should be applied to a freshly spawned agent
/// session. Order: explicit param → project-pref → global `defaultModel`.
/// Returns `None` when no preference is set, in which case the CLI subprocess
/// boots with its own built-in default model.
pub(crate) fn resolve_initial_model(
    explicit: Option<String>,
    workspace: &str,
    settings: &crate::commands::settings::AppSettings,
) -> Option<String> {
    if let Some(m) = explicit.filter(|s| !s.trim().is_empty()) {
        return Some(m);
    }
    if let Some(prefs) = settings.project_prefs.as_ref().and_then(|p| p.get(workspace)) {
        if let Some(m) = prefs.model_id.clone().filter(|s| !s.trim().is_empty()) {
            return Some(m);
        }
    }
    settings.default_model.clone().filter(|s| !s.trim().is_empty())
}

/// Refuse to start another agent when the machine already has enough.
///
/// Every live thread is a Node process that in turn runs a Python kernel, and
/// there was no cap at any level — not per window, not globally. With `/goal`
/// and autonomous mode in the product, threads can keep starting while nobody
/// is at the keyboard, and the failure mode was the OS refusing to fork with
/// an error that only reached the debug panel.
///
/// Reconnecting a thread that already has a slot is always allowed: that is
/// replacing a connection, not adding one.
fn ensure_agent_slot(
    state: &tauri::State<'_, AgentState>,
    configured: Option<u32>,
    task_id: &str,
) -> Result<(), String> {
    let (live, replacing) = {
        let conns = state.connections.lock();
        (conns.len(), conns.contains_key(task_id))
    };
    agent_slot_available(configured, live, replacing)
}

/// The decision itself, separated from the lock so it can be tested.
pub(crate) fn agent_slot_available(
    configured: Option<u32>,
    live: usize,
    replacing: bool,
) -> Result<(), String> {
    let limit = configured.unwrap_or(crate::commands::settings::DEFAULT_MAX_CONCURRENT_AGENTS);
    if limit == 0 {
        return Ok(()); // explicitly unlimited
    }
    if replacing || live < limit as usize {
        return Ok(());
    }
    Err(format!(
        "{} agent{} already running, which is the current limit. \
         Close a thread, or raise the limit in Settings.",
        limit,
        if limit == 1 { " is" } else { "s are" }
    ))
}

// ── Tauri Commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn task_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    settings_state: tauri::State<'_, crate::commands::settings::SettingsState>,
    params: CreateTaskParams,
) -> Result<Task, String> {
    // Stateless resumption: when the frontend supplies an
    // `existing_id`, reuse that id and replay the historical messages into the
    // backend's in-memory task map. The fresh prime-agent subprocess provides a
    // brand-new agent session; the message history travels to the model via the
    // user's next prompt rather than via any session-level resume capability.
    let id = params.existing_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = now_rfc3339();
    let settings = settings_state.0.lock();
    ensure_agent_slot(&state, settings.settings.max_concurrent_agents, &id)?;
    let auto_approve = params.auto_approve.unwrap_or(settings.settings.auto_approve);
    let agent_bin = settings.settings.agent_bin.clone();
    let co_author = settings.settings.co_author;
    let co_author_json_report = settings.settings.co_author_json_report;
    let tight_sandbox = settings.settings.project_prefs.as_ref()
        .and_then(|p| p.get(&params.workspace))
        .and_then(|pp| pp.tight_sandbox)
        .unwrap_or(true);
    let initial_model_id = resolve_initial_model(
        params.model_id.clone(),
        &params.workspace,
        &settings.settings,
    );
    drop(settings);

    // Seed the task with prior messages (if resuming).
    let mut messages: Vec<TaskMessage> = params.existing_messages.unwrap_or_default();
    let prompt_is_empty = params.prompt.trim().is_empty();
    if !prompt_is_empty {
        messages.push(TaskMessage {
            role: "user".to_string(),
            content: params.prompt.clone(),
            timestamp: now.clone(),
            tool_calls: None,
            tool_call_splits: None,
            thinking: None,
        });
    }

    // Empty prompt or explicit defer => deferred-spawn. The task is registered
    // but the prime-agent subprocess is not started until the user sends a real
    // message via `task_send_message`. Avoids spawning a process that would
    // immediately receive only the system prefix and confuse the model.
    let defer_spawn = params.defer_spawn || prompt_is_empty;
    let initial_status = if defer_spawn { "paused" } else { "running" };

    // A resumed thread with a still-existing prime-agent session file gets a
    // native `-r` resume: full model-side context, no transcript replay.
    let native_session_file = params
        .session_file
        .clone()
        .filter(|f| std::path::Path::new(f).exists());

    let task = Task {
        id: id.clone(),
        name: params.name,
        workspace: params.workspace.clone(),
        status: initial_status.to_string(),
        created_at: now,
        messages,
        pending_permission: None,
        plan: None,
        context_usage: None,
        auto_approve: Some(auto_approve),
        user_paused: None,
        parent_task_id: None,
        session_file: native_session_file.clone(),
        launch_options: params.launch_options.clone(),
    };

    // If a stale connection somehow lingers for this id, terminate it before
    // spawning a fresh one so the new subprocess owns the channel cleanly.
    // We drop the sender after Kill so the old thread's recv loop exits, then
    // yield briefly to let the OS reclaim the subprocess resources.
    // In edition 2021 the lock guard in an `if let` scrutinee lives to the end
    // of the block, so sleeping inside it held the global connections mutex
    // for 50 ms — stalling every RPC command on every other thread. Take the
    // handle out first so the lock is gone before the wait.
    let stale = state.connections.lock().remove(&id);
    if let Some(stale) = stale {
        let _ = stale.cmd_tx.send(AgentCommand::Kill);
        drop(stale);
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    state.tasks.lock().insert(id.clone(), task.clone());

    let _is_plan_mode = params.mode_id.as_deref() == Some("plan");

    // Deferred-spawn: register the task and return without launching prime-agent.
    // The first call to `task_send_message` will detect there is no connection
    // and spawn one on demand via the existing reconnect path.
    if defer_spawn {
        return Ok(task);
    }

    let launch = resolve_launch(&app, &agent_bin);
    let session_mode = match native_session_file.clone() {
        Some(f) => SessionMode::Resume(f),
        None => SessionMode::New,
    };
    let handle = spawn_connection(
        id.clone(),
        params.workspace,
        launch,
        auto_approve,
        app.clone(),
        params.mode_id,
        initial_model_id,
        tight_sandbox,
        session_mode,
        params.launch_options.clone().unwrap_or_default(),
    )?;

    // Project-independent chats (workspace under ~/.laf-agent/chats) skip the
    // question-format prefix and commit/report suffixes: no repo, no commits,
    // and every skipped token keeps casual chats cheap.
    let is_chat_workspace = task.workspace.contains("/.laf-agent/chats");

    // Send initial prompt with UI formatting rules prepended (not shown in UI)
    let mut system_prefix = String::from(concat!(
        "## Asking the user clarifying questions\n\n",
        "Default to action. Most of the time you should NOT ask. Make a reasonable ",
        "assumption, state it in one line, and proceed. Only escalate to a question ",
        "when you genuinely cannot decide and the choice would materially change the work.\n\n",
        "**Ask ONLY for:**\n",
        "- Architectural decisions with non-trivial tradeoffs (e.g. REST vs. gRPC, monolith vs. service split, sync vs. event-driven).\n",
        "- Tech-stack or framework picks where multiple options are defensible (e.g. Postgres vs. SQLite, Zustand vs. Redux).\n",
        "- External dependencies where alternatives differ meaningfully on license, size, maintenance, or lock-in.\n",
        "- Ambiguous scope where two reasonable interpretations of the request would lead to materially different implementations.\n",
        "- Irreversible or hard-to-reverse changes (data deletion, schema migrations, public API breaks, force-push, prod config).\n\n",
        "**Do NOT ask for:**\n",
        "- Status updates, progress notes, or \"FYI\" — write those as plain prose.\n",
        "- Confirmations of an obvious next step you should just take.\n",
        "- Trivial wording, naming, formatting, or styling choices — pick a sensible default.\n",
        "- Anything answerable by reading the codebase, running a tool, or web search.\n",
        "- Open-ended \"what do you think?\" prompts — those belong in plain prose, not `[N]:`.\n\n",
        "**Format (required for the UI to render an interactive card):**\n\n",
        "[1]: Concise question ending in a question mark?\n",
        "a. **Short label** — One-line description of the tradeoff.\n",
        "b. **Short label** — One-line description of the tradeoff.\n",
        "c. **Other** — Describe your preference.\n\n",
        "**Rules — strict:**\n",
        "- Use the `[N]:` bracket-number format only. Never use bold (`**1.`) or numbered lists for questions.\n",
        "- Every `[N]:` question MUST have 2–4 concrete options as `a.`, `b.`, `c.`, ... (lowercase). A `[N]:` line without options will not render as a card and will confuse the user — write open-ended thoughts as plain prose instead.\n",
        "- Cap each turn at **1–3 questions total**. If more decisions exist, pick the highest-leverage ones and state your default for the rest in plain prose (\"Assuming X unless you say otherwise\").\n",
        "- One question per distinct decision. Do not split a single decision across multiple questions or restate the same choice in different words.\n",
        "- Place each question and its options on consecutive lines.\n",
        "- A short lead-in sentence is optional.\n\n",
        "When in doubt: don't ask. Decide, state the assumption, and proceed.\n\n",
        "---\n\n",
    ));
    if co_author {
        system_prefix.push_str(concat!(
            "## Commits\n\n",
            "Every git commit must include the co-author trailer:\n\n",
            "```\nCo-authored-by: LAF Agent <laf-agent@users.noreply.github.com>\n```\n\n",
            "Use conventional commit format: `type(scope): description`.\n\n",
            "---\n\n",
        ));
    }
    // Resumption preamble: when a thread is being resumed, the fresh prime-agent
    // subprocess has no memory of the prior conversation. Replay the transcript
    // as context so the agent can follow up coherently. The messages live in
    // the user's first prompt instead of an in-process model session.
    //
    // The transcript is capped to keep the resumption preamble well under any
    // model's input window. Logic lives in `build_resumption_preamble` so
    // `task_fork` can share the same cap/format.
    let prior_messages: &[TaskMessage] = if native_session_file.is_some() {
        &[] // native resume carries the full context — no replay needed
    } else {
        task.messages
            .split_last()
            .map(|(_new, prior)| prior)
            .unwrap_or(&[])
    };
    let resumption_preamble = super::build_resumption_preamble(
        prior_messages,
        "Resumed conversation",
        "You are resuming an earlier conversation in this workspace. \
         The transcript below is for context only — do not repeat prior work \
         or re-execute completed tool calls. The user's new message follows \
         after the transcript.",
    );
    let json_report_suffix = if co_author_json_report {
        concat!(
            "\n\n## Completion report\n\n",
            "When you finish the task, append a JSON block at the very end of your final message.\n",
            "Use this exact format:\n\n",
            "```laf-agent-report\n",
            "{\n",
            "  \"status\": \"done\" | \"partial\" | \"blocked\",\n",
            "  \"summary\": \"one-line description of what was done\",\n",
            "  \"filesChanged\": [\"path/to/file.ts\"],\n",
            "  \"linesAdded\": 42,\n",
            "  \"linesRemoved\": 7\n",
            "}\n",
            "```\n\n",
            "Only include the block once, at the end. Do not wrap it in any other code fence.\n",
        )
    } else {
        ""
    };
    let full_prompt = if is_chat_workspace {
        format!("{resumption_preamble}{}", params.prompt)
    } else {
        format!("{system_prefix}{resumption_preamble}{}{json_report_suffix}", params.prompt)
    };
    let _ = handle.cmd_tx.send(AgentCommand::Prompt(full_prompt, params.attachments.unwrap_or_default()));

    state.connections.lock().insert(id, handle);

    Ok(task)
}

#[tauri::command]
pub fn task_list(state: tauri::State<'_, AgentState>) -> Result<Vec<Task>, String> {
    let tasks = state.tasks.lock();
    Ok(tasks.values().cloned().collect())
}

#[tauri::command]
pub fn task_send_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    settings_state: tauri::State<'_, crate::commands::settings::SettingsState>,
    task_id: String,
    message: String,
    attachments: Option<Vec<AttachmentData>>,
) -> Result<Task, String> {
    // Push user message
    {
        let mut tasks = state.tasks.lock();
        let task = tasks.get_mut(&task_id).ok_or("Task not found")?;
        task.messages.push(TaskMessage {
            role: "user".to_string(),
            content: message.clone(),
            timestamp: now_rfc3339(),
            tool_calls: None,
            tool_call_splits: None,
            thinking: None,
        });
        task.status = "running".to_string();
        use tauri::Emitter;
        let _ = app.emit("task_update", task.clone());
    }

    // Check if connection is alive, reconnect if needed
    let need_reconnect = {
        let conns = state.connections.lock();
        match conns.get(&task_id) {
            Some(h) => !h.alive.load(std::sync::atomic::Ordering::SeqCst),
            None => true,
        }
    };

    if need_reconnect {
        let settings = settings_state.0.lock();
        ensure_agent_slot(&state, settings.settings.max_concurrent_agents, &task_id)?;
        let agent_bin = settings.settings.agent_bin.clone();
        let global_auto_approve = settings.settings.auto_approve;

        let (workspace, task_auto_approve, task_session_file, stored_options) = {
            let tasks = state.tasks.lock();
            let t = tasks.get(&task_id).ok_or("Task not found")?;
            (
                t.workspace.clone(),
                t.auto_approve.unwrap_or(global_auto_approve),
                t.session_file.clone(),
                t.launch_options.clone().unwrap_or_default(),
            )
        };

        let tight_sandbox = settings.settings.project_prefs.as_ref()
            .and_then(|p| p.get(&workspace))
            .and_then(|pp| pp.tight_sandbox)
            .unwrap_or(true);
        let initial_model_id = resolve_initial_model(None, &workspace, &settings.settings);
        drop(settings);

        // Destroy old connection
        if let Some(old) = state.connections.lock().remove(&task_id) {
            let _ = old.cmd_tx.send(AgentCommand::Kill);
        }

        let launch = resolve_launch(&app, &agent_bin);
        let session_mode = match task_session_file.filter(|f| std::path::Path::new(f).exists()) {
            Some(f) => SessionMode::Resume(f),
            None => SessionMode::New,
        };

        // A fresh session gets the transcript replayed, exactly as task_create
        // and task_fork do. Without this — and a crash during the very first
        // turn guarantees there is no session file yet — the reconnect sent
        // the raw message alone, so the user was told "send a new message to
        // continue" and the agent then had total amnesia about the
        // conversation still visible on their screen.
        let full_message = if matches!(session_mode, SessionMode::New) {
            let preamble = {
                let tasks = state.tasks.lock();
                let prior = tasks.get(&task_id).map(|t| t.messages.as_slice()).unwrap_or(&[]);
                super::build_resumption_preamble(
                    prior,
                    "Resumed conversation",
                    "You are resuming an earlier conversation in this workspace. \
                     The transcript below is for context only — do not repeat prior work \
                     or re-execute completed tool calls. The user's new message follows \
                     after the transcript.",
                )
            };
            format!("{preamble}{message}")
        } else {
            message
        };

        let handle = spawn_connection(
            task_id.clone(), workspace, launch, task_auto_approve,
            app.clone(), None, initial_model_id, tight_sandbox, session_mode,
            stored_options,
        )?;
        let _ = handle.cmd_tx.send(AgentCommand::Prompt(full_message, attachments.unwrap_or_default()));
        state.connections.lock().insert(task_id.clone(), handle);
    } else {
        // The liveness check above and this send are not atomic: the child can
        // die in between. Swallowing the error left the message in the
        // timeline with a spinner that ran until the 5-minute watchdog, and
        // the user had no way to know it was never delivered.
        let sent = {
            let conns = state.connections.lock();
            match conns.get(&task_id) {
                Some(h) => h
                    .cmd_tx
                    .send(AgentCommand::Prompt(message, attachments.unwrap_or_default()))
                    .is_ok(),
                None => false,
            }
        };
        if !sent {
            if let Some(task) = state.tasks.lock().get_mut(&task_id) {
                task.status = "paused".to_string();
            }
            return Err(
                "The agent connection closed before the message was sent. Send it again to reconnect."
                    .to_string(),
            );
        }
    }

    let tasks = state.tasks.lock();
    tasks.get(&task_id).cloned().ok_or_else(|| "Task not found".to_string())
}

#[tauri::command]
pub fn task_pause(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    task_id: String,
) -> Result<Task, String> {
    if let Some(h) = state.connections.lock().get(&task_id) {
        let _ = h.cmd_tx.send(AgentCommand::Cancel);
    }
    let mut tasks = state.tasks.lock();
    let task = tasks.get_mut(&task_id).ok_or("Task not found")?;
    task.status = "paused".to_string();
    task.user_paused = Some(true);
    use tauri::Emitter;
    let _ = app.emit("task_update", task.clone());
    Ok(task.clone())
}

#[tauri::command]
pub fn task_resume(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    task_id: String,
) -> Result<Task, String> {
    if let Some(h) = state.connections.lock().get(&task_id) {
        let _ = h.cmd_tx.send(AgentCommand::Prompt("continue".to_string(), vec![]));
    }
    let mut tasks = state.tasks.lock();
    let task = tasks.get_mut(&task_id).ok_or("Task not found")?;
    task.status = "running".to_string();
    task.user_paused = Some(false);
    use tauri::Emitter;
    let _ = app.emit("task_update", task.clone());
    Ok(task.clone())
}

#[tauri::command]
pub fn task_set_auto_approve(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    task_id: String,
    auto_approve: bool,
) -> Result<(), String> {
    if let Some(h) = state.connections.lock().get(&task_id) {
        h.auto_approve.store(auto_approve, std::sync::atomic::Ordering::SeqCst);
    }
    let mut tasks = state.tasks.lock();
    if let Some(task) = tasks.get_mut(&task_id) {
        task.auto_approve = Some(auto_approve);
        use tauri::Emitter;
        let _ = app.emit("task_update", task.clone());
    }
    Ok(())
}

#[tauri::command]
pub fn task_cancel(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    task_id: String,
) -> Result<(), String> {
    if let Some(h) = state.connections.lock().remove(&task_id) {
        let _ = h.cmd_tx.send(AgentCommand::Kill);
    }
    let mut tasks = state.tasks.lock();
    if let Some(task) = tasks.get_mut(&task_id) {
        task.status = "cancelled".to_string();
        use tauri::Emitter;
        let _ = app.emit("task_update", task.clone());
    }
    // Purge from in-memory map — the frontend owns thread persistence via
    // its own store. Keeping cancelled tasks here leaks memory indefinitely.
    tasks.remove(&task_id);
    Ok(())
}

#[tauri::command]
pub fn task_delete(state: tauri::State<'_, AgentState>, task_id: String) -> Result<(), String> {
    if let Some(h) = state.connections.lock().remove(&task_id) {
        let _ = h.cmd_tx.send(AgentCommand::Kill);
    }
    state.tasks.lock().remove(&task_id);
    Ok(())
}

#[tauri::command]
pub async fn task_fork(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    settings_state: tauri::State<'_, crate::commands::settings::SettingsState>,
    params: ForkTaskParams,
) -> Result<Task, String> {
    let task_id = &params.task_id;
    {
        let limit = settings_state.0.lock().settings.max_concurrent_agents;
        // A fork is an additional agent, not a replacement — check against a
        // fresh id so an existing slot for the parent doesn't wave it through.
        ensure_agent_slot(&state, limit, "")?;
    }
    let parent = {
        let tasks = state.tasks.lock();
        tasks.get(task_id).cloned()
    };
    let workspace = parent.as_ref().map(|p| p.workspace.clone())
        .or(params.workspace)
        .ok_or("No workspace found for task")?;
    let parent_name = parent.as_ref().map(|p| p.name.clone())
        .or(params.parent_name)
        .unwrap_or_else(|| "thread".to_string());
    let parent_session_file = parent
        .as_ref()
        .and_then(|p| p.session_file.clone())
        .or(params.session_file)
        .filter(|f| std::path::Path::new(f).exists());
    let mut parent_messages = parent.as_ref().map(|p| p.messages.clone()).unwrap_or_default();
    let parent_auto_approve = parent.as_ref().and_then(|p| p.auto_approve);

    // Normalize tool-call statuses on the cloned messages. The parent may be
    // mid-stream when forked; non-terminal statuses (`pending`, `in_progress`)
    // would render in the fork as if work were ongoing. Fix this on the data
    // before storing it on the new task.
    //
    // Note: there's a benign race here — the parent may complete a tool call
    // between our clone and this sanitize. The fork is a point-in-time snapshot
    // and the user can always see the parent's live state in its own thread.
    super::sanitize_forked_messages(&mut parent_messages);

    let new_id = Uuid::new_v4().to_string();
    let now = now_rfc3339();
    let settings = settings_state.0.lock();
    let auto_approve = parent_auto_approve.unwrap_or(settings.settings.auto_approve);
    let agent_bin = settings.settings.agent_bin.clone();
    let tight_sandbox = settings.settings.project_prefs.as_ref()
        .and_then(|p| p.get(&workspace))
        .and_then(|pp| pp.tight_sandbox)
        .unwrap_or(true);
    let initial_model_id = resolve_initial_model(None, &workspace, &settings.settings);
    drop(settings);

    // Build the transcript-replay preamble from the parent's messages. The
    // freshly spawned prime-agent subprocess has no memory of the parent's
    // conversation, so we ship the transcript on the user's *next* prompt.
    // Stored on the connection handle and consumed on the first Prompt — the
    // fork lands in `paused` state with no model traffic until the user sends.
    let pending_preamble = if parent_session_file.is_some() {
        String::new() // native --fork carries the full context
    } else {
        super::build_resumption_preamble(
        &parent_messages,
        "Forked conversation",
        "This thread was forked from an earlier conversation. The transcript \
         below is for context only — do not repeat prior work or re-execute \
         completed tool calls. The user's new message follows after the \
         transcript and may diverge from the original direction.",
    )
    };

    let fork_task = Task {
        id: new_id.clone(),
        name: format!("fork: {}", parent_name),
        workspace: workspace.clone(),
        status: "paused".to_string(),
        created_at: now.clone(),
        messages: {
            let mut msgs = parent_messages;
            msgs.push(TaskMessage {
                role: "system".to_string(),
                content: format!("Forked from: {}", parent_name),
                timestamp: now,
                tool_calls: None,
                tool_call_splits: None,
                thinking: None,
            });
            msgs
        },
        pending_permission: None,
        plan: None,
        context_usage: None,
        auto_approve: Some(auto_approve),
        user_paused: None,
        parent_task_id: Some(task_id.clone()),
        session_file: None,
        launch_options: None,
    };
    state.tasks.lock().insert(new_id.clone(), fork_task.clone());
    let preamble_opt = if pending_preamble.is_empty() { None } else { Some(pending_preamble) };
    let launch = resolve_launch(&app, &agent_bin);
    let session_mode = match parent_session_file {
        Some(f) => SessionMode::Fork(f),
        None => SessionMode::New,
    };
    let handle = super::connection::spawn_connection_with_preamble(
        new_id.clone(),
        workspace,
        launch,
        auto_approve,
        app,
        None,
        initial_model_id,
        tight_sandbox,
        session_mode,
        LaunchOptions::default(),
        preamble_opt,
    )?;
    state.connections.lock().insert(new_id, handle);
    Ok(fork_task)
}

#[tauri::command]
pub fn task_allow_permission(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    task_id: String,
    request_id: String,
    option_id: Option<String>,
) -> Result<(), String> {
    let resolved_id = if let Some(id) = option_id {
        id
    } else {
        let tasks = state.tasks.lock();
        tasks.get(&task_id)
            .and_then(|t| t.pending_permission.as_ref())
            .and_then(|pp| {
                pp.options.iter().find(|o| o.kind == "allow_once")
                    .or_else(|| pp.options.iter().find(|o| o.kind == "allow_always"))
                    .or_else(|| pp.options.first())
            })
            .map(|o| o.option_id.clone())
            .unwrap_or_else(|| "allow".to_string())
    };

    if let Some(tx) = state.permission_resolvers.lock().remove(&request_id) {
        let _ = tx.send(PermissionReply { option_id: resolved_id });
    }

    let mut tasks = state.tasks.lock();
    if let Some(task) = tasks.get_mut(&task_id) {
        task.status = "running".to_string();
        task.pending_permission = None;
        use tauri::Emitter;
        let _ = app.emit("task_update", task.clone());
    }
    Ok(())
}

#[tauri::command]
pub fn task_deny_permission(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    task_id: String,
    request_id: String,
    option_id: Option<String>,
) -> Result<(), String> {
    let resolved_id = if let Some(id) = option_id {
        id
    } else {
        let tasks = state.tasks.lock();
        tasks.get(&task_id)
            .and_then(|t| t.pending_permission.as_ref())
            .and_then(|pp| {
                pp.options.iter().find(|o| o.kind == "reject_once")
                    .or_else(|| pp.options.iter().find(|o| o.kind == "reject_always"))
                    .or_else(|| pp.options.first())
            })
            .map(|o| o.option_id.clone())
            .unwrap_or_else(|| "reject".to_string())
    };

    if let Some(tx) = state.permission_resolvers.lock().remove(&request_id) {
        let _ = tx.send(PermissionReply { option_id: resolved_id });
    }

    let mut tasks = state.tasks.lock();
    if let Some(task) = tasks.get_mut(&task_id) {
        task.status = "running".to_string();
        task.pending_permission = None;
        use tauri::Emitter;
        let _ = app.emit("task_update", task.clone());
    }
    Ok(())
}

#[tauri::command]
pub fn set_mode(
    state: tauri::State<'_, AgentState>,
    task_id: String,
    mode_id: String,
) -> Result<(), String> {
    let conns = state.connections.lock();
    let h = conns.get(&task_id).ok_or("No connection for task")?;
    h.cmd_tx.send(AgentCommand::SetMode(mode_id)).map_err(|e| e.to_string())
}

/// Apply a model selection to the live agent session for `task_id`. The change
/// is delivered as an `AgentCommand::SetModel`, which the connection loop
/// translates into a `session/set_model` request to prime-agent. Returns
/// `Ok(())` even when the task has no live connection (e.g. deferred-spawn
/// thread) — the model preference is still persisted in `projectPrefs`/
/// `defaultModel` by the frontend, and the next spawn will pick it up via
/// `resolve_initial_model`.
#[tauri::command]
pub fn set_model(
    state: tauri::State<'_, AgentState>,
    task_id: String,
    model_id: String,
) -> Result<(), String> {
    let conns = state.connections.lock();
    if let Some(h) = conns.get(&task_id) {
        h.cmd_tx.send(AgentCommand::SetModel(model_id)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Spawn a short-lived `prime-agent --mode rpc --no-session` subprocess and
/// query the model catalog plus current state. Used by `list_models` and
/// `probe_capabilities`. Blocks up to 30 seconds; a watchdog kills the
/// subprocess if it never answers.
pub(crate) fn query_models_blocking(launch: &AgentLaunch) -> Result<(Vec<Value>, Option<String>), String> {
    use std::io::{BufRead, BufReader, Write};

    let mut child = std::process::Command::new(&launch.program)
        .args(&launch.prefix_args)
        .args(["--mode", "rpc", "--no-session"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .env("PATH", format!("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{}", std::env::var("PATH").unwrap_or_default()))
        .spawn()
        .map_err(|e| format!("Failed to spawn prime-agent: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;

    // Watchdog: kill the subprocess if it hasn't answered within 30s so the
    // blocking reader below can't hang forever.
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let done_wd = done.clone();
    let pid = child.id();
    std::thread::spawn(move || {
        for _ in 0..300 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if done_wd.load(std::sync::atomic::Ordering::SeqCst) {
                return;
            }
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    });

    stdin
        .write_all(b"{\"id\":\"m\",\"type\":\"get_available_models\"}\n{\"id\":\"s\",\"type\":\"get_state\"}\n")
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("Failed to write to prime-agent: {e}"))?;

    let mut models: Option<Value> = None;
    let mut state: Option<Value> = None;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let Ok(val) = serde_json::from_str::<Value>(line.trim_end_matches('\r')) else { continue };
        if val.get("type").and_then(|t| t.as_str()) != Some("response") {
            continue;
        }
        match val.get("id").and_then(|i| i.as_str()) {
            Some("m") => models = val.get("data").cloned(),
            Some("s") => state = val.get("data").cloned(),
            _ => {}
        }
        if models.is_some() && state.is_some() {
            break;
        }
    }
    done.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = child.kill();
    let _ = child.wait();

    let models = models.ok_or("prime-agent did not answer get_available_models")?;
    let available: Vec<Value> = models
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| arr.iter().filter_map(map_model).collect())
        .unwrap_or_default();
    let current = state
        .as_ref()
        .and_then(|s| s.get("model"))
        .and_then(composite_model_id);
    Ok((available, current))
}

/// Send an arbitrary prime-agent RPC command to a live session and await its
/// response. This is the bridge that gives the GUI the *whole* CLI surface —
/// `compact`, `refine`, `clone`, `export_html`, `set_session_name`,
/// `get_session_stats`, heartbeats, schedules, and anything prime-agent adds
/// later — without a bespoke Tauri command per feature.
///
/// `command` is the RPC `type` (e.g. "export_html"); `params` are merged into
/// the request object. Returns the response's `data` on success.
#[tauri::command]
pub async fn agent_rpc_request(
    state: tauri::State<'_, AgentState>,
    task_id: String,
    command: String,
    params: Option<Value>,
) -> Result<Value, String> {
    // Never let a UI call impersonate the connection's internal bookkeeping ids.
    if command.trim().is_empty() {
        return Err("RPC command must not be empty".to_string());
    }
    let request_id = format!("ui-{}", Uuid::new_v4());

    let mut payload = serde_json::Map::new();
    if let Some(Value::Object(extra)) = params {
        for (k, v) in extra {
            if k != "type" && k != "id" {
                payload.insert(k, v);
            }
        }
    }
    payload.insert("type".into(), Value::String(command.clone()));
    payload.insert("id".into(), Value::String(request_id.clone()));

    let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
    {
        let conns = state.connections.lock();
        let handle = conns
            .get(&task_id)
            .ok_or_else(|| "This thread has no live agent connection yet.".to_string())?;
        handle.pending.lock().insert(request_id.clone(), tx);
        if let Err(e) = handle.cmd_tx.send(AgentCommand::Raw(Value::Object(payload))) {
            // The reservation outlives the failed send otherwise, and nothing
            // else would ever clear it.
            handle.pending.lock().remove(&request_id);
            return Err(format!("Failed to reach the agent: {e}"));
        }
    }

    let response = match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => {
            return Err("The agent connection closed before responding.".to_string());
        }
        Err(_) => {
            // Drop the reservation so a late response doesn't leak the entry.
            if let Some(h) = state.connections.lock().get(&task_id) {
                h.pending.lock().remove(&request_id);
            }
            return Err(format!("'{command}' timed out after 120s."));
        }
    };

    if response.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(response.get("data").cloned().unwrap_or(Value::Null))
    } else {
        Err(response
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("The agent rejected the command.")
            .to_string())
    }
}

/// Set the reasoning effort for a live session.
#[tauri::command]
pub fn set_thinking_level(
    state: tauri::State<'_, AgentState>,
    task_id: String,
    level: String,
) -> Result<(), String> {
    const LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high", "xhigh"];
    if !LEVELS.contains(&level.as_str()) {
        return Err(format!("Unknown thinking level '{level}'"));
    }
    let conns = state.connections.lock();
    if let Some(h) = conns.get(&task_id) {
        h.cmd_tx.send(AgentCommand::SetThinkingLevel(level)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Ask the agent to compact its context now.
#[tauri::command]
pub fn compact_context(
    state: tauri::State<'_, AgentState>,
    task_id: String,
) -> Result<(), String> {
    let conns = state.connections.lock();
    let h = conns.get(&task_id).ok_or("No connection for task")?;
    h.cmd_tx.send(AgentCommand::Compact).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_models(
    app: tauri::AppHandle,
    settings_state: tauri::State<'_, crate::commands::settings::SettingsState>,
    agent_bin: Option<String>,
) -> Result<Value, String> {
    let bin = match agent_bin {
        Some(b) => b,
        None => settings_state.0.lock().settings.agent_bin.clone(),
    };
    let launch = resolve_launch(&app, &bin);

    // The probe itself is blocking (spawns the agent and reads stdio), so it
    // runs on the blocking pool. The command stays async: a sync command doing
    // `recv_timeout(35s)` froze the webview's invoke thread for the duration.
    let handle = tauri::async_runtime::spawn_blocking(move || query_models_blocking(&launch));
    let (available, current) = tokio::time::timeout(std::time::Duration::from_secs(35), handle)
        .await
        .map_err(|_| "list_models timed out after 35s".to_string())?
        .map_err(|e| format!("list_models probe task failed: {e}"))??;
    Ok(serde_json::json!({
        "availableModels": available,
        "currentModelId": current,
    }))
}

#[tauri::command]
pub fn probe_capabilities(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    settings_state: tauri::State<'_, crate::commands::settings::SettingsState>,
) -> Result<Value, String> {
    // Prevent concurrent probes (React StrictMode, HMR reloads)
    if state.probe_running.swap(true, std::sync::atomic::Ordering::SeqCst) {
        log::info!("[rpc] probe_capabilities skipped (already running)");
        return Ok(serde_json::json!({ "ok": true, "skipped": true }));
    }

    let bin = settings_state.0.lock().settings.agent_bin.clone();
    log::info!("[RPC] probe_capabilities starting with bin={}", bin);
    let launch = resolve_launch(&app, &bin);

    let app_for_flag = app.clone();
    let app_clone = app.clone();

    std::thread::spawn(move || {
        let result = query_models_blocking(&launch);

        // ALWAYS reset the probe guard when the thread exits
        use tauri::Manager;
        if let Some(agent_state) = app_for_flag.try_state::<AgentState>() {
            agent_state.probe_running.store(false, std::sync::atomic::Ordering::SeqCst);
        }

        match result {
            Ok((available, current)) => {
                log::info!("[RPC] probe session_init: {} models (current={})",
                    available.len(), current.as_deref().unwrap_or("none"));
                use tauri::Emitter;
                let _ = app_clone.emit("session_init", serde_json::json!({
                    "taskId": "__probe__",
                    "models": { "availableModels": available, "currentModelId": current },
                    "modes": { "availableModes": [], "currentModeId": Value::Null },
                    "configOptions": Value::Null,
                }));
            }
            Err(e) => log::warn!("[RPC] probe_capabilities failed: {}", e),
        }
    });

    // Return immediately — models/modes arrive via session_init event
    Ok(serde_json::json!({ "ok": true, "async": true }))
}
