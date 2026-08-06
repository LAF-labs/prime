/**
 * Translation for LAF Agent — English and Korean.
 *
 * Keys are the English strings themselves (gettext style). That means:
 *
 * - English is always the fallback, so an untranslated string renders as
 *   correct English rather than a raw key.
 * - Call sites read naturally: `t('Close')`, not `t('common.close')`.
 * - Adding a language is one dictionary; adding a string needs no key
 *   invention and cannot collide with an existing one.
 *
 * `t()` is a plain function rather than a hook because the locale changes at
 * most a few times per session: `LocaleBoundary` remounts the tree when it
 * does, so every component re-reads its strings without subscribing.
 */

import { create } from 'zustand'
import { ko } from './i18n-ko'

export type Locale = 'en' | 'ko'
export type LanguageSetting = 'system' | Locale

const DICTS: Record<Locale, Record<string, string>> = { en: {}, ko }

export const detectSystemLocale = (): Locale => {
  try {
    return (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en'
  } catch {
    return 'en'
  }
}

export const resolveLocale = (setting: LanguageSetting | undefined | null): Locale =>
  setting === 'en' || setting === 'ko' ? setting : detectSystemLocale()

interface I18nState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: detectSystemLocale(),
  setLocale: (locale) => set((s) => (s.locale === locale ? s : { locale })),
}))

/** Interpolate `{name}` placeholders. Unknown names are left untouched. */
const format = (template: string, vars?: Record<string, string | number>): string =>
  vars
    ? template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`))
    : template

/**
 * Translate `text` into the active locale, falling back to the English
 * source. Safe to call outside React.
 */
export const t = (text: string, vars?: Record<string, string | number>): string => {
  const { locale } = useI18nStore.getState()
  return format(DICTS[locale][text] ?? text, vars)
}

/**
 * Hook form for components that prefer it. Returns the same translator; the
 * subscription also re-renders the caller directly on a locale change.
 */
export const useT = () => {
  useI18nStore((s) => s.locale)
  return t
}
