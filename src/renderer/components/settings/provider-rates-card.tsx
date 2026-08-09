import { memo, useCallback, useEffect, useState } from 'react'
import { IconCoin, IconInfoCircle } from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { useT } from '@/lib/i18n'
import { findProvider } from '@/lib/provider-catalog'
import type { AppSettings, ProviderRate } from '@/types'
import type { ConfiguredProvider } from '@/components/ProviderKeyManager'
import { SettingsCard, SettingsGrid } from './settings-shared'

type RateField = keyof ProviderRate

/** Raw text per field so a half-typed value like "0." survives re-renders. */
type RateDraft = Record<RateField, string>

const FIELDS: readonly RateField[] = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

const emptyDraft = (): RateDraft => ({ input: '', output: '', cacheRead: '', cacheWrite: '' })

const toText = (value: number | undefined): string =>
  value === undefined || value === null ? '' : String(value)

/** `undefined` for blank or unparseable input — blank means "not set". */
const toNumber = (text: string): number | undefined => {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const draftFromRates = (rates: AppSettings['providerRates']): Record<string, RateDraft> => {
  const next: Record<string, RateDraft> = {}
  for (const [name, rate] of Object.entries(rates ?? {})) {
    next[name] = {
      input: toText(rate.input),
      output: toText(rate.output),
      cacheRead: toText(rate.cacheRead),
      cacheWrite: toText(rate.cacheWrite),
    }
  }
  return next
}

const ratesFromDraft = (drafts: Record<string, RateDraft>): AppSettings['providerRates'] => {
  const rates: Record<string, ProviderRate> = {}
  for (const [name, draft] of Object.entries(drafts)) {
    const input = toNumber(draft.input)
    const output = toNumber(draft.output)
    const cacheRead = toNumber(draft.cacheRead)
    const cacheWrite = toNumber(draft.cacheWrite)
    if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) continue
    rates[name] = {
      input: input ?? 0,
      output: output ?? 0,
      ...(cacheRead !== undefined ? { cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    }
  }
  return Object.keys(rates).length > 0 ? rates : undefined
}

interface ProviderRatesCardProps {
  draft: AppSettings
  updateDraft: (patch: Partial<AppSettings>) => void
}

/**
 * Manual token pricing for providers prime-agent cannot price on its own.
 *
 * Built-in providers ship a model catalog with per-token prices, so their cost
 * is computed for you. A provider the user registered themselves (any
 * OpenAI-compatible endpoint) has no price data, so its reported cost is always
 * zero until a rate is entered here.
 */
export const ProviderRatesCard = memo(function ProviderRatesCard({ draft, updateDraft }: ProviderRatesCardProps) {
  const t = useT()
  const [providers, setProviders] = useState<ConfiguredProvider[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>(() => draftFromRates(draft.providerRates))

  useEffect(() => {
    let isActive = true
    ipc.authListProviders()
      .then((list) => { if (isActive) setProviders(list) })
      .catch(() => { if (isActive) setProviders([]) })
      .finally(() => { if (isActive) setIsLoading(false) })
    return () => { isActive = false }
  }, [])

  const handleChange = useCallback((name: string, field: RateField, value: string) => {
    const next = { ...drafts, [name]: { ...(drafts[name] ?? emptyDraft()), [field]: value } }
    setDrafts(next)
    updateDraft({ providerRates: ratesFromDraft(next) })
  }, [drafts, updateDraft])

  const editable = providers.filter((p) => p.isCustom)

  return (
    <SettingsGrid label={t('Token pricing')} description={t('USD per 1M tokens')}>
      <SettingsCard>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-start gap-2.5">
            <IconCoin size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-[12px] font-medium text-foreground">{t('Cost for custom providers')}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {t('Built-in providers come with per-model prices, so their cost is calculated for you. A provider you added yourself has no price data, so its cost always shows as $0 — enter its rates here to see real numbers.')}
              </p>
            </div>
          </div>

          {isLoading ? (
            <p className="text-[11px] text-muted-foreground">{t('Loading providers…')}</p>
          ) : providers.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t('No providers configured yet.')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,68px)] items-end gap-2 px-1">
                <span className="sr-only">{t('Provider')}</span>
                <span className="text-[11px] font-medium text-muted-foreground">{t('Input')}</span>
                <span className="text-[11px] font-medium text-muted-foreground">{t('Output')}</span>
                <span className="text-[11px] font-medium text-muted-foreground">{t('Cache read')}</span>
                <span className="text-[11px] font-medium text-muted-foreground">{t('Cache write')}</span>
              </div>

              {providers.map((p) => {
                const label = findProvider(p.name)?.label ?? p.name
                const values = drafts[p.name] ?? emptyDraft()
                return (
                  <div
                    key={p.name}
                    className="grid grid-cols-[minmax(0,1fr)_repeat(4,68px)] items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium text-foreground">{label}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {p.isCustom ? t('Custom endpoint — enter rates manually') : t('Priced automatically')}
                      </p>
                    </div>
                    {FIELDS.map((field) => (
                      <input
                        key={field}
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        disabled={!p.isCustom}
                        value={p.isCustom ? values[field] : ''}
                        onChange={(e) => handleChange(p.name, field, e.target.value)}
                        placeholder={p.isCustom ? '0' : '—'}
                        aria-label={`${label} · ${t('USD per 1M tokens')}`}
                        className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex items-start gap-2.5 rounded-lg bg-muted/30 px-3 py-2">
            <IconInfoCircle size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {editable.length === 0
                ? t('Rates apply to every model on a provider. Add an OpenAI-compatible endpoint above to set its pricing.')
                : t('Rates apply to every model on a provider. Leave a field blank to leave it unset — check the provider’s pricing page for the current numbers.')}
            </p>
          </div>
        </div>
      </SettingsCard>
    </SettingsGrid>
  )
})
