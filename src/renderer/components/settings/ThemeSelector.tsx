import { IconCheck } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '@/types'

/**
 * Hardcoded color tokens for each theme preview card.
 * These mirror the CSS custom properties in tailwind.css so the
 * miniature mockup always renders correctly regardless of the
 * currently active theme.
 */
const THEME_COLORS: Record<'dark' | 'light', {
  bg: string
  sidebar: string
  card: string
  fg: string
  fgMuted: string
  border: string
  primary: string
}> = {
  dark: {
    bg: '#0D0D0D',
    sidebar: '#111111',
    card: '#141414',
    fg: '#f0f0f0',
    fgMuted: '#555555',
    border: 'rgba(255,255,255,0.10)',
    primary: '#6366f1',
  },
  light: {
    bg: '#ffffff',
    sidebar: '#f7f7f8',
    card: '#fafafa',
    fg: '#1a1a1a',
    fgMuted: '#c0c0c0',
    border: '#e5e5e5',
    primary: '#6366f1',
  },
}

interface ThemeOption {
  mode: ThemeMode
  label: string
}

const THEMES: ThemeOption[] = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
  { mode: 'system', label: 'System' },
]

/** Miniature UI mockup rendered with hardcoded colors. */
const ThemePreview = ({ colors }: { colors: typeof THEME_COLORS.dark }) => (
  <div
    className="relative w-full overflow-hidden rounded-md"
    style={{ background: colors.bg, border: `1px solid ${colors.border}`, aspectRatio: '16/10' }}
  >
    {/* Sidebar */}
    <div
      className="absolute inset-y-0 left-0 flex flex-col gap-[3px] p-[5px]"
      style={{ width: '28%', background: colors.sidebar, borderRight: `1px solid ${colors.border}` }}
    >
      <div className="rounded-sm" style={{ height: 4, width: '70%', background: colors.primary, opacity: 0.8 }} />
      <div className="rounded-sm" style={{ height: 3, width: '85%', background: colors.fgMuted }} />
      <div className="rounded-sm" style={{ height: 3, width: '60%', background: colors.fgMuted }} />
      <div className="rounded-sm" style={{ height: 3, width: '75%', background: colors.fgMuted }} />
    </div>
    {/* Content area */}
    <div className="absolute inset-y-0 right-0 flex flex-col gap-[3px] p-[6px]" style={{ left: '28%' }}>
      <div className="rounded-sm" style={{ height: 4, width: '50%', background: colors.fg, opacity: 0.7 }} />
      <div className="mt-[2px] rounded-sm" style={{ height: 3, width: '90%', background: colors.fgMuted }} />
      <div className="rounded-sm" style={{ height: 3, width: '80%', background: colors.fgMuted }} />
      <div className="rounded-sm" style={{ height: 3, width: '65%', background: colors.fgMuted }} />
      {/* Card block */}
      <div
        className="mt-auto rounded-sm"
        style={{ height: 10, background: colors.card, border: `1px solid ${colors.border}` }}
      />
    </div>
  </div>
)

/**
 * A split preview for the "System" option: left half light, right half dark.
 */
const SystemPreview = () => {
  const light = THEME_COLORS.light
  const dark = THEME_COLORS.dark
  return (
    <div
      className="relative w-full overflow-hidden rounded-md"
      style={{ border: `1px solid ${dark.border}`, aspectRatio: '16/10' }}
    >
      {/* Left half — light */}
      <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden" style={{ background: light.bg }}>
        <div
          className="absolute inset-y-0 left-0 flex flex-col gap-[3px] p-[5px]"
          style={{ width: '56%', background: light.sidebar, borderRight: `1px solid ${light.border}` }}
        >
          <div className="rounded-sm" style={{ height: 4, width: '70%', background: light.primary, opacity: 0.8 }} />
          <div className="rounded-sm" style={{ height: 3, width: '85%', background: light.fgMuted }} />
          <div className="rounded-sm" style={{ height: 3, width: '60%', background: light.fgMuted }} />
        </div>
        <div className="absolute inset-y-0 right-0 flex flex-col gap-[3px] p-[4px]" style={{ left: '56%' }}>
          <div className="rounded-sm" style={{ height: 3, width: '90%', background: light.fgMuted }} />
          <div className="rounded-sm" style={{ height: 3, width: '70%', background: light.fgMuted }} />
        </div>
      </div>
      {/* Right half — dark */}
      <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden" style={{ background: dark.bg }}>
        <div className="flex flex-col gap-[3px] p-[4px]">
          <div className="rounded-sm" style={{ height: 3, width: '90%', background: dark.fgMuted }} />
          <div className="rounded-sm" style={{ height: 3, width: '70%', background: dark.fgMuted }} />
          <div className="rounded-sm" style={{ height: 3, width: '55%', background: dark.fgMuted }} />
          <div
            className="mt-auto rounded-sm"
            style={{ height: 8, background: dark.card, border: `1px solid ${dark.border}` }}
          />
        </div>
      </div>
      {/* Center divider */}
      <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: dark.border }} />
    </div>
  )
}

interface ThemeSelectorProps {
  value: ThemeMode
  onChange: (mode: ThemeMode) => void
}

/** Visual theme selector with preview cards for Light, Dark, and System. */
const ThemeSelector = ({ value, onChange }: ThemeSelectorProps) => (
  <div className="grid grid-cols-3 gap-3">
    {THEMES.map(({ mode, label }) => {
      const isActive = value === mode
      return (
        <button
          key={mode}
          type="button"
          aria-label={`Select ${label} theme`}
          aria-pressed={isActive}
          onClick={() => onChange(mode)}
          className={cn(
            'group relative flex flex-col items-center gap-2 rounded-xl border-2 p-2.5 transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive
              ? 'border-primary bg-primary/5 shadow-sm shadow-primary/10'
              : 'border-border/40 hover:border-border hover:bg-accent/30',
          )}
        >
          {/* Preview */}
          {mode === 'system'
            ? <SystemPreview />
            : <ThemePreview colors={THEME_COLORS[mode]} />}

          {/* Label + check */}
          <div className="flex items-center gap-1.5">
            {isActive && (
              <span className="flex size-4 items-center justify-center rounded-full bg-primary">
                <IconCheck className="size-2.5 text-primary-foreground" strokeWidth={3} />
              </span>
            )}
            <span
              className={cn(
                'text-xs font-medium',
                isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
              )}
            >
              {label}
            </span>
          </div>
        </button>
      )
    })}
  </div>
)

export default ThemeSelector
