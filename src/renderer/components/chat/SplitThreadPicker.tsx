import { memo, useState, useCallback, useEffect, useRef } from 'react'
import { IconX } from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { useProjectIcon } from '@/hooks/useProjectIcon'
import { ProjectIcon } from '@/components/sidebar/ProjectIcon'
import { cn } from '@/lib/utils'

interface PickerThreadRowProps {
  readonly taskId: string
  readonly onSelect: (taskId: string) => void
}

const PickerThreadRow = memo(function PickerThreadRow({ taskId, onSelect }: PickerThreadRowProps) {
  const name = useTaskStore((s) => s.tasks[taskId]?.name ?? '')
  const workspace = useTaskStore((s) => {
    const t = s.tasks[taskId]
    return t ? (t.originalWorkspace ?? t.workspace) : ''
  })
  const projectNames = useTaskStore((s) => s.projectNames)
  const projectName = projectNames[workspace] ?? workspace.split('/').pop() ?? ''
  const icon = useProjectIcon(workspace)

  return (
    <button
      type="button"
      onClick={() => onSelect(taskId)}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent"
    >
      <ProjectIcon icon={icon} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{projectName}</p>
      </div>
    </button>
  )
})

interface SplitThreadPickerProps {
  /** The task that will become the "anchor" (left panel). The user picks the other thread. */
  readonly anchorTaskId: string
  /** Screen position for the picker */
  readonly position: { x: number; y: number }
  readonly onClose: () => void
}

export const SplitThreadPicker = memo(function SplitThreadPicker({
  anchorTaskId,
  position,
  onClose,
}: SplitThreadPickerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus search on mount
  useEffect(() => { inputRef.current?.focus() }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const tasks = useTaskStore((s) => s.tasks)
  const candidates = Object.values(tasks)
    .filter((t) => t.id !== anchorTaskId && !t.isArchived && t.status !== 'completed' && t.status !== 'cancelled' && t.messages.length > 0)
    .sort((a, b) => {
      const aTime = a.messages[a.messages.length - 1]?.timestamp ?? a.createdAt
      const bTime = b.messages[b.messages.length - 1]?.timestamp ?? b.createdAt
      return bTime.localeCompare(aTime)
    })

  const query = search.toLowerCase().trim()
  const filtered = query
    ? candidates.filter((t) => t.name.toLowerCase().includes(query))
    : candidates

  const handleSelect = useCallback((taskId: string) => {
    const state = useTaskStore.getState()
    state.createSplitView(anchorTaskId, taskId)
    onClose()
  }, [anchorTaskId, onClose])

  // Clamp position so picker stays on screen
  const style = {
    top: Math.min(position.y, window.innerHeight - 400),
    left: Math.min(position.x, window.innerWidth - 280),
  }

  return (
    <div
      ref={ref}
      className="fixed z-[400] w-[280px] rounded-xl border border-border bg-popover shadow-xl"
      style={style}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-[13px] font-medium text-foreground">Pick a thread</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconX className="size-3" />
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search threads…"
          className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none"
        />
      </div>

      {/* Thread list */}
      <div className="max-h-[300px] overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-[13px] text-muted-foreground">
            {candidates.length === 0 ? 'No other threads available' : 'No matches'}
          </p>
        ) : (
          filtered.map((t) => (
            <PickerThreadRow key={t.id} taskId={t.id} onSelect={handleSelect} />
          ))
        )}
      </div>
    </div>
  )
})
