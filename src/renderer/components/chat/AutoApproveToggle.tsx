import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { IconChevronDown, IconMessageQuestion, IconPencil, IconBolt } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ipc } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import { usePanelResolvedTaskId } from './PanelContext'
import { useT } from '@/lib/i18n'
import type { AppSettings, PermissionMode } from '@/types'
import { permissionModeToAutoApprove } from '@/lib/permission-rules'

/**
 * Resolve auto-approve for a specific workspace (or fall back to global). Kept
 * for the spawn/createTask paths; stays correct because `autoApprove` is held
 * in sync with the permission mode ('auto' ⟺ true).
 */
export const getAutoApproveForWorkspace = (workspace: string | null): boolean => {
  const { settings } = useSettingsStore.getState()
  const projectPref = workspace ? settings.projectPrefs?.[workspace]?.autoApprove : undefined
  return projectPref !== undefined ? projectPref : (settings.autoApprove ?? false)
}

export const selectAutoApprove = (s: ReturnType<typeof useSettingsStore.getState>) => {
  const ws = s.activeWorkspace
  const projectPref = ws ? s.settings.projectPrefs?.[ws]?.autoApprove : undefined
  return projectPref !== undefined ? projectPref : (s.settings.autoApprove ?? false)
}

/** Resolve the effective permission mode: project override → global → legacy bool. */
export const resolvePermissionMode = (settings: AppSettings, workspace: string | null): PermissionMode => {
  const projectMode = workspace ? settings.projectPrefs?.[workspace]?.permissionMode : undefined
  if (projectMode) return projectMode
  if (settings.permissionMode) return settings.permissionMode
  return settings.autoApprove ? 'auto' : 'ask'
}

interface ModeEntry {
  readonly id: PermissionMode
  readonly labelKey: string
  readonly descKey: string
  readonly icon: typeof IconMessageQuestion
}

const MODES: readonly ModeEntry[] = [
  { id: 'ask', labelKey: 'Ask first', descKey: 'Confirm before running tools', icon: IconMessageQuestion },
  { id: 'acceptEdits', labelKey: 'Accept edits', descKey: 'Auto-allow edits, ask for the rest', icon: IconPencil },
  { id: 'auto', labelKey: 'Auto-run', descKey: 'Run tools without confirmation', icon: IconBolt },
] as const

export const AutoApproveToggle = memo(function AutoApproveToggle() {
  const t = useT()
  const resolvedTaskId = usePanelResolvedTaskId()
  // Derive workspace from the panel's task, not the global activeWorkspace.
  const panelWorkspace = useTaskStore((s) => {
    if (!resolvedTaskId) return null
    const task = s.tasks[resolvedTaskId]
    return task ? (task.originalWorkspace ?? task.workspace) : null
  })
  // Select the narrow fields that feed the mode, keeping Object.is bail-out.
  const globalMode = useSettingsStore((s) => s.settings.permissionMode)
  const globalAutoApprove = useSettingsStore((s) => s.settings.autoApprove ?? false)
  const projectMode = useSettingsStore((s) => {
    if (!panelWorkspace) return undefined
    return s.settings.projectPrefs?.[panelWorkspace]?.permissionMode
  })
  const mode: PermissionMode = projectMode ?? globalMode ?? (globalAutoApprove ? 'auto' : 'ask')
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleSelect = useCallback((modeId: PermissionMode) => {
    const { settings, setProjectPref, saveSettings } = useSettingsStore.getState()
    const workspace = panelWorkspace
    const current = resolvePermissionMode(settings, workspace)
    if (modeId === current) {
      setIsOpen(false)
      return
    }
    // Persist the mode and keep the legacy autoApprove bool in sync.
    const autoApprove = permissionModeToAutoApprove(modeId)
    if (workspace) {
      setProjectPref(workspace, { permissionMode: modeId, autoApprove })
    } else {
      saveSettings({ ...settings, permissionMode: modeId, autoApprove })
    }
    // Live effect: only "auto" has an in-session path (the Rust auto-approve
    // atomic). acceptEdits and rules are enforced in the gate from spawn-time
    // env, so they take full effect on newly started threads.
    const taskId = resolvedTaskId
    if (taskId) {
      const task = useTaskStore.getState().tasks[taskId]
      const isLive = task && (task.status === 'running' || task.status === 'pending_permission' || task.status === 'paused')
      if (isLive) {
        ipc.setAutoApprove(taskId, autoApprove).catch(() => {})
      }
    }
    setIsOpen(false)
  }, [panelWorkspace, resolvedTaskId])

  const current = MODES.find((m) => m.id === mode) ?? MODES[0]
  const CurrentIcon = current.icon
  const isElevated = mode !== 'ask'

  return (
    <div ref={ref} data-testid="auto-approve-toggle" className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={t('Permissions: {mode}', { mode: t(current.labelKey) })}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] font-medium transition-colors',
          isElevated
            ? 'text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <CurrentIcon className="size-3.5" aria-hidden />
        <span className="hidden @[480px]/toolbar:inline">{t(current.labelKey)}</span>
        <IconChevronDown className="hidden size-3 shrink-0 opacity-50 @[480px]/toolbar:block" aria-hidden />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={t('Select permissions')}
          className="absolute bottom-full left-0 z-[200] mb-2 w-56 rounded-lg border border-border bg-popover py-1 shadow-xl"
        >
          {MODES.map((m) => {
            const isActive = m.id === mode
            const Icon = m.icon
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  handleSelect(m.id)
                }}
                className={cn(
                  'flex w-full items-start gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
                  m.id !== 'ask' && isActive && 'text-amber-600 dark:text-amber-400',
                )}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block">{t(m.labelKey)}</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">{t(m.descKey)}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
})
