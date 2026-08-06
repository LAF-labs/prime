import { t } from '@/lib/i18n'
import { memo, useState, useEffect, useCallback } from 'react'
import { IconTrash, IconRefresh, IconChartBar } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAnalyticsStore } from '@/stores/analyticsStore'
import { Switch } from '@/components/ui/switch'
import type { AppSettings } from '@/types'
import { SectionHeader, SettingsCard, SettingRow, SettingsGrid, Divider, ConfirmDialog } from './settings-shared'

const BTW_MIN_CHARS = 100
const BTW_MAX_CHARS = 10000
const BTW_DEFAULT_CHARS = 1220

/** 0 is the deliberate opt-out ("no limit"), not an empty value. */
const CONCURRENT_AGENTS_MIN = 0
const CONCURRENT_AGENTS_MAX = 64
/** Mirrors `DEFAULT_MAX_CONCURRENT_AGENTS` in src-tauri/src/commands/settings.rs. */
const CONCURRENT_AGENTS_DEFAULT = 8

const clampConcurrentAgents = (n: number): number =>
  Math.max(CONCURRENT_AGENTS_MIN, Math.min(CONCURRENT_AGENTS_MAX, Math.floor(n)))

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface AdvancedSectionProps {
  draft: AppSettings
  updateDraft: (patch: Partial<AppSettings>) => void
  onClose: () => void
}

export const AdvancedSection = memo(function AdvancedSection({ draft, updateDraft, onClose }: AdvancedSectionProps) {
  const [analyticsSize, setAnalyticsSize] = useState<number>(0)
  const refreshDbSize = useAnalyticsStore((s) => s.refreshDbSize)
  const clearAnalytics = useAnalyticsStore((s) => s.clearData)
  const dbSize = useAnalyticsStore((s) => s.dbSize)
  const [isConfirmHistoryOpen, setIsConfirmHistoryOpen] = useState(false)
  const [isConfirmAnalyticsOpen, setIsConfirmAnalyticsOpen] = useState(false)

  useEffect(() => { refreshDbSize() }, [refreshDbSize])
  useEffect(() => { setAnalyticsSize(dbSize) }, [dbSize])

  const handleClearHistory = useCallback(async () => {
    await useTaskStore.getState().clearHistory()
    onClose()
  }, [onClose])

  const handleClearAnalytics = useCallback(async () => {
    await clearAnalytics()
    refreshDbSize()
  }, [clearAnalytics, refreshDbSize])

  const handleAiCommitToggle = useCallback((checked: boolean) => {
    updateDraft({ aiCommitMessages: checked })
  }, [updateDraft])

  const handleCoAuthorToggle = useCallback((checked: boolean) => {
    updateDraft({ coAuthor: checked })
  }, [updateDraft])

  const handleReportToggle = useCallback((checked: boolean) => {
    updateDraft({ coAuthorJsonReport: checked })
  }, [updateDraft])

  const handleBtwCharsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateDraft({ btwMaxChars: Math.max(BTW_MIN_CHARS, Math.min(BTW_MAX_CHARS, Number(e.target.value) || BTW_DEFAULT_CHARS)) })
  }, [updateDraft])

  const handleMaxConcurrentAgentsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim()
    // An empty field means "unset" — the backend then applies its own default.
    if (raw === '') {
      updateDraft({ maxConcurrentAgents: null })
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    // Clamp rather than fall back on falsiness, so a typed 0 survives as "no limit".
    updateDraft({ maxConcurrentAgents: clampConcurrentAgents(parsed) })
  }, [updateDraft])

  const handleReplayOnboarding = useCallback(async () => {
    const store = useSettingsStore.getState()
    await store.saveSettings({ ...store.settings, hasOnboardedV2: false })
    onClose()
  }, [onClose])

  // `?? default` keeps a stored 0 intact; only null/undefined fall back.
  const concurrentAgents = draft.maxConcurrentAgents ?? CONCURRENT_AGENTS_DEFAULT
  const isConcurrencyUnlimited = concurrentAgents === 0

  return (
    <>
      <SectionHeader section="advanced" />

      <SettingsGrid label={t('Concurrency')} description={t('How many agents may run at once')}>
        <SettingsCard>
          <SettingRow
            label={t('Max concurrent agents')}
            description={
              isConcurrencyUnlimited
                ? t('No limit. Every thread you open starts its own Node process and Python kernel — lift the cap only if your machine can take it.')
                : t('Up to {count} threads run at once. Each one is a Node process with its own Python kernel, so this caps machine load. Set 0 for no limit.', { count: concurrentAgents })
            }
          >
            <input
              type="number"
              min={CONCURRENT_AGENTS_MIN}
              max={CONCURRENT_AGENTS_MAX}
              step={1}
              value={concurrentAgents}
              onChange={handleMaxConcurrentAgentsChange}
              className="w-20 rounded-md border border-input bg-transparent px-2 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              aria-label={t('Maximum agents running at once')}
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Git')} description={t('Commit trailers and reports')}>
        <SettingsCard>
          <SettingRow label={t('AI commit messages')} description={t('Show a sparkle button to draft a commit message from the diff')}>
            <Switch
              checked={draft.aiCommitMessages ?? true}
              onCheckedChange={handleAiCommitToggle}
              aria-label={t('Toggle AI commit messages')}
            />
          </SettingRow>
          <Divider />
          <SettingRow label={t('Co-authored-by LAF Agent')} description={t('Append trailer to every commit')}>
            <Switch
              checked={draft.coAuthor ?? true}
              onCheckedChange={handleCoAuthorToggle}
              aria-label={t('Toggle co-author trailer')}
            />
          </SettingRow>
          <Divider />
          <SettingRow label={t('Task completion report')} description={t('Summary card when a task finishes')}>
            <Switch
              checked={draft.coAuthorJsonReport ?? true}
              onCheckedChange={handleReportToggle}
              aria-label={t('Toggle task completion report')}
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Side questions')} description={t('/btw character limit')}>
        <SettingsCard>
          <SettingRow label={t('Max question length')} description={t('Character limit for /btw questions')}>
            <input
              type="number"
              min={BTW_MIN_CHARS}
              max={BTW_MAX_CHARS}
              step={100}
              value={draft.btwMaxChars ?? BTW_DEFAULT_CHARS}
              onChange={handleBtwCharsChange}
              className="w-20 rounded-md border border-input bg-transparent px-2 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              aria-label={t('Max btw question characters')}
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Data')} description={t('Clear history and analytics')}>
        <SettingsCard>
          <SettingRow label={t('Conversation history')} description={t('Clear all threads without resetting settings')}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsConfirmHistoryOpen(true)}
                  aria-label={t('Clear chat history')}
                  className="flex items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <IconTrash className="size-3" />
                  {t('Clear')}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('Permanently delete all threads')}</TooltipContent>
            </Tooltip>
          </SettingRow>
          <Divider />
          <SettingRow label={t('Analytics data')} description={`Local stats on disk (${formatBytes(analyticsSize)})`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsConfirmAnalyticsOpen(true)}
                  aria-label={t('Clear analytics data')}
                  className="flex items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <IconChartBar className="size-3" />
                  {t('Clear')}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('Delete local usage statistics')}</TooltipContent>
            </Tooltip>
          </SettingRow>
          <Divider />
          <SettingRow label={t('Replay onboarding')} description={t('Run the setup wizard again')}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleReplayOnboarding}
                  aria-label={t('Replay onboarding wizard')}
                  className="flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground"
                >
                  <IconRefresh className="size-3" />
                  {t('Replay')}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('Run setup wizard again')}</TooltipContent>
            </Tooltip>
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <ConfirmDialog
        open={isConfirmHistoryOpen}
        onOpenChange={setIsConfirmHistoryOpen}
        title={t('Clear conversation history?')}
        description={t('This permanently deletes all conversation threads. Your settings, onboarding state, and preferences are preserved. This action cannot be undone.')}
        confirmLabel="Clear history"
        onConfirm={handleClearHistory}
      />
      <ConfirmDialog
        open={isConfirmAnalyticsOpen}
        onOpenChange={setIsConfirmAnalyticsOpen}
        title={t('Clear analytics data?')}
        description={t('This permanently deletes all local usage statistics. This action cannot be undone.')}
        confirmLabel="Clear analytics"
        onConfirm={handleClearAnalytics}
      />
    </>
  )
})
