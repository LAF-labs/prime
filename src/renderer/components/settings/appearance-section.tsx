import { t } from '@/lib/i18n'
import { memo, useCallback } from 'react'
import { IconUpload, IconRotate } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AppSettings, ThemeMode } from '@/types'
import { ipc } from '@/lib/ipc'
import { Switch } from '@/components/ui/switch'
import {
  SectionHeader, SettingBlock, SettingRow, SettingsSection, SegmentedOption, SETTINGS_BUTTON_CLASS,
} from './settings-shared'
import ThemeSelector from './ThemeSelector'
import defaultAppIcon from '../../../../src-tauri/icons/prod/icon.png'

const MAX_ICON_BYTES = 2 * 1024 * 1024

interface AppearanceSectionProps {
  draft: AppSettings
  updateDraft: (patch: Partial<AppSettings>) => void
}

export const AppearanceSection = memo(function AppearanceSection({ draft, updateDraft }: AppearanceSectionProps) {
  const hasCustomIcon = !!draft.customAppIcon

  const handleUploadIcon = useCallback(async () => {
    try {
      const filePath = await ipc.pickImage()
      if (!filePath) return
      const base64 = await ipc.readFileBase64(filePath)
      if (!base64) return
      if (Math.ceil(base64.length * 3 / 4) > MAX_ICON_BYTES) return
      const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
      updateDraft({ customAppIcon: `data:${mime};base64,${base64}` })
    } catch { /* best-effort */ }
  }, [updateDraft])

  const handleResetIcon = useCallback(() => {
    updateDraft({ customAppIcon: null })
  }, [updateDraft])

  const handleThemeChange = useCallback((mode: ThemeMode) => {
    updateDraft({ theme: mode })
  }, [updateDraft])

  const handleSidebarPositionChange = useCallback((pos: 'left' | 'right') => {
    updateDraft({ sidebarPosition: pos })
  }, [updateDraft])

  const handleLanguageChange = useCallback((language: 'system' | 'en' | 'ko') => {
    updateDraft({ language })
  }, [updateDraft])

  const handleInlineToolCallsChange = useCallback((checked: boolean) => {
    updateDraft({ inlineToolCalls: checked })
  }, [updateDraft])

  const displayIcon = hasCustomIcon ? draft.customAppIcon! : defaultAppIcon

  return (
    <>
      <SectionHeader section="appearance" />

      {/* ── Look & feel ─────────────────────────────────────── */}
      <SettingsSection title={t('Look & feel')} description={t('Theme, icon, and color scheme')}>
        {/* App icon */}
        <SettingBlock className="flex items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3.5">
            <img
              src={displayIcon}
              alt={t('App icon')}
              className="size-11 shrink-0 rounded-xl border border-border object-cover"
              draggable={false}
            />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground">{t('App icon')}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {hasCustomIcon ? t('Custom icon') : t('Default LAF Agent icon')} · {t('About dialog & dock')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {hasCustomIcon && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleResetIcon}
                    aria-label={t('Reset to default app icon')}
                    className={cn(SETTINGS_BUTTON_CLASS, 'border-transparent text-muted-foreground hover:text-foreground')}
                  >
                    <IconRotate className="size-3.5" aria-hidden />
                    {t('Reset')}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('Reset to default icon')}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleUploadIcon}
                  aria-label={t('Upload custom app icon')}
                  className={SETTINGS_BUTTON_CLASS}
                >
                  <IconUpload className="size-3.5" aria-hidden />
                  {t('Change')}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('Upload custom icon (max 2 MB)')}</TooltipContent>
            </Tooltip>
          </div>
        </SettingBlock>

        {/* Theme */}
        <SettingRow stacked label={t('Theme')} description={t('Dark, light, or match the system')}>
          <ThemeSelector
            value={draft.theme ?? 'dark'}
            onChange={handleThemeChange}
          />
        </SettingRow>
      </SettingsSection>

      {/* ── Display ─────────────────────────────────────────── */}
      <SettingsSection title={t('Display')} description={t('Language and layout')}>
        {/* Language */}
        <SettingRow label={t('Language')} description={t("App display language — 'System' follows the OS")}>
          <div className="flex gap-1.5">
            {([['system', t('System')], ['en', t('English')], ['ko', t('한국어')]] as const).map(([value, label]) => (
              <SegmentedOption
                key={value}
                active={(draft.language ?? 'system') === value}
                onClick={() => handleLanguageChange(value)}
              >
                {label}
              </SegmentedOption>
            ))}
          </div>
        </SettingRow>

        {/* Sidebar position */}
        <SettingRow label={t('Sidebar position')} description={t('Place the sidebar on the left or right')}>
          <div className="flex gap-1.5">
            {(['left', 'right'] as const).map((pos) => (
              <SegmentedOption
                key={pos}
                active={(draft.sidebarPosition ?? 'left') === pos}
                onClick={() => handleSidebarPositionChange(pos)}
                ariaLabel={pos === 'left' ? t('Sidebar on left') : t('Sidebar on right')}
              >
                {pos === 'left' ? t('Left') : t('Right')}
              </SegmentedOption>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      {/* ── Chat layout ─────────────────────────────────────── */}
      <SettingsSection title={t('Chat layout')} description={t('How tool activity appears in threads')}>
        <SettingRow
          label={t('Inline tool calls')}
          description={t("Show each tool entry between paragraphs at the moment the agent ran it. When off, tool activity collapses into a single card after the assistant's reply.")}
        >
          <Switch
            checked={draft.inlineToolCalls !== false}
            onCheckedChange={handleInlineToolCallsChange}
            aria-label={t('Toggle inline tool calls')}
          />
        </SettingRow>
      </SettingsSection>
    </>
  )
})
