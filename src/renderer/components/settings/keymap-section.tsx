import { t } from '@/lib/i18n'
import { memo, useState, useCallback } from 'react'
import { IconSearch } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { SectionHeader, SettingsSection, SettingRow, SETTINGS_INPUT_CLASS } from './settings-shared'

import { IS_MAC, MOD_KEY } from '@/lib/platform'

const MOD = MOD_KEY
const SHIFT = IS_MAC ? '\u21E7' : 'Shift'

interface KeymapEntry { command: string; keys: string; group: string }

const KEYMAP: KeymapEntry[] = [
  { group: 'Navigation', command: 'Previous thread', keys: `${MOD}+${SHIFT}+[` },
  { group: 'Navigation', command: 'Next thread', keys: `${MOD}+${SHIFT}+]` },
  { group: 'Navigation', command: 'Jump to thread 1–9', keys: `${MOD}+1 … 9` },
  { group: 'Panels', command: 'Toggle sidebar', keys: `${MOD}+B` },
  { group: 'Panels', command: 'Toggle terminal', keys: `${MOD}+J` },
  { group: 'Panels', command: 'Open settings', keys: `${MOD}+,` },
  { group: 'Actions', command: 'New project', keys: `${MOD}+O` },
  { group: 'Actions', command: 'New chat', keys: `${MOD}+N` },
  { group: 'Actions', command: 'Close thread', keys: `${MOD}+W` },
  { group: 'Chat', command: 'Send message', keys: 'Enter' },
  { group: 'Chat', command: 'New line', keys: `${SHIFT}+Enter` },
  { group: 'Chat', command: 'Previous message', keys: '\u2191 (at start)' },
  { group: 'Chat', command: 'Focus chat input', keys: `${MOD}+L` },
  { group: 'Chat', command: 'Search messages', keys: `${MOD}+F` },
  { group: 'Chat', command: 'Pause agent', keys: 'Escape (while running)' },
] as const

export const KeymapSection = memo(function KeymapSection() {
  const [keymapFilter, setKeymapFilter] = useState('')

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setKeymapFilter(e.target.value)
  }, [])

  const q = keymapFilter.toLowerCase()
  const filtered = q
    ? KEYMAP.filter((e) =>
      [e.command, t(e.command), e.keys, t(e.keys), e.group, t(e.group)]
        .some((s) => s.toLowerCase().includes(q)))
    : KEYMAP
  const groups = [...new Set(filtered.map((e) => e.group))]

  return (
    <>
      <SectionHeader section="keymap" />

      <div className="relative mb-7">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <input
          value={keymapFilter}
          onChange={handleFilterChange}
          placeholder={t('Search shortcuts…')}
          aria-label={t('Search keyboard shortcuts')}
          className={cn(SETTINGS_INPUT_CLASS, 'w-full pl-8')}
        />
      </div>

      {groups.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10">
          <IconSearch className="size-5 text-muted-foreground/40" />
          <p className="text-[13px] text-muted-foreground">{t('No matching shortcuts')}</p>
        </div>
      )}

      {groups.map((group) => (
        <SettingsSection key={group} title={t(group)}>
          {filtered.filter((e) => e.group === group).map((entry) => (
            <SettingRow key={entry.command} label={t(entry.command)} className="py-2.5">
              <kbd className="font-mono text-[12px] font-normal text-muted-foreground">{t(entry.keys)}</kbd>
            </SettingRow>
          ))}
        </SettingsSection>
      ))}
    </>
  )
})
