import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ipc', () => ({
  ipc: {
    getKiroConfig: vi.fn().mockResolvedValue({ agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] }),
    saveMcpServerConfig: vi.fn().mockResolvedValue(undefined),
    onMcpConnecting: vi.fn().mockReturnValue(() => {}),
    onMcpUpdate: vi.fn().mockReturnValue(() => {}),
    onKiroConfigChanged: vi.fn().mockReturnValue(() => {}),
  },
}))

import { useKiroStore, initKiroListeners } from './kiroStore'
import { ipc } from '@/lib/ipc'

const makeMcpServers = () => [
  { name: 'Slack', enabled: true, transport: 'stdio' as const, command: 'slack-mcp', filePath: '/p', source: 'local' as const },
  { name: 'GitHub', enabled: true, transport: 'http' as const, url: 'https://gh.mcp', filePath: '/p2', source: 'global' as const },
  { name: 'Disabled', enabled: false, transport: 'stdio' as const, command: 'x', filePath: '/p3', source: 'local' as const },
]

beforeEach(() => {
  vi.clearAllMocks()
  useKiroStore.setState({
    configs: {},
    activeProject: null,
    config: { agents: [], skills: [], steeringRules: [], mcpServers: makeMcpServers(), prompts: [] },
    loading: false,
    loaded: true,
  })
})

describe('kiroStore', () => {
  describe('loadConfig', () => {
    it('loads config from IPC and caches it', async () => {
      vi.mocked(ipc.getKiroConfig).mockResolvedValue({
        agents: [{ name: 'Agent1', description: 'desc', tools: [], source: 'local', filePath: '/a' }],
        skills: [],
        steeringRules: [],
        mcpServers: [],
      } as never)
      useKiroStore.setState({ loaded: false, configs: {} })
      await useKiroStore.getState().loadConfig('/project')
      expect(ipc.getKiroConfig).toHaveBeenCalledWith('/project')
      expect(useKiroStore.getState().config.agents).toHaveLength(1)
      expect(useKiroStore.getState().loaded).toBe(true)
      expect(useKiroStore.getState().configs['/project']).toBeDefined()
    })

    it('returns cached config without IPC call', async () => {
      const cachedConfig = {
        agents: [{ name: 'Cached', description: '', tools: [] as string[], source: 'local' as const, filePath: '/c' }],
        skills: [],
        steeringRules: [],
        mcpServers: [],
        prompts: [],
      }
      useKiroStore.setState({ configs: { '/project-a': cachedConfig } })
      await useKiroStore.getState().loadConfig('/project-a')
      expect(ipc.getKiroConfig).not.toHaveBeenCalled()
      expect(useKiroStore.getState().config.agents[0].name).toBe('Cached')
      expect(useKiroStore.getState().activeProject).toBe('/project-a')
    })

    it('caches separate configs per project', async () => {
      const configA = { agents: [{ name: 'A', description: '', tools: [] as string[], source: 'local' as const, filePath: '/a' }], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      const configB = { agents: [{ name: 'B', description: '', tools: [] as string[], source: 'local' as const, filePath: '/b' }], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      vi.mocked(ipc.getKiroConfig)
        .mockResolvedValueOnce(configA as never)
        .mockResolvedValueOnce(configB as never)
      useKiroStore.setState({ configs: {} })
      await useKiroStore.getState().loadConfig('/project-a')
      await useKiroStore.getState().loadConfig('/project-b')
      expect(ipc.getKiroConfig).toHaveBeenCalledTimes(2)
      // Switch back to A — should use cache
      await useKiroStore.getState().loadConfig('/project-a')
      expect(ipc.getKiroConfig).toHaveBeenCalledTimes(2) // no extra call
      expect(useKiroStore.getState().config.agents[0].name).toBe('A')
    })

    it('filters out agents without filePath', async () => {
      vi.mocked(ipc.getKiroConfig).mockResolvedValue({
        agents: [
          { name: 'Good', description: '', tools: [], source: 'local', filePath: '/a' },
          { name: 'Bad', description: '', tools: [], source: 'local', filePath: '' },
        ],
        skills: [],
        steeringRules: [],
        mcpServers: [],
      } as never)
      useKiroStore.setState({ configs: {} })
      await useKiroStore.getState().loadConfig()
      expect(useKiroStore.getState().config.agents).toHaveLength(1)
      expect(useKiroStore.getState().config.agents[0].name).toBe('Good')
    })

    it('sets loaded on error', async () => {
      vi.mocked(ipc.getKiroConfig).mockRejectedValue(new Error('fail'))
      useKiroStore.setState({ loaded: false, configs: {} })
      await useKiroStore.getState().loadConfig()
      expect(useKiroStore.getState().loaded).toBe(true)
    })

    it('prevents concurrent loads', async () => {
      useKiroStore.setState({ loading: true })
      await useKiroStore.getState().loadConfig()
      expect(ipc.getKiroConfig).not.toHaveBeenCalled()
    })

    it('sets loading false after completion', async () => {
      useKiroStore.setState({ configs: {} })
      await useKiroStore.getState().loadConfig()
      expect(useKiroStore.getState().loading).toBe(false)
    })
  })

  describe('invalidateConfig', () => {
    it('removes cached config for a project', async () => {
      const config = { agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      useKiroStore.setState({ configs: { '/project': config } })
      useKiroStore.getState().invalidateConfig('/project')
      expect(useKiroStore.getState().configs['/project']).toBeUndefined()
    })

    it('forces reload on next loadConfig', async () => {
      const config = { agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      useKiroStore.setState({ configs: { '/project': config } })
      useKiroStore.getState().invalidateConfig('/project')
      await useKiroStore.getState().loadConfig('/project')
      expect(ipc.getKiroConfig).toHaveBeenCalledWith('/project')
    })
  })

  describe('setMcpError', () => {
    it('patches matching server in active config and all caches', () => {
      const config = { agents: [], skills: [], steeringRules: [], mcpServers: makeMcpServers(), prompts: [] }
      useKiroStore.setState({ configs: { '/p': config }, config })
      useKiroStore.getState().setMcpError('Slack', 'OAuth failed')
      const slack = useKiroStore.getState().config.mcpServers?.find((s) => s.name === 'Slack')
      expect(slack?.error).toBe('OAuth failed')
      expect(slack?.status).toBe('error')
      const cachedSlack = useKiroStore.getState().configs['/p']?.mcpServers?.find((s) => s.name === 'Slack')
      expect(cachedSlack?.error).toBe('OAuth failed')
    })

    it('is case-insensitive', () => {
      useKiroStore.getState().setMcpError('slack', 'broken')
      const slack = useKiroStore.getState().config.mcpServers?.find((s) => s.name === 'Slack')
      expect(slack?.error).toBe('broken')
    })

    it('no-ops for unknown server', () => {
      const before = useKiroStore.getState().config.mcpServers
      useKiroStore.getState().setMcpError('Unknown', 'err')
      expect(useKiroStore.getState().config.mcpServers).toEqual(before)
    })
  })

  describe('updateMcpServer', () => {
    it('patches matching server', () => {
      useKiroStore.getState().updateMcpServer('GitHub', { status: 'ready' })
      const gh = useKiroStore.getState().config.mcpServers?.find((s) => s.name === 'GitHub')
      expect(gh?.status).toBe('ready')
    })

    it('patches with oauthUrl', () => {
      useKiroStore.getState().updateMcpServer('GitHub', { oauthUrl: 'https://auth.example.com' })
      const gh = useKiroStore.getState().config.mcpServers?.find((s) => s.name === 'GitHub')
      expect(gh?.oauthUrl).toBe('https://auth.example.com')
    })
  })

  describe('initKiroListeners', () => {
    it('registers MCP listeners and returns cleanup', () => {
      const cleanup = initKiroListeners()
      expect(ipc.onMcpConnecting).toHaveBeenCalled()
      expect(ipc.onMcpUpdate).toHaveBeenCalled()
      expect(typeof cleanup).toBe('function')
    })

    it('onMcpConnecting sets enabled servers to connecting in all caches', () => {
      const config = { agents: [], skills: [], steeringRules: [], mcpServers: makeMcpServers(), prompts: [] }
      useKiroStore.setState({ configs: { '/p': config }, config })
      initKiroListeners()
      const cb = vi.mocked(ipc.onMcpConnecting).mock.calls[0][0]
      cb()
      const servers = useKiroStore.getState().config.mcpServers ?? []
      const slack = servers.find((s) => s.name === 'Slack')
      const disabled = servers.find((s) => s.name === 'Disabled')
      expect(slack?.status).toBe('connecting')
      expect(disabled?.status).toBeUndefined()
      // Also check cache
      const cachedSlack = useKiroStore.getState().configs['/p']?.mcpServers?.find((s) => s.name === 'Slack')
      expect(cachedSlack?.status).toBe('connecting')
    })

    it('onMcpUpdate patches specific server in all caches', () => {
      const config = { agents: [], skills: [], steeringRules: [], mcpServers: makeMcpServers(), prompts: [] }
      useKiroStore.setState({ configs: { '/p': config }, config })
      initKiroListeners()
      const cb = vi.mocked(ipc.onMcpUpdate).mock.calls[0][0]
      cb({ serverName: 'Slack', status: 'ready' })
      const slack = useKiroStore.getState().config.mcpServers?.find((s) => s.name === 'Slack')
      expect(slack?.status).toBe('ready')
      const cachedSlack = useKiroStore.getState().configs['/p']?.mcpServers?.find((s) => s.name === 'Slack')
      expect(cachedSlack?.status).toBe('ready')
    })
  })

  describe('error handling and edge cases', () => {
    it('loadConfig sets loaded true even when IPC throws', async () => {
      vi.mocked(ipc.getKiroConfig).mockRejectedValue(new Error('network error'))
      useKiroStore.setState({ loaded: false, configs: {} })
      await useKiroStore.getState().loadConfig('/broken')
      expect(useKiroStore.getState().loaded).toBe(true)
      expect(useKiroStore.getState().loading).toBe(false)
      // Config should remain the default empty config, not corrupted
      expect(useKiroStore.getState().config).toEqual({ agents: [], skills: [], steeringRules: [], mcpServers: makeMcpServers(), prompts: [] })
    })

    it('loadConfig does not cache failed loads', async () => {
      vi.mocked(ipc.getKiroConfig).mockRejectedValue(new Error('fail'))
      useKiroStore.setState({ configs: {} })
      await useKiroStore.getState().loadConfig('/broken')
      expect(useKiroStore.getState().configs['/broken']).toBeUndefined()
      // Retry should call IPC again
      vi.mocked(ipc.getKiroConfig).mockResolvedValue({ agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] } as never)
      await useKiroStore.getState().loadConfig('/broken')
      expect(ipc.getKiroConfig).toHaveBeenCalledTimes(2)
    })

    it('loadConfig handles null/undefined fields in response', async () => {
      vi.mocked(ipc.getKiroConfig).mockResolvedValue({
        agents: null,
        skills: undefined,
        steeringRules: null,
        mcpServers: undefined,
      } as never)
      useKiroStore.setState({ configs: {} })
      await useKiroStore.getState().loadConfig('/project')
      const config = useKiroStore.getState().config
      expect(config.agents).toEqual([])
      expect(config.skills).toEqual([])
      expect(config.steeringRules).toEqual([])
      expect(config.mcpServers).toEqual([])
    })

    it('invalidateConfig on non-existent key is a no-op', () => {
      useKiroStore.setState({ configs: { '/a': { agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] } } })
      useKiroStore.getState().invalidateConfig('/nonexistent')
      // /a should still be there
      expect(useKiroStore.getState().configs['/a']).toBeDefined()
    })

    it('loadConfig with undefined projectPath uses __global__ key', async () => {
      vi.mocked(ipc.getKiroConfig).mockResolvedValue({ agents: [], skills: [], steeringRules: [], mcpServers: [], prompts: [] } as never)
      useKiroStore.setState({ configs: {} })
      await useKiroStore.getState().loadConfig(undefined)
      expect(useKiroStore.getState().configs['__global__']).toBeDefined()
      expect(useKiroStore.getState().activeProject).toBe('__global__')
    })

    it('setMcpError with empty configs record does not throw', () => {
      useKiroStore.setState({ configs: {} })
      expect(() => useKiroStore.getState().setMcpError('Slack', 'err')).not.toThrow()
    })

    it('updateMcpServer with empty configs record does not throw', () => {
      useKiroStore.setState({ configs: {} })
      expect(() => useKiroStore.getState().updateMcpServer('Slack', { status: 'ready' })).not.toThrow()
    })

    it('switching projects updates activeProject and config atomically', async () => {
      const configA = { agents: [{ name: 'A', description: '', tools: [] as string[], source: 'local' as const, filePath: '/a' }], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      const configB = { agents: [{ name: 'B', description: '', tools: [] as string[], source: 'local' as const, filePath: '/b' }], skills: [], steeringRules: [], mcpServers: [], prompts: [] }
      useKiroStore.setState({ configs: { '/a': configA, '/b': configB } })
      await useKiroStore.getState().loadConfig('/a')
      expect(useKiroStore.getState().activeProject).toBe('/a')
      expect(useKiroStore.getState().config.agents[0].name).toBe('A')
      await useKiroStore.getState().loadConfig('/b')
      expect(useKiroStore.getState().activeProject).toBe('/b')
      expect(useKiroStore.getState().config.agents[0].name).toBe('B')
    })
  })
})
