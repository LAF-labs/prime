# CLAUDE.md — Kirodex

## Project overview

Kirodex is a cross-platform native desktop app (macOS, Windows, Linux) for managing AI coding agents via the Agent Client Protocol (ACP). It features a chat interface with threaded conversations, task management, diff viewer, integrated terminal (ghostty-web), git operations (git2), analytics dashboard (recharts + redb), onboarding wizard, multi-window support, and a full settings panel. Built with Tauri v2 (Rust backend) and React 19 (TypeScript frontend). ~12MB binary, ~0% CPU at idle.

## Tech stack

- **Desktop framework**: Tauri v2 (Rust backend, WebView frontend)
- **Backend**: Rust 2021 edition
- **Frontend**: React 19, TypeScript 5 (strict mode, ES2022 target)
- **Styling**: Tailwind CSS 4 (utility-first, dark theme via `@custom-variant dark`)
- **UI components**: Radix UI primitives (dialog, checkbox, switch, tooltip, scroll-area, label, separator, slot), Tabler icons (`@tabler/icons-react`)
- **State management**: Zustand 5 (stores in `src/renderer/stores/`)
- **Markdown**: react-markdown + remark-gfm
- **Virtualization**: @tanstack/react-virtual
- **Diffing**: diff + @pierre/diffs
- **Terminal**: ghostty-web (WebAssembly terminal emulator) + portable-pty (Rust)
- **Code highlighting**: Shiki via @pierre/diffs (Oniguruma WASM engine), dynamically imported and warmed during `requestIdleCallback` after first paint
- **Analytics**: posthog-js (client telemetry), recharts (charts), redb (Rust ACID-compliant local DB)
- **Toasts**: sonner
- **Slugs**: slugify (worktree branch names)
- **Font**: @fontsource-variable/dm-sans
- **Build**: Vite 6 (via `rolldown-vite` override), Cargo (Rust backend), bun as package manager. Build target: `safari16`. Manual chunks for vendor splitting (analytics, diffs, react, markdown, terminal, tauri, icons)
- **Testing**: Vitest 4 with jsdom, @testing-library/react, v8 coverage
- **Protocol**: agent-client-protocol crate (v0.10.4) for ACP subprocess management with unstable session model, usage, fork, cancel, and message ID features
- **Rust crates**: git2 (libgit2 bindings), thiserror (error types), which (binary detection), confy (config persistence), redb (analytics DB), parking_lot (fast mutexes), imagesize (image dimensions), window-vibrancy, ignore (gitignore-aware file walking), base64, uuid, open, dirs
- **Tauri plugins**: tauri-plugin-store (LazyStore persistence), tauri-plugin-notification (native notifications), tauri-plugin-updater (auto-update), tauri-plugin-process (relaunch), tauri-plugin-log (Rust→WebView log forwarding), tauri-plugin-dialog (folder picker)
- **macOS-specific**: cocoa + objc crates for traffic light repositioning and content view corner radius

## Project structure

```
src/
├── renderer/                # React frontend
│   ├── main.tsx             # React entry (splash screen fade, dark theme init)
│   ├── App.tsx              # Root layout (sidebar + main panel routing)
│   ├── env.d.ts             # Vite env type declarations
│   ├── types/
│   │   ├── index.ts         # Shared types (TaskStatus, AgentTask, ToolCall, etc.)
│   │   └── analytics.ts     # AnalyticsEvent types
│   ├── lib/
│   │   ├── ipc.ts           # Tauri invoke/listen wrappers (~60 commands, ~20 events)
│   │   ├── history-store.ts # LazyStore persistence (tauri-plugin-store) with self-write guard
│   │   ├── timeline.ts      # Timeline rendering logic
│   │   ├── utils.ts         # cn() helper (clsx + tailwind-merge)
│   │   ├── analytics.ts     # PostHog analytics wrapper
│   │   ├── analytics-collector.ts  # Event collection for local analytics
│   │   ├── analytics-aggregators.ts # Chart data aggregation
│   │   ├── fuzzy-search.ts  # Fuzzy matching for pickers
│   │   ├── question-parser.ts # Parse agent question cards
│   │   ├── notifications.ts # Native notification helpers
│   │   ├── theme.ts         # Theme management (dark/light/system)
│   │   ├── sounds.ts        # UI sound effects
│   │   ├── model-icons.tsx  # Model provider SVG icons
│   │   ├── framework-icons.tsx # Framework/language SVG icons
│   │   ├── jsInterceptors.ts # Console/network interceptors for debug panel
│   │   ├── open-external.ts # Open URLs in default browser
│   │   ├── relaunch.ts      # App relaunch helper
│   │   ├── lruCache.ts      # Bounded LRU for highlighted code HTML
│   │   └── diffRendering.ts # Shared theme + hash helpers for Shiki
│   ├── hooks/
│   │   ├── useSidebarTasks.ts    # Sidebar task list with grouping/filtering
│   │   ├── useUpdateChecker.ts   # Auto-update checker (tauri-plugin-updater)
│   │   ├── useChatInput.ts       # Chat input state, submission, slash commands
│   │   ├── useFileMention.ts     # @ file mention picker logic
│   │   ├── useKeyboardShortcuts.ts # Global keyboard shortcuts
│   │   ├── useAttachments.ts     # File/image attachment handling
│   │   ├── useSlashAction.ts     # Client-side slash command handler
│   │   ├── useSessionTracker.ts  # Analytics session tracking
│   │   ├── useProjectIcon.ts     # Auto-detect project icon from files
│   │   ├── useMessageSearch.ts   # Search within chat messages
│   │   └── useResizeHandle.ts    # Draggable panel resize
│   ├── stores/
│   │   ├── taskStore.ts          # Tasks, streaming, connection state (~39KB)
│   │   ├── task-store-types.ts   # TaskStore type definitions
│   │   ├── task-store-listeners.ts # IPC event listener setup for taskStore
│   │   ├── settingsStore.ts      # Agent profiles, models, appearance
│   │   ├── kiroStore.ts          # .kiro/ config state
│   │   ├── diffStore.ts          # Diff viewer state
│   │   ├── debugStore.ts         # Debug panel state (Kiro logs)
│   │   ├── jsDebugStore.ts       # JS console/network debug state
│   │   ├── analyticsStore.ts     # Analytics dashboard state
│   │   └── updateStore.ts        # App update state
│   └── components/
│       ├── ui/              # Radix-based primitives (button, input, dialog, card, badge, etc.)
│       ├── chat/            # ChatPanel, MessageList, ChatInput, SlashPanels, BranchSelector, etc.
│       ├── sidebar/         # TaskSidebar, KiroConfigPanel, IconPickerDialog, WorktreeCleanupDialog
│       ├── code/            # CodePanel, DiffViewer, DiffToolbar, DiffFileSidebar, DebugLog
│       ├── analytics/       # AnalyticsDashboard, chart components (9 chart types)
│       ├── unified-title-bar/ # Cross-platform title bar (macOS/Windows/Linux)
│       ├── settings/        # SettingsPanel with sections (general, appearance, keymap, advanced, etc.)
│       ├── dashboard/       # Dashboard, TaskCard
│       ├── diff/            # DiffPanel
│       ├── debug/           # DebugPanel, JsDebugTab, KiroDebugTab
│       ├── task/            # NewProjectSheet
│       ├── Onboarding.tsx   # First-run onboarding wizard
│       ├── OnboardingWelcomeStep.tsx
│       ├── OnboardingSetupStep.tsx
│       ├── OnboardingCliSection.tsx
│       ├── OnboardingAuthSection.tsx
│       ├── OnboardingThemeStep.tsx
│       ├── onboarding-shared.tsx
│       ├── AppHeader.tsx
│       ├── header-breadcrumb.tsx
│       ├── header-toolbar.tsx
│       ├── header-ghost-toolbar.tsx
│       ├── header-user-menu.tsx
│       ├── GitActionsGroup.tsx
│       ├── OpenInEditorGroup.tsx
│       ├── ErrorBoundary.tsx
│       └── Playground.tsx
src-tauri/
├── src/
│   ├── main.rs              # Entry point
│   ├── lib.rs               # Tauri app setup, command registration, window events, native menu, multi-window, panic hook, shutdown
│   └── commands/
│       ├── mod.rs           # Module declarations (acp, analytics, error, fs_ops, git, kiro_config, pty, settings)
│       ├── acp/             # ACP protocol module (split into submodules)
│       │   ├── mod.rs       # Re-exports, utility functions
│       │   ├── client.rs    # ACP client wrapper
│       │   ├── commands.rs  # Tauri command handlers (~60 commands)
│       │   ├── connection.rs # Connection lifecycle, message handling
│       │   ├── sandbox.rs   # Path sandboxing for permissions
│       │   ├── types.rs     # AcpState, AcpCommand, ConnectionHandle types
│       │   └── tests.rs     # ACP unit tests
│       ├── analytics.rs     # Analytics persistence (redb ACID-compliant DB)
│       ├── error.rs         # Shared AppError type (thiserror)
│       ├── pty.rs           # Terminal emulation (portable-pty)
│       ├── git.rs           # Git operations via git2 (libgit2) — branches, worktrees, stage, commit, push, pull
│       ├── settings.rs      # Config persistence via confy, recent projects
│       ├── fs_ops.rs        # File ops, kiro-cli detection (which crate), editor detection, project file listing
│       └── kiro_config.rs   # .kiro/ config discovery (serde_yaml for frontmatter)
├── Cargo.toml
├── tauri.conf.json
├── tauri.ci.conf.json       # CI-specific Tauri config overrides
├── Kirodex.entitlements     # macOS entitlements
├── Info.plist               # macOS Info.plist
├── capabilities/            # Tauri v2 permission capabilities
├── icons/                   # App icons (prod + dev variants)
└── apps/                    # Bundled app resources
scripts/
├── bump-version.sh          # Version bump across package.json, Cargo.toml, tauri.conf.json
├── release.sh               # Tag + push release workflow
└── generate-notes.sh        # Generate changelog from git log
website/                     # Static marketing website (separate bun project)
docs/
├── architecture.md          # System diagram, backend module reference
├── ipc-reference.md         # Full IPC command/event reference
├── slash-commands.md         # Slash command documentation
├── keyboard-shortcuts.md     # Keyboard shortcut reference
└── pr-guidelines.md         # PR review guidelines
```

## Commands

```bash
# Development
bun run dev               # Start dev (Vite + Tauri)
bun run dev:renderer      # Start Vite dev server only (no Rust)

# Build
bun run build             # Production build (.app / .dmg / .exe / .deb)
bun run build:rust        # Cargo build (debug)
bun run build:rust:release # Cargo build (release, stripped + LTO)
bun run package           # Alias for `cargo tauri build`

# Type checking
bun run check             # Run both check:ts and check:rust
bun run check:ts          # TypeScript type check (tsc --noEmit)
bun run check:rust        # Rust type check (cargo check)
bun run check:web         # TypeScript check + Vite build

# Testing
bun run test              # Run all tests (Vitest + cargo test)
bun run test:ui           # Vitest (frontend tests only)
bun run test:rust         # Rust tests only (cargo test)
bun run test:coverage     # Vitest with v8 coverage report

# Versioning
bun run bump              # Interactive version bump
bun run bump:patch        # Bump patch (0.7.0 → 0.7.1)
bun run bump:minor        # Bump minor (0.7.0 → 0.8.0)
bun run bump:major        # Bump major (0.7.0 → 1.0.0)
bun run release           # Tag + push (triggers CI release)

# Website
bun run website:dev       # Dev server for marketing website
bun run website:build     # Build website
bun run website:preview   # Build + open website

# Cleanup
bun run clean             # Remove dist/ and cargo clean
```

## Architecture decisions

- **Tauri IPC**: All frontend↔backend communication uses `invoke()` for commands and `listen()` for events. No direct Node.js APIs. The `ipc.ts` wrapper provides typed functions for all ~60 commands and ~20 event listeners.
- **ACP on dedicated OS threads**: The ACP Rust SDK uses `!Send` futures, so each connection runs on a dedicated OS thread with a single-threaded tokio runtime + `LocalSet`. Communication with the Tauri async runtime happens via `mpsc` channels.
- **ACP module split**: The ACP code is split into `acp/{mod.rs, client.rs, commands.rs, connection.rs, sandbox.rs, types.rs, tests.rs}` for maintainability. `commands.rs` holds Tauri command handlers, `connection.rs` manages lifecycle, `sandbox.rs` handles path permission validation, `client.rs` wraps the SDK client.
- **Permission handling**: Permission requests from ACP go through a `oneshot` channel. The permission handler runs on the Tauri async runtime and accesses managed state via `app.try_state::<AcpState>()`, not a cloned copy.
- **State**: Zustand stores are the single source of truth. No Redux, no Context for global state. The taskStore is the largest (~39KB) with extracted types (`task-store-types.ts`) and IPC listeners (`task-store-listeners.ts`).
- **Persistence**: `tauri-plugin-store` (LazyStore) persists tasks, projects, and soft-deleted threads. A self-write guard (`_selfWriteCount`) prevents reload loops from autoSave-triggered `onKeyChange` events.
- **Analytics pipeline**: Frontend collects events via `analytics-collector.ts`, aggregates via `analytics-aggregators.ts`, and renders via recharts. Backend persists events in a redb database (`analytics.rs`) with ACID guarantees.
- **Multi-window**: `lib.rs` supports creating new windows via `create_new_window()` with per-platform configuration (macOS traffic lights, corner radius).
- **Native menu**: `build_app_menu()` creates File menu with New Window, New Thread, New Project, and a dynamic Recent Projects submenu populated from `SettingsState`.
- **Styling**: Tailwind utility classes only. No custom CSS files for components. Theme tokens in `src/tailwind.css` using CSS custom properties under `:root` and `.dark`. Uses `@custom-variant dark (&:is(.dark, .dark *))` for dark mode.
- **Components**: Radix UI primitives with `class-variance-authority` for variants, `clsx` + `tailwind-merge` via `cn()` helper.
- **Cross-platform title bar**: `unified-title-bar/` provides platform-specific title bars (macOS traffic lights, Windows controls, Linux fallback).
- **Onboarding**: Multi-step wizard (Welcome → Setup → CLI detection → Auth → Theme) for first-run experience.
- **Path aliases**: `@/*` maps to `./src/renderer/*` (configured in tsconfig.json and vite.config.ts).
- **Vite config**: Manual chunks split vendor code (analytics, diffs, react, markdown, shiki, terminal, tauri, icons); the `vendor-shiki` chunk is lazy-loaded by `ChatMarkdown` on first code block. Dev server on port 5174. Watch ignores README.md, activity.md, and src-tauri/.
- **CI pipeline**: 3-stage sequential pipeline (check → test-ui → test-rust) with PR comment bot summarizing results. Runs on ubuntu-latest with system deps for WebKit.

## Conventions

- Use `const` arrow functions for components and handlers
- Prefix event handlers with `handle` (e.g., `handleClick`, `handleKeyDown`)
- Prefix boolean variables with verbs (`isLoading`, `hasError`, `canSubmit`)
- Use kebab-case for file names, PascalCase for components, camelCase for variables/functions
- One export per file for components
- Early returns for readability
- Accessibility: semantic HTML, ARIA attributes, keyboard navigation
- Icons: use `@tabler/icons-react` exclusively. Never use `lucide-react`. Tabler icons use the `Icon` prefix (e.g., `IconPlus`, `IconCheck`, `IconChevronDown`).
- Conventional Commits for git messages (`feat:`, `fix:`, `chore:`, etc.)
- Every commit must include: `Co-authored-by: Kirodex <274876363+kirodex@users.noreply.github.com>`

## Build validation

A task is not done until both pass with zero errors:

```bash
bun run check:ts
bun run build         # or: npx vite build
```

For frontend-only changes, also run:
```bash
bun run test:ui       # Vitest frontend tests
```

## Critical rules

- Never revert, discard, or `git checkout --` changes without explicit user confirmation
- Never run destructive git operations without being told to
- Always use Tailwind classes for styling; no inline CSS or `<style>` tags
- Keep the activity log updated in `activity.md`

---

## Engineering learnings

### Tauri + ACP concurrency model

The `agent-client-protocol` crate produces `!Send` futures. You cannot run them on the default multi-threaded tokio runtime. The solution: spawn a `std::thread` per ACP connection, create a `tokio::runtime::Builder::new_current_thread()` runtime inside it, and use `tokio::task::LocalSet::block_on()`. Commands from the Tauri async runtime reach the connection thread via `mpsc::unbounded_channel`. This pattern is stable and avoids all `Send` bound issues.

### Permission resolvers must use managed Tauri state

Early versions cloned the `AcpState` into the permission handler closure. This created a second copy; when `task_allow_permission` / `task_deny_permission` commands looked up the resolver in the managed state, it wasn't there. Fix: the permission handler accesses state via `app.try_state::<AcpState>()` so it reads/writes the same instance the Tauri commands use.

### ACP notifications need method normalization

The ACP SDK sometimes prefixes ext_notification methods with an underscore (e.g., `_kiro.dev/commands/available`). Always strip the leading `_` before matching: `method.strip_prefix('_').unwrap_or(method)`.

### Backend task updates wipe client-side messages

The ACP backend sends `task_update` events with `messages: []` because it doesn't track message history; only the client does. If `upsertTask()` does a full object replacement, every status change wipes all locally-accumulated messages. Fix: preserve existing messages when the incoming task has an empty messages array.

### Zustand store performance patterns

- **Bail-out guards**: Every setter should check if the value actually changed before calling `set()`. Without this, every ACP event triggers a React re-render even when nothing changed.
- **Batch multi-field updates**: Use a single `setState` callback instead of multiple `getState()` + `set()` calls. Multiple `getState()` calls can read stale data between them.
- **rAF batching for high-frequency events**: Debug log entries and streaming chunks arrive at hundreds per second. Buffer them and flush once per `requestAnimationFrame` using `concat + slice` instead of per-entry array copies.
- **Extract streaming selectors**: The ChatPanel was re-rendering on every streaming token. Extracting a `StreamingMessageList` child component that owns the four streaming selectors (`streamingChunk`, `liveToolCalls`, `liveThinking`, `messages`) isolates re-renders to the child only.

### Dead code traps in component wiring

Adding logic to a component file that is never imported is a silent failure. The `DiffPanel.tsx` had `focusFile` logic but was dead code; the actual panel used `CodePanel` → `DiffViewer`. Always verify the import chain before adding features to a component.

### Slash commands: client-side vs pass-through

Some slash commands (`/clear`, `/model`, `/agent`) are handled entirely on the client. Others (`/plan`, `/chat`) need both a client-side action (mode switch, system message) and a backend sync (`ipc.setMode()`). The `useSlashAction` hook returns `{ handled: boolean }` so the caller knows whether to send the command to ACP.

### Forward all ACP notification data

The `commands/available` notification includes `mcpServers` with live `toolCount` and `status`, but the Rust backend initially only forwarded the `commands` array. Always forward the full notification payload (or at least all fields the frontend needs) rather than cherry-picking.

### Window cleanup on close

Tauri's `on_window_event` with `CloseRequested` is the place to kill ACP connections and PTY sessions. Drain the connections map and send `AcpCommand::Kill` to each, then clear the PTY state. Without this, orphaned `kiro-cli` processes survive after the app closes.

### probe_capabilities guard

`probe_capabilities` (which calls `list_models`) can be triggered multiple times during startup. Without an `AtomicBool` guard (`probe_running`), concurrent calls spawn duplicate ACP connections. Use `compare_exchange` to ensure only one probe runs at a time.

### Vite watch ignores

Add `README.md`, `activity.md`, and `src-tauri/**` to Vite's `server.watch.ignored` list. Otherwise, editing docs or Rust files triggers unnecessary frontend rebuilds.

### Tauri v2 state management

Always use `app.manage()` for shared state and access via `State<'_, T>` in commands. Never clone state into closures when the state needs to be shared across commands; use `app.try_state::<T>()` from the app handle instead.

### Rust error handling in Tauri commands

Tauri commands return `Result<T, AppError>` where `AppError` is a `thiserror` enum in `commands/error.rs`. It has `From` impls for `git2::Error`, `io::Error`, `serde_json::Error`, `confy::ConfyError`, and `PoisonError`, so `?` works directly. `AppError` implements `Serialize` for Tauri IPC. Exception: `acp.rs` still uses `Result<T, String>` because the ACP SDK's own error types and `!Send` async constraints make conversion impractical.

### Prefer community crates over shelling out

Use `git2` instead of `Command::new("git")` for git operations. Use `which::which()` instead of `Command::new("which")`. Use `confy` instead of hand-rolled JSON persistence. Use `serde_yaml` instead of string matching for YAML frontmatter. Shelling out is fragile (PATH dependency), slow (process spawn), and loses structured error info.

### React 19 + Zustand selector discipline

Always use selectors (`useStore(s => s.field)`) instead of `useStore()` to prevent full-store re-renders. For derived state, use `useMemo` over computing in render. Combine with `shallow` equality when selecting multiple fields.

### localStorage in Zustand store init

`localStorage.getItem()` and `setItem()` throw in private browsing, incognito, or quota-exceeded contexts. Always wrap in try-catch. For store init, use an IIFE: `(() => { try { return localStorage.getItem(key) } catch { return null } })()`. For setters, wrap in try-catch with `console.warn` fallback so the in-memory state still updates even if persistence fails.

### Module-level mutable variables in React hooks

A `let pendingUpdate` at module scope persists across component remounts and can reference a stale object from a previous mount. Use `useRef` instead to tie the mutable reference to the component instance lifecycle. This prevents version mismatches when the hook unmounts and remounts.

### import type for dynamically-imported modules

When a module is dynamically imported at runtime (`await import('@tauri-apps/plugin-updater')`) but you need its types at compile time for a `useRef<Update | null>`, use `import type { Update }` to avoid bundling the module eagerly while still getting type safety.

### IPC event cleanup

Always return the unlisten function from `listen()` calls inside `useEffect` cleanup. Leaked listeners cause memory leaks and duplicate event handling. Pattern: `const unlisten = await listen(...); return () => { unlisten(); };`

### PTY process lifecycle

Always kill PTY child processes on window close and on connection teardown. Check `child.try_wait()` before sending signals to avoid signaling already-dead processes. Clean up the reader thread when the PTY is destroyed.

### Git command injection prevention

When building git commands from user input (branch names, commit messages), validate and sanitize inputs. Never interpolate raw user strings into shell commands. Use `Command::arg()` instead of shell string concatenation to avoid injection. With `git2`, this is no longer a concern since the library API handles escaping.

### Tauri CSP blocks inline scripts

Tauri's CSP (`script-src 'self'`) blocks inline `onclick` handlers and `<script>` tags in HTML. Attach event listeners via bundled JS (`addEventListener`) instead. The `index.html` error fallback reload button must use this pattern.

### oklch() CSS colors fail in older WebKit

Tauri's WebKit webview may not support `oklch()` color syntax. When it fails, the browser renders bright magenta/pink (the "invalid value" fallback). Use hex color values for CSS custom properties instead.

### Dark theme class must be applied before React renders

If the app uses a `.dark` CSS class for theme variables, add `class="dark"` to `<html>` in `index.html` AND set it in `main.tsx` before `ReactDOM.createRoot()`. Without both, there's a white flash or the app renders in light mode.

### Splash screen pattern for Tauri

Add a `#splash` div in `index.html` (pure HTML/CSS, no JS dependency) that shows immediately when the window opens. In `main.tsx`, after React renders, fade it out with `opacity: 0` transition and remove on `transitionend`. This gives instant visual feedback while the JS bundle loads.

### Cancel tasks before deleting them

When deleting a thread or removing a project, call `ipc.cancelTask()` before `ipc.deleteTask()` to stop any running agent. The cancel is fire-and-forget with `.catch(() => {})` so it's a no-op for already-stopped tasks.

### confy changes the config file location

`confy` stores config at its own XDG/macOS-standard path (e.g., `~/Library/Application Support/rs.kirodex/default-config.toml` on macOS), not the previous custom path. If migrating from hand-rolled persistence, existing settings at the old path won't be found. Consider a one-time migration or document the new location.

### upsertTask must preserve client-side name

The ACP backend sends `task_update` events carrying the original creation-time name. If `upsertTask` spreads the backend object as the base, every status change overwrites user renames. Fix: when the task already exists locally, always keep the client-side `name`. This follows the same pattern used for `messages` and `parentTaskId` preservation.

### Soft-deleted threads reappear after app restart

`loadTasks` builds the task map from `listTasks()` ACP responses. If `deletedTaskIds` isn't populated from persisted soft-deleted thread IDs before `upsertTask` runs, deleted threads get re-added. Fix: populate `deletedTaskIds` from persisted storage first, then filter them out of the task map during `loadTasks`.

### `bun test` vs `bun run test` runner mismatch

`bun test` invokes Bun's native test runner, which doesn't provide jsdom. `bun run test` invokes Vitest (configured with jsdom). Running `bun test` causes all component tests to fail with `ReferenceError: document is not defined`. Fix: add `bunfig.toml` with `[test] root = ".bun-test-noop"` to redirect Bun's native runner away from Vitest test files.

### Clean up orphaned worktrees on setup failure

If `gitWorktreeSetup` fails after the worktree directory was partially created, the orphaned directory remains on disk. Any component that calls worktree setup must catch the error and call `gitWorktreeRemove` to clean up. This applies to both `PendingChat` and `WorktreePanel`.

### Stamp context on debug entries at creation time

Debug entries (JS console, network, Rust logs) should capture `threadName` and `projectName` from the active task at creation time, not look them up from the task store at render time. Tasks can be deleted or archived after the entry was created, making render-time lookups return nothing and breaking filter functionality.

### tauri-plugin-log for Rust-to-WebView log forwarding

Use `tauri-plugin-log` with `LogTarget::Webview` to forward Rust `log::info!()` / `log::error!()` calls to the frontend JS context. Requires adding `log:default` to the Tauri capabilities file. The frontend listens via the plugin's `onEvent` API and can display Rust logs alongside JS console output.

### GitHub Markdown strips block elements inside `<p>` tags

Block-level HTML elements (`<table>`, `<div>`, `<pre>`) nested inside `<p>` tags are invalid HTML. GitHub's Markdown renderer strips them, hiding the content. Always place block-level elements outside `<p>` tags in README and other GitHub-rendered Markdown files.

## Activity log

After completing any task, update `activity.md` at the project root before finishing.

Each entry must include:
- A timestamp heading in Dubai time: `## YYYY-MM-DD HH:MM GST (Dubai)`
- A short descriptive title: `### Component: What changed`
- A one to three sentence summary of what was done
- A `**Modified:**` line listing changed files

Prepend new entries to the top of the file. Create the file if it doesn't exist.
