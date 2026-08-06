import { t } from '@/lib/i18n'
import { toast } from 'sonner'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { IconHistory } from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { applyTurnEnd } from '@/stores/task-store-listeners'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { PermissionBanner } from './PermissionBanner'
import { CompactSuggestBanner } from './CompactSuggestBanner'
import { TerminalDrawer } from './TerminalDrawer'
import { QueuedMessages } from './QueuedMessages'
import { SearchBar } from './SearchBar'
import { SearchQueryContext } from './HighlightText'
import { BtwOverlay } from './BtwOverlay'
import { PanelProvider } from './PanelContext'
import { StickyTaskList } from './StickyTaskList'

import { useMessageSearch } from '@/hooks/useMessageSearch'
import { ipc } from '@/lib/ipc'
import { resolveModelId } from '@/lib/resolve-model'
import { record } from '@/lib/analytics-collector'
import * as threadDb from '@/lib/thread-db'
import {
  EMPTY_MESSAGES,
  EMPTY_TOOL_CALLS,
  EMPTY_TOOL_SPLITS,
  EMPTY_OPTIONS,
  EMPTY_QUEUE,
  deriveInputState,
  shouldQueueMessage,
  isTaskRunning,
  isPanelFocused,
  isBtwModeActive,
  needsNewConnection,
  extractProjectName,
  buildUserMessage,
  captureDispatchSnapshot,
} from './ChatPanel.logic'
import type { AgentTask, IpcAttachment, TaskMessage } from '@/types'
import type { TimelineRow } from '@/lib/timeline'

/** Plan mode is a client-side behavior: prime-agent has no session modes, so
 *  we steer the model per message instead of pretending to switch agents. */
const PLAN_MODE_PREFIX =
  '[Plan mode] Research and present a concrete plan first. ' +
  'Do not edit files, run mutating commands, or commit anything until the user explicitly approves the plan.\n\n'
const applyPlanMode = (msg: string, modeId?: string | null): string =>
  modeId === 'plan' ? `${PLAN_MODE_PREFIX}${msg}` : msg

/**
 * Owns the streaming selectors so ChatPanel doesn't re-render on every token.
 */
const StreamingMessageList = memo(function StreamingMessageList({
  taskId: taskIdProp,
  isRunning,
  searchMatchIds,
  activeMatchId,
  onTimelineRows,
  headerContent,
  workspace,
}: {
  taskId?: string | null
  isRunning: boolean
  searchMatchIds?: string[]
  activeMatchId?: string | null
  onTimelineRows?: (rows: TimelineRow[]) => void
  headerContent?: React.ReactNode
  workspace?: string | null
}) {
  const storeSelectedId = useTaskStore((s) => s.selectedTaskId)
  const resolvedId = taskIdProp ?? storeSelectedId
  const messages = useTaskStore((s) => resolvedId ? s.tasks[resolvedId]?.messages ?? EMPTY_MESSAGES : EMPTY_MESSAGES)
  const streamingChunk = useTaskStore((s) => (s.btwCheckpoint?.taskId === resolvedId) ? '' : resolvedId ? s.streamingChunks[resolvedId] ?? '' : '')
  const liveToolCalls = useTaskStore((s) => (s.btwCheckpoint?.taskId === resolvedId) ? EMPTY_TOOL_CALLS : resolvedId ? s.liveToolCalls[resolvedId] ?? EMPTY_TOOL_CALLS : EMPTY_TOOL_CALLS)
  const liveToolSplits = useTaskStore((s) => (s.btwCheckpoint?.taskId === resolvedId) ? EMPTY_TOOL_SPLITS : resolvedId ? s.liveToolSplits[resolvedId] ?? EMPTY_TOOL_SPLITS : EMPTY_TOOL_SPLITS)
  const liveThinking = useTaskStore((s) => (s.btwCheckpoint?.taskId === resolvedId) ? '' : resolvedId ? s.thinkingChunks[resolvedId] ?? '' : '')
  const inlineToolCalls = useSettingsStore((s) => s.settings.inlineToolCalls !== false)

  return (
    <MessageList
      taskId={resolvedId}
      messages={messages}
      streamingChunk={streamingChunk}
      liveToolCalls={liveToolCalls}
      liveToolSplits={liveToolSplits}
      liveThinking={liveThinking}
      isRunning={isRunning}
      inlineToolCalls={inlineToolCalls}
      searchMatchIds={searchMatchIds}
      activeMatchId={activeMatchId}
      onTimelineRows={onTimelineRows}
      headerContent={headerContent}
      workspace={workspace}
    />
  )
})

/** Send a message directly to the backend for a specific task. */
async function sendMessageDirect(targetTaskId: string, msg: string, attachments?: IpcAttachment[]): Promise<void> {
  const state = useTaskStore.getState()
  const task = state.tasks[targetTaskId]
  if (!task) return
  const shouldCreateNew = needsNewConnection(task)
  // Resumed-from-history: keep the original thread id and replay the prior
  // transcript so the fresh prime-agent subprocess has context.
  const isResumed = shouldCreateNew && (task.isArchived === true || task.needsNewConnection === true) && task.messages.length > 0

  // Capture the dispatch snapshot BEFORE we mutate the task. The snapshot
  // records the pre-send state (status, message count, streaming buffer)
  // so the UI can derive a "Sending… → Agent starting… → streaming" phase
  // without polling. The turn_end listener clears the snapshot.
  const streamingChunk = state.streamingChunks[targetTaskId] ?? ''
  state.setDispatchSnapshot(targetTaskId, captureDispatchSnapshot(task, streamingChunk))

  const userMsg = buildUserMessage(msg)
  state.upsertTask({ ...task, status: 'running', messages: [...task.messages, userMsg], isArchived: undefined, needsNewConnection: undefined })
  state.clearTurn(task.id)

  // Persist user message to SQLite immediately (survives crashes)
  threadDb.saveThread(task).catch(() => {})
  threadDb.saveMessage(targetTaskId, userMsg).catch(() => {})

  const proj = extractProjectName(task)
  record('message_sent', { project: proj, thread: task.id, value: msg.split(/\s+/).filter(Boolean).length })

  // Snapshot HEAD before the agent touches the tree so a turn can be rolled
  // back from the timeline. Best-effort: no-op outside git repositories.
  ipc.checkpointCreate(targetTaskId, task.messages.length).catch(() => {})

  try {
    await dispatchToAgent(targetTaskId, msg, attachments, { task, state, userMsg, shouldCreateNew, isResumed, proj })
  } catch (err) {
    // Without this the rejection floats: the message sits in the timeline with
    // a spinner and nothing changes until the five-minute watchdog. Put the
    // thread back to a state the user can act on and say what happened.
    const detail = err instanceof Error ? err.message : String(err)
    const current = useTaskStore.getState().tasks[targetTaskId]
    if (current) {
      useTaskStore.getState().upsertTask({ ...current, status: 'paused' })
    }
    useTaskStore.getState().setDispatchSnapshot(targetTaskId, null)
    toast.error(t('Could not send the message'), { description: detail })
  }
}

interface DispatchContext {
  task: AgentTask
  state: ReturnType<typeof useTaskStore.getState>
  userMsg: TaskMessage
  shouldCreateNew: boolean
  isResumed: boolean
  proj: string | undefined
}

async function dispatchToAgent(
  targetTaskId: string,
  msg: string,
  attachments: IpcAttachment[] | undefined,
  { task, state, userMsg, shouldCreateNew, isResumed, proj }: DispatchContext,
): Promise<void> {
  if (shouldCreateNew) {
    const { settings, currentModeId, currentModelId } = useSettingsStore.getState()
    const taskState = useTaskStore.getState()
    const projectRoot = task.originalWorkspace ?? task.workspace
    const projectPrefs = projectRoot ? settings.projectPrefs?.[projectRoot] : undefined
    const autoApprove = projectPrefs?.autoApprove !== undefined ? projectPrefs.autoApprove : settings.autoApprove
    const modeId = taskState.taskModes[targetTaskId] ?? currentModeId
    const effectiveModeId = modeId && modeId !== 'code' ? modeId : undefined
    const taskModelId = taskState.taskModels[targetTaskId]
    const modelId = resolveModelId({ taskModelId, projectPrefs, settings, currentModelId })
    const created = await ipc.createTask({
      name: task.name,
      workspace: task.workspace,
      prompt: applyPlanMode(msg, effectiveModeId),
      autoApprove,
      modeId: effectiveModeId,
      attachments,
      ...(isResumed
        ? {
            existingId: task.id,
            ...(task.sessionFile ? { sessionFile: task.sessionFile } : {}),
            existingMessages: task.messages.map((m) => ({
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
              ...(m.thinking ? { thinking: m.thinking } : {}),
              // Carry tool data through the resumption round-trip. The
              // backend's TaskMessage struct doesn't model `toolCallSplits`,
              // so the field is dropped at deserialization on the Rust side
              // — but we still send it here so that any future backend
              // version that adds the field will get it, and so the
              // intent of the mapping is explicit.
              ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
              ...(m.toolCallSplits ? { toolCallSplits: m.toolCallSplits } : {}),
            })),
          }
        : {}),
    })
    const draft = useTaskStore.getState().tasks[task.id]
    const messages = draft?.messages.length ? draft.messages : [userMsg]
    // Clear isArchived/needsNewConnection so the thread becomes a normal live
    // thread in the sidebar (no more "view only" affordances).
    state.upsertTask({ ...created, messages, needsNewConnection: undefined, isArchived: undefined })
    record('thread_created', { project: proj, thread: created.id })
    const resolvedMode = taskState.taskModes[targetTaskId] ?? currentModeId
    if (resolvedMode && resolvedMode !== 'code') {
      useTaskStore.getState().setTaskMode(created.id, resolvedMode)
    }
    // Re-key the dispatch snapshot from the draft id to the backend-assigned
    // id atomically so a concurrent `turn_end` event can't observe the
    // snapshot missing from both keys.
    if (created.id !== targetTaskId) {
      useTaskStore.getState().rekeyDispatchSnapshot(targetTaskId, created.id)
    }
    state.setSelectedTask(created.id)
  } else {
    const liveMode = useTaskStore.getState().taskModes[task.id] ?? useSettingsStore.getState().currentModeId
    // Awaited, not floated: the backend reports a closed connection here, and
    // that is the difference between an error the user sees now and a spinner
    // that runs for five minutes.
    await ipc.sendMessage(task.id, applyPlanMode(msg, liveMode), attachments)
  }
}

/** Soft banner shown above resumed-from-history threads.
 *  Indicates that a fresh agent connection will be spawned on the next send,
 *  but the input remains active (stateless resumption). */
const ArchivedBanner = memo(function ArchivedBanner() {
  return (
    <div className="relative flex items-center justify-center py-4 px-6 select-none" data-testid="chat-archived-banner">
      <svg className="flex-1 h-3 text-blue-600/30 dark:text-blue-400/30" preserveAspectRatio="none" viewBox="0 0 120 12">
        <path d="M0,6 L5,0 L10,6 L15,0 L20,6 L25,0 L30,6 L35,0 L40,6 L45,0 L50,6 L55,0 L60,6 L65,0 L70,6 L75,0 L80,6 L85,0 L90,6 L95,0 L100,6 L105,0 L110,6 L115,0 L120,6" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
      <div className="flex shrink-0 items-center gap-1.5 mx-3 rounded-full border border-blue-400/20 bg-card px-3 py-1">
        <IconHistory className="size-3 text-blue-600/50 dark:text-blue-400/50" />
        <span className="text-[11px] font-medium text-blue-500/60 dark:text-blue-300/50">Resumed from history — agent reconnects on next send</span>
      </div>
      <svg className="flex-1 h-3 text-blue-600/30 dark:text-blue-400/30" preserveAspectRatio="none" viewBox="0 0 120 12">
        <path d="M0,6 L5,0 L10,6 L15,0 L20,6 L25,0 L30,6 L35,0 L40,6 L45,0 L50,6 L55,0 L60,6 L65,0 L70,6 L75,0 L80,6 L85,0 L90,6 L95,0 L100,6 L105,0 L110,6 L115,0 L120,6" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    </div>
  )
})

interface ChatPanelProps {
  /** Override the task ID to display. When omitted, uses selectedTaskId from the store. */
  taskId?: string | null
}

export const ChatPanel = memo(function ChatPanel({ taskId: taskIdProp }: ChatPanelProps) {
  const storeSelectedId = useTaskStore((s) => s.selectedTaskId)
  const resolvedTaskId = taskIdProp ?? storeSelectedId
  const taskStatus = useTaskStore((s) => resolvedTaskId ? s.tasks[resolvedTaskId]?.status : null)
  const isArchived = useTaskStore((s) => resolvedTaskId ? s.tasks[resolvedTaskId]?.isArchived === true : false)
  const pendingPermission = useTaskStore((s) => resolvedTaskId ? s.tasks[resolvedTaskId]?.pendingPermission : null)
  const contextUsage = useTaskStore((s) => resolvedTaskId ? s.tasks[resolvedTaskId]?.contextUsage : null)
  const taskModeId = useTaskStore((s) => resolvedTaskId ? s.taskModes[resolvedTaskId] ?? null : null)
  const globalModeId = useSettingsStore((s) => s.currentModeId)
  const isPlanMode = (taskModeId ?? globalModeId) === 'plan'
  const taskWorkspace = useTaskStore((s) => resolvedTaskId ? s.tasks[resolvedTaskId]?.workspace : null)
  const isWorktree = useTaskStore((s) => resolvedTaskId ? !!s.tasks[resolvedTaskId]?.worktreePath : false)
  const messageCount = useTaskStore((s) => resolvedTaskId ? s.tasks[resolvedTaskId]?.messages?.length ?? 0 : 0)
  const terminalOpen = useTaskStore((s) => resolvedTaskId ? s.terminalOpenTasks.has(resolvedTaskId) : false)
  const toggleTerminal = useTaskStore((s) => s.toggleTerminal)
  const queuedMessages = useTaskStore((s) => resolvedTaskId ? s.queuedMessages[resolvedTaskId] ?? EMPTY_QUEUE : EMPTY_QUEUE)
  const isBtwMode = useTaskStore((s) => isBtwModeActive(s.btwCheckpoint, resolvedTaskId))
  // In split view, determine if this panel is the focused one (for drag/drop scoping)
  const isFocusedPanel = useTaskStore((s) => isPanelFocused(s.activeSplitId, taskIdProp, s.splitViews, s.focusedPanel))

  const timelineRowsRef = useRef<TimelineRow[]>([])
  const [timelineRows, setTimelineRows] = useState<TimelineRow[]>([])
  const handleTimelineRows = useCallback((rows: TimelineRow[]) => {
    if (rows !== timelineRowsRef.current) {
      timelineRowsRef.current = rows
      setTimelineRows(rows)
    }
  }, [])

  const search = useMessageSearch(timelineRows)

  const prevTaskIdRef = useRef(resolvedTaskId)
  useEffect(() => {
    if (prevTaskIdRef.current !== resolvedTaskId && search.isOpen) {
      search.close()
    }
    prevTaskIdRef.current = resolvedTaskId
  }, [resolvedTaskId, search])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        if (search.isOpen) {
          search.close()
        } else {
          search.open()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [search])

  const handleSendMessage = useCallback(async (msg: string, attachments?: IpcAttachment[]) => {
    const state = useTaskStore.getState()
    const id = resolvedTaskId
    const task = id ? state.tasks[id] : null
    if (!task || !id) return

    const btwActive = isBtwModeActive(state.btwCheckpoint, id)
    if (shouldQueueMessage(task, btwActive)) {
      state.enqueueMessage(task.id, msg, attachments)
      return
    }

    await sendMessageDirect(id, msg, attachments)
  }, [resolvedTaskId])

  const handleRemoveQueued = useCallback((index: number) => {
    if (resolvedTaskId) useTaskStore.getState().removeQueuedMessage(resolvedTaskId, index)
  }, [resolvedTaskId])

  const handleSteer = useCallback(async (index: number) => {
    const state = useTaskStore.getState()
    const id = resolvedTaskId
    if (!id) return
    const queued = state.queuedMessages[id]?.[index]
    if (!queued) return
    // Remove from queue BEFORE pausing — the onTurnEnd handler auto-sends
    // the first queued message, so it must be gone before the pause completes.
    state.removeQueuedMessage(id, index)
    await ipc.pauseTask(id)
    useTaskStore.setState((s) => applyTurnEnd(s, id))
    await sendMessageDirect(id, queued.text, queued.attachments ? [...queued.attachments] : undefined)
  }, [resolvedTaskId])

  const handleReorderQueued = useCallback((from: number, to: number) => {
    if (resolvedTaskId) useTaskStore.getState().reorderQueuedMessage(resolvedTaskId, from, to)
  }, [resolvedTaskId])

  const handleEditQueued = useCallback((index: number) => {
    const state = useTaskStore.getState()
    const id = resolvedTaskId
    if (!id) return
    const queued = state.queuedMessages[id]?.[index]
    if (!queued) return
    state.removeQueuedMessage(id, index)
    document.dispatchEvent(new CustomEvent('queue-edit-message', { detail: { text: queued.text } }))
  }, [resolvedTaskId])

  const [isInputCollapsed, setIsInputCollapsed] = useState(false)
  const handleToggleCollapse = useCallback(() => setIsInputCollapsed((v) => !v), [])

  const handlePermissionSelect = useCallback((optionId: string) => {
    const state = useTaskStore.getState()
    const task = resolvedTaskId ? state.tasks[resolvedTaskId] : null
    if (task?.pendingPermission) {
      ipc.selectPermissionOption(task.id, task.pendingPermission.requestId, optionId).catch(() => {})
    }
  }, [resolvedTaskId])

  const handlePause = useCallback(() => {
    if (resolvedTaskId) ipc.pauseTask(resolvedTaskId)
  }, [resolvedTaskId])

  if (!taskStatus) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>LAF Agent</EmptyTitle>
          <EmptyDescription>{t('Select a task or create a new one to get started.')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const isRunning = isTaskRunning(taskStatus)
  const { disabled: inputDisabled, disabledReason } = deriveInputState(
    resolvedTaskId ? { status: taskStatus, isArchived } : null,
  )

  const searchQuery = search.isOpen ? search.query : ''

  const content = (
    <div data-testid="chat-panel" className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col" style={{ fontSize: 'var(--chat-font-size, 15px)' }}>
      {isBtwMode && <BtwOverlay taskId={resolvedTaskId} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {search.isOpen && (
          <div className="shrink-0">
            <SearchBar
              query={search.query}
              matchCount={search.matchCount}
              activeIndex={search.activeIndex}
              onQueryChange={search.setQuery}
              onNext={search.goToNext}
              onPrevious={search.goToPrevious}
              onClose={search.close}
            />
          </div>
        )}

        <SearchQueryContext.Provider value={searchQuery}>
          <StreamingMessageList
            taskId={resolvedTaskId}
            isRunning={isRunning && !isBtwMode}
            searchMatchIds={search.isOpen ? search.matchIds : undefined}
            activeMatchId={search.isOpen ? search.activeMatchId : undefined}
            onTimelineRows={handleTimelineRows}
            headerContent={undefined}
            workspace={taskWorkspace}
          />
        </SearchQueryContext.Provider>

        {isArchived && !isRunning && <ArchivedBanner />}

        {pendingPermission && resolvedTaskId && (
          <PermissionBanner
            taskId={resolvedTaskId}
            toolName={pendingPermission.toolName}
            description={pendingPermission.description}
            options={pendingPermission.options ?? EMPTY_OPTIONS}
            onSelect={handlePermissionSelect}
          />
        )}

        <CompactSuggestBanner contextUsage={contextUsage} isPlanMode={isPlanMode} />

        <QueuedMessages messages={queuedMessages} onRemove={handleRemoveQueued} onReorder={handleReorderQueued} onSteer={isRunning ? handleSteer : undefined} onEdit={handleEditQueued} />

        <StickyTaskList taskId={resolvedTaskId} />

        <ChatInput
          disabled={inputDisabled}
          disabledReason={disabledReason}
          contextUsage={contextUsage}
          messageCount={messageCount}
          isRunning={isRunning}
          isActive={isFocusedPanel}
          taskId={resolvedTaskId}
          hasQueuedMessages={queuedMessages.length > 0}
          onSendMessage={handleSendMessage}
          onPause={handlePause}
          workspace={taskWorkspace}
          isWorktree={isWorktree}
          isCollapsed={isInputCollapsed}
          onToggleCollapse={handleToggleCollapse}
        />
      </div>
      {terminalOpen && taskWorkspace && resolvedTaskId && (
        <TerminalDrawer key={resolvedTaskId} cwd={taskWorkspace} slotId={resolvedTaskId} onClose={() => toggleTerminal(resolvedTaskId)} />
      )}
    </div>
  )

  // In split mode, wrap with PanelProvider so child components (ModelPicker, PlanToggle, etc.)
  // can resolve the panel's task ID instead of reading global state
  if (taskIdProp) {
    return <PanelProvider value={taskIdProp}>{content}</PanelProvider>
  }
  return content
})
