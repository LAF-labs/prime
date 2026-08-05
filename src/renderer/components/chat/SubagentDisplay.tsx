import { memo, useMemo, useState } from 'react'
import {
  IconChevronDown, IconChevronRight, IconRobot,
  IconCircleCheck, IconLoader2, IconArrowRight,
} from '@tabler/icons-react'
import type { ToolCall } from '@/types'

interface SubagentStage {
  readonly name: string
  readonly role: string
  readonly prompt_template: string
  readonly depends_on?: readonly string[]
}

interface SubagentInput {
  readonly task?: string
  readonly stages?: readonly SubagentStage[]
  readonly mode?: string
}

/** Check if a tool call is a subagent/pipeline operation */
export const isSubagentToolCall = (tc: ToolCall): boolean => {
  const title = (tc.title ?? '').toLowerCase()
  if (title.includes('subagent') || title.includes('sub_agent') || title.includes('pipeline')) return true
  if (!tc.rawInput || typeof tc.rawInput !== 'object') return false
  const input = tc.rawInput as Record<string, unknown>
  return Array.isArray(input.stages) && typeof input.task === 'string'
}

const extractSubagentInput = (tc: ToolCall): SubagentInput | null => {
  if (!tc.rawInput || typeof tc.rawInput !== 'object') return null
  const input = tc.rawInput as Record<string, unknown>
  if (!Array.isArray(input.stages)) return null
  return input as unknown as SubagentInput
}

const extractDescription = (tc: ToolCall): string | null => {
  if (!tc.rawOutput || typeof tc.rawOutput !== 'object') return null
  const out = tc.rawOutput as Record<string, unknown>
  if (typeof out.description === 'string') return out.description
  if (Array.isArray(out.items)) {
    const first = out.items[0] as Record<string, unknown> | undefined
    if (first?.Json && typeof first.Json === 'object') {
      const json = first.Json as Record<string, unknown>
      if (typeof json.description === 'string') return json.description
    }
  }
  return null
}

/** Aggregate subagent data from all subagent tool calls in the group */
export const aggregateSubagentData = (allToolCalls: ToolCall[]): {
  stages: SubagentStage[]
  task: string | null
  description: string | null
  isRunning: boolean
  isCompleted: boolean
} => {
  let stages: SubagentStage[] = []
  let task: string | null = null
  let description: string | null = null
  let isRunning = false
  let isCompleted = false
  for (const tc of allToolCalls) {
    if (!isSubagentToolCall(tc)) continue
    const input = extractSubagentInput(tc)
    if (input?.stages && input.stages.length > 0) {
      stages = input.stages as SubagentStage[]
      task = input.task ?? null
    }
    const desc = extractDescription(tc)
    if (desc) description = desc
    if (tc.status === 'in_progress') isRunning = true
    if (tc.status === 'completed') isCompleted = true
  }
  return { stages, task, description, isRunning, isCompleted }
}

const ROLE_LABELS: Record<string, string> = {
  kiro_default: 'Default',
  kiro_planner: 'Planner',
  kiro_guide: 'Guide',
} as const

const getRoleLabel = (role: string): string =>
  ROLE_LABELS[role] ?? role

const MAX_DESCRIPTION_LENGTH = 200 as const

/** Extract a readable one-liner from a prompt_template */
const summarizePrompt = (prompt: string): string => {
  const cleaned = prompt.replace(/\{task\}/g, '').trim()
  const firstLine = cleaned.split('\n').find((line) => line.trim().length > 0) ?? cleaned
  const trimmed = firstLine.trim()
  if (trimmed.length <= MAX_DESCRIPTION_LENGTH) return trimmed
  return `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH).trimEnd()}…`
}

interface SubagentDisplayProps {
  readonly allToolCalls: ToolCall[]
}

export const SubagentDisplay = memo(function SubagentDisplay({ allToolCalls }: SubagentDisplayProps) {
  const [expanded, setExpanded] = useState(true)
  const { stages, task, description, isRunning, isCompleted } = aggregateSubagentData(allToolCalls)
  if (stages.length === 0) return null
  const summary = description ?? task ?? 'Parallel agents'
  const hasTaskDescription = task && task !== summary
  const stagesWithDescriptions = useMemo(() =>
    stages.map((stage) => ({
      ...stage,
      description: summarizePrompt(stage.prompt_template),
    })), [stages])
  return (
    <div className="rounded-lg border border-border/60 bg-card/60">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-label={expanded ? 'Collapse subagent details' : 'Expand subagent details'}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/5"
      >
        {expanded ? (
          <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" />
        ) : (
          <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <IconRobot className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />
        <span className="flex-1 truncate text-[13px] font-medium text-muted-foreground">
          {summary}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
          {isRunning && <IconLoader2 className="size-3 animate-spin text-primary" />}
          {isCompleted && !isRunning && <IconCircleCheck className="size-3 text-emerald-600 dark:text-emerald-400" />}
          <span className="rounded-full bg-violet-600/15 px-1.5 py-0.5 font-semibold text-violet-600 dark:bg-violet-400/15 dark:text-violet-400">
            {stages.length}
          </span>
          {stages.length === 1 ? 'agent' : 'agents'}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/50 px-3 py-2">
          {hasTaskDescription && (
            <p className="mb-2 px-1.5 text-[12px] leading-relaxed text-muted-foreground/70">
              {task}
            </p>
          )}
          <div className="flex flex-col gap-1">
            {stagesWithDescriptions.map((stage) => (
              <div key={stage.name} className="rounded-md bg-muted/30 px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <IconRobot className="size-3.5 shrink-0 text-violet-600/70 dark:text-violet-400/70" aria-hidden="true" />
                  <span className="text-[13px] font-medium leading-[1.6] text-foreground/85">
                    {stage.name}
                  </span>
                  <span className="rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {getRoleLabel(stage.role)}
                  </span>
                </div>
                {stage.description && (
                  <p className="mt-0.5 pl-5 text-[12px] leading-relaxed text-muted-foreground/70">
                    {stage.description}
                  </p>
                )}
                {stage.depends_on && stage.depends_on.length > 0 && (
                  <span className="mt-0.5 flex items-center gap-1 pl-5 text-[11px] text-muted-foreground/50">
                    <IconArrowRight className="size-2.5" />
                    depends on {stage.depends_on.join(', ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
