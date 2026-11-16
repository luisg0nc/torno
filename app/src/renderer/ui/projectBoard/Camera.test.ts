import { describe, expect, it, vi } from 'vitest'
import { Camera, MAX_ZOOM, MIN_ZOOM } from './Camera'

/** A stand-in for the layer and the element it sits in: 1000 x 600 at (100, 50) on the page. */
function layerIn(rect = { left: 100, top: 50, width: 1000, height: 600 }) {
  const layer = { style: { transform: '' }, parentElement: { getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) } }
  return layer as unknown as HTMLElement & { style: { transform: string } }
}

describe('Camera', () => {
  it('starts at 100 % with the board origin at the corner, and writes the transform itself', () => {
    const layer = layerIn()
    const camera = new Camera(layer, () => {})
    expect(camera.view).toEqual({ x: 0, y: 0, k: 1 })
    camera.pan(30, -20)
    expect(camera.view).toEqual({ x: 30, y: -20, k: 1 })
    expect(layer.style.transform).toBe('translate(30px, -20px) scale(1)')
  })

  it('tells the one who listens after every change, and only then', () => {
    const changed = vi.fn()
    const camera = new Camera(layerIn(), changed)
    expect(changed).not.toHaveBeenCalled()
    camera.pan(1, 1)
    camera.zoomAt(1.5, 300, 300)
    camera.fit({ x: 0, y: 0, w: 100, h: 100 })
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('zooms about the pointer: the board point under it stays under it', () => {
    const camera = new Camera(layerIn(), () => {})
    camera.pan(-40, 25)
    const before = camera.toBoard(640, 300)
    camera.zoomAt(1.8, 640, 300)
    const after = camera.toBoard(640, 300)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
    expect(camera.view.k).toBeCloseTo(1.8, 9)
  })

  it('is held between 10 % and 400 %', () => {
    const camera = new Camera(layerIn(), () => {})
    camera.zoomAt(1000, 500, 300)
    expect(camera.view.k).toBe(MAX_ZOOM)
    expect(MAX_ZOOM).toBe(4)
    camera.zoomAt(1e-6, 500, 300)
    expect(camera.view.k).toBe(MIN_ZOOM)
    expect(MIN_ZOOM).toBe(0.1)
    // A clamped zoom still keeps the point under the pointer.
    const before = camera.toBoard(250, 400)
    camera.zoomAt(0.5, 250, 400)
    expect(camera.toBoard(250, 400).x).toBeCloseTo(before.x, 9)
  })

  it('maps a point of the page to the board and back through the pan', () => {
    const camera = new Camera(layerIn(), () => {})
    camera.pan(200, 100)
    camera.zoomAt(2, 100, 50)
    // The element's corner is the origin of the screen part; board (0,0) is where the pan put it.
    const p = camera.toBoard(100 + camera.view.x + 2 * 40, 50 + camera.view.y + 2 * 10)
    expect(p.x).toBeCloseTo(40, 9)
    expect(p.y).toBeCloseTo(10, 9)
  })

  it('fits a box whole, centred, with a margin', () => {
    const camera = new Camera(layerIn(), () => {})
    camera.fit({ x: -500, y: 200, w: 4000, h: 1000 })
    const { x, y, k } = camera.view
    expect(k).toBeLessThan(1)
    // All four corners are inside the element (1000 x 600).
    for (const [bx, by] of [[-500, 200], [3500, 200], [-500, 1200], [3500, 1200]]) {
      const sx = bx * k + x
      const sy = by * k + y
      expect(sx).toBeGreaterThanOrEqual(0)
      expect(sx).toBeLessThanOrEqual(1000)
      expect(sy).toBeGreaterThanOrEqual(0)
      expect(sy).toBeLessThanOrEqual(600)
    }
    // Centred on both axes.
    expect((-500 * k + x + (3500 * k + x)) / 2).toBeCloseTo(500, 6)
    expect((200 * k + y + (1200 * k + y)) / 2).toBeCloseTo(300, 6)
  })

  it('does not blow a small box up past 100 %, and keeps the minimum for a vast one', () => {
    const camera = new Camera(layerIn(), () => {})
    camera.fit({ x: 0, y: 0, w: 50, h: 50 })
    expect(camera.view.k).toBe(1)
    camera.fit({ x: 0, y: 0, w: 1e7, h: 1e7 })
    expect(camera.view.k).toBe(MIN_ZOOM)
  })

  it('centres on a board point', () => {
    const camera = new Camera(layerIn(), () => {})
    camera.zoomAt(2, 600, 350)
    camera.centreOn(800, 500)
    const { x, y, k } = camera.view
    expect(800 * k + x).toBeCloseTo(500, 9)
    expect(500 * k + y).toBeCloseTo(300, 9)
  })

  it('tells a listener as it tells the one it was made with, until the listener is stopped', () => {
    const camera = new Camera(layerIn(), () => {})
    const heard = vi.fn()
    const stop = camera.listen(heard)
    camera.pan(1, 0)
    stop()
    camera.pan(1, 0)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('stands again where a view says, held to the zoom limits', () => {
    const layer = layerIn()
    const camera = new Camera(layer, () => {})
    camera.restore({ x: -40, y: 12, k: 2 })
    expect(camera.view).toEqual({ x: -40, y: 12, k: 2 })
    expect(layer.style.transform).toBe('translate(-40px, 12px) scale(2)')
    camera.restore({ x: 0, y: 0, k: 99 })
    expect(camera.view.k).toBe(MAX_ZOOM)
  })

  it('sees the board part of the element', () => {
    const camera = new Camera(layerIn(), () => {})
    camera.pan(-100, -50)
    expect(camera.visible()).toEqual({ x: 100, y: 50, w: 1000, h: 600 })
  })
})
