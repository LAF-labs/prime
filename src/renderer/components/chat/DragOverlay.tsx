import { t } from '@/lib/i18n'
import { memo } from 'react'
import { IconPaperclip } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

interface DragOverlayProps {
  visible: boolean
}

/**
 * Drop target shown over the composer while files are dragged in.
 *
 * Deliberately plain: one icon and two lines of text over a frosted panel,
 * with the composer's own border going dashed underneath. The previous version
 * bounced a cat SVG over a marching-dash border — a lot of motion for a state
 * that lasts under a second.
 */
export const DragOverlay = memo(function DragOverlay({ visible }: DragOverlayProps) {
  return (
    <div
      className={cn(
        'absolute inset-0 z-50 flex flex-col items-center justify-center gap-1.5 rounded-[18px]',
        'bg-background/90 transition-opacity duration-150',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-hidden={!visible}
    >
      <IconPaperclip className="size-5 text-primary/70" aria-hidden />
      <span className="text-[13px] font-medium text-foreground/80">
        {t('Drop files here')}
      </span>
      <span className="text-[12px] text-muted-foreground">
        {t('Images, code, documents')}
      </span>
    </div>
  )
})
