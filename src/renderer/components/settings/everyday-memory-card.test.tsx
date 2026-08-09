import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockList = vi.fn()
const mockDelete = vi.fn()
const mockClear = vi.fn()

vi.mock('@/lib/ipc', () => ({
  ipc: {
    everydayMemoriesList: (...args: unknown[]) => mockList(...args),
    everydayMemoryDelete: (...args: unknown[]) => mockDelete(...args),
    everydayMemoriesClear: (...args: unknown[]) => mockClear(...args),
  },
}))

const mockReportFailure = vi.fn()
vi.mock('@/lib/ipc-report', () => ({
  reportFailure: (...args: unknown[]) => mockReportFailure(...args),
  attempt: vi.fn(),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: () => null,
}))

// The card is everyday-only, so the mode is the switch under test in one case
// and a fixed precondition in the rest.
let isSimpleMode = true
vi.mock('@/lib/ui-mode', () => ({
  useIsSimpleMode: () => isSimpleMode,
  useUiMode: () => (isSimpleMode ? 'simple' : 'developer'),
}))

import { EverydayMemoryCard } from './everyday-memory-card'

const OLDER = { fact: 'Lives in Dubai', at: '2026-01-02T09:00:00.000Z' }
const NEWER = { fact: 'Prefers Korean', at: '2026-08-01T09:00:00.000Z' }

describe('EverydayMemoryCard', () => {
  beforeEach(() => {
    isSimpleMode = true
    mockList.mockReset().mockResolvedValue([])
    mockDelete.mockReset().mockResolvedValue(undefined)
    mockClear.mockReset().mockResolvedValue(undefined)
    mockReportFailure.mockReset()
  })

  it('renders nothing — and reads nothing — on the developer surface', () => {
    isSimpleMode = false
    const { container } = render(<EverydayMemoryCard />)
    expect(container).toBeEmptyDOMElement()
    expect(mockList).not.toHaveBeenCalled()
  })

  it('shows the empty state when the assistant remembers nothing', async () => {
    render(<EverydayMemoryCard />)
    expect(await screen.findByText(/Nothing remembered yet/i)).toBeInTheDocument()
    // With no facts there is nothing to forget, so the bulk action stays away.
    expect(screen.queryByRole('button', { name: /Forget everything/i })).not.toBeInTheDocument()
  })

  it('lists the facts newest first, with their dates', async () => {
    mockList.mockResolvedValue([OLDER, NEWER])
    render(<EverydayMemoryCard />)

    await screen.findByText(NEWER.fact)
    const facts = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(facts[0]).toContain(NEWER.fact)
    expect(facts[1]).toContain(OLDER.fact)
    // The date rides along with its fact rather than being dropped.
    expect(facts[1]).toMatch(/2026/)
  })

  it('deletes one fact by its exact text, after confirmation, then refetches', async () => {
    mockList.mockResolvedValue([OLDER, NEWER])
    render(<EverydayMemoryCard />)
    await screen.findByText(NEWER.fact)

    fireEvent.click(screen.getAllByRole('button', { name: /Forget this/i })[0])
    // Nothing is deleted until the confirmation is accepted.
    expect(mockDelete).not.toHaveBeenCalled()

    mockList.mockResolvedValue([OLDER])
    fireEvent.click(await screen.findByRole('button', { name: /^Forget$/i }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(NEWER.fact))
    await waitFor(() => expect(screen.queryByText(NEWER.fact)).not.toBeInTheDocument())
    expect(screen.getByText(OLDER.fact)).toBeInTheDocument()
  })

  it('forgets everything only after the confirmation is accepted', async () => {
    mockList.mockResolvedValue([OLDER, NEWER])
    render(<EverydayMemoryCard />)
    await screen.findByText(NEWER.fact)

    fireEvent.click(screen.getByRole('button', { name: /Forget everything/i }))
    expect(mockClear).not.toHaveBeenCalled()

    mockList.mockResolvedValue([])
    // The dialog's confirm button carries the same label as the trigger, so
    // take the one that appeared with the dialog.
    const buttons = screen.getAllByRole('button', { name: /Forget everything/i })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Nothing remembered yet/i)).toBeInTheDocument()
  })

  it('surfaces a failed read instead of showing an empty list as fact', async () => {
    mockList.mockRejectedValue(new Error('no home directory'))
    render(<EverydayMemoryCard />)
    await waitFor(() => expect(mockReportFailure).toHaveBeenCalled())
  })
})
