import { t } from '@/lib/i18n'
import { useEffect, useCallback, useState, useRef, lazy, Suspense } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { applyTheme, listenSystemTheme, persistTheme } from "@/lib/theme";
import { preloadHighlighterIdle } from "@/lib/chatHighlighter";
import { warmTerminalRuntime } from "@/components/chat/TerminalDrawer";
import { startConnectionHealthMonitor } from "@/lib/connection-health";
import { getReceiptBus } from "@/lib/typed-receipts";
import { AppHeader } from "@/components/AppHeader";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { TaskSidebar } from "@/components/sidebar/TaskSidebar";

const ChatPanel = lazy(() =>
  import("@/components/chat/ChatPanel").then((m) => ({ default: m.ChatPanel })),
);
const SplitChatLayout = lazy(() =>
  import("@/components/chat/SplitChatLayout").then((m) => ({ default: m.SplitChatLayout })),
);
import { PendingChat } from "@/components/chat/PendingChat";
import { NewProjectSheet } from "@/components/task/NewProjectSheet";
import { ipc } from "@/lib/ipc";
const SettingsPanel = lazy(() =>
  import("@/components/settings/SettingsPanel").then((m) => ({
    default: m.SettingsPanel,
  })),
);
const DebugPanel = lazy(() =>
  import("@/components/debug/DebugPanel").then((m) => ({
    default: m.DebugPanel,
  })),
);
const FileTreePanel = lazy(() =>
  import("@/components/file-tree/FileTreePanel").then((m) => ({
    default: m.FileTreePanel,
  })),
);
const AnalyticsDashboard = lazy(() =>
  import("@/components/analytics/AnalyticsDashboard").then((m) => ({
    default: m.AnalyticsDashboard,
  })),
);
import { useTaskStore, initTaskListeners } from "@/stores/taskStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDebugStore } from "@/stores/debugStore";
import { useFileTreeStore } from "@/stores/fileTreeStore";
import { initResourceListeners } from "@/stores/resourceStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSessionTracker } from "@/hooks/useSessionTracker";
import { resolveLocale, useI18nStore, useT } from "@/lib/i18n";
import { MOD_PREFIX } from "@/lib/platform";
import { UpdateAvailableDialog } from "@/components/UpdateAvailableDialog";
import { WhatsNewDialog } from "@/components/WhatsNewDialog";
import { CHANGELOG, isNewerVersion } from "@/lib/changelog";
import type { ChangelogEntry } from "@/lib/changelog";
import { useUpdateStore } from "@/stores/updateStore";
import { startAutoFlush, stopAutoFlush } from "@/lib/analytics-collector";
import { GlobalFilePreviewModal } from "@/components/GlobalFilePreviewModal";
import { getVersion } from "@tauri-apps/api/app";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import {
  IconStack2,
  IconPlus,
  IconFolderOpen,
  IconLayoutColumns,
  IconWorld,
  IconFiles,
  IconBulb,
  IconMessageChatbot,
} from "@tabler/icons-react";
/**
 * Shown while a lazily-loaded panel's chunk is fetched.
 *
 * Every Suspense boundary here was fallback-less, so a cold start or a slow
 * disk left the user looking at an empty rectangle with no indication that
 * anything was happening.
 */
const PanelFallback = () => (
  <div className="flex h-full w-full items-center justify-center" role="status" aria-live="polite">
    <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-primary" />
    <span className="sr-only">{t('Loading')}</span>
  </div>
)

const Onboarding = lazy(() =>
  import("@/components/Onboarding").then((m) => ({ default: m.Onboarding })),
);

function LoginBanner() {
  const agentAuth = useSettingsStore((s) => s.agentAuth);
  const authChecked = useSettingsStore((s) => s.authChecked);
  const openLogin = useSettingsStore((s) => s.openLogin);

  if (!authChecked || agentAuth) return null;

  return (
    <div className="mx-auto mb-3 flex w-full max-w-2xl items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 lg:max-w-3xl xl:max-w-4xl">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-amber-400" aria-hidden>
        <path d="M8 1.333A6.667 6.667 0 1 0 14.667 8 6.674 6.674 0 0 0 8 1.333Zm0 10.334a.667.667 0 1 1 0-1.334.667.667 0 0 1 0 1.334ZM8.667 8a.667.667 0 0 1-1.334 0V5.333a.667.667 0 0 1 1.334 0V8Z" fill="currentColor"/>
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-amber-700 dark:text-amber-200/90">{t('Sign in to LAF Agent to start using AI agents')}</p>
        <p className="text-[11px] text-amber-600/70 dark:text-amber-400">{t('Authentication is required to create threads and interact with agents')}</p>
      </div>
      <button
        type="button"
        onClick={openLogin}
        className="shrink-0 rounded-lg bg-amber-500/20 px-3 py-1.5 text-[12px] font-medium text-amber-700 dark:text-amber-200 transition-colors hover:bg-amber-500/30"
      >
        {t('Sign in')}
      </button>
    </div>
  );
}

const SHOWCASE_FEATURES = [
  {
    icon: IconMessageChatbot,
    label: "Just ask",
    desc: "Answers questions, writes and summarizes documents, and thinks things through with you",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
  },
  {
    icon: IconWorld,
    label: "Research the web",
    desc: "Looks things up online and pulls several sources together into one answer",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    icon: IconFiles,
    label: "Work with your files",
    desc: "Reads, writes, and organizes documents in the folders you choose",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
  },
  {
    icon: IconBulb,
    label: "Remembers you",
    desc: "Keeps track of your preferences and picks up where you left off",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
  },
] as const;

function EmptyState() {
  const t = useT();
  const projects = useTaskStore((s) => s.projects);
  const hasProjects = projects.length > 0;

  const handleNewChat = useCallback(() => {
    ipc.ensureChatsDir()
      .then((dir) => { useTaskStore.getState().setPendingWorkspace(dir) })
      .catch((err) => { console.error('[chats] ensure_chats_dir failed:', err) })
  }, []);

  const handleOpenFolder = useCallback(() => {
    if (projects.length > 0) {
      useTaskStore.getState().setPendingWorkspace(projects[0]);
    } else {
      useTaskStore.getState().setNewProjectOpen(true);
    }
  }, [projects]);

  return (
    <div data-testid="empty-state" className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 overflow-y-auto">
      <div className="flex flex-col items-center gap-5 -mt-4 max-w-lg w-full">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
          <IconStack2 size={28} stroke={1.5} className="text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground">
            {t('What can I help with?')}
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {t('Start a chat, or open a folder to work with your documents and files.')}
          </p>
        </div>
        <LoginBanner />
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="empty-new-chat-button"
            onClick={handleNewChat}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <IconPlus size={15} stroke={2} />
            {t('New Chat')}
          </button>
          <button
            type="button"
            data-testid="empty-open-folder-button"
            onClick={handleOpenFolder}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            <IconFolderOpen size={15} stroke={1.5} />
            {hasProjects ? t('New Thread') : t('Open Folder')}
          </button>
        </div>
        {!hasProjects && (
          <p className="text-[11px] text-muted-foreground">
            {t('Or press')} <kbd className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px]">{MOD_PREFIX}O</kbd> {t('to open a folder')}
          </p>
        )}

        {/* Features showcase */}
        <div className="mt-4 w-full" role="region" aria-label={t('Features overview')}>
          <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60">
            {t('What you can do')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SHOWCASE_FEATURES.map((feature) => (
              <div
                key={feature.label}
                className="group flex items-start gap-3 rounded-xl border border-border/50 bg-card/50 px-3.5 py-3 transition-colors hover:border-border hover:bg-card"
              >
                <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", feature.bgColor)}>
                  <feature.icon size={16} stroke={1.5} className={cn(feature.color, "transition-transform group-hover:scale-110")} />
                </div>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-foreground/90">{t(feature.label)}</p>
                  <p className="text-[11px] leading-snug text-muted-foreground">{t(feature.desc)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Navigate to a task from a clicked notification, then remove it from the queue. */
const navigateToNotifiedTask = (taskId: string): void => {
  const store = useTaskStore.getState()
  if (!store.tasks[taskId]) return
  // If the task is already visible in the active split, just focus that panel
  if (store.activeSplitId) {
    const sv = store.splitViews.find((v) => v.id === store.activeSplitId)
    if (sv && (sv.left === taskId || sv.right === taskId)) {
      const panel = sv.left === taskId ? 'left' as const : 'right' as const
      store.setFocusedPanel(panel)
      useTaskStore.setState((s) => ({
        selectedTaskId: taskId,
        notifiedTaskIds: s.notifiedTaskIds.filter((id) => id !== taskId),
      }))
      store.setView('chat')
      return
    }
  }
  store.setSelectedTask(taskId)
  store.setView('chat')
  useTaskStore.setState((s) => ({
    notifiedTaskIds: s.notifiedTaskIds.filter((id) => id !== taskId),
  }))
}

export function App() {
  const { view, selectedTaskId, pendingWorkspace, activeSplitId } = useTaskStore(
    useShallow((s) => ({
      view: s.view,
      selectedTaskId: s.selectedTaskId,
      pendingWorkspace: s.pendingWorkspace,
      activeSplitId: s.activeSplitId,
    })),
  );
  const debugOpen = useDebugStore((s) => s.isOpen);
  const settingsLoaded = useSettingsStore((s) => s.isLoaded);
  const hasOnboardedV2 = useSettingsStore((s) => s.settings.hasOnboardedV2);
  const theme = useSettingsStore((s) => s.settings.theme ?? 'dark');
  const sidebarPosition = useSettingsStore((s) => s.settings.sidebarPosition ?? 'left');
  const isRightSidebar = sidebarPosition === 'right';
  // 'error' must count as inactive: a single failed background update check
  // used to park the store on 'error' forever, permanently suppressing the
  // What's New dialog behind a gate meant for live update UI.
  const isUpdateDialogActive = useUpdateStore((s) => s.status !== 'idle' && s.status !== 'error');
  useKeyboardShortcuts();
  useSessionTracker();
  // Typography is fixed (14px UI / 16px chat, see tailwind.css). Earlier
  // versions layered a webview zoom on top of user font-size settings; the
  // trackpad's pinch gesture arrives as a ctrl+wheel event, so the whole UI
  // grew and shrank on accidental pinches. Both systems are gone on purpose.

  // Keep the i18n locale in sync with the language setting (OS default).
  const language = useSettingsStore((s) => s.settings.language ?? 'system');
  useEffect(() => {
    useI18nStore.getState().setLocale(resolveLocale(language));
  }, [language]);

  // Apply theme and listen for OS preference changes (for 'system' mode)
  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
    if (theme !== 'system') return
    return listenSystemTheme(() => applyTheme('system'))
  }, [theme]);

  // Warm the chat code-block highlighter in the background so the first
  // fenced code block doesn't pay the full Shiki cold-start cost. The
  // returned cleanup cancels the idle callback if App unmounts before it
  // runs (effectively never, but kept for correctness).
  useEffect(() => preloadHighlighterIdle(), []);

  // Pre-warm the terminal WASM runtime (ghostty-web + WebAssembly.compile)
  // during idle time so the first "Open in Terminal" doesn't pay the cold-start.
  useEffect(() => { warmTerminalRuntime() }, []);

  // Sync active workspace → apply per-project model/autoApprove prefs
  useEffect(() => {
    const tasks = useTaskStore.getState().tasks;
    const task = selectedTaskId ? tasks[selectedTaskId] : null;
    // activeWorkspace = project root (for prefs lookup), operationalWorkspace = actual cwd (worktree path if applicable)
    const workspace = task
      ? (task.originalWorkspace ?? task.workspace)
      : pendingWorkspace;
    const operationalWs = task ? task.workspace : pendingWorkspace;
    useSettingsStore.getState().setActiveWorkspace(workspace, operationalWs);
    // Reset mode to default when entering a new/pending thread (no selectedTaskId)
    if (!selectedTaskId) {
      useSettingsStore.setState({ currentModeId: 'code' });
    }
  }, [selectedTaskId, pendingWorkspace]);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [whatsNewEntry, setWhatsNewEntry] = useState<ChangelogEntry | null>(null);

  // Refs to expose current values to the flush-before-quit event listener
  const sidePanelOpenRef = useRef(sidePanelOpen);
  sidePanelOpenRef.current = sidePanelOpen;
  const sidebarCollapsedRef = useRef(isSidebarCollapsed);
  sidebarCollapsedRef.current = isSidebarCollapsed;

  // The side panel is the file tree — mirror the store's open state so the
  // header toggle, ProjectItem's "Reveal in file tree", and ⌘-shortcuts all
  // agree on one source of truth.
  const fileTreeIsOpen = useFileTreeStore((s) => s.isOpen);
  useEffect(() => {
    setSidePanelOpen(fileTreeIsOpen);
  }, [fileTreeIsOpen]);

  useEffect(() => {
    useTaskStore.getState().loadTasks().then(() => {
      useTaskStore.getState().purgeExpiredSoftDeletes();
      // Storage horizons (roadmap phase 4): checkpoint refs pin commits
      // against git gc forever, and analytics grew ~1.6 MB/day unbounded.
      // Both are maintenance, not user actions — failures just log.
      ipc.analyticsPrune(365).catch((e) => console.warn('[maintenance] analytics prune failed:', e));
      for (const ws of useTaskStore.getState().projects) {
        ipc.checkpointPrune(ws, 90).catch(() => {/* not a git repo, or gone */});
      }
      useTaskStore.getState().autoArchiveStaleThreads();
      // Restore persisted UI state (selected thread, view, panels)
      import('@/lib/history-store').then(({ loadUiState }) => {
        loadUiState().then((ui) => {
          if (!ui) return
          const state = useTaskStore.getState()
          const tasks = state.tasks
          const archivedMeta = state.archivedMeta
          if (ui.selectedTaskId && (tasks[ui.selectedTaskId] || archivedMeta[ui.selectedTaskId])) {
            state.setSelectedTask(ui.selectedTaskId)
            const validViews = ['chat', 'dashboard', 'analytics'] as const
            if (validViews.includes(ui.view as typeof validViews[number])) {
              state.setView(ui.view as typeof validViews[number])
            }
          }
          useFileTreeStore.getState().setOpen(ui.sidePanelOpen ?? false)
          setIsSidebarCollapsed(ui.sidebarCollapsed ?? false)
          // Restore split views
          if (ui.splitViews && ui.splitViews.length > 0) {
            const validSplits = ui.splitViews.filter((sv) => tasks[sv.left] && tasks[sv.right])
            if (validSplits.length > 0) {
              useTaskStore.setState({ splitViews: validSplits })
              if (ui.activeSplitId && validSplits.some((sv) => sv.id === ui.activeSplitId)) {
                useTaskStore.getState().setActiveSplit(ui.activeSplitId)
              }
            }
          }
          // Restore pinned threads
          if (ui.pinnedThreadIds && ui.pinnedThreadIds.length > 0) {
            const validPins = ui.pinnedThreadIds.filter((id) => tasks[id])
            if (validPins.length > 0) {
              useTaskStore.setState({ pinnedThreadIds: validPins })
            }
          }
          // Restore per-thread model and mode selections so picks survive
          // restart. Filter to known task ids to avoid leaking entries from
          // deleted threads.
          if (ui.taskModels) {
            const validModels: Record<string, string> = {}
            for (const [tid, mid] of Object.entries(ui.taskModels)) {
              if (tasks[tid] || archivedMeta[tid]) validModels[tid] = mid
            }
            if (Object.keys(validModels).length > 0) {
              useTaskStore.setState({ taskModels: validModels })
            }
          }
          if (ui.taskModes) {
            const validModes: Record<string, string> = {}
            for (const [tid, m] of Object.entries(ui.taskModes)) {
              if (tasks[tid] || archivedMeta[tid]) validModes[tid] = m
            }
            if (Object.keys(validModes).length > 0) {
              useTaskStore.setState({ taskModes: validModes })
            }
          }
        }).catch(() => {})
      })
    });
    useSettingsStore.getState().loadSettings().then(() => {
      useSettingsStore.getState().checkAuth();
      // Apply custom dock icon if set
      const { customAppIcon } = useSettingsStore.getState().settings;
      if (customAppIcon) {
        const base64 = customAppIcon.replace(/^data:[^;]+;base64,/, '');
        ipc.setDockIcon(base64).catch(() => {});
      }
    });
    // Backfill compat flags on custom providers registered before the
    // conservative defaults existed — without them, endpoints like Upstage
    // reject every request with "400 Unrecognized request arguments: store".
    ipc.repairCustomProviders().catch(() => {});
    // Pre-warm the agent connection to get models before the first thread
    ipc.probeCapabilities().catch(() => {});
    // Purge expired soft-deleted threads every hour
    const purgeInterval = setInterval(() => {
      useTaskStore.getState().purgeExpiredSoftDeletes();
    }, 60 * 60 * 1000);
    // Auto-save thread history every 30s as a safety net
    const autoSaveInterval = setInterval(() => {
      useTaskStore.getState().persistHistory()
      useTaskStore.getState().persistUiState()
    }, 30_000);
    // Request notification permission so end_turn alerts work
    import("@tauri-apps/plugin-notification").then(({ isPermissionGranted, requestPermission, onAction }) => {
      isPermissionGranted().then((granted) => {
        if (!granted) requestPermission();
      });
      // Navigate to the task when user clicks a notification
      onAction((notification) => {
        const tid = (notification as { extra?: Record<string, unknown> }).extra?.taskId as string | undefined;
        if (tid) navigateToNotifiedTask(tid);
      }).catch(() => {});
    }).catch(() => {});
    // Clear notification badges when the user returns to the app — if they
    // can see the window, they don't need attention indicators anymore.
    const handleWindowFocus = () => {
      const { notifiedTaskIds } = useTaskStore.getState()
      if (notifiedTaskIds.length > 0) {
        useTaskStore.setState({ notifiedTaskIds: [] })
      }
    };
    window.addEventListener("focus", handleWindowFocus);
    const cleanupTask = initTaskListeners();
    const cleanupResources = initResourceListeners();
    // Begin probing the prime-agent subprocess so we can show "reconnecting…"
    // banners and clear stale latency entries on disconnect.
    const cleanupHealth = startConnectionHealthMonitor();
    startAutoFlush();
    // Listen for native menu events. Registration is async, and under
    // StrictMode's double-mount the first cleanup can run before `listen()`
    // resolves — the resolved unlisten was then stored into a dead closure and
    // never called, leaving dev builds with double flush-acks and double
    // cross-window reloads. Same cancelled-flag pattern as `tauriListen` in
    // lib/ipc.ts: if the promise resolves after cleanup, unlisten immediately
    // instead of storing.
    let listenersCancelled = false
    const menuUnlistens: Array<() => void> = []
    const keepUnlisten = (fn: () => void) => {
      if (listenersCancelled) {
        // Defer to avoid a synchronous throw from Tauri's internal listener map
        setTimeout(() => { try { fn() } catch { /* stale listener */ } }, 0)
      } else {
        menuUnlistens.push(fn)
      }
    }
    import('@tauri-apps/api/event').then(({ listen }) => {
      // Rust emits this right before app.exit(0) — flush all state to disk
      listen('app://flush-before-quit', () => {
        useTaskStore.getState().persistHistory()
        import('@/lib/history-store').then((hs) => {
          const { selectedTaskId, view, splitViews, activeSplitId, pinnedThreadIds, taskModels, taskModes } = useTaskStore.getState()
          hs.saveUiState({
            selectedTaskId,
            view,
            sidePanelOpen: sidePanelOpenRef.current,
            sidebarCollapsed: sidebarCollapsedRef.current,
            splitViews,
            activeSplitId,
            pinnedThreadIds,
            taskModels,
            taskModes,
          }).catch(() => {})
          hs.flush().then(() => {
            // Ack the flush so Rust can proceed with shutdown
            import('@tauri-apps/api/event').then(({ emit }) => {
              emit('app://flush-ack').catch(() => {})
            })
          }).catch(() => {
            // Ack even on failure so Rust doesn't hang
            import('@tauri-apps/api/event').then(({ emit }) => {
              emit('app://flush-ack').catch(() => {})
            })
          })
        }).catch(() => {
          import('@tauri-apps/api/event').then(({ emit }) => {
            emit('app://flush-ack').catch(() => {})
          })
        })
      }).then(keepUnlisten).catch(() => {})
      listen('menu-new-thread', () => {
        const state = useTaskStore.getState()
        const task = state.selectedTaskId ? state.tasks[state.selectedTaskId] : null
        const workspace = task
          ? (task.originalWorkspace ?? task.workspace)
          : state.projects[0]
        if (workspace) {
          state.setPendingWorkspace(workspace)
        }
      }).then(keepUnlisten).catch(() => {})
      listen('menu-new-project', () => {
        useTaskStore.getState().setNewProjectOpen(true)
      }).then(keepUnlisten).catch(() => {})
      listen<string>('menu-open-recent-project', (event) => {
        const path = event.payload
        if (!path) return
        const state = useTaskStore.getState()
        state.addProject(path)
        state.setPendingWorkspace(path)
      }).then(keepUnlisten).catch(() => {})
    }).catch(() => {})
    // Cross-window state sync — reload when another window persists changes.
    // Same async-registration hazard as the menu listeners above.
    let unsubSync: (() => void) | null = null
    let syncDebounce: ReturnType<typeof setTimeout> | null = null
    import('@/lib/history-store').then(({ subscribeToChanges, isSelfWriting }) => {
      // Skip sync reloads when:
      // 1. This window wrote the change (isSelfWriting) — avoids reloading our own saves
      // 2. This window has live agent sessions — loadTasks would overwrite running/paused tasks
      const shouldSkipSync = () => isSelfWriting() || Object.values(useTaskStore.getState().tasks).some(
        (t) => t.status === 'running' || t.status === 'paused',
      )
      const handleChange = () => {
        if (listenersCancelled || shouldSkipSync()) return
        if (syncDebounce) clearTimeout(syncDebounce)
        syncDebounce = setTimeout(() => {
          useTaskStore.getState().loadTasks()
        }, 300)
      }
      subscribeToChanges(handleChange, handleChange).then((fn) => {
        if (listenersCancelled) {
          fn()
        } else {
          unsubSync = fn
        }
      }).catch(() => {})
    }).catch(() => {})
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      clearInterval(purgeInterval);
      clearInterval(autoSaveInterval);
      stopAutoFlush();
      cleanupTask();
      cleanupResources();
      cleanupHealth();
      listenersCancelled = true
      for (const fn of menuUnlistens) {
        // Defer to avoid the "listeners[eventId].handlerId" crash during
        // HMR/StrictMode cleanup (see tauriListen in lib/ipc.ts)
        setTimeout(() => { try { fn() } catch { /* already removed */ } }, 0)
      }
      menuUnlistens.length = 0
      if (unsubSync) unsubSync()
      if (syncDebounce) clearTimeout(syncDebounce)
    };
  }, []);

  // selection-new-thread: open new pending chat in the same workspace, pre-filled with the selection
  useEffect(() => {
    const h = (e: Event) => {
      const { text, workspace } = (e as CustomEvent<{ text: string; workspace?: string | null }>).detail ?? {}
      if (!text) return
      const state = useTaskStore.getState()
      const ws = workspace ?? state.projects[0]
      if (!ws) return
      state.setPendingWorkspace(ws)
      // After the pending chat mounts it listens for splash-insert
      requestAnimationFrame(() => {
        document.dispatchEvent(new CustomEvent('splash-insert', { detail: text }))
      })
    }
    document.addEventListener('selection-new-thread', h)
    return () => document.removeEventListener('selection-new-thread', h)
  }, [])

  // Show "What's New" dialog once after a version upgrade.
  useEffect(() => {
    if (!settingsLoaded) return;
    getVersion().then((currentVersion) => {
      const { settings, saveSettings } = useSettingsStore.getState();
      const lastSeen = settings.lastSeenChangelogVersion;
      // Fresh install — seed the version silently, don't show dialog
      if (!lastSeen) {
        saveSettings({ ...settings, lastSeenChangelogVersion: currentVersion }).catch(() => {});
        return;
      }
      // Only show if current version is strictly newer than last seen
      if (!isNewerVersion(currentVersion, lastSeen)) return;
      // Find a matching entry, or fall back to the newest entry newer than lastSeen
      const entry = CHANGELOG.find((e) => e.version === currentVersion)
        ?? CHANGELOG.find((e) => isNewerVersion(e.version, lastSeen));
      if (entry) {
        setWhatsNewEntry(entry);
      } else {
        // No entry found — still update lastSeen so we don't re-check every launch
        saveSettings({ ...settings, lastSeenChangelogVersion: currentVersion }).catch(() => {});
      }
    }).catch(() => {});
  }, [settingsLoaded]);

  // `/changelog` shows the same dialog on demand, always the newest entry.
  useEffect(() => {
    const handleShow = () => setWhatsNewEntry(CHANGELOG[0] ?? null);
    document.addEventListener("slash-changelog", handleShow);
    return () => document.removeEventListener("slash-changelog", handleShow);
  }, []);

  // ⌘B keyboard shortcut to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setIsSidebarCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleSidePanel = useCallback(() => {
    useFileTreeStore.getState().toggle()
  }, [])
  const closeSidePanel = useCallback(() => {
    useFileTreeStore.getState().setOpen(false)
  }, [])
  const toggleSidebar = useCallback(() => setIsSidebarCollapsed((v) => !v), []);

  const handleWhatsNewDismiss = useCallback(() => {
    setWhatsNewEntry(null);
    getVersion().then((v) => {
      const { settings, saveSettings } = useSettingsStore.getState();
      saveSettings({ ...settings, lastSeenChangelogVersion: v }).catch(() => {});
    }).catch(() => {});
  }, []);

  if (settingsLoaded && !hasOnboardedV2)
    return (
      // Inside a boundary: this early return sits outside the tree below, so a
      // failed chunk fetch used to escape to the root handler, which offers to
      // delete the user's app data — actively wrong advice for a transient
      // network or disk error, and offered to someone on their first run.
      <ErrorBoundary>
        <Suspense fallback={<PanelFallback />}>
          <Onboarding />
        </Suspense>
      </ErrorBoundary>
    );

  return (
    <TooltipProvider delayDuration={300}>
      <div data-testid="app-container" className="flex h-full gap-3 p-3 bg-background text-foreground">
        {/* Sidebar — full height, bleeds into top */}
        <ErrorBoundary>
          {!isSidebarCollapsed && <TaskSidebar width={sidebarWidth} onResize={setSidebarWidth} position={sidebarPosition} onCollapse={toggleSidebar} />}
        </ErrorBoundary>

        {/* Right column: header + content */}
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", isRightSidebar && "order-first")}>
          {/* Top-level breadcrumb header */}
          <ErrorBoundary>
            <AppHeader
              isSidebarCollapsed={isSidebarCollapsed}
              onToggleSidebar={toggleSidebar}
              sidebarPosition={sidebarPosition}
            />
          </ErrorBoundary>

          {/* Connection trouble, where the user is actually looking. The
              sidebar dot disappears with the sidebar; this does not. */}
          <ErrorBoundary fallback={null}>
            <ConnectionBanner />
          </ErrorBoundary>

          {/* Main area: content + side panel */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <main data-testid="main-content" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <ErrorBoundary>
              <div
                className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                style={{ fontSize: 'var(--app-font-size, 13px)' }}
              >
                <Suspense fallback={<PanelFallback />}>
                  {view === 'analytics' ? (
                    <AnalyticsDashboard />
                  ) : selectedTaskId && activeSplitId ? (
                    <SplitChatLayout />
                  ) : selectedTaskId ? (
                    <ChatPanel />
                  ) : pendingWorkspace ? (
                    <PendingChat key={pendingWorkspace} workspace={pendingWorkspace} />
                  ) : (
                    <EmptyState />
                  )}
                </Suspense>
              </div>
            </ErrorBoundary>
            {sidePanelOpen && !activeSplitId && (selectedTaskId || pendingWorkspace) && (
              <ErrorBoundary>
                <Suspense fallback={<PanelFallback />}>
                  <FileTreePanel onClose={closeSidePanel} workspace={pendingWorkspace ?? undefined} />
                </Suspense>
              </ErrorBoundary>
            )}
          </main>
          </div>

          {/* Bottom debug panel */}
          {debugOpen && (
            <ErrorBoundary>
              <Suspense fallback={<PanelFallback />}>
                <DebugPanel />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
      </div>
      <ErrorBoundary>
        <NewProjectSheet />
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={<PanelFallback />}>
          <SettingsPanel />
        </Suspense>
      </ErrorBoundary>
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 8000,
          classNames: {
            toast: 'sonner-toast',
            title: 'sonner-title',
            description: 'sonner-description',
            actionButton: 'sonner-action',
          },
        }}
        theme="dark"
      />
      <UpdateAvailableDialog />
      <ErrorBoundary>
        <GlobalFilePreviewModal />
      </ErrorBoundary>
      {whatsNewEntry && !isUpdateDialogActive && (
        <WhatsNewDialog open={!!whatsNewEntry} entry={whatsNewEntry} onDismiss={handleWhatsNewDismiss} />
      )}
    </TooltipProvider>
  );
}
