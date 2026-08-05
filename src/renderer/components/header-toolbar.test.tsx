import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockGitDetect = vi.fn()
const mockGitInit = vi.fn()
const mockGitDiffStats = vi.fn()

vi.mock('@/lib/ipc', () => ({
  ipc: {
    gitDetect: (...args: unknown[]) => mockGitDetect(...args),
    gitInit: (...args: unknown[]) => mockGitInit(...args),
    gitDiffStats: (...args: unknown[]) => mockGitDiffStats(...args),
  },
}))

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      selectedTaskId: null,
      tasks: {},
      terminalOpenTasks: new Set(),
      toggleTerminal: vi.fn(),
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

vi.mock('@/components/GitActionsGroup', () => ({
  GitActionsGroup: () => <div data-testid="git-actions-group" />,
}))

import { HeaderToolbar } from './header-toolbar'

beforeEach(() => {
  vi.clearAllMocks()
  mockGitDiffStats.mockResolvedValue({ additions: 0, deletions: 0, fileCount: 0 })
})

describe('HeaderToolbar', () => {
  it('shows Initialize Git button when not a git repo', async () => {
    mockGitDetect.mockResolvedValue(false)
    render(
      <HeaderToolbar
        workspace="/tmp/no-git"
        sidePanelOpen={false}
        onToggleSidePanel={vi.fn()}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('git-init-button')).toBeInTheDocument()
    })
    expect(screen.getByText('Initialize Git')).toBeInTheDocument()
    expect(screen.queryByTestId('toggle-diff-button')).not.toBeInTheDocument()
  })

  it('shows diff stats when workspace is a git repo', async () => {
    mockGitDetect.mockResolvedValue(true)
    render(
      <HeaderToolbar
        workspace="/tmp/has-git"
        sidePanelOpen={false}
        onToggleSidePanel={vi.fn()}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('toggle-diff-button')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('git-init-button')).not.toBeInTheDocument()
  })

  it('calls gitInit and switches to git toolbar on click', async () => {
    mockGitDetect.mockResolvedValue(false)
    mockGitInit.mockResolvedValue(undefined)
    render(
      <HeaderToolbar
        workspace="/tmp/no-git"
        sidePanelOpen={false}
        onToggleSidePanel={vi.fn()}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('git-init-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('git-init-button'))
    expect(mockGitInit).toHaveBeenCalledWith('/tmp/no-git')
    await waitFor(() => {
      expect(screen.getByTestId('toggle-diff-button')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('git-init-button')).not.toBeInTheDocument()
  })
})
