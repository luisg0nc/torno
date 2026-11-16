import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BoardFile } from '../../shared/board'
import { loadBoardFile, readBoardFile, saveBoardFile } from './file'

const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'text', x: 0, y: 0, w: 100, h: 50, by: 'person', text: 'hi', ...extra })

describe('readBoardFile', () => {
  it('keeps a whole file as it is', () => {
    const file = { next: 4, cards: [card('C1', { kind: 'frame', name: 'Latch' }), card('C2', { frame: 'C1' })], arrows: [{ id: 'C3', from: 'C1', to: 'C2', label: 'in', by: 'agent' }] }
    expect(readBoardFile(file)).toEqual({ file, dropped: 0 })
  })

  it('is not a board file when it is not an object with cards', () => {
    expect(readBoardFile(null)).toBeNull()
    expect(readBoardFile([])).toBeNull()
    expect(readBoardFile({ next: 1 })).toBeNull()
  })

  it('drops a card with a bad id, an unknown kind, a number that is not finite, or an unknown author', () => {
    const read = readBoardFile({
      next: 9,
      cards: [card('C1'), card('c2'), card('C0'), card('C3', { kind: 'gizmo' }), card('C4', { x: null }), card('C5', { w: Infinity }), card('C6', { by: 'someone' }), card('C7', { h: 'tall' })],
      arrows: []
    })
    expect(read?.file.cards.map((c) => c.id)).toEqual(['C1'])
    expect(read?.dropped).toBe(7)
  })

  it('drops a card whose frame names no frame, and one that follows it, and an arrow with an end that is gone', () => {
    const read = readBoardFile({
      next: 9,
      cards: [card('C1'), card('C2', { frame: 'C9' }), card('C3', { kind: 'frame', name: 'F', frame: 'C2' }), card('C4', { frame: 'C3' }), card('C5', { frame: 'C1' })],
      arrows: [{ id: 'C6', from: 'C1', to: 'C4', by: 'person' }, { id: 'C7', from: 'C1', to: 'C8', by: 'person' }]
    })
    // C2 is framed by a card that is not there; C3 sits in C2, C4 in C3; C5's frame C1 is a text, not a frame.
    expect(read?.file.cards.map((c) => c.id)).toEqual(['C1'])
    expect(read?.file.arrows).toEqual([])
  })

  it('keeps each id once', () => {
    const read = readBoardFile({ next: 5, cards: [card('C1', { text: 'first' }), card('C1', { text: 'second' })], arrows: [] })
    expect(read?.file.cards).toHaveLength(1)
    expect(read?.file.cards[0].text).toBe('first')
  })

  it('never lets next sit at or below an id in use, arrows included', () => {
    expect(readBoardFile({ next: 1, cards: [card('C7')], arrows: [] })?.file.next).toBe(8)
    expect(readBoardFile({ next: 'x', cards: [card('C1'), card('C2')], arrows: [{ id: 'C5', from: 'C1', to: 'C2', by: 'person' }] })?.file.next).toBe(6)
    expect(readBoardFile({ next: 30, cards: [card('C1')], arrows: [] })?.file.next).toBe(30)
  })

  it('keeps a whole size on a size card, and drops a size from any other kind', () => {
    const size = { what: 'battery tray', value: '186 x 128', unit: 'mm', source: 'measured', note: 'by the lid' }
    const read = readBoardFile({ next: 3, cards: [card('C1', { kind: 'size', text: undefined, size }), card('C2', { size })], arrows: [] })
    expect(read?.dropped).toBe(0)
    expect(read?.file.cards[0].size).toEqual(size)
    expect(read?.file.cards[1].size).toBeUndefined()
    expect(Object.keys(read?.file.cards[1] ?? {})).not.toContain('size')
  })

  it('drops a size card whose size is missing or not whole, and keeps only the fields a size has', () => {
    const good = { what: 'tray', value: '186', unit: 'mm', source: 'a guess' }
    const read = readBoardFile({
      next: 9,
      cards: [
        card('C1', { kind: 'size', size: { ...good, extra: 1 } }),
        card('C2', { kind: 'size' }),
        card('C3', { kind: 'size', size: { ...good, unit: 'cm' } }),
        card('C4', { kind: 'size', size: { ...good, what: 'w'.repeat(201) } }),
        card('C5', { kind: 'size', size: { ...good, source: 'from Claude' } }),
        card('C6', { kind: 'size', by: 'agent', size: { ...good, source: 'from Claude' } })
      ],
      arrows: []
    })
    expect(read?.file.cards.map((c) => c.id)).toEqual(['C1', 'C6'])
    expect(read?.file.cards[0].size).toEqual(good)
    expect(read?.dropped).toBe(4)
  })

  it('drops a field of the wrong shape and keeps the card', () => {
    const read = readBoardFile({ next: 2, cards: [card('C1', { text: 5, hidden: false, picture: '../x.png', camera: { position: [1] } })], arrows: [] })
    expect(read?.file.cards[0]).toEqual(card('C1', { text: undefined }))
    expect(Object.keys(read?.file.cards[0] ?? {})).not.toContain('picture')
  })
})

describe('the file', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'torno-board-file-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const path = (): string => join(dir, '.torno', 'board', 'board.json')

  it('reads a missing file as an empty board and writes nothing', async () => {
    expect((await loadBoardFile(dir)).file).toEqual({ next: 1, cards: [], arrows: [] })
    expect(() => readdirSync(join(dir, '.torno'))).toThrow()
  })

  it('writes under .torno/board and reads back what it wrote', async () => {
    const board: BoardFile = { next: 3, cards: [card('C1') as never, card('C2', { kind: 'frame', name: 'F' }) as never], arrows: [] }
    await saveBoardFile(dir, board)
    expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual(board)
    expect((await loadBoardFile(dir)).file).toEqual(board)
  })

  it('keeps a file it cannot read aside and starts again, its ids going on from the highest it shows', async () => {
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    writeFileSync(path(), '{"next": 2, "cards": [{"id": "C11" ')
    const { file, problem } = await loadBoardFile(dir, () => new Date('2026-11-16T10:00:00.000Z'))
    expect(file).toEqual({ next: 12, cards: [], arrows: [] })
    expect(problem).toMatch(/board file/)
    const names = readdirSync(join(dir, '.torno', 'board'))
    expect(names).toContain('board.json.corrupt-2026-11-16T10-00-00-000Z')
    expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual(file)
  })

  it('keeps a copy of a file with cards left out, and rewrites it', async () => {
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    writeFileSync(path(), JSON.stringify({ next: 3, cards: [card('C1'), card('bad')], arrows: [] }))
    const { file, problem } = await loadBoardFile(dir, () => new Date('2026-11-16T10:00:00.000Z'))
    expect(file.cards.map((c) => c.id)).toEqual(['C1'])
    expect(problem).toMatch(/1 card/)
    expect(readdirSync(join(dir, '.torno', 'board'))).toContain('board.json.dropped-2026-11-16T10-00-00-000Z')
  })

  it('does not read a board.json that is a link, nor copy what it leads to', async () => {
    const { symlinkSync } = await import('node:fs')
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    writeFileSync(join(dir, 'secret.txt'), 'not a board')
    symlinkSync(join(dir, 'secret.txt'), path())
    const { file, problem, text } = await loadBoardFile(dir)
    expect(file).toEqual({ next: 1, cards: [], arrows: [] })
    expect(problem).toMatch(/not a plain file/)
    expect(text).toBeNull()
    expect(readdirSync(join(dir, '.torno', 'board'))).toEqual(['board.json'])
  })

  it('refuses to write through a link in the place of .torno/board', async () => {
    const { symlinkSync } = await import('node:fs')
    mkdirSync(join(dir, '.torno'))
    mkdirSync(join(dir, 'elsewhere'))
    symlinkSync(join(dir, 'elsewhere'), join(dir, '.torno', 'board'))
    await expect(saveBoardFile(dir, { next: 1, cards: [], arrows: [] })).rejects.toThrow(/link/)
    expect(readdirSync(join(dir, 'elsewhere'))).toEqual([])
  })
})
