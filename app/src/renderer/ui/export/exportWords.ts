import type { SessionStatus } from '../../../shared/bridge'
import { type ExportFormat, type ShareKind } from '../../../shared/exportdata'
import { bytes } from '../../../shared/format'
import { type Mark, awaitsAcknowledgement } from '../../../shared/marks'

// The words and the small rules of the export dock (spec 2026-11-18, "Export, on the bench"): pure, so that they are held by a test.

/** What the action of the foot says: `Export page`, `Export STEP`, `Export picture`. */
export function actionWords(format: ExportFormat, shared: ShareKind | null): string {
  if (shared === 'png') return 'Export picture'
  if (shared === 'svg') return 'Export SVG'
  if (shared === 'pdf') return 'Export PDF'
  return format === 'html' ? 'Export page' : `Export ${format === '3mf' ? '3MF' : format.toUpperCase()}`
}

/** What the band over the view says is being made: after "Exporting". */
export function bandWords(format: ExportFormat, shared: ShareKind | null): string {
  if (shared === 'png') return 'a picture'
  if (shared !== null) return 'a tracing'
  if (format === 'html') return 'a page'
  return format === 'stl' ? 'an STL file' : `a ${format === '3mf' ? '3MF' : 'STEP'} file`
}

/** The name of a file, at the end of its path: the window shows the name and never the folder. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** What a line weighs, as the dock says it (`bytes` of `shared/format.ts`): `812 B`, `413 KB`, `1.1 MB`. */
export const weightSaid = bytes

/** The marks the agent resolved that the person has not yet seen. */
export function marksToReview(marks: readonly Mark[]): number {
  return marks.filter(awaitsAcknowledgement).length
}

/** The line the conversation folds into while the export is open: how the session stands, and what waits in the marks. */
export function foldWords(status: SessionStatus | undefined, toReview: number): { state: string; marks: string | null } {
  const state = status === undefined ? 'no session' : status === 'needs_input' ? 'needs you' : status === 'exited' ? 'ended' : status
  return { state, marks: status === 'needs_input' || toReview === 0 ? null : `${toReview} ${toReview === 1 ? 'mark' : 'marks'} to review` }
}

/** The five tiles of the dock, in order. `formats` are the file kinds each writes, in the face of numbers; two of them are chosen between inside the tile. */
export interface Tile {
  name: 'A page' | 'CAD' | 'Slicer' | 'Picture' | 'Tracing'
  formats: string[]
  /** What it is for, said as its title. */
  title: string
}

export function tilesOf(): Tile[] {
  return [
    { name: 'A page', formats: ['HTML'], title: 'One page that opens by itself in a browser, to turn, take apart and cut. It asks nothing of the network' },
    { name: 'CAD', formats: ['STEP'], title: 'The exact shape of the last build, for a CAD program: each part a named body in its colour, in millimetres' },
    { name: 'Slicer', formats: ['3MF', 'STL'], title: 'Triangles for a slicer, in millimetres: a plate of parts as a 3MF, or one part as an STL' },
    { name: 'Picture', formats: ['PNG'], title: 'The view as it is on screen, as a picture, for a forum, a chat or a document' },
    { name: 'Tracing', formats: ['SVG', 'PDF'], title: 'A section or a tracing, laid flat at true scale in millimetres, for someone who will make the part' }
  ]
}
