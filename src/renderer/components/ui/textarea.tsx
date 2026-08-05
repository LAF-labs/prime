import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <span
        className={cn(
          'relative inline-flex w-full rounded-lg border border-input bg-background text-sm text-foreground shadow-xs/5 ring-ring/24 transition-shadow has-focus-visible:border-ring has-focus-visible:ring-[3px] has-disabled:opacity-50 has-[:disabled,:focus-visible]:shadow-none',
          className,
        )}
        data-slot="textarea-control"
      >
        <textarea
          className="field-sizing-content min-h-17.5 w-full rounded-[inherit] bg-transparent px-3 py-1.5 outline-none placeholder:text-muted-foreground"
          ref={ref}
          data-slot="textarea"
          {...props}
        />
      </span>
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
