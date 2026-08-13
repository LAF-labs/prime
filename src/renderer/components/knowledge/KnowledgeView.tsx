import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { IconX, IconRefresh, IconVectorTriangle } from '@tabler/icons-react'
import { t } from '@/lib/i18n'
import { ipc, type KnowledgeNote } from '@/lib/ipc'
import { KnowledgeGraph } from './KnowledgeGraph'

/**
 * The knowledge view: the whole graph on the left, the clicked note on the
 * right. One knowledge base per account, all of it local — this reads the
 * same folder the agent's knowledge tools write.
 */
export const KnowledgeView = () => {
  const [notes, setNotes] = useState<KnowledgeNote[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)

  const load = useCallback(() => {
    ipc.knowledgeGraph().then(setNotes).catch(() => setNotes([]))
  }, [])
  useEffect(load, [load])

  useEffect(() => {
    if (!selected) {
      setBody(null)
      return
    }
    let stale = false
    ipc.knowledgeNoteBody(selected)
      .then((text) => { if (!stale) setBody(text) })
      .catch(() => { if (!stale) setBody(null) })
    return () => { stale = true }
  }, [selected])

  const selectedNote = notes?.find((n) => n.name === selected) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <IconVectorTriangle className="size-4 text-primary" aria-hidden />
        <h1 className="text-[14px] font-semibold">{t('Knowledge')}</h1>
        <span className="text-[12px] text-muted-foreground">
          {notes ? t('{count} notes', { count: notes.length }) : ''}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={load}
          aria-label={t('Reload')}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconRefresh className="size-3.5" aria-hidden />
        </button>
      </div>

      {notes && notes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <IconVectorTriangle className="size-8 text-muted-foreground/50" aria-hidden />
          <p className="text-[14px] font-medium">{t('Nothing here yet')}</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            {t('Ask the assistant to save something — "이 계약서 내용 저장해둬" — and it will appear here as a note, linked to everything related.')}
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {notes && <KnowledgeGraph notes={notes} selected={selected} onSelect={setSelected} />}
          </div>
          {selectedNote && (
            <aside className="flex w-[340px] shrink-0 flex-col border-l border-border">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{selectedNote.title}</h2>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label={t('Close')}
                  className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <IconX className="size-3.5" aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {body === null ? (
                  <div className="h-16 rounded-lg skeleton" />
                ) : (
                  <div className="prose prose-sm max-w-none text-[13px] leading-relaxed [&_h1]:text-[15px] [&_h2]:text-[14px] [&_h3]:text-[13px] [&_table]:text-[12px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                  </div>
                )}
                {selectedNote.updated && (
                  <p className="mt-4 text-[11px] text-muted-foreground">
                    {t('Updated {date}', { date: selectedNote.updated })}
                  </p>
                )}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
