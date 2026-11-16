import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PICTURE_NAME } from '../../shared/board'
import { utimesSync } from 'node:fs'
import { namedAside, PictureSweep, readPicture, savePicture, sweepPictures } from './pictures'
import { BoardStore } from './store'

/** A PNG header with this size: all the header check reads. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}
function jpg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  // SOI, then an APP0 of 16 bytes, then a start of frame (8-bit): height, width.
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0, 16], 0)
  bytes.set([0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0], 20)
  return bytes
}

let dir: string
const folder = (): string => join(dir, '.torno', 'board', 'pictures')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-board-pictures-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('savePicture', () => {
  it('refuses what is not a picture, and writes nothing', async () => {
    await expect(savePicture(dir, new TextEncoder().encode('not a picture at all, just words of some length'))).rejects.toThrow(/PNG or JPEG/)
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('refuses a picture past 2000 px', async () => {
    await expect(savePicture(dir, png(2001, 10))).rejects.toThrow(/PNG or JPEG/)
  })

  it('names a PNG p-<12 hex>.png, keeps its bytes, and ignores the folder for git', async () => {
    const bytes = png(300, 200)
    const name = await savePicture(dir, bytes)
    expect(name).toMatch(PICTURE_NAME)
    expect(name.endsWith('.png')).toBe(true)
    expect(new Uint8Array(readFileSync(join(folder(), name)))).toEqual(bytes)
    expect(readFileSync(join(folder(), '.gitignore'), 'utf8')).toBe('*\n')
    expect(readdirSync(folder()).sort()).toEqual(['.gitignore', name])
  })

  it('names a JPEG .jpg, each picture its own name, and leaves the person’s .gitignore alone', async () => {
    const first = await savePicture(dir, jpg(100, 100))
    writeFileSync(join(folder(), '.gitignore'), '*\n!keep.png\n')
    const second = await savePicture(dir, jpg(100, 100))
    expect(first.endsWith('.jpg')).toBe(true)
    expect(second).not.toBe(first)
    expect(readFileSync(join(folder(), '.gitignore'), 'utf8')).toBe('*\n!keep.png\n')
  })

  it('writes nothing through a link in the place of the folder', async () => {
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    mkdirSync(join(dir, 'elsewhere'))
    symlinkSync(join(dir, 'elsewhere'), folder())
    await expect(savePicture(dir, png(10, 10))).rejects.toThrow(/link/)
    expect(readdirSync(join(dir, 'elsewhere'))).toEqual([])
  })
})

describe('readPicture', () => {
  it('gives the bytes of a saved picture, and null for one that is not there or a name that is not a picture’s', async () => {
    const bytes = png(30, 20)
    const name = await savePicture(dir, bytes)
    expect(await readPicture(dir, name)).toEqual(bytes)
    expect(await readPicture(dir, 'p-000000000000.png')).toBeNull()
    expect(await readPicture(dir, '../board.json')).toBeNull()
    expect(await readPicture(dir, '.gitignore')).toBeNull()
  })

  it('does not follow a link planted as a picture', async () => {
    await savePicture(dir, png(30, 20))
    writeFileSync(join(dir, 'secret.png'), png(30, 20))
    symlinkSync(join(dir, 'secret.png'), join(folder(), 'p-aaaaaaaaaaaa.png'))
    expect(await readPicture(dir, 'p-aaaaaaaaaaaa.png')).toBeNull()
  })
})

describe('sweepPictures', () => {
  it('removes the pictures no card names and nothing else', async () => {
    const keep = await savePicture(dir, png(30, 20))
    const lose = await savePicture(dir, png(31, 20))
    writeFileSync(join(folder(), 'notes.txt'), 'the person’s')
    await sweepPictures(dir, new Set([keep]))
    expect(readdirSync(folder()).sort()).toEqual(['.gitignore', keep, 'notes.txt'].sort())
    expect(existsSync(join(folder(), lose))).toBe(false)
  })

  it('does nothing for a project with no board folder', async () => {
    await sweepPictures(dir, new Set())
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })
})

describe('sweepPictures with a grace', () => {
  it('leaves a file made a moment ago: a picture kept just now has no card yet', async () => {
    const fresh = await savePicture(dir, png(30, 20))
    const old = await savePicture(dir, png(31, 20))
    const long = new Date(Date.now() - 3_600_000)
    utimesSync(join(folder(), old), long, long)
    await sweepPictures(dir, new Set(), 60_000)
    expect(existsSync(join(folder(), fresh))).toBe(true)
    expect(existsSync(join(folder(), old))).toBe(false)
  })
})

describe('PictureSweep', () => {
  const longAgo = (name: string): void => {
    const long = new Date(Date.now() - 3_600_000)
    utimesSync(join(folder(), name), long, long)
  }
  const storeOf = (): BoardStore => new BoardStore({ dirOf: () => dir })
  /** A picture kept long ago, as a picture card names it. */
  const kept = async (): Promise<string> => {
    const name = await savePicture(dir, png(30 + Math.floor(Math.random() * 50), 20))
    longAgo(name)
    return name
  }
  const card = (store: BoardStore, picture: string) => store.person('bracket', { op: 'add', card: { kind: 'picture', x: 0, y: 0, w: 10, h: 10, picture } })
  const aside = (name: string, text: string): void => writeFileSync(join(dir, '.torno', 'board', name), text)

  it('removes the pictures no card names, once for a project in a run, and again after forget', async () => {
    const keep = await kept()
    const lose = await kept()
    const store = storeOf()
    await card(store, keep)
    const sweep = new PictureSweep(store)
    await sweep.once('bracket', dir)
    expect(readdirSync(folder()).sort()).toEqual(['.gitignore', keep].sort())
    const later = await kept()
    await sweep.once('bracket', dir)
    expect(existsSync(join(folder(), later))).toBe(true)
    sweep.forget()
    await sweep.once('bracket', dir)
    expect(existsSync(join(folder(), later))).toBe(false)
    expect(existsSync(join(folder(), lose))).toBe(false)
  })

  it('sweeps nothing of a board that could not be read whole, that run', async () => {
    const name = await kept()
    writeFileSync(join(dir, '.torno', 'board', 'board.json'), '<<<<<<< HEAD')
    await new PictureSweep(storeOf()).once('bracket', dir)
    expect(existsSync(join(folder(), name))).toBe(true)
  })

  it('keeps, on the next launch, the pictures a file kept aside names: the new board is empty and reads cleanly', async () => {
    const mine = await kept()
    const other = await kept()
    const board = JSON.stringify({ next: 3, cards: [{ id: 'C1', kind: 'picture', x: 0, y: 0, w: 10, h: 10, by: 'person', picture: mine }, { id: 'bad' }], arrows: [] })
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'board', 'board.json'), `<<<<<<< HEAD\n${board}\n>>>>>>> other`)
    // First run: the file cannot be read, a new board is started, nothing is swept.
    const first = storeOf()
    await new PictureSweep(first).once('bracket', dir)
    expect(existsSync(join(folder(), mine))).toBe(true)
    expect(readdirSync(join(dir, '.torno', 'board')).some((n) => n.startsWith('board.json.corrupt-'))).toBe(true)
    // Second run: the board is empty and fine.
    const second = storeOf()
    expect((await second.read('bracket')).cards).toEqual([])
    await new PictureSweep(second).once('bracket', dir)
    expect(existsSync(join(folder(), mine))).toBe(true)
    expect(existsSync(join(folder(), other))).toBe(false)
  })

  it('keeps what a dropped- file names too, and still sweeps what no file names', async () => {
    const left = await kept()
    const stray = await kept()
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    aside('board.json.dropped-2026-11-16T10-00-00-000Z', JSON.stringify({ cards: [{ picture: left }] }))
    await new PictureSweep(storeOf()).once('bracket', dir)
    expect(existsSync(join(folder(), left))).toBe(true)
    expect(existsSync(join(folder(), stray))).toBe(false)
  })

  it('does not follow a link planted as a file kept aside', async () => {
    const name = await kept()
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    writeFileSync(join(dir, 'elsewhere.txt'), name)
    symlinkSync(join(dir, 'elsewhere.txt'), join(dir, '.torno', 'board', 'board.json.corrupt-link'))
    expect(await namedAside(dir)).toEqual(new Set())
    await new PictureSweep(storeOf()).once('bracket', dir)
    expect(existsSync(join(folder(), name))).toBe(false)
  })

  it('reads only the start of a file kept aside', async () => {
    const early = 'p-aaaaaaaaaaaa.png'
    const late = 'p-bbbbbbbbbbbb.png'
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    aside('board.json.corrupt-big', `${early} ${' '.repeat(9_000_000)} ${late}`)
    expect(await namedAside(dir)).toEqual(new Set([early]))
  })

  it('counts a card taken off the board in this run as named: undo brings it back with its file', async () => {
    const name = await kept()
    const store = storeOf()
    await card(store, name)
    await store.person('bracket', { op: 'remove', ids: ['C1'] })
    await new PictureSweep(store).once('bracket', dir)
    expect(existsSync(join(folder(), name))).toBe(true)
    expect((await store.person('bracket', { op: 'restore', ids: ['C1'] })).cards[0].picture).toBe(name)
  })

  it('never rejects: a project is no less open for a sweep that failed', async () => {
    const sweep = new PictureSweep({ withPictures: () => Promise.reject(new Error('no')) })
    await expect(sweep.once('bracket', dir)).resolves.toBeUndefined()
  })
})
