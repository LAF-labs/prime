import { type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full items-start gap-x-2 gap-y-0.5 rounded-xl border px-3.5 py-3 text-sm has-[>svg]:grid-cols-[1rem_1fr] has-[>svg]:gap-x-2 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        default: 'bg-transparent dark:bg-input/32 [&>svg]:text-muted-foreground',
        error: 'border-destructive/32 bg-destructive/4 [&>svg]:text-destructive',
        info: 'border-info/32 bg-info/4 [&>svg]:text-info',
        success: 'border-success/32 bg-success/4 [&>svg]:text-success',
        warning: 'border-warning/32 bg-warning/4 [&>svg]:text-warning',
        destructive: 'border-destructive/32 bg-destructive/4 text-destructive [&>svg]:text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Alert({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return (
    <div
      className={cn(alertVariants({ variant }), className)}
      data-slot="alert"
      role="alert"
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('font-medium [svg~&]:col-start-2', className)}
      data-slot="alert-title"
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-2.5 text-muted-foreground [svg~&]:col-start-2', className)}
      data-slot="alert-description"
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
