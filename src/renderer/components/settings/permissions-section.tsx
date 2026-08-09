import { memo, useCallback, useMemo, useState } from 'react'
import {
  IconMessageQuestion, IconPencil, IconBolt, IconTrash, IconPlus, IconInfoCircle,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { AppSettings, PermissionMode, PermissionRule } from '@/types'
import { isKnownTool, normalizeRule, permissionModeToAutoApprove, ruleKey } from '@/lib/permission-rules'
import { SectionHeader, SettingsCard, SettingsGrid } from './settings-shared'

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

      <SettingsGrid label={t('Permission mode')} description={t('How tool calls are approved')}>
        <SettingsCard className="py-2.5">
          <div role="radiogroup" aria-label={t('Permission mode')} className="flex flex-col gap-1.5">
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
                    'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    isActive
                      ? 'border-ring bg-accent/60'
                      : 'border-border/60 hover:bg-muted/40',
                  )}
                >
                  <Icon className={cn('mt-0.5 size-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                  <div className="min-w-0">
                    <p className={cn('text-[12.5px] font-medium', isActive ? 'text-foreground' : 'text-foreground/90')}>{t(m.labelKey)}</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t(m.descKey)}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid label={t('Allow rules')} description={t('Always allow specific tools or commands')}>
        <SettingsCard className="py-2.5">
          <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <IconInfoCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
            {t('Matching calls run without a prompt. Use * as a wildcard in the pattern (e.g. Documents/*). Rules apply to newly started threads.')}
          </p>

          {rules.length === 0 ? (
            <p className="py-3 text-center text-[11.5px] text-muted-foreground/70">{t('No allow rules yet.')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rules.map((rule) => (
                <li key={ruleKey(rule)} className="flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-2.5 py-1.5">
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{rule.tool}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {rule.argPattern ? rule.argPattern : t('any argument')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteRule(rule)}
                    aria-label={t('Delete rule')}
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2.5 flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
            <div className="flex gap-2">
              <input
                value={newTool}
                onChange={(e) => setNewTool(e.target.value)}
                onKeyDown={handleFormKeyDown}
                placeholder={t('Tool (e.g. write_file)')}
                aria-label={t('Tool name')}
                className="h-7 w-32 shrink-0 rounded-md border border-input bg-background/50 px-2.5 font-mono text-[11px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <input
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={handleFormKeyDown}
                placeholder={t('Argument pattern (optional, e.g. Documents/*)')}
                aria-label={t('Argument pattern')}
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background/50 px-2.5 font-mono text-[11px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={handleAddRule}
                disabled={trimmedTool.length === 0}
                aria-label={t('Add rule')}
                className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-input px-2.5 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <IconPlus className="size-3" />
                {t('Add')}
              </button>
            </div>
            {showUnknownHint && (
              <p className="text-[10.5px] text-amber-600 dark:text-amber-400">
                {t('"{tool}" is not a known built-in tool — double-check the name.', { tool: trimmedTool })}
              </p>
            )}
          </div>
        </SettingsCard>
      </SettingsGrid>
    </>
  )
})
