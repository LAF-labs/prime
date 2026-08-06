//! Resolve how to launch the prime-agent backend.
//!
//! LAF Agent ships prime-agent inside the app bundle (a Node runtime plus the
//! compiled npm package under `resources/prime-agent/`), so a plain DMG
//! install works with no CLI setup. Resolution order:
//!
//! 1. An explicit user-configured binary path (Settings → agent binary) that
//!    differs from the default — power users can point at their own install.
//! 2. The bundled sidecar (`<resources>/prime-agent/node dist/bundle/cli.js`).
//! 3. The configured name as-is (PATH lookup, default `prime-agent`).

use std::path::PathBuf;

/// A resolved launch spec: `program` plus arguments that must precede any
/// mode flags (e.g. the cli.js path when launching through bundled Node).
#[derive(Clone, Debug)]
pub struct AgentLaunch {
    pub program: String,
    pub prefix_args: Vec<String>,
}

impl AgentLaunch {
    fn plain(program: &str) -> Self {
        Self { program: program.to_string(), prefix_args: vec![] }
    }
}

/// Locate the bundled sidecar directory, if this build ships one.
pub fn bundled_sidecar_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    if let Ok(p) = app
        .path()
        .resolve("resources/prime-agent", tauri::path::BaseDirectory::Resource)
    {
        if p.join("dist/bundle/cli.js").exists() {
            return Some(p);
        }
    }
    // Dev fallback: src-tauri/resources/prime-agent
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/prime-agent");
    if dev.join("dist/bundle/cli.js").exists() {
        return Some(dev);
    }
    None
}

/// Resolve the launch spec for the configured binary name/path.
pub fn resolve(app: &tauri::AppHandle, configured: &str) -> AgentLaunch {
    let configured = configured.trim();
    let is_default = configured.is_empty() || configured == "prime-agent";

    // Explicit user override (an absolute path outside our bundle) wins.
    if !is_default && configured.contains('/') && !configured.contains("/resources/prime-agent/") {
        return AgentLaunch::plain(configured);
    }

    if let Some(dir) = bundled_sidecar_dir(app) {
        let node = dir.join("node");
        let cli = dir.join("dist/bundle/cli.js");
        if node.exists() {
            // Resource copies can lose the exec bit; restore it defensively.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::metadata(&node) {
                    let mode = meta.permissions().mode();
                    if mode & 0o111 == 0 {
                        let _ = std::fs::set_permissions(&node, std::fs::Permissions::from_mode(mode | 0o755));
                    }
                }
            }
            return AgentLaunch {
                program: node.to_string_lossy().to_string(),
                prefix_args: vec![cli.to_string_lossy().to_string()],
            };
        }
    }

    AgentLaunch::plain(if configured.is_empty() { "prime-agent" } else { configured })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_launch_has_no_prefix() {
        let l = AgentLaunch::plain("/usr/local/bin/prime-agent");
        assert_eq!(l.program, "/usr/local/bin/prime-agent");
        assert!(l.prefix_args.is_empty());
    }
}
