import { create } from 'zustand'
import type { AppSettings, PermissionRule, ProjectPrefs } from '@/types'
import { ipc } from '@/lib/ipc'
import { t } from '@/lib/i18n'
import { attempt } from '@/lib/ipc-report'
import { addRule, derivePermissionMode, isValidPermissionMode, permissionModeToAutoApprove } from '@/lib/permission-rules'

/**
 * Migrate + reconcile the permission model on load: derive `permissionMode`
 * from the legacy `autoApprove` bool when unset, and keep `autoApprove` in
 * sync with the mode ('auto' ⟺ true) so the many call sites still reading the
 * boolean keep working.
 */
const withPermissionDefaults = (settings: AppSettings): AppSettings => {
  const mode = isValidPermissionMode(settings.permissionMode)
    ? settings.permissionMode
    : derivePermissionMode(settings.autoApprove)
  return { ...settings, permissionMode: mode, autoApprove: permissionModeToAutoApprove(mode) }
}



export interface ModelOption {
  modelId: string
  name: string
  description?: string | null
}

export interface ModeOption {
  id: string
  name: string
  description?: string | null
}

export interface SlashCommand {
  name: string
  description?: string
  inputType?: string
}

export interface LiveMcpServer {
  name: string
  status: string
  toolCount: number
}

interface SettingsStore {
  settings: AppSettings
  isLoaded: boolean
  availableModels: ModelOption[]
  currentModelId: string | null
  modelsLoading: boolean
  modelsError: string | null
  availableModes: ModeOption[]
  currentModeId: string | null
  activeWorkspace: string | null
  /** Actual working directory for operations (worktree path when in a worktree thread, project root otherwise). */
  operationalWorkspace: string | null
  availableCommands: SlashCommand[]
  liveMcpServers: LiveMcpServer[]
  agentAuth: { email: string | null; accountType: string } | null
  authChecked: boolean
  loadSettings: () => Promise<void>
  saveSettings: (settings: AppSettings) => Promise<void>
  fetchModels: (agentBin?: string) => Promise<void>
  setActiveWorkspace: (workspace: string | null, operationalWs?: string | null) => void
  setProjectPref: (workspace: string, patch: Partial<ProjectPrefs>) => void
  /**
   * Persist a permission allow-rule (deduped). With no workspace it becomes a
   * global rule; with one it is stored on that project's prefs. Rules apply to
   * newly-started threads (the gate reads them at spawn).
   */
  addPermissionRule: (rule: PermissionRule, workspace?: string | null) => void
  checkAuth: () => Promise<void>
  logout: () => Promise<void>
  openLogin: () => void
}

const defaultSettings: AppSettings = {
  agentBin: 'prime-agent',
  agentProfiles: [],
  sidebarPosition: 'left',
  // Default to true — new users get inline tool calls by default.
  // Existing users who never explicitly set this will also get the new default.
  // The toggle checks `!== false` so only an explicit `false` disables it.
  inlineToolCalls: true,
}

/**
 * Reset the user-tunable settings to their defaults while preserving state
 * that "Restore defaults" must never wipe: onboarding completion (or the app
 * falls back into the first-run wizard), theme, language, per-project prefs,
 * the custom app icon, and the changelog cursor. This is the ONLY sanctioned
 * way to build a "defaults" object — a plain `defaultSettings` copy silently
 * drops those fields because `saveSettings` writes wholesale.
 */
export const buildRestoredDefaults = (current: AppSettings): AppSettings => ({
  ...defaultSettings,
  hasOnboardedV2: current.hasOnboardedV2,
  theme: current.theme,
  language: current.language,
  projectPrefs: current.projectPrefs,
  customAppIcon: current.customAppIcon,
  lastSeenChangelogVersion: current.lastSeenChangelogVersion,
})

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: defaultSettings,
  isLoaded: false,
  availableModels: [],
  currentModelId: null,
  modelsLoading: false,
  modelsError: null,
  availableModes: [],
  currentModeId: null,
  activeWorkspace: null,
  operationalWorkspace: null,
  agentAuth: null,
  authChecked: false,
  availableCommands: [],
  liveMcpServers: [],

  loadSettings: async () => {
    try {
      const settings = await ipc.getSettings()
      const merged = { ...defaultSettings, ...settings }
      // If settings look like defaults (user was onboarded but confy lost data),
      // restore from backup to recover projectPrefs, iconOverrides, etc.
      if (!merged.hasOnboardedV2) {
        try {
          const { loadBackup } = await import('@/lib/history-store')
          const backup = await loadBackup()
          if (backup.settings?.hasOnboardedV2) {
            const restored = withPermissionDefaults({ ...merged, ...backup.settings })
            // Seed transient currentModelId from the persisted default so the
            // picker shows the right value before any session_init lands.
            const seedModel = restored.defaultModel ?? null
            set({ settings: restored, isLoaded: true, currentModelId: seedModel })
            attempt(t('Could not save settings'), ipc.saveSettings(restored))
            return
          }
        } catch { /* backup load is best-effort */ }
      }
      const normalized = withPermissionDefaults(merged)
      const seedModel = normalized.defaultModel ?? null
      set({ settings: normalized, isLoaded: true, currentModelId: seedModel })
    } catch {
      set({ isLoaded: true })
    }
  },

  saveSettings: async (settings) => {
    await ipc.saveSettings(settings)
    set({ settings })
  },

  fetchModels: async (agentBin?: string) => {
    set({ modelsLoading: true, modelsError: null })
    try {
      const result = await ipc.listModels(agentBin)
      set({
        availableModels: result.availableModels,
        currentModelId: result.currentModelId,
        modelsLoading: false,
      })
    } catch (err) {
      set({
        modelsLoading: false,
        modelsError: err instanceof Error ? err.message : 'Failed to fetch models',
      })
    }
  },

  setActiveWorkspace: (workspace, operationalWs) => {
    const { settings, currentModelId } = get()
    if (!workspace) { set({ activeWorkspace: null, operationalWorkspace: null }); return }
    const prefs = settings.projectPrefs?.[workspace]
    // Resolution order: project pref → existing currentModelId → global default.
    // Falling back to defaultModel keeps the picker stable when a user opens a
    // project that has no per-project pref yet.
    const fallback = currentModelId ?? settings.defaultModel ?? null
    const newModelId = prefs?.modelId !== undefined ? prefs.modelId : fallback
    const opWs = operationalWs ?? workspace
    // Only update if something actually changed
    const current = get()
    if (current.activeWorkspace === workspace && current.currentModelId === newModelId && current.operationalWorkspace === opWs) return
    set({ activeWorkspace: workspace, operationalWorkspace: opWs, currentModelId: newModelId ?? null })
  },

  setProjectPref: (workspace, patch) => {
    const { settings } = get()
    const existing = settings.projectPrefs?.[workspace] ?? {}
    const updated: AppSettings = {
      ...settings,
      projectPrefs: {
        ...settings.projectPrefs,
        [workspace]: { ...existing, ...patch },
      },
    }
    // Single set() to avoid two render cycles
    set({
      settings: updated,
      ...(patch.modelId !== undefined ? { currentModelId: patch.modelId } : {}),
    })
    // The optimistic set() above already shows the change applied; if the
    // write fails silently, the setting reverts on next launch with no
    // explanation. Tell the user now instead.
    attempt(t('Could not save settings'), ipc.saveSettings(updated))
  },

  addPermissionRule: (rule, workspace) => {
    const { settings } = get()
    let updated: AppSettings
    if (workspace) {
      const existing = settings.projectPrefs?.[workspace] ?? {}
      const rules = addRule(existing.permissionRules ?? [], rule)
      updated = {
        ...settings,
        projectPrefs: { ...settings.projectPrefs, [workspace]: { ...existing, permissionRules: rules } },
      }
    } else {
      updated = { ...settings, permissionRules: addRule(settings.permissionRules ?? [], rule) }
    }
    set({ settings: updated })
    attempt(t('Could not save settings'), ipc.saveSettings(updated))
  },

  checkAuth: async () => {
    try {
      const { settings } = get()
      const result = await ipc.authStatus(settings.agentBin)
      if (result.accountType) {
        set({
          agentAuth: {
            email: result.email ?? null,
            accountType: result.accountType,
          },
          authChecked: true,
        })
      } else {
        set({ agentAuth: null, authChecked: true })
      }
    } catch (err) {
      console.warn('[auth] checkAuth failed:', err)
      set({ agentAuth: null, authChecked: true })
    }
  },

  logout: async () => {
    try {
      const { settings } = get()
      await ipc.authLogout(settings.agentBin)
    } catch { /* ignore */ }
    set({ agentAuth: null })
  },

  openLogin: async () => {
    const { settings } = get()
    // If already logged in, just refresh state instead of opening settings
    try {
      const result = await ipc.authStatus(settings.agentBin)
      if (result.accountType) {
        set({
          agentAuth: {
            email: result.email ?? null,
            accountType: result.accountType,
          },
          authChecked: true,
        })
        return
      }
    } catch {
      /* fall through to the settings panel */
    }
    // Sign-in happens by adding a provider key in Settings → Providers. The
    // old path opened a Terminal running `${agentBin} login`, which on a
    // DMG-only install (bundled sidecar, nothing on PATH) died with
    // "command not found" — never do that to an everyday user.
    const { useTaskStore } = await import('@/stores/taskStore')
    useTaskStore.getState().setSettingsOpen(true, 'account')
  },
}))

