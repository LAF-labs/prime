import { t } from '@/lib/i18n'
import { memo, useState } from 'react'
import {
  IconUser, IconSettings2, IconPaint, IconKeyboard, IconTool, IconArchive, IconActivity, IconLoader2,
  IconShieldLock,
} from '@tabler/icons-react'
import { reportFailure } from '@/lib/ipc-report'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// ── Navigation ───────────────────────────────────────────────────

export type Section = 'account' | 'general' | 'permissions' | 'appearance' | 'keymap' | 'advanced' | 'memory' | 'archives'

export type NavGroup = 'account' | 'settings' | 'data'

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  account: 'Account',
  settings: 'Settings',
  data: 'Data',
}

export const NAV: { id: Section; label: string; icon: typeof IconSettings2; description: string; sectionDescription: string; group: NavGroup }[] = [
  { id: 'account', label: 'Providers', icon: IconUser, description: 'API keys, endpoints', sectionDescription: 'Add API keys for the AI providers you use. Custom OpenAI-compatible endpoints are supported.', group: 'account' },
  { id: 'general', label: 'General', icon: IconSettings2, description: 'Model, workspace, notifications', sectionDescription: 'Choose the default model and how the agent behaves in your folders.', group: 'settings' },
  { id: 'permissions', label: 'Permissions', icon: IconShieldLock, description: 'Modes and allow-rules', sectionDescription: 'Choose how tool calls are approved, and manage always-allow rules.', group: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: IconPaint, description: 'Theme, language, layout', sectionDescription: 'Customize the look and feel of LAF Agent.', group: 'settings' },
  { id: 'keymap', label: 'Keyboard', icon: IconKeyboard, description: 'Shortcuts reference', sectionDescription: 'View all available keyboard shortcuts.', group: 'settings' },
  { id: 'advanced', label: 'Advanced', icon: IconTool, description: 'Privacy, data', sectionDescription: 'Privacy and data management.', group: 'settings' },
  { id: 'memory', label: 'Memory', icon: IconActivity, description: 'Per-thread memory usage', sectionDescription: 'Inspect and reclaim memory held by threads, drafts, and debug buffers.', group: 'data' },
  { id: 'archives', label: 'Archives', icon: IconArchive, description: 'Deleted threads', sectionDescription: 'Restore or permanently remove deleted threads.', group: 'data' },
]

// ── Search index ─────────────────────────────────────────────────

export interface SearchableItem {
  readonly label: string
  readonly description: string
  readonly section: Section
  readonly keywords: string
}

export const SEARCHABLE_SETTINGS: readonly SearchableItem[] = [
  { label: 'Agent connection', description: 'Where the agent runs from', section: 'general', keywords: 'cli binary connection detect path prime-agent' },
  { label: 'Default model', description: 'Choose the default AI model', section: 'general', keywords: 'model ai llm' },
  { label: 'Permission mode', description: 'Ask, accept edits, or auto-run tool calls', section: 'permissions', keywords: 'permissions approve tools ask accept edits auto mode auto-approve' },
  { label: 'Allow rules', description: 'Always-allow rules for tools and commands', section: 'permissions', keywords: 'permissions allow rules always tool command glob whitelist' },
  { label: 'Hide ignored files', description: 'Keep files your project excludes out of @ mentions', section: 'general', keywords: 'gitignore ignored files mentions' },
  { label: 'Tight sandbox', description: 'Restrict the agent to the project directory', section: 'general', keywords: 'sandbox restrict agent directory' },
  { label: 'Desktop notifications', description: 'Notify when the agent finishes or needs approval', section: 'general', keywords: 'notifications alert sound' },
  { label: 'Notification sound', description: 'Play a chime when a notification is sent', section: 'general', keywords: 'sound chime audio' },
  { label: 'Theme', description: 'Dark, light, or system theme', section: 'appearance', keywords: 'theme dark light mode' },
  { label: 'Language', description: 'App display language', section: 'appearance', keywords: 'language locale english korean 한국어 언어' },
  { label: 'Sidebar position', description: 'Left or right sidebar placement', section: 'appearance', keywords: 'sidebar left right position layout' },
  { label: 'App icon', description: 'Upload a custom app icon for the dock and About dialog', section: 'appearance', keywords: 'icon logo branding image upload custom dock' },
  { label: 'Inline tool calls', description: 'Show each tool entry between paragraphs as it happens', section: 'appearance', keywords: 'inline tool calls activity flow interleave between paragraphs' },
  { label: 'Keyboard shortcuts', description: 'View all available keyboard shortcuts', section: 'keymap', keywords: 'keyboard shortcuts hotkeys keybindings' },
  { label: 'Max concurrent agents', description: 'How many agents may run at once', section: 'advanced', keywords: 'concurrent agents limit threads processes parallel load memory cap kernel' },
  { label: 'Usage statistics', description: 'Local stats for the dashboard — nothing leaves this machine', section: 'advanced', keywords: 'analytics privacy usage statistics local opt-out disable' },
  { label: 'Export as Markdown', description: 'Right-click a thread in the sidebar to export the conversation', section: 'advanced', keywords: 'export markdown save conversation thread backup' },
  { label: 'Task completion report', description: 'Summary card when a task finishes', section: 'advanced', keywords: 'report summary task completion' },
  { label: 'Side question length limit', description: 'Side questions (/btw) longer than this are trimmed', section: 'advanced', keywords: 'btw tangent side question limit characters length' },
  { label: 'Clear history', description: 'Clear all threads without resetting settings', section: 'advanced', keywords: 'clear history delete conversations data threads' },
  { label: 'Replay onboarding', description: 'Run the setup wizard again', section: 'advanced', keywords: 'onboarding wizard setup replay' },
  { label: 'Account', description: 'Authentication status and sign in', section: 'account', keywords: 'account login sign auth email' },
  { label: 'Token pricing', description: 'USD per 1M tokens for custom providers', section: 'account', keywords: 'cost price pricing token rate usd custom provider spend billing' },
  { label: 'Thread memory monitor', description: 'Per-thread memory usage and live buffers', section: 'memory', keywords: 'memory monitor performance ram heap thread usage profile leak' },
  { label: 'Terminal scrollback', description: 'Lines retained per terminal tab', section: 'memory', keywords: 'terminal scrollback pty memory lines history shell' },
  { label: 'Auto-close idle terminals', description: 'Close background terminal tabs after N minutes', section: 'memory', keywords: 'terminal idle auto close pty kill memory background tab' },
  { label: 'Reclaim memory', description: 'Purge soft-deleted threads and clear debug buffers', section: 'memory', keywords: 'memory reclaim purge clear ram heap soft deleted debug' },
  { label: 'Deleted threads', description: 'Restore or permanently remove deleted threads', section: 'archives', keywords: 'deleted threads restore archive trash' },
] as const

// ── Layout primitives ────────────────────────────────────────────
//
// One grammar for every settings surface, modelled on the Claude Code
// settings dialog: a single column of full-width rows, grouped under plain
// headings and separated by hairlines. No cards, no label gutter — the label
// sits on the left of its own row and the control on the right.

/** A titled group of rows. Rows separate themselves with hairlines. */
export const SettingsSection = memo(function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('mb-9 last:mb-0', className)}>
      {title && (
        <div className="mb-1">
          <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
          {description && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  )
})

interface SettingRowProps {
  label: string
  description?: string
  children?: React.ReactNode
  /** Stack the control under the label instead of beside it — for controls
   *  that need the full width (long inputs, grids, lists). */
  stacked?: boolean
  className?: string
}

export const SettingRow = memo(function SettingRow({ label, description, children, stacked, className }: SettingRowProps) {
  if (stacked) {
    return (
      <div className={cn('py-4', className)}>
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {description && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>}
        {children && <div className="mt-3">{children}</div>}
      </div>
    )
  }
  return (
    <div className={cn('flex items-center justify-between gap-6 py-4', className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {description && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
})

/** Full-bleed block inside a section for content that isn't a labelled row. */
export const SettingBlock = memo(function SettingBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('py-4', className)}>{children}</div>
})

export const SectionHeader = ({ section }: { section: Section }) => {
  const nav = NAV.find((n) => n.id === section)
  if (!nav) return null
  return (
    <div className="mb-7">
      <h2 className="text-[19px] font-semibold text-foreground">{t(nav.label)}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{t(nav.sectionDescription)}</p>
    </div>
  )
}

export const Divider = () => <div className="border-t border-border/60" />

/** Shared control shapes so every section's inputs and buttons match. */
export const SETTINGS_INPUT_CLASS =
  'h-8 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

export const SETTINGS_BUTTON_CLASS =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

/** Segmented choice: exactly one option active. */
export const SegmentedOption = ({
  active,
  onClick,
  children,
  ariaLabel,
  disabled,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  ariaLabel?: string
  disabled?: boolean
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-pressed={active}
    aria-label={ariaLabel}
    className={cn(
      'h-8 rounded-lg border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40',
      active
        ? 'border-ring bg-accent text-foreground'
        : 'border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground',
    )}
  >
    {children}
  </button>
)

// ── Confirm dialog for destructive actions ───────────────────────

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Defaults to the translated "Confirm". */
  confirmLabel?: string
  /** May be async: the dialog awaits it, closes on success, and stays open with a failure toast on error. */
  onConfirm: () => void | Promise<void>
  isDestructive?: boolean
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isDestructive = true,
}: ConfirmDialogProps) => {
  const [isLoading, setIsLoading] = useState(false)

  const handleConfirm = async () => {
    setIsLoading(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      // Closing on a failed destructive action would show it as done when it
      // was not. Keep the dialog open so the user can retry or cancel.
      reportFailure(title, err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-input px-4 py-2 text-[13px] font-medium transition-colors hover:bg-accent"
          >
            {t('Cancel')}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={handleConfirm}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-50',
              isDestructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {isLoading && <IconLoader2 className="size-3.5 animate-spin" aria-hidden />}
            {confirmLabel ?? t('Confirm')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
