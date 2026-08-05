import { createContext, memo, useContext, type ReactNode } from 'react'

/** Context to pass the active search query down the component tree. */
export const SearchQueryContext = createContext<string>('')

/** Escapes special regex characters in a string. */
const escapeRegex = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Splits text on the search query and wraps matches in yellow highlight marks.
 * Returns the original text unchanged when there is no active query.
 */
export const HighlightText = memo(function HighlightText({ text }: { readonly text: string }) {
  const query = useContext(SearchQueryContext)
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegex(trimmed)})`, 'gi'))
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === trimmed.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-yellow-300/80 px-0.5 text-foreground dark:bg-yellow-400/40">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
})

/**
 * Recursively walks a ReactNode tree and wraps any string children
 * with HighlightText. Useful for highlighting inside pre-rendered
 * ReactNode trees (e.g. renderWithMentions output).
 */
export const highlightNode = (node: ReactNode, query: string): ReactNode => {
  if (!query.trim()) return node
  if (typeof node === 'string') return <HighlightText text={node} />
  if (Array.isArray(node)) return node.map((child, i) => <HighlightWrapper key={i}>{highlightNode(child, query)}</HighlightWrapper>)
  return node
}

/** Trivial wrapper to give keyed fragments a component boundary. */
const HighlightWrapper = ({ children }: { children: ReactNode }) => <>{children}</>
