import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PermissionBanner } from './PermissionBanner'

const OPTIONS = [
  { optionId: 'Allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'Deny', name: 'Deny', kind: 'reject_once' },
]

const renderBanner = (toolName: string, description: string) =>
  render(
    <PermissionBanner
      taskId="t1"
      toolName={toolName}
      description={description}
      options={OPTIONS}
      onSelect={vi.fn()}
    />,
  )

describe('PermissionBanner', () => {
  /**
   * The description was declared in the props interface, passed in from both
   * call sites, and never destructured — so approving meant approving a tool
   * name, with the file or the command nowhere on screen. Everything the gate
   * computes for this dialog reaches the component and stopped there.
   */
  it('shows what is about to happen, not just which tool', () => {
    renderBanner('bash', '지울것.txt 파일을 영구 삭제합니다.\nrm 지울것.txt')
    expect(screen.getByTestId('permission-headline')).toHaveTextContent(
      '지울것.txt 파일을 영구 삭제합니다.',
    )
  })

  /**
   * The sentence is for the person; the command is for anyone who can read it.
   * Dropping either one was the thing to avoid — a summary with no command
   * hides what runs, a command with no summary is unreadable to the user this
   * is built for.
   */
  it('keeps the literal command alongside the explanation', () => {
    renderBanner('bash', '지울것.txt 파일을 영구 삭제합니다.\nrm 지울것.txt')
    expect(screen.getByTestId('permission-detail')).toHaveTextContent('rm 지울것.txt')
  })

  it('shows a lone path with no detail block', () => {
    renderBanner('write_file', '~/메모.txt — replaces the file that is already there')
    expect(screen.getByTestId('permission-headline')).toHaveTextContent('replaces the file')
    expect(screen.queryByTestId('permission-detail')).toBeNull()
  })

  it('renders without a description rather than showing an empty box', () => {
    renderBanner('read_file', '')
    expect(screen.queryByTestId('permission-headline')).toBeNull()
    expect(screen.queryByTestId('permission-detail')).toBeNull()
    expect(screen.getByTestId('permission-banner')).toBeInTheDocument()
  })

  /** "bash" names the tool, not what it does to someone's computer. */
  it('names the tool in words a non-developer can act on', () => {
    renderBanner('bash', 'x')
    expect(screen.getByTestId('permission-banner')).toHaveTextContent(
      'run a command on your computer',
    )
  })
})
