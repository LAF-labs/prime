import { describe, it, expect } from 'vitest'
import { buildGraph } from './KnowledgeGraph'
import type { KnowledgeNote } from '@/lib/ipc'

const note = (name: string, links: string[] = [], chars = 500): KnowledgeNote => ({
  name, title: name, updated: null, links, chars,
})

describe('buildGraph', () => {
  it('links notes and colors clusters by connected component', () => {
    const { nodes, links } = buildGraph([
      note('a', ['b']), note('b'),
      note('c', ['d']), note('d'),
      note('lone'),
    ])
    expect(links).toHaveLength(2)
    const component = (n: string) => nodes.find((x) => x.name === n)!.component
    expect(component('a')).toBe(component('b'))
    expect(component('c')).toBe(component('d'))
    expect(component('a')).not.toBe(component('c'))
    expect(component('lone')).not.toBe(component('a'))
  })

  /**
   * A [[link]] to a note that does not exist yet still means something — the
   * model referred to a thing it has not written. Obsidian draws these hollow;
   * losing them would hide the graph's growth edge.
   */
  it('keeps unresolved links as ghost nodes', () => {
    const { nodes } = buildGraph([note('계약', [['미래의-노트']].flat())])
    const ghost = nodes.find((n) => n.name === '미래의-노트')
    expect(ghost?.ghost).toBe(true)
    expect(nodes.find((n) => n.name === '계약')?.ghost).toBe(false)
  })

  it('sizes nodes by substance, gently', () => {
    const { nodes } = buildGraph([note('small', [], 100), note('big', [], 6000)])
    const r = (n: string) => nodes.find((x) => x.name === n)!.radius
    expect(r('big')).toBeGreaterThan(r('small'))
    // A 6k note is a dot, not a planet: the cap keeps the ratio civil.
    expect(r('big') / r('small')).toBeLessThan(2.5)
  })
})
