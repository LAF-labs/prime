import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EDIT_TOOLS, globToRegExp } from './permission-rules'

/**
 * The gate extension cannot import across the harness boundary, so its
 * permission logic is a hand-written mirror of `permission-rules.ts`. These
 * tests pin the mirror: an edit to one side without the other is a silent
 * security regression, and this file is where it surfaces.
 */

const gateSource = readFileSync(
  resolve(__dirname, '../../../src-tauri/resources/laf-agent-gate.ts'),
  'utf8',
)

const extractSetLiteral = (source: string, name: string): string[] => {
  const match = source.match(new RegExp(`const ${name} = new Set\\((\\[[^\\]]*\\])\\)`))
  if (!match) throw new Error(`Could not find "const ${name} = new Set([...])" in the gate source`)
  return JSON.parse(match[1].replace(/'/g, '"')) as string[]
}

describe('gate ↔ renderer permission mirror', () => {
  it('EDIT_TOOLS sets are identical', () => {
    const gateEditTools = extractSetLiteral(gateSource, 'EDIT_TOOLS')
    expect([...gateEditTools].sort()).toEqual([...EDIT_TOOLS].sort())
  })

  it('globToRegExp escaping is identical', () => {
    // Both sides must produce the same regex source for the same glob. The
    // gate's body is extracted and evaluated rather than re-implemented so a
    // one-sided change to the escape set fails here.
    const match = gateSource.match(/function globToRegExp\(pattern: string\): RegExp \{([\s\S]*?)\n\}/)
    expect(match, 'globToRegExp not found in gate source').toBeTruthy()
    const body = (match as RegExpMatchArray)[1]
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- deliberate: evaluating the gate's own source to compare behavior
    const gateGlobToRegExp = new Function('pattern', body.replace(/return new RegExp/, 'return new RegExp')) as (p: string) => RegExp
    const samples = ['*', 'npm *', 'src/**/*.ts', 'a.b+c?d^e$f{g}h(i)j|k[l]m\\n', 'plain']
    for (const sample of samples) {
      expect(gateGlobToRegExp(sample).source, `glob "${sample}"`).toBe(globToRegExp(sample).source)
    }
  })

  it('ruleMatches semantics are identical (tool-wide rule, glob rule, mismatch)', () => {
    // Structural pin: the gate's ruleMatches must keep the same three-branch
    // shape (tool mismatch → false, no pattern → true, else glob test).
    const match = gateSource.match(/function ruleMatches\([\s\S]*?\n\}/)
    expect(match, 'ruleMatches not found in gate source').toBeTruthy()
    const body = (match as RegExpMatchArray)[0]
    expect(body).toContain('if (rule.tool !== toolName) return false')
    expect(body).toContain('if (!rule.argPattern) return true')
    expect(body).toContain('globToRegExp(rule.argPattern).test(arg)')
  })
})
