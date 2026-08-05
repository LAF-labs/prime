import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  IconChevronRight, IconCircle, IconCheck,
  IconLoader2, IconAlertTriangle, IconLock, IconLockOpen,
  IconPlugOff, IconBan, IconCircleCheck, IconTerminal, IconTrash,
} from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useKiroStore } from '@/stores/kiroStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDebugStore } from '@/stores/debugStore'
import { useTaskStore } from '@/stores/taskStore'
import { ipc } from '@/lib/ipc'
import type { KiroMcpServer } from '@/types'
import { type ViewerState, SourceDot } from './kiro-config-helpers'

export const McpRow = memo(function McpRow({ server, onOpen }: { server: KiroMcpServer; onOpen: (v: ViewerState) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const ctxRef = useRef<HTMLDivElement>(null)

  const liveMcp = useSettingsStore((s) => s.liveMcpServers.find((m) => m.name === server.name))
  const kiroBin = useSettingsStore((s) => s.settings.kiroBin)
  const commands = useSettingsStore((s) => s.availableCommands)
  const activeWorkspace = useTaskStore((s) => {
    const id = s.selectedTaskId
    if (id) {
      const t = s.tasks[id]
      return t?.originalWorkspace ?? t?.workspace
    }
    return s.pendingWorkspace
  }) ?? null

  const isReady = server.status === 'ready' || liveMcp?.status === 'ready'
  const hasTools = (liveMcp?.toolCount ?? 0) > 0
  const isExpandable = server.enabled && isReady && hasTools
  const allToolsDisabled = server.disabledTools?.includes('*')
  const needsAuth = server.status === 'needs-auth'

  // MCP tool names follow `mcp__<server>__<tool>`. Match flexibly because some
  // CLI versions just use a single underscore separator.
  const serverTools = useMemo(() => commands.filter((c) => {
    const n = c.name.toLowerCase()
    const sn = server.name.toLowerCase().replace(/-/g, '_')
    return n.startsWith(`mcp__${sn}__`) || n.startsWith(`${sn}__`) || n.startsWith(`${sn}_`)
  }), [commands, server.name])

  const toolCount = liveMcp?.toolCount ?? 0
  const hasIndividuallyDisabled = !allToolsDisabled && (server.disabledTools?.length ?? 0) > 0
  const enabledToolCount = allToolsDisabled
    ? 0
    : Math.max(0, toolCount - (server.disabledTools?.length ?? 0))

  // Status icon at the row's right edge — replaces the truncated text label
  // ("Disablea", "Auth requir…") with a single recognisable glyph.
  let statusIcon: React.ReactNode = null
  let statusTooltip = ''
  if (!server.enabled) {
    statusTooltip = 'Disabled · enable to expose tools to new threads'
    statusIcon = <IconPlugOff className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
  } else if (needsAuth) {
    statusTooltip = 'Authentication required — click to open OAuth flow'
    statusIcon = <IconLock className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
  } else if (server.status === 'error') {
    statusTooltip = server.error ?? 'Connection error'
    statusIcon = <IconAlertTriangle className="size-3 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
  } else if (server.status === 'connecting') {
    statusTooltip = 'Connecting…'
    statusIcon = <IconLoader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
  } else if (isReady) {
    statusTooltip = allToolsDisabled
      ? `Connected · all ${toolCount} tools disabled`
      : `Connected · ${enabledToolCount}/${toolCount} tools enabled`
  }

  const dotClass = !server.enabled
    ? 'fill-muted-foreground/50 text-muted-foreground/50'
    : server.status === 'error' || needsAuth
      ? 'fill-red-500 text-red-500'
      : isReady
        ? allToolsDisabled
          ? 'fill-amber-500 text-amber-500'
          : 'fill-emerald-500 text-emerald-500'
        : 'fill-muted-foreground text-muted-foreground'

  // Dismiss the context menu on outside-click, scroll, or window blur. Same
  // pattern as the file-tree context menu.
  useEffect(() => {
    if (!ctxMenu) {
      setConfirmRemove(false)
      return
    }
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    const dismiss = () => setCtxMenu(null)
    document.addEventListener('mousedown', handler)
    window.addEventListener('blur', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [ctxMenu])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const menuWidth = 200
    const menuHeight = 220
    const x = Math.min(e.clientX, window.innerWidth - menuWidth)
    const y = Math.min(e.clientY, window.innerHeight - menuHeight)
    setCtxMenu({ x, y })
  }, [])

  const handleToggleEnabled = useCallback(() => {
    setCtxMenu(null)
    useKiroStore.getState().toggleMcpServer(server.name, server.enabled)
  }, [server.name, server.enabled])

  const handleDisableAllTools = useCallback(() => {
    setCtxMenu(null)
    useKiroStore.getState().setMcpDisabledTools(server.name, ['*'])
  }, [server.name])

  const handleEnableAllTools = useCallback(() => {
    setCtxMenu(null)
    useKiroStore.getState().setMcpDisabledTools(server.name, [])
  }, [server.name])

  const handleShowLogs = useCallback(() => {
    setCtxMenu(null)
    useDebugStore.getState().setFilter({ mcpServerName: server.name })
    useDebugStore.getState().setOpen(true)
  }, [server.name])

  /**
   * Open the OAuth URL the kiro-cli emitted via the
   * `kiro.dev/mcp/oauth_request` notification. Per the docs, mid-session token
   * refresh is automatic, but the very first sign-in needs a click to open the
   * provider's authorization page.
   */
  const handleAuthenticate = useCallback(() => {
    setCtxMenu(null)
    if (!server.oauthUrl) {
      toast.info('No OAuth URL yet', {
        description: 'Send a message in a thread to trigger the connection, then try again.',
      })
      return
    }
    ipc.openUrl(server.oauthUrl).catch((e) => {
      toast.error('Could not open browser', { description: e instanceof Error ? e.message : String(e) })
    })
  }, [server.oauthUrl])

  /**
   * Remove the server through `kiro-cli mcp remove`. Going through the CLI
   * keeps registry-mode governance intact and produces the same audit trail
   * the user would get from the terminal.
   *
   * Scope mapping: `server.source` tells us which config file the server came
   * from ('global' or 'local'). We map 'local' → 'workspace' which is correct
   * for the common case. Agent-scoped servers (defined inside an agent JSON's
   * `mcpServers` field) would also have source='local' but need `agent:<name>`
   * scope — that edge case is not yet surfaced in the UI and the CLI will
   * return a clear error if the server isn't found in the workspace config.
   */
  const handleRemove = useCallback(async () => {
    if (removing) return
    // Two-click confirmation: first click arms, second executes.
    if (!confirmRemove) {
      setConfirmRemove(true)
      // Auto-disarm after 4 s so an accidental hover doesn't leave it armed.
      setTimeout(() => setConfirmRemove(false), 4000)
      return
    }
    // Second click — close menu and execute.
    setCtxMenu(null)
    setConfirmRemove(false)
    setRemoving(true)
    try {
      const scope = server.source === 'global' ? 'global' : 'workspace'
      await ipc.mcpRemoveServer(
        { name: server.name, scope },
        activeWorkspace ?? undefined,
        kiroBin,
      )
      toast.success(`Removed "${server.name}"`)
      // The kiro_watcher will refresh the panel automatically.
    } catch (e) {
      toast.error('Could not remove server', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRemoving(false)
    }
  }, [removing, confirmRemove, server.name, server.source, activeWorkspace, kiroBin])

  const handleToggleTool = useCallback((toolName: string) => {
    const current = server.disabledTools ?? []
    const isDisabled = current.includes(toolName) || current.includes('*')
    let next: string[]
    if (current.includes('*')) {
      // Promoting one tool out of "all disabled" → list every other tool.
      const allNames = serverTools.map((t) => t.name)
      next = allNames.filter((n) => n !== toolName)
    } else if (isDisabled) {
      next = current.filter((t) => t !== toolName)
    } else {
      next = [...current, toolName]
    }
    useKiroStore.getState().setMcpDisabledTools(server.name, next)
  }, [server.name, server.disabledTools, serverTools])

  const handleRowClick = useCallback(() => {
    if (needsAuth && server.oauthUrl) {
      // Most direct affordance for the most common stuck state.
      handleAuthenticate()
      return
    }
    if (isExpandable) {
      setExpanded((v) => !v)
    } else if (server.filePath) {
      onOpen({ filePath: server.filePath, title: `MCP: ${server.name}` })
    }
  }, [needsAuth, server.oauthUrl, isExpandable, server.filePath, server.name, onOpen, handleAuthenticate])

  return (
    <>
      <li className="flex flex-col min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              role="button"
              tabIndex={0}
              onClick={handleRowClick}
              onContextMenu={handleContextMenu}
              onKeyDown={(e) => e.key === 'Enter' && handleRowClick()}
              className={cn(
                'flex h-6 min-w-0 w-full items-center gap-1.5 rounded-md px-1.5 text-[11px] cursor-pointer',
                'text-muted-foreground/80 hover:bg-accent/50 hover:text-foreground transition-colors',
                !server.enabled && 'opacity-60',
              )}
            >
              {isExpandable ? (
                <IconChevronRight className={cn('size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150', expanded && 'rotate-90')} aria-hidden />
              ) : (
                <IconCircle className={cn('size-2 shrink-0', dotClass)} aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{server.name}</span>
              {/* Tool count badge — only for connected servers exposing tools. */}
              {server.enabled && isReady && toolCount > 0 && (
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 py-px text-[9px] tabular-nums leading-none',
                    allToolsDisabled
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                  )}
                  title={statusTooltip}
                >
                  {allToolsDisabled ? `0/${toolCount}` : hasIndividuallyDisabled ? `${enabledToolCount}/${toolCount}` : `${enabledToolCount}`}
                </span>
              )}
              {statusIcon}
              <SourceDot source={server.source} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[260px]">
            <p className="text-[11px] font-medium">{server.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {server.transport} · {server.source}{server.enabled ? '' : ' · disabled'}
            </p>
            {statusTooltip && <p className="mt-0.5 text-[10px] text-muted-foreground">{statusTooltip}</p>}
            {allToolsDisabled && <p className="text-[10px] text-amber-600 dark:text-amber-400">All tools disabled</p>}
            {server.error && <p className="mt-0.5 text-[9px] text-red-600 dark:text-red-400 font-mono break-all">{server.error}</p>}
            <p className="mt-1 text-[9px] text-muted-foreground">Right-click for actions · changes apply to new threads</p>
          </TooltipContent>
        </Tooltip>

        {/* Expanded tool list */}
        {expanded && isExpandable && (
          <ul className="ml-4 flex flex-col gap-px py-0.5">
            {allToolsDisabled && (
              <li className="px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400 italic">All tools disabled</li>
            )}
            {serverTools.length > 0 ? (
              serverTools.map((tool) => {
                const toolShort = tool.name.replace(/^mcp__[^_]+__/, '').replace(/^[^_]+__/, '')
                const isDisabled = allToolsDisabled || (server.disabledTools ?? []).includes(tool.name)
                return (
                  <li key={tool.name} className="flex items-center gap-1.5 px-1.5 h-5">
                    <button
                      type="button"
                      onClick={() => handleToggleTool(tool.name)}
                      className={cn(
                        'size-3 shrink-0 rounded border transition-colors',
                        isDisabled
                          ? 'border-muted-foreground/30 bg-transparent'
                          : 'border-emerald-500 bg-emerald-500',
                      )}
                      aria-label={isDisabled ? `Enable ${toolShort}` : `Disable ${toolShort}`}
                    >
                      {!isDisabled && <IconCheck className="size-2.5 text-white" />}
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={cn('text-[10px] truncate', isDisabled && 'line-through text-muted-foreground/60')}>
                          {toolShort}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right">{tool.description ?? tool.name}</TooltipContent>
                    </Tooltip>
                  </li>
                )
              })
            ) : (
              <li className="px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {liveMcp?.toolCount ?? 0} tools available
              </li>
            )}
          </ul>
        )}
      </li>

      {/* Context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-[300] min-w-[200px] rounded-lg border border-border bg-popover py-1 shadow-lg"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {needsAuth && server.oauthUrl && (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
                onClick={handleAuthenticate}
              >
                <IconLockOpen className="size-3.5 text-amber-600 dark:text-amber-400" /> Authenticate
              </button>
              <div className="my-1 border-t border-border/50" />
            </>
          )}
          {server.enabled ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
              onClick={handleToggleEnabled}
            >
              <IconPlugOff className="size-3.5" /> Disable
            </button>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
              onClick={handleToggleEnabled}
            >
              <IconCircleCheck className="size-3.5" /> Enable
            </button>
          )}

          <div className="my-1 border-t border-border/50" />
          {server.enabled && (
            <>
              {!allToolsDisabled && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
                  onClick={handleDisableAllTools}
                >
                  <IconBan className="size-3.5" /> Disable All Tools
                </button>
              )}
              {(server.disabledTools?.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
                  onClick={handleEnableAllTools}
                >
                  <IconCircleCheck className="size-3.5" /> Enable All Tools
                </button>
              )}
              <div className="my-1 border-t border-border/50" />
            </>
          )}

          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
            onClick={handleShowLogs}
          >
            <IconTerminal className="size-3.5" /> Show MCP Logs
          </button>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-[13px] transition-colors hover:bg-accent',
              confirmRemove
                ? 'text-red-600 dark:text-red-400 font-medium'
                : 'text-red-600/80 dark:text-red-400/80',
            )}
            onClick={handleRemove}
            disabled={removing}
          >
            {removing
              ? <IconLoader2 className="size-3.5 animate-spin" />
              : <IconTrash className="size-3.5" />}
            {confirmRemove ? 'Click again to confirm' : 'Remove server…'}
          </button>
        </div>
      )}
    </>
  )
})
