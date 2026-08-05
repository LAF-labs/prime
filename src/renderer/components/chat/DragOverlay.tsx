import { memo } from 'react'
import { cn } from '@/lib/utils'

/**
 * Cute cat SVG that appears during drag-over.
 * The cat bounces and the border dashes animate via CSS keyframes.
 */
const CuteCat = () => (
  <svg
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="animate-bounce drop-shadow-md"
    aria-hidden
  >
    {/* Ears */}
    <path d="M14 22L20 8L26 22" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M38 22L44 8L50 22" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    {/* Inner ears */}
    <path d="M17 20L20 12L23 20" fill="currentColor" opacity="0.08" />
    <path d="M41 20L44 12L47 20" fill="currentColor" opacity="0.08" />
    {/* Head */}
    <circle cx="32" cy="34" r="18" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="2" />
    {/* Eyes - big and cute */}
    <circle cx="25" cy="32" r="3.5" fill="currentColor" opacity="0.7" />
    <circle cx="39" cy="32" r="3.5" fill="currentColor" opacity="0.7" />
    {/* Eye shine */}
    <circle cx="26.5" cy="30.5" r="1.2" fill="white" opacity="0.9" />
    <circle cx="40.5" cy="30.5" r="1.2" fill="white" opacity="0.9" />
    {/* Nose */}
    <path d="M30.5 37L32 39L33.5 37" fill="currentColor" opacity="0.5" strokeLinecap="round" />
    {/* Mouth */}
    <path d="M32 39C32 39 29 41 27 40" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.3" />
    <path d="M32 39C32 39 35 41 37 40" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.3" />
    {/* Whiskers */}
    <line x1="10" y1="34" x2="22" y2="36" stroke="currentColor" strokeWidth="1" opacity="0.2" strokeLinecap="round" />
    <line x1="10" y1="38" x2="22" y2="38" stroke="currentColor" strokeWidth="1" opacity="0.2" strokeLinecap="round" />
    <line x1="42" y1="36" x2="54" y2="34" stroke="currentColor" strokeWidth="1" opacity="0.2" strokeLinecap="round" />
    <line x1="42" y1="38" x2="54" y2="38" stroke="currentColor" strokeWidth="1" opacity="0.2" strokeLinecap="round" />
    {/* Paws at bottom */}
    <ellipse cx="26" cy="52" rx="5" ry="3" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1.5" />
    <ellipse cx="38" cy="52" rx="5" ry="3" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

interface DragOverlayProps {
  visible: boolean
}

export const DragOverlay = memo(function DragOverlay({ visible }: DragOverlayProps) {
  return (
    <div
      className={cn(
        'absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 rounded-[20px] bg-background/80 backdrop-blur-sm transition-opacity duration-200',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-hidden={!visible}
    >
      {/* Animated dashed border */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        <rect
          x="2"
          y="2"
          rx="20"
          ry="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="8 6"
          className="text-primary"
          style={{
            width: 'calc(100% - 4px)',
            height: 'calc(100% - 4px)',
            animation: visible ? 'dash-march 0.6s linear infinite' : 'none',
          }}
        />
      </svg>
      <CuteCat />
      <span className="text-sm font-medium text-foreground/60">
        Drop files here
      </span>
      <span className="text-sm text-muted-foreground">
        Images, code, documents
      </span>
      <style>{`
        @keyframes dash-march {
          to { stroke-dashoffset: -28; }
        }
      `}</style>
    </div>
  )
})
