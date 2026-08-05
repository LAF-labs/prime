import { memo } from 'react'
import { useFilePreviewStore } from '@/stores/filePreviewStore'
import { FilePreviewModal } from '@/components/file-tree/FilePreviewModal'

/**
 * App-level file preview modal that can be triggered from anywhere
 * (chat messages, markdown file references, etc.) via the filePreviewStore.
 */
export const GlobalFilePreviewModal = memo(function GlobalFilePreviewModal() {
  const previewFilePath = useFilePreviewStore((s) => s.previewFilePath)
  const closePreview = useFilePreviewStore((s) => s.closePreview)

  if (!previewFilePath) return null

  return <FilePreviewModal filePath={previewFilePath} onClose={closePreview} />
})
