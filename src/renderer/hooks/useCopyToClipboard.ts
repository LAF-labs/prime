import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Clipboard API wrapper with "Copied!" feedback timeout.
 * Provides visual feedback when text is copied.
 */
export function useCopyToClipboard(options?: {
  timeout?: number
  onCopy?: () => void
  onError?: (error: Error) => void
}): { copyToClipboard: (value: string) => void; isCopied: boolean } {
  const { timeout = 2000, onCopy, onError } = options ?? {}
  const [isCopied, setIsCopied] = useState(false)
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCopyRef = useRef(onCopy)
  const onErrorRef = useRef(onError)

  onCopyRef.current = onCopy
  onErrorRef.current = onError

  const copyToClipboard = useCallback((value: string): void => {
    if (!navigator.clipboard?.writeText) {
      onErrorRef.current?.(new Error('Clipboard API unavailable.'))
      return
    }
    if (!value) return

    navigator.clipboard.writeText(value).then(
      () => {
        if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current)
        setIsCopied(true)
        onCopyRef.current?.()
        if (timeout !== 0) {
          timeoutIdRef.current = setTimeout(() => {
            setIsCopied(false)
            timeoutIdRef.current = null
          }, timeout)
        }
      },
      (error) => {
        if (onErrorRef.current) {
          onErrorRef.current(error)
        } else {
          console.error('Copy failed:', error)
        }
      },
    )
  }, [timeout])

  useEffect(() => {
    return () => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current)
    }
  }, [])

  return { copyToClipboard, isCopied }
}
