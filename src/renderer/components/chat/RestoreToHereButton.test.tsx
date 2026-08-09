import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RestoreToHereButton } from './RestoreToHereButton'
import { MessageListTaskIdContext } from './MessageList'
import { useTaskStore } from '@/stores/taskStore'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@/lib/thread-db', () => ({
  replaceMessages: vi.fn().mockResolvedValue(undefined),
  saveThread: vi.fn().mockResolvedValue(undefined),
  saveAllMessages: vi.fn().mockResolvedValue(undefined),
}))

const conversation = () => [
  { role: 'user' as const, content: 'first question', timestamp: 't0' },
  { role: 'assistant' as const, content: 'first answer', timestamp: 't1' },
  { role: 'user' as const, content: 'second question', timestamp: 't2' },
  { role: 'assistant' as const, content: 'second answer', timestamp: 't3' },
]

const seed = (status: 'paused' | 'running' = 'paused') => {
  useTaskStore.setState({
    tasks: {
      'task-1': {
        id: 'task-1',
        name: 'Thread',
        workspace: '/ws',
        status,
        createdAt: 't0',
        messages: conversation(),
      },
    },
  })
}

const renderAt = (messageIndex: number) =>
  render(
    <TooltipProvider>
      <MessageListTaskIdContext.Provider value="task-1">
        <RestoreToHereButton messageIndex={messageIndex} />
      </MessageListTaskIdContext.Provider>
    </TooltipProvider>,
  )

describe('RestoreToHereButton', () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: {} })
  })

  it('drops every message after the target, and keeps the target itself', () => {
    seed()
    renderAt(1)
    const button = screen.getByTestId('restore-to-here-button')
    // Two-step: the first click only arms the confirm.
    fireEvent.click(button)
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(4)
    fireEvent.click(button)
    expect(
      useTaskStore.getState().tasks['task-1'].messages.map((m) => m.content),
    ).toEqual(['first question', 'first answer'])
  })

  it('is the same action on a question as on an answer', () => {
    seed()
    renderAt(2)
    const button = screen.getByTestId('restore-to-here-button')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(
      useTaskStore.getState().tasks['task-1'].messages.map((m) => m.content),
    ).toEqual(['first question', 'first answer', 'second question'])
  })

  it('is hidden on the last message, where it would do nothing', () => {
    seed()
    renderAt(3)
    expect(screen.queryByTestId('restore-to-here-button')).toBeNull()
  })

  it('is disabled while the agent is mid-turn', () => {
    seed('running')
    renderAt(1)
    expect(screen.getByTestId('restore-to-here-button')).toBeDisabled()
  })
})
