import { memo, useCallback, useMemo, useState } from 'react'
import { IconCode, IconListCheck, IconRobot } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { fuzzyScore } from '@/lib/fuzzy-search'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import { useKiroStore } from '@/stores/kiroStore'
import { usePanelResolvedTaskId } from './PanelContext'
import { ipc } from '@/lib/ipc'
import { PanelShell } from './PanelShell'

const STATUS_DOT: Record<string, { cls: string; label: string }> = {
  running:    { cls: 'bg-emerald-400', label: 'running' },
  loading:    { cls: 'bg-amber-400 animate-pulse', label: 'loading' },
  error:      { cls: 'bg-red-400', label: 'error' },
  'needs-auth': { cls: 'bg-red-400', label: 'needs auth' },
}

const BUILT_IN_AGENTS = [
  { id: 'kiro_default', name: 'Default', description: 'Code, edit, and execute', icon: IconCode, color: 'text-blue-600 dark:text-blue-400' },
  { id: 'kiro_planner', name: 'Planner', description: 'Plan before coding', icon: IconListCheck, color: 'text-teal-600 dark:text-teal-400' },
] as const

export const AgentPanel = memo(function AgentPanel({ onDismiss }: { onDismiss: () => void }) {
  const servers = useSettingsStore((s) => s.liveMcpServers)
  const resolvedTaskId = usePanelResolvedTaskId()
  const globalModeId = useSettingsStore((s) => s.currentModeId)
  const taskModeId = useTaskStore((s) => resolvedTaskId ? s.taskModes[resolvedTaskId] ?? null : null)
  const currentModeId = taskModeId ?? globalModeId
  const kiroAgents = useKiroStore((s) => s.config.agents)
  const [query, setQuery] = useState('')

  const handleSelectAgent = useCallback((agentId: string) => {
    // No-op if already on this agent — avoids duplicate welcome messages
    if (agentId === currentModeId) { onDismiss(); return }
    useSettingsStore.setState({ currentModeId: agentId })
    const taskId = resolvedTaskId
    if (taskId) {
      useTaskStore.getState().setTaskMode(taskId, agentId)
      ipc.setMode(taskId, agentId).catch(() => {})
      ipc.sendMessage(taskId, `/agent ${agentId}`).catch(() => {})

      // Show welcomeMessage for custom .kiro agents
      const kiroAgent = useKiroStore.getState().config.agents.find((a) => a.name === agentId)
      if (kiroAgent?.welcomeMessage) {
        const { tasks, upsertTask } = useTaskStore.getState()
        const task = tasks[taskId]
        if (task) {
          upsertTask({
            ...task,
            messages: [
              ...task.messages,
              {
                role: 'system',
                content: `🤖 **${kiroAgent.name}**: ${kiroAgent.welcomeMessage}`,
                timestamp: new Date().toISOString(),
              },
            ],
          })
        }
      }
    }
    onDismiss()
  }, [onDismiss, resolvedTaskId])

  const formatName = (name: string): string => name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const q = query.trim()
  const totalItems = BUILT_IN_AGENTS.length + kiroAgents.length + servers.length
  const hasSearch = totalItems > 5

  const filteredBuiltIn = useMemo(() => {
    if (!q) return [...BUILT_IN_AGENTS]
    return BUILT_IN_AGENTS
      .map((a) => {
        const nameScore = fuzzyScore(q, a.name)
        const descScore = fuzzyScore(q, a.description)
        const best = nameScore !== null && descScore !== null ? Math.min(nameScore, descScore + 50) : nameScore ?? (descScore !== null ? descScore + 50 : null)
        return { agent: a, score: best }
      })
      .filter((r): r is { agent: typeof BUILT_IN_AGENTS[number]; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.agent)
  }, [q])

  const filteredKiro = useMemo(() => {
    if (!q) return kiroAgents
    return kiroAgents
      .map((a) => {
        const nameScore = fuzzyScore(q, a.name)
        const descScore = fuzzyScore(q, a.description)
        const best = nameScore !== null && descScore !== null ? Math.min(nameScore, descScore + 50) : nameScore ?? (descScore !== null ? descScore + 50 : null)
        return { agent: a, score: best }
      })
      .filter((r): r is { agent: typeof kiroAgents[number]; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.agent)
  }, [q, kiroAgents])

  const filteredServers = useMemo(() => {
    if (!q) return servers
    return servers
      .map((s) => ({ server: s, score: fuzzyScore(q, s.name) }))
      .filter((r): r is { server: typeof servers[number]; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.server)
  }, [q, servers])

  return (
    <PanelShell onDismiss={onDismiss}>
      {hasSearch && (
        <div className="px-3 pb-1">
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents & servers…" autoFocus className="w-full rounded-md border border-border/40 bg-background/50 px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-border/80" />
        </div>
      )}
      {filteredBuiltIn.length > 0 && (
        <>
          <div className="px-3 pt-2 pb-1"><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Agents</span></div>
          <ul className="pb-1">
            {filteredBuiltIn.map((agent) => {
              const isActive = currentModeId === agent.id
              const Icon = agent.icon
              return (
                <li key={agent.id} role="option" aria-selected={isActive} onMouseDown={(e) => { e.preventDefault(); handleSelectAgent(agent.id) }} className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors', isActive ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
                  <Icon className={cn('size-3.5 shrink-0', isActive ? agent.color : 'text-muted-foreground')} />
                  <span className={cn('flex-1', isActive && 'font-medium')}>{agent.name}</span>
                  <span className="text-[10px] text-muted-foreground">{agent.description}</span>
                  {isActive && <span className="text-[10px] text-primary">active</span>}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {filteredKiro.length > 0 && (
        <>
          <div className="mx-3 border-t border-border/40" />
          <div className="px-3 pt-2 pb-1"><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">.kiro Agents</span></div>
          <ul className="max-h-[160px] overflow-y-auto pb-1">
            {filteredKiro.map((agent) => {
              const isActive = currentModeId === agent.name
              return (
                <li key={`${agent.source}-${agent.name}`} role="option" aria-selected={isActive} onMouseDown={(e) => { e.preventDefault(); handleSelectAgent(agent.name) }} className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors', isActive ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
                  <IconRobot className={cn('size-3.5 shrink-0', isActive ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground')} />
                  <span className={cn('flex-1 truncate', isActive && 'font-medium')}>{formatName(agent.name)}</span>
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{agent.description.slice(0, 60)}</span>
                  {isActive && <span className="shrink-0 text-[10px] text-primary">active</span>}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {filteredServers.length > 0 && (
        <>
          <div className="mx-3 border-t border-border/40" />
          <div className="px-3 pt-2 pb-1"><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">MCP Servers</span></div>
          <div className="max-h-[160px] overflow-y-auto pb-1">
            {filteredServers.map((server) => {
              const dot = STATUS_DOT[server.status] ?? STATUS_DOT.loading
              return (
                <div key={server.name} className="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-muted-foreground">
                  <span className={cn('size-1.5 shrink-0 rounded-full', dot.cls)} />
                  <span className="flex-1 truncate text-foreground/90">{server.name}</span>
                  <span className="text-[10px] text-muted-foreground">{dot.label}</span>
                  <span className="text-[10px] text-muted-foreground/70">{server.toolCount > 0 ? `${server.toolCount} tools` : '—'}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
      {filteredBuiltIn.length === 0 && filteredKiro.length === 0 && filteredServers.length === 0 && q && (
        <p className="px-3 py-3 text-xs text-muted-foreground/70">No matches for "{q}"</p>
      )}
    </PanelShell>
  )
})
