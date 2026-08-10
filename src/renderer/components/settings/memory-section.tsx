import { t } from '@/lib/i18n'
import { memo, useEffect, useMemo, useState, useCallback } from 'react'
import {
  IconRefresh, IconTrash, IconTerminal2,
  IconMessage, IconTool, IconPlayerPlay, IconStack2, IconArchive,
  IconNote, IconCpu, IconFlame, IconChevronRight,
} from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { measureMemory, formatBytes, type MemoryReport, type ThreadMemoryBreakdown } from '@/lib/thread-memory'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import type { AppSettings } from '@/types'
import { Switch } from '@/components/ui/switch'
import {
  SectionHeader, SettingsSection, SettingBlock, SettingRow, ConfirmDialog,
  SETTINGS_INPUT_CLASS, SETTINGS_BUTTON_CLASS,
} from './settings-shared'

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
  <div className="relative min-w-0 overflow-hidden rounded-xl border border-border/60 px-3 py-2.5 transition-colors hover:bg-accent/30">
    <div className={cn('absolute inset-y-0 left-0 w-[3px]', accentClass)} />
    <div className="flex items-center gap-1.5">
      <Icon className={cn('size-3.5 shrink-0', accentClass.replace('bg-', 'text-'))} />
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
    </div>
    <p className="mt-1 truncate font-mono text-[17px] font-semibold leading-tight tabular-nums text-foreground">{value}</p>
    {hint && <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground/70">{hint}</p>}
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
      'group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors',
      isZero ? 'opacity-40' : 'hover:bg-accent/30',
    )}>
      <div className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-lg',
        isZero ? 'bg-muted/30' : 'bg-muted/50',
      )}>
        <Icon className={cn('size-3.5', isZero ? 'text-muted-foreground/40' : accentClass.replace('bg-', 'text-'))} />
      </div>
      <span className="w-24 shrink-0 truncate text-[13px] font-medium text-foreground">{label}</span>
      <div className="h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-muted/40">
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
  // pending_permission is amber (warning) to match ThreadItem's status map —
  // one status, one color everywhere.
  const config: Record<string, { bg: string; text: string; label: string }> = {
    running: { bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', label: 'Running' },
    paused: { bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-600 dark:text-amber-400', label: 'Paused' },
    error: { bg: 'bg-destructive/15', text: 'text-destructive', label: 'Error' },
    pending_permission: { bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-600 dark:text-amber-400', label: 'Pending' },
    completed: { bg: 'bg-muted/50', text: 'text-muted-foreground', label: 'Done' },
  }
  const c = config[status] ?? { bg: 'bg-muted/50', text: 'text-muted-foreground/60', label: status }
  return (
    <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide', c.bg, c.text)}>
      {t(c.label)}
    </span>
  )
}

/* ── Per-thread row ──────────────────────────────────────────────── */

const ThreadRow = ({ thread, total }: { thread: ThreadMemoryBreakdown; total: number }) => {
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask)
  const setSettingsOpen = useTaskStore((s) => s.setSettingsOpen)
  const softDeleteTask = useTaskStore((s) => s.softDeleteTask)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const pct = total > 0 ? Math.min(100, (thread.total / total) * 100) : 0
  const isHot = thread.total >= HOT_THREAD_BYTES
  const threadName = thread.name || t('Untitled thread')

  const handleOpen = useCallback(() => {
    setSettingsOpen(false)
    setSelectedTask(thread.taskId)
  }, [setSelectedTask, setSettingsOpen, thread.taskId])

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDeleteOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    softDeleteTask(thread.taskId)
  }, [softDeleteTask, thread.taskId])

  return (
    <>
      <div
        // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- the row hosts a nested delete <button>; nested interactive content is invalid inside <button>
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen() } }}
        className={cn(
          'group -mx-2 flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          'hover:bg-accent/40',
          isHot && 'border-amber-500/20 bg-amber-500/5',
        )}
        aria-label={t('Open thread: {name}', { name: threadName })}
      >
        <StatusBadge status={thread.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">
            {threadName}
            {thread.isArchived && (
              <span className="ml-1.5 text-[11px] text-muted-foreground/50">({t('archived')})</span>
            )}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {thread.messageCount} msg
            {thread.toolCalls > 0 && ` · ${formatBytes(thread.toolCalls)} tools`}
            {thread.liveTurn > 0 && ` · ${formatBytes(thread.liveTurn)} live`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted/40 sm:block">
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
            onClick={handleDeleteClick}
            className="size-6 shrink-0 flex items-center justify-center rounded-md text-muted-foreground/30 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={t('Delete thread: {name}', { name: threadName })}
          >
            <IconTrash className="size-3.5" />
          </button>
          <IconChevronRight className="size-3 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground" />
        </div>
      </div>
      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title={t('Delete this thread?')}
        description={t('"{name}" moves to Archives and is permanently removed after 2 days.', { name: threadName })}
        confirmLabel={t('Delete')}
        onConfirm={handleConfirmDelete}
      />
    </>
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

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => setTick((n) => n + 1), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [autoRefresh])

  useEffect(() => {
    const next = measureMemory(useTaskStore.getState())
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

  const top = useMemo(() => report?.threads.slice(0, 25) ?? [], [report])
  const remaining = (report?.threads.length ?? 0) - top.length
  const isHot = report ? report.grandTotal >= HOT_TOTAL_BYTES : false

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
      <SettingsSection title={t('Overview')} description={t('Live snapshot of renderer-side memory')}>
        <SettingBlock className="space-y-3">
          {/* Hero total + controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-xl',
                isHot ? 'bg-amber-500/15' : 'bg-primary/10',
              )}>
                <IconCpu className={cn('size-5', isHot ? 'text-amber-600 dark:text-amber-400' : 'text-primary')} />
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground">{t('Tracked total')}</p>
                <p className={cn(
                  'font-mono text-[24px] font-semibold leading-tight tabular-nums',
                  isHot ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
                )}>
                  {report ? formatBytes(report.grandTotal) : '—'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="size-3.5 cursor-pointer accent-primary"
                />
                {t('Auto-refresh')}
              </label>
              <button
                type="button"
                onClick={handleManualRefresh}
                className={SETTINGS_BUTTON_CLASS}
                aria-label={t('Refresh memory report')}
              >
                <IconRefresh className="size-3.5" />
                {t('Refresh')}
              </button>
            </div>
          </div>

          {/* Hot warning */}
          {isHot && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-3">
              <IconFlame className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-amber-700 dark:text-amber-300">{t('High memory usage')}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700/80 dark:text-amber-200/70">
                  {t('Renderer is holding {size} across threads, drafts, and debug buffers. Purge soft-deleted threads or clear debug buffers below.', { size: report ? formatBytes(report.grandTotal) : '' })}
                </p>
              </div>
            </div>
          )}

          {/* Stat cards grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatCard
              label={t('Live threads')}
              value={report ? `${report.threads.length}` : '—'}
              hint={report ? `${formatBytes(report.threadsTotal)} held` : undefined}
              icon={IconMessage}
              accentClass="bg-primary"
            />
            <StatCard
              label={t('Archived')}
              value={report ? `${report.archivedMetaCount}` : '—'}
              hint={report
                ? report.archivedMetaCount > 0
                  ? `${formatBytes(report.archivedMeta)} metadata`
                  : 'none'
                : undefined}
              icon={IconArchive}
              accentClass="bg-[var(--chart-5)]"
            />
            <StatCard
              label={t('Soft-deleted')}
              value={report ? `${report.softDeletedCount}` : '—'}
              hint={report ? `${formatBytes(report.softDeleted)} pending purge` : undefined}
              icon={IconTrash}
              accentClass="bg-amber-500"
            />
            <StatCard
              label={t('Open PTYs')}
              value={ptyCount === null ? '—' : `${ptyCount}`}
              hint={ptyCount !== null && ptyCount > 0
                ? `~${formatBytes(ptyScrollbackEstimate)} scrollback`
                : 'this window'}
              icon={IconTerminal2}
              accentClass="bg-emerald-500"
            />
            {heap && (
              <StatCard
                label={t('JS heap')}
                value={formatBytes(heap.used)}
                hint={`of ${formatBytes(heap.total)} allocated`}
                icon={IconCpu}
                accentClass="bg-[var(--chart-4)]"
              />
            )}
          </div>
        </SettingBlock>
      </SettingsSection>

      {/* ── Breakdown ─────────────────────────────────────────────── */}
      {report && report.grandTotal > 0 && (
        <SettingsSection title={t('Breakdown')} description={t('Where memory goes')}>
          <SettingBlock>
            <div className="space-y-0.5">
              <CategoryRow
                label={t('Messages')}
                bytes={report.threads.reduce((s, t) => s + t.messages, 0)}
                total={report.grandTotal}
                accentClass="bg-primary"
                icon={IconMessage}
              />
              <CategoryRow
                label={t('Tool calls')}
                bytes={report.threads.reduce((s, t) => s + t.toolCalls, 0)}
                total={report.grandTotal}
                accentClass="bg-[var(--chart-5)]"
                icon={IconTool}
              />
              <CategoryRow
                label={t('Live turn')}
                bytes={report.threads.reduce((s, t) => s + t.liveTurn, 0)}
                total={report.grandTotal}
                accentClass="bg-emerald-500"
                icon={IconPlayerPlay}
              />
              <CategoryRow
                label={t('Queued')}
                bytes={report.threads.reduce((s, t) => s + t.queued, 0)}
                total={report.grandTotal}
                accentClass="bg-[var(--chart-4)]"
                icon={IconStack2}
              />
              <CategoryRow
                label={t('Soft-deleted')}
                bytes={report.softDeleted}
                total={report.grandTotal}
                accentClass="bg-amber-500"
                icon={IconTrash}
              />
              <CategoryRow
                label={t('Drafts')}
                bytes={report.drafts}
                total={report.grandTotal}
                accentClass="bg-[var(--chart-6)]"
                icon={IconNote}
              />
            </div>
          </SettingBlock>
        </SettingsSection>
      )}

      {/* ── Per-thread ────────────────────────────────────────────── */}
      <SettingsSection title={t('Per-thread')} description={t('Click a row to open')}>
        <SettingBlock>
          {!report || report.threads.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-6 text-center">
              <IconMessage className="size-5 text-muted-foreground/40" />
              <p className="text-[13px] text-muted-foreground">{t('No live threads')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {top.map((t) => (
                <ThreadRow key={t.taskId} thread={t} total={report.threadsTotal || 1} />
              ))}
              {remaining > 0 && (
                <p className="pt-2 text-[12px] text-muted-foreground">
                  + {remaining} more thread{remaining === 1 ? '' : 's'} below 1% each
                </p>
              )}
            </div>
          )}
        </SettingBlock>
      </SettingsSection>

      {/* ── Terminal ──────────────────────────────────────────────── */}
      <SettingsSection title={t('Terminal')} description={t('Tune memory held by terminal tabs')}>
        <SettingRow
          label={t('Scrollback lines')}
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
            className={cn(SETTINGS_INPUT_CLASS, 'w-24 tabular-nums')}
            aria-label={t('Terminal scrollback lines')}
          />
        </SettingRow>
        <SettingRow
          label={t('Auto-close idle background tabs')}
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
            aria-label={t('Toggle idle terminal auto-close')}
          />
        </SettingRow>
        {idleEnabled && (
          <SettingRow
            label={t('Idle threshold')}
            description={t('Minutes of no terminal output before a background tab is auto-closed.')}
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
              className={cn(SETTINGS_INPUT_CLASS, 'w-20 tabular-nums')}
              aria-label={t('Idle threshold in minutes')}
            />
          </SettingRow>
        )}
      </SettingsSection>

      {/* ── Reclaim ───────────────────────────────────────────────── */}
      <SettingsSection title={t('Reclaim')} description={t('Free held memory')}>
        <SettingRow
          label={t('Purge soft-deleted threads')}
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
            className={cn(SETTINGS_BUTTON_CLASS, 'border-destructive/30 text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40')}
            aria-label={t('Purge all soft-deleted threads now')}
          >
            <IconTrash className="size-3.5" />
            {t('Purge now')}
          </button>
        </SettingRow>
      </SettingsSection>

      <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed text-muted-foreground/70">
        <IconTerminal2 className="mt-0.5 size-3 shrink-0" aria-hidden />
        Scrollback estimates assume ~80 cols × 16 B per cell × the line cap. Real WASM heap usage varies.
      </p>

      <ConfirmDialog
        open={isPurgeOpen}
        onOpenChange={setIsPurgeOpen}
        title={t('Purge soft-deleted threads?')}
        description={t('Permanently removes every soft-deleted thread immediately. Restoration from the Archives section will no longer be possible.')}
        confirmLabel={t('Purge now')}
        onConfirm={handlePurgeSoft}
      />
    </>
  )
})
