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

/// Carry a previous install's `~/.prime/agent` settings over to `~/.lafagent`.
///
/// Renaming the config directory without this strands the user's API keys and
/// their custom provider definitions, because the harness reads only the
/// configured directory.
///
/// This used to rename the whole directory, and only when the new one did not
/// exist at all. That condition is almost never true: the agent creates
/// `~/.lafagent/sessions` the first time it runs, and after that the migration
/// declined forever — silently, since finding nothing to do and refusing to do
/// it look identical from the outside. A real install lost its Upstage key and
/// a ten-model provider definition that way, and the symptom reached the user
/// as "the model I use is missing from the list".
///
/// So it moves the settings files individually, and only into places nothing
/// occupies. Session data is left where it is; it is large, disposable, and
/// not what anyone misses.
///
/// `auth.json` is the one exception to "skip what exists": it is a map of
/// provider to credentials, and the two directories can each hold providers
/// the other does not. Those are merged, with the current file winning any
/// key that appears in both — a newer credential for the same provider is the
/// one worth keeping.
///
/// Returns the files it brought across.
pub fn migrate_legacy_config_dir() -> Vec<PathBuf> {
    match dirs::home_dir() {
        Some(home) => migrate_from_home(&home),
        None => Vec::new(),
    }
}

/// The body of [`migrate_legacy_config_dir`], with the home directory passed
/// in. It writes to real paths, so the tests need to point it somewhere that
/// is not the developer's own config.
fn migrate_from_home(home: &std::path::Path) -> Vec<PathBuf> {
    const SETTINGS_FILES: &[&str] = &["auth.json", "models.json", "settings.json"];

    let old_dir = home.join(LEGACY_CONFIG_DIR);
    if !old_dir.is_dir() {
        return Vec::new();
    }
    let new_dir = home.join(AGENT_CONFIG_DIR);
    if std::fs::create_dir_all(&new_dir).is_err() {
        return Vec::new();
    }

    let mut moved = Vec::new();
    for name in SETTINGS_FILES {
        let from = old_dir.join(name);
        let to = new_dir.join(name);
        if !from.is_file() {
            continue;
        }
        let carried = if !to.exists() {
            std::fs::copy(&from, &to).map(|_| true)
        } else if *name == "auth.json" {
            merge_auth_json(&from, &to).map(|merged| merged)
        } else {
            Ok(false)
        };
        match carried {
            Ok(true) => {
                log::info!("[migration] carried {name} over from {}", old_dir.display());
                moved.push(to);
            }
            Ok(false) => {}
            Err(e) => log::warn!("[migration] could not carry {name} over: {e}"),
        }
    }
    moved
}

/// Fold the providers in `from` into `to`, keeping `to`'s entry on a clash.
///
/// Returns whether anything was actually added, so a no-op does not get
/// reported as a migration.
fn merge_auth_json(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<bool> {
    let invalid = |what: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, what);

    let old: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(from)?)
        .map_err(|_| invalid("legacy auth.json is not JSON"))?;
    let current: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(to)?)
        .map_err(|_| invalid("auth.json is not JSON"))?;
    let (Some(old), Some(current)) = (old.as_object(), current.as_object()) else {
        return Err(invalid("auth.json is not an object"));
    };

    let mut merged = current.clone();
    let mut added = false;
    for (provider, credentials) in old {
        if !merged.contains_key(provider) {
            merged.insert(provider.clone(), credentials.clone());
            added = true;
        }
    }
    if !added {
        return Ok(false);
    }
    std::fs::write(to, serde_json::to_string_pretty(&merged)? + "\n")?;
    // Credentials: readable by their owner and no one else, the same mode the
    // harness writes with. `fs::write` on a new file would use the umask.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(to, std::fs::Permissions::from_mode(0o600));
    }
    Ok(true)
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

    /// The bug this migration had: `~/.lafagent/sessions` exists the moment
    /// the agent runs once, and the old all-or-nothing rename declined from
    /// then on. Merging by provider is what carries a key across that state.
    #[test]
    fn auth_merge_keeps_both_providers_and_prefers_the_current_one() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join("legacy-auth.json");
        let current = dir.path().join("auth.json");
        std::fs::write(&legacy, r#"{"upstage":{"key":"old"},"shared":{"key":"stale"}}"#).unwrap();
        std::fs::write(&current, r#"{"openrouter":{"key":"new"},"shared":{"key":"fresh"}}"#).unwrap();

        assert!(merge_auth_json(&legacy, &current).unwrap());

        let merged: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&current).unwrap()).unwrap();
        assert!(merged.get("upstage").is_some(), "the legacy provider must survive");
        assert!(merged.get("openrouter").is_some(), "the current one must not be lost");
        assert_eq!(
            merged["shared"]["key"], "fresh",
            "a provider present in both keeps the current credential"
        );
    }

    /// Nothing to add is not a migration, and must not rewrite the file.
    #[test]
    fn auth_merge_reports_nothing_when_the_legacy_file_adds_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join("legacy-auth.json");
        let current = dir.path().join("auth.json");
        std::fs::write(&legacy, r#"{"openrouter":{"key":"old"}}"#).unwrap();
        std::fs::write(&current, r#"{"openrouter":{"key":"new"}}"#).unwrap();
        let before = std::fs::read_to_string(&current).unwrap();

        assert!(!merge_auth_json(&legacy, &current).unwrap());
        assert_eq!(std::fs::read_to_string(&current).unwrap(), before);
    }

    /// A damaged file must not take the credentials that are still good with
    /// it — the caller logs and moves on.
    #[test]
    fn auth_merge_refuses_a_file_that_is_not_json() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join("legacy-auth.json");
        let current = dir.path().join("auth.json");
        std::fs::write(&legacy, "not json at all").unwrap();
        std::fs::write(&current, r#"{"openrouter":{"key":"new"}}"#).unwrap();
        assert!(merge_auth_json(&legacy, &current).is_err());
        assert!(std::fs::read_to_string(&current).unwrap().contains("openrouter"));
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

    /// The case the old implementation could not handle: the new directory
    /// already exists because the agent ran once and made `sessions/`, and the
    /// settings are still in the old one.
    #[test]
    fn settings_are_carried_over_even_when_the_new_directory_exists() {
        let home = tempfile::tempdir().unwrap();
        let old_dir = home.path().join(LEGACY_CONFIG_DIR);
        std::fs::create_dir_all(&old_dir).unwrap();
        std::fs::write(old_dir.join("auth.json"), r#"{"upstage":{"key":"k"}}"#).unwrap();
        std::fs::write(old_dir.join("models.json"), r#"{"providers":{}}"#).unwrap();
        // The agent has already run: the new directory exists, but holds only
        // session data.
        std::fs::create_dir_all(home.path().join(AGENT_CONFIG_DIR).join("sessions")).unwrap();

        let carried = migrate_from_home(home.path());

        assert_eq!(carried.len(), 2, "both settings files should come across");
        let new_dir = home.path().join(AGENT_CONFIG_DIR);
        assert!(new_dir.join("auth.json").is_file());
        assert!(new_dir.join("models.json").is_file());
        // Sessions are large and disposable; they stay where they are.
        assert!(old_dir.join("auth.json").is_file(), "the old copy is left in place");
    }

    /// A file the user already has in the new directory is theirs, not the
    /// migration's to replace.
    #[test]
    fn an_existing_settings_file_is_never_overwritten() {
        let home = tempfile::tempdir().unwrap();
        let old_dir = home.path().join(LEGACY_CONFIG_DIR);
        let new_dir = home.path().join(AGENT_CONFIG_DIR);
        std::fs::create_dir_all(&old_dir).unwrap();
        std::fs::create_dir_all(&new_dir).unwrap();
        std::fs::write(old_dir.join("settings.json"), r#"{"defaultModel":"old"}"#).unwrap();
        std::fs::write(new_dir.join("settings.json"), r#"{"defaultModel":"current"}"#).unwrap();

        assert!(migrate_from_home(home.path()).is_empty());
        assert!(std::fs::read_to_string(new_dir.join("settings.json"))
            .unwrap()
            .contains("current"));
    }

    /// No previous install: nothing to do, and no directory conjured up.
    #[test]
    fn nothing_happens_without_a_legacy_directory() {
        let home = tempfile::tempdir().unwrap();
        assert!(migrate_from_home(home.path()).is_empty());
        assert!(!home.path().join(AGENT_CONFIG_DIR).exists());
    }
}
