# Implementation Plan — Rust & React Performance Optimization + Component Decomposition

## Problem Statement
Proactive performance audit of the entire Kirodex Tauri app (10 Rust files, ~180 React files) to identify and fix performance bottlenecks, reduce bundle size, and decompose oversized components into smaller, focused units.

## Requirements
- Review ALL source files for performance issues (Rust backend + React frontend)
- Aggressive optimizations: restructure components, add virtualization, rewrite hot paths
- Break large components into smaller, focused sub-components
- Optimize bundle size for faster Tauri startup
- Full Rust performance pass including Mutex analysis and Cargo profile tuning
- Equal priority between Rust and React

## Background

### Rust Issues Found
1. `is_path_allowed` / `is_path_strictly_allowed` — O(n) iteration over a `HashSet`, defeating the purpose of using a hash set. Should use prefix-based lookup.
2. `list_project_files` — calls `file_mtime()` (a syscall) per file, expensive for large repos (25k file cap). Line delta collection iterates diffs twice.
3. `acp.rs` is 2,377 lines — a monolith mixing types, client impl, connection management, commands, and tests.
4. `std::sync::Mutex` used for `AcpState` — potential contention between Tauri command thread and ACP background threads. `parking_lot::Mutex` would be faster and non-poisoning.
5. `git.rs` — `git_diff_file` creates two separate `DiffOptions` and runs two diff passes; `git_list_branches` opens worktree repos in a loop.
6. Cargo `[profile.release]` uses `opt-level = "s"` (size) — `"2"` would be faster for a desktop app.
7. `friendly_prompt_error` — cascading `contains()` calls on lowercased string; minor but could use a match table.

### React Issues Found
1. **MessageList** — renders ALL timeline rows without virtualization despite `@tanstack/react-virtual` being installed. Long conversations will lag.
2. **ChatMarkdown** — recreates the entire `components` object on every render (depends on `searchQuery` but most renders don't change it). This causes ReactMarkdown to re-mount all custom components.
3. **Store selectors** — several components use broad selectors that trigger re-renders on any task field change.
4. **Large components needing decomposition:**
   - `SettingsPanel.tsx` (874 lines)
   - `AppHeader.tsx` (607 lines)
   - `ChatInput.tsx` (429 lines)
   - `SlashPanels.tsx` (523 lines)
   - `BranchSelector.tsx` (500 lines)
   - `Onboarding.tsx` (480 lines)
   - `KiroConfigPanel.tsx` (418 lines)
   - `DiffViewer.tsx` (418 lines)
5. **Bundle size** — `posthog-js` loaded eagerly; `core-js` pulled in transitively.
6. **taskStore.ts** (1,190 lines) — monolithic store with 40+ actions.

## Completed Tasks

## In Progress Tasks

## Future Tasks

### Task 1: Rust — Fix `is_path_allowed` / `is_path_strictly_allowed` O(n) lookups
- **Objective:** Replace O(n) iteration over `HashSet` with efficient prefix-based path checking.
- **Implementation:** Change `allowed_paths` from `HashSet<String>` to a `BTreeSet<String>` and use `range()` for O(log n) prefix matching. For `is_path_strictly_allowed`, use `BTreeSet::range()` to find candidates. For `is_path_allowed`, also check parent directories efficiently.
- **Test requirements:** Existing tests in `acp.rs` must pass. The `perf_strict_allowed_large_set` and `perf_loose_allowed_large_set` benchmarks should show improvement.
- **Demo:** Run `cargo test` — all path-checking tests pass with the new data structure.

### Task 2: Rust — Optimize `list_project_files` for large repos
- **Objective:** Reduce syscalls and redundant work in the file listing command.
- **Implementation:** (1) Skip `file_mtime` for clean files (no git status change). (2) Combine the two diff passes in `collect_line_deltas` into a single iteration where possible. (3) Pre-allocate `status_map` with correct capacity.
- **Test requirements:** `fs_ops` tests pass. Manual test with a large repo shows faster response.
- **Demo:** `list_project_files` returns faster for large repos. Existing tests pass.

### Task 3: Rust — Split `acp.rs` into focused modules
- **Objective:** Decompose the 2,377-line `acp.rs` into smaller, focused files.
- **Implementation:** Split into: `acp/types.rs` (frontend-facing types), `acp/client.rs` (KirodexClient impl), `acp/connection.rs` (spawn_connection + run_acp_connection), `acp/commands.rs` (Tauri commands), `acp/sandbox.rs` (path checking, extraction), `acp/mod.rs` (re-exports). Move tests into `acp/tests/` submodules.
- **Test requirements:** All existing `acp` tests pass. `cargo check` succeeds. No public API changes.
- **Demo:** `cargo test` passes. `acp/` is now a directory with 5-6 focused files.

### Task 4: Rust — Replace `std::sync::Mutex` with `parking_lot::Mutex` + Cargo profile tuning
- **Objective:** Reduce lock contention and improve release build performance.
- **Implementation:** (1) Add `parking_lot` dependency. Replace all `std::sync::Mutex` with `parking_lot::Mutex` in `AcpState`, `PtyState`, `SettingsState`. Eliminate poison error handling. (2) Change `[profile.release]` from `opt-level = "s"` to `opt-level = 2`. (3) Add `[profile.dev.package."*"]` with `opt-level = 2` for faster dev dependency compilation.
- **Test requirements:** All Rust tests pass. Build succeeds in both dev and release profiles.
- **Demo:** `cargo build --release` succeeds. Lock code is simpler (no poison handling).

### Task 5: Rust — Optimize git operations
- **Objective:** Reduce redundant repo opens and diff passes in git commands.
- **Implementation:** (1) In `git_diff_file`, reuse a single `DiffOptions` instance. (2) In `git_list_branches`, collect worktree branches more efficiently. (3) In `git_diff_stats` and `git_staged_stats`, avoid computing full stats when only counts are needed.
- **Test requirements:** All git tests pass.
- **Demo:** Git operations are measurably faster on repos with many branches/worktrees.

### Task 6: React — Virtualize MessageList with @tanstack/react-virtual
- **Objective:** Only render visible timeline rows instead of all rows.
- **Implementation:** Replace the flat `timelineRows.map()` in `MessageList` with `useVirtualizer` from `@tanstack/react-virtual`. Use dynamic row height measurement. Keep auto-scroll and search-scroll behaviors working.
- **Test requirements:** Existing MessageList behavior tests pass. Add a test verifying only visible rows are rendered with 100+ rows.
- **Demo:** Open a long conversation (50+ messages). DOM inspector shows only ~20 rows rendered at a time.

### Task 7: React — Fix ChatMarkdown memoization
- **Objective:** Prevent unnecessary re-creation of the ReactMarkdown `components` object.
- **Implementation:** (1) Memoize the `components` factory with stable reference (only depends on `searchQuery`). (2) Move `stabilizeStreamingMarkdown` result into a `useMemo`. (3) Extract `CodeBlock`, `InlineCode`, `MarkdownLink` as standalone memo'd components.
- **Test requirements:** ChatMarkdown renders correctly. Search highlighting still works.
- **Demo:** React DevTools Profiler shows ChatMarkdown children don't re-mount when parent re-renders without text changes.

### Task 8: React — Optimize Zustand store selectors
- **Objective:** Reduce unnecessary re-renders from broad store subscriptions.
- **Implementation:** (1) In `ChatPanel`, use `useShallow` selector for grouped field picks. (2) In `StreamingMessageList`, ensure empty-string chunk doesn't cause re-renders. (3) Add `useShallow` to any component subscribing to object/array slices.
- **Test requirements:** Existing component tests pass. No behavioral changes.
- **Demo:** React DevTools Profiler shows fewer re-renders in ChatPanel when typing.

### Task 9: React — Decompose SettingsPanel (874 lines)
- **Objective:** Split the monolithic SettingsPanel into focused section components.
- **Implementation:** Extract: `GeneralSettings.tsx`, `EditorSettings.tsx`, `ModelSettings.tsx`, `ProjectSettings.tsx`, `AdvancedSettings.tsx`, `AboutSection.tsx`. SettingsPanel becomes a thin shell with tab navigation.
- **Test requirements:** Settings panel renders and saves correctly.
- **Demo:** SettingsPanel works identically but each section file is <150 lines.

### Task 10: React — Decompose AppHeader (607 lines)
- **Objective:** Break AppHeader into focused sub-components.
- **Implementation:** Extract: `HeaderBreadcrumb.tsx`, `HeaderToolbar.tsx`, `HeaderActions.tsx`. AppHeader becomes a layout shell ~100 lines.
- **Test requirements:** Header renders correctly. Breadcrumb navigation works.
- **Demo:** AppHeader.tsx is ~100 lines. Sub-components are independently testable.

### Task 11: React — Decompose ChatInput (429 lines), BranchSelector (500 lines), SlashPanels (523 lines)
- **Objective:** Break three large chat-related components into smaller units.
- **Implementation:** (1) `ChatInput` → extract `ChatToolbar.tsx`, `ChatTextarea.tsx`. (2) `BranchSelector` → extract `BranchList.tsx`, `CreateBranchDialog.tsx`. (3) `SlashPanels` → extract each panel (`AgentPanel.tsx`, `SkillPanel.tsx`, `SteeringPanel.tsx`, `McpPanel.tsx`) into its own file.
- **Test requirements:** All chat input, branch, and slash panel functionality works.
- **Demo:** Each file is <200 lines. Functionality is identical.

### Task 12: React — Decompose Onboarding (480 lines), KiroConfigPanel (418 lines), DiffViewer (418 lines)
- **Objective:** Break remaining large components into smaller units.
- **Implementation:** (1) `Onboarding` → extract `OnboardingStep.tsx`, `ProjectSetupStep.tsx`, `CompletionStep.tsx`. (2) `KiroConfigPanel` → extract `AgentsList.tsx`, `SteeringRulesList.tsx`, `McpServersList.tsx`, `SkillsList.tsx`. (3) `DiffViewer` → extract `DiffHeader.tsx`, `DiffLineRenderer.tsx`, `DiffGutter.tsx`.
- **Test requirements:** All functionality preserved. Existing tests pass.
- **Demo:** Each parent component is <150 lines.

### Task 13: React — Split taskStore.ts (1,190 lines) into slices
- **Objective:** Decompose the monolithic task store into focused slice files.
- **Implementation:** Extract: `taskStore/types.ts`, `taskStore/streaming.ts`, `taskStore/queue.ts`, `taskStore/persistence.ts`, `taskStore/worktree.ts`. Main `taskStore.ts` imports and composes slices.
- **Test requirements:** All existing taskStore tests pass.
- **Demo:** `taskStore.ts` is ~300 lines. Each slice is <200 lines.

### Task 14: Bundle optimization — Dynamic import analytics, tree-shake heavy deps
- **Objective:** Reduce initial bundle size for faster Tauri startup.
- **Implementation:** (1) Dynamic-import `posthog-js` — wrap `initAnalytics` in a lazy loader. (2) Add `posthog-js` to manual chunks as `vendor-analytics` with dynamic import. (3) Verify `@tabler/icons-react` is tree-shaken.
- **Test requirements:** App starts correctly. Analytics still works after settings load.
- **Demo:** `vite build` output shows smaller initial chunk.

### Task 15: Integration testing and verification
- **Objective:** Verify all optimizations work together without regressions.
- **Implementation:** (1) Run `cargo test` for all Rust tests. (2) Run `vitest run` for all React tests. (3) Run `vite build` to verify the frontend build. (4) Manual smoke test.
- **Test requirements:** All tests pass. No regressions.
- **Demo:** Full test suite green. App builds and runs correctly.

## Implementation Plan

### Phase 1: Rust Performance (Tasks 1-5)
Focus on backend hot paths first since they affect every frontend interaction.

### Phase 2: React Rendering Performance (Tasks 6-8)
Fix the highest-impact rendering bottlenecks: virtualization, memoization, selectors.

### Phase 3: Component Decomposition (Tasks 9-13)
Break large components and stores into smaller, focused units.

### Phase 4: Bundle & Integration (Tasks 14-15)
Optimize bundle size and verify everything works together.

### Relevant Files

**Rust:**
- `src-tauri/src/commands/acp.rs` — ACP protocol, path checking, connection management (2,377 lines)
- `src-tauri/src/commands/fs_ops.rs` — File operations, project file listing (764 lines)
- `src-tauri/src/commands/git.rs` — Git operations via git2 (761 lines)
- `src-tauri/src/commands/pty.rs` — Terminal emulation (135 lines)
- `src-tauri/src/commands/settings.rs` — Config persistence (212 lines)
- `src-tauri/src/commands/error.rs` — Error types (70 lines)
- `src-tauri/src/commands/kiro_config.rs` — .kiro/ config discovery (391 lines)
- `src-tauri/src/lib.rs` — App setup, command registration (249 lines)
- `src-tauri/Cargo.toml` — Dependencies and build profiles

**React — Large components to decompose:**
- `src/renderer/components/settings/SettingsPanel.tsx` (874 lines)
- `src/renderer/components/AppHeader.tsx` (607 lines)
- `src/renderer/components/chat/TerminalDrawer.tsx` (568 lines)
- `src/renderer/components/chat/SlashPanels.tsx` (523 lines)
- `src/renderer/components/chat/BranchSelector.tsx` (500 lines)
- `src/renderer/components/Onboarding.tsx` (480 lines)
- `src/renderer/components/chat/ChatInput.tsx` (429 lines)
- `src/renderer/components/chat/FileMentionPicker.tsx` (420 lines)
- `src/renderer/components/sidebar/KiroConfigPanel.tsx` (418 lines)
- `src/renderer/components/code/DiffViewer.tsx` (418 lines)

**React — Performance-critical files:**
- `src/renderer/components/chat/MessageList.tsx` (143 lines) — needs virtualization
- `src/renderer/components/chat/ChatMarkdown.tsx` (253 lines) — needs memoization fix
- `src/renderer/components/chat/ChatPanel.tsx` (285 lines) — needs selector optimization
- `src/renderer/stores/taskStore.ts` (1,190 lines) — needs slice decomposition

**Build:**
- `vite.config.ts` — Bundle splitting config
- `package.json` — Dependencies

## Commit Convention
Every git commit must include the co-author trailer:
```
Co-authored-by: Kirodex <274876363+kirodex@users.noreply.github.com>
```
Use conventional commit format: `type(scope): description`.
