import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueuedMessages } from './QueuedMessages'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { QueuedMessage } from '@/stores/task-store-types'

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>

describe('QueuedMessages', () => {
  it('returns null for empty messages', () => {
    const { container } = render(wrap(<QueuedMessages messages={[]} onRemove={vi.fn()} />))
    expect(container.querySelector('.flex.flex-col')).toBeNull()
  })

  it('renders queued messages', () => {
    const messages: QueuedMessage[] = [{ text: 'msg1' }, { text: 'msg2' }]
    render(wrap(<QueuedMessages messages={messages} onRemove={vi.fn()} />))
    expect(screen.getByText('msg1')).toBeInTheDocument()
    expect(screen.getByText('msg2')).toBeInTheDocument()
    expect(screen.getByText('Queued (2)')).toBeInTheDocument()
  })

  it('calls onRemove when trash clicked', () => {
    const onRemove = vi.fn()
    render(wrap(<QueuedMessages messages={[{ text: 'msg1' }]} onRemove={onRemove} />))
    fireEvent.click(screen.getByLabelText('Remove queued message 1'))
    expect(onRemove).toHaveBeenCalledWith(0)
  })

  it('shows image indicator when attachments present', () => {
    const messages: QueuedMessage[] = [
      { text: 'check this', attachments: [{ base64: 'abc', mimeType: 'image/png', name: 'img.png' }] },
    ]
    render(wrap(<QueuedMessages messages={messages} onRemove={vi.fn()} />))
    expect(screen.getByLabelText('1 image attached')).toBeInTheDocument()
    expect(screen.getByText('check this')).toBeInTheDocument()
  })

  it('shows fallback text for image-only messages', () => {
    const messages: QueuedMessage[] = [
      { text: '', attachments: [{ base64: 'abc', mimeType: 'image/png', name: 'img.png' }] },
    ]
    render(wrap(<QueuedMessages messages={messages} onRemove={vi.fn()} />))
    expect(screen.getByText('Image attachment')).toBeInTheDocument()
  })
})
