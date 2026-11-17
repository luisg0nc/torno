import { afterEach, describe, expect, it, vi } from 'vitest'
import { axisOfDirection, countRender, FIT_MARGIN, MAX_RATIO, MIN_RATIO, PX_PER_MM, ratioText, Sheet } from './Sheet'

/** A stand-in for the layer and the element it sits in: 1000 x 600 at (100, 50) on the page. */
function layerIn(rect = { left: 100, top: 50, width: 1000, height: 600 }) {
  const layer = { style: { transform: '' }, parentElement: { getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) } }
  return layer as unknown as HTMLElement & { style: { transform: string } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Sheet', () => {
  it('starts at 1:1, a CSS millimetre for a millimetre, with the plane origin at the corner, and writes the transform itself', () => {
    const layer = layerIn()
    const sheet = new Sheet(layer, () => {})
    expect(PX_PER_MM).toBeCloseTo(96 / 25.4, 9)
    expect(sheet.zoomRatio()).toBe(1)
    expect(sheet.view).toEqual({ x: 0, y: 0, k: PX_PER_MM })
    sheet.pan(30, -20)
    expect(layer.style.transform).toBe(`translate(30px, -20px) scale(${PX_PER_MM})`)
  })

  it('tells the one who listens after every change, and only then', () => {
    const changed = vi.fn()
    const sheet = new Sheet(layerIn(), changed)
    expect(changed).not.toHaveBeenCalled()
    sheet.pan(1, 1)
    sheet.zoomAt(1.5, 300, 300)
    sheet.fit()
    sheet.actual()
    expect(changed).toHaveBeenCalledTimes(4)
  })

  it('tells the listener where it stands again when asked, and moves nothing', () => {
    const changed = vi.fn()
    const layer = layerIn()
    const sheet = new Sheet(layer, changed)
    sheet.pan(4, 5)
    changed.mockClear()
    sheet.refresh()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(sheet.view).toEqual({ x: 4, y: 5, k: PX_PER_MM })
  })

  it('zooms about the pointer: the point of the plane under it stays under it', () => {
    const sheet = new Sheet(layerIn(), () => {})
    sheet.pan(-40, 25)
    const before = sheet.toUv(640, 300)
    sheet.zoomAt(1.8, 640, 300)
    const after = sheet.toUv(640, 300)
    expect(after[0]).toBeCloseTo(before[0], 9)
    expect(after[1]).toBeCloseTo(before[1], 9)
    expect(sheet.zoomRatio()).toBeCloseTo(1.8, 9)
  })

  it('is held between its least and its greatest zoom, the point under the pointer kept', () => {
    const sheet = new Sheet(layerIn(), () => {})
    sheet.zoomAt(1e9, 500, 300)
    expect(sheet.zoomRatio()).toBeCloseTo(MAX_RATIO, 9)
    sheet.zoomAt(1e-9, 500, 300)
    expect(sheet.zoomRatio()).toBeCloseTo(MIN_RATIO, 9)
    const before = sheet.toUv(250, 400)
    sheet.zoomAt(1e9, 250, 400)
    expect(sheet.toUv(250, 400)[0]).toBeCloseTo(before[0], 6)
  })

  it('has v run up the screen unless the plane has it run down', () => {
    const up = new Sheet(layerIn(), () => {})
    up.pan(100, 100)
    // 1 mm right of the origin and 1 mm above it: the page point is the layer's corner plus (k, -k).
    expect(up.toUv(100 + 100 + PX_PER_MM, 50 + 100 - PX_PER_MM)[0]).toBeCloseTo(1, 9)
    expect(up.toUv(100 + 100 + PX_PER_MM, 50 + 100 - PX_PER_MM)[1]).toBeCloseTo(1, 9)
    const down = new Sheet(layerIn(), () => {})
    down.setDown(true)
    down.pan(100, 100)
    expect(down.toUv(100 + 100 + PX_PER_MM, 50 + 100 + PX_PER_MM)).toEqual([expect.closeTo(1, 9), expect.closeTo(1, 9)])
  })

  it('maps a point of the plane to the page and back', () => {
    for (const down of [false, true]) {
      const sheet = new Sheet(layerIn(), () => {})
      sheet.setDown(down)
      sheet.pan(-70, 33)
      sheet.zoomAt(2.5, 400, 300)
      const [cx, cy] = sheet.toScreen([12.5, -7])
      const [u, v] = sheet.toUv(cx, cy)
      expect(u).toBeCloseTo(12.5, 9)
      expect(v).toBeCloseTo(-7, 9)
    }
  })

  it('fits the outline\'s box with a margin round it, centred, and not a pixel out of the screen', () => {
    const sheet = new Sheet(layerIn(), () => {})
    sheet.setBox([-10, -50, 100, 60])
    sheet.fit()
    // 1000 x 600 less a margin each side: 904 x 504; a box of 100 x 60 mm is limited by its height here (8.4 px per mm).
    expect(sheet.view.k).toBeCloseTo(504 / 60, 9)
    const left = sheet.toScreen([-10, 0])[0]
    const right = sheet.toScreen([90, 0])[0]
    expect(left).toBeGreaterThanOrEqual(100 + FIT_MARGIN - 1e-9)
    expect(right).toBeLessThanOrEqual(100 + 1000 - FIT_MARGIN + 1e-9)
    // v runs up: the box's y -50..10 is v 50..-10; its top and bottom on the page.
    const top = sheet.toScreen([0, 50])[1]
    const bottom = sheet.toScreen([0, -10])[1]
    expect(top).toBeCloseTo(50 + FIT_MARGIN, 6)
    expect(bottom).toBeCloseTo(50 + 600 - FIT_MARGIN, 6)
    // Centred: the box's middle is the middle of the screen.
    expect((left + right) / 2).toBeCloseTo(100 + 500, 6)
  })

  describe('fit clear of the floating panel', () => {
    const PANEL = { right: 346, bottom: 300 }
    /** The outline's box on the element's own pixels (the page's less the element's corner). */
    const placed = (sheet: Sheet, box: readonly [number, number, number, number], at: { left: number; top: number }) => {
      const [x, y] = [sheet.toScreen([box[0], -box[1]]), sheet.toScreen([box[0] + box[2], -(box[1] + box[3])])]
      return { left: x[0] - at.left, top: Math.min(x[1], y[1]) - at.top, right: y[0] - at.left, bottom: Math.max(x[1], y[1]) - at.top }
    }

    it('leaves the outline where it is when it is clear of the panel already', () => {
      const wide = new Sheet(layerIn({ left: 100, top: 50, width: 1400, height: 1400 }), () => {})
      wide.setBox([-10, -50, 100, 60])
      wide.fit()
      const was = wide.view
      // A tall window: the panel is at the top left, and the outline is in the middle, below it.
      const clear = new Sheet(layerIn({ left: 100, top: 50, width: 1400, height: 1400 }), () => {})
      clear.setBox([-10, -50, 100, 60])
      clear.fit(PANEL)
      expect(clear.view).toEqual(was)
    })

    it('puts it where the panel is not on a narrow window, and as large as the room left allows', () => {
      const at = { left: 100, top: 50 }
      const sheet = new Sheet(layerIn({ ...at, width: 700, height: 600 }), () => {})
      const box = [0, 0, 100, 60] as const
      sheet.setBox(box)
      sheet.fit(PANEL)
      const out = placed(sheet, box, at)
      // Clear of the panel: right of it or below it, with the margin, and inside the window.
      expect(out.left >= PANEL.right + FIT_MARGIN - 1e-6 || out.top >= PANEL.bottom + FIT_MARGIN - 1e-6).toBe(true)
      expect(out.left).toBeGreaterThanOrEqual(FIT_MARGIN - 1e-6)
      expect(out.right).toBeLessThanOrEqual(700 - FIT_MARGIN + 1e-6)
      expect(out.bottom).toBeLessThanOrEqual(600 - FIT_MARGIN + 1e-6)
      // Below the panel here is the larger room (300 high against 354 wide): k by the height left.
      expect(sheet.view.k).toBeCloseTo((600 - PANEL.bottom - 2 * FIT_MARGIN) / 60, 6)
    })

    it('goes right of the panel when that room is the larger', () => {
      const at = { left: 100, top: 50 }
      const sheet = new Sheet(layerIn({ ...at, width: 700, height: 500 }), () => {})
      const box = [0, 0, 20, 100] as const
      sheet.setBox(box)
      sheet.fit({ right: 346, bottom: 300 })
      const out = placed(sheet, box, at)
      expect(out.left).toBeGreaterThanOrEqual(346 + FIT_MARGIN - 1e-6)
      expect(out.right).toBeLessThanOrEqual(700 - FIT_MARGIN + 1e-6)
      expect(out.bottom).toBeLessThanOrEqual(500 - FIT_MARGIN + 1e-6)
    })
  })

  it('fits a box taller than wide by its width, and a very small one no more than the greatest zoom', () => {
    const sheet = new Sheet(layerIn(), () => {})
    sheet.setBox([0, 0, 20, 400])
    sheet.fit()
    expect(sheet.view.k).toBeCloseTo(504 / 400, 9)
    sheet.setBox([0, 0, 0.001, 0.001])
    sheet.fit()
    expect(sheet.zoomRatio()).toBeCloseTo(MAX_RATIO, 9)
  })

  it('with no outline fits to 1:1 with the origin in the middle', () => {
    const sheet = new Sheet(layerIn(), () => {})
    sheet.setBox(null)
    sheet.fit()
    expect(sheet.zoomRatio()).toBe(1)
    expect(sheet.toScreen([0, 0])).toEqual([600, 350])
  })

  it('sets 1:1 about the middle of the screen: what is there stays there', () => {
    const sheet = new Sheet(layerIn(), () => {})
    sheet.setBox([0, 0, 100, 60])
    sheet.fit()
    expect(sheet.zoomRatio()).not.toBe(1)
    const middle = sheet.toUv(600, 350)
    sheet.actual()
    expect(sheet.zoomRatio()).toBe(1)
    expect(sheet.view.k).toBe(PX_PER_MM)
    const after = sheet.toUv(600, 350)
    expect(after[0]).toBeCloseTo(middle[0], 9)
    expect(after[1]).toBeCloseTo(middle[1], 9)
  })

  it('stands as it was left', () => {
    const sheet = new Sheet(layerIn(), () => {})
    sheet.zoomAt(3, 400, 300)
    sheet.pan(10, 20)
    const kept = sheet.view
    const other = new Sheet(layerIn(), () => {})
    other.restore(kept)
    expect(other.view).toEqual(kept)
  })
})

describe('the axes of a sheet', () => {
  it('are the object axes the plane runs along, and none for a slanted plane', () => {
    expect(axisOfDirection([1, 0, 0])).toBe('x')
    expect(axisOfDirection([0, -1, 0])).toBe('y')
    expect(axisOfDirection([0, 0, 1])).toBe('z')
    expect(axisOfDirection([Math.SQRT1_2, Math.SQRT1_2, 0])).toBeNull()
  })
})

describe('what a zoom is called', () => {
  it('is a ratio with the millimetre on one side: 1:1, 4:1 enlarged, 1:4 reduced', () => {
    expect(ratioText(1)).toBe('1:1')
    expect(ratioText(4)).toBe('4:1')
    expect(ratioText(0.25)).toBe('1:4')
    expect(ratioText(2.5)).toBe('2.5:1')
    expect(ratioText(1 / 3)).toBe('1:3')
  })
})

describe('the renders of the sheet', () => {
  it('are counted under test, and a pan or a zoom adds none', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('location', { search: '?test' })
    const sheet = new Sheet(layerIn(), () => {})
    countRender()
    const before = (window as unknown as { __tornoTracingRenders?: number }).__tornoTracingRenders
    expect(before).toBe(1)
    sheet.pan(5, 5)
    sheet.zoomAt(2, 300, 300)
    sheet.fit()
    sheet.actual()
    expect((window as unknown as { __tornoTracingRenders?: number }).__tornoTracingRenders).toBe(before)
    countRender()
    expect((window as unknown as { __tornoTracingRenders?: number }).__tornoTracingRenders).toBe(2)
  })
})
