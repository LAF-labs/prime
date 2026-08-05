import { useState, useRef, useEffect } from 'react'
import { IconChevronDown, IconCode, IconFolder, IconTerminal2 } from '@tabler/icons-react'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'

interface EditorInfo {
  bin: string
  label: string
  icon: React.ReactNode
}

/** Reusable wrapper for simple-icons 24x24 SVG paths */
const BrandIcon = ({ d }: { d: string }) => (
  <svg aria-hidden className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d={d} />
  </svg>
)

const ZedIcon = () => (
  <svg aria-hidden className="size-3.5" fill="none" viewBox="0 0 96 96">
    <g clipPath="url(#zed-a)">
      <path fill="currentColor" fillRule="evenodd" d="M9 6a3 3 0 0 0-3 3v66H0V9a9 9 0 0 1 9-9h80.379c4.009 0 6.016 4.847 3.182 7.682L43.055 57.187H57V51h6v7.688a4.5 4.5 0 0 1-4.5 4.5H37.055L26.743 73.5H73.5V36h6v37.5a6 6 0 0 1-6 6H20.743L10.243 90H87a3 3 0 0 0 3-3V21h6v66a9 9 0 0 1-9 9H6.621c-4.009 0-6.016-4.847-3.182-7.682L52.757 39H39v6h-6v-7.5a4.5 4.5 0 0 1 4.5-4.5h21.257l10.5-10.5H22.5V60h-6V22.5a6 6 0 0 1 6-6h52.757L85.757 6H9Z" clipRule="evenodd" />
    </g>
    <defs><clipPath id="zed-a"><path fill="#fff" d="M0 0h96v96H0z" /></clipPath></defs>
  </svg>
)

const CursorIcon = () => (
  <svg aria-hidden className="size-3.5" viewBox="0 0 24 24" fill="none">
    <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z" fill="currentColor" />
  </svg>
)

/* ── Brand icon paths from simple-icons (simpleicons.org, CC0) ── */
const SI_GHOSTTY = "M12 0C6.7 0 2.4 4.3 2.4 9.6v11.146c0 1.772 1.45 3.267 3.222 3.254a3.18 3.18 0 0 0 1.955-.686 1.96 1.96 0 0 1 2.444 0 3.18 3.18 0 0 0 1.976.686c.75 0 1.436-.257 1.98-.686.715-.563 1.71-.587 2.419-.018.59.476 1.355.743 2.182.699 1.705-.094 3.022-1.537 3.022-3.244V9.601C21.6 4.3 17.302 0 12 0M6.069 6.562a1 1 0 0 1 .46.131l3.578 2.065v.002a.974.974 0 0 1 0 1.687L6.53 12.512a.975.975 0 0 1-.976-1.687L7.67 9.602 5.553 8.38a.975.975 0 0 1 .515-1.818m7.438 2.063h4.7a.975.975 0 1 1 0 1.95h-4.7a.975.975 0 0 1 0-1.95"
const SI_ITERM2 = "M24 5.359v13.282A5.36 5.36 0 0 1 18.641 24H5.359A5.36 5.36 0 0 1 0 18.641V5.359A5.36 5.36 0 0 1 5.359 0h13.282A5.36 5.36 0 0 1 24 5.359m-.932-.233A4.196 4.196 0 0 0 18.874.932H5.126A4.196 4.196 0 0 0 .932 5.126v13.748a4.196 4.196 0 0 0 4.194 4.194h13.748a4.196 4.196 0 0 0 4.194-4.194zm-.816.233v13.282a3.613 3.613 0 0 1-3.611 3.611H5.359a3.613 3.613 0 0 1-3.611-3.611V5.359a3.613 3.613 0 0 1 3.611-3.611h13.282a3.613 3.613 0 0 1 3.611 3.611M8.854 4.194v6.495h.962V4.194zM5.483 9.493v1.085h.597V9.48q.283-.037.508-.133.373-.165.575-.448.208-.284.208-.649a.9.9 0 0 0-.171-.568 1.4 1.4 0 0 0-.426-.388 3 3 0 0 0-.544-.261 32 32 0 0 0-.545-.209 1.8 1.8 0 0 1-.426-.216q-.164-.12-.164-.284 0-.223.179-.351.18-.126.485-.127.344 0 .575.105.239.105.5.298l.433-.5a2.3 2.3 0 0 0-.605-.433 1.6 1.6 0 0 0-.582-.159v-.968h-.597v.978a2 2 0 0 0-.477.127 1.2 1.2 0 0 0-.545.411q-.194.268-.194.634 0 .335.164.56.164.224.418.38a4 4 0 0 0 .552.262q.291.104.545.209.261.104.425.238a.39.39 0 0 1 .165.321q0 .225-.187.359-.18.134-.537.134-.381 0-.717-.134a4.4 4.4 0 0 1-.649-.351l-.388.589q.209.173.477.306.276.135.575.217.191.046.373.064"
const SI_ALACRITTY = "m10.065 0-8.57 21.269h3.595l6.91-16.244 6.91 16.244h3.594l-8.57-21.269zm1.935 9.935c-0.76666 1.8547-1.5334 3.7094-2.298 5.565 1.475 4.54 1.475 4.54 2.298 8.5 0.823-3.96 0.823-3.96 2.297-8.5-0.76637-1.8547-1.5315-3.7099-2.297-5.565z"
const SI_WEZTERM = "M3.27 8.524c0-.623.62-1.007 2.123-1.007l-.5 2.757c-.931-.623-1.624-1.199-1.624-1.75zm4.008 6.807c0 .647-.644 1.079-2.123 1.15l.524-2.924c.931.624 1.6 1.175 1.6 1.774zm-2.625 5.992.454-2.708c3.603-.336 5.01-1.798 5.01-3.404 0-1.653-2.004-2.948-3.841-4.074l.668-3.548c.764.072 1.67.216 2.744.432l.31-2.469c-.81-.12-1.575-.168-2.29-.216L8.257 2.7l-2.363-.024-.453 2.684C1.838 5.648.43 7.158.43 8.764c0 1.63 2.004 2.876 3.841 3.954l-.668 3.716c-.859-.048-1.908-.192-3.125-.408L0 18.495c1.026.12 1.98.192 2.84.216l-.525 2.588zm15.553-1.894h2.673c.334-2.804.81-8.46 1.121-14.86h-2.553c-.071 1.51-.334 10.498-.43 11.241h-.071c-.644-2.42-1.169-4.386-1.813-6.782h-1.456c-.62 2.396-1.05 4.194-1.694 6.782h-.096c-.071-.743-.477-9.73-.525-11.24h-2.648c.31 6.399.763 12.055 1.097 14.86h2.625l1.838-7.12z"
const SI_HYPER = "M13.565 17.91H24v1.964H13.565zm-3.201-5.09l-9.187 8.003 2.86-7.004L0 11.179l9.187-8.002-3.11 7.451z"
const SI_TMUX = "M24 2.251V10.5H12.45V0h9.3A2.251 2.251 0 0 1 24 2.251zM12.45 11.4H24v10.5h-.008A2.25 2.25 0 0 1 21.75 24H2.25a2.247 2.247 0 0 1-2.242-2.1H0V2.251A2.251 2.251 0 0 1 2.25 0h9.3v21.6h.9V11.4zm11.242 10.5H.308a1.948 1.948 0 0 0 1.942 1.8h19.5a1.95 1.95 0 0 0 1.942-1.8z"
const SI_WINDOWS_TERMINAL = "M8.165 6V3h7.665v3H8.165zm-.5-3H1c-.55 0-1 .45-1 1v2h7.665V3zM23 3h-6.67v3H24V4c0-.55-.45-1-1-1zM0 6.5h24V20c0 .55-.45 1-1 1H1c-.55 0-1-.45-1-1V6.5zM11.5 18c0 .3.2.5.5.5h8c.3 0 .5-.2.5-.5v-1.5c0-.3-.2-.5-.5-.5h-8c-.3 0-.5.2-.5.5V18zm-5.2-4.55l-3.1 3.1c-.25.25-.25.6 0 .8l.9.9c.25.25.6.25.8 0l4.4-4.4a.52.52 0 0 0 0-.8l-4.4-4.4c-.2-.2-.6-.2-.8 0l-.9.9c-.25.2-.25.55 0 .8l3.1 3.1z"
const SI_INTELLIJ = "M0 0v24h24V0zm3.723 3.111h5v1.834h-1.39v6.277h1.39v1.834h-5v-1.834h1.444V4.945H3.723zm11.055 0H17v6.5c0 .612-.055 1.111-.222 1.556-.167.444-.39.777-.723 1.11-.277.279-.666.557-1.11.668a3.933 3.933 0 0 1-1.445.278c-.778 0-1.444-.167-1.944-.445a4.81 4.81 0 0 1-1.279-1.056l1.39-1.555c.277.334.555.555.833.722.277.167.611.278.945.278.389 0 .721-.111 1-.389.221-.278.333-.667.333-1.278zM2.222 19.5h9V21h-9z"
const SI_VSCODE = "M1.292 6.293l-.009.009L.065 5.09A.5.5 0 010 4.8V1.2a.5.5 0 01.065-.29L1.283.098l.009.009L8.37 5.657 1.292 6.293zm0 11.414l-.009-.009L.065 18.91A.5.5 0 010 19.2v3.6a.5.5 0 00.065.29l1.218.812.009-.009 7.078-5.55-7.078-.636zm.009-.009L8.37 12 1.301 6.302l-.009.009v11.378l.009.009zM9.929 12L2.85 6.302l8.585-5.55.009.009L22.718.098A.5.5 0 0123 .388v.412L9.929 12zm0 0L23 23.2v.412a.5.5 0 01-.282.29l-11.274-.663-.009.009L2.85 17.698 9.929 12z"

const EDITOR_MAP: Record<string, Omit<EditorInfo, 'bin'>> = {
  cursor: { label: 'Cursor', icon: <CursorIcon /> },
  kiro: { label: 'Kiro', icon: <IconCode className="size-3.5" /> },
  trae: { label: 'Trae', icon: <IconCode className="size-3.5" /> },
  code: { label: 'VS Code', icon: <BrandIcon d={SI_VSCODE} /> },
  zed: { label: 'Zed', icon: <ZedIcon /> },
  idea: { label: 'IntelliJ', icon: <BrandIcon d={SI_INTELLIJ} /> },
  ghostty: { label: 'Ghostty', icon: <BrandIcon d={SI_GHOSTTY} /> },
  cmux: { label: 'cmux', icon: <IconTerminal2 className="size-3.5" /> },
  iterm2: { label: 'iTerm2', icon: <BrandIcon d={SI_ITERM2} /> },
  alacritty: { label: 'Alacritty', icon: <BrandIcon d={SI_ALACRITTY} /> },
  kitty: { label: 'Kitty', icon: <IconTerminal2 className="size-3.5" /> },
  wezterm: { label: 'WezTerm', icon: <BrandIcon d={SI_WEZTERM} /> },
  hyper: { label: 'Hyper', icon: <BrandIcon d={SI_HYPER} /> },
  wt: { label: 'Terminal', icon: <BrandIcon d={SI_WINDOWS_TERMINAL} /> },
  tmux: { label: 'tmux', icon: <BrandIcon d={SI_TMUX} /> },
  vim: { label: 'Terminal', icon: <IconTerminal2 className="size-3.5" /> },
  nvim: { label: 'Terminal', icon: <IconTerminal2 className="size-3.5" /> },
  finder: { label: 'Finder', icon: <IconFolder className="size-3.5" /> },
  files: { label: 'Files', icon: <IconFolder className="size-3.5" /> },
  explorer: { label: 'Explorer', icon: <IconFolder className="size-3.5" /> },
}

let cachedEditors: EditorInfo[] | null = null

const toBinInfo = (bin: string): EditorInfo => ({
  bin,
  ...(EDITOR_MAP[bin] ?? { label: bin, icon: <IconCode className="size-3.5" /> }),
})

/** Returns the first detected editor binary name, or 'code' as fallback. */
export function getPreferredEditor(): string {
  return cachedEditors?.[0]?.bin ?? 'code'
}

export function OpenInEditorGroup({ workspace }: { workspace: string }) {
  const [editors, setEditors] = useState<EditorInfo[]>(cachedEditors ?? [])
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Tier 1: fast detection (which + path checks)
  useEffect(() => {
    if (cachedEditors) return
    const timeout = new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 3000))
    Promise.race([ipc.detectEditors(), timeout]).then((bins) => {
      const detected = bins.map(toBinInfo)
      cachedEditors = detected
      setEditors(detected)
      // Fire Tier 2 background discovery (fire-and-forget)
      ipc.detectEditorsBackground(bins).catch(() => {})
    }).catch(() => {})
  }, [])

  // Tier 2: listen for background discovery results
  useEffect(() => {
    const unlisten = ipc.onEditorsUpdated((newBins) => {
      if (!newBins.length) return
      const existing = new Set(cachedEditors?.map((e) => e.bin) ?? [])
      const additions = newBins.filter((b) => !existing.has(b)).map(toBinInfo)
      if (!additions.length) return
      // Insert before the last entry (file manager)
      const current = cachedEditors ?? []
      const fileManager = current.at(-1)
      const isFileManager = fileManager && ['finder', 'files', 'explorer'].includes(fileManager.bin)
      const merged = isFileManager
        ? [...current.slice(0, -1), ...additions, fileManager]
        : [...current, ...additions]
      cachedEditors = merged
      setEditors(merged)
    })
    return unlisten
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  const open = (bin: string) => {
    ipc.openInEditor(workspace, bin).catch((e) => {
      toast.error(`Failed to open ${bin}`, { description: e instanceof Error ? e.message : String(e) })
    })
    setMenuOpen(false)
  }

  if (editors.length === 0) return null

  const primary = editors[0]
  const rest = editors.slice(1)

  return (
    <div ref={ref} className="relative flex w-fit">
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => open(primary.bin)}
            className={cn(
              'inline-flex size-7 items-center justify-center text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground',
            )}>
            {primary.icon}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Open in {primary.label}</TooltipContent>
      </Tooltip>
      {rest.length > 0 && (
        <>
          <div className="pointer-events-none relative z-[2] w-px bg-border" />
          <button type="button" aria-label="More editors" onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
            <IconChevronDown className="size-3.5" aria-hidden />
          </button>
        </>
      )}
      {menuOpen && rest.length > 0 && (
        <div className="absolute right-0 top-7 z-[200] min-w-[130px] rounded-lg border border-border bg-popover py-1 shadow-lg">
          {rest.map((e) => (
            <button key={e.bin} type="button" onClick={() => open(e.bin)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors">
              {e.icon}
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
