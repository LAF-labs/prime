import { memo, useCallback } from 'react'
import { IconBolt } from '@tabler/icons-react'
import { t } from '@/lib/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AgentSkill, ProjectFile } from '@/types'
import { setInAppDragActive, setInAppDragData } from '@/hooks/useAttachments'
import { type ViewerState, formatName, SourceDot } from './resource-helpers'

export const SkillRow = memo(function SkillRow({ skill, onOpen }: { skill: AgentSkill; onOpen: (v: ViewerState) => void }) {
  const handleDragStart = useCallback((e: React.DragEvent) => {
    // Drag a synthetic ProjectFile with a `skill:` prefix so the chat input's
    // useAttachments hook routes it through the same droppedFiles → mention pill
    // pipeline used for real files. The renderer (FileMentionPill) already
    // recognises this prefix and styles the pill with the lightning icon.
    const projectFile: ProjectFile = {
      path: `skill:${skill.name}`,
      name: skill.name,
      dir: '',
      isDir: false,
      ext: '',
      modifiedAt: 0,
    }
    e.dataTransfer.effectAllowed = 'copy'
    setInAppDragActive(true)
    setInAppDragData({ type: 'file', data: projectFile })
    e.dataTransfer.setData('application/x-laf-agent-file', JSON.stringify(projectFile))
    e.dataTransfer.setData('text/plain', `@skill:${skill.name}`)
  }, [skill.name])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <li
          // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- must remain an <li> for list semantics; the whole row is also a draggable chip
          role="button"
          tabIndex={0}
          draggable
          onDragStart={handleDragStart}
          onClick={() => skill.filePath && onOpen({ filePath: skill.filePath, title: formatName(skill.name) })}
          onKeyDown={(e) => e.key === 'Enter' && skill.filePath && onOpen({ filePath: skill.filePath, title: formatName(skill.name) })}
          className={cn(
            'flex h-6 min-w-0 w-full items-center gap-1.5 rounded-md px-1.5 text-[11px] cursor-grab active:cursor-grabbing select-none',
            'text-muted-foreground/80 hover:bg-accent/50 hover:text-foreground transition-colors',
          )}
        >
          <IconBolt className="size-3 shrink-0 text-amber-600 dark:text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.6)]" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{formatName(skill.name)}</span>
          <SourceDot source={skill.source} />
        </li>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[220px]">
        <p className="text-[11px] font-medium">{formatName(skill.name)}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('Click to view · drag into chat to attach as')} <code className="rounded bg-muted/60 px-1 font-mono text-[11px]">@skill:{skill.name}</code></p>
      </TooltipContent>
    </Tooltip>
  )
})
