import { memo, useEffect, useMemo, useRef, type PointerEvent } from 'react'
import type { Card } from '../../../shared/board'
import type { Camera } from './Camera'
import { boardBox, minimapMap } from './geometry'

/** The size of the minimap's frame, in pixels of the window (the stylesheet has the same). */
export const MINIMAP = { width: 200, height: 132 } as const

/**
 * The whole board in a corner, as boxes, and the part the screen shows. The boxes are drawn when the cards change; the
 * box of what is shown is moved by the camera itself (`Camera.listen`), never through React. A press or a drag in it
 * puts the middle of the screen there.
 */
export const Minimap = memo(function Minimap({ cards, camera }: { cards: readonly Card[]; camera: Camera }) {
  const map = useMemo(() => minimapMap(boardBox(cards), MINIMAP), [cards])
  const shown = useRef<SVGRectElement>(null)

  useEffect(() => {
    const update = (): void => {
      const rect = shown.current
      if (!rect) return
      const v = camera.visible()
      const a = map.toMap(v.x, v.y)
      rect.setAttribute('x', String(a.x))
      rect.setAttribute('y', String(a.y))
      rect.setAttribute('width', String(v.w * map.k))
      rect.setAttribute('height', String(v.h * map.k))
    }
    update()
    return camera.listen(update)
  }, [camera, map])

  const go = (e: PointerEvent<SVGSVGElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    const at = map.toBoard(e.clientX - box.left, e.clientY - box.top)
    camera.centreOn(at.x, at.y)
  }

  return (
    <svg
      className="pboard-minimap"
      width={MINIMAP.width}
      height={MINIMAP.height}
      viewBox={`0 0 ${MINIMAP.width} ${MINIMAP.height}`}
      role="img"
      aria-label="The whole board; click or drag to move there"
      data-minimap=""
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        go(e)
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) go(e)
      }}
    >
      {cards
        .filter((c) => !c.hidden)
        .map((c) => {
          const a = map.toMap(c.x, c.y)
          return <rect key={c.id} className="pboard-mini-card" data-kind={c.kind} data-by={c.by} x={a.x} y={a.y} width={Math.max(1.5, c.w * map.k)} height={Math.max(1.5, c.h * map.k)} />
        })}
      <rect ref={shown} className="pboard-mini-view" />
    </svg>
  )
})
