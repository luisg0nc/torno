import { describe, expect, it } from 'vitest'
import type { Arrow, Card } from '../../../shared/board'
import { BoardUndo, pick, type Snapshot } from './undo'

const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, kind: 'text', x: 0, y: 0, w: 100, h: 60, by: 'person', ...extra })
const arrow = (id: string, from: string, to: string, extra: Partial<Arrow> = {}): Arrow => ({ id, from, to, by: 'person', ...extra })
const snap = (cards: Card[], arrows: Arrow[] = []): Snapshot => ({ cards, arrows })
const NOTHING = snap([])

/** Every undo of the stack, in the order sent. */
function all(undo: BoardUndo): unknown[] {
  const out: unknown[] = []
  for (let c = undo.undo(); c; c = undo.chained ? undo.undo() : null) out.push(c)
  return out
}

describe('BoardUndo', () => {
  it('keeps at most 50 changes: the 51st pushed pushes the first out', () => {
    const undo = new BoardUndo()
    for (let i = 1; i <= 51; i++) undo.push(snap([card('C1', { x: i - 1 })]), snap([card('C1', { x: i })]))
    for (let i = 0; i < 49; i++) expect(undo.undo()).not.toBeNull()
    // The oldest is gone: the last one undone is the move back to x = 1, not to 0.
    expect(undo.undo()).toEqual({ op: 'move', moves: [{ id: 'C1', x: 1, y: 0, w: 100, h: 60 }] })
    expect(undo.undo()).toBeNull()
  })

  it('has nothing to undo at first, and a push that changed nothing is not kept', () => {
    const undo = new BoardUndo()
    expect(undo.undo()).toBeNull()
    undo.push(snap([card('C1')]), snap([card('C1')]))
    expect(undo.undo()).toBeNull()
  })

  it('gives the size before for the undo of an edit of a size card, and nothing when the size is the same', () => {
    const undo = new BoardUndo()
    const was = { what: 'tray', value: '186 x 128', unit: 'mm' as const, source: 'measured' as const }
    const now = { ...was, value: '190 x 128', note: 'with the lip' }
    undo.push(snap([card('C1', { kind: 'size', size: was })]), snap([card('C1', { kind: 'size', size: now })]))
    expect(all(undo)).toEqual([{ op: 'edit', id: 'C1', size: was }])
    undo.push(snap([card('C1', { kind: 'size', size: was })]), snap([card('C1', { kind: 'size', size: { ...was } })]))
    expect(undo.undo()).toBeNull()
  })

  it('takes a new size card away for the undo of adding it', () => {
    const undo = new BoardUndo()
    const size = { what: 'tray', value: '186', unit: 'mm' as const, source: 'a guess' as const }
    undo.push(NOTHING, snap([card('C9', { kind: 'size', size })]))
    expect(all(undo)).toEqual([{ op: 'remove', ids: ['C9'] }])
  })

  it('gives a restore by id for the undo of a delete, and the arrows that went with it', () => {
    const undo = new BoardUndo()
    const c = card('C1', { text: 'hello' })
    const a = arrow('C3', 'C1', 'C2')
    undo.push(snap([c], [a]), NOTHING)
    expect(undo.undo()).toEqual({ op: 'restore', ids: ['C1', 'C3'] })
    expect(undo.undo()).toBeNull()
  })

  it('gives an unhide for the undo of a hide, and a remove (a hide again) for the undo of a show', () => {
    const undo = new BoardUndo()
    undo.push(snap([card('C2', { kind: 'mark', by: 'torno' })]), snap([card('C2', { kind: 'mark', by: 'torno', hidden: true })]))
    expect(undo.undo()).toEqual({ op: 'unhide', id: 'C2' })
    undo.push(snap([card('C2', { kind: 'mark', by: 'torno', hidden: true })]), snap([card('C2', { kind: 'mark', by: 'torno' })]))
    expect(undo.undo()).toEqual({ op: 'remove', ids: ['C2'] })
  })

  it('gives the earlier place, size and frame for the undo of a move, a resize or a drop into a frame', () => {
    const undo = new BoardUndo()
    undo.push(snap([card('C1', { x: 5, y: 6 })]), snap([card('C1', { x: 50, y: 60, w: 200, h: 90, frame: 'C9' })]))
    expect(undo.undo()).toEqual({ op: 'move', moves: [{ id: 'C1', x: 5, y: 6, w: 100, h: 60, frame: null }] })
    undo.push(snap([card('C1', { frame: 'C9' })]), snap([card('C1', { x: 30 })]))
    expect(undo.undo()).toEqual({ op: 'move', moves: [{ id: 'C1', x: 0, y: 0, w: 100, h: 60, frame: 'C9' }] })
  })

  it('gives the earlier drawing of a sketch for the undo of drawing on it again', () => {
    const undo = new BoardUndo()
    undo.push(snap([card('C1', { kind: 'sketch', picture: 'p-aaaaaaaaaaaa.png' })]), snap([card('C1', { kind: 'sketch', picture: 'p-bbbbbbbbbbbb.png' })]))
    expect(undo.undo()).toEqual({ op: 'edit', id: 'C1', picture: 'p-aaaaaaaaaaaa.png' })
  })

  it('gives the earlier words for the undo of an edit', () => {
    const undo = new BoardUndo()
    undo.push(snap([card('C1', { text: 'one' })]), snap([card('C1', { text: 'two' })]))
    expect(undo.undo()).toEqual({ op: 'edit', id: 'C1', text: 'one' })
    undo.push(snap([card('C4', { kind: 'frame', name: 'Latch' })]), snap([card('C4', { kind: 'frame', name: 'Snorkel' })]))
    expect(undo.undo()).toEqual({ op: 'edit', id: 'C4', name: 'Latch' })
  })

  it('takes back what was added: a remove for a card, an unarrow for an arrow', () => {
    const undo = new BoardUndo()
    undo.push(snap([]), snap([card('C5')], [arrow('C6', 'C5', 'C1')]))
    expect(all(undo)).toEqual([{ op: 'unarrow', id: 'C6' }, { op: 'remove', ids: ['C5'] }])
  })

  it('puts a deleted frame back before its cards go back in it, and a new frame is taken away after they leave it', () => {
    const undo = new BoardUndo()
    undo.push(snap([card('C1', { kind: 'frame', name: 'F', w: 400, h: 300 }), card('C2', { frame: 'C1' })]), snap([card('C2')]))
    expect(all(undo)).toEqual([
      { op: 'restore', ids: ['C1'] },
      { op: 'move', moves: [{ id: 'C2', x: 0, y: 0, w: 100, h: 60, frame: 'C1' }] }
    ])
    undo.push(snap([card('C2')]), snap([card('C1', { kind: 'frame', name: 'F' }), card('C2', { frame: 'C1' })]))
    expect(all(undo)).toEqual([{ op: 'move', moves: [{ id: 'C2', x: 0, y: 0, w: 100, h: 60, frame: null }] }, { op: 'remove', ids: ['C1'] }])
  })

  it('says only the last change first: two pushes are undone newest first', () => {
    const undo = new BoardUndo()
    undo.push(snap([card('C1', { x: 0 })]), snap([card('C1', { x: 10 })]))
    undo.push(snap([card('C1', { x: 10 })]), snap([card('C1', { x: 20 })]))
    expect(undo.undo()).toEqual({ op: 'move', moves: [{ id: 'C1', x: 10, y: 0, w: 100, h: 60 }] })
    expect(undo.undo()).toEqual({ op: 'move', moves: [{ id: 'C1', x: 0, y: 0, w: 100, h: 60 }] })
  })
})

describe('pick', () => {
  const cards = [card('C1', { kind: 'frame' }), card('C2', { frame: 'C1' }), card('C3'), card('C4')]
  const arrows = [arrow('C5', 'C2', 'C3'), arrow('C6', 'C3', 'C4'), arrow('C7', 'C4', 'C3')]

  it('takes the named cards, the arrows that touch them and the arrows named', () => {
    const got = pick({ cards, arrows }, ['C2', 'C7'])
    expect(got.cards.map((c) => c.id)).toEqual(['C2'])
    expect(got.arrows.map((a) => a.id)).toEqual(['C5', 'C7'])
  })

  it('copies: a later change to the board does not change what was taken', () => {
    const got = pick({ cards, arrows }, ['C3'])
    cards[2].x = 999
    expect(got.cards[0].x).toBe(0)
    cards[2].x = 0
  })
})
