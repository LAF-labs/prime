import { memo, useMemo, useState, useCallback } from 'react'
import {
  IconChevronRight,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useDiffStore } from '@/stores/diffStore'
import { FileTypeIcon } from '@/components/file-tree/FileTypeIcon'
import { isFileMutation } from './tool-call-utils'
import type { ToolCall } from '@/types'
import type { ChangedFilesRow } from '@/lib/timeline'

// ── Types ────────────────────────────────────────────────────────

interface FileStats {
  readonly path: string
  readonly name: string
  readonly ext: string
  readonly additions: number
  readonly deletions: number
}

interface DirGroup {
  readonly dir: string
  readonly files: readonly FileStats[]
  readonly additions: number
  readonly deletions: number
}

const MAX_VISIBLE_FILES = 30

// ── Pure helpers ─────────────────────────────────────────────────

function extractFileStats(toolCalls: readonly ToolCall[]): FileStats[] {
  const statsMap = new Map<string, { additions: number; deletions: number }>()

  for (const tc of toolCalls) {
    if (tc.status !== 'completed') continue
    if (!isFileMutation(tc.kind, tc.title)) continue

    const filePath = tc.locations?.[0]?.path
    if (!filePath) continue

    // Pre-computed by the Rust ACP client (see
    // `commands::diff_stats::annotate_diff_content`). Equivalent to
    // `git diff --numstat` for the (oldText, newText) pair. No diff entry =
    // no per-line counts available — surface the file at +0/-0 rather than
    // inventing a synthetic "+1" that inflates totals.
    let additions = 0
    let deletions = 0
    if (tc.content) {
      for (const item of tc.content) {
        if (item.type !== 'diff') continue
        additions += item.linesAdded ?? 0
        deletions += item.linesRemoved ?? 0
      }
    }

    const existing = statsMap.get(filePath)
    if (existing) {
      existing.additions += additions
      existing.deletions += deletions
    } else {
      statsMap.set(filePath, { additions, deletions })
    }
  }

  const result: FileStats[] = []
  for (const [path, stats] of statsMap) {
    const lastSlash = path.lastIndexOf('/')
    const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path
    const dotIdx = name.lastIndexOf('.')
    const ext = dotIdx > 0 ? name.slice(dotIdx + 1) : ''
    result.push({ path, name, ext, ...stats })
  }
  return result
}

function groupByDirectory(files: readonly FileStats[]): DirGroup[] {
  const groups = new Map<string, FileStats[]>()
  for (const file of files) {
    const lastSlash = file.path.lastIndexOf('/')
    const dir = lastSlash > 0 ? file.path.slice(0, lastSlash) : ''
    let arr = groups.get(dir)
    if (!arr) { arr = []; groups.set(dir, arr) }
    arr.push(file)
  }
  const result: DirGroup[] = []
  for (const [dir, dirFiles] of groups) {
    dirFiles.sort((a, b) => a.name.localeCompare(b.name))
    let additions = 0, deletions = 0
    for (const f of dirFiles) { additions += f.additions; deletions += f.deletions }
    result.push({ dir, files: dirFiles, additions, deletions })
  }
  result.sort((a, b) => a.dir.localeCompare(b.dir))
  return result
}

// ── Sub-components ───────────────────────────────────────────────

const Stats = memo(function Stats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
      <span className="mx-0.5 text-muted-foreground">/</span>
      <span className="text-red-600/80 dark:text-red-400/80">-{deletions}</span>
    </span>
  )
})

const FileRow = memo(function FileRow({ file, depth, onClick }: { file: FileStats; depth: number; onClick: (path: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(file.path)}
      className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
      style={{ paddingLeft: depth * 14 + 8 }}
    >
      <span aria-hidden className="size-3.5 shrink-0" />
      <FileTypeIcon name={file.name} isDir={false} className="size-3.5" />
      <span className="truncate font-mono text-[12px] text-foreground/80 group-hover:text-foreground/90">
        {file.name}
      </span>
      <Stats additions={file.additions} deletions={file.deletions} />
    </button>
  )
})

// ── Main component ───────────────────────────────────────────────

export const ChangedFilesSummary = memo(function ChangedFilesSummary({ row }: { row: ChangedFilesRow }) {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const fileStats = useMemo(() => extractFileStats(row.toolCalls), [row.toolCalls])
  const dirGroups = useMemo(() => groupByDirectory(fileStats), [fileStats])

  const totals = useMemo(() => {
    let additions = 0, deletions = 0
    for (const f of fileStats) { additions += f.additions; deletions += f.deletions }
    return { additions, deletions }
  }, [fileStats])

  const allCollapsed = collapsedDirs.size === dirGroups.length && dirGroups.length > 0

  const toggleDir = useCallback((dir: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      next.has(dir) ? next.delete(dir) : next.add(dir)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setCollapsedDirs((prev) =>
      prev.size === dirGroups.length
        ? new Set()
        : new Set(dirGroups.map((g) => g.dir)),
    )
  }, [dirGroups])

  const handleFileClick = useCallback((path: string) => {
    useDiffStore.getState().openToFile(path)
  }, [])

  const handleViewDiff = useCallback(() => {
    useDiffStore.getState().setOpen(true)
  }, [])

  if (fileStats.length === 0) return null

  const totalFiles = fileStats.length
  const isCapped = !showAll && totalFiles > MAX_VISIBLE_FILES
  let visibleCount = 0

  const report = row.report
  const reportLabel = report
    ? report.status === 'blocked' ? 'Blocked'
      : report.status === 'partial' ? 'Partial'
      : 'Done'
    : null

  return (
    <div className="pt-2 pb-4" data-timeline-row-kind="changed-files">
      <div className="rounded-lg border border-border/80 bg-card/70 p-3">
      {/* Report summary */}
      {report && reportLabel && (
        <p className="mb-3 pb-3 border-b border-border/40 text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/90">{reportLabel}</span>
          <span className="mx-1.5 text-border">·</span>
          {report.summary}
        </p>
      )}
      {/* Header */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Changed files ({totalFiles})</span>
          <span className="mx-1">&middot;</span>
          <span className="text-emerald-600 dark:text-emerald-400">+{totals.additions}</span>
          <span className="mx-0.5 text-muted-foreground">/</span>
          <span className="text-red-600/80 dark:text-red-400/80">-{totals.deletions}</span>
        </p>
        <div className="flex items-center gap-1.5">
          {dirGroups.length > 1 && (
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-md border border-input bg-popover px-2 py-0.5 text-[12px] font-medium text-foreground shadow-xs/5 transition-colors hover:bg-accent/50"
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          <button
            type="button"
            onClick={handleViewDiff}
            className="rounded-md border border-input bg-popover px-2 py-0.5 text-[12px] font-medium text-foreground shadow-xs/5 transition-colors hover:bg-accent/50"
          >
            View diff
          </button>
        </div>
      </div>

      {/* File tree */}
      <div className="space-y-0.5">
        {dirGroups.map((group) => {
          const isDirCollapsed = collapsedDirs.has(group.dir)

          return (
            <div key={group.dir || '__root'}>
              {/* Directory header */}
              {group.dir && (
                <button
                  type="button"
                  onClick={() => toggleDir(group.dir)}
                  className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
                  style={{ paddingLeft: 8 }}
                >
                  <IconChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground/80',
                      !isDirCollapsed && 'rotate-90',
                    )}
                    aria-hidden
                  />
                  <FileTypeIcon
                    name={group.dir.split('/').pop() ?? group.dir}
                    isDir
                    isExpanded={!isDirCollapsed}
                    className="size-3.5"
                  />
                  <span className="truncate font-mono text-[12px] text-foreground/70 group-hover:text-foreground/80">
                    {group.dir}
                  </span>
                  <Stats additions={group.additions} deletions={group.deletions} />
                </button>
              )}

              {/* Files */}
              {!isDirCollapsed && (
                <div className="space-y-0.5">
                  {group.files.map((file) => {
                    if (isCapped && visibleCount >= MAX_VISIBLE_FILES) return null
                    visibleCount++
                    return (
                      <FileRow
                        key={file.path}
                        file={file}
                        depth={group.dir ? 1 : 0}
                        onClick={handleFileClick}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {isCapped && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex w-full justify-center py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-muted-foreground"
          >
            Show {totalFiles - MAX_VISIBLE_FILES} more files
          </button>
        )}
      </div>
      </div>
    </div>
  )
})
