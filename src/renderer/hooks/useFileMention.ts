import { useState, useCallback, type RefObject } from 'react'
import type { ProjectFile } from '@/types'

interface UseFileMentionOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  setValue: (v: string | ((prev: string) => string)) => void
  initialMentionedFiles?: ProjectFile[]
}

export function useFileMention({ textareaRef, value, setValue, initialMentionedFiles }: UseFileMentionOptions) {
  const [mentionTrigger, setMentionTrigger] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionedFiles, setMentionedFiles] = useState<ProjectFile[]>(initialMentionedFiles ?? [])

  const detectMentionTrigger = useCallback((text: string, cursorPos: number) => {
    let i = cursorPos - 1
    while (i >= 0 && text[i] !== '@' && text[i] !== '\n') i--
    if (i >= 0 && text[i] === '@') {
      if (i === 0 || /\s/.test(text[i - 1])) {
        const query = text.slice(i + 1, cursorPos)
        if (!query.includes(' ')) {
          setMentionTrigger({ start: i, query })
          setMentionIndex(0)
          return
        }
      }
    }
    setMentionTrigger(null)
  }, [])

  const handleSelectFile = useCallback((file: ProjectFile) => {
    if (!mentionTrigger) return
    const before = value.slice(0, mentionTrigger.start)
    const after = value.slice(mentionTrigger.start + 1 + mentionTrigger.query.length)
    const newValue = `${before}@${file.path} ${after}`
    setValue(newValue)
    setMentionTrigger(null)
    setMentionIndex(0)
    setMentionedFiles((prev) =>
      prev.some((f) => f.path === file.path) ? prev : [...prev, file]
    )
    textareaRef.current?.focus()
    const cursorPos = before.length + 1 + file.path.length + 1
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(cursorPos, cursorPos)
    })
  }, [mentionTrigger, value, setValue, textareaRef])

  const handleRemoveMention = useCallback((path: string) => {
    setMentionedFiles((prev) => prev.filter((f) => f.path !== path))
    setValue((v: string) => v.replace(new RegExp(`@${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s?`, 'g'), ''))
  }, [setValue])

  const clearMentions = useCallback(() => {
    setMentionTrigger(null)
    setMentionedFiles([])
  }, [])

  const addMentionedFile = useCallback((file: ProjectFile) => {
    setMentionedFiles((prev) =>
      prev.some((f) => f.path === file.path) ? prev : [...prev, file]
    )
  }, [])

  const dismissMention = useCallback(() => setMentionTrigger(null), [])

  const incrementMentionIndex = useCallback(() => setMentionIndex((i) => i + 1), [])
  const decrementMentionIndex = useCallback(() => setMentionIndex((i) => Math.max(0, i - 1)), [])

  return {
    mentionTrigger,
    mentionIndex,
    mentionedFiles,
    detectMentionTrigger,
    handleSelectFile,
    handleRemoveMention,
    addMentionedFile,
    clearMentions,
    dismissMention,
    incrementMentionIndex,
    decrementMentionIndex,
  } as const
}
