# Slash commands

Type `/` in the chat input to open the command palette. Matching is fuzzy over
both the command name and its description.

Commands reach the agent three different ways. The registry that decides which
is which — and the single place to add a command — is
[`src/renderer/lib/agent-commands.ts`](../src/renderer/lib/agent-commands.ts).

## Session commands

The agent session executes these itself on every transport, so LAF Agent sends
them through untouched and the behavior is identical to the prime-agent CLI.

| Command | Arguments | What it does |
|---|---|---|
| `/goal` | `[--budget <tokens>] <objective>` \| `status` \| `pause` \| `resume` \| `clear` | Set a persistent objective the agent pursues across turns |
| `/autonomous` | `on` \| `off` \| `status` | Keep working through quality gates without asking |
| `/compact` | `[instructions]` | Compact the conversation context now |
| `/refine` | `[instructions]` | Apply an evidence-backed refinement to the agent harness |

## RPC commands

Backed by a typed prime-agent RPC method, routed through `agent_rpc_request`.

| Command | Arguments | What it does |
|---|---|---|
| `/clone` | — | Duplicate this conversation into a new thread |
| `/copy` | — | Copy the last assistant reply to the clipboard |
| `/export` | `[path]` | Export this session to an HTML file |
| `/name`, `/rename` | `<name>` | Set the session display name |
| `/session` | — | Show session stats (tokens, cost, context) |
| `/context` | — | Show token, cost, and context usage |
| `/thinking`, `/effort` | `off` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` | Set reasoning effort |
| `/heartbeat` | `status` \| `pause` \| `resume` \| `clear` \| `<schedule> -- <prompt>` | Schedule a recurring nudge |

## GUI commands

Handled entirely in the app by `useSlashAction`. The first group is native to a
desktop client; the second keeps the CLI's name for something the app already
had, so muscle memory carries over.

| Command | What it does |
|---|---|
| `/new` | Start a new thread in this project |
| `/clear` | Clear the current conversation |
| `/close`, `/exit` | Close and archive the current thread |
| `/fork` | Fork this thread into a new conversation |
| `/btw`, `/tangent` | Ask a side question without adding it to the session |
| `/model` | Switch the active model (inline picker) |
| `/agent` | Switch between agents (inline picker) |
| `/plan` | Toggle plan mode |
| `/upload` | Attach images or files |
| `/branch` | Create and check out a git branch |
| `/worktree` | Create a worktree and a thread inside it |
| `/settings` | Open settings |
| `/login`, `/logout` | Open provider authentication settings |
| `/mcp` | Expand MCP connections in the resource panel |
| `/hotkeys` | Open the keymap settings |
| `/logs` | Open the debug log panel |
| `/changelog` | Show what changed in this release |
| `/usage`, `/data` | Open the analytics dashboard |

## Commands from the agent

`get_commands` returns the agent's **extensions, prompt templates, and skills**
— never its built-ins. These merge into the palette at runtime and execute
through a plain `prompt`, because `AgentSession` dispatches extension commands
and expands `/skill:<name>` on any transport.

The bundled gate extension registers `/reload`, `/system-prompt`, `/tree`, and
`/import`. A project's own `.agent/` extensions and skills appear the same way.

A name the agent advertises wins over ours, so a project can override a
built-in command.

## Deliberately absent

These CLI commands drive the terminal UI and have no RPC method behind them.
Listing them would send the literal text `/fast` to the model, which is worse
than leaving them out.

| Command | Why not |
|---|---|
| `/fullscreen` | Alternate-screen rendering — meaningless in a window |
| `/scoped-models` | Scopes the TUI's Ctrl+P cycling; the model picker covers it |
| `/fast` | Toggles OpenAI Fast mode through TUI state only |
| `/share` | Uploads a secret GitHub gist; no RPC method |
| `/traces` | Trace upload and configuration; no RPC method |
| `/rlm-max-depth` | No RPC method |
| `/heartbeats` | Cross-session manager; only the per-session heartbeat methods are exposed |

## Notes

`/btw` creates a conversation checkpoint, sends the question, and shows the
reply in an overlay. Escape discards the exchange; `/btw tail` keeps it. The
agent sees full context, but the exchange is ephemeral by default.

`/plan` switches mode optimistically on the client and applies a prefix to the
next message, so it works before the agent has connected.

`/close` and `/exit` archive rather than delete — the conversation stays
readable and can be restored from Settings → Archives.

Unknown commands are sent to the model as ordinary text.
