/**
 * Checkpoint Timeline — displays per-turn checkpoints for a task.
 * Allows viewing diffs between turns and reverting to a previous state.
 * All logic lives in the Rust backend; this is a pure display component.
 */
import { memo, useEffect, useState, useCallback } from 'react'
import {
  IconCamera, IconRefresh, IconArrowBackUp, IconLoader2,
  IconChevronRight, IconAlertTriangle,
} from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Checkpoint {
  turn: number
  refName: string
  oid: string
  message: string
  timestamp: number
}

interface CheckpointTimelineProps {
  taskId: string
  onViewDiff?: (patch: string) => void
}

function relativeTime(timestamp: number): string {
  const now = Date.now() / 1000
  const diff = now - timestamp
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

export const CheckpointTimeline = memo(function CheckpointTimeline({ taskId, onViewDiff }: CheckpointTimelineProps) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [loading, setLoading] = useState(false)
  const [revertConfirm, setRevertConfirm] = useState<number | null>(null)
  const [diffLoading, setDiffLoading] = useState<string | null>(null)

  const fetchCheckpoints = useCallback(async () => {
    if (!taskId) return
    setLoading(true)
    try {
      const list = await ipc.checkpointList(taskId)
      setCheckpoints(list)
    } catch {
      setCheckpoints([])
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { void fetchCheckpoints() }, [fetchCheckpoints])

  const handleViewTurnDiff = useCallback(async (fromTurn: number, toTurn: number) => {
    if (!taskId || !onViewDiff) return
    const key = `${fromTurn}-${toTurn}`
    setDiffLoading(key)
    try {
      const result = await ipc.checkpointDiff(taskId, fromTurn, toTurn)
      onViewDiff(result.patch)
    } catch { /* ignore */ }
    finally { setDiffLoading(null) }
  }, [taskId, onViewDiff])

  const handleRevert = useCallback(async (turn: number) => {
    if (!taskId) return
    try {
      await ipc.checkpointRevert(taskId, turn, true)
      setRevertConfirm(null)
      void fetchCheckpoints()
    } catch { /* ignore */ }
  }, [taskId, fetchCheckpoints])

  if (checkpoints.length === 0 && !loading) {
    return null // Don't render anything if no checkpoints exist
  }

  return (
    <div className="border-b border-border/40">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60">
          <IconCamera className="size-3" />
          <span>Checkpoints</span>
          {checkpoints.length > 0 && (
            <span className="text-muted-foreground/40">({checkpoints.length})</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void fetchCheckpoints()}
          className="rounded p-0.5 text-muted-foreground/40 hover:text-foreground"
        >
          {loading ? <IconLoader2 className="size-3 animate-spin" /> : <IconRefresh className="size-3" />}
        </button>
      </div>

      {/* Timeline */}
      <div className="flex items-center gap-0.5 overflow-x-auto px-3 pb-2">
        {checkpoints.map((cp, idx) => {
          const isLast = idx === checkpoints.length - 1
          const diffKey = idx > 0 ? `${checkpoints[idx - 1].turn}-${cp.turn}` : null

          return (
            <div key={cp.turn} className="flex items-center">
              {/* Checkpoint dot */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      if (idx > 0 && onViewDiff) {
                        void handleViewTurnDiff(checkpoints[idx - 1].turn, cp.turn)
                      }
                    }}
                    className={cn(
                      'relative flex size-6 items-center justify-center rounded-full border transition-colors',
                      isLast
                        ? 'border-blue-500/50 bg-blue-500/10 text-blue-500'
                        : 'border-border/60 bg-muted/30 text-muted-foreground/60 hover:border-foreground/30 hover:text-foreground/80',
                      diffLoading === diffKey && 'animate-pulse',
                    )}
                  >
                    <span className="text-[9px] font-mono font-bold">{cp.turn}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px]">
                  <div className="text-[11px]">
                    <div className="font-medium">Turn {cp.turn}</div>
                    <div className="text-muted-foreground">{cp.message || 'No commit message'}</div>
                    <div className="text-muted-foreground/60">{relativeTime(cp.timestamp)}</div>
                    {idx > 0 && <div className="mt-1 text-blue-400">Click to view turn diff</div>}
                  </div>
                </TooltipContent>
              </Tooltip>

              {/* Revert button (on hover) */}
              {!isLast && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        if (revertConfirm === cp.turn) {
                          void handleRevert(cp.turn)
                        } else {
                          setRevertConfirm(cp.turn)
                          setTimeout(() => setRevertConfirm(null), 3000)
                        }
                      }}
                      className={cn(
                        'ml-0.5 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100',
                        revertConfirm === cp.turn
                          ? 'text-orange-500 opacity-100'
                          : 'text-muted-foreground/40 hover:text-foreground',
                      )}
                    >
                      {revertConfirm === cp.turn
                        ? <IconAlertTriangle className="size-3" />
                        : <IconArrowBackUp className="size-3" />
                      }
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {revertConfirm === cp.turn ? 'Click again to confirm revert' : `Revert to turn ${cp.turn}`}
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Connector line */}
              {!isLast && (
                <div className="mx-0.5 h-px w-3 bg-border/40" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
