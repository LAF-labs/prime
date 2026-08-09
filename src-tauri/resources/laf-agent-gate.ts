/**
 * LAF Agent permission gate.
 *
 * Loaded into prime-agent with `-e` by the LAF Agent app. Intercepts
 * mutating tool calls and raises a select dialog over the RPC extension UI
 * protocol. The Rust side parses the JSON-encoded title (marked with
 * `__lafGate`) to render its native permission banner, and answers with
 * "Allow" or "Deny".
 *
 * Read-only tools pass through without a prompt. When the app has
 * auto-approve enabled it answers the dialog immediately on the Rust side,
 * so this extension stays approval-mode-agnostic.
 */

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join as joinPath, resolve as resolvePath } from "node:path";
import { createBashTool, createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import type { BashOperations, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const READ_ONLY_TOOLS = new Set([
	"read",
	"read_file",
	"ls",
	"grep",
	"glob",
	"find",
	"list",
	"list_dir",
]);

/**
 * Tools that never need an approval dialog even though they aren't reads:
 * their only side effect is on LAF Agent's own state, not the user's files.
 */
const PROMPTLESS_TOOLS = new Set(["remember"]);

function summarize(toolName: string, input: Record<string, unknown>): string {
	let summary = "";
	if (typeof input.command === "string") summary = input.command;
	else if (typeof input.code === "string") summary = input.code;
	else if (typeof input.path === "string") summary = input.path;
	else if (typeof input.file_path === "string") summary = input.file_path;
	else if (Array.isArray(input.operations)) {
		// organize: show the first move so the dialog names real paths, plus a count.
		const ops = input.operations as Array<{ from?: unknown; to?: unknown }>;
		const first = ops[0];
		const head =
			first && typeof first.from === "string" && typeof first.to === "string"
				? `${first.from} → ${first.to}`
				: "";
		summary = ops.length > 1 ? `${head} (+${ops.length - 1} more)` : head;
	} else {
		try {
			summary = JSON.stringify(input);
		} catch {
			summary = "";
		}
	}
	if (summary.length > 500) summary = `${summary.slice(0, 500)}…`;
	return summary;
}

const TIGHT_SANDBOX = process.env.LAF_TIGHT_SANDBOX === "1";
const PATH_KEYS = ["path", "file_path", "filePath"] as const;

// ── Plan-mode enforcement ────────────────────────────────────────────
//
// The app's plan mode used to be a prompt prefix only — a polite request the
// model could ignore. This makes it a hard gate: while `planMode` is on,
// mutating tool calls are blocked with an explanation instead of executed.
// The app toggles it with the `/plan-guard` extension command (sent over the
// RPC `prompt` path, which dispatches extension commands without a model
// turn). The prompt prefix still ships with every plan-mode message, so this
// is belt-and-braces, not a replacement.
//
// "Mutating" reuses the same classification the tight-sandbox path already
// applies: tools that carry a file-path argument (write/edit/…), plus the
// process-spawning tools whose effects the path check cannot see (bash,
// ipython). Read-only tools and the gate's own research tools (web_fetch)
// stay available so the model can actually build the plan.

let planMode = false;

/** Tools that execute arbitrary code — always mutating for plan purposes. */
const EXEC_TOOLS = new Set(["bash", "ipython", "shell", "exec", "python"]);

/** Research tools the plan guard must not block. */
const PLAN_SAFE_TOOLS = new Set(["web_fetch", "web_search", "fetch", "search"]);

function isMutatingForPlanMode(toolName: string, input: Record<string, unknown>): boolean {
	if (READ_ONLY_TOOLS.has(toolName) || PLAN_SAFE_TOOLS.has(toolName)) return false;
	if (EXEC_TOOLS.has(toolName)) return true;
	for (const key of PATH_KEYS) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0) return true;
	}
	// Defensive fallback for tools we don't know by name: block when the name
	// itself declares a mutation.
	return /write|edit|create|delete|remove|rename|move|patch|mkdir|apply|organize/i.test(toolName);
}

function registerPlanGuard(pi: ExtensionAPI): void {
	pi.registerCommand("plan-guard", {
		description: "Enforce plan mode by blocking mutating tools (on | off | status)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			// on/off stay silent: the app sends them programmatically on every
			// mode toggle and a notification per toggle would be pure noise.
			if (arg === "on") {
				planMode = true;
				return;
			}
			if (arg === "off") {
				planMode = false;
				return;
			}
			await ctx.ui.notify(`Plan guard is ${planMode ? "on" : "off"}.`, "info");
		},
	});
}

// Canonicalize the workspace itself once, so a workspace reached through a
// symlink (e.g. /tmp on macOS → /private/tmp) compares correctly.
const WORKSPACE = (() => {
	const raw = process.env.LAF_WORKSPACE ?? "";
	if (!raw) return "";
	try {
		return realpathSync(raw);
	} catch {
		return raw;
	}
})();

/**
 * Resolve a path the way the filesystem will, not the way the string looks:
 * make it absolute against the workspace, collapse `.`/`..`, and resolve
 * symlinks through the deepest ancestor that exists (the leaf may be a file
 * the tool is about to create).
 */
function canonicalize(value: string): string {
	const absolute = isAbsolute(value) ? resolvePath(value) : resolvePath(WORKSPACE, value);
	// Walk up to the nearest existing ancestor, realpath it, then re-append
	// the non-existent tail. This defeats `dir-symlink/newfile` escapes while
	// still allowing writes to files that don't exist yet.
	let existing = absolute;
	let tail = "";
	for (;;) {
		try {
			const real = realpathSync(existing);
			return tail ? resolvePath(real, tail) : real;
		} catch {
			const parent = dirname(existing);
			if (parent === existing) return absolute; // hit the root; give up cleanly
			tail = tail ? `${existing.slice(parent.length + 1)}/${tail}` : existing.slice(parent.length + 1);
			existing = parent;
		}
	}
}

function isInsideWorkspace(canonical: string): boolean {
	return canonical === WORKSPACE || canonical.startsWith(`${WORKSPACE}/`);
}

/**
 * True when a file-path argument escapes the workspace.
 *
 * Scope, honestly stated: this checks the *file-path arguments* of tools like
 * edit/write. It cannot see inside `bash` commands or `ipython` code — those
 * always go through the approval dialog instead (they are not in
 * READ_ONLY_TOOLS). Real process-level confinement is the Seatbelt profile's
 * job, not this function's.
 */
function escapesWorkspace(input: Record<string, unknown>): string | null {
	if (!TIGHT_SANDBOX || !WORKSPACE) return null;
	for (const key of PATH_KEYS) {
		const value = input[key];
		if (typeof value !== "string" || value.length === 0) continue;
		if (!isInsideWorkspace(canonicalize(value))) return value;
	}
	return null;
}

// ── OS-level bash sandbox ────────────────────────────────────────────
//
// The path check above only sees file-path arguments; a bash command can
// touch anything. This closes that gap with Anthropic's sandbox-runtime
// (sandbox-exec on macOS, bubblewrap on Linux): writes are confined to the
// workspace and temp dirs, and credential directories are unreadable, at the
// OS level, no matter what the command string says. Verified end to end — a
// model-issued `bash` writing to $HOME comes back "Operation not permitted".
//
// WHAT THIS DOES NOT COVER, so nobody mistakes it for full isolation:
//   * `ipython` — prime-agent's other built-in tool runs in the kernel
//     process, which is spawned outside this wrapper. Still prompt-gated.
//   * network — deliberately open. A domain allowlist routes traffic through
//     a proxy and breaks npm/pip/git for every project.
//   * reads — only credential directories are denied; the rest of the disk is
//     readable.
// upstream prime-agent states plainly that it is "not a security sandbox".
// This narrows that, it does not overturn it: treat the approval prompt as
// the real control and this as the floor under it.
//
// The dependency lives in the sidecar's node_modules (this file ships next
// to them — see build-sidecar.sh), so the import is dynamic and failure is
// tolerated: a dev run of the bare gate, or a user-supplied harness without
// the package, degrades to prompt-only behavior with a logged warning.

type SandboxRuntime = {
	SandboxManager: {
		initialize(config: unknown): Promise<void>;
		wrapWithSandbox(command: string): Promise<string>;
		reset(): Promise<void>;
	};
};

let runtime: SandboxRuntime | null = null;
let initOnce: Promise<boolean> | null = null;

/**
 * Initialize on first use rather than on a lifecycle event — the sandbox has
 * to be ready before the first command whether or not `session_start` fired,
 * and repeated calls share one promise.
 */
function ensureSandbox(): Promise<boolean> {
	initOnce ??= (async () => {
		if (process.platform !== "darwin" && process.platform !== "linux") return false;
		try {
			runtime = (await import("@anthropic-ai/sandbox-runtime")) as unknown as SandboxRuntime;
			await runtime.SandboxManager.initialize({
				// An empty network object means "don't touch the network" — a
				// domain allowlist would route through a proxy and break
				// npm/pip/git for every project. Filesystem confinement is the
				// point here; network policy is a separate decision.
				network: {},
				filesystem: {
					allowWrite: [WORKSPACE, "/tmp", "/private/tmp", "/var/folders", "/private/var/folders", "/dev/null"],
					denyRead: ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gh", "~/.netrc", "~/.prime/agent/auth.json"],
				},
			});
			return true;
		} catch (err) {
			runtime = null;
			console.error(
				`[laf-gate] bash sandbox unavailable (${err instanceof Error ? err.message : err}); falling back to approval prompts only`,
			);
			return false;
		}
	})();
	return initOnce;
}

/** Wrap a shell command with the OS sandbox; pass through when unavailable. */
async function sandboxCommand(command: string): Promise<string> {
	if (!(await ensureSandbox()) || !runtime) return command;
	try {
		return await runtime.SandboxManager.wrapWithSandbox(command);
	} catch (err) {
		console.error(`[laf-gate] sandbox wrap failed, running unsandboxed: ${err instanceof Error ? err.message : err}`);
		return command;
	}
}

function registerSandboxedBash(pi: ExtensionAPI): void {
	// Replace the built-in bash tool with one whose operations wrap every
	// command before it reaches the shell. The tool_call approval flow below
	// still runs first — the sandbox is the floor under the prompt, not a
	// replacement for it. The imports resolve because the extension loader
	// aliases "@earendil-works/pi-coding-agent" to the running harness itself.
	const localOps = createLocalBashOperations();
	const sandboxedOps: BashOperations = {
		exec: async (command, cwd, options) => localOps.exec(await sandboxCommand(command), cwd, options),
	};

	const cwd = WORKSPACE || process.cwd();
	const sandboxedBash = createBashTool(cwd, { operations: sandboxedOps });

	// Always route through the sandboxed tool: sandboxCommand() falls back to
	// the raw command when the runtime is unavailable, so there is no state to
	// branch on here and no window where the plain tool runs by accident.
	pi.registerTool(sandboxedBash);

	// `!command` from the user goes through the same wrapper.
	pi.on("user_bash", () => ({ operations: sandboxedOps }));

	pi.on("session_shutdown", async () => {
		if (runtime) {
			try {
				await runtime.SandboxManager.reset();
			} catch {
				// nothing useful to do at shutdown
			}
		}
	});
}

// ── Permission model: modes + persistent allow-rules ────────────────
//
// The app hands the gate its permission model at spawn (connection.rs):
//   LAF_PERMISSION_MODE  = "ask" | "acceptEdits" | "auto"
//   LAF_PERMISSION_RULES = JSON array of { tool, argPattern? }
//
// Parsed once here, so a mode/rule change applies to newly-started threads,
// not to a live one (documented spawn-time behavior). "auto" is NOT enforced
// in this gate: the Rust side answers the dialog immediately when auto-approve
// is on, which is what keeps the app's live auto-approve toggle working. This
// gate enforces only `acceptEdits` (auto-allow file edits) and the allow-rules.
//
// IMPORTANT: the rule-matching + glob logic below is mirrored, deliberately, by
// src/renderer/lib/permission-rules.ts (which the app UI and the unit tests
// use). The gate cannot import that module — it runs inside the harness, which
// only resolves node built-ins and the harness package alias — so the two
// copies must be kept in sync by hand. Change both together.

type PermissionMode = "ask" | "acceptEdits" | "auto";

interface PermissionRule {
	tool: string;
	argPattern?: string;
}

const PERMISSION_MODE: PermissionMode = (() => {
	const raw = (process.env.LAF_PERMISSION_MODE ?? "").trim();
	return raw === "acceptEdits" || raw === "auto" ? raw : "ask";
})();

/** File-editing tools auto-allowed under `acceptEdits`. */
const EDIT_TOOLS = new Set(["edit", "write", "str_replace", "multi_edit"]);

const PERMISSION_RULES: PermissionRule[] = (() => {
	const raw = process.env.LAF_PERMISSION_RULES;
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((r): r is { tool: string; argPattern?: unknown } => {
				return !!r && typeof (r as { tool?: unknown }).tool === "string" && (r as { tool: string }).tool.length > 0;
			})
			.map((r) => ({
				tool: String(r.tool),
				argPattern: typeof r.argPattern === "string" && r.argPattern.length > 0 ? r.argPattern : undefined,
			}));
	} catch {
		return [];
	}
})();

/** Translate a glob (only `*` is special) into an anchored RegExp. */
function globToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

/** The primary argument a rule's pattern is matched against, per tool. */
function primaryArg(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "ipython" || toolName === "python") {
		const code = typeof input.code === "string" ? input.code : "";
		return code.split("\n", 1)[0] ?? "";
	}
	if (typeof input.command === "string") return input.command;
	if (typeof input.code === "string") return input.code.split("\n", 1)[0] ?? "";
	for (const key of PATH_KEYS) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return "";
}

function ruleMatches(rule: PermissionRule, toolName: string, arg: string): boolean {
	if (rule.tool !== toolName) return false;
	if (!rule.argPattern) return true; // tool-wide rule
	try {
		return globToRegExp(rule.argPattern).test(arg);
	} catch {
		return false;
	}
}

/** True when any persistent allow-rule permits this tool call. */
function isAllowedByRule(toolName: string, input: Record<string, unknown>): boolean {
	if (PERMISSION_RULES.length === 0) return false;
	const arg = primaryArg(toolName, input);
	return PERMISSION_RULES.some((rule) => ruleMatches(rule, toolName, arg));
}

export default function (pi: ExtensionAPI) {
	registerParityCommands(pi);
	registerPlanGuard(pi);
	registerNativeWebSearch(pi);
	registerWebSearch(pi);
	registerWebFetch(pi);
	registerEverydayProfile(pi);

	// Everyday sessions must never gain a shell, even if a stale env leaks
	// LAF_TIGHT_SANDBOX from a developer-mode configuration.
	if (TIGHT_SANDBOX && WORKSPACE && !EVERYDAY) registerSandboxedBash(pi);

	pi.on("tool_call", async (event, ctx) => {
		if (READ_ONLY_TOOLS.has(event.toolName) || PROMPTLESS_TOOLS.has(event.toolName)) return undefined;

		// Plan mode: block mutations before anything else — no approval dialog
		// can override a plan-mode block, and the reason tells the model what
		// to do instead.
		if (planMode && isMutatingForPlanMode(event.toolName, event.input as Record<string, unknown>)) {
			return {
				block: true,
				reason:
					`Plan mode is active: the '${event.toolName}' tool mutates files or runs commands and was blocked. ` +
					"Do not attempt further mutations. Research with read-only tools and present a concrete, " +
					"step-by-step plan; the user will switch out of plan mode to execute it.",
			};
		}

		// Workspace sandbox: block file mutations outside the project outright.
		const escaped = escapesWorkspace(event.input as Record<string, unknown>);
		if (escaped) {
			return {
				block: true,
				reason: `Blocked by LAF Agent sandbox: '${escaped}' is outside the workspace (${WORKSPACE}).`,
			};
		}

		// Persistent allow-rules: a match allows the call with no dialog. Applies
		// in every mode (in "auto" the Rust side would auto-answer anyway).
		if (isAllowedByRule(event.toolName, event.input as Record<string, unknown>)) {
			return undefined;
		}

		// acceptEdits: auto-allow the file-editing tools, but still prompt for
		// exec tools (bash/ipython) and anything else.
		if (PERMISSION_MODE === "acceptEdits" && EDIT_TOOLS.has(event.toolName)) {
			return undefined;
		}

		if (!ctx.hasUI) return undefined;

		const title = JSON.stringify({
			__lafGate: 1,
			tool: event.toolName,
			summary: summarize(event.toolName, event.input as Record<string, unknown>),
		});

		// "Always allow" is surfaced by the app as an allow_always option; the
		// app persists a tool-wide rule for future threads and answers here to
		// allow the current call. Both allow answers permit the call.
		const choice = await ctx.ui.select(title, ["Allow", "Always allow", "Deny"]);
		if (choice !== "Allow" && choice !== "Always allow") {
			return { block: true, reason: "Blocked by user in LAF Agent" };
		}
		return undefined;
	});
}

/**
 * CLI-parity commands that only an extension can reach.
 *
 * prime-agent's TUI implements these against APIs that have no RPC command
 * (`ctx.reload`, `ctx.navigateTree`, `ctx.switchSession`, `getSystemPrompt`).
 * Registering them here makes them execute over RPC exactly like every other
 * extension command, so the desktop app gets the same behavior as the CLI.
 */
function registerParityCommands(pi: ExtensionAPI): void {
	pi.registerCommand("reload", {
		description: "Reload extensions, skills, prompt templates and themes",
		handler: async (_args, ctx) => {
			await ctx.reload();
		},
	});

	pi.registerCommand("system-prompt", {
		description: "Show the active system prompt",
		handler: async (_args, ctx) => {
			const prompt = ctx.getSystemPrompt?.() ?? "";
			await ctx.ui.editor("System prompt", prompt);
		},
	});

	pi.registerCommand("tree", {
		description: "Browse the session tree and jump to another branch",
		handler: async (args, ctx) => {
			const entries = ctx.sessionManager.getEntries();
			const userTurns = entries.filter(
				(e: { type: string; message?: { role?: string } }) =>
					e.type === "message" && e.message?.role === "user",
			);
			if (userTurns.length === 0) {
				await ctx.ui.notify("This session has no turns to navigate yet.", "info");
				return;
			}
			const target = args.trim();
			const labels = userTurns.map((e: { id: string; message?: { content?: unknown } }) => {
				const content = e.message?.content;
				const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
				return `${e.id} — ${text.slice(0, 60)}`;
			});
			const picked = target
				? labels.find((l: string) => l.startsWith(target))
				: await ctx.ui.select("Jump to a turn", labels);
			if (!picked) return;
			const id = String(picked).split(" — ")[0];
			await ctx.navigateTree(id, { summarize: false });
		},
	});

	pi.registerCommand("import", {
		description: "Open a session JSONL file in this window",
		handler: async (args, ctx) => {
			const path = args.trim() || (await ctx.ui.input("Session file path", "/path/to/session.jsonl"));
			if (!path) return;
			await ctx.switchSession(path);
		},
	});
}

export function activateParityCommands(pi: ExtensionAPI): void {
	registerParityCommands(pi);
}

/**
 * Web search — the same mechanism Claude Code and Codex use.
 *
 * Neither ships a scraper and neither carries a third-party search key.
 * Anthropic and OpenAI execute search *server-side* as part of the model turn
 * (`web_search_20250305` on the Messages API, `web_search` on the Responses
 * API). The model receives results directly and cites them in its answer,
 * billed through the model provider the user already pays for.
 *
 * prime-agent doesn't declare those tools, so we append them to the outgoing
 * request. Providers with no server-side search — local models, third-party
 * OpenAI-compatible endpoints — fall back to the client-side `web_search`
 * below, which the gate runs itself against a SearXNG instance the user
 * points us at. Either way the model sees exactly one tool named
 * `web_search`, so its instructions never have to branch on the provider.
 *
 * Note on what is deliberately absent: no keyless scrape of Google, Bing, or
 * DuckDuckGo. Every one of those answers an unattended client with a bot
 * challenge or a 403, so a scraper would fail in the field while looking
 * fine in review.
 */

/** Cap on searches per turn — mirrors the defaults these APIs document. */
const MAX_SEARCHES_PER_TURN = 5;

function isAnthropicPayload(p: Record<string, unknown>): boolean {
	// Messages API payloads carry `max_tokens` + `messages`, and models are
	// named `claude-*`; the Responses API uses `input` instead of `messages`.
	const model = typeof p.model === "string" ? p.model : "";
	if (!model.startsWith("claude") || !Array.isArray(p.messages)) return false;

	// The model name is not enough on its own. Gateways — OpenCode Zen and
	// OpenRouter among them — resell Anthropic models under bare `claude-*`
	// ids over OpenAI chat-completions, which also carries `model` + `messages`.
	// Verified against OpenCode Zen's /models: it lists `claude-sonnet-5`,
	// `claude-opus-5`, and friends with no vendor prefix.
	//
	// Two fields separate the dialects. Chat-completions wraps every tool as
	// `{type: "function", function: {…}}` and puts the system prompt inside
	// `messages`; the Messages API declares tools with a top-level
	// `input_schema` and takes `system` as its own parameter. Require a
	// positive Anthropic signal rather than merely failing to spot an OpenAI
	// one: a missed injection costs the model its search, while a wrong one
	// sends a Messages-API tool to an endpoint that rejects the whole turn.
	if (hasTool(p.tools, (t) => t.type === "function")) return false;
	return p.system !== undefined || hasTool(p.tools, (t) => "input_schema" in t);
}

function isOpenAiResponsesPayload(p: Record<string, unknown>): boolean {
	return Array.isArray((p as { input?: unknown }).input) && typeof p.model === "string";
}

function hasTool(tools: unknown, predicate: (t: Record<string, unknown>) => boolean): boolean {
	return Array.isArray(tools) && tools.some((t) => typeof t === "object" && t !== null && predicate(t as Record<string, unknown>));
}

/**
 * Drop the gate's own `web_search` declaration from an outgoing tool list.
 *
 * When the provider runs search server-side, its tool is also named
 * `web_search`, and both APIs reject a request that declares one name twice.
 * The server-side one wins: it is the better search, and it costs the user
 * nothing beyond the turn they are already paying for.
 */
function withoutClientWebSearch(tools: unknown): Record<string, unknown>[] {
	if (!Array.isArray(tools)) return [];
	return tools.filter((t) => {
		if (typeof t !== "object" || t === null) return true;
		const tool = t as Record<string, unknown>;
		if (tool.name !== "web_search") return true;
		// Anthropic function tools carry no `type`; Responses ones say "function".
		return typeof tool.type === "string" && tool.type !== "function";
	}) as Record<string, unknown>[];
}

function withNativeWebSearch(payload: unknown): unknown {
	if (typeof payload !== "object" || payload === null) return undefined;
	const p = payload as Record<string, unknown>;

	if (isAnthropicPayload(p)) {
		if (hasTool(p.tools, (t) => typeof t.type === "string" && t.type.startsWith("web_search"))) {
			return undefined;
		}
		const tools = withoutClientWebSearch(p.tools);
		tools.push({ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES_PER_TURN });
		return { ...p, tools };
	}

	if (isOpenAiResponsesPayload(p)) {
		if (hasTool(p.tools, (t) => t.type === "web_search" || t.type === "web_search_preview")) {
			return undefined;
		}
		const tools = withoutClientWebSearch(p.tools);
		tools.push({ type: "web_search" });
		return { ...p, tools };
	}

	// Any other provider (OpenAI-compatible third parties, local servers) has
	// no server-side search — leave the request exactly as prime-agent built it,
	// so the client-side `web_search` below stays declared and callable.
	return undefined;
}

function registerNativeWebSearch(pi: ExtensionAPI): void {
	if (process.env.LAF_NATIVE_WEB_SEARCH === "0") return;
	pi.on("before_provider_request", (event) => {
		const patched = withNativeWebSearch(event.payload);
		return patched === undefined ? undefined : { payload: patched };
	});
}

/**
 * `web_search` — client-side search for providers with no server-side search.
 *
 * Backed by SearXNG, a self-hostable metasearch front end that queries the
 * real engines and returns their results as JSON. It needs no account and no
 * API key; what it needs is an instance to talk to, which the user supplies
 * via `LAF_WEB_SEARCH_URL`. We ship no default instance on purpose — a
 * hardcoded list would send every user's queries to volunteer-run servers
 * they never chose, and those servers rate-limit a desktop app within a
 * couple of requests anyway.
 *
 * JSON is the only format we parse. SearXNG's HTML is theme-dependent and
 * changes without notice, so a scraper for it would rot quietly; the JSON
 * API is stable and one config line away (`search.formats: [html, json]`).
 */

const SEARCH_ENDPOINT = (process.env.LAF_WEB_SEARCH_URL ?? "").trim().replace(/\/+$/, "");
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULTS = 8;
const MAX_SNIPPET_CHARS = 400;

interface SearxResult {
	url?: unknown;
	title?: unknown;
	content?: unknown;
}

function formatSearchResults(results: SearxResult[], query: string): string {
	const lines = [`# Web search: ${query}`, ""];
	results.forEach((result, index) => {
		const title = typeof result.title === "string" && result.title.trim() ? result.title.trim() : "(untitled)";
		const url = typeof result.url === "string" ? result.url.trim() : "";
		const snippetRaw = typeof result.content === "string" ? result.content.replace(/\s+/g, " ").trim() : "";
		const snippet =
			snippetRaw.length > MAX_SNIPPET_CHARS ? `${snippetRaw.slice(0, MAX_SNIPPET_CHARS)}…` : snippetRaw;
		lines.push(`${index + 1}. ${title}`);
		if (url) lines.push(`   ${url}`);
		if (snippet) lines.push(`   ${snippet}`);
		lines.push("");
	});
	lines.push("Use web_fetch on a URL above to read the full page.");
	return lines.join("\n");
}

function registerWebSearch(pi: ExtensionAPI): void {
	if (!SEARCH_ENDPOINT) return;
	pi.registerTool({
		name: "web_search",
		label: "Search",
		description:
			"Search the web and return ranked results with titles, URLs, and snippets. " +
			"Use it to find pages you don't already have a URL for, then read the promising ones with web_fetch.",
		promptGuidelines: [
			"Use web_search for anything you need current information about — releases, docs, errors, news.",
			"Search results are summaries; read the page with web_fetch before relying on details.",
		],
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
			},
			required: ["query"],
		},
		execute: async (_toolCallId: string, params: { query: string }, signal?: AbortSignal) => {
			const query = String(params.query ?? "").trim();
			if (!query) {
				throw new Error("web_search needs a non-empty query.");
			}
			const url = `${SEARCH_ENDPOINT}/search?q=${encodeURIComponent(query)}&format=json`;
			const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
			const composite = signal ? AbortSignal.any([signal, timeout]) : timeout;
			const response = await fetch(url, {
				signal: composite,
				redirect: "follow",
				headers: { accept: "application/json" },
			});
			if (!response.ok) {
				throw new Error(
					`Search endpoint ${SEARCH_ENDPOINT} returned HTTP ${response.status}. ` +
						"If it is a SearXNG instance, its JSON API is probably off — add " +
						"`json` to `search.formats` in its settings.yml.",
				);
			}
			const raw = await response.text();
			let parsed: { results?: unknown };
			try {
				parsed = JSON.parse(raw) as { results?: unknown };
			} catch {
				throw new Error(
					`Search endpoint ${SEARCH_ENDPOINT} answered with something that isn't JSON. ` +
						"LAF_WEB_SEARCH_URL must point at a SearXNG instance with its JSON API enabled.",
				);
			}
			const results = Array.isArray(parsed.results) ? (parsed.results as SearxResult[]) : [];
			if (results.length === 0) {
				return {
					content: [{ type: "text", text: `# Web search: ${query}\n\nNo results.` }],
					details: { query, results: 0 },
				};
			}
			const top = results.slice(0, MAX_SEARCH_RESULTS);
			return {
				content: [{ type: "text", text: formatSearchResults(top, query) }],
				details: { query, results: top.length, endpoint: SEARCH_ENDPOINT },
			};
		},
	});
}

/**
 * `web_fetch` — read a web page as text. Keyless and provider-independent,
 * so it works on every model (including OpenAI-compatible endpoints that have
 * no server-side search). Mirrors what Claude Code's WebFetch does: fetch,
 * strip markup, truncate to something a model can read.
 */

const FETCH_TIMEOUT_MS = 20_000;
const MAX_PAGE_CHARS = 40_000;

function htmlToText(html: string): string {
	return html
		// Drop anything that isn't prose before stripping tags.
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		// Keep block boundaries as newlines so structure survives.
		.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function registerWebFetch(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_fetch",
		label: "Fetch",
		description:
			"Fetch a URL and return its readable text. Use it to read documentation, " +
			"articles, or any page the user links. Returns plain text, truncated for long pages.",
		promptGuidelines: [
			"Use web_fetch when the user gives a URL or when you need the contents of a specific page.",
			"web_fetch retrieves one URL; it does not search. When no web_search tool is available, " +
				"most current-information questions are still answerable, because the page you need " +
				"usually lives at an address you can derive rather than one you have to find. " +
				"Construct the likely URL and fetch it: a package's own registry record for versions " +
				"and metadata (registry.npmjs.org/<name>, pypi.org/pypi/<name>/json, " +
				"crates.io/api/v1/crates/<name>), a project's releases or tags page on its forge for " +
				"what changed, the documented docs site for API reference, the raw file on the default " +
				"branch for current source. Try the address you would type yourself before concluding " +
				"you cannot answer.",
			"If a fetch fails or the page doesn't say what you expected, say so and give the answer " +
				"you do have. Never present a guessed version number, release date, or API signature " +
				"as if you had read it.",
		],
		parameters: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute http(s) URL to fetch" },
			},
			required: ["url"],
		},
		execute: async (_toolCallId: string, params: { url: string }, signal?: AbortSignal) => {
			const url = String(params.url ?? "").trim();
			if (!/^https?:\/\//i.test(url)) {
				throw new Error("web_fetch needs an absolute http(s) URL.");
			}
			const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
			const composite = signal ? AbortSignal.any([signal, timeout]) : timeout;
			const response = await fetch(url, {
				signal: composite,
				redirect: "follow",
				headers: {
					// Some sites serve a stub to unknown agents; identify as a browser.
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
					accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
				},
			});
			if (!response.ok) {
				throw new Error(`${url} returned HTTP ${response.status}.`);
			}
			const contentType = response.headers.get("content-type") ?? "";
			const raw = await response.text();
			const body = contentType.includes("html") ? htmlToText(raw) : raw.trim();
			const truncated = body.length > MAX_PAGE_CHARS;
			const text = truncated ? `${body.slice(0, MAX_PAGE_CHARS)}\n\n…[truncated]` : body;
			return {
				content: [{ type: "text", text: `# ${url}\n\n${text}` }],
				details: { url, contentType, chars: body.length, truncated },
			};
		},
	});
}

// ── Everyday profile ─────────────────────────────────────────────────
//
// Active when the app launches the session with `LAF_PROFILE=everyday`
// (simple mode). The session runs with `--no-builtin-tools`, so ipython —
// and with it the RLM prompt's whole reason to exist — is gone. This module
// supplies what such a session needs instead: a conversational system prompt
// sized for small models, and a handful of plain-language file tools.
//
// Design rules, in order: the model must never need to write code; every
// mutation goes through the existing approval dialog (write_file and
// organize match the gate's mutation classification); nothing here can
// delete a file — removal stays a human decision.

const EVERYDAY = process.env.LAF_PROFILE === "everyday";

/** Canonical home directory — the outer boundary for everyday file tools. */
const HOME = (() => {
	try {
		return realpathSync(homedir());
	} catch {
		return homedir();
	}
})();

const MEMORY_DIR = joinPath(HOME, ".laf-agent");
const MEMORY_PATH = process.env.LAF_MEMORY_PATH || joinPath(MEMORY_DIR, "memories.json");
const MAX_MEMORIES = 200;
const MAX_MEMORY_CHARS = 500;
const MAX_READ_CHARS = 40_000;
const MAX_DIR_ENTRIES = 200;
const MAX_ORGANIZE_OPS = 100;

interface EverydayMemory {
	fact: string;
	at: string;
}

function loadMemories(): EverydayMemory[] {
	try {
		const parsed = JSON.parse(readFileSync(MEMORY_PATH, "utf8")) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(m): m is EverydayMemory => typeof (m as EverydayMemory)?.fact === "string",
		);
	} catch {
		return [];
	}
}

function saveMemories(memories: EverydayMemory[]): void {
	mkdirSync(MEMORY_DIR, { recursive: true });
	writeFileSync(MEMORY_PATH, `${JSON.stringify(memories, null, "\t")}\n`, "utf8");
}

/**
 * The everyday system prompt. Replaces the RLM prompt wholesale via
 * `before_agent_start`. Kept short on purpose: tool descriptions travel in
 * the tool schemas, and every fixed token here is paid on every request.
 * Memories go last so the stable prefix stays byte-identical for provider
 * prompt caching within a session.
 */
function buildEverydayPrompt(cwd: string): string {
	const date = new Date().toISOString().slice(0, 10);
	const parts = [
		"You are LAF Agent, a personal AI assistant that lives on the user's own computer.",
		"",
		"You help with everyday work: organizing files and folders, reading and summarizing documents, writing text, researching on the web, and answering questions. Your user is usually not a programmer. Never assume technical knowledge, and avoid code, developer jargon, and raw file paths unless the user uses them first.",
		"",
		"How to work:",
		"- Always answer in the language the user writes in.",
		"- Lead with the result. Keep explanations short and warm; do not narrate your process.",
		"- Use tools instead of guessing: read a file before summarizing it, search the web for anything current, list a folder before organizing it.",
		"- Before creating, changing, or moving any file, say in one short sentence what you are about to do. Touch only the files the task requires.",
		"- You cannot delete files. When something should be removed, name the files and let the user do it.",
		"- If a step fails, say what happened in plain words and offer the closest thing you can do.",
		"- Use the remember tool only for stable facts about the user (name, preferences, recurring context), never for one-off task details.",
		"",
		`Current date: ${date}`,
		`Working folder: ${cwd}`,
	];
	const memories = loadMemories();
	if (memories.length > 0) {
		parts.push("", "Things you remember about this user:");
		for (const memory of memories) parts.push(`- ${memory.fact}`);
	}
	return parts.join("\n");
}

/**
 * Resolve an everyday tool path: expand `~`, resolve relative paths against
 * the workspace, canonicalize through symlinks, and confine the result to
 * the user's home. Dotfiles and ~/Library are refused — an everyday session
 * has no business in either, and prompt-injected text should not be able to
 * point these tools at keychains, cookies, or ssh keys.
 */
function resolveEverydayPath(raw: string): { path: string } | { error: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { error: "Empty path." };
	const expanded = trimmed === "~" ? HOME : trimmed.startsWith("~/") ? joinPath(HOME, trimmed.slice(2)) : trimmed;
	const absolute = isAbsolute(expanded) ? expanded : resolvePath(WORKSPACE || HOME, expanded);
	const canonical = canonicalize(absolute);
	if (canonical !== HOME && !canonical.startsWith(`${HOME}/`)) {
		return { error: `'${raw}' is outside your home folder, which everyday tools cannot reach.` };
	}
	const relative = canonical === HOME ? "" : canonical.slice(HOME.length + 1);
	const segments = relative ? relative.split("/") : [];
	// The app's own ~/.laf-agent/chats workspaces must stay reachable — chat
	// threads live there. Everything else hidden stays off-limits.
	const insideOwnData = segments[0] === ".laf-agent";
	if (!insideOwnData && (segments.some((s) => s.startsWith(".")) || segments[0] === "Library")) {
		return { error: `'${raw}' is a hidden or system location, which everyday tools cannot touch.` };
	}
	return { path: canonical };
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Suffix listing already-completed operations, so a mid-batch failure is honest about partial state. */
function doneSuffix(done: string[]): string {
	return done.length > 0 ? ` Already completed before the failure: ${done.join("; ")}.` : "";
}

function registerEverydayProfile(pi: ExtensionAPI): void {
	if (!EVERYDAY) return;

	pi.on("before_agent_start", (event) => ({
		systemPrompt: buildEverydayPrompt(event.systemPromptOptions?.cwd ?? WORKSPACE ?? HOME),
	}));

	pi.registerTool({
		name: "read_file",
		label: "Read",
		description:
			"Read a text file (documents, notes, CSV, …) and return its contents. " +
			"Use it before summarizing, answering questions about, or editing a file.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "File path; ~ means the home folder" },
			},
			required: ["path"],
		},
		execute: async (_toolCallId: string, params: { path: string }) => {
			const resolved = resolveEverydayPath(String(params.path ?? ""));
			if ("error" in resolved) throw new Error(resolved.error);
			const body = await readFile(resolved.path, "utf8");
			if (body.includes("\u0000")) {
				throw new Error("This file is not text (it looks like an image, archive, or other binary format).");
			}
			const truncated = body.length > MAX_READ_CHARS;
			const text = truncated ? `${body.slice(0, MAX_READ_CHARS)}\n\n…[truncated]` : body;
			return {
				content: [{ type: "text", text }],
				details: { path: resolved.path, chars: body.length, truncated },
			};
		},
	});

	pi.registerTool({
		name: "list_dir",
		label: "Browse",
		description:
			"List what is inside a folder: subfolder names and file names with sizes. " +
			"Use it to see what exists before reading or organizing anything.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Folder path; ~ means the home folder" },
			},
			required: ["path"],
		},
		execute: async (_toolCallId: string, params: { path: string }) => {
			const resolved = resolveEverydayPath(String(params.path ?? ""));
			if ("error" in resolved) throw new Error(resolved.error);
			const entries = await readdir(resolved.path, { withFileTypes: true });
			const visible = entries.filter((e) => !e.name.startsWith("."));
			visible.sort((a, b) =>
				a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
			);
			const shown = visible.slice(0, MAX_DIR_ENTRIES);
			const lines: string[] = [];
			for (const entry of shown) {
				if (entry.isDirectory()) {
					lines.push(`${entry.name}/`);
					continue;
				}
				try {
					const info = await stat(joinPath(resolved.path, entry.name));
					lines.push(`${entry.name} (${formatBytes(info.size)})`);
				} catch {
					lines.push(entry.name);
				}
			}
			if (visible.length > shown.length) {
				lines.push(`…and ${visible.length - shown.length} more entries`);
			}
			return {
				content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "(empty folder)" }],
				details: { path: resolved.path, entries: visible.length },
			};
		},
	});

	pi.registerTool({
		name: "write_file",
		label: "Write",
		description:
			"Create a text file or replace the contents of an existing one. " +
			"Use it to save notes, lists, drafts, or edited versions of a document.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Destination file path; ~ means the home folder" },
				content: { type: "string", description: "Full text content to write" },
			},
			required: ["path", "content"],
		},
		execute: async (_toolCallId: string, params: { path: string; content: string }) => {
			const resolved = resolveEverydayPath(String(params.path ?? ""));
			if ("error" in resolved) throw new Error(resolved.error);
			const content = String(params.content ?? "");
			let replaced = false;
			try {
				replaced = (await stat(resolved.path)).isFile();
			} catch {
				// New file.
			}
			await mkdir(dirname(resolved.path), { recursive: true });
			await writeFile(resolved.path, content, "utf8");
			return {
				content: [
					{
						type: "text",
						text: `${replaced ? "Replaced" : "Created"} ${resolved.path} (${formatBytes(Buffer.byteLength(content, "utf8"))}).`,
					},
				],
				details: { path: resolved.path, replaced, chars: content.length },
			};
		},
	});

	pi.registerTool({
		name: "organize",
		label: "Organize",
		description:
			"Move or copy files and folders — the tool for tidying up: renaming, sorting downloads " +
			"into folders, gathering related files together. Refuses to overwrite anything that " +
			"already exists, and cannot delete.",
		parameters: {
			type: "object",
			properties: {
				operations: {
					type: "array",
					description: "File operations to perform, in order",
					items: {
						type: "object",
						properties: {
							op: { type: "string", enum: ["move", "copy"], description: "move (default) or copy" },
							from: { type: "string", description: "Existing file or folder" },
							to: { type: "string", description: "New path, including the new name" },
						},
						required: ["from", "to"],
					},
				},
			},
			required: ["operations"],
		},
		execute: async (
			_toolCallId: string,
			params: { operations: Array<{ op?: string; from: string; to: string }> },
		) => {
			const operations = Array.isArray(params.operations) ? params.operations : [];
			if (operations.length === 0) throw new Error("organize needs at least one operation.");
			if (operations.length > MAX_ORGANIZE_OPS) {
				throw new Error(`organize handles at most ${MAX_ORGANIZE_OPS} operations per call — split the task.`);
			}
			const done: string[] = [];
			for (const [index, op] of operations.entries()) {
				const label = `operation ${index + 1}`;
				const from = resolveEverydayPath(String(op.from ?? ""));
				if ("error" in from) throw new Error(`${label}: ${from.error}${doneSuffix(done)}`);
				const to = resolveEverydayPath(String(op.to ?? ""));
				if ("error" in to) throw new Error(`${label}: ${to.error}${doneSuffix(done)}`);
				let exists = true;
				try {
					await stat(to.path);
				} catch {
					exists = false;
				}
				if (exists) {
					throw new Error(
						`${label}: '${to.path}' already exists — organize never overwrites. Pick a different name.${doneSuffix(done)}`,
					);
				}
				await mkdir(dirname(to.path), { recursive: true });
				if (op.op === "copy") {
					await copyFile(from.path, to.path);
				} else {
					await rename(from.path, to.path);
				}
				done.push(`${op.op === "copy" ? "Copied" : "Moved"} ${from.path} → ${to.path}`);
			}
			return {
				content: [{ type: "text", text: done.join("\n") }],
				details: { operations: done.length },
			};
		},
	});

	pi.registerTool({
		name: "remember",
		label: "Remember",
		description:
			"Save one stable fact about the user (their name, preferences, recurring context) so " +
			"future conversations know it. Not for one-off task details.",
		parameters: {
			type: "object",
			properties: {
				fact: { type: "string", description: "The fact to remember, one short sentence" },
			},
			required: ["fact"],
		},
		execute: async (_toolCallId: string, params: { fact: string }) => {
			const fact = String(params.fact ?? "").trim();
			if (!fact) throw new Error("remember needs a non-empty fact.");
			if (fact.length > MAX_MEMORY_CHARS) {
				throw new Error(`Keep memories under ${MAX_MEMORY_CHARS} characters — save the essence, not the transcript.`);
			}
			const memories = loadMemories();
			if (memories.some((m) => m.fact === fact)) {
				return { content: [{ type: "text", text: "Already remembered." }], details: { total: memories.length } };
			}
			memories.push({ fact, at: new Date().toISOString() });
			while (memories.length > MAX_MEMORIES) memories.shift();
			saveMemories(memories);
			return {
				content: [{ type: "text", text: `Remembered. (${memories.length} memories total)` }],
				details: { total: memories.length },
			};
		},
	});
}
