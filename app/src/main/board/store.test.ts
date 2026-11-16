import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BoardFile, type Card, MAX_TEXT_CHARS } from '../../shared/board'
import { BoardStore } from './store'
import { ensureIgnored } from '../ignored'

let root: string
let dirs: Record<string, string>
let store: BoardStore
let changes: Array<{ objectId: string; board: BoardFile }>

const onDisk = (objectId = 'bracket'): BoardFile => JSON.parse(readFileSync(join(dirs[objectId], '.torno', 'board', 'board.json'), 'utf8'))
const text = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ op: 'add' as const, card: { kind: 'text' as const, x, y, w: 200, h: 100, text: 'hello', ...extra } })
const frame = (name: string, x = 0, y = 0) => ({ op: 'add' as const, card: { kind: 'frame' as const, x, y, w: 500, h: 400, name } })
const byId = (board: BoardFile, id: string): Card => board.cards.find((c) => c.id === id) as Card

function newStore(): BoardStore {
  const s = new BoardStore({ dirOf: (id) => dirs[id] })
  s.on('changed', (e) => changes.push(e))
  return s
}

/** A board with a card of main's own on it, as Task 2 will make them. */
async function withTorno(objectId = 'bracket'): Promise<void> {
  await store.torno(objectId, (b) => ({
    ...b,
    next: b.next + 1,
    cards: [...b.cards, { id: `C${b.next}`, kind: 'brief', x: 0, y: 0, w: 300, h: 200, by: 'torno', source: 'brief' }]
  }))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-board-store-'))
  dirs = { bracket: join(root, 'bracket'), two: join(root, 'two') }
  for (const dir of Object.values(dirs)) mkdirSync(dir)
  changes = []
  store = newStore()
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('reading', () => {
  it('is an empty board for a project with none, and writes nothing', async () => {
    expect(await store.read('bracket')).toEqual({ next: 1, cards: [], arrows: [] })
    expect(changes).toEqual([])
  })

  it('rejects for a project that is not in the workspace', async () => {
    await expect(store.read('nope')).rejects.toThrow(/no project named nope/)
  })

  it('gives a copy: what the caller does to it is not the store’s', async () => {
    await store.person('bracket', text(0, 0))
    const board = await store.read('bracket')
    board.cards.length = 0
    expect((await store.read('bracket')).cards).toHaveLength(1)
  })
})

describe('adding', () => {
  it('numbers cards C1, C2, makes them the person’s, and has them on disk before it resolves', async () => {
    const board = await store.person('bracket', text(10, 20))
    expect(board.cards).toEqual([{ id: 'C1', kind: 'text', x: 10, y: 20, w: 200, h: 100, by: 'person', text: 'hello' }])
    expect(onDisk()).toEqual(board)
    const second = await store.person('bracket', text(0, 0))
    expect(second.cards.map((c) => c.id)).toEqual(['C1', 'C2'])
    expect(onDisk().next).toBe(3)
  })

  it('ignores an id, an author or hidden in the request', async () => {
    const board = await store.person('bracket', { op: 'add', card: { kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x', id: 'C99', by: 'agent', hidden: true } as never })
    expect(board.cards).toEqual([{ id: 'C1', kind: 'text', x: 0, y: 0, w: 10, h: 10, by: 'person', text: 'x' }])
    expect(board.next).toBe(2)
  })

  it('keeps of a new card only what its kind says, and nothing of main’s own fields', async () => {
    const board = await store.person('bracket', text(0, 0, { source: 'M1', layout: 'a', copy: { id: 'h1', line: '', cause: '', sources: '' }, camera: { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } }))
    expect(Object.keys(board.cards[0]).sort()).toEqual(['by', 'h', 'id', 'kind', 'text', 'w', 'x', 'y'])
  })

  it('refuses a kind that is main’s to make, a bad number, an unknown frame, a bad picture name', async () => {
    for (const card of [
      { kind: 'mark', x: 0, y: 0, w: 10, h: 10, source: 'M1' },
      { kind: 'brief', x: 0, y: 0, w: 10, h: 10 },
      { kind: 'build', x: 0, y: 0, w: 10, h: 10 },
      { kind: 'text', x: Number.NaN, y: 0, w: 10, h: 10, text: '' },
      { kind: 'text', x: 0, y: 0, w: 0, h: 10, text: '' },
      { kind: 'text', x: 0, y: 0, w: 10, h: 10, text: '', frame: 'C5' },
      { kind: 'picture', x: 0, y: 0, w: 10, h: 10, picture: '../../etc/passwd' },
      { kind: 'picture', x: 0, y: 0, w: 10, h: 10 }
    ]) {
      await expect(store.person('bracket', { op: 'add', card: card as never })).rejects.toThrow()
    }
    expect((await store.read('bracket')).cards).toEqual([])
  })

  it('refuses a text over the limit and takes one at it', async () => {
    await expect(store.person('bracket', text(0, 0, { text: 'x'.repeat(MAX_TEXT_CHARS + 1) }))).rejects.toThrow(/at most 4000/)
    expect((await store.read('bracket')).cards).toEqual([])
    const ok = await store.person('bracket', text(0, 0, { text: 'x'.repeat(MAX_TEXT_CHARS) }))
    expect(ok.cards).toHaveLength(1)
  })

  it('puts a card in a frame that is there, and refuses a frame in a frame', async () => {
    await store.person('bracket', frame('Latch'))
    const board = await store.person('bracket', text(10, 10, { frame: 'C1' }))
    expect(byId(board, 'C2').frame).toBe('C1')
    await expect(store.person('bracket', { op: 'add', card: { ...frame('Inner').card, frame: 'C1' } })).rejects.toThrow()
  })

  it('tells each change with the whole board', async () => {
    const board = await store.person('bracket', text(0, 0))
    expect(changes).toEqual([{ objectId: 'bracket', board }])
  })

  it('keeps each project’s board to itself', async () => {
    await store.person('bracket', text(0, 0))
    expect((await store.read('two')).cards).toEqual([])
  })
})

describe('one change at a time', () => {
  it('lands two changes made at once, each with its own id', async () => {
    const [a, b] = await Promise.all([store.person('bracket', text(1, 1)), store.person('bracket', text(2, 2))])
    expect(a.cards.map((c) => c.id)).toEqual(['C1'])
    expect(b.cards.map((c) => c.id)).toEqual(['C1', 'C2'])
    expect(onDisk().cards.map((c) => c.id)).toEqual(['C1', 'C2'])
  })

  it('lands one change of the person’s and one of main’s made at once', async () => {
    await Promise.all([store.person('bracket', text(1, 1)), withTorno()])
    expect(onDisk().cards.map((c) => c.id).sort()).toEqual(['C1', 'C2'])
  })

  it('goes on after a change that was refused', async () => {
    const bad = store.person('bracket', text(0, 0, { text: 'x'.repeat(MAX_TEXT_CHARS + 1) }))
    const good = store.person('bracket', text(0, 0))
    await expect(bad).rejects.toThrow()
    expect((await good).cards).toHaveLength(1)
  })

  it('reads what is on disk in a new run, and goes on from its numbers', async () => {
    await store.person('bracket', text(0, 0))
    await store.person('bracket', { op: 'remove', ids: ['C1'] })
    const again = newStore()
    expect((await again.person('bracket', text(0, 0))).cards.map((c) => c.id)).toEqual(['C2'])
  })

  it('reads the file again after forget', async () => {
    await store.person('bracket', text(0, 0))
    store.forget()
    const other = newStore()
    await other.person('bracket', text(5, 5))
    expect((await store.read('bracket')).cards).toHaveLength(2)
  })

  it('tells nothing of a change that waited out a forget', async () => {
    const wait = store.person('bracket', text(0, 0))
    store.forget()
    await wait
    expect(changes).toEqual([])
  })
})

describe('a board file changed from outside', () => {
  const file = (): string => join(dirs.bracket, '.torno', 'board', 'board.json')
  /** What a git pull would leave: the other person's board, a card more than main wrote. */
  const pulled = (): void => {
    const board = onDisk()
    board.cards.push({ id: 'C9', kind: 'text', x: 600, y: 0, w: 100, h: 50, by: 'person', text: 'from the pull' })
    board.next = 10
    writeFileSync(file(), `${JSON.stringify(board, null, 2)}\n`)
  }

  it('is taken as the base of the next change, which goes on top, and the window is told', async () => {
    await store.person('bracket', text(0, 0))
    pulled()
    changes.length = 0
    const board = await store.person('bracket', text(300, 0))
    expect(board.cards.map((c) => c.id)).toEqual(['C1', 'C9', 'C10'])
    expect(onDisk().cards.map((c) => c.id)).toEqual(['C1', 'C9', 'C10'])
    // Once for what the pull brought, once for the change.
    expect(changes.map((c) => c.board.cards.length)).toEqual([2, 3])
  })

  it('is told even when the change itself changes nothing', async () => {
    await store.person('bracket', text(0, 0))
    pulled()
    changes.length = 0
    await store.person('bracket', { op: 'unarrow', id: 'C77' })
    expect(changes.map((c) => c.board.cards.length)).toEqual([2])
  })

  it('is no reason to read the file again when it is as main left it', async () => {
    await store.person('bracket', text(0, 0))
    changes.length = 0
    await store.person('bracket', text(300, 0))
    expect(changes).toHaveLength(1)
  })

  it('is read for an agent’s change as for the person’s', async () => {
    await store.person('bracket', text(0, 0))
    pulled()
    const { board } = await store.agent('bracket', { op: 'add', text: 'plan' })
    expect(board.cards.map((c) => c.id)).toEqual(['C1', 'C9', 'C10'])
  })

  it('says what was wrong with a file that could not be read, once, and keeps saying it until dismissed', async () => {
    await store.person('bracket', text(0, 0))
    writeFileSync(file(), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n')
    const told: string[] = []
    store.on('problem', (p) => told.push(p.message))
    const board = await store.person('bracket', text(5, 5))
    expect(told).toHaveLength(1)
    expect(told[0]).toMatch(/could not be read/)
    expect(await store.problem('bracket')).toBe(told[0])
    expect(board.cards.map((c) => c.id)).toEqual(['C1'])
    await store.dismissProblem('bracket')
    expect(await store.problem('bracket')).toBeNull()
  })

  it('keeps the problem of a file that could not be read when the project is first read', async () => {
    mkdirSync(join(dirs.bracket, '.torno', 'board'), { recursive: true })
    writeFileSync(file(), 'not json')
    expect(await store.read('bracket')).toEqual({ next: 1, cards: [], arrows: [] })
    expect(await store.problem('bracket')).toMatch(/could not be read/)
    expect(await store.problem('two')).toBeNull()
  })
})

describe('told.json', () => {
  it('is ignored by git before it is written', async () => {
    await store.markTold('bracket', { C1: 'a' })
    const ignore = readFileSync(join(dirs.bracket, '.torno', '.gitignore'), 'utf8')
    expect(ignore).toContain('board/told.json')
    expect(readFileSync(join(dirs.bracket, '.torno', 'board', 'told.json'), 'utf8')).toContain('"C1"')
    await ensureIgnored(dirs.bracket, ['board/told.json'])
  })
})

describe('moving', () => {
  it('moves and resizes, and writes', async () => {
    await store.person('bracket', text(0, 0))
    const board = await store.person('bracket', { op: 'move', moves: [{ id: 'C1', x: 50, y: 60, w: 300, h: 120 }] })
    expect(byId(board, 'C1')).toMatchObject({ x: 50, y: 60, w: 300, h: 120 })
    expect(onDisk()).toEqual(board)
  })

  it('moves the cards of a frame by the same amount when the frame is moved', async () => {
    await store.person('bracket', frame('Latch', 100, 100))
    await store.person('bracket', text(120, 130, { frame: 'C1' }))
    await store.person('bracket', text(900, 900))
    const board = await store.person('bracket', { op: 'move', moves: [{ id: 'C1', x: 150, y: 90 }] })
    expect(byId(board, 'C1')).toMatchObject({ x: 150, y: 90 })
    expect(byId(board, 'C2')).toMatchObject({ x: 170, y: 120 })
    expect(byId(board, 'C3')).toMatchObject({ x: 900, y: 900 })
  })

  it('does not move the cards of a frame that is only resized, nor those moved in the same change twice', async () => {
    await store.person('bracket', frame('Latch', 100, 100))
    await store.person('bracket', text(120, 130, { frame: 'C1' }))
    const resized = await store.person('bracket', { op: 'move', moves: [{ id: 'C1', x: 100, y: 100, w: 800, h: 800 }] })
    expect(byId(resized, 'C2')).toMatchObject({ x: 120, y: 130 })
    const both = await store.person('bracket', { op: 'move', moves: [{ id: 'C1', x: 200, y: 200 }, { id: 'C2', x: 300, y: 310 }] })
    expect(byId(both, 'C2')).toMatchObject({ x: 300, y: 310 })
  })

  it('puts a card into a frame and takes it out with null', async () => {
    await store.person('bracket', frame('Latch'))
    await store.person('bracket', text(10, 10))
    const into = await store.person('bracket', { op: 'move', moves: [{ id: 'C2', x: 10, y: 10, frame: 'C1' }] })
    expect(byId(into, 'C2').frame).toBe('C1')
    const out = await store.person('bracket', { op: 'move', moves: [{ id: 'C2', x: 900, y: 10, frame: null }] })
    expect(byId(out, 'C2')).not.toHaveProperty('frame')
  })

  it('refuses a frame that is not one, a card in itself, a frame in a frame, and a size that is not positive', async () => {
    await store.person('bracket', frame('Latch'))
    await store.person('bracket', frame('Other'))
    await store.person('bracket', text(10, 10))
    for (const move of [
      { id: 'C3', x: 0, y: 0, frame: 'C3' },
      { id: 'C3', x: 0, y: 0, frame: 'C9' },
      { id: 'C2', x: 0, y: 0, frame: 'C1' },
      { id: 'C3', x: 0, y: 0, w: 0 },
      { id: 'C3', x: Number.NaN, y: 0 }
    ]) {
      await expect(store.person('bracket', { op: 'move', moves: [move] })).rejects.toThrow()
    }
  })

  it('leaves out a card that is gone, and writes nothing when nothing changed', async () => {
    await store.person('bracket', text(0, 0))
    changes.length = 0
    const board = await store.person('bracket', { op: 'move', moves: [{ id: 'C7', x: 1, y: 1 }, { id: 'C1', x: 0, y: 0 }] })
    expect(board.cards[0]).toMatchObject({ x: 0, y: 0 })
    expect(changes).toEqual([])
  })
})

describe('editing', () => {
  it('changes the text of a text card, the name of a frame, the caption of a picture', async () => {
    await store.person('bracket', text(0, 0))
    await store.person('bracket', frame('Latch'))
    const board = await store.person('bracket', { op: 'edit', id: 'C1', text: 'new' })
    expect(byId(board, 'C1').text).toBe('new')
    const named = await store.person('bracket', { op: 'edit', id: 'C2', name: 'Snorkel' })
    expect(byId(named, 'C2').name).toBe('Snorkel')
  })

  it('gives a sketch card a new drawing (a file torno kept), and no other card', async () => {
    await store.person('bracket', { op: 'add', card: { kind: 'sketch', x: 0, y: 0, w: 300, h: 200, picture: 'p-aaaaaaaaaaaa.png' } })
    await store.person('bracket', text(400, 0))
    const board = await store.person('bracket', { op: 'edit', id: 'C1', picture: 'p-bbbbbbbbbbbb.png' })
    expect(byId(board, 'C1').picture).toBe('p-bbbbbbbbbbbb.png')
    await expect(store.person('bracket', { op: 'edit', id: 'C1', picture: '../../x.png' })).rejects.toThrow(/picture/)
    await expect(store.person('bracket', { op: 'edit', id: 'C2', picture: 'p-bbbbbbbbbbbb.png' })).rejects.toThrow(/sketch/)
    expect(byId(await store.read('bracket'), 'C1').picture).toBe('p-bbbbbbbbbbbb.png')
  })

  it('refuses a text over the limit and a card that is not the person’s', async () => {
    await store.person('bracket', text(0, 0))
    await expect(store.person('bracket', { op: 'edit', id: 'C1', text: 'x'.repeat(MAX_TEXT_CHARS + 1) })).rejects.toThrow()
    await withTorno()
    await expect(store.person('bracket', { op: 'edit', id: 'C2', text: 'mine now' })).rejects.toThrow(/person/)
    await expect(store.person('bracket', { op: 'edit', id: 'C9', text: 'x' })).rejects.toThrow()
    expect(byId(await store.read('bracket'), 'C1').text).toBe('hello')
  })
})

describe('removing', () => {
  it('hides a card of main’s own and keeps it, and its arrows', async () => {
    await withTorno()
    await store.person('bracket', text(400, 0))
    await store.person('bracket', { op: 'arrow', from: 'C1', to: 'C2' })
    const board = await store.person('bracket', { op: 'remove', ids: ['C1'] })
    expect(byId(board, 'C1')).toMatchObject({ by: 'torno', hidden: true })
    expect(board.arrows).toHaveLength(1)
    expect(onDisk()).toEqual(board)
  })

  it('deletes a card of the person’s or the agent’s, and the arrows that touch it, and takes a frame’s cards out of it', async () => {
    await store.person('bracket', frame('Latch'))
    await store.person('bracket', text(10, 10, { frame: 'C1' }))
    await store.person('bracket', text(900, 0))
    await store.person('bracket', { op: 'arrow', from: 'C2', to: 'C3' })
    await store.person('bracket', { op: 'arrow', from: 'C1', to: 'C3' })
    await store.person('bracket', { op: 'arrow', from: 'C2', to: 'C1' })
    const board = await store.person('bracket', { op: 'remove', ids: ['C1'] })
    expect(board.cards.map((c) => c.id)).toEqual(['C2', 'C3'])
    expect(byId(board, 'C2')).not.toHaveProperty('frame')
    expect(board.arrows).toEqual([{ id: 'C4', from: 'C2', to: 'C3', by: 'person' }])
  })

  it('deletes a card of the agent’s, as the person may', async () => {
    // The agent's way in is Task 4's: here main's own turn puts one on the board.
    await store.torno('bracket', (b) => ({ ...b, next: 2, cards: [{ id: 'C1', kind: 'text', x: 0, y: 0, w: 10, h: 10, by: 'agent', text: 'plan' }] }))
    expect((await store.person('bracket', { op: 'remove', ids: ['C1'] })).cards).toEqual([])
  })

  it('never reuses an id', async () => {
    await store.person('bracket', text(0, 0))
    await store.person('bracket', { op: 'remove', ids: ['C1'] })
    expect((await store.person('bracket', text(0, 0))).cards.map((c) => c.id)).toEqual(['C2'])
  })

  it('brings a hidden card back with unhide', async () => {
    await withTorno()
    await store.person('bracket', { op: 'remove', ids: ['C1'] })
    const board = await store.person('bracket', { op: 'unhide', id: 'C1' })
    expect(byId(board, 'C1')).not.toHaveProperty('hidden')
  })
})

describe('arrows', () => {
  it('draws one from a card to another with a word, by the person, with the next id', async () => {
    await store.person('bracket', text(0, 0))
    await store.person('bracket', text(300, 0))
    const board = await store.person('bracket', { op: 'arrow', from: 'C1', to: 'C2', label: 'like this' })
    expect(board.arrows).toEqual([{ id: 'C3', from: 'C1', to: 'C2', label: 'like this', by: 'person' }])
    expect(board.next).toBe(4)
    expect((await store.person('bracket', { op: 'unarrow', id: 'C3' })).arrows).toEqual([])
  })

  it('refuses an end that is not there, one card for both ends, and a word that is too long', async () => {
    await store.person('bracket', text(0, 0))
    await expect(store.person('bracket', { op: 'arrow', from: 'C1', to: 'C9' })).rejects.toThrow()
    await expect(store.person('bracket', { op: 'arrow', from: 'C1', to: 'C1' })).rejects.toThrow()
    await store.person('bracket', text(1, 1))
    await expect(store.person('bracket', { op: 'arrow', from: 'C1', to: 'C2', label: 'x'.repeat(500) })).rejects.toThrow()
  })
})

describe('restoring', () => {
  it('puts back removed cards and their arrows with the ids they had', async () => {
    await store.person('bracket', text(0, 0))
    await store.person('bracket', text(300, 0))
    await store.person('bracket', { op: 'arrow', from: 'C1', to: 'C2' })
    const before = await store.read('bracket')
    const after = await store.person('bracket', { op: 'remove', ids: ['C1'] })
    expect(after.arrows).toEqual([])
    const back = await store.person('bracket', { op: 'restore', ids: ['C1', 'C3'] })
    expect(back.cards.map((c) => c.id).sort()).toEqual(['C1', 'C2'])
    expect(back.arrows).toEqual(before.arrows)
    expect(byId(back, 'C1')).toEqual(byId(before, 'C1'))
    expect(back.next).toBe(before.next)
  })

  it('takes ids only: what the window says of the card (author, hidden, kind, source, copy) is ignored', async () => {
    await store.person('bracket', text(0, 0, { text: 'mine' }))
    const before = await store.read('bracket')
    await store.person('bracket', { op: 'remove', ids: ['C1'] })
    const forged = { id: 'C1', kind: 'brief', x: 900, y: 900, w: 10, h: 10, by: 'torno', hidden: true, source: 'brief', copy: { id: 'x', line: 'y', cause: 'z', sources: 'w' }, text: 'impostor' }
    const back = await store.person('bracket', { op: 'restore', ids: ['C1'], cards: [forged], arrows: [], by: 'torno', hidden: true, kind: 'brief' } as never)
    expect(back.cards).toEqual(before.cards)
    expect(byId(back, 'C1').by).toBe('person')
  })

  it('never takes an id that is in use, nor one that was never removed, nor one never given out', async () => {
    await store.person('bracket', text(0, 0, { text: 'mine' }))
    await store.person('bracket', text(300, 0, { text: 'other' }))
    await store.person('bracket', { op: 'remove', ids: ['C2'] })
    const board = await store.person('bracket', { op: 'restore', ids: ['C1', 'C40', 'C3', 'C2'] })
    expect(board.cards.map((c) => c.text)).toEqual(['mine', 'other'])
    // C2 only once: asking again changes nothing.
    expect((await store.person('bracket', { op: 'restore', ids: ['C2'] })).cards).toHaveLength(2)
  })

  it('brings back a card of the agent’s as the agent’s, whatever the window says', async () => {
    const { id } = await store.agent('bracket', { op: 'add', text: 'plan' })
    await store.person('bracket', { op: 'remove', ids: [id as string] })
    const back = await store.person('bracket', { op: 'restore', ids: [id as string] })
    expect(byId(back, id as string).by).toBe('agent')
  })

  it('brings back what the agent removed of its own', async () => {
    const { id } = await store.agent('bracket', { op: 'add', text: 'plan' })
    await store.agent('bracket', { op: 'remove', id: id as string })
    const back = await store.person('bracket', { op: 'restore', ids: [id as string] })
    expect(back.cards.map((c) => c.id)).toEqual([id])
  })

  it('leaves out a card in a frame that is not there, and an arrow with an end that is not there', async () => {
    await store.person('bracket', frame('Latch'))
    await store.person('bracket', text(10, 10, { frame: 'C1' }))
    await store.person('bracket', text(900, 0))
    await store.person('bracket', { op: 'arrow', from: 'C2', to: 'C3' })
    await store.person('bracket', { op: 'remove', ids: ['C2'] })
    await store.person('bracket', { op: 'remove', ids: ['C1'] })
    // The frame stays down: the card in it has nowhere to go, and its arrow's end is not there.
    const back = await store.person('bracket', { op: 'restore', ids: ['C2', 'C4'] })
    expect(back.cards.map((c) => c.id)).toEqual(['C3'])
    expect(back.arrows).toEqual([])
  })

  it('keeps the last 200 things removed this run, and no more', async () => {
    for (let i = 0; i < 205; i += 1) await store.person('bracket', text(i * 10, 0))
    for (let i = 1; i <= 205; i += 1) await store.person('bracket', { op: 'remove', ids: [`C${i}`] })
    const ids = Array.from({ length: 205 }, (_, i) => `C${i + 1}`)
    const back = await store.person('bracket', { op: 'restore', ids })
    expect(back.cards).toHaveLength(200)
    expect(back.cards.map((c) => c.id)).not.toContain('C1')
    expect(back.cards.map((c) => c.id)).toContain('C205')
  })

  it('forgets what was removed when the workspace is left', async () => {
    await store.person('bracket', text(0, 0))
    await store.person('bracket', { op: 'remove', ids: ['C1'] })
    store.forget()
    expect((await store.person('bracket', { op: 'restore', ids: ['C1'] })).cards).toEqual([])
  })
})

describe('main’s own changes', () => {
  it('writes what the edit gives and tells of it, with next kept above the ids in use', async () => {
    const board = await store.torno('bracket', (b) => ({ ...b, cards: [{ id: 'C5', kind: 'brief', x: 0, y: 0, w: 10, h: 10, by: 'torno', source: 'brief' }] }))
    expect(board.next).toBe(6)
    expect(onDisk()).toEqual(board)
    expect(changes).toHaveLength(1)
  })

  it('writes nothing when the edit gives null', async () => {
    const board = await store.torno('bracket', () => null)
    expect(board).toEqual({ next: 1, cards: [], arrows: [] })
    expect(changes).toEqual([])
    expect(() => onDisk()).toThrow()
  })
})

describe('the agent’s own changes', () => {
  const said = (extra: Record<string, unknown> = {}) => ({ op: 'add' as const, text: 'plan: file the latch', ...extra })

  it('adds a text card of its own, in a free spot, and tells of it', async () => {
    const { board, id } = await store.agent('bracket', said())
    expect(id).toBe('C1')
    expect(byId(board, 'C1')).toMatchObject({ kind: 'text', by: 'agent', text: 'plan: file the latch', x: 0, y: 0 })
    expect(onDisk()).toEqual(board)
    expect(changes).toHaveLength(1)
  })

  it('never lands on a card of the person’s', async () => {
    await store.person('bracket', text(0, 0))
    const { board } = await store.agent('bracket', said())
    const mine = byId(board, 'C2')
    expect(mine.x >= 200 || mine.y >= 100).toBe(true)
    expect(board.cards.find((c) => c.id === 'C1')).toMatchObject({ x: 0, y: 0 })
  })

  it('adds a picture of the view with its camera, the text being its caption', async () => {
    const camera = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
    const { board } = await store.agent('bracket', { op: 'add', text: 'the latch', picture: 'p-0123456789ab.png', camera: structuredClone(camera) as never })
    expect(byId(board, 'C1')).toMatchObject({ kind: 'picture', by: 'agent', picture: 'p-0123456789ab.png', caption: 'the latch', camera })
  })

  it('refuses a card with nothing in it, a picture that is not one torno kept, and too long a text', async () => {
    await expect(store.agent('bracket', { op: 'add' })).rejects.toThrow(/text or a picture/)
    await expect(store.agent('bracket', { op: 'add', picture: '../x.png' })).rejects.toThrow(/picture/)
    await expect(store.agent('bracket', said({ text: 'x'.repeat(MAX_TEXT_CHARS + 1) }))).rejects.toThrow(/characters long/)
    expect(changes).toEqual([])
  })

  it('puts the card inside a frame of the person’s, by name or id, in a free spot of it, leaving the frame as it was', async () => {
    await store.person('bracket', frame('Latch', 100, 100))
    const before = byId(await store.read('bracket'), 'C1')
    const named = await store.agent('bracket', said({ frame: 'latch' }))
    const byIdd = await store.agent('bracket', said({ frame: 'C1' }))
    expect(byId(named.board, 'C2').frame).toBe('C1')
    expect(byId(byIdd.board, 'C3').frame).toBe('C1')
    expect(byId(byIdd.board, 'C1')).toEqual(before)
    const inside = byId(byIdd.board, 'C3')
    expect(inside.x).toBeGreaterThanOrEqual(100)
    expect(inside.x + inside.w).toBeLessThanOrEqual(600)
  })

  it('makes a frame of its own for a name there is none of, and the card goes in it', async () => {
    const { board } = await store.agent('bracket', said({ frame: 'Plan' }))
    expect(byId(board, 'C1')).toMatchObject({ kind: 'frame', name: 'Plan', by: 'agent' })
    expect(byId(board, 'C2')).toMatchObject({ kind: 'text', frame: 'C1' })
    const again = await store.agent('bracket', said({ frame: 'Plan' }))
    expect(again.board.cards.filter((c) => c.kind === 'frame')).toHaveLength(1)
  })

  it('refuses an id that is not a frame, or not on the board', async () => {
    await store.person('bracket', text(0, 0))
    await expect(store.agent('bracket', said({ frame: 'C1' }))).rejects.toThrow(/C1 is not a frame/)
    await expect(store.agent('bracket', said({ frame: 'C9' }))).rejects.toThrow(/no card C9/)
  })

  it('puts the card just below a frame with no free spot, outside it, and says which', async () => {
    await store.person('bracket', { op: 'add', card: { kind: 'frame', x: 100, y: 100, w: 300, h: 200, name: 'Latch' } })
    // The frame has room for one card of this size, and the person has filled it.
    await store.person('bracket', { op: 'add', card: { kind: 'text', x: 124, y: 140, w: 250, h: 130, text: 'mine', frame: 'C1' } })
    const frameBefore = byId(await store.read('bracket'), 'C1')
    const { board, id, below } = await store.agent('bracket', said({ frame: 'Latch' }))
    const card = byId(board, id!)
    expect(below).toBe('C1')
    expect(card.frame).toBeUndefined()
    expect(card.y).toBeGreaterThanOrEqual(100 + 200)
    expect(byId(board, 'C1')).toEqual(frameBefore)
  })

  it('draws an arrow from or to a card that is there, with a word, the new card being the other end', async () => {
    await store.person('bracket', text(0, 0))
    const to = await store.agent('bracket', said({ arrow: { from: 'C1', label: 'because' } }))
    expect(to.board.arrows).toEqual([{ id: 'C3', from: 'C1', to: 'C2', label: 'because', by: 'agent' }])
    const from = await store.agent('bracket', said({ arrow: { to: 'C1' } }))
    expect(from.board.arrows[1]).toEqual({ id: 'C5', from: 'C4', to: 'C1', by: 'agent' })
  })

  it('refuses an arrow to a card that is not there, with both ends named, or with a word only, and then keeps nothing', async () => {
    await store.person('bracket', text(0, 0))
    await expect(store.agent('bracket', said({ arrow: { from: 'C9' } }))).rejects.toThrow(/no card C9/)
    await expect(store.agent('bracket', said({ arrow: { from: 'C1', to: 'C1' } }))).rejects.toThrow(/one end/)
    await expect(store.agent('bracket', said({ arrow: { label: 'x' } }))).rejects.toThrow(/one end/)
    expect((await store.read('bracket')).cards).toHaveLength(1)
  })

  it('changes the text of a card of its own, the name of its frame, the caption of its picture', async () => {
    await store.agent('bracket', said({ frame: 'Plan' }))
    await store.agent('bracket', { op: 'add', picture: 'p-0123456789ab.png' })
    const text2 = await store.agent('bracket', { op: 'edit', id: 'C2', text: 'new plan' })
    expect(byId(text2.board, 'C2').text).toBe('new plan')
    const named = await store.agent('bracket', { op: 'edit', id: 'C1', text: 'Plans' })
    expect(byId(named.board, 'C1').name).toBe('Plans')
    const caption = await store.agent('bracket', { op: 'edit', id: 'C3', text: 'the view' })
    expect(byId(caption.board, 'C3').caption).toBe('the view')
  })

  it('removes a card of its own, with the arrows on it, and an arrow of its own', async () => {
    await store.person('bracket', text(0, 0))
    await store.agent('bracket', said({ arrow: { from: 'C1' } }))
    const gone = await store.agent('bracket', { op: 'remove', id: 'C2' })
    expect(gone.board.cards.map((c) => c.id)).toEqual(['C1'])
    expect(gone.board.arrows).toEqual([])
    await store.agent('bracket', said({ arrow: { from: 'C1' } }))
    const arrowId = (await store.read('bracket')).arrows[0].id
    expect((await store.agent('bracket', { op: 'remove', id: arrowId })).board.arrows).toEqual([])
  })

  it('does not change or remove a card of the person’s or of main’s own, naming whose it is, and the file is byte for byte as it was', async () => {
    await store.person('bracket', text(0, 0))
    await withTorno()
    await store.person('bracket', { op: 'arrow', from: 'C1', to: 'C2' })
    const file = join(dirs.bracket, '.torno', 'board', 'board.json')
    const before = readFileSync(file)
    await expect(store.agent('bracket', { op: 'edit', id: 'C1', text: 'mine now' })).rejects.toThrow(/C1 is the person's/)
    await expect(store.agent('bracket', { op: 'remove', id: 'C1' })).rejects.toThrow(/C1 is the person's/)
    await expect(store.agent('bracket', { op: 'edit', id: 'C2', text: 'x' })).rejects.toThrow(/C2 is torno's own/)
    await expect(store.agent('bracket', { op: 'remove', id: 'C2' })).rejects.toThrow(/torno's own/)
    await expect(store.agent('bracket', { op: 'remove', id: 'C3' })).rejects.toThrow(/C3 is the person's/)
    await expect(store.agent('bracket', { op: 'remove', id: 'C7' })).rejects.toThrow(/no card C7/)
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  it('does not take down a card of its own that the person drew an arrow to', async () => {
    const { id } = await store.agent('bracket', said())
    await store.person('bracket', text(400, 0))
    await store.person('bracket', { op: 'arrow', from: 'C2', to: id as string })
    await expect(store.agent('bracket', { op: 'remove', id: id as string })).rejects.toThrow(/C3 is the person's/)
    expect((await store.read('bracket')).arrows).toHaveLength(1)
  })

  it('does not take down a frame of its own that holds a card that is not its own', async () => {
    await store.agent('bracket', said({ frame: 'Plan' }))
    await store.person('bracket', { op: 'add', card: { kind: 'text', x: 40, y: 60, w: 100, h: 50, text: 'mine', frame: 'C1' } })
    await expect(store.agent('bracket', { op: 'remove', id: 'C1' })).rejects.toThrow(/holds C3/)
  })

  it('takes one change at a time with the person’s', async () => {
    const results = await Promise.all([store.person('bracket', text(0, 0)), store.agent('bracket', said()), store.person('bracket', text(0, 300))])
    expect(results[2].cards.map((c) => c.id)).toEqual(['C1', 'C2', 'C3'])
    expect(onDisk().cards).toHaveLength(3)
  })
})
