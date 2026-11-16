import { describe, expect, it } from 'vitest'
import type { Card } from '../../shared/board'
import { pictureOf } from './boardPictures'

const card = (over: Partial<Card>): Card => ({ id: 'C1', kind: 'text', x: 0, y: 0, w: 1, h: 1, by: 'person', ...over })

describe('which file a card shows', () => {
  it('is a file of the board\'s pictures for a picture, a sketch and a build\'s thumb', () => {
    expect(pictureOf(card({ kind: 'picture', picture: 'p-0123456789ab.png' }))).toEqual({ from: 'board', file: 'p-0123456789ab.png' })
    expect(pictureOf(card({ kind: 'sketch', picture: 'p-0123456789ab.png' }))).toEqual({ from: 'board', file: 'p-0123456789ab.png' })
    expect(pictureOf(card({ kind: 'build', picture: 'p-0123456789ab.jpg' }))).toEqual({ from: 'board', file: 'p-0123456789ab.jpg' })
  })

  it('is a file of reference/ for a reference that is an image', () => {
    expect(pictureOf(card({ kind: 'reference', source: 'reference/photo-1.jpg', by: 'torno' }))).toEqual({ from: 'reference', file: 'reference/photo-1.jpg' })
    expect(pictureOf(card({ kind: 'reference', source: 'reference/doodle-2.png', by: 'torno' }))).toEqual({ from: 'reference', file: 'reference/doodle-2.png' })
  })

  it('is none for anything else', () => {
    expect(pictureOf(card({ kind: 'reference', source: 'reference/608zz.step', by: 'torno' }))).toBeNull()
    expect(pictureOf(card({ kind: 'text', text: 'x' }))).toBeNull()
    expect(pictureOf(card({ kind: 'picture' }))).toBeNull()
  })
})
