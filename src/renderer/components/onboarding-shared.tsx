import { IconMessageChatbot, IconWorldSearch, IconFiles, IconBrain } from '@tabler/icons-react'

export type Step = 'welcome' | 'theme' | 'setup'
export type DetectState = 'detecting' | 'found' | 'not-found'
export type AuthState = 'checking' | 'authenticated' | 'not-authenticated'

/** Rendered through t() at the call site — Korean entries live in i18n-ko.ts. */
export const FEATURES = [
  { Icon: IconMessageChatbot, text: 'Answers, writing, and documents on demand' },
  { Icon: IconWorldSearch, text: 'Researches the web and summarizes what matters' },
  { Icon: IconFiles, text: 'Works with your files — reads, organizes, edits' },
  { Icon: IconBrain, text: 'Remembers you — your context carries across chats' },
] as const

export const LoginMethod = ({ Icon, label }: { Icon: React.ElementType; label: string }) => (
  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
    <Icon size={12} /> {label}
  </div>
)
