import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ipc', () => ({
  ipc: { agentRpcRequest: vi.fn().mockResolvedValue({}) },
}))

import { ipc } from '@/lib/ipc'
import { syncAgentBehavior } from './agent-behavior'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('syncAgentBehavior', () => {
  it('sends nothing when every setting matches the harness default', async () => {
    await syncAgentBehavior('t1', {})
    await syncAgentBehavior('t1', { agentAutoCompaction: true, agentAutoRetry: true, steeringMode: 'one-at-a-time' })
    expect(ipc.agentRpcRequest).not.toHaveBeenCalled()
  })

  it('sends only the settings that differ from the defaults', async () => {
    await syncAgentBehavior('t1', { agentAutoCompaction: false, steeringMode: 'all' })
    expect(ipc.agentRpcRequest).toHaveBeenCalledWith('t1', 'set_auto_compaction', { enabled: false })
    expect(ipc.agentRpcRequest).toHaveBeenCalledWith('t1', 'set_steering_mode', { mode: 'all' })
    expect(ipc.agentRpcRequest).not.toHaveBeenCalledWith('t1', 'set_auto_retry', expect.anything())
  })

  it('is best-effort: a failed toggle does not reject', async () => {
    vi.mocked(ipc.agentRpcRequest).mockRejectedValueOnce(new Error('connection closed'))
    await expect(
      syncAgentBehavior('t1', { agentAutoRetry: false }),
    ).resolves.toBeUndefined()
  })
})
