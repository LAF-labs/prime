import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-skeleton rounded-sm bg-muted [background:linear-gradient(120deg,transparent_40%,rgba(0,0,0,0.04),transparent_60%)_var(--muted)_0_0/200%_100%_fixed] dark:[background:linear-gradient(120deg,transparent_40%,rgba(255,255,255,0.1),transparent_60%)_var(--muted)_0_0/200%_100%_fixed]',
        className,
      )}
      data-slot="skeleton"
      {...props}
    />
  )
}

export { Skeleton }
