# LAF Agent

**A native desktop app for [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent).**

LAF Agent is a macOS-first everyday AI agent on the desktop, driven by prime-agent: chat threads with streaming responses and thinking traces, web research, file tools with per-tool permission approval, a file tree with editor hand-off, a built-in terminal, and local analytics — all in a lightweight Tauri v2 shell (no Electron). Project-independent chats live in `Documents/LAF Agent Chats`.

Based on a desktop codebase by Sabeur Thabti, fully acquired with permission and re-platformed onto prime-agent's RPC protocol. Built on the open-source [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) runtime.

## How it works

- Each thread spawns a `prime-agent --mode rpc` subprocess in the project workspace and speaks JSONL over stdin/stdout.
- Agent events (text/thinking deltas, tool executions, compaction, retries) are translated into Tauri events consumed by the React 19 renderer.
- Tool-call approval rides on prime-agent's extension UI protocol via a bundled gate extension (`src-tauri/resources/laf-agent-gate.ts`).
- Models are addressed as `provider/model-id`; the picker is populated from `get_available_models`.
- Config lives in prime-agent's own `~/.prime/agent/` (settings.json, skills, prompts, MCP servers under `mcpServers`).

## Requirements

None — the DMG bundles the full prime-agent runtime (Node + compiled package under `Resources/resources/prime-agent/`). Install, open, paste an API key, done. Regenerate the bundled sidecar with `scripts/build-sidecar.sh`.

Power users can point Settings → agent binary at their own prime-agent install instead:
  ```
  curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh
  ```
- Provider credentials: run `prime-agent` once and use `/login`, or set `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc.

## Development

```
bun install
bun run dev        # tauri dev
bun run test       # vitest + cargo test
bun run build      # tauri build (produces .app + .dmg on macOS)
```

## License

MIT — see [LICENSE](LICENSE). Includes code © Sabeur Thabti (original codebase) and © Gibeom Gim (LAF Agent).
