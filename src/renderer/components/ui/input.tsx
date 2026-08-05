import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <span
        className={cn(
          'relative inline-flex w-full rounded-lg border border-input bg-background text-sm text-foreground shadow-xs/5 ring-ring/24 transition-shadow has-focus-visible:border-ring has-focus-visible:ring-[3px] has-disabled:opacity-50 has-[:disabled,:focus-visible]:shadow-none',
          className,
        )}
        data-slot="input-control"
      >
        <input
          type={type}
          className="h-8.5 w-full min-w-0 rounded-[inherit] bg-transparent px-3 leading-8.5 outline-none placeholder:text-muted-foreground sm:h-7.5 sm:leading-7.5"
          ref={ref}
          data-slot="input"
          {...props}
        />
      </span>
    )
  },
)
Input.displayName = 'Input'

export { Input }
