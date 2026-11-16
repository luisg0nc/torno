import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REFUSED } from '../../shared/refusal'
import type { ObjectInfo } from '../../shared/workspace'
import { refusable } from '../refusal'
import { boardAttachOf, boardHandlers } from './ipc'
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

let root: string
let dir: string
let store: BoardStore
let pinned: Array<[string, string]>
/** The saved views of the project, as the scene file has them. */
let saved: Array<{ name: string; layout: string }>
let shown: Array<['open' | 'reveal', string]>

const obj = (): ObjectInfo => ({ id: 'bracket', name: 'bracket', dir, model: 'model.py' })
const handlers = () =>
  boardHandlers({
    board: store,
    object: (id) => (id === 'bracket' ? obj() : undefined),
    views: async () => saved as never,
    show: (how, path) => void shown.push([how, path]),
    pinBuild: async (objectId, historyId) => (pinned.push([objectId, historyId]), { refused: 'stand-in' })
  })
const text = (extra: Record<string, unknown> = {}) => ({ op: 'add' as const, card: { kind: 'text', x: 0, y: 0, w: 200, h: 100, text: 'hello', ...extra } }) as never

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-board-ipc-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  store = new BoardStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  pinned = []
  saved = [{ name: 'front', layout: 'assembly' }]
  shown = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the board handlers', () => {
  it('reads the board of an open project, and refuses one that is not open', async () => {
    expect(await handlers().read('bracket')).toEqual({ next: 1, cards: [], arrows: [] })
    await expect(handlers().read('nope')).rejects.toThrow(/not open/)
  })

  it('tells what was wrong with the board file, until the window dismisses it', async () => {
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'board', 'board.json'), '<<<<<<< HEAD')
    expect(await handlers().read('bracket')).toEqual({ next: 1, cards: [], arrows: [] })
    expect(await handlers().problem('bracket')).toMatch(/could not be read/)
    await handlers().dismissProblem('bracket')
    expect(await handlers().problem('bracket')).toBeNull()
    await expect(handlers().problem('nope')).rejects.toThrow(/not open/)
  })

  it('makes a card of the person of what the window sends, whoever it says made it', async () => {
    const board = await handlers().change('bracket', text({ by: 'agent', id: 'C99', hidden: true }))
    expect(board.cards).toHaveLength(1)
    expect(board.cards[0]).toMatchObject({ id: 'C1', by: 'person', text: 'hello' })
    expect(board.cards[0].hidden).toBeUndefined()
  })

  it('refuses a change for a project that is not open, and writes nothing', async () => {
    await expect(handlers().change('nope', text())).rejects.toThrow(/not open/)
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('refuses what is not a change, with a Refusal the window is told as one', async () => {
    const wrapped = refusable(handlers().change as (objectId: string, change: unknown) => Promise<unknown>)
    expect(await wrapped('bracket', 'remove everything')).toEqual({ [REFUSED]: expect.stringContaining('not a change') })
    expect(await wrapped('bracket', { op: 'nuke' })).toEqual({ [REFUSED]: expect.any(String) })
  })

  it('refuses a picture of 4 MB, and keeps one that is a picture', async () => {
    await expect(handlers().addPicture('bracket', new Uint8Array(4_000_000))).rejects.toThrow()
    await expect(handlers().addPicture('bracket', 'not bytes' as never)).rejects.toThrow()
    const name = await handlers().addPicture('bracket', png(64, 64))
    expect(name).toMatch(/^p-[0-9a-f]{12}\.png$/)
    expect(existsSync(join(dir, '.torno', 'board', 'pictures', name))).toBe(true)
  })

  it('gives the text of brief.md, null when there is none, and a project that is not open is refused', async () => {
    expect(await handlers().brief('bracket')).toBeNull()
    writeFileSync(join(dir, 'brief.md'), '# A latch\n\nHolds the lid shut.\n')
    expect(await handlers().brief('bracket')).toBe('# A latch\n\nHolds the lid shut.\n')
    await expect(handlers().brief('nope')).rejects.toThrow(/not open/)
  })

  it('gives a photo of reference/ by the name main gives it, and nothing else of the project', async () => {
    mkdirSync(join(dir, 'reference'))
    writeFileSync(join(dir, 'reference', 'photo-1.png'), png(8, 8))
    writeFileSync(join(dir, 'reference', 'notes.txt'), 'private')
    const got = await handlers().reference('bracket', 'reference/photo-1.png')
    expect(got?.mediaType).toBe('image/png')
    expect(Array.from(got?.bytes ?? [])).toEqual(Array.from(png(8, 8)))
    expect(await handlers().reference('bracket', 'reference/notes.txt')).toBeNull()
    expect(await handlers().reference('bracket', '../bracket.py')).toBeNull()
    expect(await handlers().reference('bracket', 'reference/photo-9.png')).toBeNull()
    await expect(handlers().reference('nope', 'reference/photo-1.png')).rejects.toThrow(/not open/)
  })

  it('gives the bytes of a picture, null for one that is not there or has no picture name', async () => {
    const name = await savePicture(dir, png(64, 64))
    expect(Array.from((await handlers().picture('bracket', name)) as Uint8Array)).toEqual(Array.from(png(64, 64)))
    expect(await handlers().picture('bracket', 'p-000000000000.png')).toBeNull()
    expect(await handlers().picture('bracket', '../../etc/passwd')).toBeNull()
    await expect(handlers().picture('nope', name)).rejects.toThrow(/not open/)
  })

  it('pins a build through the history, and the others on the board', async () => {
    const h = handlers()
    expect(await h.pin('bracket', { kind: 'build', id: 'h4' })).toEqual({ refused: 'stand-in' })
    expect(pinned).toEqual([['bracket', 'h4']])
    const board = await h.pin('bracket', { kind: 'params' })
    expect('refused' in board).toBe(false)
    expect((board as { cards: Array<{ kind: string; by: string }> }).cards).toEqual([expect.objectContaining({ kind: 'params', by: 'person' })])
    expect(await h.pin('bracket', { kind: 'params' })).toEqual({ refused: expect.stringContaining('already') })
    expect('refused' in (await h.pin('bracket', { kind: 'view', name: 'front' }))).toBe(false)
    expect('refused' in (await h.pin('bracket', { kind: 'checks' }))).toBe(false)
    expect(await store.read('bracket')).toMatchObject({ cards: [{ kind: 'params' }, { kind: 'view', source: 'front', layout: 'assembly' }, { kind: 'checks' }] })
  })

  it('refuses to pin a view that is not among the saved views, and writes nothing', async () => {
    expect(await handlers().pin('bracket', { kind: 'view', name: 'back' })).toEqual({ refused: expect.stringContaining('back') })
    saved = []
    expect(await handlers().pin('bracket', { kind: 'view', name: 'front' })).toEqual({ refused: expect.stringContaining('front') })
    expect(await store.read('bracket')).toEqual({ next: 1, cards: [], arrows: [] })
  })

  it('opens brief.md and shows a photo of reference/ in its folder, by paths of its own, and nothing else', async () => {
    const h = handlers()
    await expect(h.open('bracket', { kind: 'brief' })).rejects.toThrow(/no brief/)
    writeFileSync(join(dir, 'brief.md'), '# A latch\n')
    await h.open('bracket', { kind: 'brief' })
    mkdirSync(join(dir, 'reference'))
    writeFileSync(join(dir, 'reference', 'photo-1.png'), png(8, 8))
    writeFileSync(join(dir, 'reference', 'photo-2.png'), png(8, 8))
    await h.open('bracket', { kind: 'reference', file: 'reference/photo-1.png' })
    expect(shown).toEqual([
      ['open', join(dir, 'brief.md')],
      ['reveal', join(dir, 'reference', 'photo-1.png')]
    ])
    for (const file of ['../x', 'reference/../brief.md', 'reference/nothing.png', 'brief.md', 7]) await expect(h.open('bracket', { kind: 'reference', file } as never)).rejects.toThrow()
    await expect(h.open('bracket', { kind: 'secret' } as never)).rejects.toThrow()
    await expect(h.open('nope', { kind: 'brief' })).rejects.toThrow(/not open/)
    expect(shown).toHaveLength(2)
  })

  it('refuses a pin of something the board does not pin, as a value', async () => {
    expect(await handlers().pin('bracket', { kind: 'mark' } as never)).toEqual({ refused: expect.any(String) })
    expect(await handlers().pin('bracket', null as never)).toEqual({ refused: expect.any(String) })
    expect(await handlers().pin('bracket', { kind: 'view', name: 7 } as never)).toEqual({ refused: expect.any(String) })
    expect(await handlers().pin('nope', { kind: 'params' })).toEqual({ refused: expect.stringContaining('not open') })
  })
})

describe('what goes with a prompt', () => {
  it('takes ids of cards, or all, and nothing else', () => {
    expect(boardAttachOf({ ids: ['C3', 'C3', 'C12'] })).toEqual({ ids: ['C3', 'C12'] })
    expect(boardAttachOf({ ids: 'all' })).toEqual({ ids: 'all' })
    expect(boardAttachOf({ ids: [] })).toEqual({ ids: [] })
    for (const bad of [null, 'all', {}, { ids: 'some' }, { ids: ['C0'] }, { ids: ['../x'] }, { ids: [3] }, { ids: Array.from({ length: 2001 }, (_, i) => `C${i + 1}`) }]) expect(boardAttachOf(bad)).toEqual(expect.any(String))
  })
})
