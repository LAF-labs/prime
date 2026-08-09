import { describe, it, expect } from 'vitest'
import { resolveUiMode } from './ui-mode'
import { visibleClientCommands, CLIENT_COMMANDS } from './agent-commands'

describe('resolveUiMode', () => {
  it('an explicit choice wins over everything', () => {
    expect(resolveUiMode({ uiMode: 'developer', hasOnboardedV2: false })).toBe('developer')
    expect(resolveUiMode({ uiMode: 'simple', hasOnboardedV2: true })).toBe('simple')
  })

  it('a pre-split install (onboarded, no mode) keeps the developer surface it was using', () => {
    expect(resolveUiMode({ hasOnboardedV2: true })).toBe('developer')
  })

  it('a fresh install is the daily-agent product: simple', () => {
    expect(resolveUiMode({})).toBe('simple')
    expect(resolveUiMode({ hasOnboardedV2: false })).toBe('simple')
  })
})

describe('visibleClientCommands', () => {
  it('developer mode advertises the full registry', () => {
    expect(visibleClientCommands('developer')).toHaveLength(CLIENT_COMMANDS.length)
  })

  it('simple mode drops the developer-only rows, and only those', () => {
    const visible = visibleClientCommands('simple')
    const names = new Set(visible.map((c) => c.name))
    for (const dev of ['branch', 'worktree', 'logs', 'refine']) {
      expect(names.has(dev), `${dev} should be hidden`).toBe(false)
    }
    expect(visible.length).toBe(CLIENT_COMMANDS.filter((c) => !c.devOnly).length)
  })

  it('daily-relevant commands stay in simple mode', () => {
    const names = new Set(visibleClientCommands('simple').map((c) => c.name))
    for (const kept of ['plan', 'model', 'compact', 'usage', 'mcp', 'new', 'clear']) {
      expect(names.has(kept), `${kept} should stay`).toBe(true)
    }
  })
})
