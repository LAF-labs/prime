import { memo, useEffect, useState } from 'react'
import { IconDatabaseExclamation } from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { useT } from '@/lib/i18n'

/**
 * The one state where the app works perfectly and loses everything anyway.
 *
 * When the thread database file cannot be opened, `ThreadDatabase::open()`
 * falls back to an in-memory one so the app still runs. Every conversation
 * then behaves normally — it saves, it reloads, it searches — and disappears
 * on quit. The fallback was signalled only by a line in a log file nobody
 * reads, which means the first time a user learns about it is after losing
 * work they believed was saved.
 *
 * So it is stated up front, and not dismissible. A person who cannot keep
 * their conversations needs to know before writing anything they care about,
 * not after.
 *
 * The flag is fixed when the database opens and never changes, so this asks
 * once rather than subscribing.
 */
export const StorageBanner = memo(function StorageBanner() {
  const t = useT()
  const [isDegraded, setIsDegraded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ipc
      .threadDbIsDegraded()
      .then((degraded) => {
        if (!cancelled) setIsDegraded(degraded)
      })
      // A failed check is not evidence of a broken database, and a banner
      // shown on a healthy one would be its own bug. Stay quiet.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!isDegraded) return null

  return (
    <div
      role="alert"
      data-testid="storage-banner"
      className="flex items-center justify-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-1.5 text-[12px] text-destructive"
    >
      <IconDatabaseExclamation className="size-3.5 shrink-0" aria-hidden />
      <span>
        {t('This conversation will not be saved — the chat storage could not be opened. Restarting the app usually fixes it.')}
      </span>
    </div>
  )
})
