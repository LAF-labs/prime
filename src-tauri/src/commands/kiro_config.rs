use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

use super::error::AppError;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KiroAgentHook {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matcher: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct KiroAgentHooks {
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub agent_spawn: Vec<KiroAgentHook>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub user_prompt_submit: Vec<KiroAgentHook>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub pre_tool_use: Vec<KiroAgentHook>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub post_tool_use: Vec<KiroAgentHook>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub stop: Vec<KiroAgentHook>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KiroAgent {
    pub name: String,
    pub description: String,
    pub tools: Vec<String>,
    pub source: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub welcome_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyboard_shortcut: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub resources: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hooks: Option<KiroAgentHooks>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KiroPrompt {
    pub name: String,
    pub content: String,
    pub source: String,
    pub file_path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KiroSkill {
    pub name: String,
    pub source: String,
    pub file_path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KiroSteeringRule {
    pub name: String,
    pub always_apply: bool,
    pub source: String,
    pub excerpt: String,
    pub file_path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KiroMcpServer {
    pub name: String,
    pub enabled: bool,
    pub transport: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_tools: Option<Vec<String>>,
    pub file_path: String,
    /// "global" (~/.kiro/settings/mcp.json) or "local" (<project>/.kiro/settings/mcp.json).
    /// When the same server name appears in both, the local entry wins.
    pub source: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct KiroConfig {
    pub agents: Vec<KiroAgent>,
    pub skills: Vec<KiroSkill>,
    pub steering_rules: Vec<KiroSteeringRule>,
    pub mcp_servers: Vec<KiroMcpServer>,
    pub prompts: Vec<KiroPrompt>,
}

fn source_str(is_global: bool) -> &'static str {
    if is_global { "global" } else { "local" }
}

fn parse_steering_frontmatter(content: &str) -> (bool, String) {
    let mut always_apply = false;
    let mut body = content;
    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("\n---") {
            let fm = &content[3..3 + end_idx];
            body = &content[3 + end_idx + 4..];
            for line in fm.lines() {
                let line = line.trim();
                if line.starts_with("alwaysApply") {
                    if let Some(val) = line.split(':').nth(1) {
                        always_apply = val.trim() == "true";
                    }
                }
            }
        }
    }
    let excerpt = body
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .take(1)
        .collect::<Vec<_>>()
        .join("");
    let excerpt = if excerpt.len() > 120 { excerpt[..120].to_string() } else { excerpt };
    (always_apply, excerpt)
}

fn parse_agent_hooks(obj: &serde_json::Map<String, serde_json::Value>) -> Option<KiroAgentHooks> {
    let hooks_val = obj.get("hooks")?;
    let hooks_obj = hooks_val.as_object()?;

    fn parse_hook_list(val: &serde_json::Value) -> Vec<KiroAgentHook> {
        val.as_array().map(|arr| {
            arr.iter().filter_map(|h| {
                let cmd = h.get("command")?.as_str()?.to_string();
                let matcher = h.get("matcher").and_then(|v| v.as_str()).map(String::from);
                Some(KiroAgentHook { command: cmd, matcher })
            }).collect()
        }).unwrap_or_default()
    }

    let hooks = KiroAgentHooks {
        agent_spawn: hooks_obj.get("agentSpawn").map(parse_hook_list).unwrap_or_default(),
        user_prompt_submit: hooks_obj.get("userPromptSubmit").map(parse_hook_list).unwrap_or_default(),
        pre_tool_use: hooks_obj.get("preToolUse").map(parse_hook_list).unwrap_or_default(),
        post_tool_use: hooks_obj.get("postToolUse").map(parse_hook_list).unwrap_or_default(),
        stop: hooks_obj.get("stop").map(parse_hook_list).unwrap_or_default(),
    };

    // Only return Some if at least one hook is defined
    let has_hooks = !hooks.agent_spawn.is_empty()
        || !hooks.user_prompt_submit.is_empty()
        || !hooks.pre_tool_use.is_empty()
        || !hooks.post_tool_use.is_empty()
        || !hooks.stop.is_empty();
    if has_hooks { Some(hooks) } else { None }
}

fn scan_agents(base: &Path, is_global: bool) -> Vec<KiroAgent> {
    let dir = base.join("agents");
    let Ok(entries) = fs::read_dir(&dir) else { return vec![] };
    let source = source_str(is_global);
    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.ends_with(".json") && !name.starts_with('.')
        })
        .filter_map(|e| {
            let fp = e.path();
            let raw: serde_json::Value = serde_json::from_str(&fs::read_to_string(&fp).ok()?).ok()?;
            let obj = raw.as_object()?;
            let file_name = fp.file_stem()?.to_string_lossy().to_string();
            Some(KiroAgent {
                name: obj.get("name").and_then(|v| v.as_str()).unwrap_or(&file_name).to_string(),
                description: obj.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                tools: obj.get("tools").and_then(|v| v.as_array()).map(|a| {
                    a.iter().filter_map(|v| v.as_str().map(String::from)).collect()
                }).unwrap_or_default(),
                source: source.to_string(),
                file_path: fp.to_string_lossy().to_string(),
                welcome_message: obj.get("welcomeMessage").and_then(|v| v.as_str()).map(String::from),
                keyboard_shortcut: obj.get("keyboardShortcut").and_then(|v| v.as_str()).map(String::from),
                model: obj.get("model").and_then(|v| v.as_str()).map(String::from),
                resources: obj.get("resources").and_then(|v| v.as_array()).map(|a| {
                    a.iter().filter_map(|v| v.as_str().map(String::from)).collect()
                }).unwrap_or_default(),
                hooks: parse_agent_hooks(obj),
            })
        })
        .collect()
}

fn scan_skills(base: &Path, is_global: bool) -> Vec<KiroSkill> {
    let dir = base.join("skills");
    let Ok(entries) = fs::read_dir(&dir) else { return vec![] };
    let source = source_str(is_global);
    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name();
            !name.to_string_lossy().starts_with('.')
                && (e.file_type().map_or(false, |t| t.is_dir() || t.is_symlink()))
        })
        .map(|e| {
            let skill_md = e.path().join("SKILL.md");
            let file_path = if skill_md.exists() {
                skill_md.to_string_lossy().to_string()
            } else {
                e.path().to_string_lossy().to_string()
            };
            KiroSkill {
                name: e.file_name().to_string_lossy().to_string(),
                source: source.to_string(),
                file_path,
            }
        })
        .collect()
}

fn scan_steering(base: &Path, is_global: bool) -> Vec<KiroSteeringRule> {
    let dir = base.join("steering");
    let Ok(entries) = fs::read_dir(&dir) else { return vec![] };
    let source = source_str(is_global);
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".md"))
        .filter_map(|e| {
            let fp = e.path();
            let content = fs::read_to_string(&fp).ok()?;
            let (always_apply, excerpt) = parse_steering_frontmatter(&content);
            Some(KiroSteeringRule {
                name: fp.file_stem()?.to_string_lossy().to_string(),
                always_apply,
                source: source.to_string(),
                excerpt,
                file_path: fp.to_string_lossy().to_string(),
            })
        })
        .collect()
}

fn scan_prompts(base: &Path, is_global: bool) -> Vec<KiroPrompt> {
    let dir = base.join("prompts");
    let Ok(entries) = fs::read_dir(&dir) else { return vec![] };
    let source = source_str(is_global);
    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            (name.ends_with(".md") || name.ends_with(".txt")) && !name.starts_with('.')
        })
        .filter_map(|e| {
            let fp = e.path();
            let content = fs::read_to_string(&fp).ok()?;
            let name = fp.file_stem()?.to_string_lossy().to_string();
            Some(KiroPrompt {
                name,
                content,
                source: source.to_string(),
                file_path: fp.to_string_lossy().to_string(),
            })
        })
        .collect()
}

fn scan_root_steering(kiro_dir: &Path, is_global: bool, existing: &[KiroSteeringRule]) -> Vec<KiroSteeringRule> {
    let Ok(entries) = fs::read_dir(kiro_dir) else { return vec![] };
    let source = source_str(is_global);
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".md"))
        .filter_map(|e| {
            let fp = e.path();
            let name = fp.file_stem()?.to_string_lossy().to_string();
            if existing.iter().any(|r| r.name == name && r.source == source) {
                return None;
            }
            let content = fs::read_to_string(&fp).ok()?;
            let (always_apply, excerpt) = parse_steering_frontmatter(&content);
            Some(KiroSteeringRule {
                name,
                always_apply,
                source: source.to_string(),
                excerpt,
                file_path: fp.to_string_lossy().to_string(),
            })
        })
        .collect()
}

fn load_mcp_file(file_path: &Path, is_global: bool, out: &mut Vec<KiroMcpServer>) {
    let Ok(content) = fs::read_to_string(file_path) else { return };
    let Ok(raw) = serde_json::from_str::<serde_json::Value>(&content) else { return };
    let Some(servers) = raw.get("mcpServers").and_then(|v| v.as_object()) else { return };
    let fp = file_path.to_string_lossy().to_string();
    let source = source_str(is_global);
    for (name, cfg) in servers {
        let disabled = cfg.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
        let has_url = cfg.get("url").and_then(|v| v.as_str()).is_some();
        let has_command = cfg.get("command").and_then(|v| v.as_str()).is_some();
        let error = if !has_url && !has_command {
            Some("Missing command or url".to_string())
        } else if has_url {
            let url = cfg["url"].as_str().unwrap_or("");
            if !url.starts_with("http") { Some("Invalid url".to_string()) } else { None }
        } else {
            None
        };
        let disabled_tools = cfg.get("disabledTools").and_then(|v| v.as_array()).map(|a| {
            a.iter().filter_map(|v| v.as_str().map(String::from)).collect()
        });
        let entry = KiroMcpServer {
            name: name.clone(),
            enabled: !disabled,
            transport: if has_url { "http".to_string() } else { "stdio".to_string() },
            command: cfg.get("command").and_then(|v| v.as_str()).map(String::from),
            args: cfg.get("args").and_then(|v| v.as_array()).map(|a| {
                a.iter().filter_map(|v| v.as_str().map(String::from)).collect()
            }),
            url: cfg.get("url").and_then(|v| v.as_str()).map(String::from),
            error,
            disabled_tools,
            file_path: fp.clone(),
            source: source.to_string(),
        };
        // Local entries override global ones with the same name (mirrors how
        // most editors merge user-level and workspace-level configs).
        if let Some(existing) = out.iter_mut().find(|e| e.name == entry.name) {
            *existing = entry;
        } else {
            out.push(entry);
        }
    }
}

#[tauri::command]
pub fn get_kiro_config(project_path: Option<String>) -> KiroConfig {
    let mut config = KiroConfig::default();

    if let Some(home) = dirs::home_dir() {
        let global_kiro = home.join(".kiro");
        config.agents.extend(scan_agents(&global_kiro, true));
        config.skills.extend(scan_skills(&global_kiro, true));
        config.steering_rules.extend(scan_steering(&global_kiro, true));
        config.prompts.extend(scan_prompts(&global_kiro, true));
        load_mcp_file(&global_kiro.join("settings").join("mcp.json"), true, &mut config.mcp_servers);
    }

    if let Some(ref project) = project_path {
        let local_kiro = Path::new(project).join(".kiro");
        config.agents.extend(scan_agents(&local_kiro, false));
        config.skills.extend(scan_skills(&local_kiro, false));
        config.steering_rules.extend(scan_steering(&local_kiro, false));
        let root_rules = scan_root_steering(&local_kiro, false, &config.steering_rules);
        config.steering_rules.extend(root_rules);
        // Local prompts override global ones with the same name
        let local_prompts = scan_prompts(&local_kiro, false);
        for lp in local_prompts {
            if let Some(existing) = config.prompts.iter_mut().find(|p| p.name == lp.name) {
                *existing = lp;
            } else {
                config.prompts.push(lp);
            }
        }
        load_mcp_file(&local_kiro.join("settings").join("mcp.json"), false, &mut config.mcp_servers);
    }

    config
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerPatch {
    pub disabled: Option<bool>,
    pub disabled_tools: Option<Vec<String>>,
}

#[tauri::command]
pub fn save_mcp_server_config(file_path: String, server_name: String, patch: McpServerPatch) -> Result<(), AppError> {
    let path = Path::new(&file_path);

    // Validate that the file path is within a .kiro/settings directory and is an mcp.json file
    let canonical = path.canonicalize().map_err(|e| AppError::Other(format!("Invalid path '{}': {}", file_path, e)))?;
    let file_name = canonical.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let parent = canonical.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()).unwrap_or("");
    let grandparent = canonical.parent().and_then(|p| p.parent()).and_then(|p| p.file_name()).and_then(|n| n.to_str()).unwrap_or("");
    if file_name != "mcp.json" || parent != "settings" || grandparent != ".kiro" {
        return Err(AppError::Other(format!(
            "Refusing to write '{}': path must be a .kiro/settings/mcp.json file", file_path
        )));
    }

    let content = fs::read_to_string(path)?;
    let mut root: serde_json::Value = serde_json::from_str(&content)?;
    let server = root
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .and_then(|m| m.get_mut(&server_name))
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| AppError::Other(format!("Server '{server_name}' not found in {file_path}")))?;
    if let Some(disabled) = patch.disabled {
        if disabled {
            server.insert("disabled".to_string(), serde_json::Value::Bool(true));
        } else {
            server.remove("disabled");
        }
    }
    if let Some(tools) = patch.disabled_tools {
        if tools.is_empty() {
            server.remove("disabledTools");
        } else {
            server.insert("disabledTools".to_string(), serde_json::json!(tools));
        }
    }
    let out = serde_json::to_string_pretty(&root)?;
    fs::write(path, out)?;
    Ok(())
}

// ── Kiro CLI MCP shell-out commands ──────────────────────────────────────────
//
// These wrap `kiro-cli mcp add/remove` so the renderer can speak to the CLI's
// own configuration surface instead of just rewriting JSON. Doing it through
// the CLI is important because:
//
// * Registry mode (Pro tier with IAM Identity Center) restricts which servers
//   a user is allowed to add — the CLI enforces that, our JSON writer would
//   silently bypass it.
// * The CLI validates server names, command paths, and env-var references
//   before accepting them. We get that validation for free.
// * Future kiro-cli versions may add side effects (caching, telemetry, scope
//   resolution) that a raw mcp.json edit would skip.
//
// We invoke the CLI in a blocking way (`std::process::Command`) because adding
// a server is a quick filesystem operation; OAuth flows happen later when the
// server connects, not during `mcp add`.

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpAddRequest {
    /// Server name as referenced in mcp.json's `mcpServers` map.
    pub name: String,
    /// "global" → ~/.kiro/settings/mcp.json, "workspace" → <project>/.kiro/settings/mcp.json,
    /// or "agent:<name>" to attach to a specific custom agent definition.
    pub scope: String,
    /// stdio command (e.g. "uvx") OR remote URL (https://…). Exactly one of
    /// `command` or `url` must be set; the CLI rejects requests that omit both
    /// or set both.
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    /// `KEY=VALUE` pairs forwarded as `--env` flags. The CLI supports
    /// `${VAR}` references inside the value, which it expands at server-
    /// launch time rather than at add time.
    pub env: Vec<String>,
    /// Force-overwrite if the name already exists in the chosen scope.
    pub force: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpRemoveRequest {
    pub name: String,
    /// "global", "workspace", or "agent:<name>".
    pub scope: String,
}

/// Resolve the kiro-cli binary path, falling back to PATH lookup if the
/// caller hasn't supplied a full path. Mirrors `kiro_whoami`'s strategy.
fn resolve_kiro_bin(kiro_bin: Option<String>) -> Result<String, AppError> {
    let bin = kiro_bin.unwrap_or_else(|| "kiro-cli".to_string());
    if Path::new(&bin).is_absolute() && Path::new(&bin).exists() {
        return Ok(bin);
    }
    if which::which(&bin).is_ok() {
        return Ok(bin);
    }
    super::fs_ops::detect_kiro_cli()
        .ok_or_else(|| AppError::Other(format!(
            "kiro-cli not found (tried '{bin}' and known paths). Set the binary path in Settings."
        )))
}

/// Run `kiro-cli` with the given args, optionally inside a workspace.
/// Returns the trimmed stdout on success or a friendly error containing the
/// CLI's stderr on failure.
fn run_kiro_cli(bin: &str, workspace: Option<&str>, args: &[&str]) -> Result<String, AppError> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    if let Some(ws) = workspace {
        cmd.current_dir(ws);
    }
    // Augment PATH so spawned helpers (uvx, npx, …) resolve like they do in a
    // user shell. Mirrors the same trick the ACP connection spawn uses.
    // The Homebrew prefix is macOS-specific; on Linux the system PATH is sufficient.
    let path = std::env::var("PATH").unwrap_or_default();
    cmd.env(
        "PATH",
        format!("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{path}"),
    );

    let output = cmd
        .output()
        .map_err(|e| AppError::Other(format!("Failed to spawn kiro-cli: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        // Redact --env KEY=VALUE entries so secrets don't appear in error toasts.
        let safe_args: Vec<&str> = {
            let mut out = Vec::with_capacity(args.len());
            let mut skip_next = false;
            for arg in args {
                if skip_next {
                    out.push("***");
                    skip_next = false;
                } else if *arg == "--env" {
                    out.push(arg);
                    skip_next = true;
                } else {
                    out.push(arg);
                }
            }
            out
        };
        return Err(AppError::Other(format!(
            "kiro-cli {} exited with status {}: {}",
            safe_args.join(" "),
            output.status,
            detail
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Translate a renderer-supplied scope string into the `--scope` and (for
/// agent scope) `--agent` flags that `kiro-cli mcp add/remove` expects.
fn scope_args(scope: &str) -> Result<Vec<String>, AppError> {
    match scope {
        "global" => Ok(vec!["--scope".into(), "global".into()]),
        "workspace" => Ok(vec!["--scope".into(), "workspace".into()]),
        s if s.starts_with("agent:") => {
            let agent = s.trim_start_matches("agent:").trim();
            if agent.is_empty() {
                return Err(AppError::Other(
                    "Agent scope requires an agent name (use 'agent:<name>')".to_string(),
                ));
            }
            Ok(vec!["--agent".into(), agent.to_string()])
        }
        other => Err(AppError::Other(format!(
            "Unknown scope '{other}' (expected 'global', 'workspace', or 'agent:<name>')"
        ))),
    }
}

#[tauri::command]
pub async fn mcp_add_server(
    request: McpAddRequest,
    workspace: Option<String>,
    kiro_bin: Option<String>,
) -> Result<String, AppError> {
    // Exactly one of command (stdio) or url (http) must be set.
    if request.command.is_some() == request.url.is_some() {
        return Err(AppError::Other(
            "Provide exactly one of 'command' (stdio) or 'url' (remote)".to_string(),
        ));
    }
    if request.name.trim().is_empty() {
        return Err(AppError::Other("Server name is required".to_string()));
    }

    let bin = resolve_kiro_bin(kiro_bin)?;
    let mut args: Vec<String> = vec!["mcp".into(), "add".into(), "--name".into(), request.name.clone()];
    args.extend(scope_args(&request.scope)?);

    if let Some(cmd) = request.command.as_deref() {
        args.push("--command".into());
        args.push(cmd.to_string());
        for a in &request.args {
            args.push("--args".into());
            args.push(a.clone());
        }
    }
    if let Some(url) = request.url.as_deref() {
        args.push("--url".into());
        args.push(url.to_string());
    }
    for e in &request.env {
        args.push("--env".into());
        args.push(e.clone());
    }
    if request.force {
        args.push("--force".into());
    }

    // `kiro-cli mcp add` may take several seconds (uvx/npx download on first run).
    // Run on a blocking thread so we don't stall the Tauri async executor.
    tokio::task::spawn_blocking(move || {
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_kiro_cli(&bin, workspace.as_deref(), &arg_refs)
    })
    .await
    .map_err(|e| AppError::Other(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn mcp_remove_server(
    request: McpRemoveRequest,
    workspace: Option<String>,
    kiro_bin: Option<String>,
) -> Result<String, AppError> {
    if request.name.trim().is_empty() {
        return Err(AppError::Other("Server name is required".to_string()));
    }
    let bin = resolve_kiro_bin(kiro_bin)?;
    let mut args: Vec<String> = vec!["mcp".into(), "remove".into(), "--name".into(), request.name.clone()];
    args.extend(scope_args(&request.scope)?);
    // Run on a blocking thread — CLI may do network/filesystem work.
    tokio::task::spawn_blocking(move || {
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_kiro_cli(&bin, workspace.as_deref(), &arg_refs)
    })
    .await
    .map_err(|e| AppError::Other(format!("Task join error: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_frontmatter_with_always_apply_true() {
        let input = "---\nalwaysApply: true\n---\n# Title\nSome body text";
        let (always_apply, excerpt) = parse_steering_frontmatter(input);
        assert!(always_apply);
        assert_eq!(excerpt, "Some body text");
    }

    #[test]
    fn parse_frontmatter_with_always_apply_false() {
        let input = "---\nalwaysApply: false\n---\nBody here";
        let (always_apply, excerpt) = parse_steering_frontmatter(input);
        assert!(!always_apply);
        assert_eq!(excerpt, "Body here");
    }

    #[test]
    fn parse_frontmatter_missing_returns_false() {
        let input = "# No frontmatter\nJust content";
        let (always_apply, excerpt) = parse_steering_frontmatter(input);
        assert!(!always_apply);
        assert_eq!(excerpt, "Just content");
    }

    #[test]
    fn parse_frontmatter_skips_headings_in_excerpt() {
        let input = "---\nalwaysApply: true\n---\n# Heading\n## Subheading\nActual content";
        let (_, excerpt) = parse_steering_frontmatter(input);
        assert_eq!(excerpt, "Actual content");
    }

    #[test]
    fn parse_frontmatter_truncates_long_excerpt() {
        let long_line = "a".repeat(200);
        let input = format!("---\nalwaysApply: false\n---\n{}", long_line);
        let (_, excerpt) = parse_steering_frontmatter(&input);
        assert_eq!(excerpt.len(), 120);
    }

    #[test]
    fn parse_frontmatter_empty_body() {
        let input = "---\nalwaysApply: true\n---\n";
        let (always_apply, excerpt) = parse_steering_frontmatter(input);
        assert!(always_apply);
        assert_eq!(excerpt, "");
    }

    #[test]
    fn source_str_global() {
        assert_eq!(super::source_str(true), "global");
    }

    #[test]
    fn source_str_local() {
        assert_eq!(super::source_str(false), "local");
    }

    #[test]
    fn scan_agents_nonexistent_dir_returns_empty() {
        let tmp = std::env::temp_dir().join("kirodex_test_nonexistent_agents");
        assert!(super::scan_agents(&tmp, true).is_empty());
    }

    #[test]
    fn scan_skills_nonexistent_dir_returns_empty() {
        let tmp = std::env::temp_dir().join("kirodex_test_nonexistent_skills");
        assert!(super::scan_skills(&tmp, false).is_empty());
    }

    #[test]
    fn scan_steering_nonexistent_dir_returns_empty() {
        let tmp = std::env::temp_dir().join("kirodex_test_nonexistent_steering");
        assert!(super::scan_steering(&tmp, true).is_empty());
    }

    #[test]
    fn scan_agents_reads_json_files() {
        let tmp = tempfile::tempdir().unwrap();
        let agents_dir = tmp.path().join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        std::fs::write(
            agents_dir.join("test-agent.json"),
            r#"{"name": "Test Agent", "description": "A test", "tools": ["tool1", "tool2"]}"#,
        ).unwrap();
        std::fs::write(agents_dir.join(".hidden.json"), r#"{"name": "Hidden"}"#).unwrap();
        let result = super::scan_agents(tmp.path(), true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Test Agent");
        assert_eq!(result[0].tools, vec!["tool1", "tool2"]);
        assert_eq!(result[0].source, "global");
    }

    #[test]
    fn scan_steering_reads_md_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("steering");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("my-rule.md"), "---\nalwaysApply: true\n---\n# Rule\nDo this thing").unwrap();
        let result = super::scan_steering(tmp.path(), false);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "my-rule");
        assert!(result[0].always_apply);
        assert_eq!(result[0].source, "local");
        assert_eq!(result[0].excerpt, "Do this thing");
    }

    #[test]
    fn load_mcp_file_parses_stdio_server() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp", "args": ["--token", "abc"]}}}"#).unwrap();
        let mut servers = Vec::new();
        super::load_mcp_file(&f, true, &mut servers);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "slack");
        assert!(servers[0].enabled);
        assert_eq!(servers[0].transport, "stdio");
        assert_eq!(servers[0].source, "global");
        assert!(servers[0].error.is_none());
    }

    #[test]
    fn load_mcp_file_parses_http_server() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"gh": {"url": "https://gh.mcp"}}}"#).unwrap();
        let mut servers = Vec::new();
        super::load_mcp_file(&f, false, &mut servers);
        assert_eq!(servers[0].transport, "http");
        assert!(servers[0].enabled);
        assert_eq!(servers[0].source, "local");
    }

    #[test]
    fn load_mcp_file_disabled_field() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp", "disabled": true}}}"#).unwrap();
        let mut servers = Vec::new();
        super::load_mcp_file(&f, true, &mut servers);
        assert!(!servers[0].enabled);
    }

    #[test]
    fn load_mcp_file_parses_disabled_tools() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp", "disabledTools": ["post_message", "delete_message"]}}}"#).unwrap();
        let mut servers = Vec::new();
        super::load_mcp_file(&f, true, &mut servers);
        assert_eq!(servers[0].disabled_tools.as_deref(), Some(&["post_message".to_string(), "delete_message".to_string()][..]));
    }

    #[test]
    fn load_mcp_file_flags_missing_command_and_url() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"broken": {}}}"#).unwrap();
        let mut servers = Vec::new();
        super::load_mcp_file(&f, true, &mut servers);
        assert_eq!(servers[0].error.as_deref(), Some("Missing command or url"));
    }

    #[test]
    fn load_mcp_file_flags_invalid_url() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"bad": {"url": "not-a-url"}}}"#).unwrap();
        let mut servers = Vec::new();
        super::load_mcp_file(&f, true, &mut servers);
        assert_eq!(servers[0].error.as_deref(), Some("Invalid url"));
    }

    #[test]
    fn load_mcp_file_nonexistent_is_noop() {
        let mut servers = Vec::new();
        super::load_mcp_file(std::path::Path::new("/nonexistent/mcp.json"), true, &mut servers);
        assert!(servers.is_empty());
    }

    #[test]
    fn load_mcp_file_local_overrides_global() {
        let tmp = tempfile::tempdir().unwrap();
        let global = tmp.path().join("global.json");
        let local = tmp.path().join("local.json");
        std::fs::write(&global, r#"{"mcpServers": {"chrome-devtools": {"command": "g", "disabled": true}}}"#).unwrap();
        std::fs::write(&local, r#"{"mcpServers": {"chrome-devtools": {"command": "l"}}}"#).unwrap();
        let mut servers = Vec::new();
        super::load_mcp_file(&global, true, &mut servers);
        super::load_mcp_file(&local, false, &mut servers);
        assert_eq!(servers.len(), 1, "local entry should replace global one with same name");
        assert_eq!(servers[0].source, "local");
        assert_eq!(servers[0].command.as_deref(), Some("l"));
        assert!(servers[0].enabled, "local config takes precedence — should be enabled");
    }

    #[test]
    fn scope_args_global() {
        let r = super::scope_args("global").unwrap();
        assert_eq!(r, vec!["--scope".to_string(), "global".to_string()]);
    }

    #[test]
    fn scope_args_workspace() {
        let r = super::scope_args("workspace").unwrap();
        assert_eq!(r, vec!["--scope".to_string(), "workspace".to_string()]);
    }

    #[test]
    fn scope_args_agent() {
        let r = super::scope_args("agent:my-rust-dev").unwrap();
        assert_eq!(r, vec!["--agent".to_string(), "my-rust-dev".to_string()]);
    }

    #[test]
    fn scope_args_agent_empty_name_errors() {
        let err = super::scope_args("agent:").unwrap_err();
        assert!(err.to_string().contains("agent name"));
    }

    #[test]
    fn scope_args_unknown_errors() {
        let err = super::scope_args("user").unwrap_err();
        assert!(err.to_string().contains("Unknown scope"));
    }

    #[test]
    fn kiro_config_default_is_empty() {
        let config = super::KiroConfig::default();
        assert!(config.agents.is_empty());
        assert!(config.mcp_servers.is_empty());
    }

    #[test]
    fn parse_frontmatter_only_whitespace_body() {
        let input = "---\nalwaysApply: true\n---\n   \n  \n";
        let (always_apply, excerpt) = super::parse_steering_frontmatter(input);
        assert!(always_apply);
        assert_eq!(excerpt, "");
    }

    #[test]
    fn save_mcp_server_config_sets_disabled() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".kiro").join("settings");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let f = settings_dir.join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp"}}}"#).unwrap();
        let patch = super::McpServerPatch { disabled: Some(true), disabled_tools: None };
        super::save_mcp_server_config(f.to_string_lossy().to_string(), "slack".to_string(), patch).unwrap();
        let content: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(content["mcpServers"]["slack"]["disabled"], true);
        assert_eq!(content["mcpServers"]["slack"]["command"], "slack-mcp");
    }

    #[test]
    fn save_mcp_server_config_removes_disabled_on_enable() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".kiro").join("settings");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let f = settings_dir.join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp", "disabled": true}}}"#).unwrap();
        let patch = super::McpServerPatch { disabled: Some(false), disabled_tools: None };
        super::save_mcp_server_config(f.to_string_lossy().to_string(), "slack".to_string(), patch).unwrap();
        let content: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert!(content["mcpServers"]["slack"].get("disabled").is_none());
    }

    #[test]
    fn save_mcp_server_config_sets_disabled_tools() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".kiro").join("settings");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let f = settings_dir.join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp"}}}"#).unwrap();
        let patch = super::McpServerPatch { disabled: None, disabled_tools: Some(vec!["post_message".to_string()]) };
        super::save_mcp_server_config(f.to_string_lossy().to_string(), "slack".to_string(), patch).unwrap();
        let content: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(content["mcpServers"]["slack"]["disabledTools"][0], "post_message");
    }

    #[test]
    fn save_mcp_server_config_removes_disabled_tools_on_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".kiro").join("settings");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let f = settings_dir.join("mcp.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp", "disabledTools": ["x"]}}}"#).unwrap();
        let patch = super::McpServerPatch { disabled: None, disabled_tools: Some(vec![]) };
        super::save_mcp_server_config(f.to_string_lossy().to_string(), "slack".to_string(), patch).unwrap();
        let content: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert!(content["mcpServers"]["slack"].get("disabledTools").is_none());
    }

    #[test]
    fn save_mcp_server_config_rejects_non_kiro_path() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("evil.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp"}}}"#).unwrap();
        let patch = super::McpServerPatch { disabled: Some(true), disabled_tools: None };
        let result = super::save_mcp_server_config(f.to_string_lossy().to_string(), "slack".to_string(), patch);
        assert!(result.is_err());
    }

    // ── New field tests ───────────────────────────────────────────────────────

    #[test]
    fn scan_agents_reads_new_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let agents_dir = tmp.path().join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        std::fs::write(
            agents_dir.join("full-agent.json"),
            r#"{
                "name": "Full Agent",
                "description": "Has all fields",
                "tools": ["read"],
                "welcomeMessage": "Hello!",
                "keyboardShortcut": "ctrl+a",
                "model": "claude-sonnet-4",
                "resources": ["file://README.md", "file://docs/**/*.md"]
            }"#,
        ).unwrap();
        let result = super::scan_agents(tmp.path(), false);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].welcome_message.as_deref(), Some("Hello!"));
        assert_eq!(result[0].keyboard_shortcut.as_deref(), Some("ctrl+a"));
        assert_eq!(result[0].model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(result[0].resources, vec!["file://README.md", "file://docs/**/*.md"]);
        assert!(result[0].hooks.is_none());
    }

    #[test]
    fn scan_agents_missing_optional_fields_are_none() {
        let tmp = tempfile::tempdir().unwrap();
        let agents_dir = tmp.path().join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        std::fs::write(
            agents_dir.join("minimal.json"),
            r#"{"name": "Minimal", "description": "No extras", "tools": []}"#,
        ).unwrap();
        let result = super::scan_agents(tmp.path(), false);
        assert_eq!(result.len(), 1);
        assert!(result[0].welcome_message.is_none());
        assert!(result[0].keyboard_shortcut.is_none());
        assert!(result[0].model.is_none());
        assert!(result[0].resources.is_empty());
        assert!(result[0].hooks.is_none());
    }

    #[test]
    fn parse_agent_hooks_parses_all_trigger_types() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "hooks": {
                "agentSpawn": [{"command": "git status"}],
                "userPromptSubmit": [{"command": "ls -la"}],
                "preToolUse": [{"command": "echo pre", "matcher": "fs_write"}],
                "postToolUse": [{"command": "cargo fmt", "matcher": "fs_write"}],
                "stop": [{"command": "npm test"}]
            }
        }"#).unwrap();
        let obj = json.as_object().unwrap();
        let hooks = super::parse_agent_hooks(obj).expect("should parse hooks");
        assert_eq!(hooks.agent_spawn.len(), 1);
        assert_eq!(hooks.agent_spawn[0].command, "git status");
        assert!(hooks.agent_spawn[0].matcher.is_none());
        assert_eq!(hooks.user_prompt_submit.len(), 1);
        assert_eq!(hooks.pre_tool_use.len(), 1);
        assert_eq!(hooks.pre_tool_use[0].matcher.as_deref(), Some("fs_write"));
        assert_eq!(hooks.post_tool_use.len(), 1);
        assert_eq!(hooks.stop.len(), 1);
        assert_eq!(hooks.stop[0].command, "npm test");
    }

    #[test]
    fn parse_agent_hooks_returns_none_when_all_empty() {
        let json: serde_json::Value = serde_json::from_str(r#"{"hooks": {}}"#).unwrap();
        let obj = json.as_object().unwrap();
        assert!(super::parse_agent_hooks(obj).is_none());
    }

    #[test]
    fn parse_agent_hooks_returns_none_when_no_hooks_key() {
        let json: serde_json::Value = serde_json::from_str(r#"{"name": "agent"}"#).unwrap();
        let obj = json.as_object().unwrap();
        assert!(super::parse_agent_hooks(obj).is_none());
    }

    #[test]
    fn scan_prompts_nonexistent_dir_returns_empty() {
        let tmp = std::env::temp_dir().join("kirodex_test_nonexistent_prompts");
        assert!(super::scan_prompts(&tmp, true).is_empty());
    }

    #[test]
    fn scan_prompts_reads_md_and_txt_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("prompts");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("code-review.md"), "Please review this code for best practices.").unwrap();
        std::fs::write(dir.join("security-scan.txt"), "Check for security vulnerabilities.").unwrap();
        std::fs::write(dir.join(".hidden.md"), "Should be ignored").unwrap();
        std::fs::write(dir.join("binary.bin"), "not a prompt").unwrap();
        let result = super::scan_prompts(tmp.path(), false);
        assert_eq!(result.len(), 2);
        let names: Vec<&str> = result.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"code-review"));
        assert!(names.contains(&"security-scan"));
        let review = result.iter().find(|p| p.name == "code-review").unwrap();
        assert_eq!(review.source, "local");
        assert_eq!(review.content, "Please review this code for best practices.");
    }

    #[test]
    fn scan_prompts_global_source() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("prompts");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("my-prompt.md"), "content").unwrap();
        let result = super::scan_prompts(tmp.path(), true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].source, "global");
    }
}
