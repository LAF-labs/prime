import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { IconX, IconBrandGithub, IconSearch, IconRotate } from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore, buildRestoredDefaults } from '@/stores/settingsStore'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { handleExternalLinkClick, handleExternalLinkKeyDown } from '@/lib/open-external'
import { ipc } from '@/lib/ipc'
import type { AppSettings } from '@/types'
import { applyTheme, persistTheme } from '@/lib/theme'
import { useT } from '@/lib/i18n'
import { attempt, reportFailure } from '@/lib/ipc-report'
import { AboutDialog } from './AboutDialog'
import { NAV, NAV_GROUP_LABELS, SEARCHABLE_SETTINGS, type Section, type NavGroup } from './settings-shared'
import { AccountSection } from './account-section'
import { GeneralSection } from './general-section'
import { PermissionsSection } from './permissions-section'
import { AppearanceSection } from './appearance-section'
import { KeymapSection } from './keymap-section'
import { AdvancedSection } from './advanced-section'
import { MemorySection } from './memory-section'
import { ArchivesSection } from './archives-section'

/** How long after the last edit the draft is written to disk. */
const AUTOSAVE_DEBOUNCE_MS = 400

/**
 * Settings, as a dialog over the app rather than a screen that replaces it.
 *
 * Changes save themselves: an everyday user should never have to notice a
 * save button, and the old draft/save/discard triangle meant a mistyped value
 * could be committed by muscle memory or lost by closing the window. Writes
 * are debounced and flushed on close.
 */
export const SettingsPanel = () => {
  const t = useT()
  const open = useTaskStore((s) => s.isSettingsOpen)
  const setOpen = useTaskStore((s) => s.setSettingsOpen)
  const settingsInitialSection = useTaskStore((s) => s.settingsInitialSection)
  const { settings, saveSettings, authChecked, checkAuth } = useSettingsStore(
    useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings, authChecked: s.authChecked, checkAuth: s.checkAuth })),
  )

  const [section, setSection] = useState<Section>('general')
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [appVersion, setAppVersion] = useState('')
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<AppSettings | null>(null)
  const appliedIconRef = useRef<string | undefined>(settings.customAppIcon)

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}) }, [])
  useEffect(() => { if (open && !authChecked) checkAuth() }, [open, authChecked, checkAuth])

  // Adopt external changes (another window, a reset) only while there is no
  // edit of our own in flight, or we would clobber what the user just typed.
  useEffect(() => {
    if (!pendingRef.current) setDraft(settings)
  }, [settings])

  useEffect(() => {
    if (open && settingsInitialSection) setSection(settingsInitialSection as Section)
  }, [open, settingsInitialSection])

  const commit = useCallback(async (next: AppSettings) => {
    const mode = next.theme ?? 'dark'
    persistTheme(mode)
    applyTheme(mode)
    try {
      await saveSettings(next)
    } catch (err) {
      reportFailure(t('Could not save settings'), err)
      return
    }
    // Only touch the dock when the icon itself changed — this runs on every
    // edit now, and re-applying the icon on each keystroke would be silly.
    if (next.customAppIcon !== appliedIconRef.current) {
      appliedIconRef.current = next.customAppIcon
      if (next.customAppIcon) {
        const base64 = next.customAppIcon.replace(/^data:[^;]+;base64,/, '')
        attempt(t('Could not change the app icon'), ipc.setDockIcon(base64))
      } else {
        attempt(t('Could not change the app icon'), ipc.resetDockIcon())
      }
    }
  }, [saveSettings, t])

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) void commit(pending)
  }, [commit])

  const updateDraft = useCallback((patch: Partial<AppSettings>) => {
    setDraft((d) => {
      const next = { ...d, ...patch }
      pendingRef.current = next
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null
        const queued = pendingRef.current
        pendingRef.current = null
        if (queued) void commit(queued)
      }, AUTOSAVE_DEBOUNCE_MS)
      // Theme is the one setting whose effect must be instant, not debounced.
      if (patch.theme) applyTheme(patch.theme)
      return next
    })
  }, [commit])

  const handleClose = useCallback(() => {
    flush()
    setOpen(false)
  }, [flush, setOpen])

  useEffect(() => {
    if (!open) return
    setSearchQuery('')
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  // A pending write must not die with the component (window close, reload).
  useEffect(() => () => flush(), [flush])

  // Resets only the user-tunable fields; onboarding state, theme, language,
  // project prefs, and the custom icon survive. A wholesale default object
  // here once wiped `hasOnboardedV2` and dropped users back into the wizard.
  const handleRestoreDefaults = useCallback(() => {
    setDraft((d) => {
      const next = buildRestoredDefaults(d)
      pendingRef.current = next
      return next
    })
    flush()
  }, [flush])

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    return SEARCHABLE_SETTINGS.filter((item) => {
      // Include the translated label/description so search works in Korean too.
      const haystack = `${item.label} ${item.description} ${item.keywords} ${t(item.label)} ${t(item.description)}`.toLowerCase()
      return q.split(/\s+/).every((word) => haystack.includes(word))
    })
  }, [searchQuery, t])

  const handleSearchResultClick = useCallback((targetSection: Section) => {
    setSection(targetSection)
    setSearchQuery('')
  }, [])

  if (!open) return null

  const navGroups = NAV.reduce<Array<{ group: NavGroup; items: typeof NAV }>>((acc, item) => {
    const last = acc[acc.length - 1]
    if (last && last.group === item.group) last.items.push(item)
    else acc.push({ group: item.group, items: [item] })
    return acc
  }, [])

  return (
    <div
      data-testid="settings-panel"
      className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-in fade-in-0 duration-150"
    >
      {/* Backdrop — the app stays visible behind it, dimmed. */}
      <button
        type="button"
        aria-label={t('Close settings')}
        onClick={handleClose}
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Settings')}
        className="relative z-10 flex h-[min(680px,88vh)] w-[min(960px,94vw)] overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl animate-in zoom-in-95 duration-150"
      >
        {/* Nav column */}
        <nav data-testid="settings-nav" className="flex w-[212px] shrink-0 flex-col border-r border-border bg-muted/40 p-3">
          <div className="relative mb-3">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('Search')}
              aria-label={t('Search settings')}
              className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-[12.5px] placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>

          {searchResults !== null && searchResults.length > 0 ? (
            <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
              {searchResults.map((item) => {
                const navItem = NAV.find((n) => n.id === item.section)
                return (
                  <button
                    key={`${item.section}-${item.label}`}
                    onClick={() => handleSearchResultClick(item.section)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    {navItem && <navItem.icon className="size-3.5 shrink-0 text-muted-foreground/60" />}
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-foreground">{t(item.label)}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{t(item.description)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-y-auto" role="tablist" aria-label={t('Settings sections')}>
              {navGroups.map(({ group, items }, groupIdx) => (
                <div key={group} className={cn(groupIdx > 0 && 'mt-4')}>
                  <p className="mb-1 px-2 text-[11px] font-medium text-muted-foreground">
                    {t(NAV_GROUP_LABELS[group])}
                  </p>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      role="tab"
                      aria-selected={section === item.id}
                      onClick={() => setSection(item.id)}
                      className={cn(
                        'flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors',
                        // Selected has to out-read hover, or the two states are
                        // indistinguishable while the pointer rests in the list.
                        section === item.id
                          ? 'bg-primary/12 font-medium text-foreground ring-1 ring-inset ring-primary/35'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      <item.icon className={cn('size-4 shrink-0', section === item.id ? 'text-foreground' : 'opacity-70')} />
                      <span className="truncate text-[13px]">{t(item.label)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto space-y-1 border-t border-border pt-2.5">
            <button
              type="button"
              onClick={handleRestoreDefaults}
              className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <IconRotate className="size-3.5" />
              {t('Restore defaults')}
            </button>
            <div className="flex items-center justify-between px-2">
              <button type="button" onClick={() => setIsAboutOpen(true)} className="text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                LAF Agent {appVersion ? `v${appVersion}` : ''}
              </button>
              <a
                href="https://laf-co.com/"
                onClick={handleExternalLinkClick}
                onKeyDown={handleExternalLinkKeyDown}
                aria-label={t('LAF Agent website')}
                tabIndex={0}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <IconBrandGithub className="size-3.5" />
              </a>
            </div>
          </div>
        </nav>

        {/* Content column */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={handleClose}
            data-testid="settings-close-button"
            aria-label={t('Close')}
            className="absolute right-4 top-4 z-10 flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <IconX className="size-4" />
          </button>

          <div className="flex-1 overflow-y-auto px-9 py-8">
            <div className="mx-auto max-w-[640px]">
              {searchResults !== null ? (
                searchResults.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-20 text-center">
                    <IconSearch className="size-5 text-muted-foreground/40" />
                    <p className="text-[13px] text-muted-foreground">{t('No settings match "{query}"', { query: searchQuery })}</p>
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="mt-1 rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {t('Clear search')}
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    <p className="pb-3 text-[12px] text-muted-foreground">
                      {searchResults.length === 1 ? t('1 result') : t('{count} results', { count: searchResults.length })}
                    </p>
                    {searchResults.map((item) => {
                      const navItem = NAV.find((n) => n.id === item.section)
                      return (
                        <button
                          key={`${item.section}-${item.label}`}
                          onClick={() => handleSearchResultClick(item.section)}
                          className="flex w-full items-center gap-3 py-3.5 text-left transition-colors hover:bg-accent/40"
                        >
                          {navItem && <navItem.icon className="size-4 shrink-0 text-muted-foreground/60" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-foreground">{t(item.label)}</p>
                            <p className="text-[12px] text-muted-foreground">{t(item.description)}</p>
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{t(navItem?.label ?? '')}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              ) : (
                <>
                  {section === 'account' && <AccountSection draft={draft} updateDraft={updateDraft} />}
                  {section === 'general' && <GeneralSection draft={draft} updateDraft={updateDraft} />}
                  {section === 'permissions' && <PermissionsSection draft={draft} updateDraft={updateDraft} />}
                  {section === 'appearance' && <AppearanceSection draft={draft} updateDraft={updateDraft} />}
                  {section === 'keymap' && <KeymapSection />}
                  {section === 'advanced' && <AdvancedSection draft={draft} updateDraft={updateDraft} onClose={handleClose} />}
                  {section === 'memory' && <MemorySection draft={draft} updateDraft={updateDraft} />}
                  {section === 'archives' && <ArchivesSection />}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <AboutDialog open={isAboutOpen} onOpenChange={setIsAboutOpen} />
    </div>
  )
}
