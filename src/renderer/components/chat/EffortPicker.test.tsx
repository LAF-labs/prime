import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EffortPicker } from './EffortPicker'
import { PanelProvider } from './PanelContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { ipc } from '@/lib/ipc'
import { THINKING_LEVELS } from '@/types'

vi.mock('@/lib/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ipc')>()
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      setThinkingLevel: vi.fn().mockResolvedValue(undefined),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    },
  }
})

const TASK = 't1'
const MODEL = 'openai/gpt-5'

const renderPicker = () =>
  render(
    <TooltipProvider>
      <PanelProvider value={TASK}>
        <EffortPicker />
      </PanelProvider>
    </TooltipProvider>,
  )

/** Both surfaces share this state; only `uiMode` decides which one renders. */
const resetStores = (uiMode: 'simple' | 'developer') => {
  vi.mocked(ipc.setThinkingLevel).mockClear()
  vi.mocked(ipc.saveSettings).mockClear()
  useTaskStore.setState({
    thinkingLevels: {},
    availableThinkingLevels: {},
    taskModels: { [TASK]: MODEL },
  })
  const { settings } = useSettingsStore.getState()
  useSettingsStore.setState({
    currentModelId: MODEL,
    settings: { ...settings, modelEfforts: undefined, uiMode },
  })
}

describe('EffortPicker', () => {
  beforeEach(() => {
    resetStores('developer')
  })

  it('hides itself when the model reports a single level', () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['off'] } })
    const { container } = renderPicker()
    expect(container.innerHTML).toBe('')
  })

  it('offers only the levels the agent reported', () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] } })
    renderPicker()
    fireEvent.click(screen.getByTestId('effort-picker').querySelector('button')!)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options.map((o) => o.textContent)).not.toContain(expect.stringContaining('Max'))
  })

  it('falls back to the full list before a session reports one', () => {
    renderPicker()
    fireEvent.click(screen.getByTestId('effort-picker').querySelector('button')!)
    expect(screen.getAllByRole('option')).toHaveLength(7)
  })

  it('pushes the choice to the agent and remembers it per model', async () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] } })
    renderPicker()
    fireEvent.click(screen.getByTestId('effort-picker').querySelector('button')!)
    fireEvent.mouseDown(screen.getByRole('option', { name: /High/ }))

    expect(ipc.setThinkingLevel).toHaveBeenCalledWith(TASK, 'high')
    expect(useTaskStore.getState().thinkingLevels[TASK]).toBe('high')
    expect(ipc.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ modelEfforts: { [MODEL]: 'high' } }),
    )
    await vi.waitFor(() =>
      expect(useSettingsStore.getState().settings.modelEfforts?.[MODEL]).toBe('high'),
    )
  })

  it('shows the saved per-model level when the session has not reported one', () => {
    const { settings } = useSettingsStore.getState()
    useSettingsStore.setState({ settings: { ...settings, modelEfforts: { [MODEL]: 'xhigh' } } })
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high', 'xhigh'] } })
    renderPicker()
    expect(screen.getByTestId('effort-picker').textContent).toContain('Extra high')
  })

  it('ignores a saved level the current model does not accept', () => {
    const { settings } = useSettingsStore.getState()
    useSettingsStore.setState({ settings: { ...settings, modelEfforts: { [MODEL]: 'max' } } })
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] } })
    renderPicker()
    // Falls back to medium rather than displaying a level that would be rejected.
    expect(screen.getByTestId('effort-picker').textContent).toContain('Medium')
  })

  it('prefers the live session level over the saved preference', () => {
    const { settings } = useSettingsStore.getState()
    useSettingsStore.setState({ settings: { ...settings, modelEfforts: { [MODEL]: 'low' } } })
    useTaskStore.setState({
      availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] },
      thinkingLevels: { [TASK]: 'high' },
    })
    renderPicker()
    expect(screen.getByTestId('effort-picker').textContent).toContain('High')
  })

  it('keeps the full dropdown, never the simple-mode switch', () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] } })
    renderPicker()
    expect(screen.getByTestId('effort-picker')).toBeTruthy()
    expect(screen.queryByTestId('think-longer-toggle')).toBeNull()
  })
})

describe('EffortPicker in simple mode', () => {
  beforeEach(() => {
    resetStores('simple')
  })

  /**
   * Simple mode shows the same control as developer mode, narrowed to three
   * steps. An on/off switch was the earlier design and the wrong
   * simplification: reasoning effort genuinely has a middle, and a binary both
   * removes it and hides which side you are on behind a single word.
   */
  it('offers exactly low, medium and high', () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: [...THINKING_LEVELS] } })
    renderPicker()
    fireEvent.click(screen.getByRole('button'))
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toHaveLength(3)
    expect(labels[0]).toContain('Low')
    expect(labels[1]).toContain('Medium')
    expect(labels[2]).toContain('High')
  })

  /** `off` degrades answers outright; the floor here is `low`, not `none`. */
  it('never offers off, even when the model accepts it', () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['off', 'low', 'medium'] } })
    renderPicker()
    fireEvent.click(screen.getByRole('button'))
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toHaveLength(2)
    expect(labels.some((l) => l?.includes('Off'))).toBe(false)
  })

  it('renders nothing when the model offers no choice', () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['off'] } })
    const { container } = renderPicker()
    expect(container.innerHTML).toBe('')
  })

  /** One level left after narrowing is not worth a picker either. */
  it('renders nothing when only one of the three is available', () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['off', 'medium', 'max'] } })
    const { container } = renderPicker()
    expect(container.innerHTML).toBe('')
  })

  it('persists the level it was given', async () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] } })
    renderPicker()
    fireEvent.click(screen.getByRole('button'))
    fireEvent.mouseDown(screen.getByRole('option', { name: /High/ }))

    expect(ipc.setThinkingLevel).toHaveBeenCalledWith(TASK, 'high')
    expect(useTaskStore.getState().thinkingLevels[TASK]).toBe('high')
    expect(ipc.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ modelEfforts: { [MODEL]: 'high' } }),
    )
    await vi.waitFor(() =>
      expect(useSettingsStore.getState().settings.modelEfforts?.[MODEL]).toBe('high'),
    )
  })

  /**
   * A level picked in developer mode has no button of its own here. It is
   * displayed as its nearest neighbour so the control never reads as broken —
   * but the stored value is untouched until the user actually picks something.
   */
  it('shows a stored xhigh as High without rewriting it', () => {
    const { settings } = useSettingsStore.getState()
    useSettingsStore.setState({ settings: { ...settings, modelEfforts: { [MODEL]: 'xhigh' } } })
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['medium', 'high', 'xhigh'] } })
    renderPicker()

    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('High')
    expect(ipc.saveSettings).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().settings.modelEfforts?.[MODEL]).toBe('xhigh')
  })

  it('shows a stored off as Low', () => {
    const { settings } = useSettingsStore.getState()
    useSettingsStore.setState({ settings: { ...settings, modelEfforts: { [MODEL]: 'off' } } })
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['off', 'low', 'medium', 'high'] } })
    renderPicker()
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Low')
  })

  it('leaves a stored level in the visible set exactly as it is', () => {
    const { settings } = useSettingsStore.getState()
    useSettingsStore.setState({ settings: { ...settings, modelEfforts: { [MODEL]: 'low' } } })
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] } })
    renderPicker()
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Low')
  })
})
