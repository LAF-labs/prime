/**
 * Re-dispatch bridge for the chat send pipeline.
 *
 * Regenerate (AssistantTextRow) and edit-and-resend (UserMessageRow) need to
 * push a message through the exact same dispatch path the chat input uses —
 * checkpoint creation, dispatch snapshot, turn claiming, SQLite persistence,
 * plan-mode prefixing — without duplicating any of that logic. ChatPanel owns
 * that path (`sendMessageDirect`) and registers it here once at module load;
 * consumers call `resendMessage`.
 *
 * A registry (rather than a direct import) avoids the circular import
 * ChatPanel → MessageList → AssistantTextRow → ChatPanel.
 */

export type ResendHandler = (taskId: string, content: string) => Promise<void>

let resendHandler: ResendHandler | null = null

/** Register the send pipeline. Called once by ChatPanel at import time. */
export const registerResendHandler = (handler: ResendHandler): void => {
  resendHandler = handler
}

/** Re-dispatch `content` as a fresh user message on `taskId`'s thread. */
export const resendMessage = async (taskId: string, content: string): Promise<void> => {
  if (!resendHandler) return
  await resendHandler(taskId, content)
}
