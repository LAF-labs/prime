import { type ReactNode } from 'react'
import { useI18nStore } from '@/lib/i18n'

/**
 * Remounts the tree when the display language changes.
 *
 * Translation is done with a plain `t()` rather than a hook, so components
 * don't subscribe to the locale individually. Language changes at most a few
 * times per session, so throwing the tree away is cheaper — and far less
 * error-prone — than wiring a subscription into every component that shows
 * text.
 */
export const LocaleBoundary = ({ children }: { children: ReactNode }) => {
  const locale = useI18nStore((s) => s.locale)
  return <div key={locale} className="contents">{children}</div>
}
