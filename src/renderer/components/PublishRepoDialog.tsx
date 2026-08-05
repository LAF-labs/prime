import { useState, useCallback, useMemo } from 'react'
import {
  IconCheck, IconLock, IconWorld, IconLoader2,
  IconBrandGithub, IconBrandGitlab, IconBrandBitbucket, IconExternalLink,
  IconChevronDown,
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
import { AnimatedHeight } from '@/components/AnimatedHeight'
import { toast } from 'sonner'
import { ipc } from '@/lib/ipc'
import { track } from '@/lib/analytics'
import { cn } from '@/lib/utils'

type PublishProvider = 'github' | 'gitlab' | 'bitbucket'
type Visibility = 'private' | 'public'
type Protocol = 'ssh' | 'https'

const PROVIDERS = [
  { value: 'github' as const, label: 'GitHub', host: 'github.com', placeholder: 'owner/repo', Icon: IconBrandGithub },
  { value: 'gitlab' as const, label: 'GitLab', host: 'gitlab.com', placeholder: 'group/project', Icon: IconBrandGitlab },
  { value: 'bitbucket' as const, label: 'Bitbucket', host: 'bitbucket.org', placeholder: 'workspace/repo', Icon: IconBrandBitbucket },
] as const

interface PublishRepoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: string
}

export function PublishRepoDialog({ open, onOpenChange, workspace }: PublishRepoDialogProps) {
  const [provider, setProvider] = useState<PublishProvider>('github')
  const [repository, setRepository] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('private')
  const [remoteName, setRemoteName] = useState('origin')
  const [protocol, setProtocol] = useState<Protocol>('ssh')
  const [step, setStep] = useState(0) // 0: provider, 1: repository, 2: done
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; name: string } | null>(null)

  const currentProvider = useMemo(
    () => PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0],
    [provider],
  )

  const canSubmit = useMemo(() => {
    if (isPublishing) return false
    const parts = repository.trim().split('/')
    return parts.length >= 2 && parts[0].trim().length > 0 && parts.slice(1).join('/').trim().length > 0
  }, [repository, isPublishing])

  const handlePublish = useCallback(async () => {
    if (!canSubmit) return
    setIsPublishing(true)
    setError(null)

    try {
      const remote = remoteName.trim() || 'origin'
      const repo = repository.trim()

      // Build the remote URL based on provider and protocol
      let remoteUrl: string
      if (protocol === 'ssh') {
        remoteUrl = `git@${currentProvider.host}:${repo}.git`
      } else {
        remoteUrl = `https://${currentProvider.host}/${repo}.git`
      }

      // Add remote and push
      await ipc.gitAddRemote(workspace, remote, remoteUrl)
      await ipc.gitPush(workspace)

      const webUrl = `https://${currentProvider.host}/${repo}`
      setResult({ url: webUrl, name: repo })
      setStep(2)
      toast.success('Repository published', {
        description: `Pushed to ${currentProvider.label}`,
      })
      track('feature_used', { feature: 'git', detail: 'publish_repo' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsPublishing(false)
    }
  }, [canSubmit, repository, remoteName, protocol, currentProvider, workspace])

  const resetState = useCallback(() => {
    setProvider('github')
    setRepository('')
    setVisibility('private')
    setRemoteName('origin')
    setProtocol('ssh')
    setStep(0)
    setAdvancedOpen(false)
    setError(null)
    setResult(null)
    setIsPublishing(false)
  }, [])

  const handleClose = useCallback(() => {
    resetState()
    onOpenChange(false)
  }, [resetState, onOpenChange])

  const steps = ['Provider', 'Repository', 'Summary'] as const

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Publish repository</DialogTitle>
          <DialogDescription>
            Pick where to host it, then point us at a repo to push to.
          </DialogDescription>

          {/* Step indicators */}
          <div className="grid grid-cols-3 gap-2 pt-2">
            {steps.map((label, index) => {
              const isComplete = index < step
              const isCurrent = index === step
              const isClickable = step !== 2 && index < steps.length - 1 && index <= step
              return (
                <button
                  key={label}
                  type="button"
                  onClick={isClickable ? () => setStep(index) : undefined}
                  disabled={!isClickable}
                  className={cn(
                    'grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 rounded-lg border px-3 py-2 text-left',
                    isCurrent
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/25'
                      : isComplete
                        ? 'border-border bg-background'
                        : 'border-border bg-muted/40',
                    !isClickable && 'cursor-default',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'row-span-2 mt-0.5 grid size-4 place-items-center rounded-full border',
                      isComplete
                        ? 'border-primary bg-primary text-primary-foreground'
                        : isCurrent
                          ? 'border-primary bg-background'
                          : 'border-muted-foreground/35 bg-background',
                    )}
                  >
                    {isComplete ? <IconCheck className="size-3" /> : null}
                  </span>
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">
                    Step {index + 1}
                  </span>
                  <span className="truncate text-xs font-semibold text-foreground">
                    {label}
                  </span>
                </button>
              )
            })}
          </div>
        </DialogHeader>

        <div className="px-6 pb-4">
          <AnimatedHeight>
            {/* Step 0: Provider selection */}
            {step === 0 && (
              <div className="space-y-3">
                <span className="text-xs font-medium text-foreground">Provider</span>
                <div className="grid grid-cols-3 gap-2.5">
                  {PROVIDERS.map((option) => {
                    const isSelected = provider === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setProvider(option.value)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-3 text-left outline-none transition-all',
                          isSelected
                            ? 'border-primary bg-background shadow-sm ring-2 ring-primary/35'
                            : 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50',
                        )}
                      >
                        <option.Icon className="size-5 shrink-0" />
                        <span className="text-sm font-medium">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Step 1: Repository details */}
            {step === 1 && (
              <div className="space-y-4">
                {/* Repository path */}
                <div className="space-y-2">
                  <label htmlFor="publish-repo-path" className="text-xs font-medium text-foreground">
                    Repository
                  </label>
                  <div className="flex items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:border-ring">
                    <span className="flex shrink-0 items-center gap-1.5 border-r border-input bg-muted/50 px-2.5 font-mono text-xs text-muted-foreground">
                      <currentProvider.Icon className="size-3.5" />
                      {currentProvider.host}/
                    </span>
                    <input
                      id="publish-repo-path"
                      value={repository}
                      onChange={(e) => setRepository(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handlePublish() } }}
                      placeholder={currentProvider.placeholder}
                      disabled={isPublishing}
                      className="w-full bg-transparent px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/60 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Visibility */}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-foreground">Visibility</span>
                  <div className="grid grid-cols-2 gap-2.5">
                    {([
                      { value: 'private' as const, label: 'Private', desc: 'Only invited people', Icon: IconLock },
                      { value: 'public' as const, label: 'Public', desc: 'Anyone on the web', Icon: IconWorld },
                    ]).map((option) => {
                      const isSelected = visibility === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setVisibility(option.value)}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-all',
                            isSelected
                              ? 'border-primary bg-background shadow-sm ring-2 ring-primary/35'
                              : 'border-border bg-background hover:border-foreground/20 hover:bg-muted/50',
                          )}
                        >
                          <option.Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{option.label}</span>
                            <span className="block text-xs text-muted-foreground">{option.desc}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Advanced */}
                <div>
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <IconChevronDown className={cn('size-3.5 transition-transform', !advancedOpen && '-rotate-90')} />
                    Advanced
                  </button>
                  {advancedOpen && (
                    <div className="mt-3 grid gap-3 grid-cols-2">
                      <div className="space-y-1.5">
                        <label htmlFor="publish-remote" className="text-xs font-medium text-foreground">Remote</label>
                        <input
                          id="publish-remote"
                          value={remoteName}
                          onChange={(e) => setRemoteName(e.target.value)}
                          placeholder="origin"
                          disabled={isPublishing}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <span className="text-xs font-medium text-foreground">Protocol</span>
                        <div className="grid grid-cols-2 gap-2">
                          {(['ssh', 'https'] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setProtocol(value)}
                              className={cn(
                                'rounded-md border px-3 py-1.5 text-center text-sm font-medium outline-none transition',
                                protocol === value
                                  ? 'border-primary bg-background ring-2 ring-primary/35 text-foreground'
                                  : 'border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                              )}
                            >
                              {value === 'ssh' ? 'SSH' : 'HTTPS'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Status */}
                {isPublishing && (
                  <div className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <IconLoader2 className="size-3.5 animate-spin" />
                    Publishing repository to {currentProvider.label}...
                  </div>
                )}
                {error && !isPublishing && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <p className="font-medium">Publish failed</p>
                    <p className="mt-0.5 opacity-90">{error}</p>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Success */}
            {step === 2 && result && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-2 py-2 text-center">
                  <span className="grid size-8 place-items-center rounded-full bg-green-500/15 text-green-400">
                    <IconCheck className="size-4" />
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">Repository published</h3>
                  <p className="max-w-xs text-pretty text-xs text-muted-foreground">
                    Your code is now live on {currentProvider.label}.
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 py-2">
                  <currentProvider.Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {result.name}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => ipc.openUrl(result.url)}
                >
                  <IconExternalLink className="size-3.5" />
                  Open on {currentProvider.label}
                </Button>
              </div>
            )}
          </AnimatedHeight>
        </div>

        <DialogFooter>
          {step === 2 ? (
            <Button size="sm" onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              {step === 0 && (
                <Button size="sm" onClick={() => setStep(1)}>Next</Button>
              )}
              {step === 1 && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setStep(0)}>Back</Button>
                  <Button size="sm" disabled={!canSubmit || isPublishing} onClick={() => void handlePublish()}>
                    {isPublishing ? <><IconLoader2 className="size-3.5 animate-spin mr-1" /> Publishing…</> : 'Publish'}
                  </Button>
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
