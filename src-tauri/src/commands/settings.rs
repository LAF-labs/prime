use serde::{Deserialize, Serialize};
use parking_lot::Mutex;

use super::error::AppError;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    pub agent_id: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TextGenerationPolicy {
    /// Custom instructions appended to commit message prompts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_instructions: Option<String>,
    /// Custom instructions appended to branch name generation prompts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_instructions: Option<String>,
    /// Custom instructions appended to thread title generation prompts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_title_instructions: Option<String>,
    /// Custom instructions appended to PR content generation prompts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_instructions: Option<String>,
}

/// User-supplied token pricing for a single provider.
///
/// prime-agent only knows per-model prices for its built-in providers, so cost
/// for a user-registered OpenAI-compatible provider always comes back as 0.
/// These rates let the user fill that gap by hand.
///
/// **Unit: USD per 1M tokens** for every field.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRate {
    /// Price per 1M input (prompt) tokens, in USD.
    #[serde(default)]
    pub input: f64,
    /// Price per 1M output (completion) tokens, in USD.
    #[serde(default)]
    pub output: f64,
    /// Price per 1M cache-read tokens, in USD. `None` when the user left it blank.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<f64>,
    /// Price per 1M cache-write tokens, in USD. `None` when the user left it blank.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPrefs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symlink_directories: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tight_sandbox: Option<bool>,
    /// Icon override set by the user (framework, file, or emoji).
    /// Stored as opaque JSON to avoid replicating the TypeScript union type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_override: Option<serde_json::Value>,
    /// Per-project text generation policy (custom instructions for AI features).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_generation_policy: Option<TextGenerationPolicy>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_agent_bin")]
    pub agent_bin: String,
    #[serde(default)]
    pub agent_profiles: Vec<AgentProfile>,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    /// Chat content font size in px. Falls back to {@link font_size} on the
    /// frontend when missing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_font_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(default)]
    pub auto_approve: bool,
    #[serde(default = "default_true")]
    pub respect_gitignore: bool,
    #[serde(default = "default_true")]
    pub co_author: bool,
    #[serde(default)]
    pub co_author_json_report: bool,
    #[serde(default = "default_true")]
    pub notifications: bool,
    #[serde(default = "default_true")]
    pub sound_notifications: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_prefs: Option<std::collections::HashMap<String, ProjectPrefs>>,
    #[serde(default)]
    pub has_onboarded_v2: bool,
    /// Flag for anonymous product analytics. Defaults to true; the user
    /// can turn it off via Settings → Advanced.
    #[serde(default = "default_true")]
    pub analytics_enabled: bool,
    /// Agent-behavior toggles, applied per session over RPC at session_init.
    /// Defaults mirror the harness defaults so untouched settings send nothing.
    #[serde(default = "default_true")]
    pub agent_auto_compaction: bool,
    #[serde(default = "default_true")]
    pub agent_auto_retry: bool,
    /// Queued-message steering: "one-at-a-time" (harness default) or "all".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steering_mode: Option<String>,
    /// Random UUID created on first opt-in and cleared on opt-out. Used as the
    /// PostHog `distinct_id` — never tied to OS identity, email, or machine ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analytics_anon_id: Option<String>,
    /// Theme mode: "dark", "light", or "system". Default: "dark".
    /// App display language: "system" (default) follows the OS locale;
    /// "en" / "ko" force a language.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Sidebar placement: "left" or "right". Default: "left".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sidebar_position: Option<String>,
    /// Base64 data URL for a user-supplied app icon (About dialog + dock).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_app_icon: Option<String>,
    /// Last app version whose changelog the user has seen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_changelog_version: Option<String>,
    /// Max character limit for /btw side questions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub btw_max_chars: Option<u32>,
    /// Terminal scrollback line cap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_scrollback: Option<u32>,
    /// Auto-close background terminal tabs after this many idle minutes.
    /// `None` disables auto-close.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_auto_close_idle_mins: Option<u32>,
    /// When true, render tool calls inline within the assistant prose at the
    /// point where the agent invoked them. When false (default), tool calls
    /// collapse into a single grouped card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inline_tool_calls: Option<bool>,
    /// When true, render an AI sparkle button next to the commit input.
    #[serde(default = "default_true")]
    pub ai_commit_messages: bool,
    /// Auto-archive threads older than this many days of inactivity.
    /// `None` or 0 disables auto-archiving.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_archive_days: Option<u32>,
    /// Manual token pricing keyed by provider name, in **USD per 1M tokens**.
    /// Only needed for user-registered OpenAI-compatible providers, whose
    /// `models.json` entries carry no price and therefore report a cost of 0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_rates: Option<std::collections::HashMap<String, ProviderRate>>,
    /// How many agent processes may run at once.
    ///
    /// Each live thread is a Node process with its own Python kernel, and
    /// nothing used to stop them accumulating — a real hazard for an app with
    /// `/goal` and autonomous mode, where loops keep running while nobody is
    /// watching. `None` uses [`DEFAULT_MAX_CONCURRENT_AGENTS`]; 0 means no
    /// limit, for anyone who knows what their machine can take.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_concurrent_agents: Option<u32>,
}

/// Enough for a comfortable working set of threads, far below the point where
/// a laptop starts swapping on the kernels alone.
pub const DEFAULT_MAX_CONCURRENT_AGENTS: u32 = 8;

fn default_agent_bin() -> String {
    "prime-agent".to_string()
}
fn default_font_size() -> u32 {
    14
}
fn default_theme() -> String {
    "dark".to_string()
}
fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            agent_bin: default_agent_bin(),
            agent_profiles: vec![],
            font_size: default_font_size(),
            chat_font_size: None,
            default_model: None,
            auto_approve: false,
            respect_gitignore: true,
            co_author: true,
            co_author_json_report: true,
            notifications: true,
            sound_notifications: true,
            project_prefs: None,
            has_onboarded_v2: false,
            analytics_enabled: true,
            agent_auto_compaction: true,
            agent_auto_retry: true,
            steering_mode: None,
            analytics_anon_id: None,
            language: None,
            theme: default_theme(),
            sidebar_position: None,
            custom_app_icon: None,
            last_seen_changelog_version: None,
            btw_max_chars: None,
            terminal_scrollback: None,
            terminal_auto_close_idle_mins: None,
            inline_tool_calls: None,
            ai_commit_messages: true,
            auto_archive_days: None,
            provider_rates: None,
            max_concurrent_agents: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoreData {
    pub settings: AppSettings,
    #[serde(default)]
    pub recent_projects: Vec<String>,
}

/// Maximum number of recent projects to keep.
const MAX_RECENT_PROJECTS: usize = 10;

pub struct SettingsState(pub Mutex<StoreData>);

const APP_NAME: &str = "laf-agent";

/// Move an unparseable settings file aside instead of letting it be replaced.
///
/// `confy::load(...).unwrap_or_default()` turns a truncated or malformed TOML
/// into silent defaults — and the very next save then writes those defaults
/// over the user's file. Everything not derivable from elsewhere goes with it:
/// per-project prefs, provider rates, agent profiles, recent projects. This
/// mirrors what the history store and SQLite already do: quarantine the bytes,
/// start clean, keep the evidence recoverable.
///
/// Returns the quarantine path if the file existed and did not parse.
pub(crate) fn quarantine_if_corrupt(path: &std::path::Path) -> Option<std::path::PathBuf> {
    let text = std::fs::read_to_string(path).ok()?;
    if toml::from_str::<StoreData>(&text).is_ok() {
        return None;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let target = path.with_extension(format!("corrupt.{stamp}.toml"));
    match std::fs::rename(path, &target) {
        Ok(()) => {
            log::warn!(
                "[settings] quarantined an unparseable config: {} -> {}",
                path.display(),
                target.display()
            );
            Some(target)
        }
        Err(e) => {
            log::error!("[settings] could not quarantine corrupt config: {e}");
            None
        }
    }
}

impl Default for SettingsState {
    fn default() -> Self {
        if let Ok(path) = confy::get_configuration_file_path(APP_NAME, None) {
            quarantine_if_corrupt(&path);
        }
        let data = confy::load::<StoreData>(APP_NAME, None).unwrap_or_default();
        Self(Mutex::new(data))
    }
}

/// Persist the settings store via confy.
///
/// Known limitation: confy writes the TOML in place (no temp-file + rename),
/// so a crash mid-write can leave a torn file. Deliberately not worked around
/// here — bypassing confy would mean owning its path/serialization contract —
/// because `quarantine_if_corrupt` already contains the damage: on the next
/// launch an unparseable file is moved aside (bytes kept for recovery) instead
/// of being silently replaced by defaults.
pub fn persist_store(data: &StoreData) -> Result<(), AppError> {
    confy::store(APP_NAME, None, data)?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, SettingsState>) -> Result<AppSettings, AppError> {
    let store = state.0.lock();
    Ok(store.settings.clone())
}

#[tauri::command]
pub fn save_settings(
    state: tauri::State<'_, SettingsState>,
    settings: AppSettings,
) -> Result<(), AppError> {
    let mut store = state.0.lock();
    store.settings = settings;
    persist_store(&store)
}

#[tauri::command]
pub fn get_recent_projects(state: tauri::State<'_, SettingsState>) -> Result<Vec<String>, AppError> {
    let store = state.0.lock();
    Ok(store.recent_projects.clone())
}

#[tauri::command]
pub fn add_recent_project(
    state: tauri::State<'_, SettingsState>,
    path: String,
) -> Result<(), AppError> {
    let mut store = state.0.lock();
    if store.recent_projects.first() == Some(&path) {
        return Ok(());
    }
    store.recent_projects.retain(|p| p != &path);
    store.recent_projects.insert(0, path);
    store.recent_projects.truncate(MAX_RECENT_PROJECTS);
    persist_store(&store)
}

#[tauri::command]
pub fn clear_recent_projects(state: tauri::State<'_, SettingsState>) -> Result<(), AppError> {
    let mut store = state.0.lock();
    store.recent_projects.clear();
    persist_store(&store)
}

/// Set the macOS dock / app icon at runtime from a base64-encoded PNG.
/// On non-macOS platforms this is a no-op.
#[tauri::command]
pub fn set_dock_icon(app: tauri::AppHandle, icon_base64: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use base64::Engine;

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&icon_base64)
            .map_err(|e| format!("Invalid base64: {e}"))?;

        // AppKit is main-thread-only; the old msg_send version called it from
        // the command thread and merely got away with it. objc2 makes the
        // requirement explicit, so hop over properly.
        app.run_on_main_thread(move || {
            use objc2::AnyThread;
            use objc2_app_kit::{NSApplication, NSImage};
            use objc2_foundation::NSData;

            let Some(mtm) = objc2::MainThreadMarker::new() else { return };
            let data = NSData::with_bytes(&bytes);
            let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
                log::warn!("[settings] dock icon bytes did not decode to an image");
                return;
            };
            let ns_app = NSApplication::sharedApplication(mtm);
            // SAFETY: main thread (run_on_main_thread), valid image reference.
            unsafe { ns_app.setApplicationIconImage(Some(&image)) };
        })
        .map_err(|e| format!("Could not reach the main thread: {e}"))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, icon_base64);
    Ok(())
}

/// Reset the macOS dock / app icon to the default bundle icon.
#[tauri::command]
pub fn reset_dock_icon(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    app.run_on_main_thread(|| {
        use objc2_app_kit::NSApplication;
        let Some(mtm) = objc2::MainThreadMarker::new() else { return };
        // SAFETY: main thread; None restores the bundle icon.
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(None) };
    })
    .map_err(|e| format!("Could not reach the main thread: {e}"))?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_values() {
        let s = AppSettings::default();
        assert_eq!(s.agent_bin, "prime-agent");
        assert_eq!(s.font_size, 14);
        assert!(!s.auto_approve);
        assert!(s.respect_gitignore);
        assert!(s.co_author);
        assert!(!s.has_onboarded_v2);
        assert!(s.agent_profiles.is_empty());
        assert!(s.project_prefs.is_none());
        assert!(s.analytics_enabled);
        assert!(s.analytics_anon_id.is_none());
    }

    #[test]
    fn serde_roundtrip_preserves_all_fields() {
        let mut prefs = std::collections::HashMap::new();
        prefs.insert(
            "proj".to_string(),
            ProjectPrefs {
                model_id: Some("claude-4".to_string()),
                auto_approve: Some(true),
                worktree_enabled: Some(true),
                symlink_directories: Some(vec!["node_modules".to_string(), ".next".to_string()]),
                tight_sandbox: Some(true),
                icon_override: Some(serde_json::json!({"type": "emoji", "emoji": "🚀"})),
                ..Default::default()
            },
        );
        let settings = AppSettings {
            agent_bin: "/usr/local/bin/prime-agent".to_string(),
            font_size: 16,
            auto_approve: true,
            has_onboarded_v2: true,
            respect_gitignore: false,
            co_author: false,
            project_prefs: Some(prefs),
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        let restored: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.agent_bin, "/usr/local/bin/prime-agent");
        assert_eq!(restored.font_size, 16);
        assert!(restored.auto_approve);
        assert!(restored.has_onboarded_v2);
        assert!(!restored.respect_gitignore);
        assert!(!restored.co_author);
        let pp = restored.project_prefs.unwrap();
        assert_eq!(pp["proj"].model_id.as_deref(), Some("claude-4"));
        assert_eq!(pp["proj"].worktree_enabled, Some(true));
        assert_eq!(pp["proj"].symlink_directories.as_deref(), Some(vec!["node_modules".to_string(), ".next".to_string()]).as_deref());
        assert_eq!(pp["proj"].tight_sandbox, Some(true));
        assert_eq!(pp["proj"].icon_override, Some(serde_json::json!({"type": "emoji", "emoji": "🚀"})));
    }

    #[test]
    fn icon_override_roundtrips_all_variants() {
        let framework = serde_json::json!({"type": "framework", "id": "react"});
        let prefs = ProjectPrefs { icon_override: Some(framework.clone()), ..Default::default() };
        let json = serde_json::to_string(&prefs).unwrap();
        let restored: ProjectPrefs = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.icon_override, Some(framework));
    }

    #[test]
    fn icon_override_defaults_to_none_when_missing() {
        let prefs: ProjectPrefs = serde_json::from_str(r#"{}"#).unwrap();
        assert!(prefs.icon_override.is_none());
    }

    #[test]
    fn tight_sandbox_defaults_to_none_when_missing() {
        let json = r#"{}"#;
        let prefs: ProjectPrefs = serde_json::from_str(json).unwrap();
        assert!(prefs.tight_sandbox.is_none());
    }

    #[test]
    fn provider_rates_defaults_to_none_when_missing() {
        let settings: AppSettings = serde_json::from_str(r#"{}"#).unwrap();
        assert!(settings.provider_rates.is_none());
    }

    #[test]
    fn provider_rates_roundtrip_in_camel_case() {
        let mut rates = std::collections::HashMap::new();
        rates.insert(
            "upstage".to_string(),
            ProviderRate {
                input: 0.5,
                output: 1.5,
                cache_read: Some(0.05),
                cache_write: None,
            },
        );
        let settings = AppSettings {
            provider_rates: Some(rates),
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("providerRates"));
        assert!(json.contains("cacheRead"));
        assert!(!json.contains("cacheWrite"));
        let restored: AppSettings = serde_json::from_str(&json).unwrap();
        let r = restored.provider_rates.unwrap();
        assert_eq!(
            r["upstage"],
            ProviderRate { input: 0.5, output: 1.5, cache_read: Some(0.05), cache_write: None },
        );
    }

    #[test]
    fn deserialize_with_missing_fields_uses_defaults() {
        let json = r#"{"agentBin": "/bin/agent"}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.agent_bin, "/bin/agent");
        assert_eq!(settings.font_size, 14);
        assert!(settings.respect_gitignore);
        assert!(settings.co_author);
        assert!(!settings.has_onboarded_v2);
    }

    #[test]
    fn camel_case_serialization() {
        let settings = AppSettings::default();
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("agentBin"));
        assert!(json.contains("fontSize"));
        assert!(json.contains("autoApprove"));
        assert!(json.contains("hasOnboardedV2"));
        assert!(!json.contains("agent_bin"));
    }
}

#[cfg(test)]
mod quarantine_tests {
    use super::*;

    fn temp(contents: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("default-config.toml");
        std::fs::write(&path, contents).expect("write");
        (dir, path)
    }

    /// The exact failure this exists for: a truncated write must not become
    /// "the user has default settings" plus an overwrite of the evidence.
    #[test]
    fn a_truncated_config_is_moved_aside_not_replaced() {
        let (_d, path) = temp("[settings]\nagent_bin = \"prime-a"); // cut mid-write
        let quarantined = quarantine_if_corrupt(&path).expect("should quarantine");
        assert!(!path.exists(), "the damaged file must be out of the way");
        assert!(quarantined.exists(), "and its bytes preserved");
        let name = quarantined.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.contains("corrupt."), "got: {name}");
    }

    #[test]
    fn a_healthy_config_is_left_alone() {
        let (_d, path) = temp("[settings]\nagent_bin = \"prime-agent\"\n");
        assert!(quarantine_if_corrupt(&path).is_none());
        assert!(path.exists());
    }

    #[test]
    fn a_missing_config_is_a_first_run_not_a_fault() {
        let dir = tempfile::tempdir().unwrap();
        assert!(quarantine_if_corrupt(&dir.path().join("nope.toml")).is_none());
    }
}
