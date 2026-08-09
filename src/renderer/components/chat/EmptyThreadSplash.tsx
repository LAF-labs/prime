import { t } from '@/lib/i18n'
import { memo, useCallback } from 'react'

/** Dispatch a custom event to insert text into the chat input and focus it */
const insertIntoInput = (text: string): void => {
  document.dispatchEvent(new CustomEvent('splash-insert', { detail: text }))
}

/**
 * Starter prompts. Deliberately about files, documents and questions rather
 * than about code: they are the first thing a new thread shows, and the first
 * thing shown sets the expectation for everything after it.
 */
const STARTER_PROMPTS: readonly string[] = [
  'Organize the files in a folder',
  'Summarize a document for me',
  'Research a topic on the web',
] as const

const StarterPromptButton = ({ prompt }: { readonly prompt: string }) => {
  const text = t(prompt)
  const handleClick = useCallback(() => insertIntoInput(text), [text])
  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="starter-prompt"
      className="rounded-full border border-border/50 bg-card/60 px-3 py-1.5 text-[12px] text-foreground/80 transition-colors duration-150 hover:border-border hover:bg-muted/50 active:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      {text}
    </button>
  )
}

/**
 * The first thing a new thread shows.
 *
 * Deliberately three starter prompts and a hint, nothing more. This screen used
 * to open with sixteen buttons across three labelled sections — ten slash
 * commands, three starter prompts, three `@` mentions — which is more chrome
 * than the conversation that replaces it.
 *
 * The command grid is not missing, it is redundant: typing `/` opens
 * {@link SlashCommandPicker}, which lists every command from the registry with
 * live descriptions, so the grid could only ever be a worse, staler copy. The
 * three mention entries were the same button three times — each inserted a bare
 * `@`. The hint below points at both pickers, which is the discoverable path.
 */
export const EmptyThreadSplash = memo(function EmptyThreadSplash() {
  return (
    <div className="flex flex-col items-center gap-4 px-4 select-none" role="region" aria-label={t('Getting started')}>
      <div className="flex flex-col items-center gap-1">
        <div className="flex size-8 items-center justify-center rounded-lg bg-muted/40">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/70" aria-hidden>
            <path d="M4 17l6-6-6-6" /><path d="M12 19h8" />
          </svg>
        </div>
        <p className="text-[13px] font-medium text-foreground/70">
          {t('What can I help you with today?')}
        </p>
      </div>

      <div className="flex w-full max-w-xl flex-wrap items-center justify-center gap-2">
        {STARTER_PROMPTS.map((prompt) => (
          <StarterPromptButton key={prompt} prompt={prompt} />
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {t('Type')} <kbd className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[9px]">/</kbd> {t('or')} <kbd className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[9px]">@</kbd> {t('in the input to get started')}
      </p>
    </div>
  )
})
