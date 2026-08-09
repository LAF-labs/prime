import { memo, useState, useCallback } from 'react'
import {
  IconCheck, IconAlertCircle, IconChevronDown, IconLoader2,
  IconSearch, IconRefresh,
} from '@tabler/icons-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useShallow } from 'zustand/react/shallow'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { AppSettings } from '@/types'
import { SectionHeader, SettingsCard, SettingRow, SettingsGrid, Divider } from './settings-shared'
import { EverydayMemoryCard } from './everyday-memory-card'
import { SummonCard } from './summon-card'
import { UpdatesCard } from './updates-card'

interface GeneralSectionProps {
  draft: AppSettings
  updateDraft: (patch: Partial<AppSettings>) => void
}

export const GeneralSection = memo(function GeneralSection({ draft, updateDraft }: GeneralSectionProps) {
  const t = useT()
  // Per-field selection: a whole-store subscription re-renders this memoized
  // section on every settings/model/auth change, defeating the memo().
  const { availableModels, currentModelId, modelsLoading, modelsError, fetchModels, activeWorkspace } = useSettingsStore(
    useShallow((s) => ({
      availableModels: s.availableModels,
      currentModelId: s.currentModelId,
      modelsLoading: s.modelsLoading,
      modelsError: s.modelsError,
      fetchModels: s.fetchModels,
      activeWorkspace: s.activeWorkspace,
    })),
  )
  const [cliStatus, setCliStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [isDetecting, setIsDetecting] = useState(false)

  const handleTestCli = useCallback(async () => {
    setCliStatus('idle')
    try { await ipc.listTasks(); setCliStatus('ok') } catch { setCliStatus('fail') }
  }, [])

  const handleBrowseCli = useCallback(async () => {
    const path = await ipc.pickFolder()
    if (path) updateDraft({ agentBin: path })
  }, [updateDraft])

  const handleAutoDetect = useCallback(async () => {
    setIsDetecting(true)
    try {
      const path = await ipc.detectAgentCli()
      if (path) updateDraft({ agentBin: path })
    } finally { setIsDetecting(false) }
  }, [updateDraft])

  const handleCliPathChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateDraft({ agentBin: e.target.value })
  }, [updateDraft])

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateDraft({ defaultModel: e.target.value || null })
  }, [updateDraft])

  const handleRefreshModels = useCallback(() => {
    fetchModels(draft.agentBin)
  }, [fetchModels, draft.agentBin])

  const handleAutoCompactionChange = useCallback((checked: boolean) => {
    updateDraft({ agentAutoCompaction: checked })
  }, [updateDraft])

  const handleAutoRetryChange = useCallback((checked: boolean) => {
    updateDraft({ agentAutoRetry: checked })
  }, [updateDraft])

  const handleSteeringModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateDraft({ steeringMode: e.target.value === 'all' ? 'all' : 'one-at-a-time' })
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

  const handleSandboxChange = useCallback((checked: boolean) => {
    updateProjectPref('tightSandbox', checked)
  }, [updateProjectPref])

  return (
    <>
      <SectionHeader section="general" />


      <EverydayMemoryCard />

      <SettingsGrid label={t('Connection')} description={t('Where the agent runs from')}>
        <SettingsCard>
          <div className="py-1">
            <div className="flex gap-2">
              <input
                value={draft.agentBin}
                data-testid="settings-cli-path-input"
                onChange={handleCliPathChange}
                placeholder="prime-agent"
                aria-label={t('Path to prime-agent binary')}
                className="flex h-7 w-full flex-1 rounded-md border border-input bg-background/50 px-2.5 font-mono text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleBrowseCli}
                    aria-label={t('Browse for prime-agent binary')}
                    className="shrink-0 rounded-md border border-input px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {t('Browse')}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('Browse filesystem')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleAutoDetect}
                    disabled={isDetecting}
                    aria-label={t('Auto-detect prime-agent path')}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    {isDetecting ? <IconLoader2 className="size-3 animate-spin" /> : <IconSearch className="size-3" />}
                    {t('Detect')}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('Auto-detect from PATH')}</TooltipContent>
              </Tooltip>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleTestCli}
                    aria-label={t('Test the agent connection')}
                    className="rounded-md border border-input px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {t('Test')}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('Check that the agent responds')}</TooltipContent>
              </Tooltip>
              {cliStatus === 'ok' && <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"><IconCheck className="size-3" /> {t('Connected')}</span>}
              {cliStatus === 'fail' && <span className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400"><IconAlertCircle className="size-3" /> {t('Failed')}</span>}
            </div>
          </div>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Model')} description={t('Default AI model for new threads')}>
        <SettingsCard>
          <div className="py-1">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <select
                  value={draft.defaultModel ?? currentModelId ?? ''}
                  onChange={handleModelChange}
                  disabled={modelsLoading || availableModels.length === 0}
                  aria-label={t('Select default AI model')}
                  className={cn(
                    'flex h-7 w-full appearance-none rounded-md border border-input bg-background/50 px-2.5 pr-7 text-xs',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  {availableModels.length === 0 && !modelsLoading && <option value="">{t('No models loaded')}</option>}
                  {modelsLoading && <option value="">{t('Loading…')}</option>}
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
                    aria-label={t('Refresh available models')}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    {modelsLoading ? <IconLoader2 className="size-3 animate-spin" /> : <IconRefresh className="size-3" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('Refresh model list')}</TooltipContent>
              </Tooltip>
            </div>
            {modelsError && <span className="mt-1 flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400"><IconAlertCircle className="size-3" /> {modelsError}</span>}
          </div>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Workspace')} description={t('Sandbox and ignored files')}>
        <SettingsCard>
          <SettingRow label={t('Hide ignored files')} description={t('Keep files your project excludes out of @ mentions')}>
            <Switch checked={draft.respectGitignore ?? true} onCheckedChange={handleRespectGitignoreChange} aria-label={t('Toggle hiding ignored files')} />
          </SettingRow>
          <Divider />
          <SettingRow label={t('Tight sandbox')} description={t('Confine file writes, shell commands, and Python to this project, and keep credentials unreadable. Network access is not restricted.')}>
            <Switch
              checked={draft.projectPrefs?.[activeWorkspace ?? '']?.tightSandbox ?? true}
              onCheckedChange={handleSandboxChange}
              disabled={!activeWorkspace}
              aria-label={t('Toggle tight sandbox')}
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Agent behavior')} description={t('Session-level agent defaults, applied on connect')}>
        <SettingsCard>
          <SettingRow label={t('Auto-compaction')} description={t('Compact the context automatically when it fills up')}>
            <Switch checked={draft.agentAutoCompaction ?? true} onCheckedChange={handleAutoCompactionChange} aria-label={t('Toggle auto-compaction')} />
          </SettingRow>
          <Divider />
          <SettingRow label={t('Auto-retry')} description={t('Retry automatically on transient provider errors')}>
            <Switch checked={draft.agentAutoRetry ?? true} onCheckedChange={handleAutoRetryChange} aria-label={t('Toggle auto-retry')} />
          </SettingRow>
          <Divider />
          <SettingRow label={t('Queued message delivery')} description={t('Deliver queued messages one at a time, or all at once')}>
            <select
              value={draft.steeringMode ?? 'one-at-a-time'}
              onChange={handleSteeringModeChange}
              aria-label={t('Select queued message delivery')}
              className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
            >
              <option value="one-at-a-time">{t('One at a time')}</option>
              <option value="all">{t('All at once')}</option>
            </select>
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Notifications')} description={t('Background alerts and sounds')}>
        <SettingsCard>
          <SettingRow label={t('Desktop notifications')} description={t('Notify when agent finishes or needs approval')}>
            <Switch checked={draft.notifications ?? true} onCheckedChange={handleNotificationsChange} aria-label={t('Toggle desktop notifications')} />
          </SettingRow>
          <Divider />
          <SettingRow label={t('Notification sound')} description={t('Play a chime on notification')}>
            <Switch
              checked={draft.soundNotifications ?? true}
              onCheckedChange={handleSoundChange}
              disabled={!(draft.notifications ?? true)}
              aria-label={t('Toggle notification sound')}
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Menu bar')} description={t('Reach the app without a window open')}>
        <SettingsCard>
          <SummonCard draft={draft} updateDraft={updateDraft} />
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Updates')} description={t('Check for new versions')}>
        <SettingsCard>
          <UpdatesCard />
        </SettingsCard>
      </SettingsGrid>
    </>
  )
})
