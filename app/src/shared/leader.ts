/**
 * The leader rule's geometry (spec 2026-11-18, section 1): a ring on the subject, one straight leg, and a 12 px
 * shoulder into the nearest edge of the tag. Pure, in window pixels; `LeaderLayer` draws what it returns.
 */
export type Pt = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }

/** The ring's radius, and the length of the shoulder, in pixels. */
export const RING_R = 3
export const SHOULDER = 12

export interface LeaderPath {
  /** On the subject. */
  ring: Pt
  /** From the ring to where the shoulder starts. */
  leg: [Pt, Pt]
  /** From where the leg ends, `SHOULDER` px out, to the edge it goes into. */
  shoulder: [Pt, Pt]
}

type Side = 'top' | 'bottom' | 'left' | 'right'

const inside = (p: Pt, b: Box): boolean => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The gap between a point and a span of one axis: 0 within it. */
function gap(v: number, lo: number, hi: number): number {
  return v < lo ? lo - v : v > hi ? v - hi : 0
}

/** Where along an edge the shoulder lands: straight across from the subject if it is level with the edge, else the middle. */
function along(v: number, lo: number, hi: number): number {
  return v >= lo && v <= hi ? v : (lo + hi) / 2
}

/** The side of `box` that faces `from`: the one along the axis the subject is farthest away on (the leg arrives along it). */
function facing(from: Pt, box: Box): Side {
  const dx = gap(from.x, box.x, box.x + box.w)
  const dy = gap(from.y, box.y, box.y + box.h)
  if (dy >= dx) return from.y < box.y ? 'top' : 'bottom'
  return from.x < box.x ? 'left' : 'right'
}

/** The shoulder into `side` of `edge` (the box whose edge it is), its row or column set by `level`. */
function shoulderInto(side: Side, edge: Box, level: Pt, outwards: boolean): [Pt, Pt] {
  // `outwards`: the shoulder starts outside the box (a tag's edge). It starts inside it for a pane's edge.
  const d = outwards ? SHOULDER : -SHOULDER
  switch (side) {
    case 'top':
      return [{ x: level.x, y: edge.y - d }, { x: level.x, y: edge.y }]
    case 'bottom':
      return [{ x: level.x, y: edge.y + edge.h + d }, { x: level.x, y: edge.y + edge.h }]
    case 'left':
      return [{ x: edge.x - d, y: level.y }, { x: edge.x, y: level.y }]
    case 'right':
      return [{ x: edge.x + edge.w + d, y: level.y }, { x: edge.x + edge.w, y: level.y }]
  }
}

/**
 * The leader from `subject` to `tag`. With `clip` (a pane's box) and the tag wholly outside it, the leg stops at the
 * pane's edge at the tag's height (a borrowed leader) and the shoulder runs 12 px back into the pane. Null when the
 * subject is under the tag: there is nothing to tie.
 */
export function leaderPath(subject: Pt, tag: Box, clip?: Box): LeaderPath | null {
  if (inside(subject, tag)) return null
  const outside = clip !== undefined && (tag.x >= clip.x + clip.w || tag.x + tag.w <= clip.x || tag.y >= clip.y + clip.h || tag.y + tag.h <= clip.y)
  let shoulder: [Pt, Pt]
  if (clip && outside) {
    const mid = { x: tag.x + tag.w / 2, y: tag.y + tag.h / 2 }
    const side = facing(mid, clip)
    const level = { x: clamp(mid.x, clip.x, clip.x + clip.w), y: clamp(mid.y, clip.y, clip.y + clip.h) }
    shoulder = shoulderInto(side, clip, level, false)
  } else {
    const side = facing(subject, tag)
    const level = { x: along(subject.x, tag.x, tag.x + tag.w), y: along(subject.y, tag.y, tag.y + tag.h) }
    shoulder = shoulderInto(side, tag, level, true)
  }
  return { ring: { ...subject }, leg: [{ ...subject }, shoulder[0]], shoulder }
}

/** Whether the segment a to b meets the box (Liang-Barsky). */
function segmentMeets(a: Pt, b: Pt, box: Box): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const edges: Array<[number, number]> = [
    [-dx, a.x - box.x],
    [dx, box.x + box.w - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.h - a.y]
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const r = q / p
      if (p < 0) {
        if (r > t1) return false
        t0 = Math.max(t0, r)
      } else {
        if (r < t0) return false
        t1 = Math.min(t1, r)
      }
    }
  }
  return true
}

/** Whether the line (leg and shoulder) runs through any of the boxes: the text a leader must not cross. */
export function crossesBoxes(path: LeaderPath, boxes: Box[]): boolean {
  return boxes.some((box) => segmentMeets(path.leg[0], path.leg[1], box) || segmentMeets(path.shoulder[0], path.shoulder[1], box))
}
