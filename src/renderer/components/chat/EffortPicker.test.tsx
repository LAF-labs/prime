import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EffortPicker } from './EffortPicker'
import { PanelProvider } from './PanelContext'
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
    <PanelProvider value={TASK}>
      <EffortPicker />
    </PanelProvider>,
  )

describe('EffortPicker', () => {
  beforeEach(() => {
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
      settings: { ...settings, modelEfforts: undefined },
    })
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
})
