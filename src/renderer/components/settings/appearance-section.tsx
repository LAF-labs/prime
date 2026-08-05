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

const FONT_SIZE_UI_MIN = 10
const FONT_SIZE_CHAT_MIN = 8
const FONT_SIZE_MAX = 22
const MAX_ICON_BYTES = 2 * 1024 * 1024

interface AppearanceSectionProps {
  draft: AppSettings
  updateDraft: (patch: Partial<AppSettings>) => void
}

/** Font size stepper control with tooltip-wrapped +/- buttons */
const FontSizeStepper = memo(function FontSizeStepper({
  value,
  min,
  max,
  onDecrement,
  onIncrement,
  onChange,
  ariaLabelPrefix,
}: {
  value: number
  min: number
  max: number
  onDecrement: () => void
  onIncrement: () => void
  onChange: (value: string) => void
  ariaLabelPrefix: string
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onDecrement}
            disabled={value <= min}
            aria-label={`Decrease ${ariaLabelPrefix} font size`}
            className="flex size-7 items-center justify-center rounded-l-md border border-border/60 bg-background/50 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          >
            −
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Decrease</TooltipContent>
      </Tooltip>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${ariaLabelPrefix} font size value`}
        className="h-7 w-10 border-y border-border/60 bg-background/50 text-center text-xs font-semibold tabular-nums text-primary outline-none focus:ring-1 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onIncrement}
            disabled={value >= max}
            aria-label={`Increase ${ariaLabelPrefix} font size`}
            className="flex size-7 items-center justify-center rounded-r-md border border-border/60 bg-background/50 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          >
            +
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Increase</TooltipContent>
      </Tooltip>
      <span className="ml-1.5 text-[10px] text-muted-foreground/60">px</span>
    </div>
  )
})

export const AppearanceSection = memo(function AppearanceSection({ draft, updateDraft }: AppearanceSectionProps) {
  const fontSize = draft.fontSize ?? 14
  const chatFontSize = draft.chatFontSize ?? draft.fontSize ?? 14
  const hasCustomIcon = !!draft.customAppIcon

  const handleFontSizeInput = useCallback((value: string) => {
    const num = Number(value)
    if (Number.isNaN(num)) return
    updateDraft({ fontSize: Math.max(FONT_SIZE_UI_MIN, Math.min(FONT_SIZE_MAX, num)) })
  }, [updateDraft])

  const handleChatFontSizeInput = useCallback((value: string) => {
    const num = Number(value)
    if (Number.isNaN(num)) return
    updateDraft({ chatFontSize: Math.max(FONT_SIZE_CHAT_MIN, Math.min(FONT_SIZE_MAX, num)) })
  }, [updateDraft])

  const handleResetChatFontSize = useCallback(() => {
    updateDraft({ chatFontSize: undefined })
  }, [updateDraft])

  const handleDecrementUiFont = useCallback(() => {
    updateDraft({ fontSize: Math.max(FONT_SIZE_UI_MIN, fontSize - 1) })
  }, [updateDraft, fontSize])

  const handleIncrementUiFont = useCallback(() => {
    updateDraft({ fontSize: Math.min(FONT_SIZE_MAX, fontSize + 1) })
  }, [updateDraft, fontSize])

  const handleDecrementChatFont = useCallback(() => {
    updateDraft({ chatFontSize: Math.max(FONT_SIZE_CHAT_MIN, chatFontSize - 1) })
  }, [updateDraft, chatFontSize])

  const handleIncrementChatFont = useCallback(() => {
    updateDraft({ chatFontSize: Math.min(FONT_SIZE_MAX, chatFontSize + 1) })
  }, [updateDraft, chatFontSize])

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

  const handleInlineToolCallsChange = useCallback((checked: boolean) => {
    updateDraft({ inlineToolCalls: checked })
  }, [updateDraft])

  const displayIcon = hasCustomIcon ? draft.customAppIcon! : defaultAppIcon

  return (
    <>
      <SectionHeader section="appearance" />

      {/* ── Look & feel ─────────────────────────────────────── */}
      <SettingsGrid label="Look & feel" description="Theme, icon, and color scheme">
        <SettingsCard>
          {/* App icon row */}
          <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="flex items-center gap-3.5">
              <img
                src={displayIcon}
                alt="App icon"
                className="size-12 rounded-xl border border-border/60 bg-background/50 object-cover shadow-sm"
                draggable={false}
              />
              <div>
                <p className="text-[12.5px] font-medium text-foreground">App icon</p>
                <p className="text-[11px] text-muted-foreground">
                  {hasCustomIcon ? 'Custom icon' : 'Default Kirodex icon'} · About dialog & dock
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
                      aria-label="Reset to default app icon"
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <IconRotate className="size-3" />
                      Reset
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Reset to default icon</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleUploadIcon}
                    aria-label="Upload custom app icon"
                    className="flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <IconUpload className="size-3" />
                    Change
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Upload custom icon (max 2 MB)</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <Divider />

          {/* Theme row */}
          <div className="py-3">
            <p className="mb-2 text-[12.5px] font-medium text-foreground">Theme</p>
            <ThemeSelector
              value={draft.theme ?? 'dark'}
              onChange={handleThemeChange}
            />
          </div>
        </SettingsCard>
      </SettingsGrid>

      {/* ── Display ─────────────────────────────────────────── */}
      <SettingsGrid label="Display" description="Font size and layout">
        <SettingsCard>
          {/* UI font size */}
          <div className="py-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12.5px] font-medium text-foreground">UI font size</p>
                <p className="text-[11px] text-muted-foreground">Sidebar, file tree, header, dialogs</p>
              </div>
              <FontSizeStepper
                value={fontSize}
                min={FONT_SIZE_UI_MIN}
                max={FONT_SIZE_MAX}
                onDecrement={handleDecrementUiFont}
                onIncrement={handleIncrementUiFont}
                onChange={handleFontSizeInput}
                ariaLabelPrefix="UI"
              />
            </div>
            <div className="mt-2.5 rounded-md border border-border/40 bg-background/30 px-3 py-2">
              <p className="text-foreground/70 leading-relaxed" style={{ fontSize }}>The quick brown fox jumps over the lazy dog</p>
            </div>
          </div>

          <Divider />

          {/* Chat font size */}
          <div className="py-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12.5px] font-medium text-foreground">Chat font size</p>
                <p className="text-[11px] text-muted-foreground">
                  Chat messages, markdown rendering, and the message input
                  {draft.chatFontSize == null && <span className="ml-1 text-muted-foreground/70">· following UI size</span>}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {draft.chatFontSize != null && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleResetChatFontSize}
                        aria-label="Reset chat font size to follow UI font size"
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <IconRotate className="size-3" />
                        Reset
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Reset to follow UI size</TooltipContent>
                  </Tooltip>
                )}
                <FontSizeStepper
                  value={chatFontSize}
                  min={FONT_SIZE_CHAT_MIN}
                  max={FONT_SIZE_MAX}
                  onDecrement={handleDecrementChatFont}
                  onIncrement={handleIncrementChatFont}
                  onChange={handleChatFontSizeInput}
                  ariaLabelPrefix="Chat"
                />
              </div>
            </div>
            <div className="mt-2.5 rounded-md border border-border/40 bg-background/30 px-3 py-2">
              <p className="text-foreground/70 leading-[1.7]" style={{ fontSize: chatFontSize }}>
                Markdown preview rendered at the chat font size.
              </p>
            </div>
          </div>

          <Divider />

          {/* Sidebar position */}
          <SettingRow label="Sidebar position" description="Place the sidebar on the left or right">
            <div className="flex gap-1.5">
              {(['left', 'right'] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => handleSidebarPositionChange(pos)}
                  aria-label={`Sidebar on ${pos}`}
                  className={cn(
                    'rounded-md border px-4 py-1.5 text-[11px] font-medium capitalize transition-colors',
                    (draft.sidebarPosition ?? 'left') === pos
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {pos}
                </button>
              ))}
            </div>
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>

      {/* ── Chat layout ─────────────────────────────────────── */}
      <SettingsGrid label="Chat layout" description="How tool activity appears in threads">
        <SettingsCard>
          <SettingRow
            label="Inline tool calls"
            description="Show each tool entry between paragraphs at the moment the agent ran it. When off, tool activity collapses into a single card after the assistant's reply."
          >
            <Switch
              checked={draft.inlineToolCalls !== false}
              onCheckedChange={handleInlineToolCallsChange}
              aria-label="Toggle inline tool calls"
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGrid>
    </>
  )
})
