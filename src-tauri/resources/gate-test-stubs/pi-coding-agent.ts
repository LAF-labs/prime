/**
 * Stand-in for `@earendil-works/pi-coding-agent` when the gate is under test.
 *
 * The real package lives in the sidecar and is only reachable from inside it,
 * so importing the gate anywhere else fails at resolution. Only the sandboxed
 * bash path touches these exports, and that path is off unless
 * `LAF_TIGHT_SANDBOX=1`, so returning nothing useful is enough.
 */

export const createBashTool = () => {
	throw new Error("createBashTool is not available under test");
};

export const createLocalBashOperations = () => {
	throw new Error("createLocalBashOperations is not available under test");
};
