import { create } from 'zustand'
import { useSettingsStore } from './settingsStore'
import { useFileTreeStore } from './fileTreeStore'

interface FilePreviewStore {
  /** Absolute file path currently being previewed, or null if closed */
  previewFilePath: string | null
  /** Open the file preview modal for a given path (relative or absolute) */
  openPreview: (filePath: string) => void
  /** Close the file preview modal */
  closePreview: () => void
}

/**
 * Resolve a potentially relative file path to an absolute path using the
 * current operational workspace. If the path is already absolute, return as-is.
 */
function resolveFilePath(filePath: string): string {
  // Already absolute
  if (filePath.startsWith('/')) return filePath

  // Strip leading ./ (redundant in path resolution)
  const cleaned = filePath.replace(/^\.\//, '')

  // Use the operational workspace (worktree or project root) as the base
  const workspace = useSettingsStore.getState().operationalWorkspace
    ?? useSettingsStore.getState().activeWorkspace
  if (workspace) {
    return `${workspace}/${cleaned}`
  }

  // Fallback: return as-is (the modal will handle missing files gracefully)
  return filePath
}

export const useFilePreviewStore = create<FilePreviewStore>((set) => ({
  previewFilePath: null,

  openPreview: (filePath: string) => {
    const resolved = resolveFilePath(filePath)
    // Close the file tree's own preview if open to avoid stacking modals
    useFileTreeStore.getState().setPreviewFile(null)
    set({ previewFilePath: resolved })
  },

  closePreview: () => set({ previewFilePath: null }),
}))
