import { describe, expect, it } from 'vitest'
import type { Pt } from '../../shared/leader'
import { placeTag } from '../../shared/tagPlace'
import { MIN_TRACK_PX, amountAlong, planTrack, trackBox, trackEnds, trackFits, trackPoint, type Box3, type TrackPlan } from './explodeTrack'

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

/** The window at 1280 x 800 leaves the view about this much. */
const VIEW = { width: 1280, height: 800 }
/** A front view of BOX with the camera zoomed by `zoom`, looking at `at` (a point of the box, mm), on the middle of the view. */
const zoomed = (zoom: number, at: [number, number] = [50, 20]) => (p: readonly [number, number, number]): Pt => ({
  x: VIEW.width / 2 + (p[0] - at[0]) * 3 * zoom,
  y: VIEW.height / 2 - (p[2] - at[1]) * 3 * zoom
})
const meets = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('the track stays whole in the view (1280 x 800)', () => {
  it('stands beside the parts, whole, while there is room', () => {
    const plan = planTrack(BOX, zoomed(1), null, VIEW)!
    expect(plan.screen).toBeUndefined()
    const ends = trackEnds(plan, zoomed(1))!
    expect(trackFits(ends.a, ends.b, VIEW)).toBe(true)
  })

  it('is whole at every zoom: beside the parts where one place has room, else at the fixed place at the bottom right', () => {
    for (const zoom of [0.5, 1, 2, 3, 4, 6, 8, 12, 20]) {
      for (const at of [[50, 20], [0, 0], [100, 40], [0, 40]] as Array<[number, number]>) {
        const project = zoomed(zoom, at)
        const plan = planTrack(BOX, project, null, VIEW)
        if (!plan) continue
        const ends = trackEnds(plan, project)!
        expect(trackFits(ends.a, ends.b, VIEW), `zoom ${zoom} at ${at}`).toBe(true)
      }
    }
  })

  it('goes to the bottom right of the view when no place beside the parts is on screen', () => {
    const plan = planTrack(BOX, zoomed(12), null, VIEW)!
    expect(plan.screen).toBeDefined()
    const { a, b } = plan.screen!
    expect(a.x).toBe(b.x)
    expect(a.x).toBeGreaterThan(VIEW.width * 0.9)
    expect(a.y).toBeGreaterThan(VIEW.height * 0.8)
    expect(b.y).toBeLessThan(a.y)
    expect(a.y - b.y).toBeGreaterThanOrEqual(MIN_TRACK_PX)
  })

  it('is not drawn where no axis shows long enough, as before', () => {
    expect(planTrack(BOX, () => ({ x: 10, y: 10 }), null, VIEW)).toBeNull()
  })

  it('has its tag beside it and never over it, at every zoom', () => {
    const tag = { w: 232, h: 168 }
    const view = { x: 0, y: 0, w: VIEW.width, h: VIEW.height }
    for (const zoom of [0.5, 1, 2, 4, 8, 12, 20]) {
      const project = zoomed(zoom)
      const plan = planTrack(BOX, project, null, VIEW)
      if (!plan) continue
      const ends = trackEnds(plan, project)!
      const track = trackBox(ends)
      const placed = placeTag(ends.b, tag, view, [track], 'left')
      expect(meets(placed.box, track), `zoom ${zoom}`).toBe(false)
      expect(placed.box.x).toBeGreaterThanOrEqual(0)
      expect(placed.box.x + placed.box.w).toBeLessThanOrEqual(VIEW.width)
      expect(placed.box.y + placed.box.h).toBeLessThanOrEqual(VIEW.height)
    }
  })
})
