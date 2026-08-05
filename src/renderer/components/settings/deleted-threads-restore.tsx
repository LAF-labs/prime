import { memo } from 'react'
import { IconTrash, IconRestore } from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { useProjectIcon } from '@/hooks/useProjectIcon'
import { ProjectIcon } from '@/components/sidebar/ProjectIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { SoftDeletedThread } from '@/types'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TWO_DAYS_MS = 48 * HOUR_MS

const formatTimeRemaining = (iso: string): string => {
  const remaining = TWO_DAYS_MS - (Date.now() - new Date(iso).getTime())
  if (remaining <= 0) return 'expiring'
  const days = Math.floor(remaining / DAY_MS)
  const hrs = Math.floor((remaining % DAY_MS) / HOUR_MS)
  if (days > 0) return `${days}d ${hrs}h left`
  return `${hrs}h left`
}

interface ProjectGroupProps {
  readonly workspace: string
  readonly items: Array<[string, SoftDeletedThread]>
}

const ProjectGroup = memo(function ProjectGroup({ workspace, items }: ProjectGroupProps) {
  const projectNames = useTaskStore((s) => s.projectNames)
  const restoreTask = useTaskStore((s) => s.restoreTask)
  const permanentlyDeleteTask = useTaskStore((s) => s.permanentlyDeleteTask)
  const icon = useProjectIcon(workspace)
  const displayName = projectNames[workspace] ?? workspace.split('/').pop() ?? workspace

  const handleDeleteAll = () => {
    for (const [id] of items) {
      permanentlyDeleteTask(id)
    }
  }

  return (
    <div className="px-5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {icon ? <ProjectIcon icon={icon} /> : <span className="size-3.5 shrink-0 rounded-full bg-muted-foreground/30" />}
          {displayName}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Delete all threads from ${displayName}`}
              onClick={handleDeleteAll}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
            >
              <IconTrash className="size-3" />
              <span>Delete all</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Delete all threads in this project</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map(([id, { task, deletedAt }]) => (
          <div key={id} className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/20">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] text-foreground/90">{task.name}</p>
              <p className="text-[10px] text-muted-foreground">{formatTimeRemaining(deletedAt)}</p>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Restore ${task.name}`}
                    onClick={() => restoreTask(id)}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/15 hover:text-primary transition-colors"
                  >
                    <IconRestore className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Restore</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Permanently delete ${task.name}`}
                    onClick={() => permanentlyDeleteTask(id)}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Delete permanently</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})

export const DeletedThreadsRestore = () => {
  const softDeleted = useTaskStore((s) => s.softDeleted)
  const entries = Object.entries(softDeleted)

  if (entries.length === 0) {
    return (
      <div className={cn('rounded-xl border border-border/50 bg-card/70 px-5 py-6 shadow-sm')}>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-9 items-center justify-center rounded-xl bg-muted/30">
            <IconTrash className="size-4 text-muted-foreground/70" />
          </div>
          <p className="text-[13px] font-medium text-muted-foreground">No deleted threads</p>
          <p className="text-[11px] text-muted-foreground">Deleted threads appear here for 2 days before permanent removal</p>
        </div>
      </div>
    )
  }

  const grouped = new Map<string, Array<[string, SoftDeletedThread]>>()
  for (const entry of entries) {
    const ws = entry[1].task.workspace
    if (!grouped.has(ws)) grouped.set(ws, [])
    grouped.get(ws)!.push(entry)
  }

  return (
    <div className={cn('rounded-xl border border-border/50 bg-card/70 shadow-sm overflow-hidden')}>
      <div className="border-b border-border/60 px-5 py-3">
        <p className="text-[12px] font-medium text-foreground/80">{entries.length} deleted {entries.length === 1 ? 'thread' : 'threads'}</p>
        <p className="text-[11px] text-muted-foreground">Permanently removed after 2 days</p>
      </div>
      <div className="divide-y divide-border/20">
        {[...grouped.entries()].map(([ws, items]) => (
          <ProjectGroup key={ws} workspace={ws} items={items} />
        ))}
      </div>
    </div>
  )
}
