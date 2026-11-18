import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Box } from '../../../shared/leader'
import { placeTag, tagSubject, type Side } from '../../../shared/tagPlace'
import { onPaneDrawn, paneRect, projectToPane } from '../../viewport/overlay'
import { publishTag, withdrawTag } from './useTagAt'

type Vec3 = readonly [number, number, number]

/** Room kept round what a tag stands clear of, in px. */
const AVOID_PAD = 4

/** A tag's neighbours it must not cover: what the view marks `data-tag-avoid` (the compass, the band), and the tags before it. */
function avoidBoxes(self: HTMLElement, within: HTMLElement, origin: { left: number; top: number }): Box[] {
  const boxes: Box[] = []
  for (const other of within.querySelectorAll<HTMLElement>('[data-tag-avoid], [data-tag]')) {
    if (other === self || other.hidden) continue
    // Tags place themselves in the order they were mounted: each clears the ones before it, so that two never chase each other.
    if (other.hasAttribute('data-tag') && !(self.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_PRECEDING)) continue
    const r = other.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    boxes.push({ x: r.left - origin.left - AVOID_PAD, y: r.top - origin.top - AVOID_PAD, w: r.width + 2 * AVOID_PAD, h: r.height + 2 * AVOID_PAD })
  }
  return boxes
}

export interface TagProps {
  /** Names the tag, for its leader, `useTagAt` and the tests. */
  id: string
  /** What it is about, a point of the object frame; null where there is none, or it is seen edge on: the tag docks then. */
  subject: Vec3 | null
  /** A subject that moves without a render (a plane being dragged): asked after every frame, in place of `subject`. */
  subjectAt?: () => Vec3 | null
  /** The side it starts on, before it has one of its own. */
  prefer?: Exclude<Side, 'docked'>
  /** Whether it keeps the side it had while that still fits (the default), so that it does not hop as the camera moves; false asks for `prefer` first every frame. */
  sticky?: boolean
  /** A problem: the second tag below the first, in `--fail` on `--fail-wash`. */
  problem?: boolean
  /** Read out when it changes (`role="status"`), for a tag that says how a thing went. */
  status?: boolean
  children: ReactNode
}

/**
 * A control or a reading that stands beside what it is about, tied by a leader (spec 2026-11-18, sections 1 and 2).
 * It is placed by `placeTag` after every frame of the view, from where the camera puts its subject, straight on the
 * element and not through React: clear of the reed, the compass and the band, and of the tags before it. It keeps
 * its side while that still fits. With no subject, or a subject off the view or behind the camera, it docks above the hint
 * and has no leader. Its leader is set through `publishTag`.
 */
export function Tag({ id, subject, subjectAt, prefer, sticky = true, problem, status, children }: TagProps) {
  const element = useRef<HTMLDivElement>(null)
  const subjectRef = useRef(subject)
  subjectRef.current = subject
  const subjectAtRef = useRef(subjectAt)
  subjectAtRef.current = subjectAt
  const side = useRef<Exclude<Side, 'docked'> | undefined>(prefer)
  const place = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const self = element.current!
    place.current = () => {
      const within = self.offsetParent instanceof HTMLElement ? self.offsetParent : null
      const canvas = paneRect()
      if (!within || !canvas) {
        self.style.visibility = 'hidden'
        return
      }
      const pane = within.getBoundingClientRect()
      const view: Box = { x: 0, y: 0, w: pane.width, h: pane.height }
      const now = subjectAtRef.current ? subjectAtRef.current() : subjectRef.current
      const point = now ? projectToPane(now) : null
      const at = tagSubject(point && { x: point.x + canvas.left - pane.left, y: point.y + canvas.top - pane.top }, view)
      const size = { w: self.offsetWidth, h: self.offsetHeight }
      const avoid = avoidBoxes(self, within, pane)
      const placed = placeTag(at, size, view, avoid, sticky ? side.current : prefer)
      if (placed.side !== 'docked') side.current = placed.side
      else {
        // Docked tags stack up from the hint: one meeting a tag before it stands above it.
        for (const a of avoid) if (placed.box.x < a.x + a.w && a.x < placed.box.x + size.w && placed.box.y < a.y + a.h && a.y < placed.box.y + size.h) placed.box.y = a.y - size.h - AVOID_PAD
      }
      self.style.transform = `translate(${Math.round(placed.box.x)}px, ${Math.round(placed.box.y)}px)`
      self.dataset.side = placed.side
      self.style.visibility = ''
      publishTag(id, { box: placed.box, side: placed.side, subject: placed.side === 'docked' ? null : at }, { x: pane.left, y: pane.top })
    }
    place.current()
    const off = onPaneDrawn(() => place.current())
    // The tag grows with what is in it.
    const sized = new ResizeObserver(() => place.current())
    sized.observe(self)
    return () => {
      off()
      sized.disconnect()
      withdrawTag(id)
    }
  }, [id])

  // A subject that moved without the camera (a plane's value typed in) is placed at once, not at the next frame.
  const key = subject ? subject.join(',') : ''
  useLayoutEffect(() => place.current(), [key])

  return (
    <div ref={element} className="tag" data-tag={id} data-problem={problem || undefined} role={status ? 'status' : undefined} style={{ visibility: 'hidden' }}>
      {children}
    </div>
  )
}
