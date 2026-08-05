import { useCallback, useRef } from 'react'

type Axis = 'horizontal' | 'vertical'

interface UseResizeHandleOptions {
  /** 'horizontal' = drag left/right (width), 'vertical' = drag up/down (height) */
  axis: Axis
  /** Current size in px */
  size: number
  /** Setter for the size */
  onResize: (size: number) => void
  /** Minimum allowed size */
  min: number
  /** Maximum allowed size */
  max: number
  /** If true, delta is inverted (e.g. dragging left increases width for a right-edge handle) */
  reverse?: boolean
  /** Called when drag starts */
  onDragStart?: () => void
  /** Called when drag ends */
  onDragEnd?: () => void
}

/**
 * Shared resize-handle hook with rAF throttling, cursor lock, and selection prevention.
 * Returns an onMouseDown handler to attach to the drag handle element.
 */
export function useResizeHandle({
  axis, size, onResize, min, max, reverse = false,
  onDragStart, onDragEnd,
}: UseResizeHandleOptions): (e: React.MouseEvent) => void {
  const sizeRef = useRef(size)
  sizeRef.current = size
  const rafId = useRef(0)

  return useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startPos = axis === 'horizontal' ? e.clientX : e.clientY
    const startSize = sizeRef.current
    const cursor = axis === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    // Prevent pointer events on iframes/webviews during drag
    document.body.style.pointerEvents = 'none'
    ;(e.target as HTMLElement).style.pointerEvents = 'auto'
    onDragStart?.()
    const handleMove = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const currentPos = axis === 'horizontal' ? ev.clientX : ev.clientY
        const delta = reverse ? startPos - currentPos : currentPos - startPos
        const next = Math.round(Math.max(min, Math.min(max, startSize + delta)))
        onResize(next)
      })
    }
    const handleUp = () => {
      cancelAnimationFrame(rafId.current)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.style.pointerEvents = ''
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      onDragEnd?.()
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [axis, onResize, min, max, reverse, onDragStart, onDragEnd])
}
