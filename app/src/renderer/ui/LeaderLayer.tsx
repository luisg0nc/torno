import { useEffect, useRef } from 'react'
import { leaderPath, RING_R } from '../../shared/leader'
import { BORROWED, getLeaders, subscribeLeaders, type LeaderEntry } from '../state/leaders'

const NS = 'http://www.w3.org/2000/svg'

const points = (pts: Array<{ x: number; y: number }>): string => pts.map((p) => `${p.x},${p.y}`).join(' ')

/**
 * Every leader of the window, drawn by one layer: an SVG at the window's size, above the panes and below the
 * popovers, that takes no pointer. It draws what `state/leaders.ts` holds, straight into the DOM and not through
 * React, since the tool's leaders move with the camera. A leader that is new draws out once (`leaders.css`); one that
 * only moves does not.
 */
export function LeaderLayer() {
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const root = svg.current
    if (!root) return
    const drawn = new Map<string, { group: SVGGElement; line: SVGPolylineElement; ring: SVGCircleElement }>()
    const draw = (list: LeaderEntry[]): void => {
      const live = new Set<string>()
      for (const entry of list) {
        const path = leaderPath(entry.subject, entry.tag, entry.clip)
        if (!path) continue
        live.add(entry.id)
        let one = drawn.get(entry.id)
        if (!one) {
          const group = document.createElementNS(NS, 'g')
          group.setAttribute('class', 'leader')
          group.dataset.leader = entry.id
          if (entry.id === BORROWED) group.dataset.kind = 'borrowed'
          const line = document.createElementNS(NS, 'polyline')
          line.setAttribute('class', 'leader-line')
          // One unit long whatever its length, for the draw-out (`stroke-dashoffset`).
          line.setAttribute('pathLength', '1')
          const ring = document.createElementNS(NS, 'circle')
          ring.setAttribute('class', 'leader-ring')
          ring.setAttribute('r', String(RING_R))
          group.append(line, ring)
          root.append(group)
          one = { group, line, ring }
          drawn.set(entry.id, one)
        }
        one.line.setAttribute('points', points([path.ring, ...path.leg.slice(1), path.shoulder[1]]))
        one.ring.setAttribute('cx', String(path.ring.x))
        one.ring.setAttribute('cy', String(path.ring.y))
      }
      for (const [id, one] of drawn) {
        if (live.has(id)) continue
        one.group.remove()
        drawn.delete(id)
      }
    }
    draw(getLeaders())
    const off = subscribeLeaders(draw)
    return () => {
      off()
      root.replaceChildren()
    }
  }, [])
  return <svg ref={svg} className="leader-layer" aria-hidden="true" />
}
