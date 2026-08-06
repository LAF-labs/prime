//! Smoke test for git_ai. Run with:
//!
//! ```sh
//! cargo run --example git_ai_smoke -- /path/to/repo
//! ```
//!
//! Bypasses the SettingsState wiring by calling the internal helpers directly.

use laf_agent_lib::commands::git_ai;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cwd = std::env::args().nth(1).expect("usage: git_ai_smoke <cwd>");
    let agent_bin =
        std::env::var("AGENT_BIN").unwrap_or_else(|_| "prime-agent".to_string());

    let result = git_ai::generate_for_smoke(&agent_bin, &cwd).await?;
    println!("subject: {}", result.subject);
    if !result.body.is_empty() {
        println!("\nbody:\n{}", result.body);
    }
    Ok(())
}
