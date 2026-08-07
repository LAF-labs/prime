import { useCallback, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore, markThreadCleared } from '@/stores/taskStore'
import * as threadDb from '@/lib/thread-db'
import { attempt } from '@/lib/ipc-report'
import { t } from '@/lib/i18n'
import { isPassthroughCommand, parseCommand, runRpcCommand, GUI_COMMANDS, RPC_COMMANDS } from '@/lib/agent-commands'
import { useDebugStore } from '@/stores/debugStore'
import { record } from '@/lib/analytics-collector'

export type SlashPanel = 'model' | 'agent' | 'branch' | 'worktree' | null

export interface SlashActionResult {
  panel: SlashPanel
  dismissPanel: () => void
  execute: (commandName: string) => boolean
  /** Handle full input text for commands like /btw that need arguments. Returns true if handled. */
  executeFullInput: (input: string) => boolean
}

const bare = (name: string): string => name.replace(/^\/+/, '')

/** Add a system message to the current task's chat */
const addSystemMessage = (text: string): void => {
  const { selectedTaskId, tasks, upsertTask } = useTaskStore.getState()
  if (!selectedTaskId || !tasks[selectedTaskId]) return
  const task = tasks[selectedTaskId]
  upsertTask({
    ...task,
    messages: [...task.messages, { role: 'system', content: text, timestamp: new Date().toISOString() }],
  })
}

/** Switch mode optimistically, then confirm via IPC.
 *  Works even before the agent connects (availableModes may be empty). */
const switchMode = (modeId: string, label: string): void => {
  useSettingsStore.setState({ currentModeId: modeId })
  addSystemMessage(`Switched to ${label} mode`)
  record('mode_switch', { detail: modeId })
  const taskId = useTaskStore.getState().selectedTaskId
  if (taskId) {
    // Plan mode is applied client-side per message; nothing to sync.
    useTaskStore.getState().setTaskMode(taskId, modeId)
  }
}

export const useSlashAction = (): SlashActionResult => {
  const [panel, setPanel] = useState<SlashPanel>(null)

  const execute = useCallback((commandName: string): boolean => {
    const name = bare(commandName)
    // Record every recognized slash command for the local usage dashboard.
    const KNOWN = new Set([
      ...GUI_COMMANDS.map((c) => c.name),
      ...RPC_COMMANDS.map((c) => c.name),
      'goal', 'autonomous', 'compact', 'refine',
    ])
    if (KNOWN.has(name)) {
      const mode = useSettingsStore.getState().currentModeId === 'plan' ? 'plan' : 'command'
      record('slash_cmd', { detail: `${name}:${mode}` })
    }
    switch (name) {
      case 'clear': {
        const { selectedTaskId, tasks, clearTurn } = useTaskStore.getState()
        if (selectedTaskId && tasks[selectedTaskId]) {
          // Directly set messages to [] — bypasses upsertTask's merge logic
          useTaskStore.setState((s) => {
            const task = s.tasks[selectedTaskId]
            if (!task) return s
            return { tasks: { ...s.tasks, [selectedTaskId]: { ...task, messages: [] } } }
          })
          clearTurn(selectedTaskId)
          // The clear must reach SQLite (source of truth) and the JSON index,
          // or the "cleared" conversation resurrects verbatim on the next
          // launch — for a command people use to remove sensitive content.
          markThreadCleared(selectedTaskId)
          attempt(t('Could not clear the conversation'), threadDb.replaceMessages(selectedTaskId, []))
          useTaskStore.getState().persistHistory()
        }
        setPanel(null)
        return true
      }
      case 'model':
      case 'agent':
        // Fall through to pass-through so the slash command picker inserts
        // "/model " or "/agent " into the input. The inline quick-swap picker
        // (see InlineCommandPicker) then renders for fuzzy filtering.
        setPanel(null)
        return false
      case 'settings':
        useTaskStore.getState().setSettingsOpen(true)
        setPanel(null)
        return true
      // CLI names for places the app already has. prime-agent's own /login and
      // /logout edit the same auth.json the provider settings write to.
      case 'login':
      case 'logout':
        useTaskStore.getState().setSettingsOpen(true, 'account')
        setPanel(null)
        return true
      case 'hotkeys':
        useTaskStore.getState().setSettingsOpen(true, 'keymap')
        setPanel(null)
        return true
      case 'logs':
        useDebugStore.getState().setOpen(true)
        setPanel(null)
        return true
      case 'changelog':
        document.dispatchEvent(new CustomEvent('slash-changelog'))
        setPanel(null)
        return true
      case 'mcp':
        document.dispatchEvent(new CustomEvent('slash-mcp'))
        setPanel(null)
        return true
      case 'new': {
        // Same thing the "+" button does: drop back to the composer for this
        // project so the next message opens a fresh thread.
        const { selectedTaskId, tasks, setPendingWorkspace, setSelectedTask } = useTaskStore.getState()
        const workspace = selectedTaskId ? tasks[selectedTaskId]?.workspace : null
        if (workspace) {
          setSelectedTask(null)
          setPendingWorkspace(workspace)
        }
        setPanel(null)
        return true
      }
      case 'upload':
        // Trigger the hidden file input — dispatched as a custom event picked up by ChatInput
        document.dispatchEvent(new CustomEvent('slash-upload'))
        setPanel(null)
        return true
      case 'usage':
      case 'data':
        useTaskStore.getState().setView('analytics')
        setPanel(null)
        return true
      case 'plan': {
        const current = useSettingsStore.getState().currentModeId
        if (current === 'plan') {
          switchMode('code', 'Default')
        } else {
          switchMode('plan', 'Plan')
        }
        setPanel(null)
        return true
      }
      case 'close':
      case 'exit': {
        const { selectedTaskId, archiveTask, pendingWorkspace, setPendingWorkspace } = useTaskStore.getState()
        if (selectedTaskId) {
          archiveTask(selectedTaskId)
        } else if (pendingWorkspace) {
          setPendingWorkspace(null)
        }
        setPanel(null)
        return true
      }
      case 'branch':
        setPanel((p) => (p === 'branch' ? null : 'branch'))
        return true
      case 'worktree':
        setPanel((p) => (p === 'worktree' ? null : 'worktree'))
        return true
      case 'btw':
      case 'tangent': {
        // When selected from the picker, exit btw mode if active
        const { btwCheckpoint, exitBtwMode } = useTaskStore.getState()
        if (btwCheckpoint) {
          exitBtwMode(false)
          setPanel(null)
          return true
        }
        // Not in btw mode — return false so the picker inserts "/btw " for the user to type a question
        setPanel(null)
        return false
      }
      case 'fork': {
        const { selectedTaskId, forkTask } = useTaskStore.getState()
        if (selectedTaskId) void forkTask(selectedTaskId)
        setPanel(null)
        return true
      }
      default: {
        setPanel(null)
        // Session commands (/goal, /autonomous, /compact, /refine) are executed
        // by the agent itself — returning false lets the picker insert the
        // command so the user can add arguments, then it ships as a prompt.
        if (isPassthroughCommand(name)) return false
        // RPC-backed commands with no arguments run immediately; the ones that
        // take arguments fall through so the user can type them.
        if (RPC_COMMANDS.some((c) => c.name === name)) {
          const spec = RPC_COMMANDS.find((c) => c.name === name)
          if (spec?.argumentHint) return false
          const taskId = useTaskStore.getState().selectedTaskId
          if (!taskId) {
            addSystemMessage('Open a thread first.')
            return true
          }
          void runRpcCommand(taskId, name, '')
            .then((r) => { if (r.message) addSystemMessage(r.message) })
            .catch((e) => addSystemMessage(`⚠️ /${name} failed: ${e instanceof Error ? e.message : String(e)}`))
          return true
        }
        return false
      }
    }
  }, [])

  const executeFullInput = useCallback((input: string): boolean => {
    const trimmed = input.trim()
    // RPC-backed commands that take arguments (e.g. "/name my session").
    if (trimmed.startsWith('/')) {
      const { name, rest } = parseCommand(trimmed)
      if (RPC_COMMANDS.some((c) => c.name === name)) {
        const taskId = useTaskStore.getState().selectedTaskId
        if (!taskId) {
          addSystemMessage('Open a thread first.')
          return true
        }
        void runRpcCommand(taskId, name, rest)
          .then((r) => { if (r.message) addSystemMessage(r.message) })
          .catch((e) => addSystemMessage(`⚠️ /${name} failed: ${e instanceof Error ? e.message : String(e)}`))
        return true
      }
    }
    // Match /btw or /tangent at the start
    const match = trimmed.match(/^\/(?:btw|tangent)\b(.*)$/i)
    if (!match) return false
    const arg = match[1].trim()
    const { selectedTaskId, btwCheckpoint, exitBtwMode, enterBtwMode } = useTaskStore.getState()
    // If already in btw mode, exit
    if (btwCheckpoint) {
      const keepTail = arg.toLowerCase() === 'tail'
      exitBtwMode(keepTail)
      return true
    }
    // Enter btw mode with a question
    if (!arg) return true // no question = no-op
    if (selectedTaskId) enterBtwMode(selectedTaskId, arg)
    // Return false so the caller sends the question as a message (PendingChat handles btw entry after task creation)
    return false
  }, [])

  const dismissPanel = useCallback(() => setPanel(null), [])

  return { panel, dismissPanel, execute, executeFullInput }
}
