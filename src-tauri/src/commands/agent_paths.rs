//! Where the agent keeps its state, in one place.
//!
//! The harness takes its identity from `piConfig` in the sidecar's
//! `package.json`, which `scripts/build-sidecar.sh` writes. That one setting
//! decides the config directory (`~/.lafagent` and `<project>/.lafagent`), the
//! `LAFAGENT_*` environment switches, and the kernel venv underneath. The
//! constants here are this side of that contract: change one without the
//! other and the app reads a directory the agent never writes.
//!
//! These were literals scattered across five modules before, which is how the
//! two halves drifted in the first place.

use std::path::PathBuf;

/// Config directory name, relative to `$HOME` or to a project root.
///
/// Mirrors `piConfig.configDir` in `scripts/build-sidecar.sh`.
pub const AGENT_CONFIG_DIR: &str = ".lafagent";

/// The directory this app's predecessor used, kept only so a one-time
/// migration can find it. See `migrate_legacy_config_dir`.
pub const LEGACY_CONFIG_DIR: &str = ".prime/agent";

/// Environment prefix the harness derives from `piConfig.name`.
pub const ENV_PREFIX: &str = "LAFAGENT";

/// `~/.lafagent`, where credentials, models and sessions live.
pub fn global_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(AGENT_CONFIG_DIR))
}

/// `~/.lafagent/auth.json` — provider credentials.
pub fn auth_json() -> Option<PathBuf> {
    global_dir().map(|d| d.join("auth.json"))
}

/// `~/.lafagent/models.json` — custom endpoints.
pub fn models_json() -> Option<PathBuf> {
    global_dir().map(|d| d.join("models.json"))
}

/// `<project>/.lafagent` — per-project agent settings.
pub fn project_dir(project: &std::path::Path) -> PathBuf {
    project.join(AGENT_CONFIG_DIR)
}

/// Move a previous install's `~/.prime/agent` to `~/.lafagent`, once.
///
/// Renaming the config directory without this would strand the user's API
/// keys and force a fresh ~280 MB Python kernel download, because the harness
/// reads only the configured directory. A rename is atomic on the same
/// filesystem and cheap regardless of how large the kernel venv is.
///
/// Deliberately conservative: it runs only when the new directory does not
/// exist at all, so it can never merge two states or overwrite live data, and
/// a failure leaves the old directory untouched.
pub fn migrate_legacy_config_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let new_dir = home.join(AGENT_CONFIG_DIR);
    if new_dir.exists() {
        return None;
    }
    let old_dir = home.join(LEGACY_CONFIG_DIR);
    if !old_dir.is_dir() {
        return None;
    }
    match std::fs::rename(&old_dir, &new_dir) {
        Ok(()) => {
            // `~/.prime` is left behind on purpose when it still holds
            // anything else — it may belong to a real prime-agent install.
            let _ = std::fs::remove_dir(home.join(".prime"));
            Some(new_dir)
        }
        Err(e) => {
            log::warn!("[migration] could not move {old_dir:?} to {new_dir:?}: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The Rust side and the sidecar build script must agree, or the app
    /// reads a directory the agent never writes.
    #[test]
    fn the_config_dir_matches_the_sidecar_build_script() {
        let script = include_str!("../../../scripts/build-sidecar.sh");
        let expected = format!("configDir: '{AGENT_CONFIG_DIR}'");
        assert!(
            script.contains(&expected),
            "build-sidecar.sh must set {expected}; AGENT_CONFIG_DIR is {AGENT_CONFIG_DIR}"
        );
    }

    /// Same contract for the environment prefix the harness derives from
    /// `piConfig.name`.
    #[test]
    fn the_env_prefix_matches_the_sidecar_build_script() {
        let script = include_str!("../../../scripts/build-sidecar.sh");
        let name = ENV_PREFIX.to_lowercase();
        assert!(
            script.contains(&format!("name: '{name}'")),
            "build-sidecar.sh must set piConfig.name to '{name}'"
        );
    }

    #[test]
    fn paths_hang_off_the_one_constant() {
        let Some(dir) = global_dir() else { return };
        assert!(dir.ends_with(AGENT_CONFIG_DIR));
        assert!(auth_json().unwrap().ends_with(".lafagent/auth.json"));
        assert!(models_json().unwrap().ends_with(".lafagent/models.json"));
        assert_eq!(
            project_dir(std::path::Path::new("/tmp/p")),
            std::path::PathBuf::from("/tmp/p/.lafagent")
        );
    }

    /// Migration must not fire when the new directory already exists — that
    /// would be the case where the user has live data in it.
    #[test]
    fn migration_is_a_no_op_when_the_new_directory_exists() {
        // `global_dir()` exists on this machine after first run; the guard is
        // the same code path either way, so assert the invariant directly.
        let home = dirs::home_dir().expect("home");
        if home.join(AGENT_CONFIG_DIR).exists() {
            assert!(migrate_legacy_config_dir().is_none());
        }
    }
}
