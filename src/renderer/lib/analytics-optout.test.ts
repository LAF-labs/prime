import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ipc', () => ({ ipc: { analyticsSave: vi.fn().mockResolvedValue(undefined) } }))

import { record, flush } from './analytics-collector'
import { useSettingsStore } from '@/stores/settingsStore'
import { ipc } from '@/lib/ipc'

const setEnabled = (analyticsEnabled: boolean | undefined) => {
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, analyticsEnabled } }))
}

beforeEach(() => {
  vi.mocked(ipc.analyticsSave).mockClear()
  setEnabled(undefined)
})

describe('analytics opt-out', () => {
  it('records by default, matching the Rust-side default of enabled', () => {
    record('tool_call', { detail: 'bash' })
    flush()
    expect(ipc.analyticsSave).toHaveBeenCalledTimes(1)
  })

  it('records nothing once the user turns it off', () => {
    // The setting existed from the start; the renderer never read it, so the
    // toggle silently did nothing — this is the regression test for that.
    setEnabled(false)
    record('tool_call', { detail: 'bash' })
    record('file_edited', { detail: 'src/main.rs' })
    flush()
    expect(ipc.analyticsSave).not.toHaveBeenCalled()
  })

  it('resumes recording when turned back on', () => {
    setEnabled(false)
    record('tool_call', {})
    setEnabled(true)
    record('tool_call', {})
    flush()
    const batches = vi.mocked(ipc.analyticsSave).mock.calls
    expect(batches).toHaveLength(1)
    expect(batches[0][0]).toHaveLength(1)
  })
})
