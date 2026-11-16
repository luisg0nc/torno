import { describe, expect, it } from 'vitest'
import { MAX_REFERENCE_COMMENT, MOST_NOTE_REFERENCES, type NoteMark } from '../../../shared/marks'
import { type RefItem, MAX_NOTE_COMMENT, addable, itemsOf, referenceChange, referenceDrafts } from './referenceImages'

const note = { references: [{ file: 'r-0123456789ab.png', comment: 'first' }, { file: 'r-0123456789ac.jpg', comment: 'second' }] } as NoteMark
const fresh = (uid: number, comment = ''): RefItem => ({ uid, comment, old: null, image: { bytes: new Uint8Array([uid]), mediaType: 'image/png' }, url: null })

it('holds a comment to one line of at most 300 characters, and a reference\'s to what a note keeps', () => {
  expect(MAX_NOTE_COMMENT).toBe(300)
  expect(MAX_REFERENCE_COMMENT).toBe(300)
})

describe('itemsOf', () => {
  it('is no item for a new note, and one for each reference of a note, with the comment it has', () => {
    expect(itemsOf(null)).toEqual([])
    expect(itemsOf(note).map((i) => [i.old, i.comment, i.image])).toEqual([[0, 'first', null], [1, 'second', null]])
  })
})

describe('referenceDrafts', () => {
  it('is each picture of a new note with its comment, folded to one line, in order', () => {
    expect(referenceDrafts([fresh(1, ' a\nb '), fresh(2)])).toEqual([
      { bytes: new Uint8Array([1]), mediaType: 'image/png', comment: 'a b' },
      { bytes: new Uint8Array([2]), mediaType: 'image/png', comment: '' }
    ])
  })
})

describe('referenceChange', () => {
  it('is nothing when none was taken away or added', () => {
    expect(referenceChange(itemsOf(note), note)).toEqual({})
  })
  it('keeps the references that stay, by their index, when one is taken away', () => {
    expect(referenceChange(itemsOf(note).slice(1), note)).toEqual({ keepReferences: [1] })
    expect(referenceChange([], note)).toEqual({ keepReferences: [] })
  })
  it('adds the new ones and says which of the old stay', () => {
    expect(referenceChange([...itemsOf(note), fresh(5, 'x')], note)).toEqual({ keepReferences: [0, 1], addReferences: [{ bytes: new Uint8Array([5]), mediaType: 'image/png', comment: 'x' }] })
  })
})

describe('addable', () => {
  it('is how many more a note may have', () => {
    expect(addable(0)).toBe(MOST_NOTE_REFERENCES)
    expect(addable(MOST_NOTE_REFERENCES)).toBe(0)
    expect(addable(MOST_NOTE_REFERENCES + 2)).toBe(0)
  })
})
