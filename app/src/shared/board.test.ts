import { describe, expect, it } from 'vitest'
import { attachLabel, attachSummary, firstLink, type Arrow, type BoardFile, type Card } from './board'

const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, kind: 'text', x: 0, y: 0, w: 100, h: 50, by: 'person', ...extra })
const arrow = (id: string, from: string, to: string): Arrow => ({ id, from, to, by: 'person' })
const board = (cards: Card[], arrows: Arrow[] = []): BoardFile => ({ next: 20, cards, arrows })

const latch = board(
  [card('C1', { kind: 'frame', name: 'Latch' }), card('C2', { frame: 'C1' }), card('C3', { frame: 'C1' }), card('C4'), card('C5', { hidden: true, by: 'torno' })],
  [arrow('C10', 'C2', 'C3'), arrow('C11', 'C3', 'C4'), arrow('C12', 'C4', 'C5')]
)

describe('what an attachment is said to hold', () => {
  it('counts the cards named, not the frames, and the arrows between what is told', () => {
    expect(attachSummary(latch, ['C2', 'C3'])).toEqual({ cards: 2, arrows: 1, frames: [], gone: [] })
    expect(attachSummary(latch, ['C3', 'C4'])).toEqual({ cards: 2, arrows: 1, frames: [], gone: [] })
  })

  it('takes the cards of a frame with it, and names it', () => {
    expect(attachSummary(latch, ['C1'])).toEqual({ cards: 2, arrows: 1, frames: ['Latch'], gone: [] })
  })

  it('is every card that is shown for the whole board', () => {
    expect(attachSummary(latch, 'all')).toEqual({ cards: 3, arrows: 2, frames: ['Latch'], gone: [] })
  })

  it('names what is gone or hidden, and counts none of it', () => {
    expect(attachSummary(latch, ['C2', 'C5', 'C99'])).toEqual({ cards: 1, arrows: 0, frames: [], gone: ['C5', 'C99'] })
  })

  it('leaves out ids that are arrows', () => {
    expect(attachSummary(latch, ['C2', 'C10'])).toEqual({ cards: 1, arrows: 0, frames: [], gone: [] })
  })

  it('is said as a chip says it', () => {
    expect(attachLabel(attachSummary(latch, ['C1']))).toBe('Latch · 2 cards · 1 arrow')
    expect(attachLabel(attachSummary(latch, ['C4']))).toBe('1 card')
    expect(attachLabel(attachSummary(latch, ['C2', 'C3']))).toBe('2 cards · 1 arrow')
    expect(attachLabel(attachSummary(latch, ['C99']))).toBe('0 cards')
  })
})

describe('the link a text card holds', () => {
  it('is the first http or https address, up to the next whitespace', () => {
    expect(firstLink('see https://example.com/a b')).toBe('https://example.com/a')
    expect(firstLink('a\nhttp://x.dev/p?q=1\nhttps://other.dev')).toBe('http://x.dev/p?q=1')
    expect(firstLink('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM')
  })
  it('is nothing for other schemes or no address', () => {
    for (const text of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.dev', 'no link here', '', 'https:/x']) expect(firstLink(text)).toBeNull()
  })
  it('is cut at 2000 characters', () => {
    expect(firstLink(`https://x.dev/${'a'.repeat(3000)}`)).toHaveLength(2000)
  })
})
