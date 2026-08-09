import { useEffect, useState } from 'react'
import { ipc } from '@/lib/ipc'

/**
 * Whether per-message rollback (turn checkpoints) works in this workspace.
 * Checkpoints snapshot through a repository discovered at the workspace root,
 * so folders without one fall back to hiding the revert affordance.
 */
export const useCheckpointSupported = (workspace: string | null | undefined): boolean => {
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    if (!workspace) {
      setSupported(false)
      return
    }
    let stale = false
    ipc.checkpointSupported(workspace)
      .then((ok) => { if (!stale) setSupported(ok) })
      .catch(() => { if (!stale) setSupported(false) })
    return () => { stale = true }
  }, [workspace])

  return supported
}
