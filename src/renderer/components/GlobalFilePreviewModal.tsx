import { memo, lazy, Suspense } from 'react'
import { useFilePreviewStore } from '@/stores/filePreviewStore'

/**
 * Loaded on first preview, not at startup.
 *
 * `FilePreviewModal` pulls in the markdown renderer, and this component is
 * mounted from `App` — which put react-markdown and its whole unified/remark
 * dependency tree (~219 kB) in the eager chunk for a modal that is closed on
 * every cold start.
 */
const FilePreviewModal = lazy(() =>
  import('@/components/file-tree/FilePreviewModal').then((m) => ({ default: m.FilePreviewModal })),
)

/**
 * App-level file preview modal that can be triggered from anywhere
 * (chat messages, markdown file references, etc.) via the filePreviewStore.
 */
export const GlobalFilePreviewModal = memo(function GlobalFilePreviewModal() {
  const previewFilePath = useFilePreviewStore((s) => s.previewFilePath)
  const closePreview = useFilePreviewStore((s) => s.closePreview)

  if (!previewFilePath) return null

  return (
    // No fallback: the chunk resolves from disk in a few ms, and a spinner
    // flashing behind a modal that is about to paint reads as a glitch.
    <Suspense fallback={null}>
      <FilePreviewModal filePath={previewFilePath} onClose={closePreview} />
    </Suspense>
  )
})
