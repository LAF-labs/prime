/**
 * Turn diff summarization.
 *
 * Parses unified diff output and summarizes additions/deletions per file.
 * Used by the activity feed and plan sidebar to show what changed per turn.
 */

export interface FileDiffSummary {
  /** Relative file path */
  path: string
  /** Number of lines added */
  additions: number
  /** Number of lines deleted */
  deletions: number
}

export interface TurnDiffSummary {
  /** Per-file summaries */
  files: FileDiffSummary[]
  /** Total additions across all files */
  totalAdditions: number
  /** Total deletions across all files */
  totalDeletions: number
  /** Total number of files changed */
  fileCount: number
}

/**
 * Parse a unified diff string into per-file summaries.
 */
export function parseDiffSummary(diffText: string): TurnDiffSummary {
  const files: FileDiffSummary[] = []
  let currentFile: string | null = null
  let additions = 0
  let deletions = 0

  for (const line of diffText.split('\n')) {
    // New file header: diff --git a/path b/path
    if (line.startsWith('diff --git ')) {
      // Flush previous file
      if (currentFile) {
        files.push({ path: currentFile, additions, deletions })
      }
      // Extract path from "diff --git a/path b/path"
      const match = line.match(/^diff --git a\/(.+) b\//)
      currentFile = match?.[1] ?? null
      additions = 0
      deletions = 0
      continue
    }

    // Count additions and deletions (skip hunk headers and metadata)
    if (currentFile) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      }
    }
  }

  // Flush last file
  if (currentFile) {
    files.push({ path: currentFile, additions, deletions })
  }

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

  return {
    files,
    totalAdditions,
    totalDeletions,
    fileCount: files.length,
  }
}

/**
 * Format a turn diff summary as a compact string for display.
 * Example: "3 files changed (+42 -15)"
 */
export function formatDiffSummary(summary: TurnDiffSummary): string {
  if (summary.fileCount === 0) return 'No changes'
  const fileLabel = summary.fileCount === 1 ? '1 file' : `${summary.fileCount} files`
  return `${fileLabel} changed (+${summary.totalAdditions} -${summary.totalDeletions})`
}

/**
 * Format a compact per-file summary.
 * Example: "src/App.tsx (+12 -3)"
 */
export function formatFileSummary(file: FileDiffSummary): string {
  return `${file.path} (+${file.additions} -${file.deletions})`
}
