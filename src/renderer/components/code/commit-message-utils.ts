const MAX_COMMIT_MSG_LENGTH = 100 as const

/** Parse file names from a unified diff string. */
export const parseFileNames = (diffText: string): string[] => {
  const names: string[] = []
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/b\/(.+)$/)
      if (match) names.push(match[1])
    }
  }
  return names
}

/** Count additions and deletions from a unified diff string. */
export const countDiffStats = (diffText: string): { additions: number; deletions: number } => {
  let additions = 0
  let deletions = 0
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

/** Generate a short conventional commit message from diff stats (local fallback). */
export const generateCommitMessage = (diffText: string): string => {
  const files = parseFileNames(diffText)
  if (files.length === 0) return ''
  const { additions, deletions } = countDiffStats(diffText)
  const stat = `(+${additions} -${deletions})`
  const shortNames = files.map((f) => f.split('/').pop() ?? f)
  const listed = `chore: update ${shortNames.join(', ')} ${stat}`
  if (listed.length <= MAX_COMMIT_MSG_LENGTH) return listed
  return `chore: update ${files.length} files ${stat}`.slice(0, MAX_COMMIT_MSG_LENGTH)
}
