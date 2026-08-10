//! What the resource panel shows: prompt templates and MCP servers found in
//! `~/.lafagent` and `<project>/.lafagent`.
//!
//! Skills are deliberately not among them. The agent is spawned with an
//! explicit `--skill` allowlist (see `rpc::connection`), so a folder dropped
//! into `~/.lafagent/skills` no longer reaches the model — and a panel that
//! lists skills the agent will never load is worse than no panel at all.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use super::error::AppError;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentPrompt {
    pub name: String,
    pub content: String,
    pub source: String,
    pub file_path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
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
    /// Static connection status derived from prime-agent credentials:
    /// "ready" (creds present), "needs-auth" (oauth without creds), or
    /// "configured" (static headers / no auth requirement declared).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub file_path: String,
    /// "global" (~/.lafagent/settings.json) or "local" (<project>/.lafagent/settings.json).
    /// When the same server name appears in both, the local entry wins.
    pub source: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentResources {
    pub mcp_servers: Vec<McpServerConfig>,
    pub prompts: Vec<AgentPrompt>,
}

/// Credential ids present in prime-agent's auth.json (cached per call site
/// is unnecessary — the file is tiny and read at config-load time only).
fn mcp_cred_names() -> std::collections::HashSet<String> {
    dirs::home_dir()
        .map(|h| h.join(".lafagent/auth.json"))
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .and_then(|v| v.as_object().map(|o| o.keys().cloned().collect()))
        .unwrap_or_default()
}

fn source_str(is_global: bool) -> &'static str {
    if is_global { "global" } else { "local" }
}




fn scan_prompts(base: &Path, is_global: bool) -> Vec<AgentPrompt> {
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
            Some(AgentPrompt {
                name,
                content,
                source: source.to_string(),
                file_path: fp.to_string_lossy().to_string(),
            })
        })
        .collect()
}


fn load_mcp_file(file_path: &Path, is_global: bool, out: &mut Vec<McpServerConfig>) {
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
        // prime-agent MCP status is credential-driven: oauth servers need a
        // `mcp:<name>` entry in auth.json; bearer-token servers need their
        // env var; anything else is simply configured.
        let uses_oauth = cfg.get("oauth").and_then(|v| v.as_bool()).unwrap_or(false);
        let bearer_env = cfg.get("bearerTokenEnvVar").and_then(|v| v.as_str());
        let has_creds = mcp_cred_names().contains(&format!("mcp:{name}"))
            || bearer_env.map(|e| std::env::var(e).map(|v| !v.is_empty()).unwrap_or(false)).unwrap_or(false);
        let status = if has_creds {
            "ready"
        } else if uses_oauth {
            "needs-auth"
        } else {
            "configured"
        };
        let entry = McpServerConfig {
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
            status: Some(status.to_string()),
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
pub fn get_agent_resources(project_path: Option<String>) -> AgentResources {
    let mut config = AgentResources::default();

    if let Some(home) = dirs::home_dir() {
        let global_dir = home.join(".lafagent");
        config.prompts.extend(scan_prompts(&global_dir, true));
        load_mcp_file(&global_dir.join("settings.json"), true, &mut config.mcp_servers);
    }

    if let Some(ref project) = project_path {
        let local_dir = Path::new(project).join(".lafagent");
        // Local prompts override global ones with the same name
        let local_prompts = scan_prompts(&local_dir, false);
        for lp in local_prompts {
            if let Some(existing) = config.prompts.iter_mut().find(|p| p.name == lp.name) {
                *existing = lp;
            } else {
                config.prompts.push(lp);
            }
        }
        load_mcp_file(&local_dir.join("settings.json"), false, &mut config.mcp_servers);
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

    // Validate that the file path is a .lafagent/settings.json file
    let canonical = path.canonicalize().map_err(|e| AppError::Other(format!("Invalid path '{}': {}", file_path, e)))?;
    let file_name = canonical.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let parent = canonical.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()).unwrap_or("");
    if file_name != "settings.json" || parent != crate::commands::agent_paths::AGENT_CONFIG_DIR {
        return Err(AppError::Other(format!(
            "Refusing to write '{}': path must be a .lafagent/settings.json file", file_path
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

// ── MCP server configuration commands ────────────────────────────────────────
//
// prime-agent reads MCP servers from the `mcpServers` object in its
// settings.json (global `~/.lafagent/settings.json` or per-project
// `<project>/.lafagent/settings.json`). There is no CLI subcommand for
// managing them, so these commands do careful read-modify-write JSON edits
// that preserve every other key in the settings file.

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpAddRequest {
    /// Server name as referenced in mcp.json's `mcpServers` map.
    pub name: String,
    /// "global" → ~/.lafagent/settings.json,
    /// "workspace" → <project>/.lafagent/settings.json.
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

/// Resolve the settings.json path for a renderer-supplied scope.
fn scope_settings_path(scope: &str, workspace: Option<&str>) -> Result<std::path::PathBuf, AppError> {
    match scope {
        "global" => dirs::home_dir()
            .map(|h| h.join(".lafagent").join("settings.json"))
            .ok_or_else(|| AppError::Other("Could not resolve home directory".to_string())),
        "workspace" => workspace
            .map(|ws| Path::new(ws).join(".lafagent").join("settings.json"))
            .ok_or_else(|| AppError::Other("Workspace scope requires a workspace path".to_string())),
        other => Err(AppError::Other(format!(
            "Unknown scope '{other}' (expected 'global' or 'workspace')"
        ))),
    }
}

/// Read a settings.json into a JSON object, treating a missing file as `{}`.
fn read_settings_object(path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    match serde_json::from_str::<serde_json::Value>(&content)? {
        serde_json::Value::Object(o) => Ok(o),
        _ => Err(AppError::Other(format!("{} is not a JSON object", path.display()))),
    }
}

fn write_settings_object(path: &Path, obj: serde_json::Map<String, serde_json::Value>) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let out = serde_json::to_string_pretty(&serde_json::Value::Object(obj))?;
    fs::write(path, out)?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_add_server(
    request: McpAddRequest,
    workspace: Option<String>,
    agent_bin: Option<String>,
) -> Result<String, AppError> {
    let _ = agent_bin;
    // Exactly one of command (stdio) or url (http) must be set.
    if request.command.is_some() == request.url.is_some() {
        return Err(AppError::Other(
            "Provide exactly one of 'command' (stdio) or 'url' (remote)".to_string(),
        ));
    }
    if request.name.trim().is_empty() {
        return Err(AppError::Other("Server name is required".to_string()));
    }

    let path = scope_settings_path(&request.scope, workspace.as_deref())?;
    let mut root = read_settings_object(&path)?;
    let servers = root
        .entry("mcpServers".to_string())
        .or_insert_with(|| serde_json::json!({}));
    let servers = servers
        .as_object_mut()
        .ok_or_else(|| AppError::Other("mcpServers in settings.json is not an object".to_string()))?;

    if servers.contains_key(&request.name) && !request.force {
        return Err(AppError::Other(format!(
            "Server '{}' already exists in {} (use force to overwrite)",
            request.name,
            path.display()
        )));
    }

    let mut entry = serde_json::Map::new();
    if let Some(cmd) = request.command.as_deref() {
        entry.insert("command".to_string(), serde_json::json!(cmd));
        if !request.args.is_empty() {
            entry.insert("args".to_string(), serde_json::json!(request.args));
        }
    }
    if let Some(url) = request.url.as_deref() {
        if !url.starts_with("http") {
            return Err(AppError::Other(format!("Invalid url '{url}': must start with http(s)")));
        }
        entry.insert("url".to_string(), serde_json::json!(url));
    }
    if !request.env.is_empty() {
        let mut env_map = serde_json::Map::new();
        for pair in &request.env {
            let Some((k, v)) = pair.split_once('=') else {
                return Err(AppError::Other(format!("Invalid env entry '{pair}': expected KEY=VALUE")));
            };
            env_map.insert(k.trim().to_string(), serde_json::json!(v));
        }
        entry.insert("env".to_string(), serde_json::Value::Object(env_map));
    }

    servers.insert(request.name.clone(), serde_json::Value::Object(entry));
    write_settings_object(&path, root)?;
    Ok(format!("Added MCP server '{}' to {}", request.name, path.display()))
}

#[tauri::command]
pub async fn mcp_remove_server(
    request: McpRemoveRequest,
    workspace: Option<String>,
    agent_bin: Option<String>,
) -> Result<String, AppError> {
    let _ = agent_bin;
    if request.name.trim().is_empty() {
        return Err(AppError::Other("Server name is required".to_string()));
    }
    let path = scope_settings_path(&request.scope, workspace.as_deref())?;
    let mut root = read_settings_object(&path)?;
    let removed = root
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .map(|servers| servers.remove(&request.name).is_some())
        .unwrap_or(false);
    if !removed {
        return Err(AppError::Other(format!(
            "Server '{}' not found in {}",
            request.name,
            path.display()
        )));
    }
    write_settings_object(&path, root)?;
    Ok(format!("Removed MCP server '{}' from {}", request.name, path.display()))
}

#[cfg(test)]
mod tests {

    #[test]
    fn source_str_global() {
        assert_eq!(super::source_str(true), "global");
    }

    #[test]
    fn source_str_local() {
        assert_eq!(super::source_str(false), "local");
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
    fn scope_settings_path_global() {
        let p = super::scope_settings_path("global", None).unwrap();
        assert!(p.ends_with(".lafagent/settings.json"));
    }

    #[test]
    fn scope_settings_path_workspace() {
        let p = super::scope_settings_path("workspace", Some("/tmp/proj")).unwrap();
        assert_eq!(p, std::path::PathBuf::from("/tmp/proj/.lafagent/settings.json"));
    }

    #[test]
    fn scope_settings_path_workspace_missing_errors() {
        let err = super::scope_settings_path("workspace", None).unwrap_err();
        assert!(err.to_string().contains("workspace"));
    }

    #[test]
    fn scope_settings_path_unknown_errors() {
        let err = super::scope_settings_path("user", None).unwrap_err();
        assert!(err.to_string().contains("Unknown scope"));
    }

    #[test]
    fn agent_resources_default_is_empty() {
        let config = super::AgentResources::default();
        assert!(config.mcp_servers.is_empty());
    }

    #[test]
    fn save_mcp_server_config_sets_disabled() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".lafagent");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let f = settings_dir.join("settings.json");
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
        let settings_dir = tmp.path().join(".lafagent");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let f = settings_dir.join("settings.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp", "disabled": true}}}"#).unwrap();
        let patch = super::McpServerPatch { disabled: Some(false), disabled_tools: None };
        super::save_mcp_server_config(f.to_string_lossy().to_string(), "slack".to_string(), patch).unwrap();
        let content: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert!(content["mcpServers"]["slack"].get("disabled").is_none());
    }

    #[test]
    fn save_mcp_server_config_sets_disabled_tools() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".lafagent");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let f = settings_dir.join("settings.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp"}}}"#).unwrap();
        let patch = super::McpServerPatch { disabled: None, disabled_tools: Some(vec!["post_message".to_string()]) };
        super::save_mcp_server_config(f.to_string_lossy().to_string(), "slack".to_string(), patch).unwrap();
        let content: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(content["mcpServers"]["slack"]["disabledTools"][0], "post_message");
    }

    #[test]
    fn save_mcp_server_config_removes_disabled_tools_on_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let settings_dir = tmp.path().join(".lafagent");
        std::fs::create_dir_all(&settings_dir).unwrap();
        let f = settings_dir.join("settings.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp", "disabledTools": ["x"]}}}"#).unwrap();
        let patch = super::McpServerPatch { disabled: None, disabled_tools: Some(vec![]) };
        super::save_mcp_server_config(f.to_string_lossy().to_string(), "slack".to_string(), patch).unwrap();
        let content: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert!(content["mcpServers"]["slack"].get("disabledTools").is_none());
    }

    #[test]
    fn save_mcp_server_config_rejects_non_agent_path() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("evil.json");
        std::fs::write(&f, r#"{"mcpServers": {"slack": {"command": "slack-mcp"}}}"#).unwrap();
        let patch = super::McpServerPatch { disabled: Some(true), disabled_tools: None };
        let result = super::save_mcp_server_config(f.to_string_lossy().to_string(), "slack".to_string(), patch);
        assert!(result.is_err());
    }

    // ── New field tests ───────────────────────────────────────────────────────

    #[test]
    fn scan_prompts_nonexistent_dir_returns_empty() {
        let tmp = std::env::temp_dir().join("laf-agent_test_nonexistent_prompts");
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
