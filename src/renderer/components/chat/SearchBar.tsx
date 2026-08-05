import { memo, useCallback, useEffect, useRef } from 'react'
import { IconSearch, IconChevronUp, IconChevronDown, IconX } from '@tabler/icons-react'

interface SearchBarProps {
  readonly query: string
  readonly matchCount: number
  readonly activeIndex: number
  readonly onQueryChange: (query: string) => void
  readonly onNext: () => void
  readonly onPrevious: () => void
  readonly onClose: () => void
}

export const SearchBar = memo(function SearchBar({
  query,
  matchCount,
  activeIndex,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        onPrevious()
      } else {
        onNext()
      }
    }
  }, [onClose, onNext, onPrevious])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onQueryChange(e.target.value)
  }, [onQueryChange])

  const hasQuery = query.trim().length > 0
  const label = hasQuery
    ? matchCount > 0
      ? `${activeIndex + 1} of ${matchCount}`
      : 'No results'
    : ''

  return (
    <div
      className="flex items-center gap-1.5 border-b border-border/50 bg-card/95 px-3 py-1.5 backdrop-blur-sm"
      role="search"
      aria-label="Search messages"
    >
      <IconSearch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Search messages…"
        aria-label="Search messages"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {hasQuery && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={onPrevious}
        disabled={matchCount === 0}
        aria-label="Previous match"
        tabIndex={0}
        className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <IconChevronUp className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label="Next match"
        tabIndex={0}
        className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <IconChevronDown className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close search"
        tabIndex={0}
        className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        <IconX className="size-3.5" aria-hidden />
      </button>
    </div>
  )
})
