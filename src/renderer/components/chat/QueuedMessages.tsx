import { memo } from 'react'
import { IconCornerDownLeft, IconTrash, IconChevronUp, IconChevronDown, IconPhoto, IconPencil } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { QueuedMessage } from '@/stores/task-store-types'

interface QueuedMessagesProps {
  messages: QueuedMessage[]
  onRemove: (index: number) => void
  onReorder?: (from: number, to: number) => void
  onSteer?: (index: number) => void
  onEdit?: (index: number) => void
}

export const QueuedMessages = memo(function QueuedMessages({ messages, onRemove, onReorder, onSteer, onEdit }: QueuedMessagesProps) {
  if (messages.length === 0) return null

  const canReorder = messages.length >= 2 && !!onReorder

  return (
    <div className="mx-auto w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl px-4 sm:px-6">
      <div className="flex flex-col gap-1 pb-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Queued ({messages.length})
        </span>
        {messages.map((msg, i) => {
          const hasAttachments = !!msg.attachments?.length
          const attachmentCount = msg.attachments?.length ?? 0
          return (
            <div
              key={i}
              className={cn(
                'group flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-1.5',
                'animate-in slide-in-from-bottom-2 fade-in duration-200',
              )}
            >
              {canReorder && (
                <div className="flex shrink-0 flex-col -space-y-0.5 -my-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" disabled={i === 0} onClick={() => onReorder!(i, i - 1)}
                        className={cn(
                          'rounded p-0.5 transition-colors',
                          i === 0
                            ? 'text-muted-foreground/30 cursor-not-allowed'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                        aria-label={`Move "${msg.text?.slice(0, 30) || 'message'}" up`}
                        tabIndex={i === 0 ? -1 : 0}>
                        <IconChevronUp className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    {i > 0 && <TooltipContent side="left" className="text-[11px]">Move up</TooltipContent>}
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" disabled={i === messages.length - 1} onClick={() => onReorder!(i, i + 1)}
                        className={cn(
                          'rounded p-0.5 transition-colors',
                          i === messages.length - 1
                            ? 'text-muted-foreground/30 cursor-not-allowed'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                        aria-label={`Move "${msg.text?.slice(0, 30) || 'message'}" down`}
                        tabIndex={i === messages.length - 1 ? -1 : 0}>
                        <IconChevronDown className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    {i < messages.length - 1 && <TooltipContent side="left" className="text-[11px]">Move down</TooltipContent>}
                  </Tooltip>
                </div>
              )}
              {hasAttachments && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground" aria-label={`${attachmentCount} image${attachmentCount > 1 ? 's' : ''} attached`}>
                      <IconPhoto className="size-3.5" />
                      {attachmentCount > 1 && <span className="text-[10px]">{attachmentCount}</span>}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px]">
                    {attachmentCount} image{attachmentCount > 1 ? 's' : ''} attached
                  </TooltipContent>
                </Tooltip>
              )}
              <span className="flex-1 truncate text-[13px] text-foreground/85">{msg.text || (hasAttachments ? 'Image attachment' : '')}</span>
              {onSteer && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={() => onSteer(i)}
                      className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                      <IconCornerDownLeft className="size-3" /> Steer
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px]">Pause agent and send this message</TooltipContent>
                </Tooltip>
              )}
              {onEdit && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={() => onEdit(i)}
                      aria-label={`Edit queued message ${i + 1}`}
                      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-accent hover:text-foreground">
                      <IconPencil className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px]">Edit message</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => onRemove(i)}
                    aria-label={`Remove queued message ${i + 1}`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive">
                    <IconTrash className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[11px]">Remove</TooltipContent>
              </Tooltip>
            </div>
          )
        })}
      </div>
    </div>
  )
})
