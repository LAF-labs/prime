import { memo, useCallback, useState } from 'react'
import { IconWriting, IconArrowRight } from '@tabler/icons-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import { usePanelResolvedTaskId } from './PanelContext'
import { ipc } from '@/lib/ipc'

const COMPACT_SUGGEST_THRESHOLD = 30
const HANDOFF_MESSAGE = 'Go ahead working on the plan'

interface CompactSuggestBannerProps {
  contextUsage: { used: number; size: number } | null | undefined
  isPlanMode: boolean
}

export const CompactSuggestBanner = memo(function CompactSuggestBanner({
  contextUsage,
  isPlanMode,
}: CompactSuggestBannerProps) {
  const resolvedTaskId = usePanelResolvedTaskId()
  const [isSwitching, setIsSwitching] = useState(false)

  const handleStartBuilding = useCallback(() => {
    const taskId = resolvedTaskId
    if (!taskId || isSwitching) return
    setIsSwitching(true)
    useSettingsStore.setState({ currentModeId: 'kiro_default' })
    useTaskStore.getState().setTaskMode(taskId, 'kiro_default')
    ipc.setMode(taskId, 'kiro_default').then(() => {
      const state = useTaskStore.getState()
      const task = state.tasks[taskId]
      if (!task) return
      const userMsg = { role: 'user' as const, content: HANDOFF_MESSAGE, timestamp: new Date().toISOString() }
      state.upsertTask({ ...task, status: 'running', messages: [...task.messages, userMsg] })
      state.clearTurn(taskId)
      ipc.sendMessage(taskId, HANDOFF_MESSAGE)
    }).catch(() => setIsSwitching(false))
  }, [isSwitching, resolvedTaskId])

  if (!isPlanMode) return null
  if (!contextUsage || contextUsage.size === 0) return null

  const pct = Math.round((contextUsage.used / contextUsage.size) * 100)
  if (pct < COMPACT_SUGGEST_THRESHOLD) return null

  return (
    <div data-testid="compact-suggest-banner" role="status" className="mb-1.5">
      <div className="mx-auto flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground/60">
        <IconWriting className="size-3.5 shrink-0" aria-hidden />
        <span>{pct}% context used ·</span>
        <button
          type="button"
          onClick={handleStartBuilding}
          disabled={isSwitching}
          aria-label="Implement now with fresh context"
          className="inline-flex items-center gap-0.5 text-teal-500/80 underline decoration-teal-500/30 underline-offset-2 transition-colors hover:text-teal-500 hover:decoration-teal-500/50 disabled:opacity-50"
        >
          {isSwitching ? 'Switching…' : 'Implement now with fresh context'}
          {!isSwitching && <IconArrowRight className="size-3" aria-hidden />}
        </button>
      </div>
    </div>
  )
})
