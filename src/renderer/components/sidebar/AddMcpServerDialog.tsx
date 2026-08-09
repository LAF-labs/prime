import { t } from '@/lib/i18n'
import { MOD_KEY } from '@/lib/platform'
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { IconLoader2, IconPlug, IconWorld } from '@tabler/icons-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { ipc } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'

/**
 * Add a new MCP server by writing it into prime-agent's settings.json.
 *
 * prime-agent has no CLI subcommand for managing MCP servers, so the Rust
 * side (`mcp_add_server`) does an atomic read-modify-write of the settings
 * file for the chosen scope: `~/.prime/agent/settings.json` (global) or
 * `<workspace>/.prime/agent/settings.json` (workspace).
 */

type Transport = 'stdio' | 'http'
type Scope = 'global' | 'workspace'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional workspace path so workspace-scope adds end up in the right .agent/. */
  workspace: string | null
}

export function AddMcpServerDialog({ open, onOpenChange, workspace }: Props) {
  const agentBin = useSettingsStore((s) => s.settings.agentBin)

  const [transport, setTransport] = useState<Transport>('stdio')
  const [scope, setScope] = useState<Scope>(workspace ? 'workspace' : 'global')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [url, setUrl] = useState('')
  const [envText, setEnvText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset form whenever the dialog opens (not on every dependency change).
  useEffect(() => {
    if (!open) return
    setTransport('stdio')
    setScope(workspace ? 'workspace' : 'global')
    setName('')
    setCommand('')
    setArgsText('')
    setUrl('')
    setEnvText('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Args: one entry per line OR space-separated on a single line. We pick
  // line-based first since paths and shell strings can include spaces.
  const parsedArgs = useMemo(() => {
    if (!argsText.trim()) return []
    if (argsText.includes('\n')) {
      return argsText.split('\n').map((s) => s.trim()).filter(Boolean)
    }
    return argsText.trim().split(/\s+/)
  }, [argsText])

  const parsedEnv = useMemo(
    () =>
      envText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l.includes('=')),
    [envText],
  )

  const isValidName = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name.trim())
  const canSubmit =
    !submitting &&
    name.trim().length > 0 &&
    isValidName &&
    (transport === 'stdio' ? command.trim().length > 0 : url.trim().startsWith('http'))

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await ipc.mcpAddServer(
        {
          name: name.trim(),
          scope,
          command: transport === 'stdio' ? command.trim() : undefined,
          args: transport === 'stdio' ? parsedArgs : [],
          url: transport === 'http' ? url.trim() : undefined,
          env: parsedEnv,
          force: false,
        },
        workspace ?? undefined,
        agentBin,
      )
      toast.success(t('Added MCP server "{name}"', { name: name.trim() }), {
        description: t('Scope: {scope}. New chat threads will pick it up automatically.', { scope }),
      })
      // The resource_watcher will fire onAgentResourcesChanged → resourceStore reloads.
      // No need to invalidate here.
      onOpenChange(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(t('Could not add MCP server'), { description: msg })
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, scope, name, transport, command, parsedArgs, url, parsedEnv, workspace, agentBin, onOpenChange])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (canSubmit) {
          e.preventDefault()
          void submit()
        }
      }
    },
    [canSubmit, submit],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('Add MCP server')}</DialogTitle>
          <DialogDescription>
            {t('Registers the server in the agent settings for the scope you pick. New chat threads pick it up automatically.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 py-3">
          {/* Transport */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setTransport('stdio')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors',
                transport === 'stdio'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <IconPlug className="size-3.5" /> {t('Local (stdio)')}
            </button>
            <button
              type="button"
              onClick={() => setTransport('http')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors border-l border-border',
                transport === 'http'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <IconWorld className="size-3.5" /> {t('Remote (HTTP)')}
            </button>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">{t('Name')}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. aws-docs"
              autoFocus
            />
            {name && !isValidName && (
              <p className="text-[11px] text-red-600 dark:text-red-400">
                Name must start with a letter or digit and contain only letters, digits, dashes, or underscores.
              </p>
            )}
          </div>

          {/* Scope */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">{t('Scope')}</label>
            <div className="flex items-center rounded-md border border-border overflow-hidden">
              <ScopeButton active={scope === 'global'} onClick={() => setScope('global')} label="Global" hint="~/.prime/agent/settings.json" />
              <ScopeButton
                active={scope === 'workspace'}
                onClick={() => setScope('workspace')}
                label="Workspace"
                hint=".prime/agent/settings.json"
                disabled={!workspace}
                divider
              />
            </div>
            <p className="font-mono text-[11px] text-muted-foreground/70">
              {scope === 'global'
                ? '~/.prime/agent/settings.json'
                : '.prime/agent/settings.json'}
            </p>
          </div>

          {/* Connection details */}
          {transport === 'stdio' ? (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground">{t('Command')}</label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="uvx, npx, /path/to/binary…"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {t('Arguments')} <span className="text-muted-foreground/60">(one per line, or space-separated)</span>
                </label>
                <Textarea
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  rows={2}
                  placeholder="awslabs.aws-documentation-mcp-server@latest"
                  className="font-mono text-[12px]"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">{t('URL')}</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/mcp"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('OAuth flows trigger automatically the first time the server connects.')}
              </p>
            </div>
          )}

          {/* Env */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              {t('Environment variables')} <span className="text-muted-foreground/60">(KEY=VALUE, one per line)</span>
            </label>
            <Textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              rows={3}
              placeholder={'BRAVE_API_KEY=${BRAVE_API_KEY}\nFASTMCP_LOG_LEVEL=ERROR'}
              className="font-mono text-[12px]"
            />
            <p className="text-[11px] text-muted-foreground">
              {t('Use')} <code className="font-mono">{'${VAR}'}</code> to reference env vars from your shell instead of hardcoding secrets.
            </p>
          </div>
        </div>

        <DialogFooter>
          <span className="text-[11px] text-muted-foreground/70 sm:mr-auto sm:self-center">
            {t('Esc to cancel · {mod}↵ to add', { mod: MOD_KEY })}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('Cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting && <IconLoader2 className="mr-1 size-3.5 animate-spin" />}
            Add server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScopeButton({
  active, onClick, label, hint, disabled, divider,
}: {
  active: boolean
  onClick: () => void
  label: string
  hint: string
  disabled?: boolean
  divider?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            'flex flex-1 items-center justify-center px-3 py-1.5 text-[12px] font-medium transition-colors',
            divider && 'border-l border-border',
            active
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/50',
            disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
          )}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-[11px]">
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}
