import { useState, useCallback, useRef, useEffect } from 'react'
import {
  IconGitFork,
  IconFolder,
  IconLoader2,
  IconAlertTriangle,
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
import { Input } from '@/components/ui/input'
import { ipc } from '@/lib/ipc'
import { useTaskStore } from '@/stores/taskStore'

interface CloneRepoDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

const GIT_URL_PATTERN =
  /^(https?:\/\/.+\.git|https?:\/\/github\.com\/.+\/.+|git@.+:.+\/.+\.git|git@.+:.+\/.+|ssh:\/\/.+)$/

/** Extract a repo name from a git URL for the default folder name. */
const extractRepoName = (url: string): string => {
  const cleaned = url.replace(/\.git$/, '').replace(/\/$/, '')
  const lastSegment = cleaned.split('/').pop() ?? cleaned.split(':').pop() ?? ''
  return lastSegment || 'repo'
}

export const CloneRepoDialog = ({ open, onOpenChange }: CloneRepoDialogProps) => {
  const [url, setUrl] = useState('')
  const [targetDir, setTargetDir] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [isCloning, setIsCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  // Focus the URL input when the dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => urlInputRef.current?.focus(), 100)
    } else {
      // Reset state when dialog closes
      setUrl('')
      setTargetDir('')
      setParentDir('')
      setError(null)
    }
  }, [open])

  // Auto-update target dir when URL changes and a parent dir is set
  useEffect(() => {
    if (!parentDir || !url.trim()) return
    const repoName = extractRepoName(url.trim())
    setTargetDir(`${parentDir}/${repoName}`)
  }, [url, parentDir])

  const isValidUrl = url.trim().length > 0 && GIT_URL_PATTERN.test(url.trim())
  const canClone = isValidUrl && targetDir.trim().length > 0 && !isCloning

  const handleClose = useCallback(() => {
    if (isCloning) return
    onOpenChange(false)
  }, [isCloning, onOpenChange])

  const handlePickFolder = useCallback(async () => {
    const folder = await ipc.pickFolder()
    if (!folder) return
    setParentDir(folder)
    const repoName = url.trim() ? extractRepoName(url.trim()) : ''
    setTargetDir(repoName ? `${folder}/${repoName}` : folder)
    setError(null)
  }, [url])

  const handleClone = useCallback(async () => {
    if (!canClone) return
    setIsCloning(true)
    setError(null)
    try {
      const clonedPath = await ipc.gitClone(url.trim(), targetDir.trim())
      const store = useTaskStore.getState()
      store.addProject(clonedPath)
      store.setPendingWorkspace(clonedPath)
      ipc.addRecentProject(clonedPath).catch(() => {})
      ipc.rebuildRecentMenu().catch(() => {})
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setIsCloning(false)
    }
  }, [canClone, url, targetDir, onOpenChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && canClone) {
        e.preventDefault()
        handleClone()
      }
    },
    [canClone, handleClone],
  )

  /** Shorten home directory for display. */
  const displayPath = targetDir.replace(/^\/Users\/[^/]+/, '~')

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-md" showCloseButton={!isCloning}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <IconGitFork className="size-5 text-primary" aria-hidden />
            Clone repository
          </DialogTitle>
          <DialogDescription>
            Paste an HTTPS or SSH URL and pick a destination folder.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 pb-2" onKeyDown={handleKeyDown}>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="clone-url"
              className="text-[12px] font-medium text-muted-foreground"
            >
              Repository URL
            </label>
            <Input
              ref={urlInputRef}
              id="clone-url"
              type="url"
              placeholder="https://github.com/user/repo.git"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null) }}
              disabled={isCloning}
              aria-label="Repository URL"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="clone-path"
              className="text-[12px] font-medium text-muted-foreground"
            >
              Clone to
            </label>
            <div className="flex gap-2">
              <Input
                id="clone-path"
                type="text"
                placeholder="Pick a folder…"
                value={displayPath}
                onChange={(e) => {
                  setTargetDir(e.target.value)
                  setParentDir('')
                  setError(null)
                }}
                disabled={isCloning}
                aria-label="Target directory"
                className="flex-1"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={handlePickFolder}
                disabled={isCloning}
                aria-label="Browse for folder"
                tabIndex={0}
              >
                <IconFolder className="size-4" aria-hidden />
              </Button>
            </div>
          </div>

          {error && (
            <div
              className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
              role="alert"
            >
              <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="break-all">{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={isCloning}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleClone}
            disabled={!canClone}
          >
            {isCloning ? (
              <>
                <IconLoader2 className="size-4 animate-spin" aria-hidden />
                Cloning…
              </>
            ) : (
              'Clone'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
