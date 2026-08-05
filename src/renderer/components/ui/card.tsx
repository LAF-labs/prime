import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl border bg-card text-card-foreground shadow-xs/5',
        className,
      )}
      data-slot="card"
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 p-6', className)}
      data-slot="card-header"
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('font-semibold text-lg leading-none', className)}
      data-slot="card-title"
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('text-muted-foreground text-sm', className)}
      data-slot="card-description"
      {...props}
    />
  )
}

function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex-1 p-6 pt-0', className)}
      data-slot="card-content"
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center p-6 pt-0', className)}
      data-slot="card-footer"
      {...props}
    />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
