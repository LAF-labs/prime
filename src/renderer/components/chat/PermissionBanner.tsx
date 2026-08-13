import { t } from '@/lib/i18n'
import { memo, useMemo } from 'react'
import { IconShieldExclamation, IconCheck, IconX } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

/** Display order for permission options; module-level so hooks don't depend on it. */
const ORDER = ['allow_once', 'allow_always', 'reject_once', 'reject_always']

interface PermissionOption {
  optionId: string
  name: string
  kind: string
}

interface PermissionBannerProps {
  taskId: string
  toolName: string
  description: string
  options: PermissionOption[]
  onSelect: (optionId: string) => void
}

/**
 * What the tool is, in the words of someone who does not write software.
 *
 * The fallback still de-snake-cases an unknown name, which is all this used to
 * do — and "bash" told a non-developer nothing about what was about to happen
 * to their computer.
 */
const FRIENDLY_TOOL_NAMES: Record<string, () => string> = {
  bash: () => t('run a command on your computer'),
  write_file: () => t('save a file'),
  organize: () => t('move or copy files'),
  read_file: () => t('read a file'),
  list_dir: () => t('look inside a folder'),
}

function formatToolName(raw: string): string {
  if (!raw || raw === 'unknown') return t('a tool')
  const friendly = FRIENDLY_TOOL_NAMES[raw]
  if (friendly) return friendly()
  return raw
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
}

const KIND_STYLES: Record<string, string> = {
  allow_once: 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400',
  allow_always: 'bg-emerald-500/5 text-emerald-600/80 hover:bg-emerald-500/15 dark:text-emerald-400/80',
  reject_once: 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
  reject_always: 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive/80',
}

const KIND_ICONS: Record<string, typeof IconCheck | null> = {
  allow_once: IconCheck,
  allow_always: IconCheck,
  reject_once: IconX,
  reject_always: IconX,
}

export const PermissionBanner = memo(function PermissionBanner({
  toolName, description, options, onSelect,
}: PermissionBannerProps) {
  const displayName = formatToolName(toolName)

  /**
   * The gate puts a plain-language line first and the literal argument — a
   * path, or the shell command about to run — on the lines after it.
   */
  const [headline, ...detailLines] = (description ?? '').split('\n')
  const detail = detailLines.join('\n').trim()

  const sorted = useMemo(() => [...options].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)), [options])

  return (
    <div data-testid="permission-banner" className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-2 sm:px-6 lg:max-w-4xl xl:max-w-5xl">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
        <IconShieldExclamation className="mt-0.5 size-5 shrink-0 text-amber-500 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-muted-foreground">
            {/* One interpolated sentence so Korean can put the tool before the
                verb — never stitch word-order-sensitive fragments. */}
            {t('LAF Agent wants to {tool}').split('{tool}').map((part, i) =>
              i === 0
                ? <span key="before">{part}</span>
                : [<span key="tool" className="font-medium text-foreground">{displayName}</span>, <span key="after">{part}</span>],
            )}
          </p>
          {/* This is what the whole dialog is for, and it was computed, sent
              over RPC, put in the store and passed in as a prop — then dropped,
              because the component never destructured it. Approving meant
              approving a tool name: not the file, not the command. */}
          {headline?.trim() && (
            <p data-testid="permission-headline" className="mt-0.5 text-[13px] break-words text-foreground">
              {headline.trim()}
            </p>
          )}
          {detail && (
            <pre
              data-testid="permission-detail"
              className="mt-1 max-h-24 overflow-y-auto overscroll-contain whitespace-pre-wrap break-all rounded-md bg-muted/60 px-2 py-1 font-mono text-[11.5px] text-muted-foreground"
            >{detail}</pre>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {sorted.map((opt) => {
            const Icon = KIND_ICONS[opt.kind]
            return (
              <button
                key={opt.optionId}
                onClick={() => onSelect(opt.optionId)}
                className={cn(
                  'inline-flex min-h-[28px] items-center gap-1 rounded-md px-3 py-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  KIND_STYLES[opt.kind] ?? 'text-muted-foreground hover:bg-accent',
                )}
              >
                {Icon && <Icon className="size-3" />}
                {opt.name}
              </button>
            )
          })}
          {sorted.length === 0 && (
            <>
              <button
                onClick={() => onSelect('__allow__')}
                className="inline-flex min-h-[28px] items-center gap-1 rounded-md bg-emerald-500/10 px-3 py-2 text-[12px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <IconCheck className="size-3" /> {t('Allow')}
              </button>
              <button
                onClick={() => onSelect('__deny__')}
                className="inline-flex min-h-[28px] items-center gap-1 rounded-md px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <IconX className="size-3" /> {t('Deny')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
})
