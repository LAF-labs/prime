use std::collections::HashMap;
use parking_lot::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};

use std::sync::Arc;

// ── Frontend-facing types (match Electron's JSON shape) ────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallData {
    pub tool_call_id: String,
    pub title: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locations: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<Value>,
    /// ISO timestamp of when the call first appeared (frontend-authored;
    /// round-tripped so resumption keeps inline ordering data).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// ISO timestamp of when the call reached a terminal status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

/// Anchor recording where a tool call appeared in the assistant prose stream
/// (`at` is a UTF-16 offset into the message content). Authored by the
/// frontend; carried through so resumption/fork keeps inline tool ordering.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallSplitData {
    pub at: u64,
    pub tool_call_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskMessage {
    pub role: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallData>>,
    /// Where each tool call sat in `content` during streaming. The frontend
    /// sends this in `existing_messages` on resumption; dropping it here used
    /// to silently discard inline tool ordering for resumed threads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_splits: Option<Vec<ToolCallSplitData>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub content: String,
    pub status: String,
    pub priority: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermission {
    pub request_id: String,
    pub tool_name: String,
    pub description: String,
    pub options: Vec<PermissionOption>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub workspace: String,
    pub status: String,
    pub created_at: String,
    pub messages: Vec<TaskMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_permission: Option<PendingPermission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<Vec<PlanStep>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_usage: Option<ContextUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_paused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_task_id: Option<String>,
    /// prime-agent session JSONL path (from get_state.sessionFile). Lets the
    /// app resume/fork natively with `-r` / `--fork` instead of replaying a
    /// transcript into a fresh context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_file: Option<String>,
    /// Spawn-time options (goal / autonomous) kept so reconnects preserve them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_options: Option<LaunchOptions>,
}

/// Session-level options that only exist as CLI flags at spawn time
/// (prime-agent has no RPC to switch them mid-session).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    /// `--goal <objective>`: a persistent objective the harness re-prompts
    /// until complete.
    pub goal: Option<String>,
    /// `--goal-token-budget <n>`
    pub goal_token_budget: Option<u64>,
    /// `--autonomous`: keep working through gates/limits without asking.
    #[serde(default)]
    pub autonomous: bool,
    /// `--autonomous-gate <cmd>` (repeatable): shell commands that must pass.
    #[serde(default)]
    pub autonomous_gates: Vec<String>,
    pub autonomous_max_turns: Option<u64>,
    pub autonomous_max_tokens: Option<u64>,
}

impl LaunchOptions {
    pub fn is_empty(&self) -> bool {
        self.goal.is_none() && !self.autonomous && self.autonomous_gates.is_empty()
    }
}

/// Permission model handed to the bundled gate at spawn time via environment
/// variables. Built from `AppSettings` (global + per-project) in
/// `commands::rpc::commands`, then serialized onto the child process env by
/// `run_rpc_connection`.
///
/// Spawn-time by design: the gate parses these once at extension init, so a
/// mode or rule change applies to newly-started threads, not to live ones.
#[derive(Clone, Debug, Default)]
pub struct PermissionConfig {
    /// "ask" | "acceptEdits" | "auto". Empty is treated as "ask".
    pub mode: String,
    /// JSON array of allow-rules (`[{"tool":"bash","argPattern":"git *"}]`), or
    /// an empty string when there are none.
    pub rules_json: String,
}

/// How to boot the prime-agent subprocess relative to prior history.
#[derive(Clone, Debug)]
pub enum SessionMode {
    /// Fresh session.
    New,
    /// `-r <file>`: resume an existing session file with full native context.
    Resume(String),
    /// `--fork <file>`: branch a new session off an existing one.
    Fork(String),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub used: u64,
    pub size: u64,
}

// ── Image attachment data sent from the frontend (fix #14) ─────────────

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    pub base64: String,
    pub mime_type: String,
    pub name: Option<String>,
}

// ── Commands sent to the agent connection thread ─────────────────────────

pub enum AgentCommand {
    Prompt(String, Vec<AttachmentData>),
    /// Raw RPC request already carrying its `id`; the reader routes the
    /// response back through `ConnectionHandle::pending`.
    Raw(Value),
    Cancel,
    SetMode(String),
    SetModel(String),
    /// prime-agent reasoning effort: off|minimal|low|medium|high|xhigh
    SetThinkingLevel(String),
    /// Manual context compaction.
    Compact,
    Kill,
}

// ── Per-task connection handle ─────────────────────────────────────────

pub struct ConnectionHandle {
    pub cmd_tx: mpsc::UnboundedSender<AgentCommand>,
    pub alive: Arc<std::sync::atomic::AtomicBool>,
    pub auto_approve: Arc<std::sync::atomic::AtomicBool>,
    /// The agent process's pid, which is also its process-group id — the child
    /// is made a group leader at spawn. Zero until the process is up, and again
    /// once it has exited. Teardown signals the group so the kernel, MCP
    /// servers, and tool subprocesses go with it.
    pub pid: Arc<std::sync::atomic::AtomicU32>,
    /// In-flight generic RPC requests, keyed by the correlation id we put on
    /// the wire. The reader resolves them when the matching `response` line
    /// arrives, which is what lets the UI call *any* prime-agent RPC command.
    pub pending: PendingRequests,
}

/// Correlation-id → responder for generic RPC requests.
pub type PendingRequests = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

// ── Global agent state ───────────────────────────────────────────────────

pub struct AgentState {
    pub tasks: Mutex<HashMap<String, Task>>,
    pub connections: Mutex<HashMap<String, ConnectionHandle>>,
    pub permission_resolvers: Mutex<HashMap<String, oneshot::Sender<PermissionReply>>>,
    /// Guard to prevent concurrent probe_capabilities calls. `Arc` so the
    /// probe thread can hold its own clone and reset the flag on exit even
    /// when the app is tearing down and `try_state` would fail.
    pub probe_running: Arc<std::sync::atomic::AtomicBool>,
    /// Task ids that have claimed an agent slot but whose connection handle is
    /// not in `connections` yet (spawn in progress). Counted alongside live
    /// connections when enforcing `max_concurrent_agents`, so two concurrent
    /// `task_create` calls cannot both pass the cap check before either one
    /// inserts its handle.
    pub reserved_slots: Mutex<std::collections::HashSet<String>>,
}

pub struct PermissionReply {
    pub option_id: String,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            connections: Mutex::new(HashMap::new()),
            permission_resolvers: Mutex::new(HashMap::new()),
            probe_running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reserved_slots: Mutex::new(std::collections::HashSet::new()),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskParams {
    pub name: String,
    pub workspace: String,
    pub prompt: String,
    pub auto_approve: Option<bool>,
    pub mode_id: Option<String>,
    /// Optional model id to apply right after the agent session is created.
    /// Falls back to project pref → global `defaultModel` → CLI default
    /// when not provided.
    pub model_id: Option<String>,
    pub attachments: Option<Vec<AttachmentData>>,
    /// When provided, the backend reuses this id and seeds the task with the
    /// supplied historical messages instead of generating a new uuid. Used for
    /// stateless resumption: the frontend keeps the original thread
    /// id while spawning a fresh prime-agent connection.
    pub existing_id: Option<String>,
    /// Prior messages to seed the task with (resumed threads pass their full
    /// history so it shows up in the timeline before the user's new prompt).
    pub existing_messages: Option<Vec<TaskMessage>>,
    /// prime-agent session file of the original thread. When present and the
    /// file still exists, resumption is native (`-r`) and no transcript
    /// preamble is injected.
    pub session_file: Option<String>,
    /// Goal / autonomous flags for this spawn.
    pub launch_options: Option<LaunchOptions>,
    /// When true, register the task in state but do not spawn a prime-agent
    /// subprocess and do not push an empty user message. The connection is
    /// spawned lazily on the first call to `task_send_message`. In practice
    /// the empty-prompt path in `task_create` is what triggers deferral (it
    /// ORs this flag with "prompt is empty"); no frontend caller sets it
    /// explicitly anymore.
    #[serde(default)]
    pub defer_spawn: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkTaskParams {
    pub task_id: String,
    pub workspace: Option<String>,
    pub parent_name: Option<String>,
    /// Parent thread's prime-agent session file for native `--fork`.
    pub session_file: Option<String>,
}
