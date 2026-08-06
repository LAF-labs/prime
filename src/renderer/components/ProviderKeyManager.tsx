import { t } from '@/lib/i18n'
import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  IconLoader2, IconKey, IconAlertTriangle, IconRouter, IconSettings2,
  IconTrash, IconCircleCheck, IconSearch, IconExternalLink, IconServer,
} from '@tabler/icons-react'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { getModelIcon } from '@/lib/model-icons'
import { useT } from '@/lib/i18n'
import { handleExternalLinkClick, handleExternalLinkKeyDown } from '@/lib/open-external'
import {
  NATIVE_PROVIDERS, ALL_ENDPOINT_PROVIDERS, OTHER_ENDPOINT,
  searchProviders, deriveProviderName, findProvider,
  type CatalogProvider,
} from '@/lib/provider-catalog'

export interface ConfiguredProvider {
  name: string
  kind: string
  isCustom: boolean
  baseUrl?: string | null
  modelCount: number
}

interface ProviderKeyManagerProps {
  /** Called after a key is added or removed so callers can refresh auth state. */
  onChange?: () => void
  /** Show the list of already-configured providers (settings) or not (onboarding). */
  showConfigured?: boolean
}

const providerIcon = (p: CatalogProvider, size = 22) => {
  if (p.iconHint) return getModelIcon(p.iconHint, { size })
  if (p.group === 'local') return <IconServer size={size} className="text-muted-foreground" />
  if (p.id === OTHER_ENDPOINT.id) return <IconSettings2 size={size} className="text-muted-foreground" />
  return <IconRouter size={size} className="text-muted-foreground" />
}

/**
 * Add and remove AI provider credentials.
 *
 * Every provider — native or OpenAI-compatible — goes through one pipeline:
 * the key is validated against the provider's own `/models` endpoint, and the
 * models it returns become the picker's options. Nothing is special-cased.
 */
export const ProviderKeyManager = ({ onChange, showConfigured = true }: ProviderKeyManagerProps) => {
  const t = useT()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [endpointQuery, setEndpointQuery] = useState('')
  const [endpointId, setEndpointId] = useState<string>(OTHER_ENDPOINT.id)
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')
  const [lastConnected, setLastConnected] = useState<{ label: string; count: number } | null>(null)
  const [configured, setConfigured] = useState<ConfiguredProvider[]>([])

  const refresh = useCallback(() => {
    ipc.authListProviders().then(setConfigured).catch(() => setConfigured([]))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const isEndpointMode = selectedId === '__endpoint'
  const nativeSelected = selectedId ? NATIVE_PROVIDERS.find((p) => p.id === selectedId) : null
  const endpointSelected = findProvider(endpointId) ?? OTHER_ENDPOINT

  const filteredEndpoints = useMemo(
    () => searchProviders(endpointQuery, ALL_ENDPOINT_PROVIDERS),
    [endpointQuery],
  )

  const effectiveBaseUrl = (endpointSelected.baseUrl || customBaseUrl).trim()
  const activePlaceholder = isEndpointMode ? endpointSelected.keyPlaceholder : nativeSelected?.keyPlaceholder ?? 'API key'
  const keysUrl = isEndpointMode ? endpointSelected.keysUrl : nativeSelected?.keysUrl

  const canConnect = !!apiKey.trim() && (isEndpointMode ? !!effectiveBaseUrl : !!nativeSelected)

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id))
    setError('')
    setLastConnected(null)
  }, [])

  const handlePickEndpoint = useCallback((id: string) => {
    setEndpointId(id)
    const p = findProvider(id)
    setCustomBaseUrl(p?.baseUrl ?? '')
    setError('')
  }, [])

  const handleConnect = useCallback(async () => {
    if (!canConnect) return
    setIsConnecting(true)
    setError('')
    setLastConnected(null)
    try {
      if (isEndpointMode) {
        const discovered = await ipc.providerDiscoverModels({ baseUrl: effectiveBaseUrl, apiKey: apiKey.trim() })
        const name = endpointSelected.id === OTHER_ENDPOINT.id
          ? deriveProviderName(effectiveBaseUrl)
          : endpointSelected.id
        await ipc.authSetCustomProvider(name, effectiveBaseUrl, apiKey.trim(), discovered.map((m) => m.id))
        setLastConnected({ label: endpointSelected.id === OTHER_ENDPOINT.id ? name : endpointSelected.label, count: discovered.length })
      } else if (nativeSelected) {
        const discovered = await ipc.providerDiscoverModels({ provider: nativeSelected.id, apiKey: apiKey.trim() })
        await ipc.authSetApiKey(nativeSelected.id, apiKey.trim())
        setLastConnected({ label: nativeSelected.label, count: discovered.length })
      }
      setApiKey('')
      setSelectedId(null)
      refresh()
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsConnecting(false)
    }
  }, [canConnect, isEndpointMode, effectiveBaseUrl, endpointSelected, nativeSelected, apiKey, refresh, onChange])

  const handleRemove = useCallback(async (name: string) => {
    try {
      await ipc.authRemoveProvider(name)
      refresh()
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refresh, onChange])

  return (
    <div className="flex flex-col gap-3">
      {showConfigured && (
        configured.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {configured.map((p) => (
              <li key={p.name} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2">
                <IconCircleCheck size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-foreground">
                    {findProvider(p.name)?.label ?? p.name}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {p.isCustom
                      ? `${p.baseUrl ?? ''} · ${p.modelCount}${t(' models')}`
                      : p.kind === 'oauth' ? 'OAuth' : t('API key')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(p.name)}
                  aria-label={`${t('Remove')} ${p.name}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <IconTrash size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t('No providers configured yet.')}</p>
        )
      )}

      {/* Native providers + one tile that opens the endpoint catalog */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {NATIVE_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => handleSelect(p.id)}
            aria-label={`${p.label} ${t('API key')}`}
            aria-pressed={selectedId === p.id}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-lg border px-2 py-4 transition-colors',
              selectedId === p.id
                ? 'border-ring bg-accent text-foreground'
                : 'border-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground/80',
            )}
          >
            {providerIcon(p)}
            <span className="text-center text-[11px] font-medium leading-tight">{p.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => handleSelect('__endpoint')}
          aria-label={t('Other OpenAI-compatible endpoint')}
          aria-pressed={isEndpointMode}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border px-2 py-4 transition-colors',
            isEndpointMode
              ? 'border-ring bg-accent text-foreground'
              : 'border-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground/80',
          )}
        >
          <IconSettings2 size={22} />
          <span className="text-center text-[11px] font-medium leading-tight">{t('Other')}</span>
        </button>
      </div>

      {(nativeSelected || isEndpointMode) && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/20 p-4">
          {isEndpointMode && (
            <>
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  type="text"
                  value={endpointQuery}
                  onChange={(e) => setEndpointQuery(e.target.value)}
                  placeholder={t('Search providers (DeepSeek, MiniMax, Groq, Ollama…)')}
                  aria-label={t('Search providers (DeepSeek, MiniMax, Groq, Ollama…)')}
                  className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-ring"
                />
              </div>
              <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
                {filteredEndpoints.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePickEndpoint(p.id)}
                    aria-pressed={endpointId === p.id}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors',
                      endpointId === p.id
                        ? 'border-ring bg-accent text-foreground'
                        : 'border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground/80',
                    )}
                  >
                    {providerIcon(p, 14)}
                    <span className="truncate">{p.label}</span>
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                aria-label={t('OpenAI-compatible base URL')}
                className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-ring"
              />
            </>
          )}
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConnect() }}
              placeholder={activePlaceholder}
              aria-label={t('API key')}
              className="h-10 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-ring"
            />
            <button
              type="button"
              onClick={handleConnect}
              disabled={!canConnect || isConnecting}
              className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isConnecting ? <IconLoader2 size={14} className="animate-spin" /> : <IconKey size={14} />}
              {isConnecting ? t('Verifying…') : t('Connect')}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {isEndpointMode ? t('Models are discovered automatically from the endpoint — just paste the key.') : t('The key is verified against the provider before saving.')}
            </p>
            {keysUrl && (
              <a
                href={keysUrl}
                onClick={handleExternalLinkClick}
                onKeyDown={handleExternalLinkKeyDown}
                tabIndex={0}
                className="flex shrink-0 items-center gap-1 text-[11px] text-primary transition-colors hover:underline"
              >
                {t('Get a key')} <IconExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      )}

      {lastConnected && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2">
          <IconCircleCheck size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
            {t('providers.connected', { label: lastConnected.label, count: lastConnected.count })}
          </p>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-[11px] text-destructive leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  )
}
