import { describe, expect, it } from 'vitest'
import { type BoardFile, type BuildCopy, emptyBoard } from '../../shared/board'
import { pin, reconcile } from './sources'

const none = { brief: false, references: [] as string[], marks: [] as Array<{ id: string; layout: string }>, scans: [] as string[] }
const mark = (n: number, layout = 'assembly') => ({ id: `M${n}`, layout })
const sourcesOf = (board: BoardFile): string[] => board.cards.map((c) => `${c.kind}:${c.source}`)
const done = (value: BoardFile | null): BoardFile => {
  if (value === null) throw new Error('expected a board')
  return value
}
const copy: BuildCopy = { id: 'h41', line: 'lid thinner', cause: 'agent', sources: 'abc' }

describe('reconcile', () => {
  it('is null for an empty board with nothing found', () => {
    expect(reconcile(emptyBoard(), none)).toBeNull()
  })

  it('adds a placed card of main\'s own for each source', () => {
    const board = done(reconcile(emptyBoard(), { brief: true, references: ['reference/photo-1.jpg'], marks: [mark(1, 'lid')], scans: ['S1'] }))
    expect(sourcesOf(board)).toEqual(['brief:brief', 'reference:reference/photo-1.jpg', 'mark:M1', 'scan:S1'])
    expect(board.cards.every((c) => c.by === 'torno' && !c.hidden && c.w > 0 && c.h > 0)).toBe(true)
    expect(board.cards.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4'])
    expect(board.next).toBe(5)
    expect(board.cards[2].layout).toBe('lid')
  })

  it('places each card clear of the others', () => {
    const board = done(reconcile(emptyBoard(), { ...none, marks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => mark(n)) }))
    const spots = new Set(board.cards.map((c) => `${c.x},${c.y}`))
    expect(spots.size).toBe(12)
  })

  it('adds a card for a new mark and none again for one it has', () => {
    const first = done(reconcile(emptyBoard(), { ...none, marks: [mark(1)] }))
    expect(reconcile(first, { ...none, marks: [mark(1)] })).toBeNull()
    const second = done(reconcile(first, { ...none, marks: [mark(1), mark(2)] }))
    expect(sourcesOf(second)).toEqual(['mark:M1', 'mark:M2'])
    expect(second.cards[0]).toEqual(first.cards[0])
  })

  it('removes the card of a mark that is gone, and the arrows that touch it', () => {
    let board = done(reconcile(emptyBoard(), { ...none, marks: [mark(1), mark(2)] }))
    board = { ...board, next: board.next + 1, arrows: [{ id: `C${board.next}`, from: 'C1', to: 'C2', by: 'person' }] }
    const after = done(reconcile(board, { ...none, marks: [mark(2)] }))
    expect(sourcesOf(after)).toEqual(['mark:M2'])
    expect(after.arrows).toEqual([])
  })

  it('keeps a hidden card hidden while its mark is there', () => {
    const board = done(reconcile(emptyBoard(), { ...none, marks: [mark(1)] }))
    board.cards[0].hidden = true
    expect(reconcile(board, { ...none, marks: [mark(1)] })).toBeNull()
  })

  it('takes a hidden card away with its mark', () => {
    const board = done(reconcile(emptyBoard(), { ...none, marks: [mark(1)] }))
    board.cards[0].hidden = true
    expect(done(reconcile(board, none)).cards).toEqual([])
  })

  it('removes the card of a reference file that is gone, and of a brief that is gone, and of a scan', () => {
    const board = done(reconcile(emptyBoard(), { brief: true, references: ['reference/photo-1.jpg', 'reference/photo-2.jpg'], marks: [], scans: ['S1', 'S2'] }))
    const after = done(reconcile(board, { brief: false, references: ['reference/photo-2.jpg'], marks: [], scans: ['S2'] }))
    expect(sourcesOf(after)).toEqual(['reference:reference/photo-2.jpg', 'scan:S2'])
  })

  it('never touches pinned, made or the agent\'s cards, whatever their source says', () => {
    let board = done(reconcile(emptyBoard(), { ...none, marks: [mark(1)] }))
    const pinned = pin(board, { kind: 'build', copy })
    if ('refused' in pinned) throw new Error(pinned.refused)
    board = { ...pinned, next: pinned.next + 3, cards: [...pinned.cards,
      { id: `C${pinned.next}`, kind: 'text', x: 5000, y: 0, w: 10, h: 10, by: 'person', source: 'M9', text: 'x' },
      { id: `C${pinned.next + 1}`, kind: 'mark', x: 6000, y: 0, w: 10, h: 10, by: 'agent', source: 'M8' },
      { id: `C${pinned.next + 2}`, kind: 'mark', x: 7000, y: 0, w: 10, h: 10, by: 'person', source: 'M7' }
    ] }
    const after = done(reconcile(board, none))
    expect(after.cards.map((c) => c.kind)).toEqual(['build', 'text', 'mark', 'mark'])
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
