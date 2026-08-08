import { ipc } from '@/lib/ipc'

/**
 * The one commit-message contract for every Commit affordance.
 *
 * The CodePanel and the CommitDialog both offer a "Commit" verb; they must
 * agree on what a blank message means. The dialog's answer — auto-generate —
 * is the contract, and this helper is the shared generation step: ask the
 * backend generator and join subject/body identically everywhere.
 */
export const generateAiCommitMessage = async (workspace: string): Promise<string> => {
  const result = await ipc.gitGenerateCommitMessage(workspace)
  return result.body.trim().length > 0
    ? `${result.subject}\n\n${result.body}`
    : result.subject
}
