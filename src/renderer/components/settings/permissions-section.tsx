import { memo, useCallback, useMemo, useState } from 'react'
import {
  IconMessageQuestion, IconPencil, IconBolt, IconTrash, IconPlus, IconInfoCircle,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { AppSettings, PermissionMode, PermissionRule } from '@/types'
import { isKnownTool, normalizeRule, permissionModeToAutoApprove, ruleKey } from '@/lib/permission-rules'
import {
  SectionHeader, SettingBlock, SettingsSection, SETTINGS_BUTTON_CLASS, SETTINGS_INPUT_CLASS,
} from './settings-shared'

interface PermissionsSectionProps {
  draft: AppSettings
  updateDraft: (patch: Partial<AppSettings>) => void
}

interface ModeEntry {
  readonly id: PermissionMode
  readonly labelKey: string
  readonly descKey: string
  readonly icon: typeof IconMessageQuestion
}

const MODES: readonly ModeEntry[] = [
  { id: 'ask', labelKey: 'Ask first', descKey: 'Prompt before every file edit or command.', icon: IconMessageQuestion },
  { id: 'acceptEdits', labelKey: 'Accept edits', descKey: 'Auto-allow file edits; still ask for shell and other tools.', icon: IconPencil },
  { id: 'auto', labelKey: 'Auto-run', descKey: 'Run every tool without asking. Use with care.', icon: IconBolt },
] as const

export const PermissionsSection = memo(function PermissionsSection({ draft, updateDraft }: PermissionsSectionProps) {
  const t = useT()
  const rules = useMemo(() => draft.permissionRules ?? [], [draft.permissionRules])
  const [newTool, setNewTool] = useState('')
  const [newPattern, setNewPattern] = useState('')

  const mode: PermissionMode = draft.permissionMode ?? (draft.autoApprove ? 'auto' : 'ask')

  const handleModeChange = useCallback((next: PermissionMode) => {
    // Keep the legacy autoApprove bool in sync so every call site still reading
    // it (spawn, the chat toolbar toggle) stays correct.
    updateDraft({ permissionMode: next, autoApprove: permissionModeToAutoApprove(next) })
  }, [updateDraft])

  const handleAddRule = useCallback(() => {
    const normalized = normalizeRule({ tool: newTool, argPattern: newPattern || undefined })
    if (!normalized) return
    const key = ruleKey(normalized)
    setNewTool('')
    setNewPattern('')
    if (rules.some((r) => ruleKey(r) === key)) return
    updateDraft({ permissionRules: [...rules, normalized] })
  }, [newTool, newPattern, rules, updateDraft])

  const handleDeleteRule = useCallback((rule: PermissionRule) => {
    const key = ruleKey(rule)
    updateDraft({ permissionRules: rules.filter((r) => ruleKey(r) !== key) })
  }, [rules, updateDraft])

  const handleFormKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddRule() }
  }, [handleAddRule])

  const trimmedTool = newTool.trim()
  const showUnknownHint = trimmedTool.length > 0 && !isKnownTool(trimmedTool)

  return (
    <>
      <SectionHeader section="permissions" />

      <SettingsSection title={t('Permission mode')} description={t('How tool calls are approved')}>
        <SettingBlock>
          <div role="radiogroup" aria-label={t('Permission mode')} className="flex flex-col gap-2">
            {MODES.map((m) => {
              const isActive = mode === m.id
              const Icon = m.icon
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => handleModeChange(m.id)}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    isActive
                      ? 'border-ring bg-accent'
                      : 'border-border hover:bg-accent/60',
                  )}
                >
                  <Icon className={cn('mt-0.5 size-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground">{t(m.labelKey)}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t(m.descKey)}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </SettingBlock>
      </SettingsSection>

      <SettingsSection title={t('Allow rules')} description={t('Always allow specific tools or commands')}>
        <SettingBlock>
          <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
            <IconInfoCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('Matching calls run without a prompt. Use * as a wildcard in the pattern (e.g. Documents/*). Rules apply to newly started threads.')}
          </p>

          {rules.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-muted-foreground/70">{t('No allow rules yet.')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {rules.map((rule) => (
                <li key={ruleKey(rule)} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{rule.tool}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {rule.argPattern ? rule.argPattern : t('any argument')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteRule(rule)}
                    aria-label={t('Delete rule')}
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <IconTrash className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SettingBlock>

        <SettingBlock className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={newTool}
              onChange={(e) => setNewTool(e.target.value)}
              onKeyDown={handleFormKeyDown}
              placeholder={t('Tool name')}
              aria-label={t('Tool name')}
              className={cn(SETTINGS_INPUT_CLASS, 'w-36 shrink-0 font-mono text-[12px]')}
            />
            <input
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={handleFormKeyDown}
              placeholder={t('Argument pattern (optional)')}
              aria-label={t('Argument pattern')}
              className={cn(SETTINGS_INPUT_CLASS, 'min-w-0 flex-1 font-mono text-[12px]')}
            />
            <button
              type="button"
              onClick={handleAddRule}
              disabled={trimmedTool.length === 0}
              aria-label={t('Add rule')}
              className={cn(SETTINGS_BUTTON_CLASS, 'shrink-0 disabled:pointer-events-none disabled:opacity-50')}
            >
              <IconPlus className="size-3.5" aria-hidden />
              {t('Add')}
            </button>
          </div>
          {showUnknownHint && (
            <p className="text-[12px] text-warning-foreground">
              {t('"{tool}" is not a known built-in tool — double-check the name.', { tool: trimmedTool })}
            </p>
          )}
        </SettingBlock>
      </SettingsSection>
    </>
  )
})
