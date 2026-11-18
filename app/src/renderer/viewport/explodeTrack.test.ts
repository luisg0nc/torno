import { describe, expect, it } from 'vitest'
import type { Pt } from '../../shared/leader'
import { MIN_TRACK_PX, amountAlong, planTrack, trackPoint, type Box3, type TrackPlan } from './explodeTrack'

const BOX: Box3 = { min: [0, 0, 0], max: [100, 60, 40] }

/** A camera that looks along -Y with Z up: X goes right, Z goes up, Y goes into the screen. */
const front = (p: readonly [number, number, number]): Pt => ({ x: 400 + p[0] * 3, y: 300 - p[2] * 3 })
/** From above: X right, Y up the screen, Z straight at the viewer. */
const top = (p: readonly [number, number, number]): Pt => ({ x: 400 + p[0] * 3, y: 300 - p[1] * 3 })

describe('where the explode track stands', () => {
  it('goes up along Z beside the box, on its right, the length of its largest side', () => {
    const plan = planTrack(BOX, front, null)!
    expect(plan.axis).toBe(2)
    // Outside the box on both sides it does not run along.
    expect(plan.from[0]).toBeGreaterThan(BOX.max[0])
    expect(plan.from[2]).toBe(0)
    expect(plan.to[2]).toBeCloseTo(100, 9)
    expect(plan.to[0]).toBe(plan.from[0])
  })

  it('runs along the longest side the view shows when Z is seen end on', () => {
    const plan = planTrack(BOX, top, null)!
    expect(plan.axis).not.toBe(2)
    const a = top(plan.from)
    const b = top(plan.to)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(MIN_TRACK_PX)
  })

  it('is nowhere when nothing is long enough on screen', () => {
    expect(planTrack(BOX, () => ({ x: 10, y: 10 }), null)).toBeNull()
    expect(planTrack(BOX, () => null, null)).toBeNull()
  })

  it('keeps its corner while that is about as good as the best, and lets go of one that is not', () => {
    const first = planTrack(BOX, front, null)!
    // Seen a little from the left, the right-hand corner is nearly as far right as the other: it stays.
    const skewed = (p: readonly [number, number, number]): Pt => ({ x: 400 + p[0] * 3 + p[1] * 0.1, y: 300 - p[2] * 3 })
    const swung = planTrack(BOX, skewed, first)!
    expect(swung.from).toEqual(first.from)
    // The one on the far left is not worth keeping.
    const left: TrackPlan = { ...first, from: [BOX.min[0] - 12, first.from[1], 0], to: [BOX.min[0] - 12, first.from[1], 100] }
    expect(planTrack(BOX, front, left)!.from[0]).toBeGreaterThan(BOX.max[0])
  })

  it('says how far along the amount is, from the pointer, held between 0 and 1', () => {
    const plan = planTrack(BOX, front, null)!
    const a = front(plan.from)
    const b = front(plan.to)
    expect(amountAlong(a, b, a)).toBe(0)
    expect(amountAlong(a, b, b)).toBe(1)
    expect(amountAlong(a, b, { x: a.x + 50, y: (a.y + b.y) / 2 })).toBeCloseTo(0.5, 9)
    expect(amountAlong(a, b, { x: a.x, y: a.y + 200 })).toBe(0)
    expect(amountAlong(a, b, { x: a.x, y: b.y - 200 })).toBe(1)
    expect(trackPoint(plan, 0.5)[2]).toBeCloseTo(50, 9)
  })
})
