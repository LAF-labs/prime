import { memo } from "react"
import { IconGitCompare, IconTerminal2 } from "@tabler/icons-react"

export const HeaderGhostToolbar = memo(function HeaderGhostToolbar() {
  return (
    <div
      className="flex shrink-0 items-center gap-2 pointer-events-none"
      aria-hidden
    >
      <div className="h-5 w-14 rounded bg-muted-foreground/6" />
      <div className="flex">
        <div className="inline-flex h-6 items-center gap-1.5 rounded-l-md border border-muted-foreground/8 px-1.5">
          <IconGitCompare className="size-3 text-muted-foreground/70" />
        </div>
        <div className="inline-flex h-6 items-center rounded-r-md border border-l-0 border-muted-foreground/8 px-1.5">
          <span className="h-2 w-2 rounded-sm bg-muted-foreground/10" />
        </div>
      </div>
      <div className="inline-flex h-6 items-center rounded-md border border-muted-foreground/8 px-1.5">
        <IconTerminal2 className="size-3 text-muted-foreground/70" />
      </div>
    </div>
  )
})
