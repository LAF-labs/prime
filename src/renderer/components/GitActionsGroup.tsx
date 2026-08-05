import { useState, useRef, useEffect, useCallback } from 'react'
import { IconGitCommit, IconChevronDown, IconArrowUp, IconArrowDown, IconRefresh, IconLoader2, IconCloudUpload } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ipc } from '@/lib/ipc'
import { track } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { CommitDialog } from '@/components/CommitDialog'
import { PublishRepoDialog } from '@/components/PublishRepoDialog'
import { DefaultBranchConfirmDialog, isDefaultBranch, type DefaultBranchAction } from '@/components/DefaultBranchConfirmDialog'
import { withGitToast } from '@/lib/git-toast'

const GitHubIcon = () => (
  <svg aria-hidden className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
)

type GitAction = 'push' | 'pull' | 'fetch' | 'commit' | null

interface GitStatus {
  branch: string
  aheadCount: number
  behindCount: number
  isDirty: boolean
  changedFileCount: number
  hasUpstream: boolean
}

export function GitActionsGroup({ workspace }: { workspace: string }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [activeAction, setActiveAction] = useState<GitAction>(null)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [defaultBranchConfirm, setDefaultBranchConfirm] = useState<{
    open: boolean
    action: DefaultBranchAction
    onContinue: () => void
  }>({ open: false, action: 'push', onContinue: () => {} })
  const ref = useRef<HTMLDivElement>(null)
  const statusFetchRef = useRef(0) // Monotonic counter to discard stale fetches

  // Fetch git status when menu opens (debounced via counter to prevent rapid concurrent calls)
  useEffect(() => {
    if (!menuOpen) return
    const fetchId = ++statusFetchRef.current
    ipc.gitVcsStatus(workspace).then((status) => {
      if (statusFetchRef.current === fetchId) setGitStatus(status)
    }).catch(() => {
      if (statusFetchRef.current === fetchId) setGitStatus(null)
    })
  }, [menuOpen, workspace])

  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  const runGitAction = useCallback(async (key: GitAction, action: () => Promise<unknown>, label: string) => {
    setActiveAction(key)
    try {
      await withGitToast(label, action, {
        successDetail: (result) => typeof result === 'string' && result.includes('Already up to date')
          ? 'Already up to date'
          : 'Done',
      })
      track('feature_used', { feature: 'git', detail: key ?? label.toLowerCase() })
    } catch {
      // Error toast already shown by withGitToast
    } finally { setActiveAction(null); setMenuOpen(false) }
  }, [])

  // Push with default branch confirmation
  const handlePush = useCallback(() => {
    const branch = gitStatus?.branch ?? null
    if (isDefaultBranch(branch)) {
      setMenuOpen(false)
      setDefaultBranchConfirm({
        open: true,
        action: 'push',
        onContinue: () => void runGitAction('push', () => ipc.gitPush(workspace), 'Push'),
      })
    } else {
      void runGitAction('push', () => ipc.gitPush(workspace), 'Push')
    }
  }, [gitStatus, workspace, runGitAction])

  const handleOpenGitHub = useCallback(async () => {
    setMenuOpen(false)
    try {
      const [remoteUrl, branches] = await Promise.all([
        ipc.gitRemoteUrl(workspace),
        ipc.gitListBranches(workspace),
      ])
      if (!remoteUrl) return
      const branch = branches.currentBranch
      const isDefault = !branch || branch === 'main' || branch === 'master'
      ipc.openUrl(isDefault ? remoteUrl : `${remoteUrl}/tree/${branch}`)
    } catch {
      try { const url = await ipc.gitRemoteUrl(workspace); if (url) ipc.openUrl(url) }
      catch { /* no remote */ }
    }
  }, [workspace])

  const handleOpenPublish = useCallback(() => {
    setMenuOpen(false)
    setPublishDialogOpen(true)
  }, [])

  const busy = activeAction !== null

  // Smart disabled states
  const pushDisabled = busy || (gitStatus ? (!gitStatus.isDirty && gitStatus.aheadCount === 0) : false)
  const pushHint = gitStatus && !gitStatus.isDirty && gitStatus.aheadCount === 0
    ? 'No local commits to push'
    : gitStatus && gitStatus.behindCount > 0
      ? 'Branch is behind upstream. Pull first.'
      : undefined
  const commitDisabled = busy || (gitStatus ? !gitStatus.isDirty : false)
  const commitHint = gitStatus && !gitStatus.isDirty ? 'Worktree is clean' : undefined

  return (
    <div ref={ref} data-testid="git-actions-group" className="relative">
      {/* Chevron — sits flush against the diff stats button on the left */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="Git options" data-testid="git-options-button"
            onClick={() => { setMenuOpen((v) => !v) }}
            className="inline-flex h-7 w-6 items-center justify-center rounded-r-lg text-emerald-400 transition-colors hover:bg-emerald-500/10">
            <IconChevronDown className={cn('size-3 transition-transform', menuOpen && 'rotate-180')} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Git actions</TooltipContent>
      </Tooltip>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute right-0 top-7 z-[200] min-w-[160px] rounded-lg border border-border bg-popover py-1 shadow-lg">
          <GitMenuItem icon={IconGitCommit} label="Commit" loading={activeAction === 'commit'} disabled={commitDisabled}
            hint={commitHint}
            onClick={() => { setMenuOpen(false); setCommitDialogOpen(true) }} />
          <GitMenuItem icon={IconArrowUp} label="Push" loading={activeAction === 'push'} disabled={pushDisabled}
            hint={pushHint}
            onClick={handlePush} />
          <GitMenuItem icon={IconArrowDown} label="Pull" loading={activeAction === 'pull'} disabled={busy}
            onClick={() => void runGitAction('pull', () => ipc.gitPull(workspace), 'Pull')} />
          <GitMenuItem icon={IconRefresh} label="Fetch" loading={activeAction === 'fetch'} disabled={busy}
            onClick={() => void runGitAction('fetch', () => ipc.gitFetch(workspace), 'Fetch')} />
          <div className="mx-2 my-1 border-t border-border/40" />
          <GitMenuItem icon={IconCloudUpload} label="Publish" loading={false} disabled={busy}
            onClick={handleOpenPublish} />
          <button type="button" onClick={() => void handleOpenGitHub()}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors">
            <GitHubIcon /> GitHub
          </button>
        </div>
      )}

      {/* Commit dialog */}
      <CommitDialog
        open={commitDialogOpen}
        onOpenChange={setCommitDialogOpen}
        workspace={workspace}
      />

      {/* Publish repository dialog */}
      <PublishRepoDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        workspace={workspace}
      />

      {/* Default branch confirmation */}
      <DefaultBranchConfirmDialog
        open={defaultBranchConfirm.open}
        onOpenChange={(open) => setDefaultBranchConfirm((s) => ({ ...s, open }))}
        workspace={workspace}
        branchName={gitStatus?.branch ?? 'main'}
        action={defaultBranchConfirm.action}
        onContinue={defaultBranchConfirm.onContinue}
        onCreateBranch={() => {
          // Branch was created by the dialog; now proceed with the original
          // action (e.g. push) on the newly checked-out branch.
          defaultBranchConfirm.onContinue()
        }}
      />
    </div>
  )
}

function GitMenuItem({ icon: Icon, label, loading, disabled, hint, onClick }: {
  icon: typeof IconArrowUp
  label: string
  loading: boolean
  disabled: boolean
  hint?: string
  onClick: () => void
}) {
  const button = (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors disabled:opacity-50',
        loading ? 'text-primary' : 'text-foreground hover:bg-accent',
      )}>
      {loading
        ? <IconLoader2 className="size-3.5 animate-spin" />
        : <Icon className="size-3.5" />}
      {label}
      {loading && <span className="ml-auto text-[10px] text-muted-foreground">…</span>}
    </button>
  )

  if (hint && disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="left" className="max-w-48 text-xs">{hint}</TooltipContent>
      </Tooltip>
    )
  }

  return button
}
