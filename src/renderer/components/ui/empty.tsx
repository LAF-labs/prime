import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

function Empty({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-6 text-balance p-6 text-center md:p-12',
        className,
      )}
      data-slot="empty"
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex max-w-sm flex-col items-center text-center', className)}
      data-slot="empty-header"
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('font-semibold text-xl', className)}
      data-slot="empty-title"
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'text-muted-foreground text-sm [[data-slot=empty-title]+&]:mt-1',
        className,
      )}
      data-slot="empty-description"
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-balance text-sm',
        className,
      )}
      data-slot="empty-content"
      {...props}
    />
  )
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent }
