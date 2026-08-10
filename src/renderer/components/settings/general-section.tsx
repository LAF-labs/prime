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
import { MAX_DISPLAY_NAME } from '@/components/OnboardingNameStep'
import type { AppSettings } from '@/types'
import {
  SectionHeader, SettingBlock, SettingRow, SettingsSection, SETTINGS_BUTTON_CLASS, SETTINGS_INPUT_CLASS,
} from './settings-shared'
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

  const handleDisplayNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.slice(0, MAX_DISPLAY_NAME)
    // Store undefined for an emptied field so "never set" and "cleared" stay
    // the same state — the sidebar treats both as not-signed-in.
    updateDraft({ displayName: next.trim() ? next : undefined })
  }, [updateDraft])

  const handleSandboxChange = useCallback((checked: boolean) => {
    updateProjectPref('tightSandbox', checked)
  }, [updateProjectPref])

  return (
    <>
      <SectionHeader section="general" />

      <SettingsSection title={t('Account')} description={t('How the app refers to you')}>
        <SettingRow label={t('Display name')} description={t('Shown in the sidebar. Stays on this device.')}>
          <input
            type="text"
            value={draft.displayName ?? ''}
            maxLength={MAX_DISPLAY_NAME}
            onChange={handleDisplayNameChange}
            placeholder={t('Your name or nickname')}
            aria-label={t('Display name')}
            className={cn(SETTINGS_INPUT_CLASS, 'w-48')}
          />
        </SettingRow>
      </SettingsSection>

      <EverydayMemoryCard />

      <SettingsSection title={t('Connection')} description={t('Where the agent runs from')}>
        <SettingBlock>
          <div className="flex gap-2">
            <input
              value={draft.agentBin}
              data-testid="settings-cli-path-input"
              onChange={handleCliPathChange}
              placeholder="lafagent"
              aria-label={t('Path to the agent runtime')}
              className={cn(SETTINGS_INPUT_CLASS, 'min-w-0 flex-1 font-mono text-[12px]')}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleBrowseCli}
                  aria-label={t('Browse for the agent runtime')}
                  className={cn(SETTINGS_BUTTON_CLASS, 'shrink-0')}
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
                  aria-label={t('Auto-detect the agent runtime')}
                  className={cn(SETTINGS_BUTTON_CLASS, 'shrink-0 disabled:pointer-events-none disabled:opacity-50')}
                >
                  {isDetecting ? <IconLoader2 className="size-3.5 animate-spin" aria-hidden /> : <IconSearch className="size-3.5" aria-hidden />}
                  {t('Detect')}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('Auto-detect from PATH')}</TooltipContent>
            </Tooltip>
          </div>
          <div className="mt-2 flex items-center gap-2.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleTestCli}
                  aria-label={t('Test the agent connection')}
                  className={SETTINGS_BUTTON_CLASS}
                >
                  {t('Test')}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('Check that the agent responds')}</TooltipContent>
            </Tooltip>
            {cliStatus === 'ok' && <span className="flex items-center gap-1 text-[12px] text-success-foreground"><IconCheck className="size-3.5" aria-hidden /> {t('Connected')}</span>}
            {cliStatus === 'fail' && <span className="flex items-center gap-1 text-[12px] text-destructive"><IconAlertCircle className="size-3.5" aria-hidden /> {t('Failed')}</span>}
          </div>
        </SettingBlock>
      </SettingsSection>

      <SettingsSection title={t('Model')} description={t('Default AI model for new threads')}>
        <SettingBlock>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <select
                value={draft.defaultModel ?? currentModelId ?? ''}
                onChange={handleModelChange}
                disabled={modelsLoading || availableModels.length === 0}
                aria-label={t('Select default AI model')}
                className={cn(
                  SETTINGS_INPUT_CLASS,
                  'w-full appearance-none pr-8 disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {availableModels.length === 0 && !modelsLoading && <option value="">{t('No models loaded')}</option>}
                {modelsLoading && <option value="">{t('Loading…')}</option>}
                {availableModels.map((m) => <option key={m.modelId} value={m.modelId}>{m.name}</option>)}
              </select>
              <IconChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" aria-hidden />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleRefreshModels}
                  disabled={modelsLoading}
                  aria-label={t('Refresh available models')}
                  className={cn(SETTINGS_BUTTON_CLASS, 'shrink-0 disabled:pointer-events-none disabled:opacity-50')}
                >
                  {modelsLoading ? <IconLoader2 className="size-3.5 animate-spin" aria-hidden /> : <IconRefresh className="size-3.5" aria-hidden />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('Refresh model list')}</TooltipContent>
            </Tooltip>
          </div>
          {modelsError && <span className="mt-2 flex items-center gap-1 text-[12px] text-destructive"><IconAlertCircle className="size-3.5" aria-hidden /> {modelsError}</span>}
        </SettingBlock>
      </SettingsSection>

      <SettingsSection title={t('Workspace')} description={t('Sandbox and ignored files')}>
        <SettingRow label={t('Hide ignored files')} description={t('Keep files your project excludes out of @ mentions')}>
          <Switch checked={draft.respectGitignore ?? true} onCheckedChange={handleRespectGitignoreChange} aria-label={t('Toggle hiding ignored files')} />
        </SettingRow>
        <SettingRow label={t('Tight sandbox')} description={t('Confine file writes, shell commands, and Python to this project, and keep credentials unreadable. Network access is not restricted.')}>
          <Switch
            checked={draft.projectPrefs?.[activeWorkspace ?? '']?.tightSandbox ?? true}
            onCheckedChange={handleSandboxChange}
            disabled={!activeWorkspace}
            aria-label={t('Toggle tight sandbox')}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('Agent behavior')} description={t('Session-level agent defaults, applied on connect')}>
        <SettingRow label={t('Auto-compaction')} description={t('Compact the context automatically when it fills up')}>
          <Switch checked={draft.agentAutoCompaction ?? true} onCheckedChange={handleAutoCompactionChange} aria-label={t('Toggle auto-compaction')} />
        </SettingRow>
        <SettingRow label={t('Auto-retry')} description={t('Retry automatically on transient provider errors')}>
          <Switch checked={draft.agentAutoRetry ?? true} onCheckedChange={handleAutoRetryChange} aria-label={t('Toggle auto-retry')} />
        </SettingRow>
        <SettingRow label={t('Queued message delivery')} description={t('Deliver queued messages one at a time, or all at once')}>
          <select
            value={draft.steeringMode ?? 'one-at-a-time'}
            onChange={handleSteeringModeChange}
            aria-label={t('Select queued message delivery')}
            className={SETTINGS_INPUT_CLASS}
          >
            <option value="one-at-a-time">{t('One at a time')}</option>
            <option value="all">{t('All at once')}</option>
          </select>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('Notifications')} description={t('Background alerts and sounds')}>
        <SettingRow label={t('Desktop notifications')} description={t('Notify when agent finishes or needs approval')}>
          <Switch checked={draft.notifications ?? true} onCheckedChange={handleNotificationsChange} aria-label={t('Toggle desktop notifications')} />
        </SettingRow>
        <SettingRow label={t('Notification sound')} description={t('Play a chime on notification')}>
          <Switch
            checked={draft.soundNotifications ?? true}
            onCheckedChange={handleSoundChange}
            disabled={!(draft.notifications ?? true)}
            aria-label={t('Toggle notification sound')}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('Menu bar')} description={t('Reach the app without a window open')}>
        <SummonCard draft={draft} updateDraft={updateDraft} />
      </SettingsSection>

      <SettingsSection title={t('Updates')} description={t('Check for new versions')}>
        <UpdatesCard />
      </SettingsSection>
    </>
  )
})
