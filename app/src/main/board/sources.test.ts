import { describe, expect, it } from 'vitest'
import { type BoardFile, type BuildCopy, emptyBoard } from '../../shared/board'
import { CARD_SIZE, NOTE_CARD_WIDTH, noteCardSize, pin, reconcile } from './sources'

const none = { brief: false, references: [] as string[], marks: [] as Array<{ id: string; layout: string; round?: string; picture?: { w: number; h: number } }>, scans: [] as string[], rounds: [] as Array<{ id: string; name: string; items: string[]; from?: string }>, tracings: [] as Array<{ id: string }> }
const mark = (n: number, layout = 'assembly', round?: string) => ({ id: `M${n}`, layout, ...(round !== undefined ? { round } : {}) })
const sourcesOf = (board: BoardFile): string[] => board.cards.map((c) => `${c.kind}:${c.source}`)
const done = (value: BoardFile | null): BoardFile => {
  if (value === null) throw new Error('expected a board')
  return value
}
const copy: BuildCopy = { id: 'h41', line: 'lid thinner', cause: 'agent', sources: 'abc' }

describe('the card of a view note', () => {
  it('is made at a size where its picture reads, and keeps the picture\'s shape', () => {
    const board = done(reconcile(emptyBoard(), { ...none, marks: [{ ...mark(1), picture: { w: 1280, h: 800 } }, mark(2)] }))
    const [note, plain] = board.cards
    expect(note.w).toBe(NOTE_CARD_WIDTH)
    expect(note.w).toBeGreaterThan(CARD_SIZE.mark.w)
    // The picture's own room: the card less its head and its two lines.
    const room = { w: note.w - 24, h: note.h - 110 }
    expect(room.w / room.h).toBeCloseTo(1280 / 800, 1)
    expect(room.h).toBeGreaterThanOrEqual(150)
    // A mark that is no note keeps the mark card's size.
    expect({ w: plain.w, h: plain.h }).toEqual(CARD_SIZE.mark)
  })

  it('is held between a least and a most height for a very wide or very tall picture', () => {
    expect(noteCardSize({ w: 4000, h: 100 }).h).toBeGreaterThanOrEqual(160)
    expect(noteCardSize({ w: 100, h: 4000 }).h).toBeLessThanOrEqual(520)
  })
})

describe('reconcile', () => {
  it('is null for an empty board with nothing found', () => {
    expect(reconcile(emptyBoard(), none)).toBeNull()
  })

  it('adds a placed card of main\'s own for each source', () => {
    const board = done(reconcile(emptyBoard(), { brief: true, references: ['reference/photo-1.jpg'], marks: [mark(1, 'lid')], scans: ['S1'], rounds: [], tracings: [] }))
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
    const board = done(reconcile(emptyBoard(), { brief: true, references: ['reference/photo-1.jpg', 'reference/photo-2.jpg'], marks: [], scans: ['S1', 'S2'], rounds: [], tracings: [] }))
    const after = done(reconcile(board, { brief: false, references: ['reference/photo-2.jpg'], marks: [], scans: ['S2'], rounds: [], tracings: [] }))
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

  it('makes the card of a tracing by itself, of main\'s own, and takes it away with the tracing', () => {
    const board = done(reconcile(emptyBoard(), { ...none, tracings: [{ id: 'T1' }] }))
    expect(sourcesOf(board)).toEqual(['tracing:T1'])
    expect(board.cards[0]).toMatchObject({ by: 'torno', w: CARD_SIZE.tracing.w, h: CARD_SIZE.tracing.h })
    expect(reconcile(board, { ...none, tracings: [{ id: 'T1' }] })).toBeNull()
    const two = done(reconcile(board, { ...none, tracings: [{ id: 'T1' }, { id: 'T2' }] }))
    expect(sourcesOf(two)).toEqual(['tracing:T1', 'tracing:T2'])
    expect(two.cards[0]).toEqual(board.cards[0])
    expect(sourcesOf(done(reconcile(two, { ...none, tracings: [{ id: 'T2' }] })))).toEqual(['tracing:T2'])
    expect(done(reconcile(two, none)).cards).toEqual([])
  })

  it('keeps the card of a tracing hidden through the next reconcile, and takes a hidden one away with its tracing', () => {
    const board = done(reconcile(emptyBoard(), { ...none, tracings: [{ id: 'T1' }] }))
    board.cards[0].hidden = true
    expect(reconcile(board, { ...none, tracings: [{ id: 'T1' }] })).toBeNull()
    expect(done(reconcile(board, none)).cards).toEqual([])
  })

  it('does not change its input', () => {
    const board = emptyBoard()
    reconcile(board, { ...none, brief: true })
    expect(board).toEqual(emptyBoard())
  })
})

describe('reconcile: the frame of a round', () => {
  const r1 = (items: string[], name = 'Review of h41 · 1 −'): { id: string; name: string; items: string[]; from?: string } => ({ id: 'R1', name, items })
  const found = (marks: ReturnType<typeof mark>[], rounds: Array<ReturnType<typeof r1>>) => ({ ...none, marks, rounds })
  const frameOf = (board: BoardFile, source: string) => board.cards.find((c) => c.kind === 'frame' && c.source === source)
  const cardOf = (board: BoardFile, id: string) => board.cards.find((c) => c.kind === 'mark' && c.source === id)
  const inside = (card: { x: number; y: number; w: number; h: number }, frame: { x: number; y: number; w: number; h: number }): boolean =>
    card.x >= frame.x && card.y >= frame.y && card.x + card.w <= frame.x + frame.w && card.y + card.h <= frame.y + frame.h

  it('makes the frame of a round with its first item, and puts the new mark card in it', () => {
    const board = done(reconcile(emptyBoard(), found([mark(1, 'assembly', 'R1')], [r1(['M1'])])))
    const frame = frameOf(board, 'R1')
    expect(frame).toMatchObject({ kind: 'frame', by: 'torno', source: 'R1', name: 'Review of h41 · 1 −', w: CARD_SIZE.round.w, h: CARD_SIZE.round.h })
    const card = cardOf(board, 'M1')
    expect(card?.frame).toBe(frame?.id)
    expect(inside(card!, frame!)).toBe(true)
  })

  it('makes no frame for a round with no items, and none again for one it has', () => {
    expect(reconcile(emptyBoard(), found([], [r1([])]))).toBeNull()
    const board = done(reconcile(emptyBoard(), found([mark(1, 'assembly', 'R1')], [r1(['M1'])])))
    expect(reconcile(board, found([mark(1, 'assembly', 'R1')], [r1(['M1'])]))).toBeNull()
  })

  it('keeps the frame of a round that is still there when its items are all gone, and takes it away with the round', () => {
    const board = done(reconcile(emptyBoard(), found([mark(1, 'assembly', 'R1')], [r1(['M1'])])))
    // The only item was removed or carried on: the round is still in the rounds, so its frame stays.
    const empty = reconcile(board, found([], [r1([])]))
    expect(frameOf(empty ?? board, 'R1')).toBeDefined()
    // Round gone: its frame goes.
    expect(frameOf(done(reconcile(board, found([], []))), 'R1')).toBeUndefined()
  })

  it('renames the frame when the counts change, and keeps its place and size', () => {
    const board = done(reconcile(emptyBoard(), found([mark(1, 'assembly', 'R1')], [r1(['M1'])])))
    const moved = structuredClone(board)
    const frame = frameOf(moved, 'R1')!
    frame.x = 900
    frame.w = 1000
    const after = done(reconcile(moved, found([mark(1, 'assembly', 'R1'), mark(2, 'assembly', 'R1')], [r1(['M1', 'M2'], 'Review of h41 · 1 − · 1 +')])))
    expect(frameOf(after, 'R1')).toMatchObject({ name: 'Review of h41 · 1 − · 1 +', x: 900, w: 1000 })
    expect(cardOf(after, 'M2')?.frame).toBe(frame.id)
  })

  it('puts a frame in a free spot, clear of the cards there', () => {
    const board = done(reconcile(emptyBoard(), { ...none, brief: true, references: ['reference/a.jpg'], marks: [mark(1, 'assembly', 'R1')], rounds: [r1(['M1'])] }))
    const frame = frameOf(board, 'R1')!
    for (const c of board.cards.filter((c) => c !== frame && c.kind !== 'mark')) {
      expect(c.x + c.w <= frame.x || frame.x + frame.w <= c.x || c.y + c.h <= frame.y || frame.y + frame.h <= c.y).toBe(true)
    }
  })

  it('makes the frame big enough for the items it is made with', () => {
    const marks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => mark(n, 'assembly', 'R1'))
    const board = done(reconcile(emptyBoard(), found(marks, [r1(marks.map((m) => m.id))])))
    const frame = frameOf(board, 'R1')!
    expect(frame.h).toBeGreaterThan(CARD_SIZE.round.h)
    for (const m of marks) {
      const card = cardOf(board, m.id)!
      expect(card.frame).toBe(frame.id)
      expect(inside(card, frame)).toBe(true)
    }
    // No two cards of the round lie on each other.
    const spots = new Set(marks.map((m) => `${cardOf(board, m.id)!.x},${cardOf(board, m.id)!.y}`))
    expect(spots.size).toBe(10)
  })

  it('grows the frame by a row when a later item has no room, and does not when something is in the way', () => {
    let marks = [1, 2, 3, 4, 5, 6].map((n) => mark(n, 'assembly', 'R1'))
    let board = done(reconcile(emptyBoard(), found(marks, [r1(marks.map((m) => m.id))])))
    const before = frameOf(board, 'R1')!.h
    marks = [...marks, mark(7, 'assembly', 'R1')]
    board = done(reconcile(board, found(marks, [r1(marks.map((m) => m.id))])))
    const frame = frameOf(board, 'R1')!
    expect(frame.h).toBeGreaterThan(before)
    expect(cardOf(board, 'M7')?.frame).toBe(frame.id)
    expect(inside(cardOf(board, 'M7')!, frame)).toBe(true)

    // A card of the person's just under the frame: the new item is not put in it, and the frame stays as it is.
    const blocked = structuredClone(board)
    const f = frameOf(blocked, 'R1')!
    blocked.cards.push({ id: `C${blocked.next}`, kind: 'text', x: f.x, y: f.y + f.h + 10, w: f.w, h: 100, by: 'person', text: 'in the way' })
    blocked.next += 1
    const more = [...marks, mark(8, 'assembly', 'R1'), mark(9, 'assembly', 'R1'), mark(10, 'assembly', 'R1')]
    const after = done(reconcile(blocked, found(more, [r1(more.map((m) => m.id))])))
    expect(frameOf(after, 'R1')!.h).toBe(f.h)
    const placed = cardOf(after, 'M10')!
    expect(placed.frame).toBeUndefined()
    expect(inside(placed, frameOf(after, 'R1')!)).toBe(false)
  })

  it('moves a carried item from the frame of the round it came from into the next one', () => {
    const first = done(reconcile(emptyBoard(), found([mark(1, 'assembly', 'R1'), mark(2, 'assembly', 'R1')], [r1(['M1', 'M2'])])))
    const both = { id: 'R2', name: 'Review of h42 · 1 −', items: ['M1'], from: 'R1' }
    const after = done(reconcile(first, found([mark(1, 'assembly', 'R2'), mark(2, 'assembly', 'R1')], [r1(['M2']), both])))
    const f1 = frameOf(after, 'R1')!
    const f2 = frameOf(after, 'R2')!
    expect(f2).toMatchObject({ name: 'Review of h42 · 1 −', by: 'torno' })
    const card = cardOf(after, 'M1')!
    expect(card.frame).toBe(f2.id)
    expect(inside(card, f2)).toBe(true)
    expect(cardOf(after, 'M2')?.frame).toBe(f1.id)
    // The card did not take another card's place.
    expect(`${card.x},${card.y}`).not.toBe(`${cardOf(after, 'M2')!.x},${cardOf(after, 'M2')!.y}`)
  })

  it('leaves the card of a person\'s frame in it when its mark joins a round or is carried (Review Focus 5)', () => {
    let board = done(reconcile(emptyBoard(), { ...none, marks: [mark(1, 'assembly')] }))
    // The person's own frame round the card.
    const card = cardOf(board, 'M1')!
    board = structuredClone(board)
    const mine = { id: `C${board.next}`, kind: 'frame' as const, x: card.x - 40, y: card.y - 40, w: 400, h: 300, by: 'person' as const, name: 'Mine' }
    board.next += 1
    board.cards.push(mine)
    cardOf(board, 'M1')!.frame = mine.id
    const joined = done(reconcile(board, found([mark(1, 'assembly', 'R1')], [r1(['M1'])])))
    expect(cardOf(joined, 'M1')).toMatchObject({ frame: mine.id, x: card.x, y: card.y })
    expect(frameOf(joined, 'R1')).toBeDefined()
    // Then carried to the next round.
    const next = done(reconcile(joined, found([mark(1, 'assembly', 'R2')], [{ id: 'R2', name: 'Review of h42 · 1 −', items: ['M1'], from: 'R1' }])))
    expect(cardOf(next, 'M1')).toMatchObject({ frame: mine.id, x: card.x, y: card.y })
  })

  it('leaves a card the person took out of the frame where it is', () => {
    const board = done(reconcile(emptyBoard(), found([mark(1, 'assembly', 'R1')], [r1(['M1'])])))
    const out = structuredClone(board)
    delete cardOf(out, 'M1')!.frame
    cardOf(out, 'M1')!.x = 5000
    const marks = [mark(1, 'assembly', 'R1'), mark(2, 'assembly', 'R1')]
    const after = done(reconcile(out, found(marks, [r1(['M1', 'M2'], 'Review of h41 · 2 −')])))
    expect(cardOf(after, 'M1')).toMatchObject({ x: 5000 })
    expect(cardOf(after, 'M1')?.frame).toBeUndefined()
  })

  it('keeps a frame that was removed hidden, and puts no new card in it', () => {
    const board = done(reconcile(emptyBoard(), found([mark(1, 'assembly', 'R1')], [r1(['M1'])])))
    const hidden = structuredClone(board)
    frameOf(hidden, 'R1')!.hidden = true
    expect(reconcile(hidden, found([mark(1, 'assembly', 'R1')], [r1(['M1'])]))).toBeNull()
    const marks = [mark(1, 'assembly', 'R1'), mark(2, 'assembly', 'R1')]
    const after = done(reconcile(hidden, found(marks, [r1(['M1', 'M2'], 'Review of h41 · 2 −')])))
    expect(after.cards.filter((c) => c.kind === 'frame')).toHaveLength(1)
    expect(frameOf(after, 'R1')).toMatchObject({ hidden: true, name: 'Review of h41 · 2 −' })
    expect(cardOf(after, 'M2')?.frame).toBeUndefined()
  })

  it('takes the frame away with its round, hidden or not, and lets what it held go', () => {
    const board = done(reconcile(emptyBoard(), found([mark(1, 'assembly', 'R1')], [r1(['M1'])])))
    const after = done(reconcile(board, found([mark(1, 'assembly')], [])))
    expect(frameOf(after, 'R1')).toBeUndefined()
    expect(cardOf(after, 'M1')?.frame).toBeUndefined()
    const hidden = structuredClone(board)
    frameOf(hidden, 'R1')!.hidden = true
    expect(frameOf(done(reconcile(hidden, found([mark(1, 'assembly')], []))), 'R1')).toBeUndefined()
  })

  it('puts a restored item back into the frame of its round (Review Focus 4)', () => {
    const board = done(reconcile(emptyBoard(), found([mark(1, 'assembly', 'R1'), mark(2, 'assembly', 'R1')], [r1(['M1', 'M2'], 'Review of h41 · 2 −')])))
    const removed = done(reconcile(board, found([mark(2, 'assembly', 'R1')], [r1(['M2'])])))
    expect(cardOf(removed, 'M1')).toBeUndefined()
    const back = done(reconcile(removed, found([mark(1, 'assembly', 'R1'), mark(2, 'assembly', 'R1')], [r1(['M1', 'M2'], 'Review of h41 · 2 −')])))
    const frame = frameOf(back, 'R1')!
    expect(cardOf(back, 'M1')?.frame).toBe(frame.id)
    expect(inside(cardOf(back, 'M1')!, frame)).toBe(true)
  })

  it('does not touch the frames of the person or the agent, or a made card in a round frame', () => {
    const board = emptyBoard()
    board.cards.push({ id: 'C1', kind: 'frame', x: 0, y: 0, w: 500, h: 400, by: 'person', name: 'Latch', source: 'R1' })
    board.next = 2
    expect(reconcile(board, none)).toBeNull()
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
