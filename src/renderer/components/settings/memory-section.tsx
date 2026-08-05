import { memo, useEffect, useMemo, useState, useCallback } from 'react'
import {
  IconRefresh, IconTrash, IconAlertTriangle, IconTerminal2,
  IconMessage, IconTool, IconPlayerPlay, IconStack2, IconArchive,
  IconNote, IconBug, IconCpu, IconFlame, IconChevronRight,
} from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { useDebugStore } from '@/stores/debugStore'
import { useJsDebugStore } from '@/stores/jsDebugStore'
import { measureMemory, formatBytes, type MemoryReport, type ThreadMemoryBreakdown } from '@/lib/thread-memory'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import type { AppSettings } from '@/types'
import { Switch } from '@/components/ui/switch'
import { SectionHeader, SettingsCard, SettingsGrid, SettingRow, Divider, ConfirmDialog } from './settings-shared'

const REFRESH_INTERVAL_MS = 2000
const HOT_THREAD_BYTES = 5 * 1024 * 1024
const HOT_TOTAL_BYTES = 100 * 1024 * 1024
const BYTES_PER_SCROLLBACK_LINE = 80 * 16
const DEFAULT_SCROLLBACK = 2000
const MIN_SCROLLBACK = 200
const MAX_SCROLLBACK = 20000
const DEFAULT_IDLE_MINS = 30

/* ── Stat card for the overview grid ─────────────────────────────── */

interface StatCardProps {
  readonly label: string
  readonly value: string
  readonly hint?: string
  readonly icon: React.ElementType
  readonly accentClass: string
}

const StatCard = ({ label, value, hint, icon: Icon, accentClass }: StatCardProps) => (
  <div className={cn(
    'relative flex flex-col gap-1 rounded-xl border border-border/40 bg-card/50 px-4 py-3',
    'overflow-hidden transition-colors hover:bg-card/80',
  )}>
    <div className={cn('absolute inset-y-0 left-0 w-[3px] rounded-l-xl', accentClass)} />
    <div className="flex items-center gap-2">
      <Icon className={cn('size-3.5', accentClass.replace('bg-', 'text-'))} />
      <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
    <p className="font-mono text-[18px] font-bold tabular-nums text-foreground leading-tight">{value}</p>
    {hint && <p className="text-[10.5px] text-muted-foreground/60 leading-snug">{hint}</p>}
  </div>
)

/* ── Category bar for the breakdown section ──────────────────────── */

interface CategoryRowProps {
  readonly label: string
  readonly bytes: number
  readonly total: number
  readonly accentClass: string
  readonly icon: React.ElementType
}

const CategoryRow = ({ label, bytes, total, accentClass, icon: Icon }: CategoryRowProps) => {
  const pct = total > 0 ? (bytes / total) * 100 : 0
  const isZero = bytes === 0
  return (
    <div className={cn(
      'group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
      isZero ? 'opacity-40' : 'hover:bg-accent/30',
    )}>
      <div className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-lg',
        isZero ? 'bg-muted/30' : 'bg-muted/50',
      )}>
        <Icon className={cn('size-3.5', isZero ? 'text-muted-foreground/40' : accentClass.replace('bg-', 'text-'))} />
      </div>
      <span className="w-24 shrink-0 text-[12px] font-medium text-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', accentClass)}
          style={{ width: `${Math.max(pct, bytes > 0 ? 1 : 0)}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">
        {formatBytes(bytes)}
      </span>
    </div>
  )
}

/* ── Status badge for per-thread rows ────────────────────────────── */

const StatusBadge = ({ status }: { status: string }) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    running: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Running' },
    paused: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Paused' },
    error: { bg: 'bg-destructive/15', text: 'text-destructive', label: 'Error' },
    pending_permission: { bg: 'bg-sky-500/15', text: 'text-sky-400', label: 'Pending' },
    completed: { bg: 'bg-muted/50', text: 'text-muted-foreground', label: 'Done' },
  }
  const c = config[status] ?? { bg: 'bg-muted/50', text: 'text-muted-foreground/60', label: status }
  return (
    <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide', c.bg, c.text)}>
      {c.label}
    </span>
  )
}

/* ── Per-thread row ──────────────────────────────────────────────── */

const ThreadRow = ({ thread, total }: { thread: ThreadMemoryBreakdown; total: number }) => {
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask)
  const setSettingsOpen = useTaskStore((s) => s.setSettingsOpen)
  const softDeleteTask = useTaskStore((s) => s.softDeleteTask)
  const pct = total > 0 ? Math.min(100, (thread.total / total) * 100) : 0
  const isHot = thread.total >= HOT_THREAD_BYTES

  const handleOpen = useCallback(() => {
    setSettingsOpen(false)
    setSelectedTask(thread.taskId)
  }, [setSelectedTask, setSettingsOpen, thread.taskId])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    softDeleteTask(thread.taskId)
  }, [softDeleteTask, thread.taskId])

  return (
    <button
      type="button"
      onClick={handleOpen}
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-all',
        'hover:border-border/40 hover:bg-accent/30',
        isHot && 'border-amber-500/20 bg-amber-500/5',
      )}
      aria-label={`Open thread: ${thread.name || 'Untitled thread'}`}
    >
      <StatusBadge status={thread.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-foreground">
          {thread.name || 'Untitled thread'}
          {thread.isArchived && (
            <span className="ml-1.5 text-[10px] text-muted-foreground/50">(archived)</span>
          )}
        </p>
        <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground/70">
          {thread.messageCount} msg
          {thread.toolCalls > 0 && ` · ${formatBytes(thread.toolCalls)} tools`}
          {thread.liveTurn > 0 && ` · ${formatBytes(thread.liveTurn)} live`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted/40">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              isHot ? 'bg-amber-500' : 'bg-primary/70',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-16 shrink-0 text-right font-mono text-[11.5px] font-medium tabular-nums text-foreground/80">
          {formatBytes(thread.total)}
        </span>
        <button
          type="button"
          onClick={handleDelete}
          className="size-6 shrink-0 flex items-center justify-center rounded-md text-muted-foreground/30 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
          aria-label={`Delete thread: ${thread.name || 'Untitled thread'}`}
        >
          <IconTrash className="size-3.5" />
        </button>
        <IconChevronRight className="size-3 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground" />
      </div>
    </button>
  )
}

/* ── JS heap reader ──────────────────────────────────────────────── */

const readHeap = (): { used: number; total: number } | null => {
  const perf = performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }
  if (!perf.memory) return null
  return { used: perf.memory.usedJSHeapSize, total: perf.memory.totalJSHeapSize }
}

const clampScrollback = (n: number): number =>
  Math.max(MIN_SCROLLBACK, Math.min(MAX_SCROLLBACK, Math.floor(n)))

/* ── Main section ────────────────────────────────────────────────── */

interface MemorySectionProps {
  readonly draft: AppSettings
  readonly updateDraft: (patch: Partial<AppSettings>) => void
}

export const MemorySection = memo(function MemorySection({ draft, updateDraft }: MemorySectionProps) {
  const [report, setReport] = useState<MemoryReport | null>(null)
  const [heap, setHeap] = useState<{ used: number; total: number } | null>(null)
  const [ptyCount, setPtyCount] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [isPurgeOpen, setIsPurgeOpen] = useState(false)

  const purgeAllSoftDeletes = useTaskStore((s) => s.purgeAllSoftDeletes)
  const clearDebugLog = useDebugStore((s) => s.clear)
  const clearJsDebugLog = useJsDebugStore((s) => s.clear)

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => setTick((n) => n + 1), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [autoRefresh])

  useEffect(() => {
    const next = measureMemory(
      useTaskStore.getState(),
      useDebugStore.getState(),
      useJsDebugStore.getState(),
    )
    setReport(next)
    setHeap(readHeap())
    let cancelled = false
    ipc.ptyCount()
      .then((n) => { if (!cancelled) setPtyCount(n) })
      .catch(() => { if (!cancelled) setPtyCount(null) })
    return () => { cancelled = true }
  }, [tick])

  const handleManualRefresh = useCallback(() => setTick((n) => n + 1), [])

  const handlePurgeSoft = useCallback(() => {
    purgeAllSoftDeletes()
    setTick((n) => n + 1)
  }, [purgeAllSoftDeletes])

  const handleClearDebug = useCallback(() => {
    clearDebugLog()
    clearJsDebugLog()
    setTick((n) => n + 1)
  }, [clearDebugLog, clearJsDebugLog])

  const top = useMemo(() => report?.threads.slice(0, 25) ?? [], [report])
  const remaining = (report?.threads.length ?? 0) - top.length
  const isHot = report ? report.grandTotal >= HOT_TOTAL_BYTES : false
  const debugLogTotal = report ? report.debugLog + report.jsDebugLog : 0

  const scrollback = clampScrollback(draft.terminalScrollback ?? DEFAULT_SCROLLBACK)
  const idleMins = draft.terminalAutoCloseIdleMins ?? null
  const idleEnabled = idleMins !== null
  const ptyScrollbackEstimate = ptyCount !== null
    ? ptyCount * scrollback * BYTES_PER_SCROLLBACK_LINE
    : 0

  return (
    <>
      <SectionHeader section="memory" />

      {/* ── Overview ──────────────────────────────────────────────── */}
      <SettingsGrid label="Overview" description="Live snapshot of renderer-side memory">
        <div className="space-y-3">
          {/* Hero total + controls */}
          <SettingsCard className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 py-1">
              <div className={cn(
                'flex size-11 items-center justify-center rounded-xl',
                isHot ? 'bg-amber-500/15' : 'bg-primary/10',
              )}>
                <IconCpu className={cn('size-5', isHot ? 'text-amber-400' : 'text-primary')} />
              </div>
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Tracked total</p>
                <p className={cn(
                  'font-mono text-[24px] font-bold tabular-nums leading-tight',
                  isHot ? 'text-amber-400' : 'text-foreground',
                )}>
                  {report ? formatBytes(report.grandTotal) : '—'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="size-3 cursor-pointer accent-primary"
                />
                Auto-refresh
              </label>
              <button
                type="button"
                onClick={handleManualRefresh}
                className="flex items-center gap-1.5 rounded-lg border border-border/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Refresh memory report"
              >
                <IconRefresh className="size-3" />
                Refresh
              </button>
            </div>
          </SettingsCard>

          {/* Hot warning */}
          {isHot && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
              <IconFlame className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <div>
                <p className="text-[12px] font-medium text-amber-300">High memory usage</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/70">
                  Renderer is holding {report ? formatBytes(report.grandTotal) : ''} across threads, drafts, and debug buffers.
                  Purge soft-deleted threads or clear debug buffers below.
                </p>
              </div>
            </div>
          )}

          {/* Stat cards grid */}
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            <StatCard
              label="Live threads"
              value={report ? `${report.threads.length}` : '—'}
              hint={report ? `${formatBytes(report.threadsTotal)} held` : undefined}
              icon={IconMessage}
              accentClass="bg-primary"
            />
            <StatCard
              label="Archived"
              value={report ? `${report.archivedMetaCount}` : '—'}
              hint={report
                ? report.archivedMetaCount > 0
                  ? `${formatBytes(report.archivedMeta)} metadata`
                  : 'none'
                : undefined}
              icon={IconArchive}
              accentClass="bg-violet-500"
            />
            <StatCard
              label="Soft-deleted"
              value={report ? `${report.softDeletedCount}` : '—'}
              hint={report ? `${formatBytes(report.softDeleted)} pending purge` : undefined}
              icon={IconTrash}
              accentClass="bg-amber-500"
            />
            <StatCard
              label="Open PTYs"
              value={ptyCount === null ? '—' : `${ptyCount}`}
              hint={ptyCount !== null && ptyCount > 0
                ? `~${formatBytes(ptyScrollbackEstimate)} scrollback`
                : 'this window'}
              icon={IconTerminal2}
              accentClass="bg-emerald-500"
            />
            {heap && (
              <StatCard
                label="JS heap"
                value={formatBytes(heap.used)}
                hint={`of ${formatBytes(heap.total)} allocated`}
                icon={IconCpu}
                accentClass="bg-sky-500"
              />
            )}
          </div>
        </div>
      </SettingsGrid>

      {/* ── Breakdown ─────────────────────────────────────────────── */}
      {report && report.grandTotal > 0 && (
        <SettingsGrid label="Breakdown" description="Where memory goes">
          <SettingsCard>
            <div className="space-y-0.5 py-1">
              <CategoryRow
                label="Messages"
                bytes={report.threads.reduce((s, t) => s + t.messages, 0)}
                total={report.grandTotal}
                accentClass="bg-primary"
                icon={IconMessage}
              />
              <CategoryRow
                label="Tool calls"
                bytes={report.threads.reduce((s, t) => s + t.toolCalls, 0)}
                total={report.grandTotal}
                accentClass="bg-violet-500"
                icon={IconTool}
              />
              <CategoryRow
                label="Live turn"
                bytes={report.threads.reduce((s, t) => s + t.liveTurn, 0)}
                total={report.grandTotal}
                accentClass="bg-emerald-500"
                icon={IconPlayerPlay}
              />
              <CategoryRow
                label="Queued"
                bytes={report.threads.reduce((s, t) => s + t.queued, 0)}
                total={report.grandTotal}
                accentClass="bg-sky-500"
                icon={IconStack2}
              />
              <CategoryRow
                label="Soft-deleted"
                bytes={report.softDeleted}
                total={report.grandTotal}
                accentClass="bg-amber-500"
                icon={IconTrash}
              />
              <CategoryRow
                label="Drafts"
                bytes={report.drafts}
                total={report.grandTotal}
                accentClass="bg-pink-500"
                icon={IconNote}
              />
              <CategoryRow
                label="Debug buffers"
                bytes={debugLogTotal}
                total={report.grandTotal}
                accentClass="bg-orange-500"
                icon={IconBug}
              />
            </div>
          </SettingsCard>
        </SettingsGrid>
      )}

      {/* ── Per-thread ────────────────────────────────────────────── */}
      <SettingsGrid label="Per-thread" description="Click a row to open">
        <SettingsCard>
          {!report || report.threads.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-6 text-center">
              <IconMessage className="size-5 text-muted-foreground/30" />
              <p className="text-[11.5px] text-muted-foreground/60">No live threads</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 py-1">
              {top.map((t) => (
                <ThreadRow key={t.taskId} thread={t} total={report.threadsTotal || 1} />
              ))}
              {remaining > 0 && (
                <p className="px-3 pt-2 text-[10.5px] text-muted-foreground/50">
                  + {remaining} more thread{remaining === 1 ? '' : 's'} below 1% each
                </p>
              )}
            </div>
          )}
        </SettingsCard>
      </SettingsGrid>

      {/* ── Terminal ──────────────────────────────────────────────── */}
      <SettingsGrid label="Terminal" description="Tune memory held by terminal tabs">
        <SettingsCard>
          <SettingRow
            label="Scrollback lines"
            description={
              ptyCount !== null && ptyCount > 0
                ? `${ptyCount} terminal${ptyCount === 1 ? '' : 's'} open · roughly ${formatBytes(ptyScrollbackEstimate)} held in scrollback at this setting.`
                : 'Lines retained per terminal. Lower values save memory; higher values keep more history.'
            }
          >
            <input
              type="number"
              min={MIN_SCROLLBACK}
              max={MAX_SCROLLBACK}
              step={500}
              value={scrollback}
              onChange={(e) => updateDraft({ terminalScrollback: clampScrollback(Number(e.target.value) || DEFAULT_SCROLLBACK) })}
              className="w-24 rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs tabular-nums text-foreground outline-none focus:ring-1 focus:ring-ring"
              aria-label="Terminal scrollback lines"
            />
          </SettingRow>
          <Divider />
          <SettingRow
            label="Auto-close idle background tabs"
            description={
              idleEnabled
                ? `Closes background terminal tabs after ${idleMins} minute${idleMins === 1 ? '' : 's'} of no PTY activity. The active tab is never closed.`
                : 'When enabled, frees memory from terminal tabs you have stopped using. Running processes in those tabs are terminated.'
            }
          >
            <Switch
              checked={idleEnabled}
              onCheckedChange={(checked) =>
                updateDraft({ terminalAutoCloseIdleMins: checked ? DEFAULT_IDLE_MINS : null })
              }
              aria-label="Toggle idle terminal auto-close"
            />
          </SettingRow>
          {idleEnabled && (
            <>
              <Divider />
              <SettingRow
                label="Idle threshold"
                description="Minutes of no terminal output before a background tab is auto-closed."
              >
                <input
                  type="number"
                  min={1}
                  max={1440}
                  step={5}
                  value={idleMins ?? DEFAULT_IDLE_MINS}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(1440, Number(e.target.value) || DEFAULT_IDLE_MINS))
                    updateDraft({ terminalAutoCloseIdleMins: n })
                  }}
                  className="w-20 rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs tabular-nums text-foreground outline-none focus:ring-1 focus:ring-ring"
                  aria-label="Idle threshold in minutes"
                />
              </SettingRow>
            </>
          )}
        </SettingsCard>
      </SettingsGrid>

      {/* ── Reclaim ───────────────────────────────────────────────── */}
      <SettingsGrid label="Reclaim" description="Free held memory">
        <SettingsCard>
          <SettingRow
            label="Purge soft-deleted threads"
            description={
              report && report.softDeletedCount > 0
                ? `${report.softDeletedCount} thread${report.softDeletedCount === 1 ? '' : 's'} (${formatBytes(report.softDeleted)}) waiting up to 48 hours.`
                : 'Soft-deleted threads stay in RAM for 48 hours before automatic removal.'
            }
          >
            <button
              type="button"
              disabled={!report || report.softDeletedCount === 0}
              onClick={() => setIsPurgeOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Purge all soft-deleted threads now"
            >
              <IconTrash className="size-3" />
              Purge now
            </button>
          </SettingRow>
          <Divider />
          <SettingRow
            label="Clear debug log buffers"
            description={
              report
                ? `${report.debugLogCount + report.jsDebugLogCount} captured entries (${formatBytes(debugLogTotal)}).`
                : 'Drops the in-memory ACP and JS console capture buffers.'
            }
          >
            <button
              type="button"
              disabled={!report || (report.debugLogCount === 0 && report.jsDebugLogCount === 0)}
              onClick={handleClearDebug}
              className="flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Clear debug log buffers"
            >
              <IconBug className="size-3" />
              Clear
            </button>
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <p className="flex items-start gap-1.5 px-1 pt-1 text-[10.5px] leading-relaxed text-muted-foreground/50">
        <IconTerminal2 className="mt-0.5 size-3 shrink-0" aria-hidden />
        Scrollback estimates assume ~80 cols × 16 B per cell × the line cap. Real WASM heap usage varies.
      </p>

      <ConfirmDialog
        open={isPurgeOpen}
        onOpenChange={setIsPurgeOpen}
        title="Purge soft-deleted threads?"
        description="Permanently removes every soft-deleted thread immediately. Restoration from the Archives section will no longer be possible."
        confirmLabel="Purge now"
        onConfirm={handlePurgeSoft}
      />
    </>
  )
})
