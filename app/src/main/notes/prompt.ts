import { type DrawnOver, MOST_STROKES_TOLD, drawnOver } from '../../shared/drawing'
import type { NoteMark } from '../../shared/marks'
import type { PromptBlock } from '../sessions/transport'
import { noteFilesExist } from './files'
import { MOST_NOTE_PICTURES, NOT_HERE, notePictures } from './pictures'
import { noteText } from './text'

// The view notes a prompt carries: for each, in the order of the marks, its words, the picture with the ink on it, then
// its references. What the picture and the references are scaled to, and how many go, is `notePictures`; the words are
// `noteText`, the one wording `marks` shares. What is past the room for pictures is named in the words, not attached.

/** The first line of the words of a note (`describeMark`'s): how the transcript knows them from what the person typed. */
export const NOTE_HEAD = /^M[1-9][0-9]* · view note · /

export interface NotePromptOptions {
  /** The object's latest build, for the line that says the model was built again. */
  latest?: number
  toolName?: (tool: string) => string
  scale?: (bytes: Uint8Array, edge: number) => Promise<Uint8Array>
  /** How many more pictures the prompt may carry (6 in all, less those already in it). */
  room: number
}

export interface NotePrompt {
  blocks: PromptBlock[]
  /** What each note's ink lies over, for the item the transcript shows. */
  over: DrawnOver[]
  /** The notes whose words are in the prompt. */
  ids: string[]
  /** How many pictures were attached. */
  pictures: number
}

/** Whether `what` (`M5`, `M5 reference 2`, or a reason that begins so) is of that note. */
const ofNote = (id: string, what: string): boolean => what === id || what.startsWith(`${id} `) || what.startsWith(`${id}:`)

/**
 * The words and pictures of `notes` for a prompt: no more pictures than `room`, a note whose pictures are not on this
 * computer as words only, what was not attached named in the words of the note it belongs to.
 */
export async function notePrompt(dir: string, notes: readonly NoteMark[], opts: NotePromptOptions): Promise<NotePrompt> {
  if (notes.length === 0) return { blocks: [], over: [], ids: [], pictures: 0 }
  const toolName = opts.toolName ?? ((tool: string): string => tool)
  const pictures = await notePictures(dir, notes, opts.scale, Math.max(0, opts.room))
  const blocks: PromptBlock[] = []
  for (const note of notes) {
    const lines = [noteText(note, opts.latest, { toolName, files: noteFilesExist(dir, note) })]
    const left = pictures.left.filter((what) => ofNote(note.id, what))
    if (left.length > 0) lines.push(`Not attached: ${left.join(', ')} (a prompt carries at most ${MOST_NOTE_PICTURES} pictures; ${toolName('marks')} with ids ["${note.id}"] and pictures: true reads them).`)
    // A picture that is not on this computer is said by the words of the note already.
    for (const failed of pictures.failed.filter((why) => ofNote(note.id, why) && !why.endsWith(NOT_HERE))) lines.push(`Could not attach ${failed}`)
    blocks.push({ type: 'text', text: lines.join('\n') })
    for (const one of pictures.sent.filter((p) => ofNote(note.id, p.what))) blocks.push({ type: 'image', source: { type: 'base64', media_type: one.mediaType, data: Buffer.from(one.bytes).toString('base64') } })
  }
  return { blocks, over: notes.map((note) => noteDrawnOver(note, opts.latest)), ids: notes.map((note) => note.id), pictures: pictures.sent.length }
}

/**
 * What the ink of a note lies over, as the prompt's item shows it: refs and counts only, no kernel line, no box, no
 * camera. What a label's arrow points at is not a stroke and is left out here (the words say it).
 */
export function noteDrawnOver(note: NoteMark, latest?: number): DrawnOver {
  const told = Math.min(note.strokes.length, MOST_STROKES_TOLD)
  // Ink that was not looked under (the view moved while it was drawn) is no `over`; no ink is no strokes.
  const under = note.strokes.length > 0 && note.under.length === 0 ? null : note.under.slice(0, told)
  const more = note.strokes.length - told
  return { note: note.id, ...drawnOver({ revision: note.revision, under, ...(more > 0 ? { moreStrokes: more } : {}) }, latest) }
}
