import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ipc', () => ({
  ipc: {
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    listModels: vi.fn().mockResolvedValue({ availableModels: [{ modelId: 'm1', name: 'Model 1' }], currentModelId: 'm1' }),
    authStatus: vi.fn().mockResolvedValue({ accountType: 'anthropic', email: 'test@test.com' }),
    authLogout: vi.fn().mockResolvedValue(undefined),
  },
}))


vi.mock('@/lib/history-store', () => ({
  loadBackup: vi.fn().mockResolvedValue({ threads: [], projects: [], softDeleted: [] }),
}))

import { useSettingsStore, buildRestoredDefaults } from './settingsStore'
import { ipc } from '@/lib/ipc'
import type { AppSettings } from '@/types'

const defaultState = {
  settings: { agentBin: 'prime-agent', agentProfiles: [], sidebarPosition: 'left' as const },
  isLoaded: false,
  availableModels: [],
  currentModelId: null,
  modelsLoading: false,
  modelsError: null,
  availableModes: [],
  currentModeId: null,
  activeWorkspace: null,
  operationalWorkspace: null,
  availableCommands: [],
  liveMcpServers: [],
  agentAuth: null,
  authChecked: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsStore.setState(defaultState)
})

describe('settingsStore', () => {
  describe('loadSettings', () => {
    it('loads settings from IPC and merges with defaults', async () => {
      vi.mocked(ipc.getSettings).mockResolvedValue({ theme: 'light' } as never)
      await useSettingsStore.getState().loadSettings()
      expect(useSettingsStore.getState().settings.theme).toBe('light')
      expect(useSettingsStore.getState().settings.agentBin).toBe('prime-agent')
      expect(useSettingsStore.getState().isLoaded).toBe(true)
    })

    it('sets isLoaded even on error', async () => {
      vi.mocked(ipc.getSettings).mockRejectedValue(new Error('fail'))
      await useSettingsStore.getState().loadSettings()
      expect(useSettingsStore.getState().isLoaded).toBe(true)
    })

    it('restores settings from backup when they look like defaults', async () => {
      vi.mocked(ipc.getSettings).mockResolvedValue({ hasOnboardedV2: false } as never)
      const { loadBackup } = await import('@/lib/history-store')
      vi.mocked(loadBackup).mockResolvedValueOnce({
        threads: [], projects: [], softDeleted: [],
        settings: { agentBin: 'prime-agent', agentProfiles: [], hasOnboardedV2: true, theme: 'light',
          projectPrefs: { '/ws': { iconOverride: { type: 'emoji', emoji: '🚀' } } } } as never,
      })
      await useSettingsStore.getState().loadSettings()
      expect(useSettingsStore.getState().settings.theme).toBe('light')
      expect(useSettingsStore.getState().settings.hasOnboardedV2).toBe(true)
      expect(useSettingsStore.getState().settings.projectPrefs?.['/ws']?.iconOverride).toEqual({ type: 'emoji', emoji: '🚀' })
      expect(ipc.saveSettings).toHaveBeenCalled()
    })

    it('does not restore from backup when user has already onboarded', async () => {
      vi.mocked(ipc.getSettings).mockResolvedValue({ hasOnboardedV2: true, theme: 'dark' } as never)
      const { loadBackup } = await import('@/lib/history-store')
      vi.mocked(loadBackup).mockResolvedValueOnce({
        threads: [], projects: [], softDeleted: [],
        settings: { theme: 'light', hasOnboardedV2: true } as never,
      })
      await useSettingsStore.getState().loadSettings()
      expect(useSettingsStore.getState().settings.theme).toBe('dark')
      expect(ipc.saveSettings).not.toHaveBeenCalled()
    })
  })

  describe('saveSettings', () => {
    it('saves settings via IPC and updates state', async () => {
      const newSettings = { ...defaultState.settings, theme: 'light' as const }
      await useSettingsStore.getState().saveSettings(newSettings)
      expect(ipc.saveSettings).toHaveBeenCalledWith(newSettings)
      expect(useSettingsStore.getState().settings.theme).toBe('light')
    })
  })

  describe('fetchModels', () => {
    it('fetches models and sets state', async () => {
      await useSettingsStore.getState().fetchModels()
      expect(useSettingsStore.getState().availableModels).toHaveLength(1)
      expect(useSettingsStore.getState().currentModelId).toBe('m1')
      expect(useSettingsStore.getState().modelsLoading).toBe(false)
    })

    it('sets error on failure', async () => {
      vi.mocked(ipc.listModels).mockRejectedValue(new Error('network error'))
      await useSettingsStore.getState().fetchModels()
      expect(useSettingsStore.getState().modelsError).toBe('network error')
      expect(useSettingsStore.getState().modelsLoading).toBe(false)
    })

    it('sets generic error for non-Error throws', async () => {
      vi.mocked(ipc.listModels).mockRejectedValue('string error')
      await useSettingsStore.getState().fetchModels()
      expect(useSettingsStore.getState().modelsError).toBe('Failed to fetch models')
    })
  })

  describe('setActiveWorkspace', () => {
    it('sets workspace', () => {
      useSettingsStore.getState().setActiveWorkspace('/ws')
      expect(useSettingsStore.getState().activeWorkspace).toBe('/ws')
    })

    it('clears workspace when null', () => {
      useSettingsStore.getState().setActiveWorkspace('/ws')
      useSettingsStore.getState().setActiveWorkspace(null)
      expect(useSettingsStore.getState().activeWorkspace).toBeNull()
    })

    it('applies project model pref', () => {
      useSettingsStore.setState({
        settings: {
          ...defaultState.settings,
          projectPrefs: { '/ws': { modelId: 'claude-4' } },
        },
      })
      useSettingsStore.getState().setActiveWorkspace('/ws')
      expect(useSettingsStore.getState().currentModelId).toBe('claude-4')
    })

    it('bails out when workspace and model unchanged', () => {
      useSettingsStore.setState({ activeWorkspace: '/ws', currentModelId: 'claude-4' })
      useSettingsStore.setState({
        settings: {
          ...defaultState.settings,
          projectPrefs: { '/ws': { modelId: 'claude-4' } },
        },
      })
      // Should not throw or cause issues
      useSettingsStore.getState().setActiveWorkspace('/ws')
      expect(useSettingsStore.getState().activeWorkspace).toBe('/ws')
    })

    it('clears the workspace when passed null', () => {
      useSettingsStore.getState().setActiveWorkspace('/project')
      useSettingsStore.getState().setActiveWorkspace(null)
      expect(useSettingsStore.getState().activeWorkspace).toBeNull()
    })

    it('bails out when workspace and model are both unchanged', () => {
      useSettingsStore.setState({ activeWorkspace: '/project', currentModelId: null })
      const stateBefore = useSettingsStore.getState()
      useSettingsStore.getState().setActiveWorkspace('/project')
      // State reference should be the same (no unnecessary re-render)
      expect(useSettingsStore.getState().activeWorkspace).toBe(stateBefore.activeWorkspace)
    })
  })

  describe('setProjectPref', () => {
    it('updates project prefs and model', () => {
      useSettingsStore.getState().setActiveWorkspace('/ws')
      useSettingsStore.getState().setProjectPref('/ws', { modelId: 'gpt-5', autoApprove: true })
      const prefs = useSettingsStore.getState().settings.projectPrefs?.['/ws']
      expect(prefs?.modelId).toBe('gpt-5')
      expect(prefs?.autoApprove).toBe(true)
      expect(useSettingsStore.getState().currentModelId).toBe('gpt-5')
    })

    it('merges with existing prefs', () => {
      useSettingsStore.setState({
        settings: {
          ...defaultState.settings,
          projectPrefs: { '/ws': { modelId: 'old', autoApprove: false } },
        },
      })
      useSettingsStore.getState().setProjectPref('/ws', { autoApprove: true })
      const prefs = useSettingsStore.getState().settings.projectPrefs?.['/ws']
      expect(prefs?.modelId).toBe('old')
      expect(prefs?.autoApprove).toBe(true)
    })
  })

  describe('permission model', () => {
    it('migrates a legacy autoApprove=true install to permissionMode auto on load', async () => {
      vi.mocked(ipc.getSettings).mockResolvedValue({ autoApprove: true, hasOnboardedV2: true } as never)
      await useSettingsStore.getState().loadSettings()
      const s = useSettingsStore.getState().settings
      expect(s.permissionMode).toBe('auto')
      expect(s.autoApprove).toBe(true)
    })

    it('migrates a legacy autoApprove=false install to permissionMode ask on load', async () => {
      vi.mocked(ipc.getSettings).mockResolvedValue({ autoApprove: false, hasOnboardedV2: true } as never)
      await useSettingsStore.getState().loadSettings()
      const s = useSettingsStore.getState().settings
      expect(s.permissionMode).toBe('ask')
      expect(s.autoApprove).toBe(false)
    })

    it('keeps an explicit mode and re-syncs the bool on load', async () => {
      vi.mocked(ipc.getSettings).mockResolvedValue({ permissionMode: 'acceptEdits', autoApprove: true, hasOnboardedV2: true } as never)
      await useSettingsStore.getState().loadSettings()
      const s = useSettingsStore.getState().settings
      expect(s.permissionMode).toBe('acceptEdits')
      // autoApprove is derived from the mode, so acceptEdits pins it false.
      expect(s.autoApprove).toBe(false)
    })

    it('addPermissionRule persists a global rule and de-duplicates', () => {
      useSettingsStore.getState().addPermissionRule({ tool: 'bash', argPattern: 'git *' })
      useSettingsStore.getState().addPermissionRule({ tool: 'bash', argPattern: 'git *' })
      const rules = useSettingsStore.getState().settings.permissionRules
      expect(rules).toEqual([{ tool: 'bash', argPattern: 'git *' }])
      expect(ipc.saveSettings).toHaveBeenCalled()
    })

    it('addPermissionRule with a workspace stores a per-project rule', () => {
      useSettingsStore.getState().addPermissionRule({ tool: 'read' }, '/ws')
      const prefs = useSettingsStore.getState().settings.projectPrefs?.['/ws']
      expect(prefs?.permissionRules).toEqual([{ tool: 'read' }])
    })
  })

  describe('checkAuth', () => {
    it('sets auth state on success', async () => {
      await useSettingsStore.getState().checkAuth()
      expect(useSettingsStore.getState().agentAuth).toEqual({
        email: 'test@test.com',
        accountType: 'anthropic',
      })
      expect(useSettingsStore.getState().authChecked).toBe(true)
    })

    it('clears auth when whoami returns no accountType', async () => {
      vi.mocked(ipc.authStatus).mockResolvedValue({} as never)
      await useSettingsStore.getState().checkAuth()
      expect(useSettingsStore.getState().agentAuth).toBeNull()
      expect(useSettingsStore.getState().authChecked).toBe(true)
    })

    it('clears auth on error', async () => {
      vi.mocked(ipc.authStatus).mockRejectedValue(new Error('fail'))
      await useSettingsStore.getState().checkAuth()
      expect(useSettingsStore.getState().agentAuth).toBeNull()
      expect(useSettingsStore.getState().authChecked).toBe(true)
    })
  })

  describe('logout', () => {
    it('calls IPC logout and clears auth', async () => {
      useSettingsStore.setState({ agentAuth: { email: 'a@b.com', accountType: 'pro' } })
      await useSettingsStore.getState().logout()
      expect(ipc.authLogout).toHaveBeenCalled()
      expect(useSettingsStore.getState().agentAuth).toBeNull()
    })

    it('clears auth even when IPC fails', async () => {
      vi.mocked(ipc.authLogout).mockRejectedValue(new Error('fail'))
      useSettingsStore.setState({ agentAuth: { email: 'a@b.com', accountType: 'pro' } })
      await useSettingsStore.getState().logout()
      expect(useSettingsStore.getState().agentAuth).toBeNull()
    })
  })

  describe('openLogin', () => {
    it('refreshes state if already logged in', async () => {
      vi.mocked(ipc.authStatus).mockResolvedValue({ accountType: 'pro', email: 'a@b.com' } as never)
      await useSettingsStore.getState().openLogin()
      expect(useSettingsStore.getState().agentAuth?.accountType).toBe('pro')
      const { useTaskStore } = await import('./taskStore')
      expect(useTaskStore.getState().isSettingsOpen).toBe(false)
    })

    it('opens Settings on the Providers section when not logged in — never a terminal', async () => {
      vi.mocked(ipc.authStatus).mockRejectedValue(new Error('not logged in'))
      await useSettingsStore.getState().openLogin()
      // A DMG-only install has no `prime-agent` on PATH, so the old terminal
      // path died with "command not found" — sign-in must go to Providers.
      const { useTaskStore } = await import('./taskStore')
      expect(useTaskStore.getState().isSettingsOpen).toBe(true)
      expect(useTaskStore.getState().settingsInitialSection).toBe('account')
    })
  })

  describe('buildRestoredDefaults', () => {
    const current: AppSettings = {
      agentBin: '/custom/bin/prime-agent',
      agentProfiles: [],
      sidebarPosition: 'right',
      inlineToolCalls: false,
      autoApprove: true,
      hasOnboardedV2: true,
      theme: 'light',
      language: 'ko',
      projectPrefs: { '/ws': { modelId: 'claude-4' } },
      customAppIcon: 'data:image/png;base64,abc',
      lastSeenChangelogVersion: '1.2.3',
    }

    it('resets user-tunable fields to the real store defaults', () => {
      const restored = buildRestoredDefaults(current)
      expect(restored.agentBin).toBe('prime-agent')
      expect(restored.sidebarPosition).toBe('left')
      expect(restored.inlineToolCalls).toBe(true)
      expect(restored.autoApprove).toBeUndefined()
    })

    it('never wipes onboarding state, theme, language, project prefs, or the custom icon', () => {
      const restored = buildRestoredDefaults(current)
      // Losing hasOnboardedV2 drops the user back into the first-run wizard.
      expect(restored.hasOnboardedV2).toBe(true)
      expect(restored.theme).toBe('light')
      expect(restored.language).toBe('ko')
      expect(restored.projectPrefs).toEqual({ '/ws': { modelId: 'claude-4' } })
      expect(restored.customAppIcon).toBe('data:image/png;base64,abc')
      expect(restored.lastSeenChangelogVersion).toBe('1.2.3')
    })
  })
})
