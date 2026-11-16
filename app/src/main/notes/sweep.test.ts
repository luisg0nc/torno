import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NewNote } from '../../shared/marks'
import { droppedNames } from '../dropped'
import { MarkStore } from '../marks/store'
import { dropNoteFiles } from './dropped'
import { isNoteFile } from './files'
import { NoteSweep, namedAside, sweepNotes } from './sweep'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const note = (over: object = {}): NewNote =>
  ({
    author: 'user',
    note: 'thin',
    layout: 'assembly',
    revision: 1,
    camera: CAMERA,
    kind: 'note',
    picture: 'n-aaaaaaaaaaaa.png',
    ink: 'n-aaaaaaaaaaaa.ink.png',
    size: { w: 800, h: 600 },
    strokes: [],
    inkColour: '#ff00ff',
    labels: [],
    under: [],
    references: [],
    ...over
  }) as unknown as NewNote

let dir: string
let store: MarkStore
const folder = (): string => join(dir, '.torno', 'notes')
const names = (): string[] => readdirSync(folder()).sort()
const put = (...files: string[]): void => {
  mkdirSync(folder(), { recursive: true })
  for (const file of files) writeFileSync(join(folder(), file), 'x')
}
/** Made long ago: past the time a new file is left alone. */
const aged = (...files: string[]): void => {
  const long = new Date(Date.now() - 3_600_000)
  for (const file of files) utimesSync(join(folder(), file), long, long)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-notes-sweep-'))
  store = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const none = { live: new Set<string>(), kept: new Set<string>() }
const listed = (): Promise<string[]> => droppedNames(dir, ['notes'], isNoteFile).then((n) => n.sort())

describe('sweepNotes', () => {
  it('removes the pictures torno dropped that no note holds, and nothing else', async () => {
    put('.gitignore', 'n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png', 'r-cccccccccccc.jpg', 'mine.png', 'notes.txt')
    aged('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png', 'r-cccccccccccc.jpg')
    await dropNoteFiles(dir, ['n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png', 'r-cccccccccccc.jpg', 'mine.png'])
    await sweepNotes(dir, none, 60_000)
    expect(names()).toEqual(['.gitignore', 'mine.png', 'n-aaaaaaaaaaaa.png', 'notes.txt'])
    // What was taken is off the list; with nothing on it, there is no list.
    expect(await listed()).toEqual([])
  })

  it('never removes a file that is not on the list, whatever no note names: another branch has other notes', async () => {
    put('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'r-cccccccccccc.jpg')
    aged('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'r-cccccccccccc.jpg')
    await sweepNotes(dir, none, 60_000)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png', 'r-cccccccccccc.jpg'])
    // Nor one listed beside it.
    await dropNoteFiles(dir, ['r-cccccccccccc.jpg'])
    await sweepNotes(dir, none, 60_000)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png'])
  })

  it('leaves a listed file changed in the last minute, and keeps it listed for the next run', async () => {
    put('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png')
    aged('n-aaaaaaaaaaaa.png')
    await dropNoteFiles(dir, ['n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png'])
    await sweepNotes(dir, none, 60_000)
    expect(names()).toEqual(['dropped.json', 'n-bbbbbbbbbbbb.png'])
    expect(await listed()).toEqual(['n-bbbbbbbbbbbb.png'])
  })

  it('takes a listed name off the list, and leaves the file, when a note holds it again (an undo brought it back)', async () => {
    put('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png')
    aged('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png')
    await dropNoteFiles(dir, ['n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png'])
    await sweepNotes(dir, { live: new Set(['n-aaaaaaaaaaaa.png']), kept: new Set() }, 60_000)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.png'])
    expect(await listed()).toEqual([])
    // And once it is dropped again it is listed again: a file taken off the list is a file like any other.
    await dropNoteFiles(dir, ['n-aaaaaaaaaaaa.png'])
    expect(await listed()).toEqual(['n-aaaaaaaaaaaa.png'])
  })

  it('keeps a listed file that something removed in this run may bring back, and keeps it listed', async () => {
    put('n-aaaaaaaaaaaa.png')
    aged('n-aaaaaaaaaaaa.png')
    await dropNoteFiles(dir, ['n-aaaaaaaaaaaa.png'])
    await sweepNotes(dir, { live: new Set(), kept: new Set(['n-aaaaaaaaaaaa.png']) }, 60_000)
    expect(names()).toEqual(['dropped.json', 'n-aaaaaaaaaaaa.png'])
    expect(await listed()).toEqual(['n-aaaaaaaaaaaa.png'])
  })

  it('takes a name off the list whose file is gone, and reads a list that is not one as empty', async () => {
    put('n-bbbbbbbbbbbb.png')
    aged('n-bbbbbbbbbbbb.png')
    await dropNoteFiles(dir, ['n-aaaaaaaaaaaa.png'])
    await sweepNotes(dir, none, 60_000)
    expect(await listed()).toEqual([])
    writeFileSync(join(folder(), 'dropped.json'), 'not json')
    await sweepNotes(dir, none, 0)
    writeFileSync(join(folder(), 'dropped.json'), '{"dropped":"n-bbbbbbbbbbbb.png"}')
    await sweepNotes(dir, none, 0)
    writeFileSync(join(folder(), 'dropped.json'), '{"dropped":["../n-bbbbbbbbbbbb.png",3,"notes.txt"]}')
    await sweepNotes(dir, none, 0)
    expect(names()).toContain('n-bbbbbbbbbbbb.png')
  })

  it('does nothing when there is no folder, and nothing where a link stands in its place', async () => {
    await expect(sweepNotes(dir, none, 0)).resolves.toBeUndefined()
    mkdirSync(join(dir, '.torno'))
    mkdirSync(join(dir, 'elsewhere'))
    writeFileSync(join(dir, 'elsewhere', 'n-aaaaaaaaaaaa.png'), 'x')
    writeFileSync(join(dir, 'elsewhere', 'dropped.json'), '{"dropped":["n-aaaaaaaaaaaa.png"]}')
    symlinkSync(join(dir, 'elsewhere'), folder())
    await expect(sweepNotes(dir, none, 0)).rejects.toThrow(/link/)
    expect(existsSync(join(dir, 'elsewhere', 'n-aaaaaaaaaaaa.png'))).toBe(true)
  })

  it('does not follow a link in the place of the list', async () => {
    put('n-aaaaaaaaaaaa.png')
    aged('n-aaaaaaaaaaaa.png')
    writeFileSync(join(dir, 'else.json'), '{"dropped":["n-aaaaaaaaaaaa.png"]}')
    symlinkSync(join(dir, 'else.json'), join(folder(), 'dropped.json'))
    await sweepNotes(dir, none, 0)
    expect(names()).toContain('n-aaaaaaaaaaaa.png')
  })
})

describe('namedAside', () => {
  it('finds the pictures a marks file kept aside names', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'marks.json.corrupt-2026'), '{ "picture": "n-aaaaaaaaaaaa.png", "ink": "n-aaaaaaaaaaaa.ink.png", "file": "r-bbbbbbbbbbbb.jpg"')
    writeFileSync(join(dir, '.torno', 'marks.json.dropped-2026'), '"n-cccccccccccc.png"')
    writeFileSync(join(dir, '.torno', 'marks.json'), '"n-dddddddddddd.png"')
    expect([...(await namedAside(dir))].sort()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png', 'n-cccccccccccc.png', 'r-bbbbbbbbbbbb.jpg'])
  })

  it('finds nothing without a folder', async () => {
    expect([...(await namedAside(dir))]).toEqual([])
  })
})

describe('NoteSweep', () => {
  /** A project as the next run finds it: the removals and edits of the one before are on the disk, and in no memory. */
  const nextRun = (): MarkStore => new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })

  it('sweeps the pictures torno dropped in an earlier run, once, when the project is first opened', async () => {
    await store.addNote('bracket', note({ references: [{ file: 'r-cccccccccccc.png', comment: '' }] }))
    put('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'r-cccccccccccc.png', 'n-bbbbbbbbbbbb.ink.png', 'n-bbbbbbbbbbbb.png')
    aged('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'r-cccccccccccc.png', 'n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png')
    // An edit replaces the ink and takes the reference away: the old ink and the reference are dropped.
    await store.editNote('bracket', 'M1', { ink: 'n-bbbbbbbbbbbb.ink.png', references: [] })
    const sweep = new NoteSweep(nextRun())
    await sweep.once('bracket', dir)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.ink.png', 'n-bbbbbbbbbbbb.png'])
    // Once for each project in a run.
    put('n-dddddddddddd.png')
    aged('n-dddddddddddd.png')
    await dropNoteFiles(dir, ['n-dddddddddddd.png'])
    await sweep.once('bracket', dir)
    expect(names()).toContain('n-dddddddddddd.png')
    sweep.forget()
    await sweep.once('bracket', dir)
    expect(names()).not.toContain('n-dddddddddddd.png')
  })

  it('keeps the files of a note removed in this run: undo can bring it back; the next run takes them', async () => {
    await store.addNote('bracket', note())
    put('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png')
    aged('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png')
    await store.remove('bracket', 'M1')
    await new NoteSweep(store).once('bracket', dir)
    expect(names()).toEqual(['dropped.json', 'n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png'])
    await new NoteSweep(nextRun()).once('bracket', dir)
    expect(names()).toEqual([])
  })

  it('never takes the files of a note that was undone, even though they were listed when it was removed', async () => {
    await store.addNote('bracket', note())
    put('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png')
    aged('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png')
    await store.remove('bracket', 'M1')
    await store.restore('bracket', 'M1')
    // The next run: the note is there, so its files come off the list and stay; then another branch has no such note.
    await new NoteSweep(nextRun()).once('bracket', dir)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png'])
    expect(await listed()).toEqual([])
    writeFileSync(join(dir, '.torno', 'marks.json'), JSON.stringify({ next: 2, marks: [] }))
    await new NoteSweep(nextRun()).once('bracket', dir)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png'])
  })

  it('never takes a picture because the marks do not name it: a branch switched to has other notes', async () => {
    mkdirSync(join(dir, '.torno'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'marks.json'), JSON.stringify({ next: 1, marks: [] }))
    put('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'r-cccccccccccc.png')
    aged('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'r-cccccccccccc.png')
    await new NoteSweep(store).once('bracket', dir)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png', 'r-cccccccccccc.png'])
  })

  it('leaves a dropped picture a marks file kept aside names', async () => {
    mkdirSync(join(dir, '.torno'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'marks.json.dropped-2026'), '"n-aaaaaaaaaaaa.png"')
    put('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png')
    aged('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png')
    await dropNoteFiles(dir, ['n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png'])
    await new NoteSweep(store).once('bracket', dir)
    expect(names()).toEqual(['dropped.json', 'n-aaaaaaaaaaaa.png'])
  })

  it('sweeps nothing of a project whose marks file could not be read that run', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'marks.json'), 'not json')
    put('n-aaaaaaaaaaaa.png')
    aged('n-aaaaaaaaaaaa.png')
    await dropNoteFiles(dir, ['n-aaaaaaaaaaaa.png'])
    await new NoteSweep(store).once('bracket', dir)
    expect(names()).toEqual(['dropped.json', 'n-aaaaaaaaaaaa.png'])
  })

  it('never rejects: a project is no less open for a sweep that failed', async () => {
    mkdirSync(join(dir, '.torno'))
    mkdirSync(join(dir, 'elsewhere'))
    symlinkSync(join(dir, 'elsewhere'), folder())
    await expect(new NoteSweep(store).once('bracket', dir)).resolves.toBeUndefined()
  })
})
