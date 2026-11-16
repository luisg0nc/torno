import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ATTACHMENT_HEAD, BOARD_PICTURE_EDGE } from '../../shared/board'
import { attachBoard } from './attach'
import { savePicture } from './pictures'
import { BoardStore } from './store'

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
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0, 16], 0)
  bytes.set([0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0], 20)
  return bytes
}

/** A photo in `reference/` and the card main gives it. */
async function withReference(name = 'photo-1.jpg', bytes: Uint8Array = jpg(640, 480)): Promise<string> {
  mkdirSync(join(dir, 'reference'), { recursive: true })
  writeFileSync(join(dir, 'reference', name), bytes)
  const board = await store.torno('bracket', (b) => ({ ...b, next: b.next + 1, cards: [...b.cards, { id: `C${b.next}`, kind: 'reference', x: 0, y: 0, w: 240, h: 180, by: 'torno', source: `reference/${name}` }] }))
  return board.cards.at(-1)!.id
}

let root: string
let dir: string
let store: BoardStore
let scaled: number[]

const deps = () => ({
  board: { read: (id: string) => store.read(id), live: async () => ({ marks: new Map() }) },
  dirOf: (id: string) => (id === 'bracket' ? dir : undefined),
  scale: async (bytes: Uint8Array, edge: number) => (scaled.push(edge), bytes)
})

const add = async (card: Record<string, unknown>): Promise<string> => {
  const board = await store.person('bracket', { op: 'add', card: { x: 0, y: 0, w: 200, h: 100, ...card } as never })
  return board.cards.at(-1)!.id
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-board-attach-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  store = new BoardStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  scaled = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('attaching part of the board to a prompt', () => {
  it('tells a frame and its cards, and sends the picture of a picture card scaled to 1280', async () => {
    const frame = await add({ kind: 'frame', name: 'Latch', w: 800, h: 500 })
    const note = await add({ kind: 'text', text: 'wall 2 mm', frame, x: 20, y: 40 })
    const photo = await add({ kind: 'picture', picture: await savePicture(dir, png(640, 480)), caption: 'the old latch', frame, x: 300, y: 40 })
    await add({ kind: 'text', text: 'not attached', x: 3000, y: 3000 })
    await store.person('bracket', { op: 'arrow', from: note, to: photo, label: 'like this' })
    const out = await attachBoard(deps(), 'bracket', [frame])
    expect(out.text.startsWith(ATTACHMENT_HEAD)).toBe(true)
    expect(out.text).toContain('wall 2 mm')
    expect(out.text).toContain(`[picture ${photo}: the old latch]`)
    expect(out.text).toContain(`${note} → ${photo}: like this`)
    expect(out.text).not.toContain('not attached')
    expect(out.pictures).toHaveLength(1)
    expect(out.pictures[0].mediaType).toBe('image/png')
    expect(scaled).toEqual([BOARD_PICTURE_EDGE])
    expect(out.sent).toEqual({ cards: 2, arrows: 1, frames: ['Latch'] })
  })

  it('sends a photo of reference/ as a picture, scaled, and counts it among the six', async () => {
    const photo = await withReference()
    for (let i = 0; i < 6; i += 1) await add({ kind: 'picture', picture: await savePicture(dir, png(100 + i, 100)), x: 300 + i * 300 })
    const out = await attachBoard(deps(), 'bracket', 'all')
    expect(out.pictures).toHaveLength(6)
    expect(out.pictures[0].mediaType).toBe('image/jpeg')
    expect(out.text).toContain(`[picture ${photo}: of reference/photo-1.jpg]`)
    expect(out.text).toContain('not attached, read it with board')
  })

  it('says a photo of reference/ that is gone from the folder is not on this computer', async () => {
    const photo = await withReference()
    rmSync(join(dir, 'reference', 'photo-1.jpg'))
    const out = await attachBoard(deps(), 'bracket', [photo])
    expect(out.pictures).toEqual([])
    expect(out.text).toContain('picture not on this computer')
  })

  it('names a picture that is still too big once scaled, and sends nothing for it', async () => {
    const photo = await add({ kind: 'picture', picture: await savePicture(dir, png(64, 64)) })
    const out = await attachBoard({ ...deps(), scale: async () => new Uint8Array(4_000_000).fill(1) }, 'bracket', [photo])
    expect(out.pictures).toEqual([])
    expect(out.text).toContain(`${photo}: the picture cannot be sent`)
  })

  it('names an id that is gone and leaves it out', async () => {
    const note = await add({ kind: 'text', text: 'wall 2 mm' })
    const out = await attachBoard(deps(), 'bracket', [note, 'C9'])
    expect(out.text).toContain('wall 2 mm')
    expect(out.text).toContain('C9 was removed from the board')
    expect(out.sent).toEqual({ cards: 1, arrows: 0, frames: [], gone: ['C9'] })
  })

  it('says so when nothing that was attached is on the board any more', async () => {
    const out = await attachBoard(deps(), 'bracket', ['C9', 'C10'])
    expect(out.text).toContain('C9, C10 were removed from the board')
    expect(out.pictures).toEqual([])
    expect(out.sent).toEqual({ cards: 0, arrows: 0, frames: [], gone: ['C9', 'C10'] })
  })

  it('takes a card that is hidden for one that is gone', async () => {
    await store.torno('bracket', (b) => ({ ...b, next: 2, cards: [{ id: 'C1', kind: 'brief', x: 0, y: 0, w: 300, h: 200, by: 'torno', source: 'brief', hidden: true }] }))
    const out = await attachBoard(deps(), 'bracket', ['C1'])
    expect(out.sent.gone).toEqual(['C1'])
  })

  it('sends the whole board for all, and at most six pictures, naming the rest', async () => {
    for (let i = 0; i < 8; i += 1) await add({ kind: 'picture', picture: await savePicture(dir, png(100 + i, 100)), caption: `pic ${i}`, x: i * 300 })
    const out = await attachBoard(deps(), 'bracket', 'all')
    expect(out.pictures).toHaveLength(6)
    expect(out.text).toContain('not attached, read it with board')
    expect(out.sent.cards).toBe(8)
    expect(out.sent.gone).toBeUndefined()
  })

  it('names a picture that is not on this computer and sends no picture for it', async () => {
    const file = await savePicture(dir, png(64, 64))
    const photo = await add({ kind: 'picture', picture: file })
    rmSync(join(dir, '.torno', 'board', 'pictures', file))
    const out = await attachBoard(deps(), 'bracket', [photo])
    expect(out.pictures).toEqual([])
    expect(out.text).toContain('picture not on this computer')
  })

  it('sends a picture as it is kept when a scale fails, and says so', async () => {
    const photo = await add({ kind: 'picture', picture: await savePicture(dir, png(64, 64)) })
    const out = await attachBoard({ ...deps(), scale: async () => { throw new Error('no image') } }, 'bracket', [photo])
    expect(out.pictures).toEqual([])
    expect(out.text).toContain(`${photo}: no image`)
  })

  it('counts the head and the notes in the 12 000, and does not list a long run of removed ids in full', async () => {
    for (let i = 0; i < 4; i += 1) await add({ kind: 'text', text: 'x'.repeat(3_400), y: i * 400 })
    const ids = Array.from({ length: 300 }, (_, i) => `C${i + 500}`)
    const out = await attachBoard(deps(), 'bracket', ids.concat(['C1', 'C2', 'C3', 'C4']))
    expect(out.text.length).toBeLessThanOrEqual(12_000)
    expect(out.text).toContain('and 290 more were removed')
    expect(out.text).toContain('The rest of the board is cut here')
    expect(out.sent.gone).toHaveLength(300)
  })

  it('cuts at 12 000 characters with the sentence', async () => {
    for (let i = 0; i < 4; i += 1) await add({ kind: 'text', text: 'x'.repeat(3_400), y: i * 400 })
    const out = await attachBoard(deps(), 'bracket', 'all')
    expect(out.text.length).toBeLessThanOrEqual(12_000)
    expect(out.text).toContain('The rest of the board is cut here: read it with board.')
  })
})
