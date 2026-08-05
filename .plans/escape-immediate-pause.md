# Escape key immediate pause

Pressing Esc while the agent is running doesn't stop output immediately. The agent continues streaming until the current turn naturally completes.

## Root cause

The ACP event loop in `acp.rs` processes commands sequentially:

```
while let Some(cmd) = cmd_rx.recv().await {
    AcpCommand::Prompt(text) => {
        conn.prompt(req).await  // blocks the loop for the entire turn
    }
    AcpCommand::Cancel => {
        conn.cancel(...)  // never reached while prompt is running
    }
}
```

`task_pause` sends `AcpCommand::Cancel` to the channel, but it queues behind the blocking `conn.prompt().await`. The cancel notification never reaches the ACP subprocess until the turn finishes on its own.

On the frontend side, chunks keep arriving and rendering even after the user pressed Esc because nothing stops the `onMessageChunk` listener from flushing buffered chunks.

## Requirements

- Esc must stop the agent and halt streaming output within ~1 second
- Partial output doesn't need to be preserved; the user doesn't care
- Interrupt immediately, even mid-tool-call
- No empty or duplicate messages in conversation history after pause

## Tasks

### Task 1: Restructure ACP event loop for concurrent cancel

**File:** `src-tauri/src/commands/acp.rs`

In `run_acp_connection()`, replace the sequential command loop with `tokio::select!` when processing a `Prompt`. Race `conn.prompt(req)` against `cmd_rx.recv()` so that `Cancel` and `Kill` commands are handled immediately while the prompt is running.

Sketch:

```rust
AcpCommand::Prompt(text) => {
    let prompt_fut = conn.prompt(prompt_req);
    tokio::pin!(prompt_fut);
    loop {
        tokio::select! {
            result = &mut prompt_fut => {
                // handle prompt result (Ok/Err) as before
                break;
            }
            Some(cmd) = cmd_rx.recv() => {
                match cmd {
                    AcpCommand::Cancel => {
                        conn.cancel(CancelNotification::new(session_id.clone())).await;
                        // don't break — let prompt_fut resolve with the cancelled result
                    }
                    AcpCommand::Kill => {
                        // break out of both loops
                    }
                    other => {
                        // queue SetMode/ForkSession for after prompt completes
                    }
                }
            }
        }
    }
}
```

Key considerations:
- `conn` is `!Send` so everything stays on the `LocalSet` — `tokio::select!` works fine here
- After sending cancel, the prompt future should resolve shortly (the ACP protocol handles this). Let it resolve naturally so `turn_end` fires correctly.
- `Kill` during a prompt should break out of both the select loop and the outer command loop. Use a flag or labeled break.
- Buffer non-urgent commands (SetMode, ForkSession) received during a prompt and process them after the prompt resolves.

### Task 2: Clear frontend streaming state immediately on pause

**Files:** `src/renderer/hooks/useKeyboardShortcuts.ts`, `src/renderer/stores/taskStore.ts`

When Esc triggers `ipc.pauseTask()`, also immediately:
1. Call `useTaskStore.getState().clearTurn(taskId)` to wipe `streamingChunks`, `thinkingChunks`, and `liveToolCalls`
2. In `initTaskListeners`, guard `onMessageChunk` and `onThinkingChunk` handlers to skip chunks for tasks not in `'running'` status

The `task_pause` Rust command emits `task_update` with `status: "paused"` synchronously, so by the time the next rAF fires, the task status is already `'paused'` and new chunks get dropped.

Also clear the module-level `chunkBuf` and `thinkBuf` for the paused task to prevent stale buffered chunks from flushing on the next rAF.

### Task 3: Verify turn finalization after cancel

**Files:** `src/renderer/stores/taskStore.ts`, `src/renderer/stores/taskStore.test.ts`

After the backend cancel completes, `turn_end` fires. The existing `applyTurnEnd` function checks for content before appending a message:

```ts
if (chunk || finalizedTools.length > 0) {
    newMessages.push({ role: 'assistant', ... })
}
```

Since Task 2 already cleared the chunks, `applyTurnEnd` should produce no new message. Verify this with a test case:
- Set up a task with `status: 'paused'`, empty `streamingChunks`, empty `liveToolCalls`
- Call `applyTurnEnd`
- Assert no new assistant message is appended
- Assert status stays `'paused'`

## Relevant files

- `src-tauri/src/commands/acp.rs` — ACP event loop, `task_pause`, `AcpCommand` enum
- `src/renderer/hooks/useKeyboardShortcuts.ts` — Esc key handler
- `src/renderer/stores/taskStore.ts` — streaming state, `clearTurn`, `applyTurnEnd`, `initTaskListeners`
- `src/renderer/components/chat/ChatPanel.tsx` — `handlePause` callback
- `src/renderer/lib/ipc.ts` — `pauseTask` IPC wrapper
