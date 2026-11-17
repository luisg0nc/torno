import { invertLineup, type Matrix3, type UvRect } from '../../../shared/lineup'

// Straightening a photo, apart from the worker that runs it (`warp.ts`; this file is what the worker holds, and so holds no worker): the copy the view, the card, Claude's picture and the export all place by its rectangle in mm. It is made of the
// photo through the line-up's matrix by inverse mapping (each pixel of the copy asks the photo where it comes from, and is a bilinear
// blend of the four pixels about that place), at the photo's own pixels per mm and at most 4000 px on a side, so a photo is never made
// larger than it was. A copy's top row is its rectangle's greatest `v`, a pixel's place its centre. What the photo does not cover is
// left clear, so the copy is a PNG. The work is `warpPixels`, pure; `warp` runs it in a worker (`warp.worker.ts`) where one can be made,
// so that a 12 megapixel photo does not stop the window.

/** The long edge of a copy, the most a kept photo may have. */
export const MAX_WARP_EDGE = 4000
/** A copy heavier than this many bytes is made again at three quarters of its size: main keeps no more than 25 MB. */
export const MAX_WARP_BYTES = 24_000_000

export interface WarpPlan {
  rect: UvRect
  /** Pixels per mm of the copy: the photo's own, taken down when the copy would be past 4000 px. */
  pxPerMm: number
  width: number
  height: number
}

export interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** The size of the copy of a photo whose box in mm is `rect`, at `pxPerMm` (the photo's own), held to 4000 px on its long edge. Null for a box with no size or a scale that is not one. */
export function planWarp(rect: UvRect, pxPerMm: number): WarpPlan | null {
  const w = rect.max[0] - rect.min[0]
  const h = rect.max[1] - rect.min[1]
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h) || !(pxPerMm > 0) || !Number.isFinite(pxPerMm)) return null
  const k = Math.min(pxPerMm, MAX_WARP_EDGE / Math.max(w, h))
  return { rect, pxPerMm: k, width: Math.max(1, Math.min(MAX_WARP_EDGE, Math.round(w * k))), height: Math.max(1, Math.min(MAX_WARP_EDGE, Math.round(h * k))) }
}

/**
 * The copy of `photo` straightened through `transform` (photo px to `uv` mm): inverse mapping, bilinear, laid out by `plan`. Null when
 * the matrix cannot be undone. A place outside the photo is clear; a place on its border is the border's own colour.
 */
export function warpPixels(photo: Pixels, transform: readonly number[], plan: WarpPlan): Pixels | null {
  const inverse = invertLineup(transform)
  if (!inverse) return null
  const { width, height, rect, pxPerMm } = plan
  const out = new Uint8ClampedArray(width * height * 4)
  const src = photo.data
  const sw = photo.width
  const sh = photo.height
  const [a, b, c, d, e, f, g, h, i] = inverse as Matrix3
  for (let row = 0; row < height; row++) {
    const v = rect.max[1] - (row + 0.5) / pxPerMm
    for (let col = 0; col < width; col++) {
      const u = rect.min[0] + (col + 0.5) / pxPerMm
      const w = g * u + h * v + i
      if (!(Math.abs(w) > 1e-300)) continue
      // Where in the photo, in its pixels from its top left corner; a pixel's centre is half a pixel in.
      const x = (a * u + b * v + c) / w
      const y = (d * u + e * v + f) / w
      if (!(x >= 0 && x <= sw && y >= 0 && y <= sh)) continue
      const fx = Math.min(sw - 1, Math.max(0, x - 0.5))
      const fy = Math.min(sh - 1, Math.max(0, y - 0.5))
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const tx = fx - x0
      const ty = fy - y0
      const p00 = 4 * (y0 * sw + x0)
      const p10 = 4 * (y0 * sw + x1)
      const p01 = 4 * (y1 * sw + x0)
      const p11 = 4 * (y1 * sw + x1)
      const to = 4 * (row * width + col)
      for (let k = 0; k < 4; k++) out[to + k] = (src[p00 + k] * (1 - tx) + src[p10 + k] * tx) * (1 - ty) + (src[p01 + k] * (1 - tx) + src[p11 + k] * tx) * ty
    }
  }
  return { data: out, width, height }
}

/** The work on this thread: the bitmap drawn to a canvas, warped, and written as a PNG. */
export async function warpHere(bitmap: ImageBitmap, transform: readonly number[], plan: WarpPlan): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not get a 2D canvas to straighten the photo on')
  ctx.drawImage(bitmap, 0, 0)
  const photo = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  let at = plan
  for (let tries = 0; ; tries++) {
    const made = warpPixels(photo, transform, at)
    if (!made) throw new Error('the line-up cannot be undone, so the photo cannot be straightened by it')
    const out = new OffscreenCanvas(made.width, made.height)
    out.getContext('2d')!.putImageData(new ImageData(made.data as Uint8ClampedArray<ArrayBuffer>, made.width, made.height), 0, 0)
    const blob = await out.convertToBlob({ type: 'image/png' })
    if (blob.size <= MAX_WARP_BYTES || tries >= 4) return blob
    const smaller = planWarp(at.rect, at.pxPerMm * 0.75)
    if (!smaller) return blob
    at = smaller
  }
}
