import { useEffect, useRef, type ElementType } from 'react'
import {
  IconChevronRight, IconFolderCode, IconCircle,
  IconSearch, IconX,
  IconRobot, IconFlask, IconBook, IconRocket, IconShield, IconPalette,
  IconGitBranch,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'

export interface ViewerState { filePath: string; title: string }

export const EMPTY_ARRAY: never[] = []

export const formatName = (name: string): string =>
  name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const STACK_PREFIXES = [
  'nextjs', 'laravel', 'magento', 'strapi', 'expo-react-native',
  'express', 'nodejs', 'devops', 'python', 'swiftui', 'mumzworld',
] as const

export const getAgentStack = (name: string): string => {
  const lower = name.toLowerCase()
  for (const p of STACK_PREFIXES) {
    if (lower.startsWith(p) || lower.includes(`-${p}-`) || lower.includes(`-${p}`)) return p
  }
  return 'custom'
}

export const getStackLabel = (stack: string): string => {
  const map: Record<string, string> = {
    nextjs: 'Next.js', laravel: 'Laravel', magento: 'Magento', strapi: 'Strapi',
    'expo-react-native': 'React Native', express: 'Express', nodejs: 'Node.js',
    devops: 'DevOps', python: 'Python', swiftui: 'SwiftUI', mumzworld: 'Mumzworld', custom: 'Custom',
  }
  return map[stack] ?? formatName(stack)
}

export const getAgentRole = (name: string): string => {
  const stack = getAgentStack(name)
  const raw = stack !== 'custom' ? name.slice(stack.length + 1) : name
  return raw ? formatName(raw) : formatName(name)
}

type StackMeta = { icon: ElementType; color: string }

export const getRoleIcon = (name: string): { icon: ElementType; color: string } => {
  const n = name.toLowerCase()
  if (n.includes('orchestrator'))  return { icon: IconGitBranch,  color: 'text-blue-600 dark:text-blue-400' }
  if (n.includes('workflow'))      return { icon: IconGitBranch,  color: 'text-blue-600 dark:text-blue-400' }
  if (n.includes('automation'))    return { icon: IconFlask,      color: 'text-amber-600 dark:text-amber-400' }
  if (n.includes('code-review'))   return { icon: IconShield,     color: 'text-rose-600 dark:text-rose-400' }
  if (n.includes('documentation')) return { icon: IconBook,       color: 'text-blue-600 dark:text-blue-400' }
  if (n.includes('senior'))        return { icon: IconPalette,    color: 'text-teal-600 dark:text-teal-400' }
  if (n.includes('expert'))        return { icon: IconRocket,     color: 'text-amber-600 dark:text-amber-300' }
  return { icon: IconRobot, color: 'text-muted-foreground/70' }
}

// Stack icons + colors used by AgentStackGroup
export { IconRobot } from '@tabler/icons-react'
import {
  IconStack2, IconDatabase, IconWorld, IconTerminal,
  IconBoxMultiple, IconCpu,
  IconBrandNextjs, IconBrandLaravel, IconBrandPython, IconBrandSwift,
  IconBrandReactNative, IconBrandNodejs, IconBrandDocker,
} from '@tabler/icons-react'

export const STACK_META: Record<string, StackMeta> = {
  nextjs:             { icon: IconBrandNextjs,     color: 'text-foreground/85' },
  laravel:            { icon: IconBrandLaravel,    color: 'text-red-600 dark:text-red-400' },
  magento:            { icon: IconBoxMultiple,     color: 'text-orange-600 dark:text-orange-400' },
  strapi:             { icon: IconDatabase,        color: 'text-indigo-600 dark:text-indigo-400' },
  'expo-react-native':{ icon: IconBrandReactNative,color: 'text-cyan-600 dark:text-cyan-400' },
  express:            { icon: IconStack2,          color: 'text-green-600 dark:text-green-400' },
  nodejs:             { icon: IconBrandNodejs,     color: 'text-emerald-600 dark:text-emerald-400' },
  devops:             { icon: IconBrandDocker,     color: 'text-sky-600 dark:text-sky-400' },
  python:             { icon: IconBrandPython,     color: 'text-yellow-600 dark:text-yellow-400' },
  swiftui:            { icon: IconBrandSwift,      color: 'text-orange-300' },
  mumzworld:          { icon: IconWorld,           color: 'text-pink-600 dark:text-pink-400' },
  custom:             { icon: IconRobot,           color: 'text-violet-600 dark:text-violet-400' },
}

export const SectionToggle = ({ icon: Icon, iconColor, label, count, errorCount, expanded, onToggle }: {
  icon: typeof IconRobot; iconColor?: string; label: string; count: number; errorCount?: number; expanded: boolean; onToggle: () => void
}) => (
  <button type="button" onClick={onToggle} className={cn(
    'flex w-full h-8 cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 text-[13px] text-left',
    'outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
    'hover:bg-accent hover:text-foreground transition-colors',
  )}>
    <IconChevronRight className={cn('-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150', expanded && 'rotate-90')} aria-hidden />
    <Icon className={cn('size-3.5 shrink-0', iconColor ?? 'text-muted-foreground')} aria-hidden />
    <span className="flex-1 truncate text-[13px] font-medium text-foreground/90">{label}</span>
    {errorCount && errorCount > 0 ? (
      <span className="flex items-center gap-1">
        <IconCircle className="size-1.5 shrink-0 fill-red-500 text-red-500" aria-hidden />
        <span className="text-[11px] tabular-nums text-red-600/70 dark:text-red-400/70">{errorCount}</span>
        <span className="text-[11px] text-muted-foreground">/</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
      </span>
    ) : (
      <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
    )}
  </button>
)

export const SourceDot = ({ source }: { source: 'global' | 'local' }) =>
  source === 'local' ? <IconFolderCode className="size-2.5 shrink-0 text-primary" aria-hidden /> : null

export const InlineSearch = ({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose: () => void }) => {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="relative mx-2 mb-1">
      <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/70 pointer-events-none" />
      <input ref={ref} type="text" value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { onChange(''); onClose() } }}
        placeholder="Filter…"
        className="h-6 w-full rounded-md bg-muted/30 pl-6 pr-6 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:bg-muted/50 transition-colors"
      />
      {value && (
        <button type="button" onClick={() => { onChange(''); onClose() }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 flex size-3.5 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground transition-colors">
          <IconX className="size-2.5" />
        </button>
      )}
    </div>
  )
}
