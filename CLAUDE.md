# CLAUDE.md — LAF Agent

## Project overview

LAF Agent is a native desktop client for the **prime-agent** coding agent
(`PrimeIntellect-ai/prime-agent`, MIT). It drives the agent over prime-agent's
own RPC protocol — newline-delimited JSON over stdin/stdout — and ships the
agent runtime inside the app bundle, so a DMG install works with no CLI setup.

The UI is a chat client with threaded conversations, a diff viewer, an
integrated terminal, git operations, a local analytics dashboard, an onboarding
wizard, multi-window support, and a full settings panel. macOS is the shipping
platform; the Windows and Linux bundle targets build but are not exercised.

Built with Tauri v2 (Rust backend) and React 19 (TypeScript frontend). The
release DMG is ~76 MB, most of which is the bundled Node runtime and `uv`.

## Tech stack

- **Desktop framework**: Tauri v2 (Rust backend, WebView frontend)
- **Backend**: Rust 2021 edition
- **Frontend**: React 19, TypeScript 5 (strict mode, ES2022 target)
- **Styling**: Tailwind CSS 4 (utility-first, dark theme via `@custom-variant dark`)
- **UI components**: Radix UI primitives, Tabler icons (`@tabler/icons-react`)
- **State management**: Zustand 5 (stores in `src/renderer/stores/`)
- **i18n**: hand-rolled, gettext-style — English source strings are the keys
  (`src/renderer/lib/i18n.ts`, Korean dictionary in `i18n-ko.ts`)
- **Markdown**: react-markdown + remark-gfm
- **Virtualization**: @tanstack/react-virtual
- **Diffing**: diff + @pierre/diffs
- **Terminal**: ghostty-web (WebAssembly) + portable-pty (Rust)
- **Code highlighting**: Shiki via @pierre/diffs, lazily imported
- **Analytics**: local only — recharts for charts, redb for storage. Nothing
  leaves the machine, and there is no telemetry client.
- **Build**: Vite 6 (via `rolldown-vite`), Cargo, bun as package manager.
  Build target `safari16`; manual vendor chunks.
- **Testing**: Vitest 4 with jsdom, @testing-library/react, v8 coverage
- **Agent**: prime-agent 0.7.0, bundled under `src-tauri/resources/prime-agent/`
- **Rust crates**: git2, thiserror, which, confy, redb, rusqlite, parking_lot,
  reqwest, notify, ignore, nucleo-matcher, imara-diff, pulldown-cmark,
  imagesize, window-vibrancy, glob, base64, uuid, open, dirs, libc
- **Tauri plugins**: store, notification, updater, process, log, dialog
- **macOS-specific**: cocoa + objc for traffic-light repositioning and content
  view corner radius

## Project structure

```
src/
├── renderer/                # React frontend
│   ├── main.tsx             # React entry (splash fade, theme init)
│   ├── App.tsx              # Root layout (sidebar + main panel routing)
│   ├── types/               # Shared types + analytics event shapes
│   ├── lib/
│   │   ├── ipc.ts           # Tauri invoke/listen wrappers — the whole IPC surface
│   │   ├── agent-commands.ts # THE slash-command registry (session/rpc/gui)
│   │   ├── i18n.ts          # t() + useT(); i18n-ko.ts holds the Korean dictionary
│   │   ├── provider-catalog.ts # Built-in and OpenAI-compatible providers
│   │   ├── history-store.ts # LazyStore persistence with a self-write guard
│   │   ├── timeline.ts      # Timeline rendering logic
│   │   ├── analytics-collector.ts / analytics-aggregators.ts
│   │   └── … (theme, sounds, fuzzy search, notifications, icons, …)
│   ├── hooks/               # useChatInput, useSlashAction, useFileMention, …
│   ├── stores/              # taskStore (largest), settingsStore, resourceStore,
│   │                        # diffStore, debugStore, analyticsStore, updateStore
│   └── components/
│       ├── ui/              # Radix-based primitives
│       ├── chat/            # ChatPanel, MessageList, ChatInput, pickers
│       ├── sidebar/         # TaskSidebar, ResourcePanel, dialogs
│       ├── code/            # CodePanel, DiffViewer
│       ├── analytics/       # Dashboard + chart components
│       ├── settings/        # SettingsPanel and its sections
│       ├── unified-title-bar/ # Per-platform title bar
│       ├── Onboarding*.tsx  # First-run wizard (welcome → theme → setup)
│       └── … (header, dialogs, error boundary)
src-tauri/
├── src/
│   ├── main.rs              # Entry point
│   ├── lib.rs               # App setup, ~167 command registrations, window
│   │                        # events, native menu, panic hook, shutdown
│   └── commands/
│       ├── rpc/             # prime-agent RPC client
│       │   ├── mod.rs       # Re-exports and helpers
│       │   ├── commands.rs  # Tauri command handlers, incl. agent_rpc_request
│       │   ├── connection.rs # Process lifecycle + event translation
│       │   ├── types.rs     # AgentState, AgentCommand, SessionMode, …
│       │   └── tests.rs     # Event-translation unit tests
│       ├── agent_launch.rs  # Resolve how to launch the agent + its PATH
│       ├── kernel_setup.rs  # Provision the Python kernel with the bundled uv
│       ├── provider_discovery.rs # Probe /models for a user-supplied key
│       ├── fs_ops.rs        # File ops, agent detection, auth.json management
│       ├── agent_resources.rs / resource_watcher.rs  # .agent/ discovery
│       ├── git*.rs          # git2-backed operations (branches, worktrees,
│       │                    # stack, PRs, history, diff stats, AI text)
│       ├── analytics.rs     # Local usage stats (redb)
│       ├── thread_db.rs     # Thread persistence (redb)
│       ├── pty.rs           # Terminal emulation (portable-pty)
│       ├── settings.rs      # Config persistence (confy) + recent projects
│       ├── checkpoint.rs    # Turn checkpoints
│       ├── markdown.rs      # Server-side markdown parsing
│       └── error.rs         # Shared AppError (thiserror)
├── resources/
│   ├── prime-agent/         # Bundled runtime: node, uv, dist/, node_modules/
│   └── laf-agent-gate.ts    # Bundled extension: permission gate, sandbox,
│                            # parity commands, native web search, web_fetch
├── tauri.conf.json
└── capabilities/            # Tauri v2 permissions
scripts/
├── build-sidecar.sh         # Rebuild src-tauri/resources/prime-agent
├── bump-version.sh, release.sh, generate-notes.sh
docs/                        # architecture, ipc-reference, slash-commands,
                             # sidecar-architecture, development, …
```

## Commands

```bash
# Development
bun run dev               # Start dev (Vite + Tauri)
bun run dev:renderer      # Vite dev server only (no Rust)

# Build
bun run build             # Production build (.app / .dmg / .exe / .deb)
bun run build:rust        # Cargo build (debug)
bun run build:rust:release # Cargo build (release, stripped + LTO)

# Type checking
bun run check             # check:ts + check:rust
bun run check:ts          # tsc --noEmit
bun run check:rust        # cargo check

# Testing
bun run test              # Vitest + cargo test
bun run test:ui           # Frontend tests only
bun run test:rust         # Rust tests only
bun run test:coverage     # Vitest with v8 coverage

# Versioning
bun run bump[:patch|:minor|:major]
bun run release           # Tag + push (triggers CI release)

# Cleanup
bun run clean
```

## Architecture decisions

- **Transport**: `prime-agent --mode rpc` speaks JSONL over stdio, LF-delimited,
  with an `id` field correlating requests to responses. `rpc/connection.rs`
  translates the agent's events into the Tauri events the renderer already
  consumed, so the UI layer did not change when the backend was swapped.
- **No `!Send` gymnastics**: the RPC client is plain `tokio::spawn` on the
  multi-threaded runtime. (An earlier ACP-based backend needed a dedicated OS
  thread with a `LocalSet` per connection; that constraint is gone. Do not
  reintroduce it.)
- **One generic RPC bridge**: `agent_rpc_request(task_id, command, params)`
  forwards any prime-agent RPC method and awaits its `data`. Prefer it over
  adding a new typed Tauri command per feature.
- **Permission approval rides the extension UI protocol**: the bundled gate
  extension (`resources/laf-agent-gate.ts`) intercepts tool calls and raises a
  `select` dialog, which arrives as an `extension_ui_request` line. The user's
  decision goes back as `extension_ui_response`.
- **Slash commands have one registry**: `lib/agent-commands.ts`. It documents
  the three kinds (session / rpc / gui) and, importantly, which CLI commands are
  deliberately absent because they are TUI-only with no RPC method behind them.
  `get_commands` supplies extensions, prompt templates, and skills at runtime —
  never the agent's built-ins.
- **The agent runtime is bundled**: `agent_launch::resolve()` prefers an explicit
  user path, then the sidecar (`<resources>/prime-agent/node dist/bundle/cli.js`),
  then PATH. Every spawn site must use `agent_launch::agent_path_env()` so the
  bundled `uv` wins over any system copy. See `docs/sidecar-architecture.md`.
- **State**: Zustand stores are the single source of truth. No Redux, no Context
  for global state.
- **Persistence**: `tauri-plugin-store` (LazyStore) for tasks, projects, and
  soft-deleted threads; redb for analytics and thread bodies. A self-write guard
  (`_selfWriteCount`) prevents reload loops from autoSave-triggered events.
- **Analytics are local**: `analytics-collector.ts` buffers events, flushes to
  redb via IPC, and the dashboard reads them back. There is no remote endpoint
  and no telemetry client — do not add one without asking.
- **Styling**: Tailwind utility classes only. Theme tokens in
  `src/tailwind.css` under `:root` and `.dark`.
- **Path aliases**: `@/*` → `./src/renderer/*` (tsconfig + vite.config).

## Conventions

- Use `const` arrow functions for components and handlers
- Prefix event handlers with `handle`; booleans with a verb (`isLoading`)
- kebab-case file names, PascalCase components, camelCase values
- One export per file for components
- Early returns for readability
- Accessibility: semantic HTML, ARIA attributes, keyboard navigation
- Icons: `@tabler/icons-react` only, never `lucide-react`
- **User-facing strings go through `t()`** from `@/lib/i18n`, with the English
  text as the argument. Add the Korean entry in `i18n-ko.ts` in the same change.
- Conventional Commits (`feat:`, `fix:`, `chore:`, …)
- Every commit includes:
  `Co-authored-by: LAF Agent <274876363+laf-agent@users.noreply.github.com>`

## Build validation

A task is not done until these pass with zero errors:

```bash
bun run check:ts
bun run test:ui
cargo test --lib --manifest-path src-tauri/Cargo.toml
```

Run `bun run build` before shipping a release.

## Critical rules

- Never revert, discard, or `git checkout --` changes without explicit user
  confirmation
- Never run destructive git operations without being told to
- Always use Tailwind classes; no inline CSS or `<style>` tags
- Keep the activity log updated in `activity.md`

---

## Engineering learnings

### The IPC surface must stay symmetric

`lib/ipc.ts` and the `generate_handler!` list in `lib.rs` are two halves of one
contract, and nothing type-checks across the boundary. A wrapper whose command
is not registered fails only at runtime, and a module that is not declared in
`commands/mod.rs` does not even compile. Both drifted before. To check:

```bash
grep -ohE "invoke(<[^>]*>)?\('[a-z_0-9]+'" src/renderer/lib/ipc.ts | sed "s/.*('//;s/'//" | sort -u
```

and compare against the handler list.

### Permission resolvers must use managed Tauri state

An early version cloned `AgentState` into the permission handler closure, so
`task_allow_permission` looked up a resolver that lived in a different copy. The
handler must reach state via `app.try_state::<AgentState>()`.

### Notification methods need normalization

prime-agent sometimes prefixes ext_notification methods with an underscore.
Strip it before matching: `method.strip_prefix('_').unwrap_or(method)`.

### Backend task updates wipe client-side messages

`task_update` events carry `messages: []` because the backend does not track
history — only the client does. `upsertTask()` must preserve existing messages,
the client-side `name`, and `parentTaskId` when the incoming task omits them.

### Zustand store performance patterns

- **Bail-out guards**: every setter should check whether the value actually
  changed before calling `set()`.
- **Batch multi-field updates** in a single `setState` callback; separate
  `getState()` calls can read stale data between them.
- **rAF batching** for high-frequency events (debug entries, streaming chunks):
  buffer and flush once per frame with `concat + slice`.
- **Extract streaming selectors** into a child component so token streaming
  re-renders only that child.

### Dead code traps in component wiring

Adding logic to a file nothing imports is a silent failure. Verify the import
chain before adding a feature to a component.

### Slash commands: client-side vs pass-through

`useSlashAction` returns whether it handled the input. Session commands
(`/goal`, `/autonomous`, `/compact`, `/refine`) must fall through untouched —
`AgentSession` executes them on any transport, so a plain `prompt` reproduces
the CLI exactly. The same is true of extension commands and `/skill:` expansion.
An unrecognized `/foo`, by contrast, is sent to the model as literal text, so
never list a command the app cannot actually run.

### Forward all notification data

The `commands/available` notification carries `mcpServers` with live counts and
status. Forward whole payloads rather than cherry-picking fields.

### Window cleanup on close

`on_window_event` with `CloseRequested` is where agent connections and PTY
sessions get killed. Drain the connections map, send `AgentCommand::Kill`, and
clear PTY state — otherwise orphaned processes survive the app.

### probe_capabilities guard

`probe_capabilities` can fire several times during startup. An `AtomicBool`
(`probe_running`, via `compare_exchange`) keeps it from spawning duplicate
connections.

### Vite watch ignores

Keep `README.md`, `activity.md`, and `src-tauri/**` in `server.watch.ignored`,
or editing docs or Rust triggers pointless frontend rebuilds.

### Rust error handling in Tauri commands

Commands return `Result<T, AppError>`; `AppError` is a `thiserror` enum in
`commands/error.rs` with `From` impls for `git2::Error`, `io::Error`,
`serde_json::Error`, `confy::ConfyError`, and `PoisonError`, so `?` works.
The RPC module still uses `Result<T, String>` where errors come back as JSON.

### Prefer community crates over shelling out

`git2` over `Command::new("git")`, `which::which()` over `which`, `confy` over
hand-rolled JSON. Shelling out is PATH-dependent, slow, and loses error detail.

### React 19 + Zustand selector discipline

Always select (`useStore(s => s.field)`) rather than subscribing to the whole
store. Use `useMemo` for derived state and `shallow` when selecting several
fields.

### localStorage throws

`getItem`/`setItem` throw in private browsing and on quota errors. Wrap both.
For store init use an IIFE with try/catch; for setters, warn and keep the
in-memory update.

### Module-level mutable variables in React hooks

A `let` at module scope survives remounts and can reference a stale object from
a previous mount. Use `useRef` so the lifetime matches the component.

### `import type` for dynamically-imported modules

When a module is loaded at runtime (`await import('@tauri-apps/plugin-updater')`)
but its types are needed at compile time, use `import type` so it is not
bundled eagerly.

### IPC event cleanup

Return the unlisten function from `listen()` in the `useEffect` cleanup. Leaked
listeners double-handle events.

### PTY process lifecycle

Kill PTY children on window close and connection teardown. Check
`child.try_wait()` before signalling, and clean up the reader thread.

### Tauri CSP blocks inline scripts and remote hosts

`script-src 'self'` blocks inline `onclick` and `<script>` tags — attach
listeners from bundled JS. `connect-src 'self' ipc: http://ipc.localhost` blocks
every outbound request from the renderer, which is why any network work belongs
in Rust or in the agent.

### `oklch()` CSS colors fail in older WebKit

Tauri's WebView may render `oklch()` as bright magenta. Use hex values for CSS
custom properties.

### Dark theme class must be applied before React renders

Set `class="dark"` on `<html>` in `index.html` *and* in `main.tsx` before
`createRoot()`, or the app flashes white.

### Splash screen pattern

A `#splash` div in `index.html` (pure HTML/CSS) shows instantly; `main.tsx`
fades it out after the first render.

### Cancel tasks before deleting them

Call `ipc.cancelTask()` before `ipc.deleteTask()` so a running agent stops. It
is fire-and-forget with `.catch(() => {})`.

### confy owns the config file location

Config lives at confy's platform path
(`~/Library/Application Support/rs.laf-agent/default-config.toml` on macOS),
not a custom one.

### Soft-deleted threads reappear after restart

`loadTasks` rebuilds the task map from `listTasks()`. Populate `deletedTaskIds`
from persisted storage *before* `upsertTask` runs, then filter.

### `bun test` vs `bun run test`

`bun test` uses Bun's native runner, which has no jsdom, and every component
test fails with `document is not defined`. `bunfig.toml` redirects it; always
use `bun run test`.

### Clean up orphaned worktrees on setup failure

If `gitWorktreeSetup` fails after creating the directory, the caller must catch
and call `gitWorktreeRemove`.

### Stamp context on debug entries at creation time

Capture `threadName` and `projectName` when the entry is created, not at render.
Tasks can be deleted afterwards, which breaks render-time lookups.

### GitHub Markdown strips block elements inside `<p>`

Keep `<table>`, `<div>`, and `<pre>` outside `<p>` in README and other
GitHub-rendered files, or the content vanishes.

## Activity log

After completing any task, prepend an entry to `activity.md`. The file is
gitignored on purpose — it is a local working log, not repo history, so never
try to commit it. Each entry has:

- Timestamp heading in Dubai time: `## YYYY-MM-DD HH:MM GST (Dubai)`
- Short title: `### Component: What changed`
- One to three sentences on what was done
- A `**Modified:**` line listing changed files
