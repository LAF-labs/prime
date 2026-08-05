import { createContext, useContext } from 'react'
import { useTaskStore } from '@/stores/taskStore'

/**
 * Provides the panel's task ID to all child components.
 * In split view, each panel wraps its children with a different taskId.
 * In single-panel mode, the value is null and components fall back to selectedTaskId.
 */
const PanelContext = createContext<string | null>(null)

export const PanelProvider = PanelContext.Provider

/** Returns the panel's task ID, or null if not in a panel context. */
export const usePanelTaskId = (): string | null => useContext(PanelContext)

/**
 * Returns the resolved task ID for this panel.
 * In split mode (PanelContext set): returns the context value directly — no store subscription.
 * In single-panel mode (no context): subscribes to selectedTaskId.
 */
export const usePanelResolvedTaskId = (): string | null => {
  const panelTaskId = useContext(PanelContext)
  const storeSelectedId = useTaskStore((s) => panelTaskId ? null : s.selectedTaskId)
  return panelTaskId ?? storeSelectedId
}
