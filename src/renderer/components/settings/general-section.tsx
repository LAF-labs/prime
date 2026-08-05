import { memo, useState, useCallback } from 'react'
import {
  IconCheck, IconAlertCircle, IconChevronDown, IconLoader2,
  IconSearch, IconRefresh,
} from '@tabler/icons-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import type { AppSettings } from '@/types'
import { SectionHeader, SettingsCard, SettingRow, SettingsGrid, Divider } from './settings-shared'
import { UpdatesCard } from './updates-card'

interface GeneralSectionProps {
  draft: AppSettings
  updateDraft: (patch: Partial<AppSettings>) => void
}

export const GeneralSection = memo(function GeneralSection({ draft, updateDraft }: GeneralSectionProps) {
  const { availableModels, currentModelId, modelsLoading, modelsError, fetchModels, activeWorkspace } = useSettingsStore()
  const [cliStatus, setCliStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [isDetecting, setIsDetecting] = useState(false)

  const handleTestCli = useCallback(async () => {
    setCliStatus('idle')
    try { await ipc.listTasks(); setCliStatus('ok') } catch { setCliStatus('fail') }
  }, [])

  const handleBrowseCli = useCallback(async () => {
    const path = await ipc.pickFolder()
    if (path) updateDraft({ kiroBin: path })
  }, [updateDraft])

  const handleAutoDetect = useCallback(async () => {
    setIsDetecting(true)
    try {
      const path = await ipc.detectKiroCli()
      if (path) updateDraft({ kiroBin: path })
    } finally { setIsDetecting(false) }
  }, [updateDraft])

  const handleCliPathChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateDraft({ kiroBin: e.target.value })
  }, [updateDraft])

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateDraft({ defaultModel: e.target.value || null })
  }, [updateDraft])

  const handleRefreshModels = useCallback(() => {
    fetchModels(draft.kiroBin)
  }, [fetchModels, draft.kiroBin])

  const handleAutoApproveChange = useCallback((checked: boolean) => {
    updateDraft({ autoApprove: checked })
  }, [updateDraft])

  const handleRespectGitignoreChange = useCallback((checked: boolean) => {
    updateDraft({ respectGitignore: checked })
  }, [updateDraft])

  const handleNotificationsChange = useCallback((checked: boolean) => {
    updateDraft({ notifications: checked })
  }, [updateDraft])

  const handleSoundChange = useCallback((checked: boolean) => {
    updateDraft({ soundNotifications: checked })
  }, [updateDraft])

  const updateProjectPref = useCallback((key: string, value: boolean) => {
    if (!activeWorkspace) return
    const prefs = draft.projectPrefs ?? {}
    const existing = prefs[activeWorkspace] ?? {}
    updateDraft({ projectPrefs: { ...prefs, [activeWorkspace]: { ...existing, [key]: value } } })
  }, [activeWorkspace, draft.projectPrefs, updateDraft])

  const handleWorktreeChange = useCallback((checked: boolean) => {
    updateProjectPref('worktreeEnabled', checked)
  }, [updateProjectPref])

  const handleSandboxChange = useCallback((checked: boolean) => {
    updateProjectPref('tightSandbox', checked)
  }, [updateProjectPref])

  return (
    <>
      <SectionHeader section="general" />

      <SettingsGrid label="Connection" description="Path to the kiro-cli binary">
        <SettingsCard>
          <div className="py-1">
            <div className="flex gap-2">
              <input
                value={draft.kiroBin}
                data-testid="settings-cli-path-input"
                onChange={handleCliPathChange}
                placeholder="kiro-cli"
                aria-label="Path to kiro-cli binary"
                className="flex h-7 w-full flex-1 rounded-md border border-input bg-background/50 px-2.5 font-mono text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleBrowseCli}
                    aria-label="Browse for kiro-cli binary"
                    className="shrink-0 rounded-md border border-input px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Browse
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Browse filesystem</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleAutoDetect}
                    disabled={isDetecting}
                    aria-label="Auto-detect kiro-cli path"
                    className="flex shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    {isDetecting ? <IconLoader2 className="size-3 animate-spin" /> : <IconSearch className="size-3" />}
                    Detect
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Auto-detect from PATH</TooltipContent>
              </Tooltip>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleTestCli}
                    aria-label="Test CLI connection"
                    className="rounded-md border border-input px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Test
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Test connection to kiro-cli</TooltipContent>
              </Tooltip>
              {cliStatus === 'ok' && <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"><IconCheck className="size-3" /> Connected</span>}
              {cliStatus === 'fail' && <span className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400"><IconAlertCircle className="size-3" /> Failed</span>}
            </div>
          </div>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label="Model" description="Default AI model for new threads">
        <SettingsCard>
          <div className="py-1">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <select
                  value={draft.defaultModel ?? currentModelId ?? ''}
                  onChange={handleModelChange}
                  disabled={modelsLoading || availableModels.length === 0}
                  aria-label="Select default AI model"
                  className={cn(
                    'flex h-7 w-full appearance-none rounded-md border border-input bg-background/50 px-2.5 pr-7 text-xs',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  {availableModels.length === 0 && !modelsLoading && <option value="">No models loaded</option>}
                  {modelsLoading && <option value="">Loading…</option>}
                  {availableModels.map((m) => <option key={m.modelId} value={m.modelId}>{m.name}</option>)}
                </select>
                <IconChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/70" />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleRefreshModels}
                    disabled={modelsLoading}
                    aria-label="Refresh available models"
                    className="flex shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    {modelsLoading ? <IconLoader2 className="size-3 animate-spin" /> : <IconRefresh className="size-3" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Refresh model list</TooltipContent>
              </Tooltip>
            </div>
            {modelsError && <span className="mt-1 flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400"><IconAlertCircle className="size-3" /> {modelsError}</span>}
          </div>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label="Workspace" description="Permissions, worktrees, and sandbox">
        <SettingsCard>
          <SettingRow label="Auto-approve" description="Skip permission prompts for tool calls">
            <Switch checked={draft.autoApprove ?? false} onCheckedChange={handleAutoApproveChange} aria-label="Toggle auto-approve permissions" />
          </SettingRow>
          <Divider />
          <SettingRow label="Respect .gitignore" description="Hide gitignored files from @ mentions">
            <Switch checked={draft.respectGitignore ?? true} onCheckedChange={handleRespectGitignoreChange} aria-label="Toggle respect gitignore" />
          </SettingRow>
          <Divider />
          <SettingRow label="Use worktrees" description="Isolate threads in .kiro/worktrees/">
            <Switch
              checked={draft.projectPrefs?.[activeWorkspace ?? '']?.worktreeEnabled ?? false}
              onCheckedChange={handleWorktreeChange}
              disabled={!activeWorkspace}
              aria-label="Toggle worktrees for new threads"
            />
          </SettingRow>
          <Divider />
          <SettingRow label="Tight sandbox" description="Restrict agent to project directory">
            <Switch
              checked={draft.projectPrefs?.[activeWorkspace ?? '']?.tightSandbox ?? true}
              onCheckedChange={handleSandboxChange}
              disabled={!activeWorkspace}
              aria-label="Toggle tight sandbox"
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label="Notifications" description="Background alerts and sounds">
        <SettingsCard>
          <SettingRow label="Desktop notifications" description="Notify when agent finishes or needs approval">
            <Switch checked={draft.notifications ?? true} onCheckedChange={handleNotificationsChange} aria-label="Toggle desktop notifications" />
          </SettingRow>
          <Divider />
          <SettingRow label="Notification sound" description="Play a chime on notification">
            <Switch
              checked={draft.soundNotifications ?? true}
              onCheckedChange={handleSoundChange}
              disabled={!(draft.notifications ?? true)}
              aria-label="Toggle notification sound"
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label="Updates" description="Check for new versions">
        <SettingsCard>
          <UpdatesCard />
        </SettingsCard>
      </SettingsGrid>
    </>
  )
})
