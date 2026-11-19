import type { Stroke } from '../../state/onboard'

// A board draws strokes (a new object's doodle, a drawing on the view); the strokes are what is kept, and a picture
// is made from them.

/** The board's own pixels: a doodle is always this size, whatever room the board has on screen. */
export const BOARD = { width: 1200, height: 800 } as const
/** The pen's two widths and the eraser's, in board pixels. */
export const PEN_WIDTHS = { thin: 3, thick: 9 } as const
export const ERASER_WIDTH = 28
/** The ink of a doodle sent to the agent: dark on white, whichever theme the person draws it in. */
export const PNG_INK = '#1a1a1a'
export const PNG_GROUND = '#ffffff'
/**
 * The ink on screen over a picture (a photo, an earlier drawing): the picture is white or dark whatever the theme, so the ink
 * follows the ground, not the theme: the PNG's dark ink with a light halo, which shows on both. Claude's picture has no halo.
 */
export const OVER_PICTURE = { ink: PNG_INK, casing: PNG_GROUND } as const

/** A pointer closer than this to the last point of a stroke (board pixels) adds nothing. */
const MIN_STEP = 1.5

/** Adds a point to a stroke unless it is on the last one. Returns whether it was added. */
export function addPoint(stroke: Stroke, x: number, y: number): boolean {
  const last = stroke.points.at(-1)
  if (last && Math.hypot(x - last[0], y - last[1]) < MIN_STEP) return false
  stroke.points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10])
  return true
}

/** Board pixels in one square of the grid, and the colour of its lines in the picture Claude gets (15 % grey on white). */
export const GRID_STEP = 40
export const PNG_GRID = 'rgba(0, 0, 0, 0.15)'

/** Makes the stroke a straight line from its first point to (x, y): two points, or one while the pointer has not moved. */
export function straighten(stroke: Stroke, x: number, y: number): void {
  const first = stroke.points[0]
  if (!first) return
  const end: [number, number] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
  stroke.points = Math.hypot(end[0] - first[0], end[1] - first[1]) < MIN_STEP ? [first] : [first, end]
}

/** The grid of a doodle on a ground of the board's size: a line every `GRID_STEP`, from the top left. */
export function paintGrid(ctx: Ctx, width: number, height: number): void {
  ctx.save()
  ctx.strokeStyle = PNG_GRID
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= width; x += GRID_STEP) (ctx.moveTo(x + 0.5, 0), ctx.lineTo(x + 0.5, height))
  for (let y = 0; y <= height; y += GRID_STEP) (ctx.moveTo(0, y + 0.5), ctx.lineTo(width, y + 0.5))
  ctx.stroke()
  ctx.restore()
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** How much wider a casing is than its line, on each side, in board pixels. */
export const CASING_PX = 2
/** How strokes are drawn: in their ink, over a casing when there is one (as a mark's line is). */
export interface InkLook { ink: string; casing?: string }

/**
 * Draws one stroke (or the rest of one, from point `from`): a pen in the ink, over its casing when there is one; the
 * eraser takes away what is under it, casing and all. What is added is drawn from a point back, and its ink from one
 * further back, so that the casing of what is added does not cover the end of the ink drawn before.
 */
export function paintStroke(ctx: Ctx, stroke: Stroke, look: InkLook, from = 0): void {
  const points = stroke.points
  if (points.length === 0 || from >= points.length) return
  const pen = stroke.tool !== 'eraser'
  const cased = pen && look.casing !== undefined
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalCompositeOperation = pen ? 'source-over' : 'destination-out'
  if (cased) trace(ctx, points, Math.max(0, from - 1), stroke.width + 2 * CASING_PX, look.casing!)
  trace(ctx, points, Math.max(0, from - (cased ? 2 : 1)), stroke.width, look.ink)
  ctx.restore()
}

/** One colour along the points from `start`; a stroke of one point is a dot. */
function trace(ctx: Ctx, points: Stroke['points'], start: number, width: number, colour: string): void {
  ctx.lineWidth = width
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.beginPath()
  if (points.length === 1) {
    ctx.arc(points[0][0], points[0][1], width / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.moveTo(points[start][0], points[start][1])
  for (let i = start + 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1])
  ctx.stroke()
}

/** All the strokes, in order, on the canvas cleared. */
export function paintStrokes(ctx: Ctx, strokes: readonly Stroke[], look: InkLook): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  for (const stroke of strokes) paintStroke(ctx, stroke, look)
}

/** A picture a sketch is drawn over: a decoded photo. */
export type Backdrop = ImageBitmap | HTMLImageElement

/** Where a picture of `width` x `height` goes on a board of `into`, fitted whole and centred (letterboxed on the ground). */
export function fitBackground(width: number, height: number, into: { width: number; height: number } = BOARD): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(into.width / width, into.height / height)
  const [w, h] = [Math.round(width * scale), Math.round(height * scale)]
  return { x: Math.round((into.width - w) / 2), y: Math.round((into.height - h) / 2), width: w, height: h }
}

/** The white ground of the board with a photo on it, fitted whole: what a sketch drawn over a photo is drawn on. */
export function paintBackground(ctx: Ctx, image: Backdrop, width: number = BOARD.width, height: number = BOARD.height): void {
  ctx.fillStyle = PNG_GROUND
  ctx.fillRect(0, 0, width, height)
  const [w, h] = 'naturalWidth' in image ? [image.naturalWidth, image.naturalHeight] : [image.width, image.height]
  if (w < 1 || h < 1) return
  const box = fitBackground(w, h, { width, height })
  ctx.drawImage(image, box.x, box.y, box.width, box.height)
}

/**
 * The PNG of a doodle: the strokes in dark ink on a white ground with a light grid (1 square = 40 px of the board), 1200 x 800.
 * Drawn over a photo (`background`) the ground is the photo, fitted whole, and there is no grid.
 */
export async function doodlePng(strokes: readonly Stroke[], grid = true, background?: Backdrop): Promise<Uint8Array> {
  const layer = new OffscreenCanvas(BOARD.width, BOARD.height)
  paintStrokes(layer.getContext('2d')!, strokes, { ink: PNG_INK })
  const sheet = new OffscreenCanvas(BOARD.width, BOARD.height)
  const ctx = sheet.getContext('2d')!
  if (background) paintBackground(ctx, background)
  else {
    ctx.fillStyle = PNG_GROUND
    ctx.fillRect(0, 0, BOARD.width, BOARD.height)
    if (grid) paintGrid(ctx, BOARD.width, BOARD.height)
  }
  ctx.drawImage(layer, 0, 0)
  const blob = await sheet.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** The PNG of a sketch drawn on again: the earlier drawing (a PNG of the board's size) with the new strokes over it, in dark ink. */
export async function doodlePngOver(ground: Uint8Array, strokes: readonly Stroke[]): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([ground as BlobPart], { type: 'image/png' }))
  try {
    const layer = new OffscreenCanvas(BOARD.width, BOARD.height)
    paintStrokes(layer.getContext('2d')!, strokes, { ink: PNG_INK })
    const sheet = new OffscreenCanvas(BOARD.width, BOARD.height)
    const ctx = sheet.getContext('2d')!
    ctx.fillStyle = PNG_GROUND
    ctx.fillRect(0, 0, BOARD.width, BOARD.height)
    ctx.drawImage(bitmap, 0, 0, BOARD.width, BOARD.height)
    ctx.drawImage(layer, 0, 0)
    const blob = await sheet.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
