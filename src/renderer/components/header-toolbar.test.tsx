import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockToggleFileTree = vi.fn()

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      selectedTaskId: null,
      tasks: {},
      terminalOpenTasks: new Set(),
      toggleTerminal: vi.fn(),
      activeSplitId: null,
    }),
}))

vi.mock('@/stores/fileTreeStore', () => ({
  useFileTreeStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      isOpen: false,
      toggle: mockToggleFileTree,
    }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/OpenInEditorGroup', () => ({
  OpenInEditorGroup: () => null,
}))

import { HeaderToolbar } from './header-toolbar'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HeaderToolbar', () => {
  it('always shows the file tree toggle', () => {
    render(<HeaderToolbar workspace="/tmp/anywhere" />)
    expect(screen.getByTestId('toggle-file-tree-button')).toBeInTheDocument()
  })

  it('toggles the file tree store on click', () => {
    render(<HeaderToolbar workspace="/tmp/anywhere" />)
    fireEvent.click(screen.getByTestId('toggle-file-tree-button'))
    expect(mockToggleFileTree).toHaveBeenCalledTimes(1)
  })

  it('hides the terminal toggle when no thread is selected', () => {
    render(<HeaderToolbar workspace="/tmp/anywhere" />)
    expect(screen.queryByTestId('toggle-terminal-button')).not.toBeInTheDocument()
  })

  it('hides the split toggle when no thread is selected', () => {
    render(<HeaderToolbar workspace="/tmp/anywhere" />)
    expect(screen.queryByTestId('toggle-split-button')).not.toBeInTheDocument()
  })
})
