# PR review: Hitesh-Sisara/main

**Date:** 2026-05-10
**Branch:** `Hitesh-Sisara/main`
**Scope:** 221 files changed, +33,854 / -3,807 lines
**Reviewer:** Automated code and security review

---

## Summary

This PR adds a large set of backend commands and frontend features: file tree with CRUD operations, SQLite thread persistence, MCP HTTP/SSE transport, AI-powered text generation (commit messages, branch names, PR content, thread titles), per-turn checkpointing, GitHub/GitLab PR creation, git history/stash/stack, process diagnostics, syntax highlighting, markdown parsing, fuzzy matching, streaming diffs, pattern extraction, and structured tracing.

The code quality is high overall. The architecture follows established patterns (Tauri IPC, git2 over shell commands, parameterized SQL, Zustand stores). Several security improvements were made (PTY cwd validation, sensitive path blocking, command injection fixes). However, a few security gaps remain.

---

## Security findings

### Critical

#### S1. Path traversal in project_watcher.rs file operations

**Files:** `src-tauri/src/commands/project_watcher.rs`
**Commands:** `create_file`, `create_directory`, `delete_entry`, `rename_entry`, `copy_entry`, `duplicate_entry`

All file operations join `rel_path` directly to `workspace` without validating that the resolved path stays within the workspace:

```rust
pub fn create_file(workspace: String, rel_path: String) -> Result<TreeEntry, String> {
    let root = PathBuf::from(&workspace);
    let abs_path = root.join(&rel_path);  // No containment check!
    // ...
    std::fs::write(&abs_path, "")?;
}
```

A malicious or buggy frontend could pass `../../.ssh/authorized_keys` as `rel_path` and the backend would create/delete/rename files outside the workspace.

**Fix:** After joining, canonicalize the path and verify it starts with the canonicalized workspace root:

```rust
let abs_path = root.join(&rel_path).canonicalize()
    .or_else(|_| Ok::<_, std::io::Error>(root.join(&rel_path)))?;
let canonical_root = root.canonicalize()?;
if !abs_path.starts_with(&canonical_root) {
    return Err("Path escapes workspace".into());
}
```

---

### Medium

#### S2. Command injection in open_terminal_at (AppleScript string interpolation)

**File:** `src-tauri/src/commands/project_watcher.rs`

```rust
let script = format!(
    "tell application \"Terminal\"\nactivate\ndo script \"cd '{}'\"\nend tell",
    dir.to_string_lossy().replace('\'', "'\\''")
);
```

This uses the old string-interpolation pattern that was explicitly fixed in `fs_ops.rs` (which now uses `system attribute "KIRODEX_CD_PATH"` via environment variables). A directory name containing `'` followed by AppleScript commands could escape the quoting.

**Fix:** Use the same env-var pattern as `fs_ops.rs`:

```rust
let script = "tell application \"Terminal\"\nactivate\ndo script (\"cd \" & quoted form of (system attribute \"KIRODEX_CD_PATH\"))\nend tell";
std::process::Command::new("osascript")
    .arg("-e").arg(script)
    .env("KIRODEX_CD_PATH", dir.to_string_lossy().as_ref())
    .spawn()?;
```

---

#### S3. HttpTransport has no URL validation (SSRF risk)

**File:** `src-tauri/src/commands/transport.rs`

The `HttpTransport` accepts any URL from the frontend and makes HTTP POST requests to it. No validation prevents requests to internal services (`http://localhost:*`, `http://169.254.169.254` for cloud metadata, `http://10.*`, etc.).

```rust
let mut request = client
    .post(&self.config.url)  // No URL validation
    .header("Content-Type", "application/json")
    .timeout(timeout);
```

**Fix:** Validate the URL scheme (https only, or explicit allowlist for http://localhost) and reject private/link-local IP ranges.

---

#### S4. checkpoint_revert performs hard git reset without confirmation

**File:** `src-tauri/src/commands/checkpoint.rs`

```rust
pub fn checkpoint_revert(...) -> Result<(), AppError> {
    // ...
    repo.reset(commit.as_object(), git2::ResetType::Hard, None)?;
    Ok(())
}
```

A `git reset --hard` discards all uncommitted changes. The frontend should confirm with the user before calling this, but the backend has no guard. If the frontend has a bug or the IPC is called directly, data loss occurs.

**Recommendation:** Either:
- Add a `confirm: bool` parameter that must be `true`
- Check for uncommitted changes and return an error if dirty (requiring the caller to explicitly acknowledge)
- Document that the frontend MUST show a confirmation dialog

---

#### S5. open_in_default_app has no file type restriction

**File:** `src-tauri/src/commands/project_watcher.rs`

```rust
pub fn open_in_default_app(workspace: String, rel_path: String) -> Result<(), String> {
    let root = PathBuf::from(&workspace);
    let abs_path = root.join(&rel_path);
    open::that(&abs_path)?;
    Ok(())
}
```

Combined with the path traversal issue (S1), this could open arbitrary files. Even without traversal, opening certain file types (`.app`, `.command`, `.sh`) via `open::that` executes them on macOS.

---

### Low

#### S6. set_protocol_version silently drops updates on lock contention

**File:** `src-tauri/src/commands/transport.rs`

```rust
fn set_protocol_version(&self, version: &str) {
    match self.protocol_version.try_lock() {
        Ok(mut v) => { *v = Some(version.to_string()); }
        Err(_) => { log::warn!(...); }
    }
}
```

If the lock is contended during a `send()`, the protocol version is never applied. Subsequent requests may use the wrong version header. The warning is good, but there's no retry mechanism.

---

#### S7. extract_paths_from_message allows broad path grants

**File:** `src-tauri/src/commands/acp/sandbox.rs`

The comment says "Rejects overly broad paths (fewer than 2 segments)" but `/Users/someone` (2 segments) would still grant access to an entire home directory. The minimum should be 3+ segments for meaningful containment.

---

## Code quality findings

### Positive patterns

1. **SQL injection prevention** — All queries in `thread_db.rs` use parameterized queries (`?1`, `params![]`). FTS5 search uses `MATCH ?1`.
2. **Command injection fix** — `fs_ops.rs` now uses environment variables for AppleScript instead of string interpolation.
3. **PTY cwd validation** — New canonicalization + allowlist check prevents spawning terminals in sensitive directories.
4. **Sensitive path blocking** — `is_sensitive_path()` blocks reads of `.ssh/`, `.gnupg/`, `.aws/`, `.config/gh/`, `.netrc`.
5. **Process signaling restricted** — `signal_process` verifies the target PID is a descendant before sending signals.
6. **open_terminal_with_command allowlist** — Only `kiro-cli login/logout/whoami` are permitted.
7. **XSS prevention** — All `dangerouslySetInnerHTML` usages properly escape HTML entities before inserting markup.
8. **Connection death handling** — Synthetic `turn_end` events prevent stuck spinners when ACP connections die.
9. **Resumption preamble** — Capped at 60KB/40 messages to prevent context overflow.
10. **Thread DB robustness** — Integrity checks, corruption recovery, in-memory fallback, WAL mode.

### Issues

1. **Dead code** — `ConnectionConfig` struct in `connection.rs` is marked `#[allow(dead_code)]` but never used. Either use it or remove it.

2. **Inconsistent error types** — `project_watcher.rs` returns `Result<_, String>` while most other commands use `Result<_, AppError>`. This loses structured error info and makes error handling inconsistent.

3. **git_utils shells out to git** — `run_git_cmd` and `run_git_cmd_async` use `Command::new("git")` instead of git2. This contradicts the project's "prefer community crates over shelling out" principle. Used by `branch_ai` (rename), `git_pr`, `git_stack`, and `vcs_status`. Some operations (like `git push`, `gh pr create`) genuinely need CLI, but `git branch -m` could use git2.

4. **Unbounded channel in ACP** — `mpsc::unbounded_channel` for ACP commands means a fast producer (frontend spam) could grow memory without bound. Consider bounded channels with backpressure.

5. **50ms sleep in task_create** — After killing a stale connection, there's a `std::thread::sleep(50ms)` which blocks the Tauri command thread. Use `tokio::time::sleep` or restructure.

6. **Large file in PR** — `project_watcher.rs` is 1,114 lines. Consider splitting into `project_watcher/mod.rs`, `project_watcher/scan.rs`, `project_watcher/operations.rs`, `project_watcher/watcher.rs`.

---

## Architecture observations

- The PR adds ~20 new Rust modules. The command surface area is now large (~100 registered commands). Consider grouping into feature-gated modules for build time.
- The `thread_db` SQLite persistence runs alongside the existing `tauri-plugin-store` (LazyStore) persistence. This creates two sources of truth for thread data. Migration path should be documented.
- The `transport.rs` HTTP/SSE implementation buffers entire responses before parsing SSE events. The doc comment acknowledges this limitation. For production use with long-lived streams, this needs `bytes_stream()`.

---

## Recommendations (priority order)

1. **Fix S1** — Add path containment validation to all project_watcher file operations. This is the highest-risk finding.
2. **Fix S2** — Use env-var pattern for `open_terminal_at` AppleScript (copy from `fs_ops.rs`).
3. **Fix S3** — Add URL validation to HttpTransport (reject private IPs, require HTTPS for non-localhost).
4. **Fix S4** — Add dirty-check guard to `checkpoint_revert`.
5. **Migrate project_watcher to AppError** — Replace `Result<_, String>` with `Result<_, AppError>`.
6. **Remove dead ConnectionConfig** — Or wire it up to replace the positional params.
