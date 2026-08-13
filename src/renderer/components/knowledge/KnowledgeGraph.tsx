import { useEffect, useRef, useCallback } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force'
import type { KnowledgeNote } from '@/lib/ipc'

/**
 * The force-directed view of the knowledge base.
 *
 * Hand-rendered on a canvas with d3-force underneath, instead of a graph
 * library on top: at the 400-note cap a canvas is effortless, the bundle
 * pays ~30 KB for the physics alone, and every pixel obeys the app's theme
 * tokens — which no wrapper library's default styling does. (Reviewed:
 * react-force-graph draws by callback anyway but carries ~150 KB; sigma.js
 * is WebGL built for tens of thousands of nodes; Cosmograph's licensing
 * history rules it out; React Flow is for wired boxes, not organic graphs.)
 *
 * The look users already know for this is Obsidian's graph: dots sized by
 * substance, labels underneath, hover pulls a node's neighborhood forward
 * and fades the rest. Colors come from the categorical chart palette, one
 * hue per connected component — the clusters are the *meaning* of the graph
 * (this cluster is a client, that one is a side project), so they are what
 * color should encode.
 */

interface GraphNode extends SimulationNodeDatum {
  name: string
  title: string
  /** A [[link]] target no note exists for yet — drawn hollow, like Obsidian. */
  ghost: boolean
  radius: number
  /** Connected-component index, for color. */
  component: number
  degree: number
}

interface GraphLink {
  source: GraphNode
  target: GraphNode
}

interface Props {
  notes: KnowledgeNote[]
  selected: string | null
  onSelect: (name: string | null) => void
}

/** Theme tokens are read per frame so a light/dark flip repaints correctly. */
function themeColors(element: HTMLElement) {
  // Read from the canvas, not documentElement: the tokens cascade, and the
  // dark class may sit on any ancestor (the preview harness proved it).
  const style = getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    foreground: token('--foreground', '#1f1f1f'),
    muted: token('--muted-foreground', '#6e6e6e'),
    border: token('--border', '#e6e6e6'),
    primary: token('--primary', '#1e90ff'),
    charts: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => token(`--chart-${i}`, '#1e90ff')),
  }
}

export function buildGraph(notes: KnowledgeNote[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const byName = new Map<string, GraphNode>()
  for (const note of notes) {
    byName.set(note.name, {
      name: note.name,
      title: note.title,
      ghost: false,
      // Substance-scaled, gently: a 6k-char note is a dot, not a planet.
      radius: 6 + Math.min(8, Math.sqrt(note.chars) / 9),
      component: 0,
      degree: 0,
    })
  }
  const links: GraphLink[] = []
  for (const note of notes) {
    const source = byName.get(note.name)!
    for (const target of note.links) {
      if (!byName.has(target)) {
        // An unresolved [[link]] still means something: the model referred to
        // a note it has not written yet. Obsidian draws these hollow; so do
        // we, and clicking one does nothing.
        byName.set(target, {
          name: target, title: target, ghost: true, radius: 5, component: 0, degree: 0,
        })
      }
      const t = byName.get(target)!
      links.push({ source, target: t })
      source.degree += 1
      t.degree += 1
    }
  }
  // Connected components, for color. Union-find is overkill at this size;
  // BFS over an adjacency map reads better.
  const adjacency = new Map<string, string[]>()
  for (const l of links) {
    adjacency.set(l.source.name, [...(adjacency.get(l.source.name) ?? []), l.target.name])
    adjacency.set(l.target.name, [...(adjacency.get(l.target.name) ?? []), l.source.name])
  }
  let component = 0
  const seen = new Set<string>()
  for (const node of byName.values()) {
    if (seen.has(node.name)) continue
    const queue = [node.name]
    seen.add(node.name)
    while (queue.length > 0) {
      const current = queue.pop()!
      byName.get(current)!.component = component
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    component += 1
  }
  return { nodes: [...byName.values()], links }
}

export const KnowledgeGraph = ({ notes, selected, onSelect }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<{
    nodes: GraphNode[]
    links: GraphLink[]
    sim: Simulation<GraphNode, undefined> | null
    hover: GraphNode | null
    transform: { x: number; y: number; k: number }
    dragging: GraphNode | null
    panning: { x: number; y: number } | null
    raf: number
    fitted: boolean
  }>({ nodes: [], links: [], sim: null, hover: null, transform: { x: 0, y: 0, k: 1 }, dragging: null, panning: null, raf: 0, fitted: false })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const state = stateRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
    }
    const colors = themeColors(canvas)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const { x: tx, y: ty, k } = state.transform
    ctx.translate(width / 2 + tx, height / 2 + ty)
    ctx.scale(k, k)

    const focus = state.hover ?? state.nodes.find((n) => n.name === selected) ?? null
    const neighborhood = new Set<string>()
    if (focus) {
      neighborhood.add(focus.name)
      for (const l of state.links) {
        if (l.source.name === focus.name) neighborhood.add(l.target.name)
        if (l.target.name === focus.name) neighborhood.add(l.source.name)
      }
    }
    const faded = (name: string) => (focus ? !neighborhood.has(name) : false)

    // Edges first, under the nodes.
    for (const link of state.links) {
      const dim = faded(link.source.name) || faded(link.target.name)
      ctx.strokeStyle = colors.border
      ctx.globalAlpha = dim ? 0.12 : 0.75
      ctx.lineWidth = dim ? 1 : 1.4
      ctx.beginPath()
      ctx.moveTo(link.source.x!, link.source.y!)
      ctx.lineTo(link.target.x!, link.target.y!)
      ctx.stroke()
    }

    for (const node of state.nodes) {
      const dim = faded(node.name)
      const color = node.ghost ? colors.muted : colors.charts[node.component % colors.charts.length]
      ctx.globalAlpha = dim ? 0.18 : 1
      ctx.beginPath()
      ctx.arc(node.x!, node.y!, node.radius, 0, Math.PI * 2)
      if (node.ghost) {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 3])
        ctx.stroke()
        ctx.setLineDash([])
      } else {
        ctx.fillStyle = color
        if (!dim) {
          ctx.shadowColor = color
          ctx.shadowBlur = 10
        }
        ctx.fill()
        ctx.shadowBlur = 0
        if (node.name === selected || node === state.hover) {
          ctx.strokeStyle = colors.foreground
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }
      // Labels: the graph is for finding things, so names stay visible.
      const label = node.title.length > 14 ? `${node.title.slice(0, 14)}…` : node.title
      ctx.font = `${node === state.hover ? 600 : 450} 12.5px -apple-system, "Apple SD Gothic Neo", sans-serif`
      ctx.textAlign = 'center'
      ctx.fillStyle = dim ? colors.muted : colors.foreground
      ctx.globalAlpha = dim ? 0.25 : node.ghost ? 0.6 : 0.95
      ctx.fillText(label, node.x!, node.y! + node.radius + 13)
    }
    ctx.globalAlpha = 1
  }, [selected])

  // Build the simulation whenever the notes change.
  useEffect(() => {
    const state = stateRef.current
    const { nodes, links } = buildGraph(notes)
    state.nodes = nodes
    state.links = links
    state.sim?.stop()
    state.fitted = false
    state.sim = forceSimulation(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links).id((d) => d.name).distance(84).strength(0.5))
      .force('charge', forceManyBody().strength(-340))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<GraphNode>((d) => d.radius + 22))
      // A weak pull keeps disconnected clusters on screen instead of
      // drifting apart forever.
      .force('x', forceX(0).strength(0.04))
      .force('y', forceY(0).strength(0.05))
      .on('tick', () => {
        // Fit once, as the layout cools: whatever the note count, the whole
        // graph greets the user at a sensible size instead of a distant clump.
        if (!state.fitted && (state.sim?.alpha() ?? 1) < 0.12 && canvasRef.current) {
          state.fitted = true
          const xs = nodes.map((n) => n.x ?? 0)
          const ys = nodes.map((n) => n.y ?? 0)
          const spanX = Math.max(...xs) - Math.min(...xs) + 120
          const spanY = Math.max(...ys) - Math.min(...ys) + 120
          const { clientWidth, clientHeight } = canvasRef.current
          state.transform.k = Math.min(2.2, Math.max(0.35, Math.min(clientWidth / spanX, clientHeight / spanY)))
          state.transform.x = -((Math.max(...xs) + Math.min(...xs)) / 2) * state.transform.k
          state.transform.y = -((Math.max(...ys) + Math.min(...ys)) / 2) * state.transform.k
        }
        cancelAnimationFrame(state.raf)
        state.raf = requestAnimationFrame(draw)
      })
    return () => {
      state.sim?.stop()
      cancelAnimationFrame(state.raf)
    }
  }, [notes, draw])

  // Redraw on selection/theme changes without reheating the physics.
  useEffect(() => {
    const state = stateRef.current
    cancelAnimationFrame(state.raf)
    state.raf = requestAnimationFrame(draw)
  }, [draw])

  const toGraphSpace = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const { x: tx, y: ty, k } = stateRef.current.transform
    return {
      x: (event.clientX - rect.left - rect.width / 2 - tx) / k,
      y: (event.clientY - rect.top - rect.height / 2 - ty) / k,
    }
  }, [])

  const nodeAt = useCallback((x: number, y: number): GraphNode | null => {
    let best: GraphNode | null = null
    let bestDistance = Infinity
    for (const node of stateRef.current.nodes) {
      const d = Math.hypot(node.x! - x, node.y! - y)
      if (d < node.radius + 6 && d < bestDistance) {
        best = node
        bestDistance = d
      }
    }
    return best
  }, [])

  const schedule = useCallback(() => {
    const state = stateRef.current
    cancelAnimationFrame(state.raf)
    state.raf = requestAnimationFrame(draw)
  }, [draw])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current
    const p = toGraphSpace(e)
    const hit = nodeAt(p.x, p.y)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    if (hit && !hit.ghost) {
      state.dragging = hit
      hit.fx = hit.x
      hit.fy = hit.y
      state.sim?.alphaTarget(0.25).restart()
    } else {
      state.panning = { x: e.clientX - state.transform.x, y: e.clientY - state.transform.y }
    }
  }, [toGraphSpace, nodeAt])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current
    if (state.dragging) {
      const p = toGraphSpace(e)
      state.dragging.fx = p.x
      state.dragging.fy = p.y
      return
    }
    if (state.panning) {
      state.transform.x = e.clientX - state.panning.x
      state.transform.y = e.clientY - state.panning.y
      schedule()
      return
    }
    const p = toGraphSpace(e)
    const hit = nodeAt(p.x, p.y)
    if (hit !== state.hover) {
      state.hover = hit
      if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'pointer' : 'grab'
      schedule()
    }
  }, [toGraphSpace, nodeAt, schedule])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current
    if (state.dragging) {
      const moved = Math.hypot((state.dragging.fx ?? 0) - (state.dragging.x ?? 0), (state.dragging.fy ?? 0) - (state.dragging.y ?? 0))
      const node = state.dragging
      node.fx = null
      node.fy = null
      state.sim?.alphaTarget(0)
      state.dragging = null
      // A press that never really moved is a click.
      if (moved < 3) onSelect(node.name === selected ? null : node.name)
      return
    }
    if (state.panning) {
      state.panning = null
      return
    }
    const p = toGraphSpace(e)
    if (!nodeAt(p.x, p.y)) onSelect(null)
  }, [toGraphSpace, nodeAt, onSelect, selected])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const state = stateRef.current
    const factor = Math.exp(-e.deltaY * 0.002)
    const next = Math.min(2.5, Math.max(0.35, state.transform.k * factor))
    // Zoom toward the cursor: keep the point under it fixed.
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2
    const scale = next / state.transform.k
    state.transform.x = cx - (cx - state.transform.x) * scale
    state.transform.y = cy - (cy - state.transform.y) * scale
    state.transform.k = next
    schedule()
  }, [schedule])

  return (
    <canvas
      ref={canvasRef}
      data-testid="knowledge-graph-canvas"
      className="size-full cursor-grab touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    />
  )
}
