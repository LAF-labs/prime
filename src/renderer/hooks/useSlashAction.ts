import { useCallback, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import { ipc } from '@/lib/ipc'
import { isPassthroughCommand, parseCommand, runRpcCommand, RPC_COMMANDS } from '@/lib/agent-commands'
import { track } from '@/lib/analytics'
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
 *  Works even before ACP connects (availableModes may be empty). */
const switchMode = (modeId: string, label: string): void => {
  useSettingsStore.setState({ currentModeId: modeId })
  addSystemMessage(`Switched to ${label} mode`)
  track('feature_used', { feature: 'mode_switch', detail: modeId })
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
    // Track every recognized slash command. The switch below rejects unknown
    // names by returning false, so we gate the track call on that path via
    // the `default` case.
    const KNOWN = new Set([
      'clear', 'model', 'agent', 'settings', 'upload', 'plan', 'usage', 'data',
      'close', 'exit', 'branch', 'worktree', 'btw', 'tangent', 'fork',
      'goal', 'autonomous', 'compact', 'refine',
      ...RPC_COMMANDS.map((c) => c.name),
    ])
    if (KNOWN.has(name)) {
      const mode = useSettingsStore.getState().currentModeId === 'plan' ? 'plan' : 'command'
      track('feature_used', { feature: 'slash_command', detail: name })
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
        track('feature_used', { feature: 'slash_command', detail: name })
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
    track('feature_used', { feature: 'slash_command', detail: 'btw' })
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
