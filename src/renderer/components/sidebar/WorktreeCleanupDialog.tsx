import { t } from '@/lib/i18n'
import { useCallback, useState } from 'react'
import { IconGitBranch, IconAlertTriangle, IconLoader2, IconGitPullRequest } from '@tabler/icons-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CreatePrDialog } from '@/components/CreatePrDialog'
import { useTaskStore } from '@/stores/taskStore'

export const WorktreeCleanupDialog = () => {
  const pending = useTaskStore((s) => s.worktreeCleanupPending)
  const resolve = useTaskStore((s) => s.resolveWorktreeCleanup)
  const [prDialogOpen, setPrDialogOpen] = useState(false)

  const handleRemoveWorktree = useCallback(() => resolve(true), [resolve])
  const handleKeepWorktree = useCallback(() => resolve(false), [resolve])
  const handleCancel = useCallback(() => {
    useTaskStore.setState({ worktreeCleanupPending: null })
  }, [])

  if (!pending) return null

  const isLoading = pending.hasChanges === null
  const hasChanges = pending.hasChanges === true
  const actionLabel = pending.action === 'archive' ? 'Close' : 'Delete'

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleCancel() }}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <IconGitBranch className="size-5 text-violet-500" aria-hidden />
            {actionLabel} worktree thread
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                {t('Branch')} <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-medium text-foreground/80">worktree-{pending.branch}</code>
              </p>
              {isLoading && (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <IconLoader2 className="size-3.5 animate-spin" aria-hidden />
                  Checking for uncommitted changes…
                </p>
              )}
              {hasChanges && (
                <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <IconAlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  {t('This worktree has uncommitted changes that will be lost if removed.')}
                </p>
              )}
              {!isLoading && !hasChanges && (
                <p className="text-muted-foreground">{t('No uncommitted changes detected.')}</p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {/* The worktree's commits are gone with it — offer to turn them
              into a PR before anything is removed. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrDialogOpen(true)}
            disabled={isLoading}
            className="w-full"
          >
            <IconGitPullRequest className="size-3.5" aria-hidden />
            {t('Create a pull request first…')}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel} className="flex-1">
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRemoveWorktree}
              disabled={isLoading}
              className="flex-1"
            >
              {actionLabel} &amp; remove worktree
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleKeepWorktree}
            disabled={isLoading}
            className="w-full text-muted-foreground"
          >
            {actionLabel} thread, keep worktree on disk
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* PR creation runs against the worktree directory, so the branch and
          its commits are what the PR captures. Stacks above this dialog. */}
      <CreatePrDialog
        open={prDialogOpen}
        onOpenChange={setPrDialogOpen}
        workspace={pending.worktreePath}
      />
    </Dialog>
  )
}
