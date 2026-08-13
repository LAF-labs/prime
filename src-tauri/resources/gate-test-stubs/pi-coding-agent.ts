/**
 * Stand-in for `@earendil-works/pi-coding-agent` when the gate is under test.
 *
 * The real package lives in the sidecar and is only reachable from inside it,
 * so importing the gate anywhere else fails at resolution.
 *
 * These used to throw, on the grounds that only the sandboxed bash path
 * touches them and that path is off under test. It is reachable now:
 * `LAF_TIGHT_SANDBOX=1` decides both whether a shell is registered and what
 * the system prompt says about deleting files, and a prompt that describes a
 * shell the session does not have is the bug the tests are there to catch. So
 * the stub returns a tool shaped like the real one instead — enough to assert
 * what was registered, never enough to run a command.
 */

export const createBashTool = (cwd: string) => ({
	name: "bash",
	label: "Shell",
	description: "Run a shell command (test stub).",
	// Shaped like the real one so `withExplanation` has something to widen: it
	// leaves an unfamiliar schema alone, and a stub that did not look like a
	// schema would make that pass-through look like success.
	parameters: {
		type: "object",
		properties: { command: { type: "string", description: "Command to run" } },
		required: ["command"],
	},
	execute: async () => {
		throw new Error(`the test stub's bash cannot run commands (cwd ${cwd})`);
	},
});

export const createLocalBashOperations = () => ({
	exec: async () => {
		throw new Error("the test stub's bash cannot run commands");
	},
});
