import { describe, expect, it } from 'vitest'
import { ALMOST_IN_LINE } from './align'
import { FOLDED, MIRRORED, PHOTO_FOLDS, type LineupPair, type Matrix3, SAME_PLACE, applyLineup, fitSimilar, fitStraight, invertLineup, lineupSaid, transformKey } from './lineup'

/** A similarity of a known scale (px per mm), turn (degrees) and shift: photo px (y down) to uv mm (v up). */
const similarity = (pxPerMm: number, degrees: number, shift: [number, number]): Matrix3 => {
  const s = 1 / pxPerMm
  const t = (degrees * Math.PI) / 180
  const [ar, ai] = [s * Math.cos(t), s * Math.sin(t)]
  return [ar, ai, shift[0], ai, -ar, shift[1], 0, 0, 1]
}
const through = (transform: readonly number[], photos: Array<[number, number]>): LineupPair[] => photos.map((photo) => ({ photo, uv: applyLineup(transform, photo) }))
const close = (a: readonly number[], b: readonly number[], digits = 9): void => {
  expect(a).toHaveLength(b.length)
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits))
}
const unitised = (m: readonly number[]): number[] => m.map((c) => c / m[8])

describe('fitSimilar', () => {
  it('gets back the scale, the turn and the shift of 2 points to 1e-9, with no fit', () => {
    const known = similarity(4.73, 2.1, [12.5, -7.25])
    const fit = fitSimilar(through(known, [[100, 80], [900, 650]]))
    if ('error' in fit) throw new Error(fit.error)
    close(fit.transform, known)
    expect(Math.abs(fit.scale - 4.73)).toBeLessThan(1e-9)
    expect(Math.abs(fit.angle - 2.1)).toBeLessThan(1e-9)
    expect(fit.fit).toBeUndefined()
    expect('fit' in fit).toBe(false)
  })

  it('turns by any angle, in degrees from u towards v', () => {
    for (const degrees of [0, 90, -90, 179, -135, 33.3]) {
      const fit = fitSimilar(through(similarity(2, degrees, [0, 0]), [[0, 0], [300, 0]]))
      if ('error' in fit) throw new Error(fit.error)
      expect(Math.abs(fit.angle - degrees)).toBeLessThan(1e-9)
    }
  })

  it('maps a photo that stands upright to a tracing that is the right way up: y down on the photo is v down', () => {
    const fit = fitSimilar(through(similarity(5, 0, [0, 100]), [[0, 0], [500, 0]]))
    if ('error' in fit) throw new Error(fit.error)
    // The photo's top left is at v = 100, and a point 50 px lower is 10 mm lower.
    expect(applyLineup(fit.transform, [0, 50])[1]).toBeCloseTo(90, 9)
  })

  it('with 3 points or more the fit is the root mean square of what they are left apart, in mm', () => {
    const known = similarity(4, 10, [5, 5])
    const exact = through(known, [[0, 0], [400, 0], [400, 300]])
    const none = fitSimilar(exact)
    if ('error' in none) throw new Error(none.error)
    expect(none.fit).toBeLessThan(1e-9)
    // The third point is 1 mm off in u: the fit is what the least-squares transform leaves.
    const off: LineupPair[] = exact.map((p, i) => (i === 2 ? { ...p, uv: [p.uv[0] + 1, p.uv[1]] } : p))
    const fit = fitSimilar(off)
    if ('error' in fit) throw new Error(fit.error)
    const residuals = off.map((p) => Math.hypot(...(applyLineup(fit.transform, p.photo).map((c, k) => c - p.uv[k]) as [number, number])))
    expect(fit.fit).toBeCloseTo(Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / 3), 12)
    expect(fit.fit).toBeGreaterThan(0.1)
    expect(fit.fit).toBeLessThan(1)
  })

  it('is refused in words for points on top of each other, and for fewer than two', () => {
    expect(fitSimilar([{ photo: [10, 10], uv: [0, 0] }, { photo: [10, 10], uv: [5, 5] }])).toEqual({ error: SAME_PLACE })
    expect(fitSimilar([{ photo: [10, 10], uv: [0, 0] }, { photo: [20, 10], uv: [0, 0] }])).toMatchObject({ error: expect.stringMatching(/tracing/) })
    expect(fitSimilar([{ photo: [10, 10], uv: [0, 0] }])).toMatchObject({ error: expect.stringMatching(/2 points are needed/) })
    expect(fitSimilar([])).toMatchObject({ error: expect.stringMatching(/2 points are needed/) })
  })

  it('is refused for a point that is not finite, and for more than 8', () => {
    expect(fitSimilar([{ photo: [Number.NaN, 0], uv: [0, 0] }, { photo: [1, 0], uv: [1, 0] }])).toMatchObject({ error: expect.stringMatching(/finite/) })
    const nine = through(similarity(1, 0, [0, 0]), Array.from({ length: 9 }, (_, i) => [i * 10, i * i] as [number, number]))
    expect(fitSimilar(nine)).toMatchObject({ error: expect.stringMatching(/at most 8/) })
  })
})

/** A homography of a known make: a turn and a scale with a perspective part. */
const homography: Matrix3 = [0.21, 0.02, -30, -0.015, -0.19, 160, 0.00004, 0.00007, 1]
const photos: Array<[number, number]> = [[120, 90], [880, 130], [900, 700], [60, 640]]

describe('fitStraight', () => {
  it('gets back a known homography from 4 points, with no fit', () => {
    const fit = fitStraight(through(homography, photos))
    if ('error' in fit) throw new Error(fit.error)
    close(unitised(fit.transform), unitised(homography), 9)
    expect('fit' in fit).toBe(false)
    // And what it maps is what the pairs say.
    for (const p of through(homography, photos)) close(applyLineup(fit.transform, p.photo), p.uv, 8)
  })

  it('gets back a known homography from 6 points, with a fit of nothing', () => {
    const more: Array<[number, number]> = [...photos, [500, 380], [300, 600]]
    const fit = fitStraight(through(homography, more))
    if ('error' in fit) throw new Error(fit.error)
    close(unitised(fit.transform), unitised(homography), 8)
    expect(fit.fit).toBeLessThan(1e-8)
  })

  it('with a spare point off by 1 mm, the fit is what is left', () => {
    const pairs = through(homography, [...photos, [500, 380]])
    pairs[4] = { ...pairs[4], uv: [pairs[4].uv[0] + 1, pairs[4].uv[1]] }
    const fit = fitStraight(pairs)
    if ('error' in fit) throw new Error(fit.error)
    expect(fit.fit).toBeGreaterThan(0.05)
    expect(fit.fit).toBeLessThan(1)
  })

  it('tells the scale and the turn at the centre of the tracing, which a similarity has everywhere', () => {
    const known = similarity(4.73, 2.1, [3, 4])
    const fit = fitStraight(through(known, photos))
    if ('error' in fit) throw new Error(fit.error)
    expect(Math.abs(fit.scale - 4.73)).toBeLessThan(1e-7)
    expect(Math.abs(fit.angle - 2.1)).toBeLessThan(1e-7)
    close(unitised(fit.transform), unitised(known), 9)
  })

  it('tells the scale at the point asked: nearer the camera is bigger', () => {
    const pairs = through(homography, photos)
    const near = fitStraight(pairs, { centre: applyLineup(homography, [100, 100]) })
    const far = fitStraight(pairs, { centre: applyLineup(homography, [900, 700]) })
    if ('error' in near || 'error' in far) throw new Error('refused')
    expect(near.scale).not.toBeCloseTo(far.scale, 3)
    // The scale there is one over the root of the area a pixel covers: checked by a step.
    const here: [number, number] = [100, 100]
    const [u0, v0] = applyLineup(homography, here)
    const [u1, v1] = applyLineup(homography, [here[0] + 1e-4, here[1]])
    const [u2, v2] = applyLineup(homography, [here[0], here[1] + 1e-4])
    const area = Math.abs(((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 1e-8)
    expect(near.scale).toBeCloseTo(1 / Math.sqrt(area), 3)
  })

  it('refuses three photo points in a line, in the words of an alignment, however well the fourth is placed', () => {
    const line: Array<[number, number]> = [[100, 100], [500, 101], [900, 100], [500, 600]]
    const uv: Array<[number, number]> = [[0, 0], [100, 0], [100, 80], [0, 80]]
    expect(fitStraight(line.map((photo, i) => ({ photo, uv: uv[i] })))).toEqual({ error: ALMOST_IN_LINE })
  })

  it('with spare points, refuses only when no four are well placed: a spare point may sit near a line of two others', () => {
    const near: Array<[number, number]> = [...photos, [510, 395]]
    expect('error' in fitStraight(through(homography, near))).toBe(false)
    const allOnOne: Array<[number, number]> = [[0, 0], [100, 1], [200, 0], [300, 1], [400, 0]]
    expect(fitStraight(through(homography, allOnOne))).toEqual({ error: ALMOST_IN_LINE })
  })

  it('refuses three points of the tracing in a line the same way', () => {
    const uv: Array<[number, number]> = [[0, 0], [50, 0.2], [100, 0], [30, 60]]
    expect(fitStraight(photos.map((photo, i) => ({ photo, uv: uv[i] })))).toEqual({ error: ALMOST_IN_LINE })
  })

  it('refuses a fit that folds the plane: the points come in another order on the tracing', () => {
    // A bow tie: the photo's corners 2 and 3 swapped on the tracing.
    const uv: Array<[number, number]> = [[0, 100], [100, 100], [0, 0], [100, 0]]
    const square: Array<[number, number]> = [[0, 0], [400, 0], [400, 300], [0, 300]]
    expect(fitStraight(square.map((photo, i) => ({ photo, uv: uv[i] })))).toEqual({ error: FOLDED })
  })

  it('refuses a fit whose vanishing line crosses the photo\'s corners, though not the clicked points: the photo would fold', () => {
    // w = 1 - 0.0015 x: positive for x < 667. Clicks are well inside; the photo reaches x = 1000.
    const bent: Matrix3 = [0.2, 0, 0, 0, -0.2, 0, -0.0015, 0, 1]
    const clicks: Array<[number, number]> = [[100, 100], [500, 120], [520, 600], [90, 580]]
    const pairs = through(bent, clicks)
    expect('error' in fitStraight(pairs)).toBe(false)
    expect(fitStraight(pairs, { size: [1000, 800] })).toEqual({ error: PHOTO_FOLDS })
    expect('error' in fitStraight(pairs, { size: [600, 700] })).toBe(false)
    expect(PHOTO_FOLDS).toMatch(/the photo would fold/)
  })

  it('refuses a mirrored straightening: the photo laid on the tracing the wrong way round', () => {
    const mirror: Matrix3 = [homography[0], homography[1], homography[2], -homography[3], -homography[4], -homography[5], homography[6], homography[7], homography[8]]
    expect(fitStraight(through(mirror, photos))).toEqual({ error: MIRRORED })
    expect('error' in fitStraight(through(homography, photos))).toBe(false)
  })

  it('refuses photo points under 1 px apart, in both fits', () => {
    const close1 = (list: LineupPair[]): LineupPair[] => list.map((p, i) => (i === 1 ? { ...p, photo: [p.photo[0] + 0.5, p.photo[1]] as [number, number] } : i === 0 ? p : p))
    const four = through(homography, photos)
    four[1] = { ...four[1], photo: [photos[0][0] + 0.5, photos[0][1]] }
    expect(fitStraight(four)).toEqual({ error: SAME_PLACE })
    expect(fitSimilar(close1([{ photo: [10, 10], uv: [0, 0] }, { photo: [10, 10], uv: [5, 5] }]))).toEqual({ error: SAME_PLACE })
    expect(fitSimilar([{ photo: [10, 10], uv: [0, 0] }, { photo: [10.5, 10], uv: [5, 5] }])).toEqual({ error: SAME_PLACE })
    expect('error' in fitSimilar([{ photo: [10, 10], uv: [0, 0] }, { photo: [11, 10], uv: [5, 5] }])).toBe(false)
  })

  it('refuses points on top of each other, and fewer than 4', () => {
    expect(fitStraight(through(homography, photos).map((p, i) => (i === 1 ? { ...p, photo: photos[0] } : p)))).toEqual({ error: SAME_PLACE })
    expect(fitStraight(through(homography, photos.slice(0, 3)))).toMatchObject({ error: expect.stringMatching(/4 points are needed/) })
  })
})

describe('applyLineup and invertLineup', () => {
  it('undo each other', () => {
    const inverse = invertLineup(homography)
    expect(inverse).not.toBeNull()
    const there = applyLineup(homography, [321, 456])
    close(applyLineup(inverse as Matrix3, there), [321, 456], 8)
  })

  it('answers null for a matrix that cannot be undone, and NaN for a point sent to infinity', () => {
    expect(invertLineup([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull()
    expect(invertLineup([1, 0, 0])).toBeNull()
    expect(applyLineup([1, 0, 0, 0, 1, 0, 1, 0, -5], [5, 3]).every(Number.isNaN)).toBe(true)
  })
})

describe('lineupSaid', () => {
  const photo = { pairs: [1, 2, 3, 4], method: 'straight' as const, scale: 4.7312, angle: 2.1004, fit: 0.4 }
  it('says how it was lined up, its scale, turn and fit, and that it is not exact', () => {
    expect(lineupSaid(photo)).toBe("lined up by 4 points, straightened: 4.731 px/mm at the centre, turned 2.1°, fit 0.4 mm; not exact, and true only in the tracing's plane")
  })

  it('says there is no spare point where there is no fit, and names a similarity by its points alone', () => {
    expect(lineupSaid({ ...photo, method: 'similar', pairs: [1, 2], fit: undefined })).toBe("lined up by 2 points: 4.731 px/mm at the centre, turned 2.1°, no spare point to check it; not exact, and true only in the tracing's plane")
  })

  it('says a photo that is not lined up is not', () => {
    expect(lineupSaid({ pairs: [], method: 'similar' })).toBe('not lined up')
  })
})

describe('transformKey', () => {
  it('is the same for the same matrix and another for any change of it', () => {
    expect(transformKey(homography)).toBe(transformKey([...homography]))
    expect(transformKey(homography)).not.toBe(transformKey([...homography.slice(0, 8), 1.0000001]))
  })
})
