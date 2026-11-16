import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Arrow, type BoardFile, type Card, MAX_BOARD_PICTURES, readingOrder } from '../../shared/board'
import type { Mark } from '../../shared/marks'
import { BoardStore } from './store'
import { type LiveFacts, boardLine, boardText, saysHash } from './text'

let n = 0
const card = (over: Partial<Card> & Pick<Card, 'kind'>): Card => ({ id: `C${++n}`, x: 0, y: 0, w: 200, h: 100, by: 'person', ...over })
const board = (cards: Card[], arrows: Arrow[] = []): BoardFile => ({ next: 1000, cards, arrows })
const LIVE: LiveFacts = { marks: new Map() }
const FILE = (name: string): Card => card({ kind: 'picture', picture: `p-${name.padEnd(12, '0')}.png`, caption: `caption ${name}` })
const OPTS = { limit: 12_000 }

beforeEach(() => {
  n = 0
})

describe('the reading order', () => {
  it('reads a grid with jittered tops row by row, left to right', () => {
    // 3 columns by 2 rows; the tops of one row differ by up to 30 (under half of 100).
    const cards = [
      card({ kind: 'text', x: 0, y: 5, text: 'a' }),
      card({ kind: 'text', x: 220, y: 30, text: 'b' }),
      card({ kind: 'text', x: 440, y: 0, text: 'c' }),
      card({ kind: 'text', x: 0, y: 230, text: 'd' }),
      card({ kind: 'text', x: 220, y: 200, text: 'e' }),
      card({ kind: 'text', x: 440, y: 215, text: 'f' })
    ]
    // Given in no order at all.
    const shuffled = [cards[4], cards[0], cards[5], cards[2], cards[3], cards[1]]
    expect(readingOrder(shuffled).map((c) => c.text)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
  it('puts each frame first with its cards, then the cards in no frame, and leaves hidden ones out', () => {
    const f = card({ kind: 'frame', name: 'Latch', x: 500, y: 0 })
    const inside = card({ kind: 'text', text: 'in', frame: f.id, x: 600, y: 50 })
    const loose = card({ kind: 'text', text: 'loose', x: 0, y: 0 })
    const gone = card({ kind: 'brief', by: 'torno', hidden: true, x: 0, y: 300 })
    expect(readingOrder([loose, inside, gone, f]).map((c) => c.id)).toEqual([f.id, inside.id, loose.id])
  })
})

describe('the text of a board', () => {
  it('says a STEP or a PDF of reference/ with what it is, and its caption', () => {
    const step = card({ kind: 'reference', by: 'torno', source: 'reference/608zz.step', caption: 'the bearing, 22 mm', x: 0 })
    const pdf = card({ kind: 'reference', by: 'torno', source: 'reference/datasheet.pdf', x: 300 })
    const photo = card({ kind: 'reference', by: 'torno', source: 'reference/photo-1.jpg', x: 600 })
    const out = boardText(board([step, pdf, photo]), LIVE, OPTS)
    expect(out.text).toContain(`${step.id} · reference · by torno\nreference/608zz.step (a bought part's STEP)\nthe bearing, 22 mm`)
    expect(out.text).toContain(`${pdf.id} · reference · by torno\nreference/datasheet.pdf (a PDF: read it with your own tools)\n\n`)
    expect(out.text).toContain(`${photo.id} · reference · by torno\nreference/photo-1.jpg\n[picture ${photo.id}: of reference/photo-1.jpg]`)
    expect(out.pictures.map((p) => p.card)).toEqual([photo.id])
  })
  it('says the caption of a photo or a doodle of reference/ after its name, before its picture', () => {
    const photo = card({ kind: 'reference', by: 'torno', source: 'reference/photo-1.jpg', caption: 'the desk edge', x: 0 })
    const doodle = card({ kind: 'reference', by: 'torno', source: 'reference/doodle-1.png', caption: 'the shape (drawn over reference/photo-1.jpg)', x: 300 })
    const out = boardText(board([photo, doodle]), LIVE, OPTS)
    expect(out.text).toContain(`${photo.id} · reference · by torno\nreference/photo-1.jpg\nthe desk edge\n[picture ${photo.id}: of reference/photo-1.jpg]`)
    expect(out.text).toContain(`${doodle.id} · reference · by torno\nreference/doodle-1.png\nthe shape (drawn over reference/photo-1.jpg)\n[picture ${doodle.id}: of reference/doodle-1.png]`)
    expect(saysHash({ ...photo, caption: 'another note' }, LIVE)).not.toBe(saysHash(photo, LIVE))
  })
  it('counts a changed caption of a STEP as news, and a move as none', () => {
    const step = card({ kind: 'reference', by: 'torno', source: 'reference/608zz.step' })
    const was = saysHash(step, LIVE)
    expect(saysHash({ ...step, x: 90 }, LIVE)).toBe(was)
    expect(saysHash({ ...step, caption: 'new note' }, LIVE)).not.toBe(was)
  })
  it('has a block for each card, and the arrows after them', () => {
    const a = card({ kind: 'text', text: 'wall 2 mm', x: 0 })
    const b = card({ kind: 'text', text: 'like this', x: 300, by: 'agent' })
    const out = boardText(board([a, b], [{ id: 'C90', from: a.id, to: b.id, label: 'like this', by: 'person' }]), LIVE, OPTS)
    expect(out.text).toContain(`${a.id} · text · by the person\nwall 2 mm`)
    expect(out.text).toContain(`${b.id} · text · by you\nlike this`)
    expect(out.text.split('\n').at(-1)).toBe(`${a.id} → ${b.id}: like this`)
    expect(out.text).toContain('Arrows:')
  })
  it('leaves a hidden card, and the arrows to it, out', () => {
    const shown = card({ kind: 'text', text: 'shown' })
    const hidden = card({ kind: 'brief', by: 'torno', hidden: true, source: 'brief' })
    const out = boardText(board([shown, hidden], [{ id: 'C90', from: shown.id, to: hidden.id, by: 'person' }]), { ...LIVE, brief: 'SECRET BRIEF' }, OPTS)
    expect(out.text).not.toContain(hidden.id)
    expect(out.text).not.toContain('SECRET')
    expect(out.text).not.toContain('Arrows')
  })
  it('says a mark, a build, the Params and the checks from what is live', () => {
    const mark = { id: 'M3', kind: 'dimension', author: 'user', note: 'wall', status: 'draft', a: { point: [0, 0, 0], ref: 'lid/F12' } } as unknown as Mark
    const cards = [
      card({ kind: 'mark', by: 'torno', source: 'M3' }),
      card({ kind: 'build', copy: { id: 'h4', line: 'r4 ok, 0.8 s', cause: 'edit', sources: 'abc' } }),
      card({ kind: 'params', source: 'params' }),
      card({ kind: 'checks', source: 'checks' }),
      card({ kind: 'brief', by: 'torno', source: 'brief' })
    ]
    const live: LiveFacts = {
      marks: new Map([['M3', mark]]),
      params: [{ name: 'wall', type: 'float', default: 2, literal: true, doc: null, value: 2.4 }],
      tried: { wall: { value: 2.4, default: 2 } },
      checks: [{ name: 'lid fits', kind: 'gap', status: 'pass', value: 0.2, unit: 'mm', min: 0.15, max: 0.25 }],
      brief: 'A bracket for a pipe.'
    }
    const { text } = boardText(board(cards), live, OPTS)
    expect(text).toContain('M3 (dimension, on lid/F12): wall, draft')
    expect(text).toContain('h4')
    expect(text).toContain('r4 ok, 0.8 s')
    expect(text).toContain('wall 2.4 (tried; file 2)')
    expect(text).toContain('lid fits (0.2 mm, wanted 0.15 to 0.25 mm)')
    expect(text).toContain('A bracket for a pipe.')
  })
  it('says a picture by its caption', () => {
    const p = card({ kind: 'picture', picture: 'p-aaaaaaaaaaaa.png', caption: 'the old latch' })
    expect(boardText(board([p]), LIVE, OPTS).text).toContain(`[picture ${p.id}: the old latch]`)
  })

  it('attaches six pictures of a frame with ten, and names the other four', () => {
    const f = card({ kind: 'frame', name: 'Latch' })
    const pics = Array.from({ length: 10 }, (_, i) => ({ ...FILE(`a${i}`), frame: f.id, x: i * 10 }))
    const out = boardText(board([f, ...pics]), LIVE, { only: [f.id], limit: 12_000 })
    expect(out.pictures).toHaveLength(MAX_BOARD_PICTURES)
    expect(out.pictures.map((p) => p.card)).toEqual(pics.slice(0, 6).map((p) => p.id))
    expect(out.leftOut).toEqual(pics.slice(6).map((p) => p.id))
    for (const p of pics) expect(out.text).toContain(`[picture ${p.id}`)
  })
  it('names a picture whose file is not on this computer, and does not attach it', () => {
    const a = FILE('here')
    const b = FILE('gone')
    const out = boardText(board([a, b]), LIVE, { ...OPTS, exists: (file) => file === a.picture })
    expect(out.pictures).toEqual([{ card: a.id, file: a.picture }])
    expect(out.leftOut).toEqual([])
    expect(out.text).toContain(`[picture ${b.id}: caption gone, picture not on this computer]`)
  })
  it('takes only the frames and cards asked for', () => {
    const f = card({ kind: 'frame', name: 'Latch' })
    const inside = card({ kind: 'text', text: 'in', frame: f.id })
    const other = card({ kind: 'text', text: 'other' })
    const some = boardText(board([f, inside, other]), LIVE, { only: [f.id], limit: 12_000 }).text
    expect(some).toContain('in')
    expect(some).not.toContain('other')
    const one = boardText(board([f, inside, other]), LIVE, { only: [other.id], limit: 12_000 }).text
    expect(one).toContain('other')
    expect(one).not.toContain(inside.id)
  })
  it('counts the cards and arrows it tells and names the frames, by name or else by id', () => {
    const f = card({ kind: 'frame', name: 'Latch' })
    const bare = card({ kind: 'frame', x: 900 })
    const a = card({ kind: 'text', text: 'a', frame: f.id })
    const b = card({ kind: 'text', text: 'b', frame: f.id, x: 300 })
    const other = card({ kind: 'text', text: 'other', x: 1500 })
    const arrow: Arrow = { id: 'C90', from: a.id, to: b.id, by: 'person' }
    const out = boardText(board([f, bare, a, b, other], [arrow, { id: 'C91', from: a.id, to: other.id, by: 'person' }]), LIVE, { only: [f.id, bare.id], limit: 12_000 })
    expect(out.counts).toEqual({ cards: 2, arrows: 1, frames: ['Latch', bare.id] })
    expect(boardText(board([f, a]), LIVE, OPTS).counts).toEqual({ cards: 1, arrows: 0, frames: ['Latch'] })
  })
  it('counts only what a cut left in', () => {
    const cards = Array.from({ length: 4 }, (_, i) => card({ kind: 'text', x: i * 10, y: i * 400, text: `${i}`.repeat(3_400) }))
    const out = boardText(board(cards, [{ id: 'C90', from: cards[0].id, to: cards[1].id, by: 'person' }]), LIVE, OPTS)
    expect(out.counts.cards).toBe(3)
    expect(out.counts.arrows).toBe(0)
  })
  it('ends at the limit with the sentence that says to read the rest with board', () => {
    const cards = Array.from({ length: 4 }, (_, i) => card({ kind: 'text', x: i * 10, y: i * 400, text: `${i}`.repeat(3_400) }))
    const out = boardText(board(cards), LIVE, OPTS)
    expect(out.text.length).toBeLessThanOrEqual(12_000)
    expect(out.text.endsWith('The rest of the board is cut here: read it with board.')).toBe(true)
    expect(out.text).toContain(cards[0].id)
    expect(out.text).not.toContain('3'.repeat(100))
    // A board that fits has no such sentence.
    expect(boardText(board(cards.slice(0, 2)), LIVE, OPTS).text).not.toContain('cut here')
  })
})

describe('what is new', () => {
  const text = (over: Partial<Card> = {}): Card => card({ kind: 'text', text: 'wall 2 mm', ...over })

  it('is nothing for an empty board', () => {
    expect(boardLine(board([]), {}, LIVE)).toEqual({ line: '', told: {} })
    expect(boardLine(board([text({ hidden: true } as Partial<Card>)]), {}, LIVE).line).toBe('')
  })
  it('counts a new text card, then not once it was told, not when it was only moved, and again when its words change', () => {
    const t = text()
    const first = boardLine(board([t]), {}, LIVE)
    expect(first.line).toBe(`Board: 1 card (1 new: ${t.id} text). Read it with board.`)
    const again = boardLine(board([t]), first.told, LIVE)
    expect(again.line).toBe('Board: 1 card (0 new). Read it with board.')
    expect(boardLine(board([{ ...t, x: 900, y: 40, w: 50 }]), first.told, LIVE).line).toContain('0 new')
    expect(boardLine(board([{ ...t, text: 'wall 3 mm' }]), first.told, LIVE).line).toContain(`1 new: ${t.id} text`)
  })
  it('says how many cards and how many are new as data, and nothing for an empty board', () => {
    const t = text()
    const first = boardLine(board([t, text({ by: 'agent' })]), {}, LIVE)
    expect(first.counts).toEqual({ total: 2, new: 1 })
    expect(boardLine(board([t]), first.told, LIVE).counts).toEqual({ total: 1, new: 0 })
    expect(boardLine(board([]), {}, LIVE).counts).toBeUndefined()
  })
  it('does not count a mark card or a card of Claude, and does not count a move into a frame', () => {
    const f = card({ kind: 'frame', name: 'Latch' })
    const t = text()
    const m = card({ kind: 'mark', by: 'torno', source: 'M1' })
    const mine = text({ by: 'agent', text: 'my plan' })
    const told = boardLine(board([f, t]), {}, LIVE).told
    const out = boardLine(board([f, { ...t, frame: f.id }, m, mine]), told, LIVE)
    expect(out.line).toBe('Board: 3 cards (0 new), frames Latch. Read it with board.')
  })
  it('names what a new card is, and how many are left out of the naming', () => {
    const cards = [card({ kind: 'picture', picture: 'p-aaaaaaaaaaaa.png' }), text(), card({ kind: 'sketch', picture: 'p-bbbbbbbbbbbb.png' }), card({ kind: 'frame', name: 'Latch' }), card({ kind: 'frame', name: 'Snorkel' })]
    const line = boardLine(board(cards), {}, LIVE).line
    // Frames are read first, then the rest.
    expect(line).toBe(`Board: 3 cards (5 new: ${cards[3].id} a frame, ${cards[4].id} a frame, ${cards[0].id} a photo, ${cards[1].id} text, ${cards[2].id} a sketch), frames Latch, Snorkel. Read it with board.`)
  })
  it('takes a pinned card as new when what its source says changes', () => {
    const params = card({ kind: 'params', source: 'params' })
    const before = boardLine(board([params]), {}, { marks: new Map(), params: [{ name: 'wall', type: 'float', default: 2, literal: true, doc: null, value: 2 }] })
    expect(boardLine(board([params]), before.told, { marks: new Map(), params: [{ name: 'wall', type: 'float', default: 2, literal: true, doc: null, value: 2 }] }).line).toContain('0 new')
    expect(boardLine(board([params]), before.told, { marks: new Map(), params: [{ name: 'wall', type: 'float', default: 2, literal: true, doc: null, value: 3 }] }).line).toContain(`1 new: ${params.id} the Params`)
  })
  it('counts a new arrow, and the word on it changing', () => {
    const a = text()
    const b = text({ x: 300 })
    const arrow: Arrow = { id: 'C80', from: a.id, to: b.id, by: 'person' }
    const told = boardLine(board([a, b]), {}, LIVE).told
    expect(boardLine(board([a, b], [arrow]), told, LIVE).line).toContain('1 new: C80 an arrow')
    const both = boardLine(board([a, b], [arrow]), told, LIVE).told
    expect(boardLine(board([a, b], [arrow]), both, LIVE).line).toContain('0 new')
    expect(boardLine(board([a, b], [{ ...arrow, label: 'bigger' }]), both, LIVE).line).toContain('1 new: C80 an arrow')
  })
  it('hashes what a card says, not where it is', () => {
    const t = text()
    expect(saysHash({ ...t, x: 5, y: 9, frame: 'C99' }, LIVE)).toBe(saysHash(t, LIVE))
    expect(saysHash({ ...t, text: 'other' }, LIVE)).not.toBe(saysHash(t, LIVE))
  })
})

describe('what was told, kept by the store', () => {
  let root: string
  let dir: string
  let store: BoardStore
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'torno-board-told-'))
    dir = join(root, 'bracket')
    mkdirSync(dir)
    store = new BoardStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads as nothing, keeps what it is given, and git passes over the file', async () => {
    expect(await store.told('bracket')).toEqual({})
    await store.markTold('bracket', { C1: 'abc' })
    expect(await store.told('bracket')).toEqual({ C1: 'abc' })
    expect(JSON.parse(readFileSync(join(dir, '.torno', 'board', 'told.json'), 'utf8'))).toEqual({ C1: 'abc' })
    expect(readFileSync(join(dir, '.torno', '.gitignore'), 'utf8').split('\n')).toContain('board/told.json')
    expect(existsSync(join(dir, '.torno', 'board', 'told.json.tmp'))).toBe(false)
  })
  it('is read as nothing from a file that is no map of text', async () => {
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    await import('node:fs/promises').then((fs) => fs.writeFile(join(dir, '.torno', 'board', 'told.json'), '[1,2]'))
    expect(await store.told('bracket')).toEqual({})
  })
})

describe('a size card', () => {
  const size = (over: Partial<Card> = {}): Card => card({ kind: 'size', size: { what: 'battery tray', value: '186 x 128', unit: 'mm', source: 'measured' }, ...over })

  it('says what it measures, the numbers, the unit and the source, with the numbers in full after it', () => {
    const c = size()
    const out = boardText(board([c]), LIVE, OPTS)
    expect(out.text).toBe(`${c.id} · size · by the person: battery tray 186 × 128 mm (measured)\nnumbers: [186, 128]`)
  })
  it('says a size of Claude\'s and a note, and tells where it is', () => {
    const f = card({ kind: 'frame', name: 'Sizes' })
    const c = size({ by: 'agent', frame: f.id, size: { what: 'snorkel hole', value: 'Ø62,5', unit: 'mm', source: 'from Claude', note: 'by eye' } })
    const out = boardText(board([f, c]), LIVE, OPTS)
    expect(out.text).toContain(`${c.id} · size · by you · in Sizes: snorkel hole Ø 62.5 mm (from Claude: by eye)\nnumbers: [62.5]`)
  })
  it('gives no numbers for a value that is none', () => {
    const out = boardText(board([size({ size: { what: 'gap', value: 'about 60', unit: 'mm', source: 'a guess' } })]), LIVE, OPTS)
    expect(out.text).toContain('gap about 60 mm (as typed, a guess)')
    expect(out.text).not.toContain('numbers')
  })
  it('is news when what it says changes, and not when it is moved', () => {
    const c = size()
    const before = saysHash(c, LIVE)
    expect(saysHash({ ...c, x: 500, y: 40, w: 300 }, LIVE)).toBe(before)
    expect(saysHash({ ...c, size: { ...(c.size as NonNullable<Card['size']>), value: '190 x 128' } }, LIVE)).not.toBe(before)
    expect(boardLine(board([c]), {}, LIVE).line).toContain(`${c.id} a size`)
  })
})
