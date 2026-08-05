import { create } from 'zustand'
import type { KiroConfig, KiroMcpServer } from '@/types'
import { ipc } from '@/lib/ipc'

type McpStatus = KiroMcpServer['status']

const EMPTY_CONFIG: KiroConfig = { agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] }

interface KiroStore {
  /** Per-project config cache keyed by workspace path */
  configs: Record<string, KiroConfig>
  /** Currently active project path */
  activeProject: string | null
  /** Derived config for the active project */
  config: KiroConfig
  loading: boolean
  loaded: boolean
  loadConfig: (projectPath?: string) => Promise<void>
  invalidateConfig: (projectPath: string) => void
  setMcpError: (serverName: string, error: string) => void
  updateMcpServer: (serverName: string, patch: Partial<{ status: McpStatus; error: string; oauthUrl: string }>) => void
  toggleMcpServer: (serverName: string, disabled: boolean) => void
  setMcpDisabledTools: (serverName: string, disabledTools: string[]) => void
}

const patchMcp = (config: KiroConfig, serverName: string, patch: object): KiroConfig => {
  const servers = config.mcpServers ?? []
  const idx = servers.findIndex((m) => m.name.toLowerCase() === serverName.toLowerCase())
  if (idx < 0) return config
  const updated = [...servers]
  updated[idx] = { ...updated[idx], ...patch }
  return { ...config, mcpServers: updated }
}

/** Apply an MCP patch to all cached configs (MCP servers are global) */
const patchAllConfigs = (configs: Record<string, KiroConfig>, serverName: string, patch: object): Record<string, KiroConfig> => {
  const next: Record<string, KiroConfig> = {}
  let changed = false
  for (const [key, cfg] of Object.entries(configs)) {
    const patched = patchMcp(cfg, serverName, patch)
    if (patched !== cfg) changed = true
    next[key] = patched
  }
  return changed ? next : configs
}

const sanitizeConfig = (config: KiroConfig): KiroConfig => ({
  agents: (config.agents ?? []).filter((a) => a.filePath),
  skills: (config.skills ?? []).filter((s) => s.filePath),
  steeringRules: (config.steeringRules ?? []).filter((r) => r.filePath),
  mcpServers: config.mcpServers ?? [],
  prompts: (config.prompts ?? []).filter((p) => p.filePath),
})

export const useKiroStore = create<KiroStore>((set, get) => {
  return {
    configs: {},
    activeProject: null,
    config: EMPTY_CONFIG,
    loading: false,
    loaded: false,

    loadConfig: async (projectPath?: string) => {
      const key = projectPath ?? '__global__'
      // Return cached if available
      const cached = get().configs[key]
      if (cached) {
        if (get().activeProject !== key || get().config !== cached) {
          set({ activeProject: key, config: cached, loaded: true })
        }
        return
      }
      if (get().loading) return
      set({ loading: true, activeProject: key })
      try {
        const raw = await ipc.getKiroConfig(projectPath)
        const safe = sanitizeConfig(raw)
        set((s) => ({
          configs: { ...s.configs, [key]: safe },
          config: safe,
          loaded: true,
        }))
      } catch {
        set({ loaded: true })
      } finally {
        set({ loading: false })
      }
    },

    invalidateConfig: (projectPath) => {
      const key = projectPath ?? '__global__'
      set((s) => {
        const { [key]: _, ...rest } = s.configs
        return { configs: rest }
      })
    },

    setMcpError: (serverName, error) => set((s) => {
      const configs = patchAllConfigs(s.configs, serverName, { error, status: 'error' as const })
      const config = patchMcp(s.config, serverName, { error, status: 'error' as const })
      return { configs, config }
    }),

    updateMcpServer: (serverName, patch) => set((s) => {
      const configs = patchAllConfigs(s.configs, serverName, patch)
      const config = patchMcp(s.config, serverName, patch)
      return { configs, config }
    }),

    toggleMcpServer: (serverName, disabled) => {
      const server = (get().config.mcpServers ?? []).find((m) => m.name === serverName)
      if (!server?.filePath) return
      // Optimistic update
      set((s) => {
        const configs = patchAllConfigs(s.configs, serverName, { enabled: !disabled })
        const config = patchMcp(s.config, serverName, { enabled: !disabled })
        return { configs, config }
      })
      ipc.saveMcpServerConfig(server.filePath, serverName, { disabled }).catch((e) => console.warn('[mcp] toggle failed', e))
    },

    setMcpDisabledTools: (serverName, disabledTools) => {
      const server = (get().config.mcpServers ?? []).find((m) => m.name === serverName)
      if (!server?.filePath) return
      set((s) => {
        const configs = patchAllConfigs(s.configs, serverName, { disabledTools: disabledTools.length ? disabledTools : undefined })
        const config = patchMcp(s.config, serverName, { disabledTools: disabledTools.length ? disabledTools : undefined })
        return { configs, config }
      })
      ipc.saveMcpServerConfig(server.filePath, serverName, { disabledTools }).catch((e) => console.warn('[mcp] disabledTools failed', e))
    },
  }
})

export function initKiroListeners(): () => void {
  const unsub1 = ipc.onMcpConnecting(() => {
    useKiroStore.setState((s) => {
      const mcpPatch = (cfg: KiroConfig): KiroConfig => ({
        ...cfg,
        mcpServers: (cfg.mcpServers ?? []).map((m) =>
          m.enabled ? { ...m, status: 'connecting' as const, error: undefined, oauthUrl: undefined } : m
        ),
      })
      const configs: Record<string, KiroConfig> = {}
      for (const [key, cfg] of Object.entries(s.configs)) {
        configs[key] = mcpPatch(cfg)
      }
      return { configs, config: mcpPatch(s.config) }
    })
  })

  const unsub2 = ipc.onMcpUpdate(({ serverName, status, error, oauthUrl }) => {
    useKiroStore.setState((s) => {
      const patch = {
        status: status as McpStatus,
        ...(error !== undefined ? { error } : {}),
        ...(oauthUrl !== undefined ? { oauthUrl } : {}),
      }
      const configs = patchAllConfigs(s.configs, serverName, patch)
      const config = patchMcp(s.config, serverName, patch)
      return { configs, config }
    })
  })

  // Auto-reload config when .kiro files change on disk
  const unsub3 = ipc.onKiroConfigChanged(({ projectPath }) => {
    const store = useKiroStore.getState()
    // Invalidate the affected cache entry so loadConfig re-fetches
    if (projectPath) {
      store.invalidateConfig(projectPath)
    } else {
      // Global change — invalidate all cached configs
      useKiroStore.setState({ configs: {} })
    }
    // Re-fetch the active project's config
    const activeKey = store.activeProject
    if (activeKey) {
      const path = activeKey === '__global__' ? undefined : activeKey
      store.loadConfig(path)
    }
  })

  return () => { unsub1(); unsub2(); unsub3() }
}
