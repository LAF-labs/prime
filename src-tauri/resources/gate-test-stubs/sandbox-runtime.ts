/**
 * Stand-in for `@anthropic-ai/sandbox-runtime` when the gate is under test.
 *
 * The real package lives in the sidecar. This one exists to record the
 * confinement policy the gate asks for, because that policy is a list of
 * strings with nothing checking it: the deny list went on naming
 * `~/.prime/agent/auth.json` for as long as it took the config directory to be
 * renamed and nobody to notice, and a shell command could read the user's live
 * API keys the whole time. A test can hold the list to its intent even though
 * it cannot run a real sandbox.
 */

export interface RecordedConfig {
	network?: { allowedDomains?: string[]; strictAllowlist?: boolean };
	filesystem?: { allowWrite?: string[]; denyRead?: string[] };
}

let lastConfig: RecordedConfig | null = null;

/** The policy passed to the most recent `initialize`, or null if never called. */
export const lastSandboxConfig = (): RecordedConfig | null => lastConfig;

export const SandboxManager = {
	initialize: async (config: RecordedConfig): Promise<void> => {
		lastConfig = config;
	},
	wrapWithSandbox: async (command: string): Promise<string> => `sandboxed:${command}`,
	reset: async (): Promise<void> => {
		lastConfig = null;
	},
};
