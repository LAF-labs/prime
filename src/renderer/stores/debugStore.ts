import { create } from 'zustand'
import type { DebugLogEntry, DebugCategory } from '@/types'

const MAX_ENTRIES = 2000

interface DebugStore {
  entries: DebugLogEntry[]
  isOpen: boolean
  filter: {
    search: string
    category: DebugCategory | 'all'
    errorsOnly: boolean
    threadName: string
    projectName: string
    mcpServerName: string
  }
  addEntry: (entry: DebugLogEntry) => void
  clear: () => void
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  setFilter: (filter: Partial<DebugStore['filter']>) => void
}

// Batch debug entries with rAF to avoid per-entry state updates during streaming
let entryBuf: DebugLogEntry[] = []
let entryRaf: number | null = null

const flushEntries = () => {
  const buf = entryBuf; entryBuf = []; entryRaf = null
  if (buf.length === 0) return
  useDebugStore.setState((s) => {
    const combined = s.entries.concat(buf)
    return {
      entries: combined.length > MAX_ENTRIES
        ? combined.slice(-MAX_ENTRIES)
        : combined,
    }
  })
}

export const useDebugStore = create<DebugStore>((set) => ({
  entries: [],
  isOpen: false,
  filter: {
    search: '',
    category: 'all',
    errorsOnly: false,
    threadName: '',
    projectName: '',
    mcpServerName: '',
  },

  addEntry: (raw) => {
    const entry: DebugLogEntry = {
      ...raw,
      id: raw.id ?? Date.now() + Math.random(),
      timestamp: raw.timestamp ?? new Date().toISOString(),
    }
    entryBuf.push(entry)
    if (!entryRaf) entryRaf = requestAnimationFrame(flushEntries)
  },

  clear: () => set({ entries: [] }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (open) => set({ isOpen: open }),
  setFilter: (partial) =>
    set((s) => ({ filter: { ...s.filter, ...partial } })),
}))
