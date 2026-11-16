import type { Stroke } from '../../state/onboard'
import { type InkLook, paintStrokes } from '../ink/strokes'

/**
 * The picture of a drawing on the view: the ground (the agent's picture of the view) with the ink over it, a PNG of
 * its size; and where ink is left, read from the ink alone, so that what the eraser took is not looked under.
 */
export async function drawingPng(ground: CanvasImageSource, size: { width: number; height: number }, strokes: readonly Stroke[], look: InkLook): Promise<{ png: Uint8Array; inked: (x: number, y: number) => boolean }> {
  const ink = new OffscreenCanvas(size.width, size.height)
  const inkCtx = ink.getContext('2d')!
  paintStrokes(inkCtx, strokes, look)
  const alpha = inkCtx.getImageData(0, 0, size.width, size.height).data
  const inked = (x: number, y: number): boolean => {
    const px = Math.round(x)
    const py = Math.round(y)
    return px >= 0 && py >= 0 && px < size.width && py < size.height && alpha[(py * size.width + px) * 4 + 3] > 0
  }
  const sheet = new OffscreenCanvas(size.width, size.height)
  const ctx = sheet.getContext('2d')!
  ctx.drawImage(ground, 0, 0, size.width, size.height)
  ctx.drawImage(ink, 0, 0)
  const blob = await sheet.convertToBlob({ type: 'image/png' })
  return { png: new Uint8Array(await blob.arrayBuffer()), inked }
}
