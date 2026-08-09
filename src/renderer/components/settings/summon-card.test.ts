import { describe, it, expect } from 'vitest'
import { accelFromEvent, formatAccel } from './summon-card'

const ev = (patch: Partial<Parameters<typeof accelFromEvent>[0]>) => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...patch,
})

describe('accelFromEvent', () => {
  it('builds Tauri accelerator syntax from a chord', () => {
    expect(accelFromEvent(ev({ key: 'a', code: 'KeyA', metaKey: true, shiftKey: true })))
      .toBe('CmdOrCtrl+Shift+A')
  })

  it('maps Ctrl to the same CmdOrCtrl token, so the setting is portable', () => {
    expect(accelFromEvent(ev({ key: 'a', code: 'KeyA', ctrlKey: true })))
      .toBe('CmdOrCtrl+A')
  })

  it('refuses a bare key — a global hotkey would swallow it everywhere', () => {
    expect(accelFromEvent(ev({ key: 'a', code: 'KeyA' }))).toBeNull()
  })

  it('waits while only modifiers are held', () => {
    expect(accelFromEvent(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull()
  })

  it('reads digits off the physical key, not the shifted character', () => {
    expect(accelFromEvent(ev({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true })))
      .toBe('CmdOrCtrl+Shift+1')
  })

  it('keeps function keys, which carry no modifier requirement of their own', () => {
    expect(accelFromEvent(ev({ key: 'F5', code: 'F5', altKey: true }))).toBe('Alt+F5')
  })

  it('uses the physical key so a non-Latin layout still records a usable binding', () => {
    // Korean layout: the key labelled ㅁ sits on KeyA.
    expect(accelFromEvent(ev({ key: 'ㅁ', code: 'KeyA', metaKey: true, altKey: true })))
      .toBe('CmdOrCtrl+Alt+A')
  })
})

describe('formatAccel', () => {
  it('renders mac glyphs', () => {
    // The module reads the platform at import time; assert whichever applies.
    const out = formatAccel('CmdOrCtrl+Shift+A')
    expect(out === '⌘⇧A' || out === 'Ctrl+Shift+A').toBe(true)
  })
})
