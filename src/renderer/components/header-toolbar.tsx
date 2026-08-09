import { t } from '@/lib/i18n'
import { useCallback, useState, memo, useRef } from "react"
import {
  IconTerminal2,
  IconLayoutColumns,
  IconFolderOpen,
} from "@tabler/icons-react"
import { useTaskStore } from "@/stores/taskStore"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { OpenInEditorGroup } from "@/components/OpenInEditorGroup"
import { SplitThreadPicker } from "@/components/chat/SplitThreadPicker"
import { cn } from "@/lib/utils"
import { useFileTreeStore } from "@/stores/fileTreeStore"


/** Toggle button for split-screen mode. Opens a thread picker or closes split. */
const SplitToggleButton = memo(function SplitToggleButton() {
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId)
  const activeSplitId = useTaskStore((s) => s.activeSplitId)
  const isSplit = activeSplitId !== null
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleClick = useCallback(() => {
    if (isSplit) {
      useTaskStore.getState().closeSplit()
      return
    }
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPickerPos({ x: rect.right - 280, y: rect.bottom + 6 })
  }, [isSplit])

  if (!selectedTaskId) return null

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={btnRef}
            type="button"
            data-testid="toggle-split-button"
            aria-label={t('Toggle side-by-side')}
            aria-pressed={isSplit}
            onClick={handleClick}
            className={cn(
              "inline-flex size-7 items-center justify-center text-xs transition-colors",
              isSplit
                ? "bg-primary/15 text-primary"
                : "text-primary/70 hover:bg-primary/10 hover:text-primary",
            )}
          >
            <IconLayoutColumns className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isSplit ? t('Close side-by-side') : t('Side-by-side · two threads at once')}
        </TooltipContent>
      </Tooltip>
      {pickerPos && selectedTaskId && (
        <SplitThreadPicker
          anchorTaskId={selectedTaskId}
          position={pickerPos}
          onClose={() => setPickerPos(null)}
        />
      )}
    </>
  )
})

/** Toggle button for file tree panel. */
const FileTreeToggleButton = memo(function FileTreeToggleButton() {
  const isOpen = useFileTreeStore((s) => s.isOpen)
  const toggle = useFileTreeStore((s) => s.toggle)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="toggle-file-tree-button"
          aria-label={t('Toggle file tree')}
          aria-pressed={isOpen}
          onClick={toggle}
          className={cn(
            "inline-flex size-7 items-center justify-center text-xs transition-colors",
            isOpen
              ? "bg-white/[0.08] text-foreground"
              : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
          )}
        >
          <IconFolderOpen className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t('File tree')}</TooltipContent>
    </Tooltip>
  )
})

interface HeaderToolbarProps {
  workspace: string
}

export const HeaderToolbar = memo(function HeaderToolbar({
  workspace,
}: HeaderToolbarProps) {
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId)
  const terminalOpen = useTaskStore((s) =>
    selectedTaskId ? s.terminalOpenTasks.has(selectedTaskId) : false,
  )
  const toggleTerminal = useTaskStore((s) => s.toggleTerminal)

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex items-center rounded-lg bg-muted/40" data-no-drag>
        <ErrorBoundary fallback={null}>
          <OpenInEditorGroup workspace={workspace} />
        </ErrorBoundary>

        {selectedTaskId && (
          <>
            <div className="h-5 w-px self-center bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="toggle-terminal-button"
                  aria-label={t('Toggle terminal')}
                  aria-pressed={terminalOpen}
                  onClick={() => toggleTerminal(selectedTaskId)}
                  className={cn(
                    "inline-flex size-7 items-center justify-center text-xs transition-colors",
                    terminalOpen
                      ? "bg-white/[0.08] text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                  )}
                >
                  <IconTerminal2 className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('Terminal')}</TooltipContent>
            </Tooltip>
          </>
        )}

        <div className="h-5 w-px self-center bg-border" />
        <FileTreeToggleButton />

        <div className="h-5 w-px self-center bg-border" />
        <SplitToggleButton />

      </div>
    </div>
  )
})
