import { describe, expect, it } from 'vitest'
import type { BoardFile, Card } from './board'
import { briefSections, RULES_FRAME } from './brief'

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

  it('has no rules frame to put a rule in when the board has none', () => {
    expect(briefSections(board([])).rulesFrame).toBeNull()
  })
})
