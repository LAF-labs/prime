import { t } from '@/lib/i18n'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  IconLoader2, IconSparkles, IconGitPullRequest, IconAlertTriangle,
  IconExternalLink, IconCircleCheck, IconArrowUp,
} from '@tabler/icons-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'

interface CreatePrDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Directory the PR is created from (project root or a worktree). */
  workspace: string
}

/** Base-branch preference order when the repo doesn't tell us its default. */
const DEFAULT_BASE_CANDIDATES = ['main', 'master', 'develop', 'dev'] as const

interface PrMeta {
  branches: string[]
  currentBranch: string
  provider: 'github' | 'gitlab' | null
  cliAvailable: boolean
  authenticated: boolean
  hasOpenPr: boolean
  existingPrUrl: string | null
  needsPush: boolean
}

/**
 * Turn a raw CLI/backend failure into something the user can act on.
 * The backend already prefixes context ("gh pr create failed: …"); this adds
 * the "what do I do now" for the recognizable cases.
 */
const actionableError = (raw: string): string => {
  const lower = raw.toLowerCase()
  if (lower.includes('already exists')) {
    return t('A pull request for this branch already exists. Open it on the remote instead.')
  }
  if (lower.includes('not logged') || lower.includes('auth') || lower.includes('authentication')) {
    return `${raw}\n${t('Authenticate the CLI first (gh auth login / glab auth login), then try again.')}`
  }
  if (lower.includes('must first push') || lower.includes('no commits between') || lower.includes('head sha')) {
    return `${raw}\n${t('Push the branch and make sure it has commits ahead of the base branch.')}`
  }
  if (lower.includes('not installed')) {
    return raw // backend message already includes the brew install hint
  }
  return raw
}

export function CreatePrDialog({ open, onOpenChange, workspace }: CreatePrDialogProps) {
  const [meta, setMeta] = useState<PrMeta | null>(null)
  const [isLoadingMeta, setIsLoadingMeta] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [baseBranch, setBaseBranch] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [isDraft, setIsDraft] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)

  const resetState = useCallback(() => {
    setMeta(null)
    setMetaError(null)
    setBaseBranch('')
    setTitle('')
    setBody('')
    setIsDraft(false)
    setGenerateError(null)
    setCreateError(null)
    setCreatedUrl(null)
  }, [])

  const handleClose = useCallback(() => {
    resetState()
    onOpenChange(false)
  }, [onOpenChange, resetState])

  const handleGenerate = useCallback(async (base: string) => {
    if (!base) return
    setIsGenerating(true)
    setGenerateError(null)
    try {
      const generated = await ipc.generatePrContent(workspace, base, workspace)
      setTitle(generated.title)
      setBody(generated.body)
    } catch (e) {
      // Generation failing is not fatal — the user can still type the PR
      // content by hand — so it surfaces inline instead of blocking.
      setGenerateError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsGenerating(false)
    }
  }, [workspace])

  // Fetch branches, provider, PR status, and VCS status when opened.
  const fetchMeta = useCallback(async () => {
    setIsLoadingMeta(true)
    setMetaError(null)
    try {
      const [branches, provider, prStatus, vcsStatus] = await Promise.all([
        ipc.gitListBranches(workspace),
        ipc.gitDetectProvider(workspace),
        ipc.gitPrStatus(workspace).catch(() => null),
        ipc.gitVcsStatus(workspace).catch(() => null),
      ])
      const current = branches.currentBranch
      const locals = branches.local.map((b) => b.name).filter((n) => n !== current)
      const defaultBase = DEFAULT_BASE_CANDIDATES.find((c) => locals.includes(c)) ?? locals[0] ?? ''
      const nextMeta: PrMeta = {
        branches: locals,
        currentBranch: current,
        provider: provider.provider,
        cliAvailable: provider.cliAvailable,
        authenticated: provider.authenticated,
        hasOpenPr: prStatus?.hasOpenPr ?? false,
        existingPrUrl: prStatus?.prUrl ?? null,
        needsPush: vcsStatus ? !vcsStatus.hasUpstream || vcsStatus.aheadCount > 0 : false,
      }
      setMeta(nextMeta)
      setBaseBranch(defaultBase)
      // Prefill title/body once the base branch is known. Skip when a PR
      // already exists — creation is disabled in that case anyway.
      if (defaultBase && !nextMeta.hasOpenPr && nextMeta.provider !== null) {
        void handleGenerate(defaultBase)
      }
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsLoadingMeta(false)
    }
  }, [workspace, handleGenerate])

  useEffect(() => {
    if (open) void fetchMeta()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only on open
  }, [open, workspace])

  const handleCreate = useCallback(async () => {
    if (!meta || !baseBranch || !title.trim()) return
    setIsCreating(true)
    setCreateError(null)
    try {
      // The CLI requires the branch on the remote. Push first when the local
      // branch is ahead or has no upstream — otherwise `gh pr create` fails
      // with "must first push".
      if (meta.needsPush) {
        await ipc.gitPush(workspace)
      }
      const result = await ipc.gitCreatePr(workspace, title.trim(), body, baseBranch, isDraft)
      setCreatedUrl(result.url)
    } catch (e) {
      setCreateError(actionableError(e instanceof Error ? e.message : String(e)))
    } finally {
      setIsCreating(false)
    }
  }, [meta, baseBranch, title, body, isDraft, workspace])

  const blockedReason = useMemo((): string | null => {
    if (!meta) return null
    if (meta.provider === null) {
      return t('The origin remote is not GitHub or GitLab, so a pull request cannot be created from here.')
    }
    if (!meta.cliAvailable) {
      return meta.provider === 'github'
        ? t('GitHub CLI (gh) is not installed. Install it with: brew install gh')
        : t('GitLab CLI (glab) is not installed. Install it with: brew install glab')
    }
    if (meta.branches.length === 0) {
      return t('This repository has no other branch to use as the base.')
    }
    return null
  }, [meta])

  const createDisabled = isCreating || isLoadingMeta || !meta || !baseBranch || !title.trim()
    || blockedReason !== null || meta.hasOpenPr

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconGitPullRequest className="size-4 text-emerald-500" aria-hidden />
            {t('Create Pull Request')}
          </DialogTitle>
          <DialogDescription>
            {createdUrl
              ? t('The pull request was created.')
              : t('Open a pull request for the current branch. Title and body are generated from the diff.')}
          </DialogDescription>
        </DialogHeader>

        {createdUrl ? (
          // ── Success state ──────────────────────────────────────────
          <div className="space-y-3 px-6 pb-2">
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
              <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-foreground">{title}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{createdUrl}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-6 pb-2 overflow-y-auto">
            {isLoadingMeta && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" aria-hidden />
                {t('Checking repository state…')}
              </div>
            )}

            {metaError !== null && !isLoadingMeta && (
              <div className="flex flex-col gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-xs">
                <p className="flex items-start gap-1.5 text-destructive">
                  <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{t('Could not read the repository')}: {metaError}</span>
                </p>
                <button
                  type="button"
                  onClick={() => void fetchMeta()}
                  className="self-start rounded-md border border-destructive/30 px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/15"
                >
                  {t('Retry')}
                </button>
              </div>
            )}

            {meta && !isLoadingMeta && (
              <>
                {blockedReason !== null && (
                  <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                    <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{blockedReason}</span>
                  </p>
                )}

                {meta.hasOpenPr && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-2.5 text-xs">
                    <span className="text-muted-foreground">{t('This branch already has an open pull request.')}</span>
                    {meta.existingPrUrl && (
                      <Button variant="outline" size="sm" onClick={() => void ipc.openUrl(meta.existingPrUrl!)}>
                        <IconExternalLink className="size-3" aria-hidden />
                        {t('Open')}
                      </Button>
                    )}
                  </div>
                )}

                {blockedReason === null && !meta.authenticated && (
                  <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                      {meta.provider === 'github'
                        ? t('The GitHub CLI is not authenticated. Run "gh auth login" in a terminal first.')
                        : t('The GitLab CLI is not authenticated. Run "glab auth login" in a terminal first.')}
                    </span>
                  </p>
                )}

                {/* Branch row */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">{t('Base branch')}</p>
                    <select
                      value={baseBranch}
                      onChange={(e) => setBaseBranch(e.target.value)}
                      disabled={meta.branches.length === 0}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] outline-none focus:border-ring disabled:opacity-50"
                    >
                      {meta.branches.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">{t('Head branch')}</p>
                    <p className="flex h-8 items-center truncate rounded-md border border-input bg-muted/40 px-2 font-mono text-[12px]">
                      {meta.currentBranch || '(detached HEAD)'}
                    </p>
                  </div>
                </div>

                {meta.needsPush && blockedReason === null && (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <IconArrowUp className="size-3 shrink-0" aria-hidden />
                    {t('The branch will be pushed to the remote before the pull request is created.')}
                  </p>
                )}

                {/* Title */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">{t('Title')}</p>
                    <button
                      type="button"
                      onClick={() => void handleGenerate(baseBranch)}
                      disabled={isGenerating || isCreating || !baseBranch}
                      className="flex items-center gap-1 rounded-md border border-input bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      {isGenerating
                        ? <IconLoader2 className="size-3 animate-spin" aria-hidden />
                        : <IconSparkles className="size-3" aria-hidden />}
                      {t('Regenerate')}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={isGenerating ? t('Generating…') : t('Pull request title')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring placeholder:text-muted-foreground/60"
                  />
                </div>

                {/* Body */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{t('Body')}</p>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={isGenerating ? t('Generating…') : t('Describe the change (markdown)')}
                    rows={6}
                    className={cn(
                      'w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-ring placeholder:text-muted-foreground/60',
                      isGenerating && 'opacity-60',
                    )}
                  />
                </div>

                {generateError !== null && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    {t('Could not generate PR content')}: {generateError} — {t('you can write it manually.')}
                  </p>
                )}

                {/* Draft */}
                <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={isDraft} onCheckedChange={(v) => setIsDraft(v === true)} />
                  {t('Create as draft')}
                </label>

                {createError !== null && (
                  <p className="flex items-start gap-1.5 whitespace-pre-wrap rounded-md bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                    <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{createError}</span>
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {createdUrl ? (
            <>
              <Button variant="outline" size="sm" onClick={handleClose}>
                {t('Done')}
              </Button>
              <Button size="sm" onClick={() => void ipc.openUrl(createdUrl)}>
                <IconExternalLink className="size-3.5" aria-hidden />
                {t('Open')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleClose}>
                {t('Cancel')}
              </Button>
              <Button size="sm" disabled={createDisabled} onClick={() => void handleCreate()}>
                {isCreating ? (
                  <><IconLoader2 className="size-3.5 animate-spin" aria-hidden /> {t('Creating…')}</>
                ) : (
                  t('Create Pull Request')
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
