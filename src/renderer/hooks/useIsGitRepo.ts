import { useEffect, useState } from 'react'
import { ipc } from '@/lib/ipc'

// Session-lifetime cache. A workspace does not stop being a git repository
// mid-session, and the message list can mount dozens of per-turn chips that
// would otherwise each fire an IPC probe for the same path.
const resultCache = new Map<string, boolean>()
const pendingProbes = new Map<string, Promise<boolean>>()

/** Reset the cache — test hook only. */
export const __clearGitRepoCache = (): void => {
  resultCache.clear()
  pendingProbes.clear()
}

/**
 * True when `workspace` lives inside a git repository. Probes once per path
 * via `ipc.gitDetect` and caches the answer for the session; concurrent
 * mounts share a single in-flight probe.
 */
export const useIsGitRepo = (workspace: string | null | undefined): boolean => {
  const [isRepo, setIsRepo] = useState<boolean>(() =>
    workspace ? resultCache.get(workspace) ?? false : false,
  )

  useEffect(() => {
    if (!workspace) {
      setIsRepo(false)
      return
    }
    const cached = resultCache.get(workspace)
    if (cached !== undefined) {
      setIsRepo(cached)
      return
    }
    let cancelled = false
    let probe = pendingProbes.get(workspace)
    if (!probe) {
      probe = ipc.gitDetect(workspace).catch(() => false)
      pendingProbes.set(workspace, probe)
    }
    void probe.then((detected) => {
      resultCache.set(workspace, detected)
      pendingProbes.delete(workspace)
      if (!cancelled) setIsRepo(detected)
    })
    return () => {
      cancelled = true
    }
  }, [workspace])

  return isRepo
}
