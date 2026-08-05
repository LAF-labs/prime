import { memo, useState } from 'react'
import {
  IconUser, IconSettings2, IconPaint, IconKeyboard, IconTool, IconArchive, IconActivity,
} from '@tabler/icons-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// ── Navigation ───────────────────────────────────────────────────

export type Section = 'account' | 'general' | 'appearance' | 'keymap' | 'advanced' | 'memory' | 'archives'

export type NavGroup = 'account' | 'settings' | 'data'

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  account: 'Account',
  settings: 'Settings',
  data: 'Data',
}

export const NAV: { id: Section; label: string; icon: typeof IconSettings2; description: string; sectionDescription: string; group: NavGroup }[] = [
  { id: 'account', label: 'Account', icon: IconUser, description: 'Auth status, login', sectionDescription: 'Manage your authentication and account preferences.', group: 'account' },
  { id: 'general', label: 'General', icon: IconSettings2, description: 'CLI path, model, permissions', sectionDescription: 'Configure the CLI, default model, and permission behavior.', group: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: IconPaint, description: 'Theme, font size', sectionDescription: 'Customize the look and feel of Kirodex.', group: 'settings' },
  { id: 'keymap', label: 'Keyboard', icon: IconKeyboard, description: 'Shortcuts reference', sectionDescription: 'View all available keyboard shortcuts.', group: 'settings' },
  { id: 'advanced', label: 'Advanced', icon: IconTool, description: 'Privacy, git, data', sectionDescription: 'Privacy, git integration, and data management.', group: 'settings' },
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
  { label: 'kiro-cli path', description: 'Path to the kiro-cli binary', section: 'general', keywords: 'cli binary connection detect' },
  { label: 'Default model', description: 'Choose the default AI model', section: 'general', keywords: 'model ai llm' },
  { label: 'Auto-approve', description: 'Skip permission prompts for tool calls', section: 'general', keywords: 'permissions approve tools' },
  { label: 'Respect .gitignore', description: 'Hide gitignored files from @ mentions', section: 'general', keywords: 'gitignore files mentions' },
  { label: 'Worktrees', description: 'Isolate each thread in its own git worktree', section: 'general', keywords: 'worktree git isolate thread' },
  { label: 'Tight sandbox', description: 'Restrict the agent to the project directory', section: 'general', keywords: 'sandbox restrict agent directory' },
  { label: 'Desktop notifications', description: 'Notify when the agent finishes or needs approval', section: 'general', keywords: 'notifications alert sound' },
  { label: 'Notification sound', description: 'Play a chime when a notification is sent', section: 'general', keywords: 'sound chime audio' },
  { label: 'Theme', description: 'Dark, light, or system theme', section: 'appearance', keywords: 'theme dark light mode' },
  { label: 'UI font size', description: 'Sidebar, file tree, header, and dialogs', section: 'appearance', keywords: 'font size text ui sidebar tree panel' },
  { label: 'Chat font size', description: 'Chat messages, markdown, and the message input', section: 'appearance', keywords: 'font size text chat markdown message input textarea' },
  { label: 'Sidebar position', description: 'Left or right sidebar placement', section: 'appearance', keywords: 'sidebar left right position layout' },
  { label: 'App icon', description: 'Upload a custom app icon for the dock and About dialog', section: 'appearance', keywords: 'icon logo branding image upload custom dock' },
  { label: 'Inline tool calls', description: 'Show each tool entry between paragraphs as it happens', section: 'appearance', keywords: 'inline tool calls activity flow interleave between paragraphs' },
  { label: 'Keyboard shortcuts', description: 'View all available keyboard shortcuts', section: 'keymap', keywords: 'keyboard shortcuts hotkeys keybindings' },
  { label: 'Anonymous analytics', description: 'Share anonymous usage data', section: 'advanced', keywords: 'analytics privacy telemetry' },
  { label: 'AI commit messages', description: 'Draft a commit message from the diff using your agent', section: 'advanced', keywords: 'ai commit message generate sparkle diff' },
  { label: 'Co-authored-by', description: 'Append Kirodex trailer to every commit', section: 'advanced', keywords: 'git commit co-author trailer' },
  { label: 'Task completion report', description: 'Summary card when a task finishes', section: 'advanced', keywords: 'report summary task completion' },
  { label: 'Max question length', description: 'Character limit for /btw and /tangent questions', section: 'advanced', keywords: 'btw tangent question limit characters' },
  { label: 'Clear history', description: 'Clear all threads without resetting settings', section: 'advanced', keywords: 'clear history delete conversations data threads' },
  { label: 'Replay onboarding', description: 'Run the setup wizard again', section: 'advanced', keywords: 'onboarding wizard setup replay' },
  { label: 'Account', description: 'Authentication status and sign in', section: 'account', keywords: 'account login sign auth email' },
  { label: 'Thread memory monitor', description: 'Per-thread memory usage and live buffers', section: 'memory', keywords: 'memory monitor performance ram heap thread usage profile leak' },
  { label: 'Terminal scrollback', description: 'Lines retained per terminal tab', section: 'memory', keywords: 'terminal scrollback pty memory lines history shell' },
  { label: 'Auto-close idle terminals', description: 'Close background terminal tabs after N minutes', section: 'memory', keywords: 'terminal idle auto close pty kill memory background tab' },
  { label: 'Reclaim memory', description: 'Purge soft-deleted threads and clear debug buffers', section: 'memory', keywords: 'memory reclaim purge clear ram heap soft deleted debug' },
  { label: 'Deleted threads', description: 'Restore or permanently remove deleted threads', section: 'archives', keywords: 'deleted threads restore archive trash' },
] as const

// ── Reusable components ──────────────────────────────────────────

interface SettingRowProps {
  label: string
  description: string
  children: React.ReactNode
  className?: string
}

export const SettingRow = memo(function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2.5', className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-foreground">{label}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
})

export const SectionLabel = ({ title }: { title: string }) => (
  <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
)

export const SectionHeader = ({ section }: { section: Section }) => {
  const nav = NAV.find((n) => n.id === section)
  if (!nav) return null
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <nav.icon className="size-5 text-primary" />
        <h3 className="text-[16px] font-semibold text-foreground">{nav.label}</h3>
      </div>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{nav.sectionDescription}</p>
    </div>
  )
}

export const SettingsCard = memo(function SettingsCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'rounded-xl border border-border/50 bg-card/70 px-4 py-2 shadow-sm',
      className,
    )}>
      {children}
    </div>
  )
})

export const Divider = () => <div className="border-t border-border/40" />

/** Two-column grid: label/description on the left, controls on the right. */
export const SettingsGrid = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[200px_1fr] gap-6">
    <div className="pt-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {description && <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground/60">{description}</p>}
    </div>
    <div>{children}</div>
  </div>
)

// ── Confirm dialog for destructive actions ───────────────────────

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
  isDestructive?: boolean
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  isDestructive = true,
}: ConfirmDialogProps) => {
  const [isLoading, setIsLoading] = useState(false)

  const handleConfirm = async () => {
    setIsLoading(true)
    try {
      onConfirm()
      onOpenChange(false)
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
            Cancel
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={handleConfirm}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-50',
              isDestructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
