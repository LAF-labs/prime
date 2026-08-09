import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EffortPicker } from './EffortPicker'
import { PanelProvider } from './PanelContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { ipc } from '@/lib/ipc'

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

  it('renders the Think longer switch instead of the dropdown', () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] } })
    renderPicker()
    const toggle = screen.getByTestId('think-longer-toggle')
    expect(toggle.textContent).toContain('Think longer')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByTestId('effort-picker')).toBeNull()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders nothing when the model offers no choice', () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['off'] } })
    const { container } = renderPicker()
    expect(container.innerHTML).toBe('')
  })

  it('persists high when switched on', async () => {
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] } })
    renderPicker()
    fireEvent.click(screen.getByRole('switch'))

    expect(ipc.setThinkingLevel).toHaveBeenCalledWith(TASK, 'high')
    expect(useTaskStore.getState().thinkingLevels[TASK]).toBe('high')
    expect(ipc.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ modelEfforts: { [MODEL]: 'high' } }),
    )
    await vi.waitFor(() =>
      expect(useSettingsStore.getState().settings.modelEfforts?.[MODEL]).toBe('high'),
    )
  })

  it('persists medium — not off — when switched back off', async () => {
    const { settings } = useSettingsStore.getState()
    useSettingsStore.setState({ settings: { ...settings, modelEfforts: { [MODEL]: 'high' } } })
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['off', 'low', 'medium', 'high'] } })
    renderPicker()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch'))

    expect(ipc.setThinkingLevel).toHaveBeenCalledWith(TASK, 'medium')
    expect(ipc.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ modelEfforts: { [MODEL]: 'medium' } }),
    )
    await vi.waitFor(() =>
      expect(useSettingsStore.getState().settings.modelEfforts?.[MODEL]).toBe('medium'),
    )
  })

  it('reads a stored xhigh as on and leaves it alone until toggled', () => {
    const { settings } = useSettingsStore.getState()
    useSettingsStore.setState({ settings: { ...settings, modelEfforts: { [MODEL]: 'xhigh' } } })
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['medium', 'high', 'xhigh'] } })
    renderPicker()

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    // Rendering must not rewrite a developer's stored level.
    expect(ipc.saveSettings).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().settings.modelEfforts?.[MODEL]).toBe('xhigh')
  })

  it('reads a stored low as off', () => {
    const { settings } = useSettingsStore.getState()
    useSettingsStore.setState({ settings: { ...settings, modelEfforts: { [MODEL]: 'low' } } })
    useTaskStore.setState({ availableThinkingLevels: { [TASK]: ['low', 'medium', 'high'] } })
    renderPicker()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })
})
