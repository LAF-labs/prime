import type { JSX } from 'react'

/** Supported model providers for icon display. */
type Provider =
  | 'anthropic'
  | 'openai'
  | 'amazon'
  | 'meta'
  | 'google'
  | 'mistral'
  | 'cohere'
  | 'ai21'
  | 'deepseek'
  | 'glm'
  | 'qwen'
  | 'minimax'
  | 'kiro'
  | 'unknown'

interface IconProps {
  size?: number
  className?: string
}

/* ── Provider detection ─────────────────────────────────────────────── */

const PROVIDER_PATTERNS: readonly [Provider, RegExp][] = [
  ['kiro', /\b(kiro|auto)\b/i],
  ['anthropic', /\bclaude\b/i],
  ['openai', /\b(gpt|o[134]-|chatgpt)\b/i],
  ['amazon', /\b(amazon|nova|titan)\b/i],
  ['meta', /\bllama\b/i],
  ['google', /\bgemini\b/i],
  ['mistral', /\bmistral\b/i],
  ['cohere', /\bcommand\b/i],
  ['ai21', /\b(jamba|jurassic|ai21)\b/i],
  ['deepseek', /\bdeepseek\b/i],
  ['glm', /\b(glm|chatglm|zhipu)\b/i],
  ['qwen', /\bqwen\b/i],
  ['minimax', /\bminimax\b/i],
] as const

/** Detect the provider from a model ID or name string. */
export const detectProvider = (modelIdOrName: string): Provider => {
  const lower = modelIdOrName.toLowerCase()
  for (const [provider, pattern] of PROVIDER_PATTERNS) {
    if (pattern.test(lower)) return provider
  }
  return 'unknown'
}

/* ── SVG icon components ────────────────────────────────────────────── */

const AnthropicIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M13.827 3 21 21h-4.31L9.517 3h4.31Zm-7.654 0L3 3h4.31L14.483 21H10.173L6.173 10.08 3.827 16.5H7.5l1.2 3.5H2L6.173 3Z" fill="#D97757" />
  </svg>
)

const OpenAIIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073ZM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494ZM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646ZM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872v.024Zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667Zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66v.019ZM8.3 12.71l-2.02-1.164a.08.08 0 0 1-.038-.057V5.906a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.69 5.295a.787.787 0 0 0-.392.68l-.003 6.735h.005Zm1.097-2.368L12 8.71l2.602 1.502v3.004L12 14.718l-2.603-1.502v-2.874Z" fill="#10A37F" />
  </svg>
)

const AmazonIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M13.958 10.09c0 1.232.029 2.256-.591 3.351-.502.891-1.301 1.438-2.186 1.438-1.214 0-1.922-.924-1.922-2.292 0-2.692 2.415-3.182 4.7-3.182v.685Zm3.186 7.705a.66.66 0 0 1-.753.077c-1.058-.879-1.247-1.287-1.826-2.125-1.748 1.782-2.986 2.315-5.249 2.315C6.588 18.062 4.5 16.39 4.5 13.188c0-2.493 1.351-4.188 3.276-5.016 1.667-.733 3.994-.864 5.775-1.067v-.398c0-.731.056-1.595-.373-2.226-.373-.564-1.09-.797-1.722-.797-1.17 0-2.213.6-2.468 1.843a.49.49 0 0 1-.42.423l-2.347-.253c-.198-.044-.417-.204-.361-.507C6.39 2.267 9.263 1.5 11.847 1.5c1.322 0 3.05.352 4.094 1.353 1.322 1.232 1.196 2.876 1.196 4.664v4.226c0 1.27.527 1.827 1.023 2.513.173.245.212.539-.009.72-.554.463-1.54 1.325-2.083 1.808l-.924.01Z" fill="#FF9900" />
    <path d="M20.176 19.263c-2.39 1.768-5.862 2.71-8.848 2.71-4.187 0-7.954-1.548-10.802-4.126-.224-.202-.024-.478.245-.321 3.078 1.79 6.884 2.867 10.814 2.867 2.652 0 5.567-.55 8.25-1.688.405-.173.744.266.341.558Z" fill="#FF9900" />
    <path d="M21.119 18.147c-.305-.391-2.019-.185-2.788-.093-.234.028-.27-.176-.059-.323 1.365-.959 3.604-.682 3.866-.361.263.323-.069 2.564-1.349 3.634-.197.164-.384.077-.297-.14.288-.72.934-2.326.627-2.717Z" fill="#FF9900" />
  </svg>
)

const MetaIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M6.915 4.03c-1.968 0-3.402 1.622-4.36 3.22C1.454 9.2.5 11.9.5 14.1c0 1.16.333 2.11.966 2.756.612.624 1.468.944 2.449.944 1.558 0 2.778-.793 3.849-1.956.752-.816 1.468-1.856 2.236-3.074.36.557.696 1.058 1.012 1.49.89 1.212 1.741 2.066 2.612 2.614.87.548 1.7.826 2.576.826.98 0 1.801-.32 2.398-.944.597-.624.902-1.496.902-2.656 0-2.14-.88-4.74-1.945-6.71C16.61 5.77 15.142 4.03 13.085 4.03c-1.5 0-2.654.8-3.585 1.833l-.5.583-.5-.583C7.57 4.83 6.415 4.03 6.915 4.03Zm-.2 1.5c.658 0 1.43.503 2.24 1.5.455.56.9 1.24 1.33 2.01-.99 1.63-1.726 2.78-2.4 3.51-.838.91-1.546 1.25-2.27 1.25-.53 0-.98-.17-1.33-.52-.35-.35-.56-.89-.56-1.68 0-1.86.83-4.18 1.73-5.7.52-.88 1.02-1.37 1.26-1.37Zm6.57 0c.24 0 .74.49 1.26 1.37.9 1.52 1.73 3.84 1.73 5.7 0 .79-.21 1.33-.56 1.68-.35.35-.8.52-1.33.52-.724 0-1.432-.34-2.27-1.25-.674-.73-1.41-1.88-2.4-3.51.43-.77.875-1.45 1.33-2.01.81-.997 1.582-1.5 2.24-1.5Z" fill="#0081FB" />
  </svg>
)

const GoogleIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62Z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" fill="#EA4335" />
  </svg>
)

const MistralIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <rect x="1" y="3" width="4" height="4" fill="#F7D046" />
    <rect x="1" y="7" width="4" height="4" fill="#F7D046" />
    <rect x="1" y="11" width="4" height="4" fill="#F7D046" />
    <rect x="1" y="15" width="4" height="4" fill="#F7D046" />
    <rect x="19" y="3" width="4" height="4" fill="#F7D046" />
    <rect x="19" y="7" width="4" height="4" fill="#F7D046" />
    <rect x="19" y="11" width="4" height="4" fill="#F7D046" />
    <rect x="19" y="15" width="4" height="4" fill="#F7D046" />
    <rect x="5" y="3" width="4" height="4" fill="#F2A73B" />
    <rect x="15" y="3" width="4" height="4" fill="#F2A73B" />
    <rect x="5" y="7" width="14" height="4" fill="#EF8B2E" />
    <rect x="5" y="11" width="4" height="4" fill="#EE7623" />
    <rect x="15" y="11" width="4" height="4" fill="#EE7623" />
    <rect x="5" y="15" width="14" height="4" fill="#EB5829" />
  </svg>
)

const CohereIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2Zm0 14.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z" fill="#39594D" />
    <path d="M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" fill="#D18EE2" />
  </svg>
)

const AI21Icon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <rect x="2" y="2" width="20" height="20" rx="4" fill="#6C47FF" />
    <text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" fontFamily="system-ui">21</text>
  </svg>
)

const DeepSeekIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <circle cx="12" cy="12" r="10" fill="#4D6BFE" />
    <path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
    <circle cx="12" cy="12" r="1.5" fill="white" />
  </svg>
)

const GlmIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M11.091 2.832c4.497 0 9.33 3.618 8.186 9.699-.013.064-.034.128-.052.192l-.003-.254c-.076-2.75-1.406-8.19-8.131-8.19-3.11 0-7.459 2.8-7.269 7.478-.037 4.38 3.258 7.7 7.287 7.638l.067-.001c1.1-.03 2.533-.393 2.842-1.519.058-.028.238.49.246.548.044.235.102.338.176.312.899-.32 2.095-1.12 1.789-2.182-.161-.559-1.627-.135-1.761-.318.383-.898 2.048-.849 2.89-.656.407.093.603.348.928.405.266.048.9-.183.879.222-1.375 2.789-4.485 4.959-8.074 4.959C5.35 21.166 2 16.192 2 11.758c0-5.308 4.546-8.926 9.091-8.926Zm-.016 3.025c.444 0 1.032.206 1.265.536 3.364.133 3.954 2.462 4.303 4.99.234 1.685.289 2.109.167 1.272l.076.54c.062.411.508.676.9.473.132-.069.233-.212.3-.431a.18.18 0 0 1 .072-.065.18.18 0 0 1 .129-.01l.573.202a.18.18 0 0 1 .099.089.18.18 0 0 1 .015.131c-.084.315-.245.605-.467.843-.805.841-2.527.609-2.824-.568-.128-.508-.05-.574-.316-1.139-.268-.57-1.135-.65-1.549-.27-.317.288-.374.738-.373 1.175l.069 1.994a.6.6 0 0 1-.175.577.6.6 0 0 1-.583.242h-1.284a.6.6 0 0 1-.6-.6v-.596a1.054 1.054 0 0 0-2.108 0v.596a.6.6 0 0 1-.6.6H6.4a.6.6 0 0 1-.6-.6l.032-2.969c.011-1.727.326-3.353 2.264-3.79.183-.04.231.12.266.315.023.141.04.231.049.27.642 2.803 1.604 3.94 2.882 3.411l.605-.303.233-.12c.145-.074.229-.12.253-.137.011-.01-.151-.189-.373-.426l-.928-.978a5.07 5.07 0 0 0-.182-.197c-.043-.031-.106.062-.19.28-.068.144-.23.231-.25.3-.012.052.099.272.332.66.15.263.202.465-.284.313-.953-.733-1.392-2.084-1.544-3.415l-.149-1.754c-.02-.291.076-.578.268-.798a1.05 1.05 0 0 1 .753-.376l1.464-.003ZM22.986 13.814c.034.639-.369.645-1.112.542l-1.634-.253c-.243-.049-.353-.091-.287-.135.43-.289 2.995-.852 3.033-.154Zm-.839-.076-.848.038c-.78.071-1.331.22.307.308l.094.003c.747.011 1.159-.329.447-.35Zm1.528-3.301h.01c.724.365.061.945-.596 1.277-.128.064-.45.161-.965.289-.22.036-.419.084-.305.147l.009.004c1.79.878-2.862 1.406-2.286 1.178l.348-.136c.624-.244 1.48-.625 1.527-1.225.035-.44 1.149-.405 1.369-.888.044-.097 0-.216-.132-.356a.37.37 0 0 1-.098-.136c-.067-.28.642-.395 1.12-.154Zm-2.354-.434c-.124 1.098-2.272 3.843-1.787 2.624l.016-.038c.273-.657.344-2.036 1.225-2.953.23-.238.583.032.546.367Zm-7.311-.233c.018-.636.918-.887 1.234-.318.009-1.168-1.78-.704-1.234.318Z" fill="#4268FA" />
  </svg>
)

const QwenIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M11.71 2c.179 0 .344.095.434.25l1.299 2.25h5.485a.5.5 0 0 1 .433.25l1.154 2a.5.5 0 0 1 0 .5l-1.299 2.25 2.742 4.75a.5.5 0 0 1 0 .5l-1.154 2a.5.5 0 0 1-.434.25h-2.597l-2.742 4.75a.5.5 0 0 1-.433.25h-2.31a.5.5 0 0 1-.433-.25l-1.299-2.25H4.072a.5.5 0 0 1-.433-.25l-1.155-2a.5.5 0 0 1 0-.5l1.3-2.25-2.743-4.75a.5.5 0 0 1 0-.5l1.155-2a.5.5 0 0 1 .433-.25h2.599L8.968 2.25A.5.5 0 0 1 9.402 2h2.31ZM6.587 7.625l-2.166-.001 5.052 8.75H6.587l-1.443 2.5h5.773L12 20.75l5.052-8.75 1.442 2.5 2.887-.001-2.887-5-1.083-1.874H9.474l1.443-2.5-1.443-2.5-2.887 5Zm8.877 2.375L12 16 8.536 10h6.928Z" fill="#615CED" />
  </svg>
)

const MinimaxIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M11.43 3.92a.86.86 0 1 0-1.718 0v14.236a1.999 1.999 0 0 1-3.997 0V9.022a.86.86 0 1 0-1.718 0v3.87a1.999 1.999 0 0 1-3.997 0V11.49a.57.57 0 0 1 1.139 0v1.404a.86.86 0 0 0 1.719 0V9.022a1.999 1.999 0 0 1 3.997 0v9.134a.86.86 0 0 0 1.719 0V3.92a1.998 1.998 0 1 1 3.996 0v11.788a.57.57 0 1 1-1.139 0zm10.572 3.105a2 2 0 0 0-1.999 1.997v7.63a.86.86 0 0 1-1.718 0V3.923a1.999 1.999 0 0 0-3.997 0v16.16a.86.86 0 0 1-1.719 0V18.08a.57.57 0 1 0-1.138 0v2a1.998 1.998 0 0 0 3.996 0V3.92a.86.86 0 0 1 1.719 0v12.73a1.999 1.999 0 0 0 3.996 0V9.023a.86.86 0 1 1 1.72 0v6.686a.57.57 0 0 0 1.138 0V9.022a2 2 0 0 0-1.998-1.997" fill="#F23F5D" />
  </svg>
)

const KiroIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M12 2L2 7v10l10 5 10-5V7L12 2Z" fill="#6366F1" />
    <path d="M12 2L2 7l10 5 10-5L12 2Z" fill="#818CF8" />
    <path d="M12 12v10l10-5V7l-10 5Z" fill="#4F46E5" />
  </svg>
)

const DefaultIcon = ({ size = 14, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
)

const ICON_MAP: Record<Provider, (props: IconProps) => JSX.Element> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  amazon: AmazonIcon,
  meta: MetaIcon,
  google: GoogleIcon,
  mistral: MistralIcon,
  cohere: CohereIcon,
  ai21: AI21Icon,
  deepseek: DeepSeekIcon,
  glm: GlmIcon,
  qwen: QwenIcon,
  minimax: MinimaxIcon,
  kiro: KiroIcon,
  unknown: DefaultIcon,
}

/** Return the appropriate provider icon component for a model ID or name. */
export const getModelIcon = (modelIdOrName: string, props: IconProps = {}): JSX.Element => {
  const provider = detectProvider(modelIdOrName)
  const Icon = ICON_MAP[provider]
  return <Icon {...props} />
}

export { type Provider, type IconProps }
