import { describe, it, expect, beforeAll } from 'vitest'
import { getFileIconName, getFolderIconName, loadFileIconManifest } from './file-icons'

beforeAll(async () => {
  await loadFileIconManifest()
})

describe('getFileIconName', () => {
  it('resolves direct file extensions from the manifest', () => {
    // .htm is in fileExtensions → 'html'
    expect(getFileIconName('index.htm')).toBe('html')
    // .py is in fileExtensions
    expect(getFileIconName('main.py')).toBe('python')
  })

  it('resolves common extensions that are only in languageIds', () => {
    // These extensions are NOT in fileExtensions but ARE in languageIds.
    // Without the language-ID fallback they would all fall through to 'file'.
    expect(getFileIconName('index.html')).toBe('html')
    expect(getFileIconName('app.js')).toBe('javascript')
    expect(getFileIconName('app.ts')).toBe('typescript')
    expect(getFileIconName('App.tsx')).toBe('react_ts')
    expect(getFileIconName('App.jsx')).toBe('react')
    expect(getFileIconName('config.yaml')).toBe('yaml')
    expect(getFileIconName('config.yml')).toBe('yaml')
    expect(getFileIconName('index.php')).toBe('php')
    expect(getFileIconName('lib.cjs')).toBe('javascript')
    expect(getFileIconName('lib.mts')).toBe('typescript')
  })

  it('resolves exact file names (Dockerfile, package.json, etc.)', () => {
    expect(getFileIconName('Dockerfile')).toBe('docker')
    expect(getFileIconName('dockerfile')).toBe('docker')
    expect(getFileIconName('package.json')).toBe('nodejs')
    expect(getFileIconName('Makefile')).toBe('makefile')
    expect(getFileIconName('README.md')).toBe('readme')
  })

  it('prefers compound extensions over the simple extension', () => {
    // `Component.test.tsx` should resolve via .test.tsx (or test.tsx) before .tsx
    // Both should still produce a valid icon (not 'file').
    const icon = getFileIconName('Component.test.tsx')
    expect(icon).not.toBe('file')
  })

  it('lowercases the input so case does not matter', () => {
    expect(getFileIconName('INDEX.HTML')).toBe('html')
    expect(getFileIconName('App.TSX')).toBe('react_ts')
  })

  it('falls back to the default file icon for unknown extensions', () => {
    expect(getFileIconName('something.xyz123notreal')).toBe('file')
  })

  it('falls back to the default file icon for files with no extension and no name match', () => {
    expect(getFileIconName('totally-random-file-name-xyz')).toBe('file')
  })
})

describe('getFolderIconName', () => {
  it('returns special folder icons when the manifest defines them', () => {
    expect(getFolderIconName('src', false)).toBeTruthy()
    expect(getFolderIconName('node_modules', false)).toBeTruthy()
  })

  it('returns the default folder icon for unknown folders', () => {
    expect(getFolderIconName('totally-random-folder-name', false)).toBe('folder')
    expect(getFolderIconName('totally-random-folder-name', true)).toBe('folder-open')
  })
})
