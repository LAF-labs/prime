import { useState, useCallback } from 'react'
import {
  IconMessageChatbot, IconListCheck, IconTool, IconLock,
  IconCopy, IconCheck,
} from '@tabler/icons-react'

export type Step = 'welcome' | 'theme' | 'setup'
export type DetectState = 'detecting' | 'found' | 'not-found'
export type AuthState = 'checking' | 'authenticated' | 'not-authenticated'
export type Platform = 'macos' | 'linux' | 'windows'

export const FEATURES = [
  { Icon: IconMessageChatbot, text: 'Chat with AI about your code' },
  { Icon: IconListCheck, text: 'Plan mode for structured feature development' },
  { Icon: IconTool, text: 'Agent executes file edits, terminal commands, and more' },
  { Icon: IconLock, text: 'Runs locally — your code stays on your machine' },
] as const

export interface InstallCommand {
  readonly label: string
  readonly command: string
}

export const INSTALL_COMMANDS: Record<Platform, { primary: InstallCommand; alternatives: InstallCommand[] }> = {
  macos: {
    primary: { label: 'Homebrew', command: 'brew install kiro-cli' },
    alternatives: [
      { label: 'curl', command: 'curl -fsSL https://kiro.dev/install.sh | sh' },
      { label: 'Manual', command: 'Download from https://kiro.dev/docs/cli/installation/' },
    ],
  },
  linux: {
    primary: { label: 'curl', command: 'curl -fsSL https://kiro.dev/install.sh | sh' },
    alternatives: [
      { label: 'apt', command: 'sudo apt install kiro-cli' },
      { label: 'Manual', command: 'Download from https://kiro.dev/docs/cli/installation/' },
    ],
  },
  windows: {
    primary: { label: 'PowerShell', command: 'irm https://kiro.dev/install.ps1 | iex' },
    alternatives: [
      { label: 'Manual', command: 'Download from https://kiro.dev/docs/cli/installation/' },
    ],
  },
}

export const detectPlatform = (): Platform => {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  return 'linux'
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
}

export const accountTypeLabel = (t: string): string => {
  if (t === 'IamIdentityCenter') return 'IAM Identity Center'
  if (t === 'BuilderId') return 'Builder ID'
  return t
}

/** Small copy-to-clipboard button with checkmark feedback */
export const CopyButton = ({ text }: { text: string }) => {
  const [isCopied, setIsCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch { /* clipboard may not be available */ }
  }, [text])
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy to clipboard"
      tabIndex={0}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground/70"
    >
      {isCopied ? <IconCheck size={14} className="text-emerald-600 dark:text-emerald-400" /> : <IconCopy size={14} />}
    </button>
  )
}

/** Single install command row */
export const CommandRow = ({ cmd }: { cmd: InstallCommand }) => (
  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground w-16">{cmd.label}</span>
    <code className="flex-1 truncate font-mono text-[12px] text-muted-foreground">{cmd.command}</code>
    <CopyButton text={cmd.command} />
  </div>
)

export const LoginMethod = ({ Icon, label }: { Icon: React.ElementType; label: string }) => (
  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
    <Icon size={12} /> {label}
  </div>
)
