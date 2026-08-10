import { t } from '@/lib/i18n'
import { memo, useEffect, useRef, useState, useMemo } from 'react'
import { IconRobot, IconBolt, IconCode, IconListCheck, IconX, IconAlignLeft } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ipc } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settingsStore'
import { useResourceStore } from '@/stores/resourceStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ProjectFile } from '@/types'

// ── Built-in agents for @ mention ────────────────────────────────────
const BUILT_IN_MENTION_AGENTS = [
  { name: 'Default', id: 'code', description: 'Code, edit, and execute', icon: IconCode, color: 'text-primary', bgCls: 'bg-primary/20' },
  { name: 'Planner', id: 'plan', description: 'Plan before coding', icon: IconListCheck, color: 'text-teal-600 dark:text-teal-400', bgCls: 'bg-teal-500/20' },
] as const

/** Resolve the icon + color for an agent mention pill by path */
const getAgentPillMeta = (agentPath: string): { icon: typeof IconRobot; color: string; bgCls: string } => {
  const name = agentPath.replace(/^agent:/, '')
  const builtin = BUILT_IN_MENTION_AGENTS.find((a) => a.id === name || a.name === name)
  if (builtin) return { icon: builtin.icon, color: builtin.color, bgCls: builtin.bgCls }
  return { icon: IconRobot, color: 'text-primary', bgCls: 'bg-primary/20' }
}

// ── File type icon by extension ──────────────────────────────────────
const EXT_ICONS: Record<string, { label: string; cls: string }> = {
  ts:    { label: 'TS',  cls: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
  tsx:   { label: 'TSX', cls: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
  js:    { label: 'JS',  cls: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' },
  jsx:   { label: 'JSX', cls: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' },
  rs:    { label: 'RS',  cls: 'bg-orange-500/20 text-orange-600 dark:text-orange-400' },
  toml:  { label: 'TL',  cls: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' },
  json:  { label: '{}',  cls: 'bg-green-500/20 text-green-600 dark:text-green-400' },
  md:    { label: 'MD',  cls: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
  css:   { label: 'CSS', cls: 'bg-pink-500/20 text-pink-600 dark:text-pink-400' },
  html:  { label: 'HTM', cls: 'bg-red-500/20 text-red-600 dark:text-red-400' },
  yml:   { label: 'YML', cls: 'bg-rose-500/20 text-rose-600 dark:text-rose-400' },
  yaml:  { label: 'YML', cls: 'bg-rose-500/20 text-rose-600 dark:text-rose-400' },
  py:    { label: 'PY',  cls: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' },
  go:    { label: 'GO',  cls: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400' },
  sh:    { label: 'SH',  cls: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' },
  svg:   { label: 'SVG', cls: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
  png:   { label: 'IMG', cls: 'bg-teal-500/20 text-teal-600 dark:text-teal-400' },
  jpg:   { label: 'IMG', cls: 'bg-teal-500/20 text-teal-600 dark:text-teal-400' },
  lock:  { label: 'LCK', cls: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' },
}

const FileIcon = memo(function FileIcon({ ext, isDir }: { ext: string; isDir: boolean }) {
  if (isDir) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-500/20 text-[11px] font-bold text-amber-600 dark:text-amber-400">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </span>
    )
  }
  const info = EXT_ICONS[ext.toLowerCase()]
  if (info) {
    return (
      <span className={cn('flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold', info.cls)}>
        {info.label}
      </span>
    )
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-[11px] text-muted-foreground">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
      </svg>
    </span>
  )
})


// ── Relative time formatter ──────────────────────────────────────────
const formatRelativeTime = (epochSecs: number): string => {
  if (epochSecs <= 0) return ''
  const now = Date.now() / 1000
  const diff = Math.max(0, now - epochSecs)

  if (diff < 60) return 'just now'
  if (diff < 3600) {
    const m = Math.floor(diff / 60)
    return `${m}m ago`
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600)
    return `${h}h ago`
  }
  if (diff < 604800) {
    const d = Math.floor(diff / 86400)
    return `${d}d ago`
  }
  if (diff < 2592000) {
    const w = Math.floor(diff / 604800)
    return `${w}w ago`
  }
  const mo = Math.floor(diff / 2592000)
  return `${mo}mo ago`
}

import { fuzzyScore } from '@/lib/fuzzy-search'

const searchFiles = (files: ProjectFile[], query: string, limit: number = 50): ProjectFile[] => {
  const q = query.replace(/^[@./]+/, '').trim()
  if (!q) return files.slice(0, limit)

  const scored: Array<{ file: ProjectFile; score: number }> = []

  for (const file of files) {
    // Score against basename first, then full path
    const nameScore = fuzzyScore(q, file.name)
    const pathScore = fuzzyScore(q, file.path)
    const best = nameScore !== null && pathScore !== null
      ? Math.min(nameScore, pathScore + 50)
      : nameScore ?? (pathScore !== null ? pathScore + 50 : null)

    if (best !== null) {
      scored.push({ file, score: best })
    }
  }

  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, limit).map((s) => s.file)
}

// ── File mention pill (rendered in textarea overlay) ─────────────────
export const FileMentionPill = memo(function FileMentionPill({ path, onRemove }: { path: string; onRemove?: () => void }) {
  const isAgent = path.startsWith('agent:')
  const isSkill = path.startsWith('skill:')
  // Prompts don't have a prefix — they're just the name
  const isPrompt = !isAgent && !isSkill && !path.includes('/') && !path.includes('.')
  const rawName = isAgent || isSkill ? path.split(':').slice(1).join(':') : (path.split('/').pop() ?? path)
  const ext = (!isAgent && !isSkill && !isPrompt && rawName.includes('.')) ? rawName.split('.').pop() ?? '' : ''

  const formatName = (name: string): string =>
    name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const displayName = isAgent ? formatName(rawName) : isSkill ? `skill: ${formatName(rawName)}` : isPrompt ? `@${rawName}` : rawName

  let icon: React.ReactNode
  let pillCls: string
  if (isAgent) {
    const meta = getAgentPillMeta(path)
    const AgentIcon = meta.icon
    icon = <AgentIcon className={cn('size-3.5', meta.color)} />
    pillCls = `${meta.bgCls} text-foreground/90`
  } else if (isSkill) {
    icon = <IconBolt className="size-3.5 text-yellow-600 dark:text-yellow-400" />
    pillCls = 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400'
  } else if (isPrompt) {
    icon = <IconAlignLeft className="size-3.5 text-primary" />
    pillCls = 'bg-primary/15 text-primary'
  } else {
    icon = <FileIcon ext={ext} isDir={false} />
    pillCls = 'bg-accent/60 text-foreground/70'
  }

  return (
    <span className={cn(
      'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium align-middle',
      pillCls,
    )}>
      {icon}
      <span className="max-w-[160px] truncate">{displayName}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 flex size-4 items-center justify-center rounded bg-muted/80 text-foreground/70 hover:bg-destructive/20 hover:text-destructive"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l6 6M7 1l-6 6" />
          </svg>
        </button>
      )}
    </span>
  )
})

// ── Main picker component ────────────────────────────────────────────
interface FileMentionPickerProps {
  query: string
  workspace: string | null
  onSelect: (file: ProjectFile) => void
  onDismiss: () => void
  activeIndex: number
}

export const FileMentionPicker = memo(function FileMentionPicker({
  query, workspace, onSelect, onDismiss, activeIndex,
}: FileMentionPickerProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const [, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(false)
  const filesRef = useRef<ProjectFile[]>([])
  const respectGitignore = useSettingsStore((s) => s.settings.respectGitignore ?? true)
  const agents = useResourceStore((s) => s.config.agents)
  const prompts = useResourceStore((s) => s.config.prompts)

  // Ensure agent config is loaded
  useEffect(() => {
    if (!useResourceStore.getState().loaded) {
      useResourceStore.getState().loadConfig(workspace ?? undefined)
    }
  }, [workspace])

  // Load project files once when workspace changes
  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    setLoading(true)
    ipc.listProjectFiles(workspace, respectGitignore).then((result) => {
      if (cancelled) return
      filesRef.current = result
      setFiles(result)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [workspace, respectGitignore])

  // Build agent items filtered by query — built-in agents first, then .agent agents, then prompts
  const q = (query ?? '').replace(/^[@./]+/, '').trim()
  type AgentItem = { type: 'agent' | 'skill' | 'prompt'; name: string; description?: string; builtinIcon?: typeof IconRobot; builtinColor?: string; builtinBgCls?: string }

  const resourceItems = useMemo((): AgentItem[] => {
    const scored: Array<{ item: AgentItem; score: number }> = []
    for (const b of BUILT_IN_MENTION_AGENTS) {
      if (!q) {
        scored.push({ item: { type: 'agent', name: b.id, description: b.description, builtinIcon: b.icon, builtinColor: b.color, builtinBgCls: b.bgCls }, score: 0 })
      } else {
        const nameScore = fuzzyScore(q, b.name)
        const idScore = fuzzyScore(q, b.id)
        const best = nameScore !== null && idScore !== null ? Math.min(nameScore, idScore) : nameScore ?? idScore
        if (best !== null) {
          scored.push({ item: { type: 'agent', name: b.id, description: b.description, builtinIcon: b.icon, builtinColor: b.color, builtinBgCls: b.bgCls }, score: best })
        }
      }
    }
    for (const a of agents) {
      if (!q) {
        scored.push({ item: { type: 'agent', name: a.name, description: a.description }, score: 0 })
      } else {
        const nameScore = fuzzyScore(q, a.name)
        const descScore = fuzzyScore(q, a.description)
        const best = nameScore !== null && descScore !== null ? Math.min(nameScore, descScore + 50) : nameScore ?? (descScore !== null ? descScore + 50 : null)
        if (best !== null) {
          scored.push({ item: { type: 'agent', name: a.name, description: a.description }, score: best })
        }
      }
    }
    for (const p of prompts) {
      // Cap content search at 500 chars to avoid O(n × content_length) on every keystroke
      const searchableContent = p.content.slice(0, 500)
      if (!q) {
        scored.push({ item: { type: 'prompt', name: p.name, description: p.content.slice(0, 60).replace(/\n/g, ' ') }, score: 0 })
      } else {
        const nameScore = fuzzyScore(q, p.name)
        const contentScore = fuzzyScore(q, searchableContent)
        const best = nameScore !== null && contentScore !== null ? Math.min(nameScore, contentScore + 80) : nameScore ?? (contentScore !== null ? contentScore + 80 : null)
        if (best !== null) {
          scored.push({ item: { type: 'prompt', name: p.name, description: p.content.slice(0, 60).replace(/\n/g, ' ') }, score: best })
        }
      }
    }
    if (q) scored.sort((a, b) => a.score - b.score)
    return scored.map((s) => s.item)
  }, [q, agents, prompts])

  // Update filtered results when query changes
  const filtered = query ? searchFiles(filesRef.current, query) : filesRef.current.slice(0, 50)
  const totalItems = resourceItems.length + filtered.length

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  // Listen for keyboard selection from ChatInput
  useEffect(() => {
    const handler = (e: Event) => {
      const idx = (e as CustomEvent).detail?.index ?? 0
      const normalizedIdx = idx % totalItems
      if (normalizedIdx < resourceItems.length) {
        const item = resourceItems[normalizedIdx]
        const prefix = item.type === 'agent' ? 'agent' : item.type === 'skill' ? 'skill' : 'prompt'
        // Prompts use their name directly (no prefix) — they resolve by name in resolveMentions
        const path = item.type === 'prompt' ? item.name : `${prefix}:${item.name}`
        onSelect({ path, name: item.name, dir: '', isDir: false, ext: '', modifiedAt: 0 })
      } else {
        const file = filtered[(normalizedIdx - resourceItems.length) % filtered.length]
        if (file) onSelect(file)
      }
    }
    document.addEventListener('file-mention-select', handler)
    return () => document.removeEventListener('file-mention-select', handler)
  }, [filtered, resourceItems, totalItems, onSelect])

  if (loading) {
    return (
      <div className="absolute bottom-full left-0 right-0 z-[300] mb-2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl ring-1 ring-black/5 dark:ring-white/5 floating-panel">
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          {t('Loading project files…')}
        </div>
      </div>
    )
  }

  if (totalItems === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 z-[300] mb-2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl ring-1 ring-black/5 dark:ring-white/5 floating-panel">
        <p className="px-3 py-3 text-xs text-muted-foreground">{t('No files found')}</p>
      </div>
    )
  }

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-[300] mb-2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl ring-1 ring-black/5 dark:ring-white/5 floating-panel"
      role="listbox"
      aria-label={t('File mentions')}
    >
      <div className="flex items-center justify-end px-2 pt-1.5">
        <button
          type="button"
          aria-label={t('Close panel')}
          tabIndex={0}
          onMouseDown={(e) => { e.preventDefault(); onDismiss() }}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconX className="size-3.5" />
        </button>
      </div>
      <ul ref={listRef} className="max-h-[280px] overflow-y-auto py-1">
        {resourceItems.map((item, i) => {
          const isActive = i === activeIndex % totalItems
          const formatName = (name: string): string =>
            name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          const ItemIcon = item.builtinIcon ?? (item.type === 'agent' ? IconRobot : item.type === 'skill' ? IconBolt : IconAlignLeft)
          const iconColor = item.builtinColor ?? (item.type === 'agent' ? 'text-primary' : item.type === 'skill' ? 'text-yellow-600 dark:text-yellow-400' : 'text-primary')
          const iconBg = item.builtinBgCls ?? (item.type === 'agent' ? 'bg-primary/20' : item.type === 'skill' ? 'bg-yellow-500/20' : 'bg-primary/20')
          const displayName = item.builtinIcon
            ? BUILT_IN_MENTION_AGENTS.find((b) => b.id === item.name)?.name ?? item.name
            : formatName(item.name)
          // Prompts use their name directly; agents/skills use prefix:name
          const selectPath = item.type === 'prompt' ? item.name : `${item.type}:${item.name}`
          return (
            <li
              key={`${item.type}:${item.name}`}
              role="option"
              aria-selected={isActive}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect({ path: selectPath, name: item.name, dir: '', isDir: false, ext: '', modifiedAt: 0 })
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors',
                isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <span className={cn('flex h-5 w-5 items-center justify-center rounded', iconBg)}>
                <ItemIcon className={cn('size-3', iconColor)} />
              </span>
              <span className="min-w-0 flex-1 flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium">{displayName}</span>
                {item.description && <span className="truncate text-[11px] text-muted-foreground">{item.description.slice(0, 50)}</span>}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{item.type}</span>
            </li>
          )
        })}
        {resourceItems.length > 0 && filtered.length > 0 && (
          <li className="mx-3 my-1 border-t border-border/50" role="separator" />
        )}
        {filtered.map((file, i) => {
          const globalIdx = resourceItems.length + i
          const isActive = globalIdx === activeIndex % totalItems
          return (
            <li
              key={file.path}
              role="option"
              aria-selected={isActive}
              onMouseDown={(e) => { e.preventDefault(); onSelect(file) }}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors',
                isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <FileIcon ext={file.ext} isDir={file.isDir} />
              <span className="min-w-0 flex-1 flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium">{file.name}</span>
              </span>
              {file.modifiedAt > 0 && !file.isDir && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatRelativeTime(file.modifiedAt)}
                </span>
              )}
              {file.dir && (
                <span className="shrink-0 truncate text-[11px] text-muted-foreground max-w-[180px]">
                  {file.dir}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
})
