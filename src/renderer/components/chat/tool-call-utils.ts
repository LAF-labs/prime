import {
  IconFileText, IconFilePencil, IconTrash, IconFolderSearch, IconTerminal2, IconBrain,
  IconGlobe, IconArrowsRightLeft, IconTool,
} from '@tabler/icons-react'
import type { ToolKind } from '@/types'

type TablerIcon = typeof IconTool

const kindIcons: Record<ToolKind, TablerIcon> = {
  read: IconFileText,
  edit: IconFilePencil,
  delete: IconTrash,
  move: IconArrowsRightLeft,
  search: IconFolderSearch,
  execute: IconTerminal2,
  think: IconBrain,
  fetch: IconGlobe,
  switch_mode: IconArrowsRightLeft,
  other: IconTool,
}

/** Color classes per tool kind — used for icon tinting and accent borders */
export const kindColors: Record<ToolKind, { icon: string; bg: string; dot: string }> = {
  read: { icon: 'text-sky-500', bg: 'bg-sky-500/10', dot: 'bg-sky-500' },
  edit: { icon: 'text-amber-500', bg: 'bg-amber-500/10', dot: 'bg-amber-500' },
  delete: { icon: 'text-red-500', bg: 'bg-red-500/10', dot: 'bg-red-500' },
  move: { icon: 'text-violet-500', bg: 'bg-violet-500/10', dot: 'bg-violet-500' },
  search: { icon: 'text-indigo-500', bg: 'bg-indigo-500/10', dot: 'bg-indigo-500' },
  execute: { icon: 'text-emerald-500', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500' },
  think: { icon: 'text-purple-500', bg: 'bg-purple-500/10', dot: 'bg-purple-500' },
  fetch: { icon: 'text-cyan-500', bg: 'bg-cyan-500/10', dot: 'bg-cyan-500' },
  switch_mode: { icon: 'text-pink-500', bg: 'bg-pink-500/10', dot: 'bg-pink-500' },
  other: { icon: 'text-muted-foreground', bg: 'bg-muted/50', dot: 'bg-muted-foreground' },
}

/** Check if a tool call represents a file mutation (edit, delete, move) */
export function isFileMutation(kind?: ToolKind, title?: string): boolean {
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return true
  if (kind) return false
  const t = (title ?? '').toLowerCase()
  return t.includes('edit') || t.includes('write') || t.includes('patch') || t.includes('delet') || t.includes('mov') || t.includes('renam')
}

export function getToolIcon(kind?: ToolKind, title?: string): TablerIcon {
  if (kind && kindIcons[kind]) return kindIcons[kind]
  const t = (title ?? '').toLowerCase()
  if (t.includes('bash') || t.includes('command') || t.includes('exec') || t.includes('shell')) return IconTerminal2
  if (t.includes('read') || t.includes('cat') || t.includes('view')) return IconFileText
  if (t.includes('write') || t.includes('edit') || t.includes('patch')) return IconFilePencil
  if (t.includes('search') || t.includes('grep') || t.includes('find') || t.includes('glob')) return IconFolderSearch
  if (t.includes('fetch') || t.includes('web') || t.includes('http')) return IconGlobe
  if (t.includes('think')) return IconBrain
  return IconTool
}

export function getToolColor(kind?: ToolKind, title?: string): { icon: string; bg: string; dot: string } {
  if (kind && kindColors[kind]) return kindColors[kind]
  const t = (title ?? '').toLowerCase()
  if (t.includes('bash') || t.includes('command') || t.includes('exec') || t.includes('shell')) return kindColors.execute
  if (t.includes('read') || t.includes('cat') || t.includes('view')) return kindColors.read
  if (t.includes('write') || t.includes('edit') || t.includes('patch')) return kindColors.edit
  if (t.includes('search') || t.includes('grep') || t.includes('find') || t.includes('glob')) return kindColors.search
  if (t.includes('fetch') || t.includes('web') || t.includes('http')) return kindColors.fetch
  if (t.includes('think')) return kindColors.think
  return kindColors.other
}

/** Get a file extension color for badge dots */
export function getFileExtColor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts': case 'tsx': return 'bg-blue-500'
    case 'js': case 'jsx': return 'bg-yellow-500'
    case 'rs': return 'bg-orange-500'
    case 'py': return 'bg-green-500'
    case 'css': case 'scss': return 'bg-pink-500'
    case 'html': return 'bg-red-500'
    case 'json': case 'toml': case 'yaml': case 'yml': return 'bg-amber-500'
    case 'md': case 'mdx': return 'bg-purple-500'
    case 'go': return 'bg-cyan-500'
    case 'vue': case 'svelte': return 'bg-emerald-500'
    default: return 'bg-muted-foreground'
  }
}
