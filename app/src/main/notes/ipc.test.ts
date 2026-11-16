import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Mark, type NewMark, type NoteMark, NOTE_INK, NOTE_PICTURE, NOTE_REFERENCE } from '../../shared/marks'
import { REFUSED } from '../../shared/refusal'
import type { ObjectInfo } from '../../shared/workspace'
import { MarkStore } from '../marks/store'
import { refusable } from '../refusal'
import { draft, jpeg, png } from './testing'
import { noteHandlers } from './ipc'

let root: string
let dir: string
let store: MarkStore
let placed: string[]

const obj = (): ObjectInfo => ({ id: 'bracket', name: 'bracket', dir, model: 'model.py' })
const handlers = () =>
  noteHandlers({
    marks: store,
    object: (id) => (id === 'bracket' ? obj() : undefined),
    placed: <M extends NewMark>(mark: M, objectId: string): M => {
      placed.push(objectId)
      return mark.kind === 'note' && mark.anchor ? { ...mark, anchor: { ...mark.anchor, arranged: [0, 0, 0] as [number, number, number] } } : mark
    }
  })
const folder = (): string => join(dir, '.torno', 'notes')
const files = (): string[] => (existsSync(folder()) ? readdirSync(folder()).filter((n) => n !== '.gitignore').sort() : [])
const made = async (over: Record<string, unknown> = {}): Promise<NoteMark> => (await handlers().make(draft(over) as never)) as NoteMark
const read = (name: string): Buffer => readFileSync(join(folder(), name))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-notes-ipc-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  store = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  placed = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('notes.make', () => {
  it('writes the plain picture, the inked one and each reference, then the mark, as a draft of the person', async () => {
    const note = await made()
    expect(note).toMatchObject({ id: 'M1', kind: 'note', author: 'user', status: 'draft', note: 'make this wall thicker', layout: 'assembly', revision: 3, size: { w: 800, h: 600 }, inkColour: '#ff00ff' })
    expect(note.picture).toMatch(NOTE_PICTURE)
    expect(note.ink).toMatch(NOTE_INK)
    expect(note.references).toHaveLength(1)
    expect(note.references[0].file).toMatch(NOTE_REFERENCE)
    expect(note.references[0]).toMatchObject({ comment: 'like this one' })
    expect(files().sort()).toEqual([note.ink, note.picture, note.references[0].file].sort())
    expect([...read(note.picture)]).toEqual([...png(800, 600)])
    expect([...read(note.ink)]).toEqual([...png(800, 600)])
    expect([...read(note.references[0].file)]).toEqual([...jpeg(300, 200)])
    expect(readFileSync(join(folder(), '.gitignore'), 'utf8')).toBe('*\n')
    expect((await store.list('bracket')).map((m) => m.id)).toEqual(['M1'])
  })

  it('gives the mark what main says of it, whatever the window said', async () => {
    const note = await made({ id: 'M9', by: 'agent', author: 'agent', status: 'resolved', sentBefore: true, reopened: true, checkedRevision: 3, picture: '../../x.png', ink: 'x', file: 'y', anchorState: 'orphaned', createdAt: 'then' })
    expect(note).toMatchObject({ id: 'M1', author: 'user', status: 'draft', anchorState: 'ok' })
    for (const key of ['sentBefore', 'reopened', 'checkedRevision', 'resolvedBy', 'acknowledged', 'by']) expect(note).not.toHaveProperty(key)
    expect(note.picture).toMatch(NOTE_PICTURE)
    expect(note.createdAt).not.toBe('then')
  })

  it('has main place the anchor of the mark, and name no tag the window gave', async () => {
    const note = await made({ anchor: { point: [1, 2, 3], part: 'lid', ref: 'lid/F12', tag: 'top' } })
    expect(placed).toEqual(['bracket'])
    expect(note.anchor).toEqual({ point: [1, 2, 3], part: 'lid', ref: 'lid/F12', arranged: [0, 0, 0] })
  })

  it('refuses a draft that is not one and writes nothing', async () => {
    await expect(handlers().make(draft({ inked: png(10, 10) }) as never)).rejects.toThrow(/size/)
    await expect(handlers().make(draft({ labels: Array.from({ length: 21 }, () => ({ x: 1, y: 1, text: 'a' })), under: [] }) as never)).rejects.toThrow(/labels/)
    await expect(handlers().make(null as never)).rejects.toThrow(/not one/)
    expect(files()).toEqual([])
    expect(await store.list('bracket')).toEqual([])
  })

  it('refuses a project that is not open', async () => {
    await expect(handlers().make(draft({ objectId: 'nope' }) as never)).rejects.toThrow(/not open/)
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('is refused as a refusal, which the window reads as one', async () => {
    const refused = await refusable(handlers().make)(draft({ comment: 7 }) as never)
    expect(refused).toHaveProperty([REFUSED])
  })

  it('writes the references it is given, up to six, each under a name of its own', async () => {
    const reference = (i: number) => ({ bytes: png(10 + i, 10), mediaType: 'image/png', comment: `r${i}` })
    const note = await made({ references: Array.from({ length: 6 }, (_, i) => reference(i)) })
    expect(new Set(note.references.map((r) => r.file)).size).toBe(6)
    expect(note.references.map((r) => r.comment)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5'])
    expect(files()).toHaveLength(8)
  })
})

describe('notes.edit', () => {
  it('changes the comment alone, writing no file', async () => {
    const note = await made()
    const before = files()
    const edited = (await handlers().edit('bracket', note.id, { comment: 'thicker, 4 mm' })) as NoteMark
    expect(edited).toMatchObject({ note: 'thicker, 4 mm', picture: note.picture, ink: note.ink })
    expect(files()).toEqual(before)
  })

  it('writes a new inked picture when strokes or labels change, and leaves the old file for the sweep', async () => {
    const note = await made()
    const ink = png(800, 600)
    ink[30] = 7
    const edited = (await handlers().edit('bracket', note.id, { labels: [{ x: 5, y: 5, text: 'here' }], strokes: [], under: [], inked: ink })) as NoteMark
    expect(edited.ink).toMatch(NOTE_INK)
    expect(edited.ink).not.toBe(note.ink)
    expect(edited.picture).toBe(note.picture)
    expect(edited.labels).toEqual([{ x: 5, y: 5, text: 'here' }])
    expect(edited.strokes).toEqual([])
    expect(read(edited.ink)[30]).toBe(7)
    expect(files()).toContain(note.ink)
  })

  it('refuses a change of strokes or labels with no picture of the new ink, and writes nothing', async () => {
    const note = await made()
    const before = files()
    await expect(handlers().edit('bracket', note.id, { labels: [] })).rejects.toThrow(/inked/)
    expect(files()).toEqual(before)
    expect(((await store.list('bracket'))[0] as NoteMark).labels).toHaveLength(1)
  })

  it('holds a change to the size of the note it is of', async () => {
    const note = await made()
    await expect(handlers().edit('bracket', note.id, { labels: [{ x: 900, y: 5, text: 'a' }], inked: png(800, 600) })).rejects.toThrow(/label/)
    await expect(handlers().edit('bracket', note.id, { labels: [], inked: png(400, 300) })).rejects.toThrow(/size/)
  })

  it('keeps the references it is told to keep and drops the others, and adds new ones', async () => {
    const note = await made({ references: [0, 1, 2].map((i) => ({ bytes: png(10 + i, 10), mediaType: 'image/png', comment: `r${i}` })) })
    const [first, , third] = note.references
    const edited = (await handlers().edit('bracket', note.id, { keepReferences: [2, 0], addReferences: [{ bytes: jpeg(20, 20), mediaType: 'image/jpeg', comment: 'new' }] })) as NoteMark
    expect(edited.references.map((r) => r.comment)).toEqual(['r0', 'r2', 'new'])
    expect(edited.references[0].file).toBe(first.file)
    expect(edited.references[1].file).toBe(third.file)
    expect(edited.references[2].file).toMatch(/\.jpg$/)
    // The one dropped stays on the disk until the sweep.
    expect(files()).toContain(note.references[1].file)
  })

  it('drops them all when told to keep none, and keeps them all when told nothing', async () => {
    const note = await made()
    expect(((await handlers().edit('bracket', note.id, { comment: 'x' })) as NoteMark).references).toHaveLength(1)
    expect(((await handlers().edit('bracket', note.id, { keepReferences: [] })) as NoteMark).references).toEqual([])
  })

  it('refuses more than six references, an index the note does not have, and writes nothing', async () => {
    const note = await made({ references: Array.from({ length: 5 }, () => ({ bytes: png(10, 10), mediaType: 'image/png', comment: '' })) })
    const before = files()
    const two = [0, 1].map(() => ({ bytes: png(10, 10), mediaType: 'image/png' as const, comment: '' }))
    await expect(handlers().edit('bracket', note.id, { addReferences: two })).rejects.toThrow(/references/)
    await expect(handlers().edit('bracket', note.id, { keepReferences: [5] })).rejects.toThrow(/references/)
    expect(files()).toEqual(before)
  })

  it('makes a note that was sent a draft again, told as one that was sent before', async () => {
    const note = await made()
    await store.update('bracket', note.id, { status: 'sent' })
    expect(await handlers().edit('bracket', note.id, { comment: 'again' })).toMatchObject({ status: 'draft', sentBefore: true })
  })

  it('takes no id, status, file name or anchor from the window', async () => {
    const note = await made()
    const edited = (await handlers().edit('bracket', note.id, { comment: 'x', id: 'M7', status: 'resolved', sentBefore: true, ink: 'n-0123456789ab.ink.png', picture: 'n-0123456789ab.png', references: [{ file: 'r-0123456789ab.png', comment: '' }], anchor: { point: [0, 0, 0] } } as never)) as NoteMark
    expect(edited).toMatchObject({ id: note.id, status: 'draft', picture: note.picture, ink: note.ink, references: note.references })
    expect(edited).not.toHaveProperty('sentBefore')
  })

  it('refuses what is not a note of the project: another kind of mark, an unknown id, a project not open', async () => {
    await store.add('bracket', { kind: 'pin', author: 'user', note: '', layout: 'assembly', revision: 1, camera: draft().camera, anchor: { point: [0, 0, 0] } } as never)
    await expect(handlers().edit('bracket', 'M1', { comment: 'x' })).rejects.toThrow(/not a note/)
    await expect(handlers().edit('bracket', 'M9', { comment: 'x' })).rejects.toThrow(/no note M9/)
    await expect(handlers().edit('bracket', '../M1', { comment: 'x' })).rejects.toThrow(/not a note of the project/)
    await expect(handlers().edit('nope', 'M1', { comment: 'x' })).rejects.toThrow(/not open/)
  })
})

describe('notes.picture', () => {
  it('gives the bytes of the picture with the ink, the plain picture and a reference', async () => {
    const note = await made()
    expect([...((await handlers().picture('bracket', note.id, 'ink')) as Uint8Array)]).toEqual([...png(800, 600)])
    expect([...((await handlers().picture('bracket', note.id, 'plain')) as Uint8Array)]).toEqual([...png(800, 600)])
    expect([...((await handlers().picture('bracket', note.id, 0)) as Uint8Array)]).toEqual([...jpeg(300, 200)])
  })

  it('gives null for a file that is not on this computer', async () => {
    const note = await made()
    rmSync(join(folder(), note.picture))
    rmSync(join(folder(), note.references[0].file))
    expect(await handlers().picture('bracket', note.id, 'plain')).toBeNull()
    expect(await handlers().picture('bracket', note.id, 0)).toBeNull()
    expect(await handlers().picture('bracket', note.id, 'ink')).not.toBeNull()
  })

  it('gives null for a reference the note does not have, a way of asking it does not take, and a mark that is no note', async () => {
    const note = await made()
    expect(await handlers().picture('bracket', note.id, 1)).toBeNull()
    expect(await handlers().picture('bracket', note.id, -1)).toBeNull()
    expect(await handlers().picture('bracket', note.id, 'file.png' as never)).toBeNull()
    expect(await handlers().picture('bracket', 'M9', 'ink')).toBeNull()
    expect(await handlers().picture('bracket', '../../x', 'ink')).toBeNull()
    await store.add('bracket', { kind: 'pin', author: 'user', note: '', layout: 'assembly', revision: 1, camera: draft().camera, anchor: { point: [0, 0, 0] } } as never)
    expect(await handlers().picture('bracket', 'M2', 'ink')).toBeNull()
  })

  it('refuses a project that is not open', async () => {
    await expect(handlers().picture('nope', 'M1', 'ink')).rejects.toThrow(/not open/)
  })
})

describe('what the store has to say', () => {
  it('keeps the list as the window reads it', async () => {
    await made()
    const marks: Mark[] = await store.list('bracket')
    expect(marks[0].kind).toBe('note')
  })
})
