import { memo, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useResizeHandle } from '@/hooks/useResizeHandle'

interface SplitDividerProps {
  readonly containerWidth: number
  readonly ratio: number
  readonly onRatioChange: (ratio: number) => void
  readonly onReset: () => void
}

const MIN_PANEL_PX = 400

export const SplitDivider = memo(function SplitDivider({
  containerWidth,
  ratio,
  onRatioChange,
  onReset,
}: SplitDividerProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleResize = useCallback((px: number) => {
    if (containerWidth <= 0) return
    onRatioChange(px / containerWidth)
  }, [containerWidth, onRatioChange])

  const currentPx = Math.round(ratio * containerWidth)

  const onMouseDown = useResizeHandle({
    axis: 'horizontal',
    size: currentPx,
    onResize: handleResize,
    min: MIN_PANEL_PX,
    max: containerWidth - MIN_PANEL_PX,
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
  })

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      tabIndex={0}
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); onRatioChange(ratio - 0.05) }
        if (e.key === 'ArrowRight') { e.preventDefault(); onRatioChange(ratio + 0.05) }
        if (e.key === 'Enter') { e.preventDefault(); onReset() }
      }}
      className={cn(
        'group relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center',
        'before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[""]',
        'focus-visible:outline-none',
      )}
    >
      {/* The visible line */}
      <div
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-100',
          isDragging ? 'bg-primary/60' : 'bg-border/80 group-hover:bg-muted-foreground/30',
        )}
      />
      {/* Grip dots — appear on hover */}
      <div
        className={cn(
          'relative z-10 flex flex-col items-center gap-1 transition-all duration-150',
          isDragging
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <div className={cn('size-1 rounded-full', isDragging ? 'bg-primary/60' : 'bg-muted-foreground/30')} />
        <div className={cn('size-1 rounded-full', isDragging ? 'bg-primary/60' : 'bg-muted-foreground/30')} />
        <div className={cn('size-1 rounded-full', isDragging ? 'bg-primary/60' : 'bg-muted-foreground/30')} />
      </div>
    </div>
  )
})
