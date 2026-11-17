import { number } from './format'
import type { SketchMark } from './marks'

// What a person reads of a 3D sketch in a row, on a card and in a panel: one wording for each, so that they agree.

/** The name a sketch is shown by: its own, or "Sketch" and its number when it was left empty. */
export function sketchName(mark: Pick<SketchMark, 'name' | 'id'>): string {
  return mark.name.trim() === '' ? `Sketch ${mark.id}` : mark.name
}

/** How it is to be taken: `exact`, `rough`, or `flow ⌀19 mm` of a flow sketch that has a diameter. */
export function takeText(mark: Pick<SketchMark, 'take' | 'diameter'>): string {
  return mark.take === 'flow' && mark.diameter !== undefined ? `flow ⌀${number(mark.diameter)} mm` : mark.take
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** `3 strokes on 2 planes`, or `no strokes yet`: the planes that were drawn on only. */
export function countsText(mark: Pick<SketchMark, 'strokes'> & { planes: readonly unknown[] }): string {
  if (mark.strokes.length === 0) return 'no strokes yet'
  return `${plural(mark.strokes.length, 'stroke')} on ${plural(mark.planes.length, 'plane')}`
}
