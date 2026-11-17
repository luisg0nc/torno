import { describe, expect, it } from 'vitest'
import type { PlaneSnap, TracingPhoto } from '../../shared/tracings'
import { Refusal } from '../refusal'
import { spanValue } from './spans'

const SNAPS: PlaneSnap[] = [
  { kind: 'corner', uv: [0, 0], part: 'block' },
  { kind: 'corner', uv: [30, 40], part: 'block' },
  { kind: 'centre', uv: [10, 10], radius: 3, part: 'block', edge: 'block/E4' },
  { kind: 'vertex', uv: [5, 5], part: 'block', ref: 'block/V1' },
  { kind: 'vertex', uv: [7, 7], part: 'block', ref: 'block/V2', projected: true }
]
const PHOTO = { file: 'p-0123456789ab.jpg', pairs: [], method: 'similar', transform: [1, 0, 0, 0, 1, 0, 0, 0, 1], fit: 0.4, fade: 0.5 } as unknown as TracingPhoto
const corner = (uv: [number, number]) => ({ uv, on: 'tracing' as const, snap: { kind: 'corner' as const, uv, part: 'block' } })

describe('spanValue', () => {
  it('is exact when both ends are snapped on the outline, takes the kernel\'s points and says the build', () => {
    const made = spanValue(corner([0, 0]), { uv: [30.004, 39.995], on: 'tracing', snap: { kind: 'corner', uv: [30, 40], part: 'block' } }, SNAPS, undefined, 'h41')
    expect(made).toMatchObject({ value: 50, exact: true, how: 'exact on build h41' })
    // The kernel's point, not the window's.
    expect(made.b.uv).toEqual([30, 40])
    expect(made.b.snap).toEqual({ kind: 'corner', uv: [30, 40], part: 'block' })
  })

  it('says an exact span\'s build by its history id, and says so when the history keeps none', () => {
    expect(spanValue(corner([0, 0]), corner([30, 40]), SNAPS, undefined, undefined).how).toBe('exact on a build the history does not keep')
  })

  it('measures a hole centre and a vertex by what they say they are, and keeps the value in full', () => {
    const made = spanValue({ uv: [10, 10], on: 'tracing', snap: { kind: 'centre', uv: [10, 10], radius: 3, part: 'block', edge: 'block/E4' } }, { uv: [5, 5], on: 'tracing', snap: { kind: 'vertex', uv: [5, 5], part: 'block', ref: 'block/V1' } }, SNAPS, undefined, 'h2')
    expect(made.exact).toBe(true)
    expect(made.value).toBe(Math.hypot(5, 5))
  })

  it('refuses a snapped end 0.02 mm from the kernel\'s point, and one the build has no such point for', () => {
    expect(() => spanValue({ uv: [0.02, 0], on: 'tracing', snap: { kind: 'corner', uv: [0.02, 0], part: 'block' } }, corner([30, 40]), SNAPS, undefined, 'h1')).toThrow(Refusal)
    expect(() => spanValue({ uv: [0.02, 0], on: 'tracing', snap: { kind: 'corner', uv: [0.02, 0], part: 'block' } }, corner([30, 40]), SNAPS, undefined, 'h1')).toThrow(/0\.02 mm/)
    expect(() => spanValue({ uv: [1, 1], on: 'tracing', snap: { kind: 'vertex', uv: [1, 1], part: 'block', ref: 'block/V9' } }, corner([30, 40]), SNAPS, undefined, 'h1')).toThrow(/no vertex/)
    expect(() => spanValue({ uv: [7, 7], on: 'tracing', snap: { kind: 'vertex', uv: [7, 7], part: 'block', ref: 'block/V2', projected: true } }, corner([30, 40]), SNAPS, undefined, 'h1')).toThrow(/not in the tracing's plane/)
  })

  it('refuses a snapped end when there is no outline to check it against', () => {
    expect(() => spanValue(corner([0, 0]), corner([30, 40]), undefined, undefined, 'h1')).toThrow(/build the model first/)
  })

  it('is approximate with an end on the photo, says so with the fit, and is freehand with a free end', () => {
    const onPhoto = spanValue(corner([0, 0]), { uv: [30, 40], on: 'photo' }, SNAPS, PHOTO, 'h3')
    expect(onPhoto).toMatchObject({ value: 50, exact: false, how: 'on the photo, lined up with fit 0.4 mm' })
    const free = spanValue({ uv: [0, 0], on: 'tracing' }, { uv: [3, 4], on: 'tracing' }, SNAPS, PHOTO, 'h3')
    expect(free).toMatchObject({ value: 5, exact: false, how: 'freehand' })
    // One end snapped is no more exact than none.
    expect(spanValue(corner([0, 0]), { uv: [3, 4], on: 'tracing' }, SNAPS, undefined, 'h3').exact).toBe(false)
  })

  it('says how many points the photo was lined up by when it has no fit, and takes a photo end for the outline where there is no photo to be on', () => {
    const two = { ...PHOTO, fit: undefined, pairs: [{}, {}] } as unknown as TracingPhoto
    expect(spanValue({ uv: [0, 0], on: 'photo' }, { uv: [3, 4], on: 'tracing' }, SNAPS, two, 'h1').how).toBe('on the photo, lined up by 2 points')
    expect(spanValue({ uv: [0, 0], on: 'photo' }, { uv: [3, 4], on: 'tracing' }, SNAPS, undefined, 'h1')).toMatchObject({ how: 'freehand', exact: false })
    // A snapped end is on the outline, whatever the window said.
    expect(spanValue({ ...corner([0, 0]), on: 'photo' }, corner([30, 40]), SNAPS, PHOTO, 'h1')).toMatchObject({ exact: true })
  })

  it('refuses an end that is not a point', () => {
    expect(() => spanValue({ uv: [Number.NaN, 0], on: 'tracing' }, { uv: [1, 1], on: 'tracing' }, SNAPS, undefined, 'h1')).toThrow(Refusal)
  })
})
