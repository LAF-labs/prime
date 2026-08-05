/**
 * Plan Sidebar.
 *
 * Displays the agent's active plan with step status indicators,
 * proposed plan markdown, and export options.
 */
import { memo, useState, useCallback, useMemo } from 'react'
import { IconCheck, IconLoader2, IconCircleDot, IconChevronDown, IconChevronRight, IconX, IconCopy, IconDownload, IconDeviceFloppy } from '@tabler/icons-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTaskStore } from '@/stores/taskStore'
import MarkdownViewer from '@/components/MarkdownViewer'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { PlanStep } from '@/types'
import {
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
  buildPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
} from '@/lib/proposed-plan'

function StepStatusIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <IconCheck className="size-3" />
      </span>
    )
  }
  if (status === 'in_progress') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
        <IconLoader2 className="size-3 animate-spin" />
      </span>
    )
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30">
      <IconCircleDot className="size-2 text-muted-foreground/30" />
    </span>
  )
}

interface PlanSidebarProps {
  taskId: string
  onClose: () => void
}

export const PlanSidebar = memo(function PlanSidebar({ taskId, onClose }: PlanSidebarProps) {
  const task = useTaskStore((s) => s.tasks[taskId])
  const plan = task?.plan
  const [expanded, setExpanded] = useState(false)

  // Extract plan markdown from the last assistant message that contains a plan
  const planMarkdown = useMemo(() => {
    if (!task?.messages) return null
    for (let i = task.messages.length - 1; i >= 0; i--) {
      const msg = task.messages[i]
      if (msg.role === 'assistant' && msg.content?.includes('## Plan')) {
        // Extract the plan section
        const planStart = msg.content.indexOf('## Plan')
        if (planStart >= 0) return msg.content.slice(planStart)
      }
    }
    return null
  }, [task?.messages])

  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null
  const displayedMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null

  const handleCopy = useCallback(() => {
    if (!planMarkdown) return
    navigator.clipboard.writeText(planMarkdown).then(() => {
      toast.success('Plan copied to clipboard')
    }).catch(() => {
      toast.error('Failed to copy')
    })
  }, [planMarkdown])

  const handleDownload = useCallback(() => {
    if (!planMarkdown) return
    const filename = buildPlanMarkdownFilename(planMarkdown)
    const content = normalizePlanMarkdownForExport(planMarkdown)
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Downloaded ${filename}`)
  }, [planMarkdown])

  if (!task) return null

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border/70 bg-card/50">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-400">
            Plan
          </span>
          {plan && (
            <span className="text-[11px] text-muted-foreground/50">
              {plan.filter((s) => s.status === 'completed').length}/{plan.length} steps
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {planMarkdown && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={handleCopy} className="size-6 inline-flex items-center justify-center rounded-md text-muted-foreground/50 hover:bg-accent hover:text-foreground">
                    <IconCopy className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Copy plan</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={handleDownload} className="size-6 inline-flex items-center justify-center rounded-md text-muted-foreground/50 hover:bg-accent hover:text-foreground">
                    <IconDownload className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Download as markdown</TooltipContent>
              </Tooltip>
            </>
          )}
          <button type="button" onClick={onClose} aria-label="Close plan sidebar" className="size-6 inline-flex items-center justify-center rounded-md text-muted-foreground/50 hover:bg-accent hover:text-foreground">
            <IconX className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {/* Plan Steps */}
          {plan && plan.length > 0 && (
            <div className="space-y-1">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                Steps
              </p>
              {plan.map((step, idx) => (
                <div
                  key={`${idx}-${step.content}`}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors',
                    step.status === 'in_progress' && 'bg-blue-500/5',
                    step.status === 'completed' && 'bg-emerald-500/5',
                  )}
                >
                  <div className="mt-0.5"><StepStatusIcon status={step.status} /></div>
                  <p className={cn(
                    'text-[13px] leading-snug',
                    step.status === 'completed'
                      ? 'text-muted-foreground/50 line-through decoration-muted-foreground/20'
                      : step.status === 'in_progress'
                        ? 'text-foreground/90'
                        : 'text-muted-foreground/70',
                  )}>
                    {step.content}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Proposed Plan Markdown */}
          {planMarkdown && (
            <div className="space-y-2">
              <button
                type="button"
                className="group flex w-full items-center gap-1.5 text-left"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded
                  ? <IconChevronDown className="size-3 shrink-0 text-muted-foreground/40" />
                  : <IconChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
                }
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40 group-hover:text-muted-foreground/60">
                  {planTitle ?? 'Full Plan'}
                </span>
              </button>
              {expanded && displayedMarkdown && (
                <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                  <MarkdownViewer content={displayedMarkdown} />
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!plan?.length && !planMarkdown && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-[13px] text-muted-foreground/40">No active plan yet.</p>
              <p className="mt-1 text-[11px] text-muted-foreground/30">
                Plans will appear here when the agent generates one.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
})
