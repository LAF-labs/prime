import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  '[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*=opacity-])]:opacity-80 [&_svg:not([class*=size-])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/24 hover:bg-primary/90 active:shadow-none',
        destructive:
          'border-destructive bg-destructive text-white shadow-xs shadow-destructive/24 hover:bg-destructive/90 active:shadow-none',
        pink:
          'border-pink bg-pink text-pink-foreground shadow-xs shadow-pink/24 hover:bg-pink/90 active:shadow-none',
        'destructive-outline':
          'border-input bg-popover text-destructive shadow-xs/5 hover:border-destructive/32 hover:bg-destructive/4',
        outline:
          'border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent/50',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90 active:bg-secondary/80',
        ghost:
          'border-transparent text-foreground hover:bg-accent',
        link:
          'border-transparent underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-7 gap-1 rounded-md px-2 text-xs',
        sm: 'h-8 gap-1.5 px-2.5',
        default: 'h-9 px-3',
        lg: 'h-10 px-3.5',
        xl: 'h-11 px-4 text-base',
        icon: 'size-9',
        'icon-xs': 'size-7 rounded-md',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
        'icon-xl': 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
