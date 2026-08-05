import { memo } from 'react'
import { getFileIconName, getFolderIconName, getIconPath } from '@/lib/file-icons'
import { cn } from '@/lib/utils'

interface FileTypeIconProps {
  name: string
  isDir: boolean
  isExpanded?: boolean
  className?: string
}

/**
 * Renders a file/folder type icon from the Material Icon Theme.
 * Uses <img> tags pointing to SVG files served by the Vite plugin.
 */
export const FileTypeIcon = memo(function FileTypeIcon({ name, isDir, isExpanded = false, className }: FileTypeIconProps) {
  const iconName = isDir
    ? getFolderIconName(name, isExpanded)
    : getFileIconName(name)

  const src = getIconPath(iconName)

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('size-4 shrink-0 object-contain', className)}
    />
  )
})
