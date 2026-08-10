import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuestionCards } from './QuestionCards'
import { useTaskStore } from '@/stores/taskStore'

const sendMessage = vi.fn()
vi.mock('@/lib/ipc', () => ({
  ipc: {
    sendMessage: (...args: unknown[]) => sendMessage(...args),
  },
}))
vi.mock('@/lib/thread-db', () => ({
  replaceMessages: vi.fn().mockResolvedValue(undefined),
  saveThread: vi.fn().mockResolvedValue(undefined),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  saveAllMessages: vi.fn().mockResolvedValue(undefined),
}))

const ONE_QUESTION = `[1]: Which one should I fix?
a) the skill reference
b) the routing copy
c) something else`

const seedTask = () => {
  useTaskStore.setState({
    selectedTaskId: 'task-1',
    tasks: {
      'task-1': {
        id: 'task-1',
        name: 'Thread',
        workspace: '/ws',
        status: 'paused',
        createdAt: 't0',
        messages: [],
      },
    },
  })
}

const submitButton = () => screen.getByRole('button', { name: /Submit|Next/ })
const freeText = () => screen.getByPlaceholderText('Add extra context (optional)')

describe('QuestionCards free-text answers', () => {
  beforeEach(() => {
    sendMessage.mockClear()
    seedTask()
  })

  /**
   * The reported bug: on a single-question card, typing an answer instead of
   * picking an option left Submit disabled, so the only way forward was to
   * choose an option the user did not mean.
   */
  it('enables Submit when the user writes an answer instead of picking one', () => {
    render(<QuestionCards text={ONE_QUESTION} />)
    expect(submitButton()).toBeDisabled()

    fireEvent.change(freeText(), { target: { value: '안녕하세요' } })
    expect(submitButton()).toBeEnabled()
  })

  it('sends the written answer', () => {
    render(<QuestionCards text={ONE_QUESTION} />)
    fireEvent.change(freeText(), { target: { value: '직접 입력한 답' } })
    fireEvent.click(submitButton())

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][1]).toContain('직접 입력한 답')
  })

  it('keeps Submit disabled for whitespace, which is not an answer', () => {
    render(<QuestionCards text={ONE_QUESTION} />)
    fireEvent.change(freeText(), { target: { value: '   ' } })
    expect(submitButton()).toBeDisabled()
  })

  it('still accepts a plain option selection', () => {
    render(<QuestionCards text={ONE_QUESTION} />)
    fireEvent.click(screen.getByText('the skill reference'))
    expect(submitButton()).toBeEnabled()
    fireEvent.click(submitButton())
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('combines a selection with written detail', () => {
    render(<QuestionCards text={ONE_QUESTION} />)
    fireEvent.click(screen.getByText('the skill reference'))
    fireEvent.change(freeText(), { target: { value: '이유는 이렇습니다' } })
    fireEvent.click(submitButton())

    const sent = sendMessage.mock.calls[0][1] as string
    expect(sent).toContain('a')
    expect(sent).toContain('이유는 이렇습니다')
  })

  it('submits on Enter under the same rule as the button', () => {
    render(<QuestionCards text={ONE_QUESTION} />)
    fireEvent.change(freeText(), { target: { value: '엔터로 제출' } })
    // The handler ignores keys from inputs, so send it from the document.
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
