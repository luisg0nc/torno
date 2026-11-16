import { type Mark, type NewMark, type NewNote, type NoteMark, type NotePatch, MOST_NOTE_REFERENCES } from '../../shared/marks'
import type { NoteDraft, NoteEdit } from '../../shared/bridge'
import type { ObjectInfo } from '../../shared/workspace'
import type { MarkStore } from '../marks/store'
import { Refusal } from '../refusal'
import { checkNoteDraft, checkNoteEdit } from './check'
import { readNoteFile, writeNoteFile } from './files'

// What the window may ask of the view notes (`notes:make`, `notes:edit`, `notes:picture`), as handlers that do not
// need Electron (`main/ipc.ts` registers them). The window names a project and a mark by its `M<n>`; it never names a
// folder or a file, and an id, an author, a status or what only main says of a mark is never taken from it. Each
// picture is checked (`check.ts`) before any file is written, and every file is named by main (`files.ts`).

export interface NoteIpcDeps {
  marks: Pick<MarkStore, 'addNote' | 'editNote' | 'list'>
  /** A project of the open workspace. */
  object(objectId: string): ObjectInfo | undefined
  /** Says what main says of where a mark is placed (`placedMark`: how far its part is spread, its tag). */
  placed?<M extends NewMark>(mark: M, objectId: string): M
}

const NOT_OPEN = 'That project is not open.'
const MARK_ID = /^M[1-9]\d{0,14}$/

export function noteHandlers(deps: NoteIpcDeps) {
  const open = (objectId: unknown): ObjectInfo => {
    const obj = typeof objectId === 'string' ? deps.object(objectId) : undefined
    if (!obj) throw new Refusal(NOT_OPEN)
    return obj
  }

  /** The note of the project the window names, or why there is none. */
  const noteOf = async (obj: ObjectInfo, id: unknown): Promise<NoteMark> => {
    if (typeof id !== 'string' || !MARK_ID.test(id)) throw new Refusal('That is not a note of the project.')
    const mark = (await deps.marks.list(obj.id)).find((m: Mark) => m.id === id)
    if (!mark) throw new Refusal(`There is no note ${id} in this project.`)
    if (mark.kind !== 'note') throw new Refusal(`${id} is not a note.`)
    return mark
  }

  return {
    /** Keeps a new note, as a draft of the person: its pictures are written first, under names of main's own, then the mark. */
    async make(raw: NoteDraft): Promise<Mark> {
      const draft = checkNoteDraft(raw)
      if (draft instanceof Refusal) throw draft
      const obj = open(draft.objectId)
      const picture = await writeNoteFile(obj.dir, 'plain', draft.plain, 'image/png')
      const ink = await writeNoteFile(obj.dir, 'ink', draft.inked, 'image/png')
      const references: NoteMark['references'] = []
      for (const reference of draft.references) references.push({ file: await writeNoteFile(obj.dir, 'reference', reference.bytes, reference.mediaType), comment: reference.comment })
      const note = {
        kind: 'note',
        author: 'user',
        note: draft.comment,
        layout: draft.layout,
        revision: draft.revision,
        camera: draft.camera,
        picture,
        ink,
        size: draft.size,
        strokes: draft.strokes,
        inkColour: draft.inkColour,
        labels: draft.labels,
        under: draft.under,
        references,
        ...(draft.anchor ? { anchor: draft.anchor } : {})
      } satisfies NewNote
      return deps.marks.addNote(obj.id, deps.placed ? deps.placed(note, obj.id) : note)
    },

    /**
     * Changes a note. A new picture with the ink on it is a new file: the one it replaces, and the references dropped,
     * stay on the disk until the sweep of the next run, so that an undo of the window can name them again.
     */
    async edit(objectId: string, id: string, raw: NoteEdit): Promise<Mark> {
      const obj = open(objectId)
      const mark = await noteOf(obj, id)
      const edit = checkNoteEdit(raw, mark.size)
      if (edit instanceof Refusal) throw edit
      // Which of its references stay, and the new ones, before a file is written.
      const keep = edit.keepReferences ?? mark.references.map((_, i) => i)
      if (keep.some((i) => i >= mark.references.length)) throw new Refusal('The references to keep are not all references of the note.')
      const added = edit.addReferences ?? []
      if (keep.length + added.length > MOST_NOTE_REFERENCES) throw new Refusal(`A note has at most ${MOST_NOTE_REFERENCES} references.`)
      const patch: NotePatch = {}
      if (edit.comment !== undefined) patch.note = edit.comment
      if (edit.labels !== undefined) patch.labels = edit.labels
      if (edit.strokes !== undefined) patch.strokes = edit.strokes
      if (edit.under !== undefined) patch.under = edit.under
      if (edit.inked !== undefined) patch.ink = await writeNoteFile(obj.dir, 'ink', edit.inked, 'image/png')
      if (edit.keepReferences !== undefined || added.length > 0) {
        const references = keep.map((i) => mark.references[i])
        for (const reference of added) references.push({ file: await writeNoteFile(obj.dir, 'reference', reference.bytes, reference.mediaType), comment: reference.comment })
        patch.references = references
      }
      return deps.marks.editNote(obj.id, mark.id, patch)
    },

    /**
     * The bytes of one picture of a note: the one with the ink on it, the plain one, or the reference at an index. Null
     * when the note has no such picture, or its file is not on this computer (the pictures are not in git).
     */
    async picture(objectId: string, id: string, which: 'ink' | 'plain' | number): Promise<Uint8Array | null> {
      const obj = open(objectId)
      if (typeof id !== 'string' || !MARK_ID.test(id)) return null
      const mark = (await deps.marks.list(obj.id)).find((m: Mark) => m.id === id)
      if (mark?.kind !== 'note') return null
      let name: string | undefined
      if (which === 'ink') name = mark.ink
      else if (which === 'plain') name = mark.picture
      else if (typeof which === 'number' && Number.isInteger(which) && which >= 0) name = mark.references[which]?.file
      if (name === undefined) return null
      const bytes = await readNoteFile(obj.dir, name)
      return bytes === null ? null : new Uint8Array(bytes)
    }
  }
}
