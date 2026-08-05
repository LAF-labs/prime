import { create } from 'zustand'
import type { AnalyticsEvent } from '@/types/analytics'
import { ipc } from '@/lib/ipc'

export type TimeRange = 'all' | '30d' | '7d'

const RANGE_MS: Record<TimeRange, number> = {
  all: 0,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

interface AnalyticsStore {
  events: AnalyticsEvent[]
  isLoaded: boolean
  timeRange: TimeRange
  dbSize: number
  loadEvents: () => Promise<void>
  setTimeRange: (range: TimeRange) => void
  clearData: () => Promise<void>
  refreshDbSize: () => Promise<void>
}

export const useAnalyticsStore = create<AnalyticsStore>((set, get) => ({
  events: [],
  isLoaded: false,
  timeRange: 'all',
  dbSize: 0,

  loadEvents: async () => {
    const { timeRange } = get()
    const since = RANGE_MS[timeRange] > 0 ? Date.now() - RANGE_MS[timeRange] : undefined
    try {
      const events = await ipc.analyticsLoad(since)
      set({ events, isLoaded: true })
    } catch {
      set({ isLoaded: true })
    }
  },

  setTimeRange: (range) => {
    set({ timeRange: range })
    get().loadEvents()
  },

  clearData: async () => {
    await ipc.analyticsClear()
    set({ events: [], dbSize: 0 })
  },

  refreshDbSize: async () => {
    try {
      const size = await ipc.analyticsDbSize()
      set({ dbSize: size })
    } catch { /* ignore */ }
  },
}))
