import { useState, useCallback } from 'react'
import { IconAlertTriangle, IconGitBranch, IconLoader2 } from '@tabler/icons-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ipc } from '@/lib/ipc'

const DEFAULT_BRANCHES = ['main', 'master', 'develop', 'dev']

export type DefaultBranchAction = 'commit' | 'push' | 'commit_push'

interface DefaultBranchConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: string
  branchName: string
  action: DefaultBranchAction
  /** Called when user confirms to proceed on the default branch */
  onContinue: () => void
  /** Called when user wants to create a feature branch first */
  onCreateBranch?: (branch: string) => void
}

function getActionLabel(action: DefaultBranchAction): string {
  switch (action) {
    case 'commit': return 'Commit'
    case 'push': return 'Push'
    case 'commit_push': return 'Commit & Push'
  }
}

function getDescription(action: DefaultBranchAction, branch: string): string {
  switch (action) {
    case 'commit':
      return `You're about to commit directly to "${branch}". Consider creating a feature branch for better change tracking.`
    case 'push':
      return `You're about to push directly to "${branch}". This will affect the shared branch immediately.`
    case 'commit_push':
      return `You're about to commit and push directly to "${branch}". This will affect the shared branch immediately.`
  }
}

export function isDefaultBranch(branch: string | null): boolean {
  if (!branch) return false
  return DEFAULT_BRANCHES.includes(branch)
}

export function DefaultBranchConfirmDialog({
  open,
  onOpenChange,
  workspace,
  branchName,
  action,
  onContinue,
  onCreateBranch,
}: DefaultBranchConfirmDialogProps) {
  const [newBranchName, setNewBranchName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleContinue = useCallback(() => {
    onOpenChange(false)
    onContinue()
  }, [onOpenChange, onContinue])

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim()
    if (!name) return
    setIsCreating(true)
    try {
      await ipc.gitCreateAndCheckoutBranch(workspace, name)
      toast.success('Branch created', { description: `Switched to ${name}` })
      onOpenChange(false)
      onCreateBranch?.(name)
    } catch (e) {
      toast.error('Failed to create branch', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setIsCreating(false)
    }
  }, [newBranchName, workspace, onOpenChange, onCreateBranch])

  const handleClose = useCallback(() => {
    setNewBranchName('')
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconAlertTriangle className="size-5 text-orange-400" />
            {getActionLabel(action)} on default branch?
          </DialogTitle>
          <DialogDescription>
            {getDescription(action, branchName)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-6 pb-2">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <IconGitBranch className="size-3" />
              Create a feature branch instead
            </p>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newBranchName.trim()) {
                  e.preventDefault()
                  void handleCreateBranch()
                }
              }}
              placeholder="feature/my-changes"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        <DialogFooter className="sm:flex-wrap">
          <Button variant="outline" size="sm" onClick={handleClose} className="w-full sm:w-auto sm:mr-auto">
            Abort
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleContinue}
            className="w-full sm:w-auto"
          >
            Continue on {branchName}
          </Button>
          <Button
            size="sm"
            disabled={!newBranchName.trim() || isCreating}
            onClick={() => void handleCreateBranch()}
            className="w-full sm:w-auto"
          >
            {isCreating
              ? <><IconLoader2 className="size-3.5 animate-spin mr-1" /> Creating…</>
              : 'Checkout feature branch & continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
