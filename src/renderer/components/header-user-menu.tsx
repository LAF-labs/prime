import { useEffect, useState, useRef, memo } from "react"
import {
  IconUser,
  IconLogin,
  IconLogout,
  IconRefresh,
  IconUserCheck,
} from "@tabler/icons-react"
import { useSettingsStore } from "@/stores/settingsStore"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export const HeaderUserMenu = memo(function HeaderUserMenu() {
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const kiroAuth = useSettingsStore((s) => s.kiroAuth)
  const kiroAuthChecked = useSettingsStore((s) => s.kiroAuthChecked)
  const checkAuth = useSettingsStore((s) => s.checkAuth)
  const logout = useSettingsStore((s) => s.logout)
  const openLogin = useSettingsStore((s) => s.openLogin)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0" data-no-drag>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-md transition-colors",
              kiroAuth
                ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
              !kiroAuthChecked && "animate-pulse",
            )}
          >
            {kiroAuth ? (
              <IconUserCheck className="size-4" />
            ) : (
              <IconUser className="size-4" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {kiroAuth
            ? (kiroAuth.email ?? kiroAuth.accountType)
            : "Not logged in"}
        </TooltipContent>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-border/60 bg-card shadow-xl shadow-black/20 animate-in fade-in-0 slide-in-from-top-1 duration-100">
          {kiroAuth ? (
            <>
              <div className="px-3 py-2.5 border-b border-border/60">
                <p className="text-[12px] font-medium text-foreground/90 truncate">
                  {kiroAuth.email ?? kiroAuth.accountType}
                </p>
                <p className="text-[10px] text-foreground/70">
                  {kiroAuth.accountType}
                  {kiroAuth.region ? ` · ${kiroAuth.region}` : ""}
                </p>
              </div>
              <div className="py-1">
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={async () => {
                    setRefreshing(true)
                    await checkAuth()
                    setRefreshing(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-foreground/60 transition-colors hover:bg-muted/30 hover:text-foreground/90 disabled:opacity-50"
                >
                  <IconRefresh
                    className={cn("size-3.5", refreshing && "animate-spin")}
                  />{" "}
                  {refreshing ? "Checking…" : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    logout()
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-red-600/70 dark:text-red-400/70 transition-colors hover:bg-red-500/5 hover:text-red-600 dark:hover:text-red-400"
                >
                  <IconLogout className="size-3.5" /> Logout
                </button>
              </div>
            </>
          ) : (
            <div className="py-1">
              <button
                type="button"
                onClick={() => {
                  openLogin()
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-foreground/60 transition-colors hover:bg-muted/30 hover:text-foreground/90"
              >
                <IconLogin className="size-3.5" /> Login to Kiro
              </button>
              <button
                type="button"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true)
                  await checkAuth()
                  setRefreshing(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground/70 disabled:opacity-50"
              >
                <IconRefresh
                  className={cn("size-3.5", refreshing && "animate-spin")}
                />{" "}
                {refreshing ? "Checking…" : "Check again"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
