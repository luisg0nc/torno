import { MAX_LABEL, MOST_LABELS, type NoteLabel } from '../../../shared/marks'

// A label of a view note is a word at a point of the picture, in a box, with an arrow to another point when it has
// one. It is laid out here, from a measure of text, so that the sheet (an SVG) and the picture of the note (a canvas)
// draw one and the same box.

/** The label's text in board pixels, the pad round it, a line's height and the width of the widest line. */
export const LABEL_FONT_PX = 22
export const LABEL_PAD = 8
export const LABEL_LINE = 28
export const LABEL_MAX_WIDTH = 360
/** The arrow: how long a barb of its head is, and its angle to the line. */
export const BARB_LENGTH = 16
export const BARB_ANGLE = Math.PI / 7

export type Measure = (text: string) => number
export interface Point { x: number; y: number }
export interface LabelBox { x: number; y: number; width: number; height: number; lines: string[] }

/** The text broken into lines no wider than `maxWidth`: between words, and a word wider than a line by its letters. */
export function wrapLabel(text: string, measure: Measure, maxWidth = LABEL_MAX_WIDTH): string[] {
  const lines: string[] = []
  let line = ''
  const push = (): void => void (line !== '' && lines.push(line), (line = ''))
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    if (line !== '' && measure(`${line} ${word}`) <= maxWidth) {
      line = `${line} ${word}`
      continue
    }
    push()
    if (measure(word) <= maxWidth) {
      line = word
      continue
    }
    // Wider than a line: by its letters.
    for (const letter of word) {
      if (line !== '' && measure(line + letter) > maxWidth) push()
      line += letter
    }
  }
  push()
  return lines.length > 0 ? lines : ['']
}

/** The box of a label, from its point (its top left corner). */
export function labelBox(label: Pick<NoteLabel, 'x' | 'y' | 'text'>, measure: Measure, maxWidth = LABEL_MAX_WIDTH): LabelBox {
  const lines = wrapLabel(label.text, measure, maxWidth)
  const widest = Math.max(...lines.map((l) => measure(l)))
  return { x: label.x, y: label.y, width: Math.ceil(widest) + 2 * LABEL_PAD, height: lines.length * LABEL_LINE + 2 * LABEL_PAD, lines }
}

const tenth = (n: number): number => Math.round(n * 10) / 10

/** Where an arrow to `to` leaves a box: where the line from its middle to the head crosses its edge; null when the head is inside it. */
export function arrowFrom(box: LabelBox, to: Point): Point | null {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const dx = to.x - cx
  const dy = to.y - cy
  if (Math.abs(dx) <= box.width / 2 && Math.abs(dy) <= box.height / 2) return null
  const t = Math.min(dx === 0 ? Infinity : box.width / 2 / Math.abs(dx), dy === 0 ? Infinity : box.height / 2 / Math.abs(dy))
  return { x: tenth(cx + dx * t), y: tenth(cy + dy * t) }
}

/** The two ends of the barbs of a head at `to`, for an arrow coming from `from`. */
export function barbs(from: Point, to: Point, length = BARB_LENGTH, angle = BARB_ANGLE): [Point, Point] {
  const back = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI
  const at = (a: number): Point => ({ x: to.x + length * Math.cos(a), y: to.y + length * Math.sin(a) })
  return [at(back + angle), at(back - angle)]
}

/** The SVG path of an arrow from a box to `to`, with its head: the line, then the two barbs. Empty when the head is inside the box. */
export function arrowPath(box: LabelBox, to: Point): string {
  const from = arrowFrom(box, to)
  if (!from) return ''
  const [a, b] = barbs(from, to)
  return `M${from.x} ${from.y}L${to.x} ${to.y}M${a.x} ${a.y}L${to.x} ${to.y}L${b.x} ${b.y}`
}

const within = (n: number, most: number): number => tenth(Math.min(Math.max(n, 0), most))

/** What a note keeps of the labels the sheet holds: one line of at most `MAX_LABEL` characters each, none empty, points within the picture, at most `MOST_LABELS`. */
export function cleanLabels(labels: readonly NoteLabel[], size: { width: number; height: number }): NoteLabel[] {
  const kept: NoteLabel[] = []
  for (const label of labels) {
    const text = label.text.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL).trim()
    if (text === '' || kept.length >= MOST_LABELS) continue
    kept.push({ x: within(label.x, size.width), y: within(label.y, size.height), text, ...(label.to ? { to: { x: within(label.to.x, size.width), y: within(label.to.y, size.height) } } : {}) })
  }
  return kept
}
