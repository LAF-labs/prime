//! One-time provisioning of prime-agent's Python kernel.
//!
//! prime-agent's only model-facing tool is `ipython`; file edits, shell,
//! search and MCP integrations are all Python skills running inside it. The
//! kernel lives in a uv-managed venv at `~/.prime/agent/kernel-venv` and is
//! built on first use — roughly 350 MB of CPython and wheels.
//!
//! Left alone, that work happens lazily during the user's first tool call,
//! where the only signal is an error string if it fails. Running it up front
//! turns a mysterious stall into a visible setup step, and surfaces network
//! failures before the user has typed anything.

use serde::Serialize;
use tauri::Emitter;

use super::agent_launch::{resolve as resolve_launch, AgentLaunch};
use super::error::AppError;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KernelStatus {
    /// True when the venv exists and looks provisioned.
    pub ready: bool,
    pub venv_path: String,
    /// True when a `uv` binary is reachable (bundled or on PATH).
    pub has_uv: bool,
}

fn venv_dir() -> Option<std::path::PathBuf> {
    if let Ok(explicit) = std::env::var("PRIME_AGENT_KERNEL_VENV") {
        if !explicit.trim().is_empty() {
            return Some(std::path::PathBuf::from(explicit));
        }
    }
    dirs::home_dir().map(|h| h.join(".prime/agent/kernel-venv"))
}

/// Report whether the Python kernel has been provisioned.
#[tauri::command]
pub fn kernel_status(app: tauri::AppHandle) -> Result<KernelStatus, AppError> {
    let dir = venv_dir().ok_or_else(|| AppError::Other("No home directory".into()))?;
    // `.bootstrap-version` is written only after a successful provision, so it
    // is a better readiness signal than the directory existing.
    let ready = dir.join("bin/python").exists() && dir.join(".bootstrap-version").exists();

    let launch = resolve_launch(&app, "prime-agent");
    let bundled_uv = std::path::Path::new(&launch.program)
        .parent()
        .map(|p| p.join("uv"))
        .filter(|p| p.exists());
    let has_uv = bundled_uv.is_some()
        || which::which("uv").is_ok()
        || dirs::home_dir().map(|h| h.join(".local/bin/uv").exists()).unwrap_or(false);

    Ok(KernelStatus { ready, venv_path: dir.to_string_lossy().to_string(), has_uv })
}

/// Provision the kernel, streaming progress to the frontend.
///
/// Emits `kernel_setup_progress` (`{ line }`) for each bootstrap message and
/// resolves when the venv is ready. Safe to call when already provisioned —
/// prime-agent's bootstrapper short-circuits on a matching version marker.
#[tauri::command]
pub async fn kernel_setup(app: tauri::AppHandle) -> Result<(), AppError> {
    let launch: AgentLaunch = resolve_launch(&app, "prime-agent");
    // bootstrap-cli lives beside the compiled agent; it runs the same
    // provisioning path the agent would hit lazily, but with progress on
    // stderr and a non-zero exit on failure.
    let cli = std::path::Path::new(&launch.program)
        .parent()
        .map(|p| p.join("dist/core/kernel/bootstrap-cli.js"))
        .filter(|p| p.exists())
        .ok_or_else(|| {
            AppError::Other(
                "This build has no bundled agent runtime, so the Python kernel can't be prepared here.".into(),
            )
        })?;

    let mut child = tokio::process::Command::new(&launch.program)
        .arg(&cli)
        .env("PATH", super::agent_launch::agent_path_env(&launch))
        .env("PRIME_AGENT_INSTALL_UV", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to start kernel setup: {e}")))?;

    // Progress is written to stderr, one message per line.
    if let Some(stderr) = child.stderr.take() {
        let app_progress = app.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }
                log::info!("[kernel] {line}");
                let _ = app_progress.emit("kernel_setup_progress", serde_json::json!({ "line": line }));
            }
        });
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Other(format!("Kernel setup did not complete: {e}")))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::Other(
            "Kernel setup failed. The first run needs internet to download Python and its packages."
                .into(),
        ))
    }
}
