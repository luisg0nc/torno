import { describe, expect, it } from 'vitest'
import type { Camera, ViewName } from '../../shared/view'
import { fitCamera, focusCamera, gridStep, lockedViewOf, benchFits, scaleBarLength, screenHalfExtent, viewDirection, visibleHeight } from './views'

const NAMES: ViewName[] = ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom']
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: number[]) => Math.sqrt(dot(a, a))
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

const BOX = { min: [-20, -15, -2.5], max: [20, 15, 2.5] } // 40 × 30 × 5

describe('viewDirection', () => {
  it.each(NAMES)('%s is unit length and perpendicular to its up', (name) => {
    const { dir, up } = viewDirection(name)
    expect(len(dir)).toBeCloseTo(1, 12)
    expect(len(up)).toBeCloseTo(1, 12)
    expect(dot(dir, up)).toBeCloseTo(0, 12)
  })

  it('follows the Z-up conventions', () => {
    expect(viewDirection('front')).toEqual({ dir: [0, 1, 0], up: [0, 0, 1] })
    expect(viewDirection('right')).toEqual({ dir: [-1, 0, 0], up: [0, 0, 1] })
    expect(viewDirection('top')).toEqual({ dir: [0, 0, -1], up: [0, 1, 0] })
    // iso: the camera sits towards (+1, −1, +0.8), so it looks the other way
    const n = Math.hypot(1, 1, 0.8)
    const iso = viewDirection('iso')
    expect(iso.dir[0]).toBeCloseTo(-1 / n, 12)
    expect(iso.dir[1]).toBeCloseTo(1 / n, 12)
    expect(iso.dir[2]).toBeCloseTo(-0.8 / n, 12)
    expect(iso.up[2]).toBeGreaterThan(0)
  })

  it('opposite views look in opposite directions', () => {
    for (const [a, b] of [['front', 'back'], ['left', 'right'], ['top', 'bottom']] as const) {
      expect(viewDirection(a).dir.map((x) => -x || 0)).toEqual(viewDirection(b).dir)
    }
  })
})

describe('fitCamera', () => {
  const { dir, up } = viewDirection('front')

  it('frames a 40 × 30 × 5 box from the front in ortho', () => {
    const aspect = 4 / 3
    const cam = fitCamera(BOX, dir, up, aspect, 35, true)
    expect(cam.ortho).toBe(true)
    expect(cam.target).toEqual([0, 0, 0])
    expect(cam.up).toEqual([0, 0, 1])
    // the camera is on the −Y side, looking along +Y
    const offset = sub(cam.position, cam.target)
    expect(offset[0]).toBeCloseTo(0, 9)
    expect(offset[1]).toBeLessThan(-15)
    expect(offset[2]).toBeCloseTo(0, 9)
    const width = visibleHeight(cam) * aspect
    expect(width).toBeGreaterThanOrEqual(40 * 1.05)
    expect(width).toBeLessThanOrEqual(40 * 1.2)
  })

  it('lets the height decide when the view is tall', () => {
    const cam = fitCamera(BOX, [0, 0, -1], [0, 1, 0], 4, 35, true) // top view: 40 wide, 30 tall
    const height = visibleHeight(cam)
    expect(height).toBeGreaterThanOrEqual(30 * 1.05)
    expect(height).toBeLessThanOrEqual(30 * 1.2)
  })

  it('targets the centre of an off-centre box', () => {
    const cam = fitCamera({ min: [10, 20, 30], max: [20, 40, 60] }, dir, up, 1, 35, false)
    expect(cam.target).toEqual([15, 30, 45])
    expect(cam.ortho).toBe(false)
    expect(cam.zoom).toBe(1)
  })

  it('keeps an ortho camera outside a deep part', () => {
    // a rod seen end-on: tiny in the view, long along it
    const cam = fitCamera({ min: [-2, -250, -2], max: [2, 250, 2] }, dir, up, 1, 35, true)
    expect(len(sub(cam.position, cam.target))).toBeGreaterThan(250)
    expect(visibleHeight(cam)).toBeLessThanOrEqual(4 * 1.2)
  })

  it('perspective distance grows with the bounding sphere', () => {
    const d = (s: number) => {
      const cam = fitCamera({ min: [-s, -s, -s], max: [s, s, s] }, dir, up, 4 / 3, 35, false)
      return len(sub(cam.position, cam.target))
    }
    expect(d(10)).toBeGreaterThan(Math.sqrt(3) * 10) // outside the sphere
    expect(d(20)).toBeCloseTo(2 * d(10), 9)
    expect(d(50)).toBeGreaterThan(d(20))
  })

  it('copes with an empty box', () => {
    const cam = fitCamera({ min: [5, 5, 5], max: [5, 5, 5] }, dir, up, 1, 35, true)
    expect(cam.position.every(Number.isFinite)).toBe(true)
    expect(visibleHeight(cam)).toBeGreaterThan(0)
  })
})

describe('focusCamera', () => {
  const FOCUS = { min: [10, -2, 4] as [number, number, number], max: [30, 2, 4] as [number, number, number], margin: 5 }
  const USER = { position: [100, -80, 60], target: [20, 0, 4], up: [0, 0, 1], ortho: false, fov: 50, zoom: 1 } satisfies Camera

  it('looks from the side a standard view names, orthographic, at the middle of the box, and takes in the box and its margin', () => {
    const cam = focusCamera(FOCUS, 'front', USER, 4 / 3)
    expect(cam.ortho).toBe(true)
    expect(cam.target).toEqual([20, 0, 4])
    expect(cam.position[0]).toBeCloseTo(20, 9)
    expect(cam.position[1]).toBeLessThan(0)
    expect(cam.position[2]).toBeCloseTo(4, 9)
    // 20 mm and a margin of 5 on each side across, with the fit's own 10 %.
    const width = visibleHeight(cam) * (4 / 3)
    expect(width).toBeGreaterThanOrEqual(30 * 1.05)
    expect(width).toBeLessThanOrEqual(30 * 1.2)
  })

  it('looks the way the user’s camera does when no view is named, and keeps its projection and its field of view', () => {
    const cam = focusCamera(FOCUS, 'current', USER, 1.5)
    const along = sub(cam.target, cam.position)
    const want = sub(USER.target, USER.position)
    expect(dot(along, want) / (len(along) * len(want))).toBeCloseTo(1, 9)
    expect(cam.ortho).toBe(false)
    expect(cam.fov).toBe(50)
    expect(cam.target).toEqual([20, 0, 4])
  })

  it('looks the way a camera of the agent’s does', () => {
    const own = { position: [0, 0, 50], target: [0, 0, 0], up: [0, 1, 0], ortho: true, fov: 35, zoom: 3 } satisfies Camera
    const cam = focusCamera(FOCUS, own, USER, 4 / 3)
    expect(cam.ortho).toBe(true)
    expect(cam.position[0]).toBeCloseTo(20, 9)
    expect(cam.position[1]).toBeCloseTo(0, 9)
    expect(cam.position[2]).toBeGreaterThan(4)
    // Zoom is the fit's to make: the camera it was given does not keep its own.
    expect(visibleHeight(cam)).toBeLessThanOrEqual(30 * 1.2)
  })

  it('frames a point with the margin round it', () => {
    const cam = focusCamera({ min: [1, 2, 3], max: [1, 2, 3], margin: 6 }, 'top', USER, 1)
    expect(cam.target).toEqual([1, 2, 3])
    expect(visibleHeight(cam)).toBeGreaterThanOrEqual(12)
    expect(visibleHeight(cam)).toBeLessThanOrEqual(12 * 1.2)
  })
})

describe('lockedViewOf', () => {
  const box = { min: [-20, -15, -2.5], max: [20, 15, 22.5] }
  const named = (name: ViewName, ortho = true) => {
    const { dir, up } = viewDirection(name)
    return fitCamera(box, dir, up, 4 / 3, 35, ortho)
  }

  it('is each of the six orthographic standard views, and never iso', () => {
    for (const name of ['front', 'back', 'left', 'right', 'top', 'bottom'] as const) expect(lockedViewOf(named(name))).toBe(name)
    expect(lockedViewOf(named('iso'))).toBeNull()
  })

  it('is none in perspective', () => {
    expect(lockedViewOf(named('front', false))).toBeNull()
  })

  it('stays through panning and zooming', () => {
    const front = named('front')
    const moved = { ...front, position: [front.position[0] + 37, front.position[1], front.position[2] - 12] as [number, number, number], target: [front.target[0] + 37, front.target[1], front.target[2] - 12] as [number, number, number], zoom: front.zoom * 6 }
    expect(lockedViewOf(moved)).toBe('front')
  })

  it('is lost by the least turn: a pixel of orbiting, or a turn about the way it looks', () => {
    const front = named('front')
    const reach = Math.abs(front.position[1] - front.target[1])
    // Half a degree round the target, about what one pixel of dragging turns.
    const turned = { ...front, position: [front.target[0] + reach * Math.sin(0.0087), front.target[1] - reach * Math.cos(0.0087), front.position[2]] as [number, number, number] }
    expect(lockedViewOf(turned)).toBeNull()
    // From above with +X up on screen: the top view, but not the way up it is drawn.
    expect(lockedViewOf({ ...named('top'), up: [1, 0, 0] })).toBeNull()
  })

  it('takes the hair the viewport leans a camera that looks straight down', () => {
    const top = named('top')
    const reach = top.position[2] - top.target[2]
    expect(lockedViewOf({ ...top, position: [top.position[0], top.position[1] - reach * 1e-5, top.position[2]], up: [0, 1, 1e-5] })).toBe('top')
  })
})

describe('gridStep', () => {
  it('is a power of ten or five times one', () => {
    expect(gridStep(40)).toBe(5)
    expect(gridStep(100)).toBe(10)
    expect(gridStep(300)).toBe(50)
    expect(gridStep(3)).toBe(0.5)
    expect(gridStep(0)).toBe(1)
  })
  it('gives between 6 and 30 cells across', () => {
    for (const size of [0.7, 4, 12, 55, 99, 101, 480, 2600]) {
      const cells = size / gridStep(size)
      expect(cells).toBeGreaterThanOrEqual(6)
      expect(cells).toBeLessThanOrEqual(30)
    }
  })
})

describe('scaleBarLength', () => {
  it('picks the longest round length that fits', () => {
    expect(scaleBarLength(0.1, 200)).toBe(20) // 200 px cover 20 mm
    expect(scaleBarLength(0.1, 199)).toBe(10)
    expect(scaleBarLength(1, 160)).toBe(100)
    expect(scaleBarLength(0.004, 160)).toBe(0.5)
    expect(scaleBarLength(0.33, 160)).toBe(50)
  })
})

describe('screenHalfExtent', () => {
  const size = { x: 100, y: 50, z: 10 }
  it('is half the width and half the height a box has on screen, looking along a standard view', () => {
    const top = viewDirection('top')
    expect(screenHalfExtent(size, top.dir, top.up)).toEqual({ across: 50, upward: 25 })
    const front = viewDirection('front')
    expect(screenHalfExtent(size, front.dir, front.up)).toEqual({ across: 50, upward: 5 })
  })

  it('is larger in iso than any one side alone, and the same for a box as for the same half extents', () => {
    const iso = viewDirection('iso')
    const seen = screenHalfExtent(size, iso.dir, iso.up)
    expect(seen.across).toBeGreaterThan(50)
    expect(seen.upward).toBeGreaterThan(5)
    // A cube of 100 mm is, in iso, at most its diagonal across.
    const cube = screenHalfExtent({ x: 100, y: 100, z: 100 }, iso.dir, iso.up)
    expect(cube.across).toBeLessThanOrEqual(Math.hypot(100, 100, 100) / 2 + 1e-9)
  })
})

describe('benchFits', () => {
  it('is whether a box in iso stays within the 480 × 360 picture at 0.5 mm to the pixel, with a margin of two pixels', () => {
    expect(benchFits({ x: 150, y: 80, z: 92 })).toBe(true)
    expect(benchFits({ x: 1, y: 1, z: 1 })).toBe(true)
    // A flat plate 400 mm along its long side is some 280 mm across in iso: past 240 mm.
    expect(benchFits({ x: 400, y: 10, z: 10 })).toBe(false)
    expect(benchFits({ x: 10, y: 10, z: 400 })).toBe(false)
    expect(benchFits({ x: Number.NaN, y: 1, z: 1 })).toBe(false)
  })
})
