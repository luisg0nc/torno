import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NewNote } from '../../shared/marks'
import { MarkStore } from '../marks/store'
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

describe('sweepNotes', () => {
  it('removes the pictures no note names, and nothing else', () => {
    put('.gitignore', 'n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png', 'r-cccccccccccc.jpg', 'mine.png', 'notes.txt')
    aged('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png', 'r-cccccccccccc.jpg')
    return sweepNotes(dir, new Set(['n-aaaaaaaaaaaa.png']), 60_000).then(() => {
      expect(names()).toEqual(['.gitignore', 'mine.png', 'n-aaaaaaaaaaaa.png', 'notes.txt'])
    })
  })

  it('leaves a file made in the last minute: it has no note yet', async () => {
    put('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png')
    aged('n-aaaaaaaaaaaa.png')
    await sweepNotes(dir, new Set(), 60_000)
    expect(names()).toEqual(['n-bbbbbbbbbbbb.png'])
  })

  it('does nothing when there is no folder, and nothing where a link stands in its place', async () => {
    await expect(sweepNotes(dir, new Set(), 0)).resolves.toBeUndefined()
    mkdirSync(join(dir, '.torno'))
    mkdirSync(join(dir, 'elsewhere'))
    writeFileSync(join(dir, 'elsewhere', 'n-aaaaaaaaaaaa.png'), 'x')
    symlinkSync(join(dir, 'elsewhere'), folder())
    await expect(sweepNotes(dir, new Set(), 0)).rejects.toThrow(/link/)
    expect(existsSync(join(dir, 'elsewhere', 'n-aaaaaaaaaaaa.png'))).toBe(true)
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
  it('sweeps the pictures no note names, once, when the project is first opened', async () => {
    await store.addNote('bracket', note({ references: [{ file: 'r-cccccccccccc.png', comment: '' }] }))
    put('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'r-cccccccccccc.png', 'n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png')
    aged('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'r-cccccccccccc.png', 'n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png')
    const sweep = new NoteSweep(store)
    await sweep.once('bracket', dir)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png', 'r-cccccccccccc.png'])
    // Once for each project in a run.
    put('n-dddddddddddd.png')
    aged('n-dddddddddddd.png')
    await sweep.once('bracket', dir)
    expect(names()).toContain('n-dddddddddddd.png')
    sweep.forget()
    await sweep.once('bracket', dir)
    expect(names()).not.toContain('n-dddddddddddd.png')
  })

  it('keeps the files of a note removed in this run: undo can bring it back', async () => {
    await store.addNote('bracket', note())
    await store.addNote('bracket', note({ picture: 'n-bbbbbbbbbbbb.png', ink: 'n-bbbbbbbbbbbb.ink.png' }))
    put('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png', 'n-eeeeeeeeeeee.png')
    aged('n-aaaaaaaaaaaa.png', 'n-aaaaaaaaaaaa.ink.png', 'n-bbbbbbbbbbbb.png', 'n-bbbbbbbbbbbb.ink.png', 'n-eeeeeeeeeeee.png')
    await store.remove('bracket', 'M1')
    await new NoteSweep(store).once('bracket', dir)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.ink.png', 'n-bbbbbbbbbbbb.png'])
  })

  it('leaves a picture a marks file kept aside names', async () => {
    mkdirSync(join(dir, '.torno'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'marks.json.dropped-2026'), '"n-aaaaaaaaaaaa.png"')
    put('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png')
    aged('n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.png')
    await new NoteSweep(store).once('bracket', dir)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.png'])
  })

  it('sweeps nothing of a project whose marks file could not be read that run', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'marks.json'), 'not json')
    put('n-aaaaaaaaaaaa.png')
    aged('n-aaaaaaaaaaaa.png')
    await new NoteSweep(store).once('bracket', dir)
    expect(names()).toEqual(['n-aaaaaaaaaaaa.png'])
  })

  it('never rejects: a project is no less open for a sweep that failed', async () => {
    mkdirSync(join(dir, '.torno'))
    mkdirSync(join(dir, 'elsewhere'))
    symlinkSync(join(dir, 'elsewhere'), folder())
    await expect(new NoteSweep(store).once('bracket', dir)).resolves.toBeUndefined()
  })
})
