import { t } from '@/lib/i18n'
import { memo, useCallback } from 'react'
import { IconUpload, IconRotate } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AppSettings, ThemeMode } from '@/types'
import { ipc } from '@/lib/ipc'
import { Switch } from '@/components/ui/switch'
import { SectionHeader, SettingsCard, SettingRow, SettingsGrid, Divider } from './settings-shared'
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
      <SettingsGrid label={t('Look & feel')} description={t('Theme, icon, and color scheme')}>
        <SettingsCard>
          {/* App icon row */}
          <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="flex items-center gap-3.5">
              <img
                src={displayIcon}
                alt={t('App icon')}
                className="size-12 rounded-xl border border-border/60 bg-background/50 object-cover shadow-sm"
                draggable={false}
              />
              <div>
                <p className="text-[12.5px] font-medium text-foreground">{t('App icon')}</p>
                <p className="text-[11px] text-muted-foreground">
                  {hasCustomIcon ? t('Custom icon') : t('Default LAF Agent icon')} · {t('About dialog & dock')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {hasCustomIcon && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleResetIcon}
                      aria-label={t('Reset to default app icon')}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <IconRotate className="size-3" />
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
                    className="flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <IconUpload className="size-3" />
                    {t('Change')}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('Upload custom icon (max 2 MB)')}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <Divider />

          {/* Theme row */}
          <div className="py-3">
            <p className="mb-2 text-[12.5px] font-medium text-foreground">{t('Theme')}</p>
            <ThemeSelector
              value={draft.theme ?? 'dark'}
              onChange={handleThemeChange}
            />
          </div>
        </SettingsCard>
      </SettingsGrid>

      {/* ── Display ─────────────────────────────────────────── */}
      <SettingsGrid label={t('Display')} description={t('Language and layout')}>
        <SettingsCard>
          {/* Language */}
          <SettingRow label={t('Language')} description={t("App display language — 'System' follows the OS")}>
            <div className="flex gap-1.5">
              {([['system', t('System')], ['en', t('English')], ['ko', t('한국어')]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleLanguageChange(value)}
                  aria-pressed={(draft.language ?? 'system') === value}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
                    (draft.language ?? 'system') === value
                      ? 'border-ring bg-accent text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground/80',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>

          {/* Sidebar position */}
          <SettingRow label={t('Sidebar position')} description={t('Place the sidebar on the left or right')}>
            <div className="flex gap-1.5">
              {(['left', 'right'] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => handleSidebarPositionChange(pos)}
                  aria-label={pos === 'left' ? t('Sidebar on left') : t('Sidebar on right')}
                  aria-pressed={(draft.sidebarPosition ?? 'left') === pos}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
                    (draft.sidebarPosition ?? 'left') === pos
                      ? 'border-ring bg-accent text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground/80',
                  )}
                >
                  {pos === 'left' ? t('Left') : t('Right')}
                </button>
              ))}
            </div>
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      {/* ── Chat layout ─────────────────────────────────────── */}
      <SettingsGrid label={t('Chat layout')} description={t('How tool activity appears in threads')}>
        <SettingsCard>
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
        </SettingsCard>
      </SettingsGrid>
    </>
  )
})
