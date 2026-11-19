import { describe, expect, it } from 'vitest'
import { refPieces } from './refPieces'

describe('refPieces', () => {
  it('sets the refs apart from the words', () => {
    expect(refPieces('see M3 and C7, not Mx')).toEqual([{ text: 'see ' }, { text: 'M3', ref: true }, { text: ' and ' }, { text: 'C7', ref: true }, { text: ', not Mx' }])
    expect(refPieces('plain')).toEqual([{ text: 'plain' }])
  })
})
