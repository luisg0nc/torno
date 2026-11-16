import { describe, expect, it } from 'vitest'
import { boardCountsSaid, boardSentSaid } from './boardLine'

describe('the line of the board under a prompt', () => {
  it('says how many cards there are and how many are new, or only the cards when none is', () => {
    expect(boardCountsSaid({ total: 12, new: 2 })).toBe('board: 12 cards, 2 new')
    expect(boardCountsSaid({ total: 1, new: 0 })).toBe('board: 1 card')
    expect(boardCountsSaid({ total: 3, new: 3 })).toBe('board: 3 cards, 3 new')
  })

  it('says nothing of a board with no card on it', () => {
    expect(boardCountsSaid({ total: 0, new: 0 })).toBeNull()
  })

  it('says what was attached: the frames, the cards and the arrows', () => {
    expect(boardSentSaid({ cards: 2, arrows: 0, frames: [] })).toBe('board: 2 cards')
    expect(boardSentSaid({ cards: 3, arrows: 1, frames: ['Latch'] })).toBe('board: Latch, 3 cards, 1 arrow')
  })

  it('says which of the cards chosen were gone by the time it was sent', () => {
    expect(boardSentSaid({ cards: 1, arrows: 0, frames: [], gone: ['C4'] })).toBe('board: 1 card (C4 was removed before it was sent)')
    expect(boardSentSaid({ cards: 0, arrows: 0, frames: [], gone: ['C4', 'C5'] })).toBe('board: 0 cards (C4, C5 were removed before it was sent)')
  })
})
