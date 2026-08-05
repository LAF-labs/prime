import { forwardRef, type ElementRef, type ComponentPropsWithoutRef } from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

const Label = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex items-center gap-2 text-sm font-medium text-foreground',
      className,
    )}
    data-slot="label"
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
