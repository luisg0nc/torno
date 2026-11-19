import { MOST_STROKES_TOLD } from '../../shared/drawing'
import { type NoteMark, penStrokes } from '../../shared/marks'
import { describeMark } from '../marks/describe'
import { VECTOR_NOTE, counted, folded, overText, strokeLine } from '../sessions/drawing'

// What Claude reads of a view note, in words: the one wording the `marks` tool and the prompt that carries a note share.
// The pictures are attached beside it (`pictures.ts`); this is all the text there is. No line of it begins with a word
// the stand-in agent takes for a command (`test/fake-agent.mjs`), and every line is one line.

/** Which of a note's files are on this computer (`noteFilesExist`). Not given: they are taken to be. */
export interface NoteFilesHere {
  picture: boolean
  ink: boolean
  references: boolean[]
}

export interface NoteTextOptions {
  /** A tool of torno's as the client names it to its model; the tool's own name when none is given. */
  toolName?: (tool: string) => string
  files?: NoteFilesHere
}

/**
 * A note as the agent reads it: the mark's line, what the picture is and on which build, the ink and its colour, the
 * camera as JSON with how to `look` from it, that the model was built again since (`latestRevision`, the object's last
 * build) when it was, a line per stroke of what it lies over, each label (and, for one with an arrow, what the head
 * points at), the comment and each reference with its comment. A note whose picture is not on this computer says so
 * and sends the agent to look through its camera.
 */
export function noteText(mark: NoteMark, latestRevision: number | undefined, opts: NoteTextOptions = {}): string {
  const toolName = opts.toolName ?? ((tool: string): string => tool)
  const files = opts.files
  const lines = [describeMark(mark, latestRevision === undefined ? {} : { revision: latestRevision })]
  // The strokes told of are the pen strokes: an eraser stroke lies over nothing.
  const pens = penStrokes(mark.strokes).length
  const ink = pens > 0 ? `The ink in ${mark.inkColour}${mark.labels.length > 0 ? ' and the labels are' : ' is'}` : mark.labels.length > 0 ? 'The labels are' : ''
  const drawn = ink ? ` ${ink} the person's drawing over the picture: not the model, and not marks.` : ''
  lines.push(`Picture: the view as the person saw it when they made the note, in layout ${mark.layout}, on r${mark.revision}.${drawn} The marks in it are torno's, numbered as in the list of marks.`)
  if (files && !files.ink) lines.push('The picture is not on this computer; look through its camera.')
  lines.push(`It was seen from ${JSON.stringify(mark.camera)}: ${toolName('look')} with that as its view draws it again.`)

  const faces = mark.under.some((u) => u.refs.length > 0)
  if (latestRevision !== undefined && latestRevision > mark.revision) {
    lines.push(`The model has been built again since: r${latestRevision} is the latest${faces ? `, and the faces below are of r${mark.revision}: they may name other faces now` : ''}.`)
  }

  const told = Math.min(pens, MOST_STROKES_TOLD)
  const arrows = mark.labels.filter((label) => label.to !== undefined).length
  if (pens > 0) {
    if (mark.under.length === 0) lines.push('What the ink lies over was not worked out.')
    else {
      lines.push(`Under the ink, stroke by stroke (x and y are pixels of the ${mark.size.w}×${mark.size.h} picture; faces are of r${mark.revision}):`)
      if (mark.under.slice(0, told).some((u) => u.vector)) lines.push(VECTOR_NOTE)
      mark.under.slice(0, told).forEach((stroke, i) => lines.push(strokeLine(stroke, i + 1)))
      if (pens > told) lines.push(`(${counted(pens - told, 'more stroke', 'more strokes')}, not told)`)
    }
  }

  if (mark.labels.length > 0) {
    lines.push(`Labels on the picture (${counted(mark.labels.length, 'label', 'labels')}${arrows > 0 ? `, ${arrows} with an arrow` : ''}):`)
    // What the heads point at come after the strokes in `under`, one for each label with an arrow, in the order of the labels.
    let head = told
    for (const label of mark.labels) {
      const text = `"${folded(label.text)}"`
      if (label.to === undefined) lines.push(`- ${text}`)
      else {
        const under = mark.under[head++]
        lines.push(`- ${text} → ${under ? overText(under) : 'what it points at was not worked out'}`)
      }
    }
  }

  const comment = folded(mark.note)
  if (comment !== '') lines.push(`Comment: ${comment}`)
  mark.references.forEach((reference, i) => {
    const said = folded(reference.comment)
    lines.push(`reference ${i + 1}: ${said === '' ? '(no comment)' : said}${files && files.references[i] === false ? ' (the picture is not on this computer)' : ''}`)
  })
  return lines.join('\n')
}

/**
 * A note as data for the agent, beside its line: what the mark holds without its strokes (400 points each, and up
 * to 2000 of them), what the ink lies over (`text` says it), the names of its files (the agent names none) or the
 * bytes of any picture. `strokeCount` says how much ink there is, `text` says all of it in words.
 */
export function noteData(mark: NoteMark, latestRevision: number | undefined, files?: NoteFilesHere): object {
  const { picture: _picture, ink: _ink, strokes, under: _under, references, ...rest } = mark
  return { ...rest, strokeCount: penStrokes(strokes).length, references: references.map((reference) => ({ comment: reference.comment })), text: noteText(mark, latestRevision, files ? { files } : {}) }
}
