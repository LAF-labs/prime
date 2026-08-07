/**
 * Korean coverage regression test.
 *
 * Extracts every `t('…')` string literal across src/renderer (mirroring the
 * audit script that produced the dictionary) and asserts each key has a
 * Korean entry in i18n-ko.ts. A new user-facing string without a Korean
 * translation fails this test instead of silently rendering in English.
 *
 * Render-time lookups over constant tables — e.g. `t(item.label)` over the
 * settings NAV / SEARCHABLE_SETTINGS entries — are not literals and are not
 * captured here; their keys are covered by the dictionary review instead.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ko } from './i18n-ko'

const RENDERER_ROOT = join(__dirname, '..')

/**
 * Keys that deliberately stay untranslated:
 * - Language autonyms shown in the language picker (each language names
 *   itself: "English" stays English, "한국어" is already Korean).
 */
const ALLOWLIST = new Set(['English', '한국어'])

/** Files that mention t('…') without being product UI. */
const EXCLUDED_FILES = new Set([
  'lib/i18n.ts', // the t() implementation; doc comments show example calls
  'lib/i18n-ko.ts',
])

const collectSourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.test\.(ts|tsx)$/.test(name) || name.endsWith('.d.ts')) continue
    if (EXCLUDED_FILES.has(relative(RENDERER_ROOT, path))) continue
    out.push(path)
  }
  return out
}

/** Decode the escapes that appear in source literals: \' \" \\ \n \uXXXX. */
const decodeLiteral = (raw: string): string =>
  raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\(['"\\])/g, '$1')

const T_CALL = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g

const extractKeys = (): Map<string, string> => {
  const keys = new Map<string, string>() // key -> first call site
  for (const file of collectSourceFiles(RENDERER_ROOT)) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      for (const match of line.matchAll(T_CALL)) {
        const key = decodeLiteral(match[2])
        if (!keys.has(key)) keys.set(key, `${relative(RENDERER_ROOT, file)}:${i + 1}`)
      }
    })
  }
  return keys
}

describe('i18n Korean coverage', () => {
  it('finds a meaningful number of t() call sites', () => {
    // Guards the extractor itself: if the regex or the walk breaks, the
    // coverage assertion below would pass vacuously.
    expect(extractKeys().size).toBeGreaterThan(500)
  })

  it('every t() literal has a Korean translation', () => {
    const missing: string[] = []
    for (const [key, site] of extractKeys()) {
      if (ALLOWLIST.has(key)) continue
      if (!(key in ko)) missing.push(`${JSON.stringify(key)} (${site})`)
    }
    expect(missing, `Missing Korean entries in i18n-ko.ts:\n${missing.join('\n')}`).toEqual([])
  })

  it('allowlist only contains keys that are actually used', () => {
    const keys = extractKeys()
    for (const key of ALLOWLIST) {
      expect(keys.has(key), `Stale allowlist entry: ${key}`).toBe(true)
    }
  })
})
