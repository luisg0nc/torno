import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NoteMark } from '../../shared/marks'
import { writeNoteFile } from './files'
import { MOST_NOTE_PICTURES, NOTE_PICTURE_EDGE, notePictures } from './pictures'
import { jpeg, png } from './testing'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-note-pictures-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A note whose pictures are written, with `references` references. */
async function made(id: string, references: number): Promise<NoteMark> {
  const ink = await writeNoteFile(dir, 'ink', png(800, 600), 'image/png')
  const files = []
  for (let i = 0; i < references; i++) files.push({ file: await writeNoteFile(dir, 'reference', i % 2 === 0 ? jpeg(300, 200) : png(300, 200), i % 2 === 0 ? 'image/jpeg' : 'image/png'), comment: `ref ${i + 1}` })
  return { id, kind: 'note', picture: 'n-000000000000.png', ink, references: files } as unknown as NoteMark
}

describe('notePictures', () => {
  it('sends the inked picture of each note, then its references, in the order of the notes, scaled to 1280', async () => {
    const notes = [await made('M2', 1), await made('M7', 0)]
    const edges: number[] = []
    const got = await notePictures(dir, notes, async (bytes, edge) => (edges.push(edge), bytes))
    expect(got.sent.map((p) => [p.what, p.mediaType])).toEqual([['M2', 'image/png'], ['M2 reference 1', 'image/jpeg'], ['M7', 'image/png']])
    expect(edges).toEqual([NOTE_PICTURE_EDGE, NOTE_PICTURE_EDGE, NOTE_PICTURE_EDGE])
    expect(NOTE_PICTURE_EDGE).toBe(1280)
    expect(got.left).toEqual([])
    expect(got.failed).toEqual([])
  })

  it('sends at most 6 and names the rest', async () => {
    const notes = [await made('M1', 3), await made('M2', 3), await made('M3', 3)]
    const got = await notePictures(dir, notes)
    expect(MOST_NOTE_PICTURES).toBe(6)
    expect(got.sent.map((p) => p.what)).toEqual(['M1', 'M1 reference 1', 'M1 reference 2', 'M1 reference 3', 'M2', 'M2 reference 1'])
    expect(got.left).toEqual(['M2 reference 2', 'M2 reference 3', 'M3', 'M3 reference 1', 'M3 reference 2', 'M3 reference 3'])
  })

  it('takes the room the caller leaves: a prompt that attached the view first', async () => {
    const got = await notePictures(dir, [await made('M1', 1)], undefined, 1)
    expect(got.sent.map((p) => p.what)).toEqual(['M1'])
    expect(got.left).toEqual(['M1 reference 1'])
  })

  it('names a picture that is not on this computer, or that cannot be sent, and does not count it against the cap', async () => {
    const note = await made('M1', 2)
    const gone = { ...note, references: [{ file: 'r-ffffffffffff.png', comment: '' }, ...note.references] } as NoteMark
    const got = await notePictures(dir, [gone], undefined, 2)
    expect(got.failed).toEqual(['M1 reference 1: the picture is not on this computer'])
    expect(got.sent.map((p) => p.what)).toEqual(['M1', 'M1 reference 2'])
    expect(got.left).toEqual(['M1 reference 3'])

    const bad = await notePictures(dir, [note], async () => new Uint8Array([1, 2, 3]))
    expect(bad.sent).toEqual([])
    expect(bad.failed).toHaveLength(3)
    expect(bad.failed[0]).toMatch(/^M1: the picture cannot be sent/)
    const thrown = await notePictures(dir, [note], async () => Promise.reject(new Error('no decoder')))
    expect(thrown.failed[0]).toBe('M1: no decoder')
  })
})
