import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createReceiptBus,
  createTurnQuiescedReceipt,
  createDiffReadyReceipt,
  createSessionReadyReceipt,
  resetReceiptBus,
} from './typed-receipts'

beforeEach(() => {
  resetReceiptBus()
})

describe('createReceiptBus', () => {
  it('publishes to all subscribers', () => {
    const bus = createReceiptBus()
    const listener = vi.fn()
    bus.subscribeAll(listener)

    const receipt = createTurnQuiescedReceipt('task-1', 5, 2)
    bus.publish(receipt)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(receipt)
    bus.dispose()
  })

  it('publishes to type-specific subscribers', () => {
    const bus = createReceiptBus()
    const turnListener = vi.fn()
    const diffListener = vi.fn()
    bus.subscribe('turn.quiesced', turnListener)
    bus.subscribe('diff.ready', diffListener)

    bus.publish(createTurnQuiescedReceipt('task-1', 5, 2))

    expect(turnListener).toHaveBeenCalledTimes(1)
    expect(diffListener).not.toHaveBeenCalled()
    bus.dispose()
  })

  it('publishes to task-specific subscribers', () => {
    const bus = createReceiptBus()
    const task1Listener = vi.fn()
    const task2Listener = vi.fn()
    bus.subscribeTask('task-1', task1Listener)
    bus.subscribeTask('task-2', task2Listener)

    bus.publish(createTurnQuiescedReceipt('task-1', 5, 2))

    expect(task1Listener).toHaveBeenCalledTimes(1)
    expect(task2Listener).not.toHaveBeenCalled()
    bus.dispose()
  })

  it('unsubscribe stops notifications', () => {
    const bus = createReceiptBus()
    const listener = vi.fn()
    const unsub = bus.subscribeAll(listener)
    unsub()

    bus.publish(createTurnQuiescedReceipt('task-1', 5, 2))
    expect(listener).not.toHaveBeenCalled()
    bus.dispose()
  })

  it('waitFor resolves when matching receipt arrives', async () => {
    const bus = createReceiptBus()
    const promise = bus.waitFor((r) => r.type === 'diff.ready')

    // Publish after a tick
    setTimeout(() => {
      bus.publish(createDiffReadyReceipt('task-1', { fileCount: 3, additions: 10, deletions: 2 }))
    }, 10)

    const receipt = await promise
    expect(receipt.type).toBe('diff.ready')
    expect((receipt as any).fileCount).toBe(3)
    bus.dispose()
  })

  it('waitFor rejects on timeout', async () => {
    vi.useFakeTimers()
    const bus = createReceiptBus()
    const promise = bus.waitFor((r) => r.type === 'diff.ready', 100)

    vi.advanceTimersByTime(101)

    await expect(promise).rejects.toThrow('timed out')
    bus.dispose()
    vi.useRealTimers()
  })

  it('dispose clears all subscriptions', () => {
    const bus = createReceiptBus()
    const listener = vi.fn()
    bus.subscribeAll(listener)
    bus.dispose()

    bus.publish(createTurnQuiescedReceipt('task-1', 5, 2))
    expect(listener).not.toHaveBeenCalled()
  })

  it('handles errors in listeners gracefully', () => {
    const bus = createReceiptBus()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const badListener = vi.fn(() => { throw new Error('oops') })
    const goodListener = vi.fn()
    bus.subscribeAll(badListener)
    bus.subscribeAll(goodListener)

    // Should not throw, even though the bad listener does.
    bus.publish(createTurnQuiescedReceipt('task-1', 5, 2))
    expect(goodListener).toHaveBeenCalledTimes(1)
    // Failure must surface as a console.warn so it stays debuggable.
    expect(warnSpy).toHaveBeenCalled()
    bus.dispose()
    warnSpy.mockRestore()
  })
})

describe('receipt factories', () => {
  it('createTurnQuiescedReceipt', () => {
    const receipt = createTurnQuiescedReceipt('task-1', 10, 3)
    expect(receipt.type).toBe('turn.quiesced')
    expect(receipt.taskId).toBe('task-1')
    expect(receipt.messageCount).toBe(10)
    expect(receipt.toolCallCount).toBe(3)
    expect(receipt.timestamp).toBeGreaterThan(0)
  })

  it('createDiffReadyReceipt', () => {
    const receipt = createDiffReadyReceipt('task-2', { fileCount: 5, additions: 20, deletions: 3 })
    expect(receipt.type).toBe('diff.ready')
    expect(receipt.taskId).toBe('task-2')
    expect(receipt.fileCount).toBe(5)
    expect(receipt.additions).toBe(20)
    expect(receipt.deletions).toBe(3)
  })

  it('createSessionReadyReceipt', () => {
    const receipt = createSessionReadyReceipt('task-3')
    expect(receipt.type).toBe('session.ready')
    expect(receipt.taskId).toBe('task-3')
  })
})
