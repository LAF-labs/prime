/**
 * Strips base64 image data from a message before sending it to title/branch
 * generation. Preserves `[Attached image: ...]` annotations so the model
 * knows an image was present, but removes the massive `<image src="data:..." />`
 * tags that would otherwise fill the truncation budget with noise.
 */
export const stripImageDataForTitleGen = (message: string): string => {
  const stripped = message
    .replace(/<image src="data:[^"]*" \/>/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
  if (stripped.length === 0) return '[Image attachment]'
  return stripped
}
