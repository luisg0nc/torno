import { describe, expect, it } from 'vitest'
import { type BoardFile, type BuildCopy, type Card, emptyBoard } from '../../shared/board'
import { pin, reconcile } from './sources'

const none = { brief: false, references: [] as string[], marks: [] as string[], scans: [] as string[], tracings: [] as string[] }
const sourcesOf = (board: BoardFile): string[] => board.cards.map((c) => `${c.kind}:${c.source}`)
const done = (value: BoardFile | null): BoardFile => {
  if (value === null) throw new Error('expected a board')
  return value
}
const copy: BuildCopy = { id: 'h41', line: 'lid thinner', cause: 'agent', sources: 'abc' }

/** A card of main's own that an old board holds. */
const old = (id: number, kind: Card['kind'], source: string, more: Partial<Card> = {}): Card => ({ id: `C${id}`, kind, x: id * 300, y: 0, w: 240, h: 120, by: 'torno', source, ...more })
const boardOf = (cards: Card[], more: Partial<BoardFile> = {}): BoardFile => ({ next: cards.length + 1, cards, arrows: [], ...more })

describe('reconcile', () => {
  it('is null for an empty board with nothing found', () => {
    expect(reconcile(emptyBoard(), none)).toBeNull()
  })

  it('adds a placed card of main\'s own for the brief and each file of reference/', () => {
    const board = done(reconcile(emptyBoard(), { ...none, brief: true, references: ['reference/photo-1.jpg', 'reference/part.step'] }))
    expect(sourcesOf(board)).toEqual(['brief:brief', 'reference:reference/photo-1.jpg', 'reference:reference/part.step'])
    expect(board.cards.every((c) => c.by === 'torno' && !c.hidden && c.w > 0 && c.h > 0)).toBe(true)
    expect(board.cards.map((c) => c.id)).toEqual(['C1', 'C2', 'C3'])
    expect(board.next).toBe(4)
  })

  it('makes no card for a mark, a scan or a tracing, and says nothing changed', () => {
    expect(reconcile(emptyBoard(), { ...none, marks: ['M1', 'M2'], scans: ['S1'], tracings: ['T1'] })).toBeNull()
  })

  it('places each card clear of the others', () => {
    const board = done(reconcile(emptyBoard(), { ...none, references: Array.from({ length: 12 }, (_, i) => `reference/photo-${i + 1}.jpg`) }))
    expect(new Set(board.cards.map((c) => `${c.x},${c.y}`)).size).toBe(12)
  })

  it('adds a card for a new reference and none again for one it has', () => {
    const first = done(reconcile(emptyBoard(), { ...none, references: ['reference/a.jpg'] }))
    expect(reconcile(first, { ...none, references: ['reference/a.jpg'] })).toBeNull()
    const second = done(reconcile(first, { ...none, references: ['reference/a.jpg', 'reference/b.jpg'] }))
    expect(second.cards[0]).toEqual(first.cards[0])
    expect(sourcesOf(second)).toEqual(['reference:reference/a.jpg', 'reference:reference/b.jpg'])
  })

  it('removes the card of a reference file, a brief, that is gone, and the arrows that touch it', () => {
    let board = done(reconcile(emptyBoard(), { ...none, brief: true, references: ['reference/photo-1.jpg', 'reference/photo-2.jpg'] }))
    board = { ...board, next: board.next + 1, arrows: [{ id: `C${board.next}`, from: 'C1', to: 'C2', by: 'person' }] }
    const after = done(reconcile(board, { ...none, references: ['reference/photo-2.jpg'] }))
    expect(sourcesOf(after)).toEqual(['reference:reference/photo-2.jpg'])
    expect(after.arrows).toEqual([])
  })

  it('keeps a hidden card hidden while its file is there, and takes it away with the file', () => {
    const board = done(reconcile(emptyBoard(), { ...none, references: ['reference/a.jpg'] }))
    board.cards[0].hidden = true
    expect(reconcile(board, { ...none, references: ['reference/a.jpg'] })).toBeNull()
    expect(done(reconcile(board, none)).cards).toEqual([])
  })

  it('never touches pinned, made or the agent\'s cards, whatever their source says', () => {
    const pinned = pin(emptyBoard(), { kind: 'build', copy })
    if ('refused' in pinned) throw new Error(pinned.refused)
    const board = boardOf([
      ...pinned.cards,
      { id: 'C2', kind: 'text', x: 5000, y: 0, w: 10, h: 10, by: 'person', source: 'M9', text: 'x' },
      { id: 'C3', kind: 'mark', x: 6000, y: 0, w: 10, h: 10, by: 'agent', source: 'M8' },
      { id: 'C4', kind: 'mark', x: 7000, y: 0, w: 10, h: 10, by: 'person', source: 'M7' }
    ])
    expect(reconcile(board, none)).toBeNull()
  })

  it('keeps a pinned build whose entry is gone', () => {
    const pinned = pin(emptyBoard(), { kind: 'build', copy })
    if ('refused' in pinned) throw new Error(pinned.refused)
    expect(reconcile(pinned, none)).toBeNull()
  })

  it('does not change its input', () => {
    const board = emptyBoard()
    reconcile(board, { ...none, brief: true })
    expect(board).toEqual(emptyBoard())
  })
})

describe('reconcile: the old copies of a board made before #248', () => {
  const found = { ...none, marks: ['M1', 'M2'], scans: ['S1'], tracings: ['T1'] }
  const person = (id: number): Card => ({ id: `C${id}`, kind: 'frame', x: 0, y: 1000, w: 900, h: 400, by: 'person', name: 'Mine' })

  it('hides the mark, scan and tracing cards that were never put in a frame, once, and loses none', () => {
    const board = boardOf([old(1, 'mark', 'M1'), old(2, 'mark', 'M2'), old(3, 'scan', 'S1'), old(4, 'tracing', 'T1'), old(5, 'brief', 'brief')])
    const after = done(reconcile(board, { ...found, brief: true }))
    expect(after.cards).toHaveLength(5)
    expect(after.cards.filter((c) => c.hidden).map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4'])
    expect(after.tidied).toBe(true)
    expect(after.cards.find((c) => c.id === 'C5')?.hidden).toBeUndefined()
  })

  it('keeps a copy the person put in a frame of their own', () => {
    const board = boardOf([person(1), old(2, 'mark', 'M1', { frame: 'C1', x: 20, y: 1050 }), old(3, 'mark', 'M2')])
    const after = done(reconcile(board, found))
    expect(after.cards.find((c) => c.id === 'C2')).toEqual(board.cards[1])
    expect(after.cards.find((c) => c.id === 'C3')?.hidden).toBe(true)
  })

  it('hides the frame of a round and the copies in it, and keeps what the person put there that is not a copy', () => {
    const round: Card = { id: 'C1', kind: 'frame', x: 0, y: 0, w: 900, h: 400, by: 'torno', source: 'R1', name: 'Review of h41 · 1 −' }
    const board = boardOf([round, old(2, 'mark', 'M1', { frame: 'C1' }), { id: 'C3', kind: 'text', x: 10, y: 10, w: 100, h: 50, by: 'person', text: 'mine', frame: 'C1' }])
    const after = done(reconcile(board, found))
    expect(after.cards.map((c) => [c.id, c.hidden === true])).toEqual([['C1', true], ['C2', true], ['C3', false]])
  })

  it('does it once: a card brought back stays, and a copy moved out of its frame is not hidden later', () => {
    const board = boardOf([person(1), old(2, 'mark', 'M1', { frame: 'C1' }), old(3, 'mark', 'M2')])
    const first = done(reconcile(board, found))
    const brought = structuredClone(first)
    delete brought.cards[2].hidden
    expect(reconcile(brought, found)).toBeNull()
    delete brought.cards[1].frame
    expect(reconcile(brought, found)).toBeNull()
  })

  it('still takes an old copy away with its mark, hidden or not', () => {
    const board = done(reconcile(boardOf([old(1, 'mark', 'M1'), old(2, 'scan', 'S1'), old(3, 'tracing', 'T1')]), found))
    const after = done(reconcile(board, none))
    expect(after.cards).toEqual([])
  })

  it('leaves a board with no old copy as it is, with no marker written', () => {
    expect(reconcile(boardOf([{ id: 'C1', kind: 'text', x: 0, y: 0, w: 10, h: 10, by: 'person', text: 'x' }]), found)).toBeNull()
  })

  it('does not hide the person\'s or the agent\'s mark cards', () => {
    const board = boardOf([old(1, 'mark', 'M1', { by: 'person' }), old(2, 'mark', 'M2', { by: 'agent' }), old(3, 'mark', 'M1')])
    const after = done(reconcile(board, found))
    expect(after.cards.map((c) => c.hidden === true)).toEqual([false, false, true])
  })
})

describe('pin', () => {
  const ok = (value: BoardFile | { refused: string }): BoardFile => {
    if ('refused' in value) throw new Error(value.refused)
    return value
  }

  it('pins a build with its copy, its picture and its layout', () => {
    const board = ok(pin(emptyBoard(), { kind: 'build', copy, layout: 'lid', picture: 'p-0123456789ab.png' }))
    expect(board.cards).toEqual([{ id: 'C1', kind: 'build', x: 0, y: 0, w: expect.any(Number), h: expect.any(Number), by: 'person', source: 'h41', layout: 'lid', picture: 'p-0123456789ab.png', copy }])
    expect(board.next).toBe(2)
  })

  it('pins a view by its name, with its layout', () => {
    const board = ok(pin(emptyBoard(), { kind: 'view', name: 'Front', layout: 'assembly' }))
    expect(board.cards[0]).toMatchObject({ kind: 'view', source: 'Front', layout: 'assembly', by: 'person' })
  })

  it('refuses a picture that is not one of the board\'s', () => {
    expect(pin(emptyBoard(), { kind: 'build', copy, picture: '../../x.png' })).toEqual({ refused: expect.stringContaining('picture') })
  })

  it('pins the Params and the checks once each', () => {
    let board = ok(pin(emptyBoard(), { kind: 'params' }))
    board = ok(pin(board, { kind: 'checks' }))
    expect(board.cards.map((c) => c.source)).toEqual(['params', 'checks'])
    expect(pin(board, { kind: 'params' })).toEqual({ refused: expect.stringMatching(/Params/) })
    expect(pin(board, { kind: 'checks' })).toEqual({ refused: expect.stringMatching(/checks/) })
  })

  it('refuses a name that is not a view\'s, or a copy that is not whole', () => {
    expect(pin(emptyBoard(), { kind: 'view', name: '' })).toHaveProperty('refused')
    expect(pin(emptyBoard(), { kind: 'build', copy: { ...copy, id: 'nope' } })).toHaveProperty('refused')
  })

  it('lands in a free spot and does not change its input', () => {
    const board = ok(pin(emptyBoard(), { kind: 'params' }))
    const before = structuredClone(board)
    const next = ok(pin(board, { kind: 'checks' }))
    expect(board).toEqual(before)
    const [a, b] = next.cards
    expect(b.x >= a.x + a.w || b.y >= a.y + a.h).toBe(true)
  })
})
