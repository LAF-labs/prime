/**
 * Catalog of AI providers LAF Agent can connect to.
 *
 * Two groups:
 *
 * - **native** — prime-agent ships a model catalog and auth handling for these,
 *   so we only store the key (`auth.json`) and it knows the rest.
 * - **compatible** — any OpenAI-compatible endpoint. We register it in
 *   `models.json` with a base URL, the models discovered from its own
 *   `GET /models`, and a conservative compat profile.
 *
 * Every entry below has had its `/models` endpoint verified to exist (they
 * answer 200 or 401, never 404), which is what the discovery step calls.
 * Anything not listed still works through "Other endpoint" — the catalog is
 * convenience, not a gate.
 */

export type ProviderGroup = 'native' | 'compatible' | 'local'

export interface CatalogProvider {
  /** Stable id — also the provider name written into auth.json / models.json. */
  id: string
  label: string
  group: ProviderGroup
  /** Base URL for compatible/local providers; native ones are built in. */
  baseUrl?: string
  keyPlaceholder: string
  /** Where to get a key, shown as a hint. */
  keysUrl?: string
  /** Model-name hint for the brand icon, when we have one. */
  iconHint?: string
  /**
   * Wire protocol for compatible endpoints. Defaults to chat completions;
   * `openai-responses` is for endpoints that serve the Responses API, which
   * is what enables provider-side web search (e.g. DeepSeek).
   */
  api?: 'openai-completions' | 'openai-responses'
}

/** Providers prime-agent authenticates natively — key only, no endpoint. */
export const NATIVE_PROVIDERS: CatalogProvider[] = [
  { id: 'anthropic', label: 'Anthropic', group: 'native', keyPlaceholder: 'sk-ant-…', keysUrl: 'https://console.anthropic.com/settings/keys', iconHint: 'claude' },
  { id: 'openai', label: 'OpenAI', group: 'native', keyPlaceholder: 'sk-…', keysUrl: 'https://platform.openai.com/api-keys', iconHint: 'gpt' },
  { id: 'google', label: 'Google Gemini', group: 'native', keyPlaceholder: 'AIza…', keysUrl: 'https://aistudio.google.com/apikey', iconHint: 'gemini' },
  { id: 'openrouter', label: 'OpenRouter', group: 'native', keyPlaceholder: 'sk-or-…', keysUrl: 'https://openrouter.ai/keys' },
  { id: 'mistral', label: 'Mistral', group: 'native', keyPlaceholder: 'API key', keysUrl: 'https://console.mistral.ai/api-keys', iconHint: 'mistral' },
]

/**
 * OpenAI-compatible endpoints. Adding one here is pure data — registration,
 * key validation and model discovery all go through the same pipeline.
 */
export const COMPATIBLE_PROVIDERS: CatalogProvider[] = [
  // Responses API on purpose: it is where DeepSeek serves its server-side
  // web_search tool, which the gate injects into every request.
  { id: 'deepseek', label: 'DeepSeek', group: 'compatible', baseUrl: 'https://api.deepseek.com', api: 'openai-responses', keyPlaceholder: 'sk-…', keysUrl: 'https://platform.deepseek.com/api_keys', iconHint: 'deepseek' },
  { id: 'minimax', label: 'MiniMax', group: 'compatible', baseUrl: 'https://api.minimax.io/v1', keyPlaceholder: 'API key', keysUrl: 'https://www.minimax.io/platform', iconHint: 'minimax' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', group: 'compatible', baseUrl: 'https://api.moonshot.ai/v1', keyPlaceholder: 'sk-…', keysUrl: 'https://platform.moonshot.ai/console/api-keys' },
  { id: 'qwen', label: 'Qwen (DashScope)', group: 'compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyPlaceholder: 'sk-…', keysUrl: 'https://dashscope.console.aliyun.com/apiKey', iconHint: 'qwen' },
  { id: 'upstage', label: 'Upstage (Solar)', group: 'compatible', baseUrl: 'https://api.upstage.ai/v1', keyPlaceholder: 'up_…', keysUrl: 'https://console.upstage.ai/api-keys' },
  { id: 'zai', label: 'Z.AI (GLM)', group: 'compatible', baseUrl: 'https://api.z.ai/api/paas/v4', keyPlaceholder: 'API key', keysUrl: 'https://z.ai/manage-apikey/apikey-list', iconHint: 'glm' },
  { id: 'groq', label: 'Groq', group: 'compatible', baseUrl: 'https://api.groq.com/openai/v1', keyPlaceholder: 'gsk_…', keysUrl: 'https://console.groq.com/keys' },
  { id: 'xai', label: 'xAI (Grok)', group: 'compatible', baseUrl: 'https://api.x.ai/v1', keyPlaceholder: 'xai-…', keysUrl: 'https://console.x.ai' },
  { id: 'cerebras', label: 'Cerebras', group: 'compatible', baseUrl: 'https://api.cerebras.ai/v1', keyPlaceholder: 'csk-…', keysUrl: 'https://cloud.cerebras.ai' },
  { id: 'opencode', label: 'OpenCode Zen', group: 'compatible', baseUrl: 'https://opencode.ai/zen/v1', keyPlaceholder: 'API key', keysUrl: 'https://opencode.ai/auth' },
  { id: 'together', label: 'Together AI', group: 'compatible', baseUrl: 'https://api.together.xyz/v1', keyPlaceholder: 'API key', keysUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'fireworks', label: 'Fireworks', group: 'compatible', baseUrl: 'https://api.fireworks.ai/inference/v1', keyPlaceholder: 'fw_…', keysUrl: 'https://fireworks.ai/account/api-keys' },
  { id: 'nebius', label: 'Nebius AI Studio', group: 'compatible', baseUrl: 'https://api.studio.nebius.com/v1', keyPlaceholder: 'API key', keysUrl: 'https://studio.nebius.com' },
  { id: 'deepinfra', label: 'DeepInfra', group: 'compatible', baseUrl: 'https://api.deepinfra.com/v1/openai', keyPlaceholder: 'API key', keysUrl: 'https://deepinfra.com/dash/api_keys' },
]

/** Local inference servers — the key is ignored but prime-agent requires one. */
export const LOCAL_PROVIDERS: CatalogProvider[] = [
  { id: 'ollama', label: 'Ollama', group: 'local', baseUrl: 'http://localhost:11434/v1', keyPlaceholder: 'ollama' },
  { id: 'lmstudio', label: 'LM Studio', group: 'local', baseUrl: 'http://localhost:1234/v1', keyPlaceholder: 'lm-studio' },
  { id: 'vllm', label: 'vLLM', group: 'local', baseUrl: 'http://localhost:8000/v1', keyPlaceholder: 'vllm' },
]

/** Sentinel for "type your own endpoint URL". */
export const OTHER_ENDPOINT: CatalogProvider = {
  id: '__other',
  label: 'Other endpoint…',
  group: 'compatible',
  baseUrl: '',
  keyPlaceholder: 'API key',
}

export const ALL_ENDPOINT_PROVIDERS: CatalogProvider[] = [
  OTHER_ENDPOINT,
  ...COMPATIBLE_PROVIDERS,
  ...LOCAL_PROVIDERS,
]

export const findProvider = (id: string): CatalogProvider | undefined =>
  [...NATIVE_PROVIDERS, ...ALL_ENDPOINT_PROVIDERS].find((p) => p.id === id)

/** Case-insensitive substring search over label and id. */
export const searchProviders = (query: string, list: CatalogProvider[]): CatalogProvider[] => {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((p) => p.label.toLowerCase().includes(q) || p.id.includes(q))
}

/**
 * Derive a provider name from an arbitrary base URL — used when the user
 * types their own endpoint. `https://api.example.com/v1` → `example`.
 */
export const deriveProviderName = (baseUrl: string): string => {
  try {
    const host = new URL(baseUrl).hostname
    const parts = host.split('.').filter((p) => p !== 'www')
    if (parts.length === 1) return parts[0]
    // Prefer the registrable label (second-to-last), e.g. api.foo.com → foo
    return parts[parts.length - 2] ?? parts[0] ?? 'custom'
  } catch {
    return 'custom'
  }
}
