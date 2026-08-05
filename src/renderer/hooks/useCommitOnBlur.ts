/**
 * useCommitOnBlur — Input buffering hook.
 *
 * Buffers text input locally and commits changes on blur or Enter key.
 * Prevents re-renders on every keystroke by keeping a local ref that
 * only syncs upstream on commit events.
 *
 * Usage:
 * ```tsx
 * const { value, onChange, onBlur, onKeyDown, inputRef } = useCommitOnBlur({
 *   initialValue: 'hello',
 *   onCommit: (value) => saveToStore(value),
 * })
 * return <input ref={inputRef} value={value} onChange={onChange} onBlur={onBlur} onKeyDown={onKeyDown} />
 * ```
 */
import { useState, useCallback, useRef, useEffect } from 'react'

interface UseCommitOnBlurOptions {
  /** The initial/upstream value. When this changes externally, the local buffer resyncs (if not focused). */
  initialValue: string
  /** Called when the user commits (blur or Enter). */
  onCommit: (value: string) => void
  /** If true, commit on Enter key. Default: true. */
  commitOnEnter?: boolean
  /** If true, select all text on focus. Default: false. */
  selectOnFocus?: boolean
}

interface UseCommitOnBlurResult {
  /** Current local value (may differ from upstream while editing). */
  value: string
  /** Controlled onChange handler. */
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  /** Blur handler — commits the value. */
  onBlur: () => void
  /** KeyDown handler — commits on Enter (if enabled). */
  onKeyDown: (e: React.KeyboardEvent) => void
  /** Focus handler — optionally selects all. */
  onFocus: () => void
  /** Ref to attach to the input element. */
  inputRef: React.RefObject<HTMLInputElement | null>
  /** Whether the input is currently focused. */
  isFocused: boolean
}

export function useCommitOnBlur({
  initialValue,
  onCommit,
  commitOnEnter = true,
  selectOnFocus = false,
}: UseCommitOnBlurOptions): UseCommitOnBlurResult {
  const [localValue, setLocalValue] = useState(initialValue)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const committedRef = useRef(initialValue)

  // Resync from upstream when not focused
  useEffect(() => {
    if (!isFocused && initialValue !== committedRef.current) {
      setLocalValue(initialValue)
      committedRef.current = initialValue
    }
  }, [initialValue, isFocused])

  const commit = useCallback(() => {
    const trimmed = localValue.trim()
    if (trimmed !== committedRef.current) {
      committedRef.current = trimmed
      onCommit(trimmed)
    }
    setIsFocused(false)
  }, [localValue, onCommit])

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setLocalValue(e.target.value)
  }, [])

  const onBlur = useCallback(() => {
    commit()
  }, [commit])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (commitOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commit()
      inputRef.current?.blur()
    }
    if (e.key === 'Escape') {
      // Revert to last committed value
      setLocalValue(committedRef.current)
      setIsFocused(false)
      inputRef.current?.blur()
    }
  }, [commit, commitOnEnter])

  const onFocus = useCallback(() => {
    setIsFocused(true)
    if (selectOnFocus) {
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [selectOnFocus])

  return {
    value: localValue,
    onChange,
    onBlur,
    onKeyDown,
    onFocus,
    inputRef,
    isFocused,
  }
}
