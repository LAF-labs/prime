import { forwardRef, type HTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*=opacity-])]:opacity-80 [&_svg:not([class*=size-])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        error: 'bg-destructive/8 text-destructive dark:bg-destructive/16',
        info: 'bg-info/8 text-info-foreground dark:bg-info/16',
        outline: 'border-input bg-background text-foreground dark:bg-input/32 hover:bg-accent/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
        success: 'bg-success/8 text-success-foreground dark:bg-success/16',
        warning: 'bg-warning/8 text-warning-foreground dark:bg-warning/16',
      },
      size: {
        sm: 'h-5 min-w-5 rounded-[.25rem] px-1 text-xs',
        default: 'h-5.5 min-w-5.5 px-1 text-xs',
        lg: 'h-6.5 min-w-6.5 px-1.5 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'span'
    return (
      <Comp
        className={cn(badgeVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
