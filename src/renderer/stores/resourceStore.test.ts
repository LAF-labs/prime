import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ipc', () => ({
  ipc: {
    getAgentResources: vi.fn().mockResolvedValue({ agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] }),
    saveMcpServerConfig: vi.fn().mockResolvedValue(undefined),
    onAgentResourcesChanged: vi.fn().mockReturnValue(() => {}),
  },
}))

import { useResourceStore, initResourceListeners } from './resourceStore'
import { ipc } from '@/lib/ipc'

const makeMcpServers = () => [
  { name: 'Slack', enabled: true, transport: 'stdio' as const, command: 'slack-mcp', filePath: '/p', source: 'local' as const },
  { name: 'GitHub', enabled: true, transport: 'http' as const, url: 'https://gh.mcp', filePath: '/p2', source: 'global' as const },
  { name: 'Disabled', enabled: false, transport: 'stdio' as const, command: 'x', filePath: '/p3', source: 'local' as const },
]

beforeEach(() => {
  vi.clearAllMocks()
  useResourceStore.setState({
    configs: {},
    activeProject: null,
    config: { agents: [], skills: [], steeringRules: [], mcpServers: makeMcpServers(), prompts: [] },
    loading: false,
    loaded: true,
  })
})

describe('resourceStore', () => {
  describe('loadConfig', () => {
    it('loads config from IPC and caches it', async () => {
      vi.mocked(ipc.getAgentResources).mockResolvedValue({
        agents: [{ name: 'Agent1', description: 'desc', tools: [], source: 'local', filePath: '/a' }],
        skills: [],
        steeringRules: [],
        mcpServers: [],
      } as never)
      useResourceStore.setState({ loaded: false, configs: {} })
      await useResourceStore.getState().loadConfig('/project')
      expect(ipc.getAgentResources).toHaveBeenCalledWith('/project')
      expect(useResourceStore.getState().config.agents).toHaveLength(1)
      expect(useResourceStore.getState().loaded).toBe(true)
      expect(useResourceStore.getState().configs['/project']).toBeDefined()
    })

    it('returns cached config without IPC call', async () => {
      const cachedConfig = {
        agents: [{ name: 'Cached', description: '', tools: [] as string[], source: 'local' as const, filePath: '/c' }],
        skills: [],
        steeringRules: [],
        mcpServers: [],
        prompts: [],
      }
      useResourceStore.setState({ configs: { '/project-a': cachedConfig } })
      await useResourceStore.getState().loadConfig('/project-a')
      expect(ipc.getAgentResources).not.toHaveBeenCalled()
      expect(useResourceStore.getState().config.agents[0].name).toBe('Cached')
      expect(useResourceStore.getState().activeProject).toBe('/project-a')
    })

    it('caches separate configs per project', async () => {
      const configA = { agents: [{ name: 'A', description: '', tools: [] as string[], source: 'local' as const, filePath: '/a' }], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      const configB = { agents: [{ name: 'B', description: '', tools: [] as string[], source: 'local' as const, filePath: '/b' }], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      vi.mocked(ipc.getAgentResources)
        .mockResolvedValueOnce(configA as never)
        .mockResolvedValueOnce(configB as never)
      useResourceStore.setState({ configs: {} })
      await useResourceStore.getState().loadConfig('/project-a')
      await useResourceStore.getState().loadConfig('/project-b')
      expect(ipc.getAgentResources).toHaveBeenCalledTimes(2)
      // Switch back to A — should use cache
      await useResourceStore.getState().loadConfig('/project-a')
      expect(ipc.getAgentResources).toHaveBeenCalledTimes(2) // no extra call
      expect(useResourceStore.getState().config.agents[0].name).toBe('A')
    })

    it('filters out agents without filePath', async () => {
      vi.mocked(ipc.getAgentResources).mockResolvedValue({
        agents: [
          { name: 'Good', description: '', tools: [], source: 'local', filePath: '/a' },
          { name: 'Bad', description: '', tools: [], source: 'local', filePath: '' },
        ],
        skills: [],
        steeringRules: [],
        mcpServers: [],
      } as never)
      useResourceStore.setState({ configs: {} })
      await useResourceStore.getState().loadConfig()
      expect(useResourceStore.getState().config.agents).toHaveLength(1)
      expect(useResourceStore.getState().config.agents[0].name).toBe('Good')
    })

    it('sets loaded on error', async () => {
      vi.mocked(ipc.getAgentResources).mockRejectedValue(new Error('fail'))
      useResourceStore.setState({ loaded: false, configs: {} })
      await useResourceStore.getState().loadConfig()
      expect(useResourceStore.getState().loaded).toBe(true)
    })

    it('prevents concurrent loads', async () => {
      useResourceStore.setState({ loading: true })
      await useResourceStore.getState().loadConfig()
      expect(ipc.getAgentResources).not.toHaveBeenCalled()
    })

    it('sets loading false after completion', async () => {
      useResourceStore.setState({ configs: {} })
      await useResourceStore.getState().loadConfig()
      expect(useResourceStore.getState().loading).toBe(false)
    })
  })

  describe('invalidateConfig', () => {
    it('removes cached config for a project', async () => {
      const config = { agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      useResourceStore.setState({ configs: { '/project': config } })
      useResourceStore.getState().invalidateConfig('/project')
      expect(useResourceStore.getState().configs['/project']).toBeUndefined()
    })

    it('forces reload on next loadConfig', async () => {
      const config = { agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      useResourceStore.setState({ configs: { '/project': config } })
      useResourceStore.getState().invalidateConfig('/project')
      await useResourceStore.getState().loadConfig('/project')
      expect(ipc.getAgentResources).toHaveBeenCalledWith('/project')
    })
  })

  describe('setMcpError', () => {
    it('patches matching server in active config and all caches', () => {
      const config = { agents: [], skills: [], steeringRules: [], mcpServers: makeMcpServers(), prompts: [] }
      useResourceStore.setState({ configs: { '/p': config }, config })
      useResourceStore.getState().setMcpError('Slack', 'OAuth failed')
      const slack = useResourceStore.getState().config.mcpServers?.find((s) => s.name === 'Slack')
      expect(slack?.error).toBe('OAuth failed')
      expect(slack?.status).toBe('error')
      const cachedSlack = useResourceStore.getState().configs['/p']?.mcpServers?.find((s) => s.name === 'Slack')
      expect(cachedSlack?.error).toBe('OAuth failed')
    })

    it('is case-insensitive', () => {
      useResourceStore.getState().setMcpError('slack', 'broken')
      const slack = useResourceStore.getState().config.mcpServers?.find((s) => s.name === 'Slack')
      expect(slack?.error).toBe('broken')
    })

    it('no-ops for unknown server', () => {
      const before = useResourceStore.getState().config.mcpServers
      useResourceStore.getState().setMcpError('Unknown', 'err')
      expect(useResourceStore.getState().config.mcpServers).toEqual(before)
    })
  })

  describe('updateMcpServer', () => {
    it('patches matching server', () => {
      useResourceStore.getState().updateMcpServer('GitHub', { status: 'ready' })
      const gh = useResourceStore.getState().config.mcpServers?.find((s) => s.name === 'GitHub')
      expect(gh?.status).toBe('ready')
    })

    it('patches with oauthUrl', () => {
      useResourceStore.getState().updateMcpServer('GitHub', { oauthUrl: 'https://auth.example.com' })
      const gh = useResourceStore.getState().config.mcpServers?.find((s) => s.name === 'GitHub')
      expect(gh?.oauthUrl).toBe('https://auth.example.com')
    })
  })

  describe('initResourceListeners', () => {
    it('loadConfig sets loaded true even when IPC throws', async () => {
      vi.mocked(ipc.getAgentResources).mockRejectedValue(new Error('network error'))
      useResourceStore.setState({ loaded: false, configs: {} })
      await useResourceStore.getState().loadConfig('/broken')
      expect(useResourceStore.getState().loaded).toBe(true)
      expect(useResourceStore.getState().loading).toBe(false)
      // Config should remain the default empty config, not corrupted
      expect(useResourceStore.getState().config).toEqual({ agents: [], skills: [], steeringRules: [], mcpServers: makeMcpServers(), prompts: [] })
    })

    it('loadConfig does not cache failed loads', async () => {
      vi.mocked(ipc.getAgentResources).mockRejectedValue(new Error('fail'))
      useResourceStore.setState({ configs: {} })
      await useResourceStore.getState().loadConfig('/broken')
      expect(useResourceStore.getState().configs['/broken']).toBeUndefined()
      // Retry should call IPC again
      vi.mocked(ipc.getAgentResources).mockResolvedValue({ agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] } as never)
      await useResourceStore.getState().loadConfig('/broken')
      expect(ipc.getAgentResources).toHaveBeenCalledTimes(2)
    })

    it('loadConfig handles null/undefined fields in response', async () => {
      vi.mocked(ipc.getAgentResources).mockResolvedValue({
        agents: null,
        skills: undefined,
        steeringRules: null,
        mcpServers: undefined,
      } as never)
      useResourceStore.setState({ configs: {} })
      await useResourceStore.getState().loadConfig('/project')
      const config = useResourceStore.getState().config
      expect(config.agents).toEqual([])
      expect(config.skills).toEqual([])
      expect(config.steeringRules).toEqual([])
      expect(config.mcpServers).toEqual([])
    })

    it('invalidateConfig on non-existent key is a no-op', () => {
      useResourceStore.setState({ configs: { '/a': { agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] } } })
      useResourceStore.getState().invalidateConfig('/nonexistent')
      // /a should still be there
      expect(useResourceStore.getState().configs['/a']).toBeDefined()
    })

    it('loadConfig with undefined projectPath uses __global__ key', async () => {
      vi.mocked(ipc.getAgentResources).mockResolvedValue({ agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] } as never)
      useResourceStore.setState({ configs: {} })
      await useResourceStore.getState().loadConfig(undefined)
      expect(useResourceStore.getState().configs['__global__']).toBeDefined()
      expect(useResourceStore.getState().activeProject).toBe('__global__')
    })

    it('setMcpError with empty configs record does not throw', () => {
      useResourceStore.setState({ configs: {} })
      expect(() => useResourceStore.getState().setMcpError('Slack', 'err')).not.toThrow()
    })

    it('updateMcpServer with empty configs record does not throw', () => {
      useResourceStore.setState({ configs: {} })
      expect(() => useResourceStore.getState().updateMcpServer('Slack', { status: 'ready' })).not.toThrow()
    })

    it('switching projects updates activeProject and config atomically', async () => {
      const configA = { agents: [{ name: 'A', description: '', tools: [] as string[], source: 'local' as const, filePath: '/a' }], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      const configB = { agents: [{ name: 'B', description: '', tools: [] as string[], source: 'local' as const, filePath: '/b' }], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      useResourceStore.setState({ configs: { '/a': configA, '/b': configB } })
      await useResourceStore.getState().loadConfig('/a')
      expect(useResourceStore.getState().activeProject).toBe('/a')
      expect(useResourceStore.getState().config.agents[0].name).toBe('A')
      await useResourceStore.getState().loadConfig('/b')
      expect(useResourceStore.getState().activeProject).toBe('/b')
      expect(useResourceStore.getState().config.agents[0].name).toBe('B')
    })
  })
})
