import { describe, expect, it } from 'vitest'
import type { BoardFile, Card } from './board'
import { briefSections, RULES_FRAME, rulesSaid, sizesSaid, sizeSource, sizeValue } from './brief'

const card = (id: string, extra: Partial<Card>): Card => ({ id, kind: 'text', x: 0, y: 0, w: 100, h: 100, by: 'person', ...extra })
const board = (cards: Card[]): BoardFile => ({ next: 99, cards, arrows: [] })

describe('briefSections', () => {
  it('sorts the cards of a board into the sheet', () => {
    const b = board([
      card('C1', { kind: 'frame', name: 'Rules', y: 400 }),
      card('C2', { kind: 'brief', by: 'torno', source: 'brief' }),
      card('C3', { kind: 'size', y: 10, size: { what: 'tab hole', value: '6.6', unit: 'mm', source: 'measured' } }),
      card('C4', { kind: 'text', frame: 'C1', text: 'Printed in ABS', y: 410 }),
      card('C5', { kind: 'text', text: 'ask about the screws', y: 900 }),
      card('C6', { kind: 'reference', by: 'torno', source: 'reference/photo-1.jpg', y: 5 }),
      card('C7', { kind: 'picture', picture: 'p-0123456789ab.png', y: 6 }),
      card('C8', { kind: 'reference', by: 'torno', source: 'reference/608zz.step', y: 7 }),
      card('C9', { kind: 'mark', by: 'torno', source: 'M1', y: 8 }),
      card('C10', { kind: 'size', y: 20, hidden: true, by: 'torno', size: { what: 'gone', value: '1', unit: 'mm', source: 'a guess' } })
    ])
    const s = briefSections(b)
    expect(s.hasWhat).toBe(true)
    expect(s.sizes.map((c) => c.id)).toEqual(['C3'])
    expect(s.rules.map((c) => c.id)).toEqual(['C4'])
    expect(s.notes.map((c) => c.id)).toEqual(['C5'])
    expect(s.pictures.map((c) => c.id)).toEqual(['C6', 'C7'])
    expect(s.references.map((c) => c.id)).toEqual(['C8'])
  })

  it('leaves out hidden cards, and the old copies of marks, builds and the rest, without losing them', () => {
    const b = board([card('C1', { kind: 'build' }), card('C2', { kind: 'scan', by: 'torno' }), card('C3', { kind: 'text', hidden: true, by: 'torno' })])
    const s = briefSections(b)
    expect([s.sizes, s.rules, s.notes, s.pictures, s.references].every((l) => l.length === 0)).toBe(true)
    expect(s.hasWhat).toBe(false)
  })

  it('reads the Rules frame by name whatever its case, and a doodle among the pictures', () => {
    const b = board([card('C1', { kind: 'frame', name: ' RULES ' }), card('C2', { kind: 'text', frame: 'C1', text: 'x' }), card('C3', { kind: 'sketch', picture: 'p-0123456789ab.png' })])
    const s = briefSections(b)
    expect(s.rules).toHaveLength(1)
    expect(s.pictures.map((c) => c.id)).toEqual(['C3'])
    expect(s.rulesFrame).toBe('C1')
    expect(RULES_FRAME).toBe('rules')
  })

  it('lists what main made and the person put away, to be shown again', () => {
    const b = board([card('C1', { kind: 'reference', by: 'torno', hidden: true, source: 'reference/photo-1.jpg' }), card('C2', { kind: 'mark', by: 'torno', hidden: true })])
    const s = briefSections(b)
    expect(s.hidden.map((c) => c.id)).toEqual(['C1'])
    expect(s.pictures).toEqual([])
  })

  it('has no rules frame to put a rule in when the board has none', () => {
    expect(briefSections(board([])).rulesFrame).toBeNull()
  })
})

describe('what the ledger says of a size', () => {
  const size = (value: string, over = {}) => ({ what: 'w', value, unit: 'mm' as const, source: 'measured' as const, ...over })
  it('shows the numbers read from the value, and the value as typed when it holds none', () => {
    expect(sizeValue(size('Ø6,6'))).toBe('Ø 6.6')
    expect(sizeValue(size('186 x 128 mm'))).toBe('186 × 128')
    expect(sizeValue(size('about 60 mm'))).toBe('about 60')
    expect(sizeValue(size('mm'))).toBe('mm')
  })
  it('says where it came from, with the note after', () => {
    expect(sizeSource(size('1', { source: 'from a manual or datasheet', note: 'photo-1.jpg' }))).toBe('from a datasheet · photo-1.jpg')
    expect(sizeSource(size('1', { source: 'a guess' }))).toBe('a guess')
  })
  it('counts every size as not checked until something checks it', () => {
    expect(sizesSaid(7)).toBe('7 sizes, 7 not checked')
    expect(sizesSaid(1)).toBe('1 size, 1 not checked')
    expect(sizesSaid(0)).toBe('none yet')
    expect(rulesSaid(3)).toBe('3 rules, 3 not checked')
  })
})
