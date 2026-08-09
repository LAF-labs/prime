import { describe, it, expect, vi, beforeEach } from 'vitest'
import { selectAutoApprove, resolvePermissionMode } from './AutoApproveToggle'
import type { AppSettings, PermissionMode } from '@/types'

vi.mock('@/lib/ipc', () => ({
  ipc: {
    setAutoApprove: vi.fn().mockResolvedValue(undefined),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue({}),
  },
}))

describe('selectAutoApprove', () => {
  it('returns false by default', () => {
    const state = { activeWorkspace: null, settings: { agentBin: '', agentProfiles: [], fontSize: 13 } } as any
    expect(selectAutoApprove(state)).toBe(false)
  })

  it('returns global autoApprove when no workspace', () => {
    const state = { activeWorkspace: null, settings: { agentBin: '', agentProfiles: [], fontSize: 13, autoApprove: true } } as any
    expect(selectAutoApprove(state)).toBe(true)
  })

  it('returns project pref when workspace set', () => {
    const state = {
      activeWorkspace: '/ws',
      settings: { agentBin: '', agentProfiles: [], fontSize: 13, autoApprove: false, projectPrefs: { '/ws': { autoApprove: true } } },
    } as any
    expect(selectAutoApprove(state)).toBe(true)
  })

  it('falls back to global when project pref undefined', () => {
    const state = {
      activeWorkspace: '/ws',
      settings: { agentBin: '', agentProfiles: [], fontSize: 13, autoApprove: true, projectPrefs: { '/ws': {} } },
    } as any
    expect(selectAutoApprove(state)).toBe(true)
  })
})

describe('resolvePermissionMode', () => {
  it('defaults to ask', () => {
    expect(resolvePermissionMode({} as AppSettings, null)).toBe('ask')
  })

  it('migrates from the legacy autoApprove bool', () => {
    expect(resolvePermissionMode({ autoApprove: true } as AppSettings, null)).toBe('auto')
  })

  it('prefers an explicit global mode over the legacy bool', () => {
    expect(resolvePermissionMode({ autoApprove: true, permissionMode: 'acceptEdits' } as AppSettings, null)).toBe('acceptEdits')
  })

  it('prefers a project override over the global mode', () => {
    const settings = { permissionMode: 'ask', projectPrefs: { '/ws': { permissionMode: 'auto' } } } as unknown as AppSettings
    expect(resolvePermissionMode(settings, '/ws')).toBe('auto')
    expect(resolvePermissionMode(settings, '/other')).toBe('ask')
  })
})

describe('mode selection persists and drives live auto-approve', () => {
  let ipcMock: { setAutoApprove: ReturnType<typeof vi.fn<(taskId: string, value: boolean) => Promise<void>>> }

  beforeEach(async () => {
    vi.resetAllMocks()
    const ipcModule = await import('@/lib/ipc')
    ipcMock = ipcModule.ipc as any
    ipcMock.setAutoApprove = vi.fn().mockResolvedValue(undefined)
  })

  /** Mirrors the component's handleSelect logic. */
  const simulateModeSelect = (
    modeId: PermissionMode,
    settingsState: { settings: any; activeWorkspace: string | null; setProjectPref: any; saveSettings: any },
    taskState: { selectedTaskId: string | null; tasks: Record<string, any> },
  ) => {
    const { settings, activeWorkspace, setProjectPref, saveSettings } = settingsState
    const current = resolvePermissionMode(settings, activeWorkspace)
    if (modeId === current) return
    const autoApprove = modeId === 'auto'
    if (activeWorkspace) {
      setProjectPref(activeWorkspace, { permissionMode: modeId, autoApprove })
    } else {
      saveSettings({ ...settings, permissionMode: modeId, autoApprove })
    }
    const { selectedTaskId, tasks } = taskState
    if (!selectedTaskId) return
    const task = tasks[selectedTaskId]
    if (!task) return
    const isLive = task.status === 'running' || task.status === 'pending_permission' || task.status === 'paused'
    if (isLive) ipcMock.setAutoApprove(selectedTaskId, autoApprove)
  }

  it('turns the atomic on when selecting auto for a running task', () => {
    const setProjectPref = vi.fn()
    const saveSettings = vi.fn()
    simulateModeSelect('auto',
      { settings: { permissionMode: 'ask' }, activeWorkspace: null, setProjectPref, saveSettings },
      { selectedTaskId: 'task-1', tasks: { 'task-1': { status: 'running' } } },
    )
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'auto', autoApprove: true }))
    expect(ipcMock.setAutoApprove).toHaveBeenCalledWith('task-1', true)
  })

  it('turns the atomic off when selecting ask for a pending_permission task', () => {
    const setProjectPref = vi.fn()
    const saveSettings = vi.fn()
    simulateModeSelect('ask',
      { settings: { permissionMode: 'auto', autoApprove: true }, activeWorkspace: null, setProjectPref, saveSettings },
      { selectedTaskId: 'task-2', tasks: { 'task-2': { status: 'pending_permission' } } },
    )
    expect(ipcMock.setAutoApprove).toHaveBeenCalledWith('task-2', false)
  })

  it('selecting acceptEdits keeps the atomic off (spawn-time effect)', () => {
    const setProjectPref = vi.fn()
    const saveSettings = vi.fn()
    simulateModeSelect('acceptEdits',
      { settings: { permissionMode: 'ask' }, activeWorkspace: null, setProjectPref, saveSettings },
      { selectedTaskId: 'task-3', tasks: { 'task-3': { status: 'running' } } },
    )
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'acceptEdits', autoApprove: false }))
    expect(ipcMock.setAutoApprove).toHaveBeenCalledWith('task-3', false)
  })

  it('does NOT touch the atomic for a completed task', () => {
    const setProjectPref = vi.fn()
    const saveSettings = vi.fn()
    simulateModeSelect('auto',
      { settings: { permissionMode: 'ask' }, activeWorkspace: null, setProjectPref, saveSettings },
      { selectedTaskId: 'task-4', tasks: { 'task-4': { status: 'completed' } } },
    )
    expect(ipcMock.setAutoApprove).not.toHaveBeenCalled()
  })

  it('does nothing when the mode is unchanged', () => {
    const setProjectPref = vi.fn()
    const saveSettings = vi.fn()
    simulateModeSelect('ask',
      { settings: { permissionMode: 'ask' }, activeWorkspace: null, setProjectPref, saveSettings },
      { selectedTaskId: 'task-5', tasks: { 'task-5': { status: 'running' } } },
    )
    expect(saveSettings).not.toHaveBeenCalled()
    expect(ipcMock.setAutoApprove).not.toHaveBeenCalled()
  })

  it('writes the project pref (mode + synced bool) when a workspace is active', () => {
    const setProjectPref = vi.fn()
    const saveSettings = vi.fn()
    simulateModeSelect('auto',
      {
        settings: { permissionMode: 'ask', projectPrefs: { '/ws': { permissionMode: 'ask' } } },
        activeWorkspace: '/ws',
        setProjectPref,
        saveSettings,
      },
      { selectedTaskId: 'task-6', tasks: { 'task-6': { status: 'running' } } },
    )
    expect(setProjectPref).toHaveBeenCalledWith('/ws', { permissionMode: 'auto', autoApprove: true })
    expect(ipcMock.setAutoApprove).toHaveBeenCalledWith('task-6', true)
  })

  it('does NOT touch the atomic when no task is selected', () => {
    const setProjectPref = vi.fn()
    const saveSettings = vi.fn()
    simulateModeSelect('auto',
      { settings: { permissionMode: 'ask' }, activeWorkspace: null, setProjectPref, saveSettings },
      { selectedTaskId: null, tasks: {} },
    )
    expect(ipcMock.setAutoApprove).not.toHaveBeenCalled()
  })
})
