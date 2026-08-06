/**
 * Getting a conversation out of the app.
 *
 * Until this existed there was no export of any kind: the only copies of a
 * user's conversations lived in the app's own data directory, as JSON blobs
 * and a SQLite file nothing else reads. Markdown is the format that survives
 * the app — pasteable into an issue, a doc, or another tool.
 */
import type { AgentTask, TaskMessage } from '@/types'
import { ipc } from '@/lib/ipc'
import * as threadDb from '@/lib/thread-db'

const roleHeading = (role: TaskMessage['role']): string => {
  switch (role) {
    case 'user':
      return '## User'
    case 'assistant':
      return '## Assistant'
    case 'system':
      return '> **System**'
  }
}

const renderMessage = (msg: TaskMessage): string => {
  const parts: string[] = []
  if (msg.role === 'system') {
    // System notes read best as a quoted aside, not a full section.
    return `> ${msg.content.replace(/\n/g, '\n> ')}`
  }
  parts.push(roleHeading(msg.role))
  if (msg.thinking) {
    parts.push(`<details>\n<summary>Thinking</summary>\n\n${msg.thinking}\n\n</details>`)
  }
  if (msg.content) parts.push(msg.content)
  if (msg.toolCalls?.length) {
    const lines = msg.toolCalls.map((tc) => {
      const title = tc.title || tc.kind || 'tool'
      return `- \`${title}\` — ${tc.status}`
    })
    parts.push(`**Tools**\n${lines.join('\n')}`)
  }
  return parts.join('\n\n')
}

/** The full thread as a self-contained Markdown document. */
export const buildThreadMarkdown = (task: AgentTask): string => {
  const header = [
    `# ${task.name}`,
    '',
    `- Workspace: \`${task.workspace}\``,
    `- Created: ${task.createdAt}`,
    `- Exported: ${new Date().toISOString()}`,
    '',
    '---',
  ].join('\n')
  const body = task.messages.map(renderMessage).join('\n\n---\n\n')
  return `${header}\n\n${body}\n`
}

/** A filename that survives every filesystem: no separators, no controls. */
export const exportFileName = (threadName: string): string => {
  const cleaned = threadName
    // Path separators and the characters Windows refuses. Dots stay:
    // "fix login.ts" is a better name than "fix login ts".
    .replace(/[/\\:*?"<>|]/g, ' ')
    // eslint-disable-next-line no-control-regex -- control chars are invalid in filenames
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return `${cleaned || 'conversation'}.md`
}

/** The sidebar knows this much about a thread; export finds the rest. */
export interface ExportableThread {
  id: string
  name: string
  workspace: string
  createdAt: string
  messages?: TaskMessage[]
}

/**
 * Export a thread through the native save dialog.
 *
 * Sidebar rows are metadata-only, so the messages come from wherever they
 * currently live: the in-memory store for open threads, SQLite for archived
 * ones. Returns the written path, or null if the user cancelled.
 */
export const exportThread = async (thread: ExportableThread): Promise<string | null> => {
  let messages = thread.messages ?? []
  if (messages.length === 0) {
    const { useTaskStore } = await import('@/stores/taskStore')
    messages = useTaskStore.getState().tasks[thread.id]?.messages ?? []
  }
  if (messages.length === 0) {
    const fromDb = await threadDb.loadFullThread(thread.id)
    if (fromDb) messages = fromDb.messages
  }
  const markdown = buildThreadMarkdown({ ...thread, messages } as AgentTask)
  return ipc.exportTextFile(exportFileName(thread.name), markdown)
}
