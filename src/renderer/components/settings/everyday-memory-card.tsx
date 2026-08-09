import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { IconBulb, IconTrash } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ipc, type EverydayMemory } from '@/lib/ipc'
import { useT } from '@/lib/i18n'
import { reportFailure } from '@/lib/ipc-report'
import { ConfirmDialog, SettingsCard, SettingsGrid } from './settings-shared'

/** Newest first: the last thing the assistant learned is the most interesting. */
const byNewest = (a: EverydayMemory, b: EverydayMemory): number => {
  const at = Date.parse(a.at)
  const bt = Date.parse(b.at)
  return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at)
}

const formatDate = (iso: string): string => {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * What the everyday assistant remembers — and how to make it forget.
 *
 * The agent's `remember` tool appends stable facts about the user to
 * `~/.laf-agent/memories.json`, and every turn's system prompt carries them.
 * A store that shapes every answer without ever being shown is not something
 * the user can consent to, so this card is the visible half: the facts, when
 * each was learned, and a delete for every one of them.
 */
export const EverydayMemoryCard = memo(function EverydayMemoryCard() {
  const t = useT()
  const [memories, setMemories] = useState<EverydayMemory[]>([])
  const [pendingDelete, setPendingDelete] = useState<EverydayMemory | null>(null)
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setMemories(await ipc.everydayMemoriesList())
    } catch (err) {
      reportFailure(t('Could not read what the assistant remembers'), err)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The dialog awaits these and stays open on failure, so a rejection must
  // propagate rather than be swallowed here.
  const handleDeleteOne = useCallback(async () => {
    if (!pendingDelete) return
    await ipc.everydayMemoryDelete(pendingDelete.fact)
    await refresh()
  }, [pendingDelete, refresh])

  const handleClearAll = useCallback(async () => {
    await ipc.everydayMemoriesClear()
    await refresh()
  }, [refresh])

  const sorted = useMemo(() => [...memories].sort(byNewest), [memories])


  return (
    <SettingsGrid
      label={t('Remembered facts')}
      description={t('What the assistant knows about you')}
    >
      <SettingsCard className="py-2.5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('The assistant saves stable facts about you and includes them in every conversation. Delete anything you would rather it forgot.')}
          </p>
          {sorted.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsConfirmClearOpen(true)}
                  aria-label={t('Forget everything')}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <IconTrash className="size-3" aria-hidden />
                  {t('Forget everything')}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('Delete every remembered fact')}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-6 text-center">
            <div className="flex size-9 items-center justify-center rounded-xl bg-muted/30">
              <IconBulb className="size-4 text-muted-foreground/70" aria-hidden />
            </div>
            <p className="text-[12.5px] font-medium text-muted-foreground">{t('Nothing remembered yet')}</p>
            <p className="text-[11px] text-muted-foreground/80">{t('Facts you share in a chat show up here once the assistant saves them.')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {sorted.map((memory, index) => (
              <li
                key={`${index}-${memory.fact}`}
                className="flex items-start gap-2 rounded-md border border-border/50 bg-background/40 px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-relaxed text-foreground">{memory.fact}</p>
                  {formatDate(memory.at) && (
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">{formatDate(memory.at)}</p>
                  )}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(memory)}
                      aria-label={t('Forget this')}
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <IconTrash className="size-3.5" aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('Forget this')}</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title={t('Forget this fact?')}
        description={t('"{fact}" will be removed and no longer included in conversations. This cannot be undone.', { fact: pendingDelete?.fact ?? '' })}
        confirmLabel={t('Forget')}
        onConfirm={handleDeleteOne}
      />
      <ConfirmDialog
        open={isConfirmClearOpen}
        onOpenChange={setIsConfirmClearOpen}
        title={t('Forget everything?')}
        description={t('This deletes all {count} remembered facts. The assistant starts fresh with no background on you. This cannot be undone.', { count: sorted.length })}
        confirmLabel={t('Forget everything')}
        onConfirm={handleClearAll}
      />
    </SettingsGrid>
  )
})
