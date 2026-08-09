import { useI18nStore } from '@/lib/i18n'

/**
 * Tell the agent which language to answer in.
 *
 * The harness has no locale of its own — it answers in whatever language the
 * conversation is in. That works for prose, but a bare slash command (`/usage`)
 * or a one-word prompt carries no language signal, so the model defaulted to
 * English even for a user working entirely in Korean.
 *
 * We prepend a one-line directive to the FIRST prompt of a session (see
 * {@link shouldPrefixLanguage}); after that the transcript itself carries the
 * signal and repeating it would waste tokens on every turn.
 */
const DIRECTIVES: Record<string, string> = {
  ko: '[언어] 사용자의 앱 언어는 한국어입니다. 별도 요청이 없으면 한국어로 답하세요.\n\n',
}

/** Threads that already received the directive this session. */
const primed = new Set<string>()

/** Reset for tests and for a thread that starts a brand-new agent session. */
export const resetLanguagePriming = (taskId?: string): void => {
  if (taskId) primed.delete(taskId)
  else primed.clear()
}

/**
 * Prefix `message` with a reply-language directive when this thread hasn't
 * been primed yet. English needs no directive (it is every model's default),
 * so only non-English locales prepend anything.
 */
export const withReplyLanguage = (taskId: string, message: string): string => {
  const locale = useI18nStore.getState().locale
  const directive = DIRECTIVES[locale]
  if (!directive) return message
  if (primed.has(taskId)) return message
  primed.add(taskId)
  return `${directive}${message}`
}
