import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerResendHandler, resendMessage } from './chat-resend'

describe('chat-resend registry', () => {
  beforeEach(() => {
    // Each test installs its own handler; a null reset is not exposed on
    // purpose (production never unregisters), so overwrite instead.
    registerResendHandler(vi.fn().mockResolvedValue(undefined))
  })

  it('forwards taskId and content to the registered handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerResendHandler(handler)
    await resendMessage('task-1', 'hello again')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('task-1', 'hello again')
  })

  it('the latest registered handler wins', async () => {
    const first = vi.fn().mockResolvedValue(undefined)
    const second = vi.fn().mockResolvedValue(undefined)
    registerResendHandler(first)
    registerResendHandler(second)
    await resendMessage('task-2', 'content')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('task-2', 'content')
  })

  it('propagates handler rejections to the caller', async () => {
    registerResendHandler(vi.fn().mockRejectedValue(new Error('backend down')))
    await expect(resendMessage('task-3', 'x')).rejects.toThrow('backend down')
  })
})
