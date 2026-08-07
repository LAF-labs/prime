import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ipc', () => ({
  ipc: { agentRpcRequest: vi.fn() },
}))

import { ipc } from '@/lib/ipc'
import { syncPlanEnforcement } from './plan-enforcement'

const rpc = vi.mocked(ipc.agentRpcRequest)

// The module keeps per-task delivery state, so every test uses its own id.
let seq = 0
const freshTaskId = () => `task-${++seq}`

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({})
})

describe('syncPlanEnforcement', () => {
  it('sends /plan-guard on over the RPC prompt path for plan mode', async () => {
    const id = freshTaskId()
    await syncPlanEnforcement(id, 'plan')
    expect(rpc).toHaveBeenCalledWith(id, 'prompt', { message: '/plan-guard on' })
  })

  it('skips the initial off — the gate already boots with the guard off', async () => {
    await syncPlanEnforcement(freshTaskId(), 'code')
    await syncPlanEnforcement(freshTaskId(), null)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends off after on was delivered', async () => {
    const id = freshTaskId()
    await syncPlanEnforcement(id, 'plan')
    await syncPlanEnforcement(id, 'code')
    expect(rpc).toHaveBeenNthCalledWith(2, id, 'prompt', { message: '/plan-guard off' })
  })

  it('re-sends on for the same task so a restarted agent gets re-armed', async () => {
    const id = freshTaskId()
    await syncPlanEnforcement(id, 'plan')
    await syncPlanEnforcement(id, 'plan')
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('never throws when the thread has no live connection', async () => {
    rpc.mockRejectedValue(new Error('This thread has no live agent connection yet.'))
    await expect(syncPlanEnforcement(freshTaskId(), 'plan')).resolves.toBeUndefined()
  })

  it('does nothing for an empty task id', async () => {
    await syncPlanEnforcement('', 'plan')
    expect(rpc).not.toHaveBeenCalled()
  })
})
