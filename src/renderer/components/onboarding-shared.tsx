import { IconMessageChatbot, IconListCheck, IconTool, IconLock } from '@tabler/icons-react'

export type Step = 'welcome' | 'theme' | 'setup'
export type DetectState = 'detecting' | 'found' | 'not-found'
export type AuthState = 'checking' | 'authenticated' | 'not-authenticated'

export const FEATURES = [
  { Icon: IconMessageChatbot, text: 'Chat with AI about your code' },
  { Icon: IconListCheck, text: 'Plan mode for structured feature development' },
  { Icon: IconTool, text: 'Agent executes file edits, terminal commands, and more' },
  { Icon: IconLock, text: 'Runs locally — your code stays on your machine' },
] as const

export const LoginMethod = ({ Icon, label }: { Icon: React.ElementType; label: string }) => (
  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
    <Icon size={12} /> {label}
  </div>
)
