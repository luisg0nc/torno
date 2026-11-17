import { describe, expect, it } from 'vitest'
import { applyLineup, fitStraight, type LineupPair, type Matrix3, photoRect } from '../../../shared/lineup'
import { MAX_WARP_EDGE, planWarp, warpPixels } from './warp'

// What the photo is straightened by: the inverse of the line-up's map, sampled at the centre of each pixel of a copy that is laid by its
// rectangle in mm, its top row the rectangle's greatest `v`. Pure, apart from the worker that runs it (`warp`), so it is held here to the
// line-up's own maths: a pixel of the photo must land on the mm the line-up says, within half a pixel of the copy.

const similarity = (pxPerMm: number, degrees: number, shift: [number, number]): Matrix3 => {
  const s = 1 / pxPerMm
  const t = (degrees * Math.PI) / 180
  return [s * Math.cos(t), s * Math.sin(t), shift[0], s * Math.sin(t), -s * Math.cos(t), shift[1], 0, 0, 1]
}

/** An opaque grey photo of `width` by `height`, with one white pixel at (`x`, `y`). */
function photoWith(width: number, height: number, x: number, y: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([20, 20, 20, 255], 4 * i)
  data.set([255, 255, 255, 255], 4 * (y * width + x))
  return { data, width, height }
}

/** The centre, in mm, of the brightest pixel of a copy placed by `rect` at `pxPerMm`. */
function brightest(out: { data: Uint8ClampedArray; width: number; height: number }, rect: { min: [number, number]; max: [number, number] }, pxPerMm: number): [number, number] {
  let best = -1
  let at = 0
  for (let i = 0; i < out.width * out.height; i++) {
    const level = out.data[4 * i] * (out.data[4 * i + 3] / 255)
    if (level > best) {
      best = level
      at = i
    }
  }
  const col = at % out.width
  const row = Math.floor(at / out.width)
  return [rect.min[0] + (col + 0.5) / pxPerMm, rect.max[1] - (row + 0.5) / pxPerMm]
}

describe('planWarp', () => {
  it('makes the copy at the photo\'s own pixels per mm, as large as the rectangle is', () => {
    const plan = planWarp({ min: [-10, -8], max: [10, 8] }, 5)!
    expect(plan.pxPerMm).toBe(5)
    expect([plan.width, plan.height]).toEqual([100, 80])
  })

  it('holds the long edge to 4000 px by taking the scale down, and keeps the rectangle', () => {
    const plan = planWarp({ min: [0, 0], max: [1000, 500] }, 10)!
    expect(plan.width).toBeLessThanOrEqual(MAX_WARP_EDGE)
    expect(plan.height).toBeLessThanOrEqual(MAX_WARP_EDGE)
    expect(plan.pxPerMm).toBeCloseTo(4, 9)
    expect(plan.rect).toEqual({ min: [0, 0], max: [1000, 500] })
  })

  it('refuses a rectangle with no size, and a scale that is not a number', () => {
    expect(planWarp({ min: [0, 0], max: [0, 5] }, 5)).toBeNull()
    expect(planWarp({ min: [0, 0], max: [5, 5] }, Number.NaN)).toBeNull()
    expect(planWarp({ min: [0, 0], max: [5, 5] }, 0)).toBeNull()
  })
})

describe('warpPixels', () => {
  it('lands a pixel of the photo on the mm the line-up says, within half a pixel of the copy, for a turned similarity', () => {
    const transform = similarity(5, 30, [12, -4])
    const photo = photoWith(120, 90, 37, 21)
    const rect = photoRect(transform, photo.width, photo.height)!
    const plan = planWarp(rect, 5)!
    const out = warpPixels(photo, transform, plan)!
    const [u, v] = brightest(out, plan.rect, plan.pxPerMm)
    const [wantU, wantV] = applyLineup(transform, [37.5, 21.5])
    expect(Math.abs(u - wantU)).toBeLessThanOrEqual(0.5 / plan.pxPerMm)
    expect(Math.abs(v - wantV)).toBeLessThanOrEqual(0.5 / plan.pxPerMm)
  })

  it('does as much for a homography of four points', () => {
    const photoPoints: Array<[number, number]> = [[10, 8], [190, 20], [170, 140], [15, 120]]
    const tracing: Array<[number, number]> = [[0, 0], [40, 0], [40, 30], [0, 30]]
    const pairs: LineupPair[] = photoPoints.map((photo, i) => ({ photo, uv: [tracing[i][0], 30 - tracing[i][1]] }))
    const fit = fitStraight(pairs, { size: [200, 150], centre: [20, 15] })
    if ('error' in fit) throw new Error(fit.error)
    const photo = photoWith(200, 150, 100, 70)
    const rect = photoRect(fit.transform, 200, 150)!
    const plan = planWarp(rect, fit.scale)!
    const out = warpPixels(photo, fit.transform, plan)!
    const [u, v] = brightest(out, plan.rect, plan.pxPerMm)
    const [wantU, wantV] = applyLineup(fit.transform, [100.5, 70.5])
    expect(Math.abs(u - wantU)).toBeLessThanOrEqual(1 / plan.pxPerMm)
    expect(Math.abs(v - wantV)).toBeLessThanOrEqual(1 / plan.pxPerMm)
  })

  it('leaves what the photo does not cover clear, and what it covers opaque', () => {
    const transform = similarity(5, 45, [0, 0])
    const photo = photoWith(100, 100, 50, 50)
    const plan = planWarp(photoRect(transform, 100, 100)!, 5)!
    const out = warpPixels(photo, transform, plan)!
    // A turned square leaves the corners of its box bare: the top left pixel is outside it, the middle is in.
    expect(out.data[3]).toBe(0)
    const mid = 4 * (Math.floor(out.height / 2) * out.width + Math.floor(out.width / 2))
    expect(out.data[mid + 3]).toBe(255)
  })

  it('keeps the photo\'s top at the greatest v: an upright photo\'s top row is the copy\'s top row', () => {
    const transform = similarity(4, 0, [0, 0])
    const photo = photoWith(40, 40, 20, 1)
    const plan = planWarp(photoRect(transform, 40, 40)!, 4)!
    const out = warpPixels(photo, transform, plan)!
    let top = -1
    for (let i = 0; i < out.width * out.height; i++) if (out.data[4 * i] > 200) top = Math.floor(i / out.width)
    expect(top).toBeLessThanOrEqual(1)
  })

  it('gives nothing back for a matrix that cannot be undone', () => {
    expect(warpPixels(photoWith(10, 10, 1, 1), [0, 0, 0, 0, 0, 0, 0, 0, 1], { rect: { min: [0, 0], max: [2, 2] }, pxPerMm: 5, width: 10, height: 10 })).toBeNull()
  })
})

// The worker and the browser's bitmaps are stood in for: what is held is that a worker which fails leaves the bitmap whole for the
// work that is then done on this thread.
describe('warp, when the worker fails', () => {
  type Fake = { id: string; detached: boolean; closed: boolean; width: number; height: number; close(): void }
  const fake = (id: string): Fake => {
    const b: Fake = { id, detached: false, closed: false, width: 4, height: 4, close: () => { b.closed = true } }
    return b
  }
  const rect = { min: [0, 0] as [number, number], max: [10, 10] as [number, number] }
  const seen: Fake[] = []

  async function load(worker: unknown, here: (b: Fake) => Promise<Blob>) {
    const { vi } = await import('vitest')
    vi.resetModules()
    vi.stubGlobal('Worker', worker)
    vi.stubGlobal('createImageBitmap', async (b: Fake) => fake(`${b.id}-copy`))
    vi.doMock('./warpCore', async (importActual) => ({ ...(await importActual<typeof import('./warpCore')>()), warpHere: async (b: Fake) => { seen.push({ ...b }); return here(b) } }))
    return (await import('./warp')).warp
  }
  const reset = async () => {
    const { vi } = await import('vitest')
    vi.unstubAllGlobals()
    vi.doUnmock('./warpCore')
    seen.length = 0
  }

  it('does the work here on the bitmap it was given, whole, when the worker errors', async () => {
    class Failing {
      onerror?: () => void
      terminate(): void {}
      postMessage(_msg: unknown, transfer: Fake[]): void {
        for (const t of transfer) t.detached = true
        queueMicrotask(() => this.onerror?.())
      }
    }
    const warp = await load(Failing, async () => new Blob(['ok']))
    const original = fake('photo')
    const blob = await warp(original as unknown as ImageBitmap, [1, 0, 0, 0, 1, 0, 0, 0, 1], rect, 5)
    expect(await blob.text()).toBe('ok')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ id: 'photo', detached: false })
    await reset()
  })

  it('does the work here when no worker can be made', async () => {
    const Throwing = function () { throw new Error('no workers here') } as unknown
    const warp = await load(Throwing, async () => new Blob(['ok']))
    const blob = await warp(fake('photo') as unknown as ImageBitmap, [1, 0, 0, 0, 1, 0, 0, 0, 1], rect, 5)
    expect(await blob.text()).toBe('ok')
    expect(seen[0]).toMatchObject({ id: 'photo', detached: false })
    await reset()
  })

  it('lets go of the bitmap it was given when the worker answers, and tells what a worker says is wrong', async () => {
    class Answering {
      onmessage?: (e: { data: unknown }) => void
      terminate(): void {}
      postMessage(): void {
        queueMicrotask(() => this.onmessage?.({ data: Answering.answer }))
      }
      static answer: unknown
    }
    const warp = await load(Answering, async () => { throw new Error('not here') })
    Answering.answer = { blob: new Blob(['made']) }
    const first = fake('photo')
    expect(await (await warp(first as unknown as ImageBitmap, [1, 0, 0, 0, 1, 0, 0, 0, 1], rect, 5)).text()).toBe('made')
    expect(first.closed).toBe(true)
    expect(seen).toHaveLength(0)
    Answering.answer = { error: 'the line-up cannot be undone' }
    const second = fake('photo2')
    await expect(warp(second as unknown as ImageBitmap, [1, 0, 0, 0, 1, 0, 0, 0, 1], rect, 5)).rejects.toThrow('the line-up cannot be undone')
    expect(second.closed).toBe(true)
    expect(seen).toHaveLength(0)
    await reset()
  })
})
