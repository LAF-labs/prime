import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PermissionsSection } from './permissions-section'
import type { AppSettings } from '@/types'

const baseDraft = (patch: Partial<AppSettings> = {}): AppSettings => ({
  agentBin: 'prime-agent',
  agentProfiles: [],
  fontSize: 14,
  permissionMode: 'ask',
  ...patch,
})

describe('PermissionsSection', () => {
  it('marks the active mode radio as checked', () => {
    render(<PermissionsSection draft={baseDraft({ permissionMode: 'acceptEdits' })} updateDraft={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Accept edits/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Ask first/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('selecting a mode writes the mode and the synced autoApprove bool', () => {
    const updateDraft = vi.fn()
    render(<PermissionsSection draft={baseDraft()} updateDraft={updateDraft} />)

    fireEvent.click(screen.getByRole('radio', { name: /Auto-run/i }))
    expect(updateDraft).toHaveBeenCalledWith({ permissionMode: 'auto', autoApprove: true })

    fireEvent.click(screen.getByRole('radio', { name: /Accept edits/i }))
    expect(updateDraft).toHaveBeenCalledWith({ permissionMode: 'acceptEdits', autoApprove: false })
  })

  it('shows the empty state when there are no rules', () => {
    render(<PermissionsSection draft={baseDraft()} updateDraft={vi.fn()} />)
    expect(screen.getByText(/No allow rules yet/i)).toBeInTheDocument()
  })

  it('adds a rule from the form via updateDraft', () => {
    const updateDraft = vi.fn()
    render(<PermissionsSection draft={baseDraft()} updateDraft={updateDraft} />)

    fireEvent.change(screen.getByLabelText('Tool name'), { target: { value: 'bash' } })
    fireEvent.change(screen.getByLabelText('Argument pattern'), { target: { value: 'git *' } })
    fireEvent.click(screen.getByRole('button', { name: /Add rule/i }))

    expect(updateDraft).toHaveBeenCalledWith({ permissionRules: [{ tool: 'bash', argPattern: 'git *' }] })
  })

  it('disables Add when the tool is blank', () => {
    render(<PermissionsSection draft={baseDraft()} updateDraft={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Add rule/i })).toBeDisabled()
  })

  it('renders existing rules and deletes by identity', () => {
    const updateDraft = vi.fn()
    const rules = [{ tool: 'read' }, { tool: 'bash', argPattern: 'git *' }]
    render(<PermissionsSection draft={baseDraft({ permissionRules: rules })} updateDraft={updateDraft} />)

    // Both rules show their tool name.
    expect(screen.getByText('read')).toBeInTheDocument()
    expect(screen.getByText('git *')).toBeInTheDocument()

    const deletes = screen.getAllByRole('button', { name: /Delete rule/i })
    fireEvent.click(deletes[0]) // remove the "read" rule
    expect(updateDraft).toHaveBeenCalledWith({ permissionRules: [{ tool: 'bash', argPattern: 'git *' }] })
  })

  it('warns when the tool name is not a known built-in', () => {
    render(<PermissionsSection draft={baseDraft()} updateDraft={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Tool name'), { target: { value: 'mystery_tool' } })
    expect(screen.getByText(/not a known built-in tool/i)).toBeInTheDocument()
  })
})
