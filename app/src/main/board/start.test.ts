import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_ID, type BoardFile } from '../../shared/board'
import type { SizeFact } from '../../shared/size'
import { listBoardReferences } from '../sessions/reference'
import { readBoardFile, textOf } from './file'
import { CARD_SIZE, reconcile } from './sources'
import { startBoard } from './start'

const size = (what: string): SizeFact => ({ what, value: '186 x 128', unit: 'mm', source: 'measured' })

const full = {
  description: 'A clip for a 6 mm cable.',
  references: [
    { file: 'reference/photo-1.jpg', note: 'the desk edge' },
    { file: 'reference/photo-2.png', note: '' },
    { file: 'reference/doodle-1.png', note: 'the shape (drawn over reference/photo-1.jpg)' },
    { file: 'reference/608zz.step', note: 'bearing' },
    { file: 'reference/datasheet.pdf', note: 'the connector' }
  ],
  sizes: [size('battery tray'), size('lid')],
  rules: 'Print without supports.',
  links: [{ url: 'https://example.com/part', note: 'the vendor page' }, { url: 'http://example.com/b', note: '' }]
}

const frames = (b: BoardFile) => b.cards.filter((c) => c.kind === 'frame')
const inside = (b: BoardFile, name: string) => b.cards.filter((c) => c.frame === frames(b).find((f) => f.name === name)?.id)

describe('startBoard', () => {
  it('makes the frames in order, each with its cards, and nothing for what is empty', () => {
    const board = startBoard(full)
    expect(frames(board).map((f) => f.name)).toEqual(['Brief', 'Photos', 'Sketches', 'Sizes', 'Rules', 'Links', 'Bought parts', 'PDFs'])
    expect(inside(board, 'Brief').map((c) => [c.kind, c.source, c.by])).toEqual([['brief', 'brief', 'torno']])
    expect(inside(board, 'Photos').map((c) => c.source)).toEqual(['reference/photo-1.jpg', 'reference/photo-2.png'])
    expect(inside(board, 'Sketches').map((c) => c.source)).toEqual(['reference/doodle-1.png'])
    expect(inside(board, 'Bought parts').map((c) => c.source)).toEqual(['reference/608zz.step'])
    expect(inside(board, 'PDFs').map((c) => c.source)).toEqual(['reference/datasheet.pdf'])
    expect(inside(board, 'Sizes').map((c) => [c.kind, c.by, c.size?.what])).toEqual([['size', 'person', 'battery tray'], ['size', 'person', 'lid']])
    expect(inside(board, 'Rules').map((c) => [c.kind, c.by, c.text])).toEqual([['text', 'person', 'Print without supports.']])
    expect(inside(board, 'Links').map((c) => [c.kind, c.by, c.text])).toEqual([['text', 'person', 'https://example.com/part\nthe vendor page'], ['text', 'person', 'http://example.com/b']])
    for (const f of frames(board)) expect([f.by, f.frame]).toEqual(['person', undefined])
    expect(board.cards.filter((c) => c.kind !== 'frame').every((c) => c.frame !== undefined)).toBe(true)
  })

  it('makes no frame for what is empty', () => {
    const board = startBoard({ description: 'A clip.', references: [{ file: 'reference/photo-1.jpg', note: '' }], sizes: [], rules: '  \n', links: [] })
    expect(frames(board).map((f) => f.name)).toEqual(['Brief', 'Photos'])
    expect(board.cards).toHaveLength(4)
  })

  it('gives ids C1.., next above the last, and a board the file reader keeps whole', () => {
    const board = startBoard(full)
    expect(board.cards.every((c) => CARD_ID.test(c.id))).toBe(true)
    expect(new Set(board.cards.map((c) => c.id)).size).toBe(board.cards.length)
    expect(board.cards.map((c) => c.id)).toEqual(board.cards.map((_, i) => `C${i + 1}`))
    expect(board.next).toBe(board.cards.length + 1)
    expect(board.arrows).toEqual([])
    const read = readBoardFile(JSON.parse(textOf(board)))
    expect(read?.dropped).toBe(0)
    expect(read?.file).toEqual(board)
  })

  it('lays frames left to right, wrapping at 3200, 40 apart, with every card inside its frame and none touching another', () => {
    const board = startBoard({ ...full, sizes: Array.from({ length: 12 }, (_, i) => size(`s${i}`)) })
    const fs = frames(board)
    for (const f of fs) {
      for (const c of board.cards.filter((k) => k.frame === f.id)) {
        expect(c.x).toBeGreaterThanOrEqual(f.x)
        expect(c.y).toBeGreaterThanOrEqual(f.y)
        expect(c.x + c.w).toBeLessThanOrEqual(f.x + f.w)
        expect(c.y + c.h).toBeLessThanOrEqual(f.y + f.h)
      }
    }
    for (const [i, a] of fs.entries()) {
      expect(a.x + a.w).toBeLessThanOrEqual(3200)
      for (const b of fs.slice(i + 1)) {
        const apart = a.x + a.w + 40 <= b.x || b.x + b.w + 40 <= a.x || a.y + a.h + 40 <= b.y || b.y + b.h + 40 <= a.y
        expect(apart).toBe(true)
      }
    }
    expect(fs[0]).toMatchObject({ x: 0, y: 0 })
    expect(Math.max(...fs.map((f) => f.y))).toBeGreaterThan(0)
    const row = fs.filter((f) => f.y === 0)
    expect(row.length).toBeLessThan(fs.length)
    for (const [i, f] of row.slice(1).entries()) expect(f.x).toBe(row[i].x + row[i].w + 40)
    const cards = board.cards.filter((c) => c.kind !== 'frame')
    for (const [i, a] of cards.entries()) {
      for (const b of cards.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
    }
  })

  it('sets the caption of a reference card to its note, and none for an empty note', () => {
    const board = startBoard(full)
    const refs = board.cards.filter((c) => c.kind === 'reference')
    expect(refs.map((c) => c.caption)).toEqual(full.references.map((r) => r.note || undefined))
    expect(refs.every((c) => c.by === 'torno')).toBe(true)
  })

  it('gives each card the size piece 2 gives its kind', () => {
    const board = startBoard(full)
    for (const c of board.cards.filter((k) => k.kind === 'brief' || k.kind === 'reference' || k.kind === 'size')) {
      expect([c.w, c.h]).toEqual([CARD_SIZE[c.kind as 'brief'].w, CARD_SIZE[c.kind as 'brief'].h])
    }
  })

  it('is what reconcile would make for the folder, so the first open changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-start-'))
    try {
      mkdirSync(join(dir, 'reference'))
      writeFileSync(join(dir, 'brief.md'), '# x\n')
      for (const r of full.references) writeFileSync(join(dir, r.file), 'x')
      // As `follow.ts` finds it.
      const found = { brief: true, references: listBoardReferences(dir).map((name) => `reference/${name}`), marks: [], scans: [] }
      expect(found.references).toHaveLength(full.references.length)
      expect(reconcile(startBoard(full), found)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
