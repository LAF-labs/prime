import { t } from '@/lib/i18n'
import { memo, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { fuzzyScore } from '@/lib/fuzzy-search'
import type { SlashCommand } from '@/stores/settingsStore'

// The agent may send names with a leading slash; we render the slash ourselves.
const displayName = (name: string): string => name.replace(/^\/+/, '')

// Descriptions arrive ready to render: `useChatInput` translates our own
// registry entries, and the agent supplies its own text for extension,
// prompt-template, and skill commands. Nothing to override here.

// ── Per-command SVG icons ───────────────────────────────────────────
const icon = (d: string) => () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

const COMMAND_ICONS: Record<string, () => React.ReactNode> = {
  changelog: icon('M4 4h16v16H4zM8 9h8M8 13h5'),
  clone: icon('M9 9h10v10H9zM5 15V5h10'),
  copy: icon('M9 9h10v10H9zM5 15V5h10'),
  export: icon('M12 3v12M8 11l4 4 4-4M4 19h16'),
  goal: icon('M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0'),
  heartbeat: icon('M3 12h4l2-6 4 12 2-6h6'),
  hotkeys: icon('M4 6h16v12H4zM8 10h.01M12 10h.01M16 10h.01M8 14h8'),
  login: icon('M15 3h4v18h-4M10 17l5-5-5-5M3 12h12'),
  logout: icon('M9 3H5v18h4M14 17l5-5-5-5M21 12H9'),
  logs: icon('M4 4h16v16H4zM8 8h8M8 12h8M8 16h4'),
  mcp: icon('M12 3v6M5 9h14v6H5zM9 15v6M15 15v6'),
  new: icon('M12 5v14M5 12h14'),
  session: icon('M3 12h4l2-6 4 12 2-6h6'),
  thinking: icon('M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3zM9 21h6'),
  agent: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  ),
  branch: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  ),
  btw: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  clear: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M5 6l1 14h12l1-14" />
    </svg>
  ),
  data: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" /><path d="M7 16V8" /><path d="M11 16V11" /><path d="M15 16V14" /><path d="M19 16V10" />
    </svg>
  ),
  compact: icon('M4 6h16M4 12h10M4 18h6'),
  context: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  fork: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><path d="M12 15V9" /><path d="M6 9v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9" />
    </svg>
  ),
  model: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  ),
  plan: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 7h8M8 12h8M8 17h4" />
    </svg>
  ),
  settings: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  tangent: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15.02 19.52c-2.341 .736 -5 .606 -7.32 -.52l-4.7 1l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c1.649 1.407 2.575 3.253 2.742 5.152" />
      <path d="M19 22v.01" />
      <path d="M19 19a2.003 2.003 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483" />
    </svg>
  ),
  usage: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" /><path d="M18 9l-5 5-4-4-3 3" />
    </svg>
  ),
  worktree: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="6" y1="9" x2="6" y2="15" /><path d="M9 6h6" /><path d="M6 9c0 3 2 6 6 9" />
    </svg>
  ),
}

const DefaultIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 17l6-6-6-6" /><path d="M12 19h8" />
  </svg>
)

interface SlashCommandPickerProps {
  query: string
  commands: SlashCommand[]
  onSelect: (cmd: SlashCommand) => void
  onDismiss: () => void
  activeIndex: number
}

export const SlashCommandPicker = memo(function SlashCommandPicker({
  query, commands, onSelect, activeIndex,
}: SlashCommandPickerProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const filtered = query
    ? commands
        .map((c) => {
          const name = displayName(c.name)
          const desc = c.description ?? ''
          const nameScore = fuzzyScore(query, name)
          const descScore = fuzzyScore(query, desc)
          const best = nameScore !== null && descScore !== null
            ? Math.min(nameScore, descScore + 50)
            : nameScore ?? (descScore !== null ? descScore + 50 : null)
          return { cmd: c, score: best }
        })
        .filter((r): r is { cmd: SlashCommand; score: number } => r.score !== null)
        .sort((a, b) => a.score - b.score)
        .map((r) => r.cmd)
    : commands
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])
  if (filtered.length === 0) return null
  return (
    <div
      className="absolute bottom-full left-0 right-0 z-[300] mb-2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl ring-1 ring-black/5 dark:ring-white/5 floating-panel"
      role="listbox"
      aria-label={t('Slash commands')}
    >
      <ul ref={listRef} className="max-h-[240px] overflow-y-auto py-1">
        {filtered.map((cmd, i) => {
          const name = displayName(cmd.name)
          const Icon = COMMAND_ICONS[name] ?? DefaultIcon
          const description = cmd.description ?? ''
          const isActive = i === activeIndex % filtered.length
          return (
            <li
              key={cmd.name}
              role="option"
              aria-selected={isActive}
              onMouseDown={(e) => { e.preventDefault(); onSelect(cmd) }}
              className={cn(
                'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <span className={cn('shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground/70')}>
                <Icon />
              </span>
              <span className="font-medium text-[13px]">/{name}</span>
              {description && (
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{description}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
})
