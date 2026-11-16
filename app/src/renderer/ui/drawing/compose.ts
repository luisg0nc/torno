import type { NoteLabel } from '../../../shared/marks'
import type { Stroke } from '../../state/onboard'
import { CASING_PX, type InkLook, paintStrokes } from '../ink/strokes'
import { LABEL_FONT_PX, LABEL_LINE, LABEL_PAD, arrowFrom, barbs, labelBox } from './labelbox'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** The width of the arrow of a label, in board pixels. */
const ARROW_PX = 3

/** The font a label is set in, as the sheet sets it: the face of the window's text, at `LABEL_FONT_PX`. */
export const labelFont = (family: string): string => `500 ${LABEL_FONT_PX}px ${family}`

/**
 * The labels of a note painted over the ink: for each, its arrow (a line with a head of two barbs, over a casing, so
 * that it reads on any picture), then its box with the text in the ink. The arrow is painted first, so that the box is over its tail.
 */
export function paintLabels(ctx: Ctx, labels: readonly NoteLabel[], look: InkLook, family: string): void {
  if (labels.length === 0) return
  ctx.save()
  ctx.font = labelFont(family)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const boxes = labels.map((label) => labelBox(label, (text) => ctx.measureText(text).width))
  labels.forEach((label, i) => {
    if (!label.to) return
    const from = arrowFrom(boxes[i], label.to)
    if (!from) return
    const [a, b] = barbs(from, label.to)
    for (const [width, colour] of [[ARROW_PX + 2 * CASING_PX, look.casing ?? look.ink], [ARROW_PX, look.ink]] as const) {
      ctx.strokeStyle = colour
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(label.to.x, label.to.y)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(label.to.x, label.to.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  })
  ctx.textBaseline = 'middle'
  boxes.forEach((box) => {
    ctx.fillStyle = look.casing ?? '#ffffff'
    ctx.fillRect(box.x, box.y, box.width, box.height)
    ctx.strokeStyle = look.ink
    ctx.lineWidth = 2
    ctx.strokeRect(box.x, box.y, box.width, box.height)
    ctx.fillStyle = look.ink
    box.lines.forEach((line, n) => ctx.fillText(line, box.x + LABEL_PAD, box.y + LABEL_PAD + n * LABEL_LINE + LABEL_LINE / 2))
  })
  ctx.restore()
}

/**
 * The picture of a note: the ground (the agent's picture of the view) with the ink over it, then the labels and their
 * arrows, a PNG of its size; and where ink is left, read from the ink alone, so that what the eraser took is not looked under.
 */
export async function drawingPng(
  ground: CanvasImageSource,
  size: { width: number; height: number },
  strokes: readonly Stroke[],
  look: InkLook,
  labels: readonly NoteLabel[] = [],
  family = 'sans-serif'
): Promise<{ png: Uint8Array; inked: (x: number, y: number) => boolean }> {
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
  paintLabels(ctx, labels, look, family)
  const blob = await sheet.convertToBlob({ type: 'image/png' })
  return { png: new Uint8Array(await blob.arrayBuffer()), inked }
}
