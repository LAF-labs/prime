/**
 * Proposed plan utilities.
 *
 * Provides plan title extraction, markdown formatting, preview generation,
 * and implementation prompt building for the plan sidebar.
 */

/**
 * Extract the title from a plan markdown (first heading).
 */
export function proposedPlanTitle(planMarkdown: string): string | null {
  const heading = planMarkdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim()
  return heading && heading.length > 0 ? heading : null
}

/**
 * Strip the title heading and optional "Summary" heading from plan markdown
 * for display purposes.
 */
export function stripDisplayedPlanMarkdown(planMarkdown: string): string {
  const lines = planMarkdown.trimEnd().split(/\r?\n/)
  const sourceLines = lines[0] && /^\s{0,3}#{1,6}\s+/.test(lines[0]) ? lines.slice(1) : [...lines]
  while (sourceLines[0]?.trim().length === 0) {
    sourceLines.shift()
  }
  const firstHeadingMatch = sourceLines[0]?.match(/^\s{0,3}#{1,6}\s+(.+)$/)
  if (firstHeadingMatch?.[1]?.trim().toLowerCase() === 'summary') {
    sourceLines.shift()
    while (sourceLines[0]?.trim().length === 0) {
      sourceLines.shift()
    }
  }
  return sourceLines.join('\n')
}

/**
 * Build a collapsed preview of a plan (first N visible lines).
 */
export function buildCollapsedPlanPreview(
  planMarkdown: string,
  maxLines = 8,
): string {
  const lines = stripDisplayedPlanMarkdown(planMarkdown)
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
  const previewLines: string[] = []
  let visibleLineCount = 0
  let hasMoreContent = false

  for (const line of lines) {
    const isVisibleLine = line.trim().length > 0
    if (isVisibleLine && visibleLineCount >= maxLines) {
      hasMoreContent = true
      break
    }
    previewLines.push(line)
    if (isVisibleLine) {
      visibleLineCount += 1
    }
  }

  while (previewLines.length > 0 && previewLines.at(-1)?.trim().length === 0) {
    previewLines.pop()
  }

  if (previewLines.length === 0) {
    return proposedPlanTitle(planMarkdown) ?? 'Plan preview unavailable.'
  }

  if (hasMoreContent) {
    previewLines.push('', '...')
  }

  return previewLines.join('\n')
}

/**
 * Build the prompt to send to the agent for plan implementation.
 */
export function buildPlanImplementationPrompt(planMarkdown: string): string {
  return `PLEASE IMPLEMENT THIS PLAN:\n${planMarkdown.trim()}`
}

/**
 * Resolve what to submit when following up on a plan.
 * If the user typed something, use that. Otherwise, build an implementation prompt.
 */
export function resolvePlanFollowUpSubmission(draftText: string, planMarkdown: string): {
  text: string
  useDefaultMode: boolean
} {
  const trimmed = draftText.trim()
  if (trimmed.length > 0) {
    return { text: trimmed, useDefaultMode: false }
  }
  return {
    text: buildPlanImplementationPrompt(planMarkdown),
    useDefaultMode: true,
  }
}

/**
 * Build a thread title for a plan implementation thread.
 */
export function buildPlanImplementationThreadTitle(planMarkdown: string): string {
  const title = proposedPlanTitle(planMarkdown)
  if (!title) return 'Implement plan'
  return `Implement ${title}`
}

/**
 * Generate a filename for exporting a plan as markdown.
 */
export function buildPlanMarkdownFilename(planMarkdown: string): string {
  const title = proposedPlanTitle(planMarkdown)
  const segment = sanitizePlanFileSegment(title ?? 'plan')
  return `${segment}.md`
}

/**
 * Normalize plan markdown for file export (ensure trailing newline).
 */
export function normalizePlanMarkdownForExport(planMarkdown: string): string {
  return `${planMarkdown.trimEnd()}\n`
}

function sanitizePlanFileSegment(input: string): string {
  const sanitized = input
    .toLowerCase()
    .replace(/[`'".,!?()[\]{}]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized.length > 0 ? sanitized : 'plan'
}
