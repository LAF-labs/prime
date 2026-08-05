# Activity Log

## 2026-04-17 16:00 (Dubai) — Split monolithic acp.rs into focused modules

**Task:** Split `src-tauri/src/commands/acp.rs` (~1200 lines) into focused modules under `src-tauri/src/commands/acp/` directory.

**Files created:**
- `src-tauri/src/commands/acp/mod.rs` — Module root with re-exports and utility functions (now_millis, now_rfc3339, days_to_ymd)
- `src-tauri/src/commands/acp/types.rs` — All frontend-facing types (Task, AcpState, ConnectionHandle, etc.)
- `src-tauri/src/commands/acp/sandbox.rs` — Path checking and extraction functions (is_within_workspace, is_path_allowed, etc.)
- `src-tauri/src/commands/acp/client.rs` — KirodexClient struct and acp::Client impl
- `src-tauri/src/commands/acp/connection.rs` — spawn_connection and run_acp_connection
- `src-tauri/src/commands/acp/commands.rs` — All #[tauri::command] functions (14 commands)
- `src-tauri/src/commands/acp/tests.rs` — All 169 tests (previously in #[cfg(test)] mod tests)

**Files deleted:**
- `src-tauri/src/commands/acp.rs` — Original monolithic file

**Files unchanged:**
- `src-tauri/src/commands/mod.rs` — Already had `pub mod acp;` which now resolves to `acp/mod.rs`

**Verification:**
- `cargo check` — passes (only pre-existing cocoa deprecation warnings)
- `cargo test` — 169 tests pass, 0 failures

## 2026-04-17 16:15 (Dubai) — parking_lot::Mutex migration

Replaced `std::sync::Mutex` with `parking_lot::Mutex` across the entire Kirodex Rust codebase and tuned the Cargo release profile.

### Files modified:
- `Cargo.toml` — added `parking_lot = "0.12"`, changed `opt-level = "s"` → `opt-level = 2`, added `[profile.dev.package."*"]` with `opt-level = 2`
- `src/commands/acp/types.rs` — switched Mutex import to parking_lot
- `src/commands/acp/commands.rs` — removed all `.lock().map_err(...)? ` error handling (36 occurrences)
- `src/commands/acp/client.rs` — switched `allowed_paths` type to `parking_lot::Mutex`, removed `.lock().unwrap_or_else(|e| e.into_inner())` (3 occurrences)
- `src/commands/acp/connection.rs` — switched to `parking_lot::Mutex::new()`, removed `if let Ok(...)` lock patterns
- `src/commands/settings.rs` — switched Mutex import, removed `?` after `.lock()` calls
- `src/commands/pty.rs` — switched Mutex import, removed `.map_err(|_| AppError::LockPoisoned)?` (4 occurrences)
- `src/commands/error.rs` — removed `LockPoisoned` variant, removed `From<PoisonError<T>>` impl, removed `lock_poisoned_display` test
- `src/commands/git.rs` — fixed `.lock()?` and `.lock().map()` patterns (not in original spec but required for compilation)
- `src/lib.rs` — replaced `match ... lock() { Ok(...) => ..., Err(e) => ... }` with direct lock usage in `shutdown_app`, updated doc comment

### Verification:
- `cargo check` — passes (0 errors)
- `cargo test` — 168 tests pass, 0 failures
