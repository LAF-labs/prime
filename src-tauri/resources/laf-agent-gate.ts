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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const READ_ONLY_TOOLS = new Set([
	"read",
	"read_file",
	"ls",
	"grep",
	"glob",
	"find",
	"list",
]);

function summarize(toolName: string, input: Record<string, unknown>): string {
	let summary = "";
	if (typeof input.command === "string") summary = input.command;
	else if (typeof input.code === "string") summary = input.code;
	else if (typeof input.path === "string") summary = input.path;
	else if (typeof input.file_path === "string") summary = input.file_path;
	else {
		try {
			summary = JSON.stringify(input);
		} catch {
			summary = "";
		}
	}
	if (summary.length > 500) summary = `${summary.slice(0, 500)}…`;
	return summary;
}

const WORKSPACE = process.env.LAF_WORKSPACE ?? "";
const TIGHT_SANDBOX = process.env.LAF_TIGHT_SANDBOX === "1";
const PATH_KEYS = ["path", "file_path", "filePath"] as const;

/** True when a file-path argument escapes the workspace. */
function escapesWorkspace(input: Record<string, unknown>): string | null {
	if (!TIGHT_SANDBOX || !WORKSPACE) return null;
	for (const key of PATH_KEYS) {
		const value = input[key];
		if (typeof value !== "string" || !value.startsWith("/")) continue;
		if (!value.startsWith(WORKSPACE.endsWith("/") ? WORKSPACE : `${WORKSPACE}/`) && value !== WORKSPACE) {
			return value;
		}
	}
	return null;
}

export default function (pi: ExtensionAPI) {
	registerParityCommands(pi);
	registerNativeWebSearch(pi);
	registerWebFetch(pi);

	pi.on("tool_call", async (event, ctx) => {
		if (READ_ONLY_TOOLS.has(event.toolName)) return undefined;

		// Workspace sandbox: block file mutations outside the project outright.
		const escaped = escapesWorkspace(event.input as Record<string, unknown>);
		if (escaped) {
			return {
				block: true,
				reason: `Blocked by LAF Agent sandbox: '${escaped}' is outside the workspace (${WORKSPACE}).`,
			};
		}

		if (!ctx.hasUI) return undefined;

		const title = JSON.stringify({
			__lafGate: 1,
			tool: event.toolName,
			summary: summarize(event.toolName, event.input as Record<string, unknown>),
		});

		const choice = await ctx.ui.select(title, ["Allow", "Deny"]);
		if (choice !== "Allow") {
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
 * Native web search — the same mechanism Claude and Codex use.
 *
 * Anthropic and OpenAI execute search *server-side* as part of the model turn
 * (`web_search_20250305` on the Messages API, `web_search` on the Responses
 * API). There is no third-party search key: the model receives results
 * directly and cites them in its answer, billed through the model provider.
 *
 * prime-agent doesn't declare those tools, so we append them to the outgoing
 * request. Providers that don't support server-side search are left untouched.
 */

/** Cap on searches per turn — mirrors the defaults these APIs document. */
const MAX_SEARCHES_PER_TURN = 5;

function isAnthropicPayload(p: Record<string, unknown>): boolean {
	// Messages API payloads carry `max_tokens` + `messages`, and models are
	// named `claude-*`; the Responses API uses `input` instead of `messages`.
	const model = typeof p.model === "string" ? p.model : "";
	return model.startsWith("claude") && Array.isArray(p.messages);
}

function isOpenAiResponsesPayload(p: Record<string, unknown>): boolean {
	return Array.isArray((p as { input?: unknown }).input) && typeof p.model === "string";
}

function hasTool(tools: unknown, predicate: (t: Record<string, unknown>) => boolean): boolean {
	return Array.isArray(tools) && tools.some((t) => typeof t === "object" && t !== null && predicate(t as Record<string, unknown>));
}

function withNativeWebSearch(payload: unknown): unknown {
	if (typeof payload !== "object" || payload === null) return undefined;
	const p = payload as Record<string, unknown>;

	if (isAnthropicPayload(p)) {
		if (hasTool(p.tools, (t) => typeof t.type === "string" && t.type.startsWith("web_search"))) {
			return undefined;
		}
		const tools = Array.isArray(p.tools) ? [...p.tools] : [];
		tools.push({ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES_PER_TURN });
		return { ...p, tools };
	}

	if (isOpenAiResponsesPayload(p)) {
		if (hasTool(p.tools, (t) => t.type === "web_search" || t.type === "web_search_preview")) {
			return undefined;
		}
		const tools = Array.isArray(p.tools) ? [...p.tools] : [];
		tools.push({ type: "web_search" });
		return { ...p, tools };
	}

	// Any other provider (OpenAI-compatible third parties, local servers) has
	// no server-side search — leave the request exactly as prime-agent built it.
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
			"web_fetch cannot search — it only retrieves a URL you already know.",
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
