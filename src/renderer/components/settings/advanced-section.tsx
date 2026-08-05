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

  const handleAnalyticsToggle = useCallback((checked: boolean) => {
    updateDraft({ analyticsEnabled: checked })
  }, [updateDraft])

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

  const handleReplayOnboarding = useCallback(async () => {
    const store = useSettingsStore.getState()
    await store.saveSettings({ ...store.settings, hasOnboardedV2: false })
    onClose()
  }, [onClose])

  return (
    <>
      <SectionHeader section="advanced" />

      <SettingsGrid label="Privacy" description="Anonymous usage data">
        <SettingsCard>
          <SettingRow label="Share anonymous usage data" description="Feature usage and app version only. No code or file paths.">
            <Switch
              checked={draft.analyticsEnabled ?? true}
              onCheckedChange={handleAnalyticsToggle}
              aria-label="Toggle anonymous analytics"
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label="Git" description="Commit trailers and reports">
        <SettingsCard>
          <SettingRow label="AI commit messages" description="Show a sparkle button to draft a commit message from the diff">
            <Switch
              checked={draft.aiCommitMessages ?? true}
              onCheckedChange={handleAiCommitToggle}
              aria-label="Toggle AI commit messages"
            />
          </SettingRow>
          <Divider />
          <SettingRow label="Co-authored-by Kirodex" description="Append trailer to every commit">
            <Switch
              checked={draft.coAuthor ?? true}
              onCheckedChange={handleCoAuthorToggle}
              aria-label="Toggle co-author trailer"
            />
          </SettingRow>
          <Divider />
          <SettingRow label="Task completion report" description="Summary card when a task finishes">
            <Switch
              checked={draft.coAuthorJsonReport ?? true}
              onCheckedChange={handleReportToggle}
              aria-label="Toggle task completion report"
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label="Side questions" description="/btw character limit">
        <SettingsCard>
          <SettingRow label="Max question length" description="Character limit for /btw questions">
            <input
              type="number"
              min={BTW_MIN_CHARS}
              max={BTW_MAX_CHARS}
              step={100}
              value={draft.btwMaxChars ?? BTW_DEFAULT_CHARS}
              onChange={handleBtwCharsChange}
              className="w-20 rounded-md border border-input bg-transparent px-2 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              aria-label="Max btw question characters"
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label="Data" description="Clear history and analytics">
        <SettingsCard>
          <SettingRow label="Conversation history" description="Clear all threads without resetting settings">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsConfirmHistoryOpen(true)}
                  aria-label="Clear chat history"
                  className="flex items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <IconTrash className="size-3" />
                  Clear
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Permanently delete all threads</TooltipContent>
            </Tooltip>
          </SettingRow>
          <Divider />
          <SettingRow label="Analytics data" description={`Local stats on disk (${formatBytes(analyticsSize)})`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsConfirmAnalyticsOpen(true)}
                  aria-label="Clear analytics data"
                  className="flex items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <IconChartBar className="size-3" />
                  Clear
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Delete local usage statistics</TooltipContent>
            </Tooltip>
          </SettingRow>
          <Divider />
          <SettingRow label="Replay onboarding" description="Run the setup wizard again">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleReplayOnboarding}
                  aria-label="Replay onboarding wizard"
                  className="flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground"
                >
                  <IconRefresh className="size-3" />
                  Replay
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Run setup wizard again</TooltipContent>
            </Tooltip>
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      <ConfirmDialog
        open={isConfirmHistoryOpen}
        onOpenChange={setIsConfirmHistoryOpen}
        title="Clear conversation history?"
        description="This permanently deletes all conversation threads. Your settings, onboarding state, and preferences are preserved. This action cannot be undone."
        confirmLabel="Clear history"
        onConfirm={handleClearHistory}
      />
      <ConfirmDialog
        open={isConfirmAnalyticsOpen}
        onOpenChange={setIsConfirmAnalyticsOpen}
        title="Clear analytics data?"
        description="This permanently deletes all local usage statistics. This action cannot be undone."
        confirmLabel="Clear analytics"
        onConfirm={handleClearAnalytics}
      />
    </>
  )
})
