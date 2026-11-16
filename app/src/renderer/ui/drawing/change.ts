import type { NoteLabel, NoteMark, NoteStroke } from '../../../shared/marks'
import type { StrokeUnder } from '../../../shared/drawing'
import type { NoteEdit } from '../../../shared/bridge'
import { oneLine, referenceChange, type RefItem } from './references'

/** What the sheet of a note being edited holds now: the strokes with ink left (and the eraser's), the labels as kept, the comment and the references. */
export interface Now {
  strokes: NoteStroke[]
  labels: NoteLabel[]
  comment: string
  references: RefItem[]
}

const sameLabel = (a: NoteLabel, b: NoteLabel): boolean => a.x === b.x && a.y === b.y && a.text === b.text && a.to?.x === b.to?.x && a.to?.y === b.to?.y
const sameLabels = (a: readonly NoteLabel[], b: readonly NoteLabel[]): boolean => a.length === b.length && a.every((l, i) => sameLabel(l, b[i]))
const sameStrokes = (a: Now['strokes'], b: Now['strokes']): boolean =>
  a.length === b.length && a.every((s, i) => s.width === b[i].width && (s.erase === true) === (b[i].erase === true) && s.points.length === b[i].points.length && s.points.every((p, n) => p[0] === b[i].points[n][0] && p[1] === b[i].points[n][1]))
const arrows = (labels: readonly NoteLabel[]): string => JSON.stringify(labels.flatMap((l) => (l.to ? [[l.to.x, l.to.y]] : [])))

/**
 * What the sheet changed of a note it was opened over: the comment when it differs, whether the ink (the strokes, or
 * the labels) changed, and the references (`referenceChange`). `any` is whether there is anything to keep.
 */
export function changeOf(note: NoteMark, now: Now): { comment?: string; ink: boolean; refs: Pick<NoteEdit, 'keepReferences' | 'addReferences'>; any: boolean } {
  const comment = oneLine(now.comment)
  const ink = !sameStrokes(note.strokes, now.strokes) || !sameLabels(note.labels, now.labels)
  const refs = referenceChange(now.references, note)
  const changedComment = comment !== note.note
  return { ...(changedComment ? { comment } : {}), ink, refs, any: changedComment || ink || Object.keys(refs).length > 0 }
}

/**
 * What the ink of a note lies over once it is changed: what the note had while its strokes and the heads of its arrows
 * stand where they were (a label's words changed alone), and none otherwise: the view is not what the picture was made
 * of, so it is not worked out again, and the note says so. (`under` is the strokes' lines, then the arrows' in the order of the labels.)
 */
export function itsUnder(note: NoteMark, now: Now): StrokeUnder[] {
  return sameStrokes(note.strokes, now.strokes) && arrows(note.labels) === arrows(now.labels) ? note.under : []
}
