import { memo, useEffect, useRef } from 'react'
import { IconArrowLeft, IconGitBranch, IconGitFork, IconLoader2, IconPlus } from '@tabler/icons-react'

export type InlineMode = 'none' | 'branch' | 'worktree'

interface CreateBranchDialogProps {
  inlineMode: InlineMode
  inlineValue: string
  checkingOut: boolean
  onInlineModeChange: (mode: InlineMode) => void
  onInlineValueChange: (value: string) => void
  onSubmit: () => void
}

export const CreateBranchDialog = memo(function CreateBranchDialog({
  inlineMode, inlineValue, checkingOut,
  onInlineModeChange, onInlineValueChange, onSubmit,
}: CreateBranchDialogProps) {
  const inlineInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inlineMode !== 'none') {
      requestAnimationFrame(() => inlineInputRef.current?.focus())
    }
  }, [inlineMode])

  if (inlineMode === 'none') {
    return (
      <div className="flex flex-col">
        <button
          type="button"
          aria-label="Create new branch"
          onClick={() => onInlineModeChange('branch')}
          disabled={checkingOut}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <IconPlus className="size-3.5" />
          <span>New branch</span>
        </button>
        <button
          type="button"
          aria-label="Create new worktree"
          onClick={() => onInlineModeChange('worktree')}
          disabled={checkingOut}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <IconGitFork className="size-3.5" />
          <span>New worktree</span>
        </button>
      </div>
    )
  }

  return (
    <div className="p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => { onInlineModeChange('none'); onInlineValueChange('') }}
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconArrowLeft className="size-3.5" />
        </button>
        <span className="text-xs font-medium text-foreground">
          {inlineMode === 'branch' ? 'Create branch' : 'Create worktree'}
        </span>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
        {inlineMode === 'branch'
          ? 'Enter a name for the new branch. It will be checked out after creation.'
          : 'Enter a slug for the worktree. A new branch and working directory will be created.'}
      </p>
      <div className="flex items-center gap-1.5">
        <input
          ref={inlineInputRef}
          type="text"
          value={inlineValue}
          onChange={(e) => onInlineValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onInlineModeChange('none')
              onInlineValueChange('')
            }
          }}
          placeholder={inlineMode === 'branch' ? 'feat/my-feature' : 'my-feature'}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-1 focus:ring-ring/30"
        />
        <button
          type="button"
          aria-label={inlineMode === 'branch' ? 'Create branch' : 'Create worktree'}
          onClick={onSubmit}
          disabled={!inlineValue.trim() || checkingOut}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {checkingOut ? (
            <IconLoader2 className="size-3 animate-spin" />
          ) : inlineMode === 'branch' ? (
            <IconGitBranch className="size-3" />
          ) : (
            <IconGitFork className="size-3" />
          )}
          {checkingOut ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  )
})
