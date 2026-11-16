import { describe, expect, it } from 'vitest'
import { Refusal } from '../refusal'
import { MOST_STROKES_TOLD } from '../../shared/drawing'
import { checkNoteDraft, checkNoteEdit } from './check'
import { CAMERA, UNDER, draft, jpeg, png } from './testing'

const refused = (raw: unknown, reason: RegExp): void => {
  const checked = checkNoteDraft(raw)
  expect(checked).toBeInstanceOf(Refusal)
  expect((checked as Refusal).message).toMatch(reason)
}

describe('checkNoteDraft', () => {
  it('takes what a window sends of a note', () => {
    const checked = checkNoteDraft(draft())
    expect(checked).not.toBeInstanceOf(Refusal)
    expect(checked).toMatchObject({ objectId: 'bracket', revision: 3, layout: 'assembly', size: { w: 800, h: 600 }, inkColour: '#ff00ff', comment: 'make this wall thicker' })
    expect((checked as { references: unknown[] }).references).toHaveLength(1)
  })

  it('refuses what is no object', () => {
    refused(null, /not one/)
    refused('note', /not one/)
    refused([], /not one/)
  })

  it('refuses a picture that is not a PNG, or too big, or too long an edge', () => {
    refused(draft({ plain: new Uint8Array(100) }), /plain picture/)
    refused(draft({ plain: 'bytes' }), /plain picture/)
    refused(draft({ inked: jpeg(800, 600) }), /inked picture/)
    refused(draft({ plain: png(2001, 600) }), /plain picture/)
    refused(draft({ plain: png(2001, 600), inked: png(2001, 600), size: { w: 2001, h: 600 } }), /size/)
    refused(draft({ plain: new Uint8Array(3_750_001) }), /plain picture/)
  })

  it('refuses a picture that is not of the size it says', () => {
    refused(draft({ plain: png(640, 480) }), /size/)
    refused(draft({ inked: png(800, 601) }), /size/)
    refused(draft({ size: { w: 800.5, h: 600 } }), /size/)
    refused(draft({ size: { w: 0, h: 600 } }), /size/)
  })

  it('refuses ink that is not a colour', () => {
    refused(draft({ inkColour: '#zzzzzz' }), /ink/)
    refused(draft({ inkColour: 'magenta' }), /ink/)
  })

  it('holds the labels to 20 of at most 200 characters on one line', () => {
    const label = { x: 5, y: 5, text: 'a' }
    expect(checkNoteDraft(draft({ labels: Array.from({ length: 20 }, () => label), under: [] }))).not.toBeInstanceOf(Refusal)
    refused(draft({ labels: Array.from({ length: 21 }, () => label), under: [] }), /labels/)
    expect(checkNoteDraft(draft({ labels: [{ ...label, text: 'a'.repeat(200) }], under: [] }))).not.toBeInstanceOf(Refusal)
    refused(draft({ labels: [{ ...label, text: 'a'.repeat(201) }], under: [] }), /label/)
    refused(draft({ labels: [{ ...label, text: '' }], under: [] }), /label/)
    refused(draft({ labels: [{ x: Infinity, y: 5, text: 'a' }], under: [] }), /label/)
    refused(draft({ labels: [{ x: 5, y: 5, text: 'a', to: { x: 'n', y: 1 } }], under: [] }), /label/)
    refused(draft({ labels: [{ x: 5000, y: 5, text: 'a' }], under: [] }), /label/)
  })

  it('folds a label to one line', () => {
    const checked = checkNoteDraft(draft({ labels: [{ x: 5, y: 5, text: 'thin\nhere  now' }], under: [] })) as { labels: Array<{ text: string }> }
    expect(checked.labels[0].text).toBe('thin here now')
  })

  it('holds the references to 6, each a PNG or a JPEG of at most 2000 px and a comment of at most 300 characters', () => {
    const reference = { bytes: png(100, 100), mediaType: 'image/png', comment: 'c' }
    expect(checkNoteDraft(draft({ references: Array.from({ length: 6 }, () => reference) }))).not.toBeInstanceOf(Refusal)
    refused(draft({ references: Array.from({ length: 7 }, () => reference) }), /references/)
    expect(checkNoteDraft(draft({ references: [{ ...reference, comment: 'c'.repeat(300) }] }))).not.toBeInstanceOf(Refusal)
    refused(draft({ references: [{ ...reference, comment: 'c'.repeat(301) }] }), /comment/)
    refused(draft({ references: [{ ...reference, bytes: new Uint8Array(100) }] }), /reference/)
    refused(draft({ references: [{ ...reference, bytes: png(2001, 10) }] }), /reference/)
    refused(draft({ references: [{ ...reference, mediaType: 'image/jpeg' }] }), /reference/)
    refused(draft({ references: [{ ...reference, comment: 7 }] }), /comment/)
  })

  it('folds a reference comment to one line', () => {
    const checked = checkNoteDraft(draft({ references: [{ bytes: png(10, 10), mediaType: 'image/png', comment: 'one\ntwo' }] })) as { references: Array<{ comment: string }> }
    expect(checked.references[0].comment).toBe('one two')
  })

  it('holds the comment to what a mark keeps', () => {
    expect(checkNoteDraft(draft({ comment: '' }))).not.toBeInstanceOf(Refusal)
    expect(checkNoteDraft(draft({ comment: 'two\nlines' }))).not.toBeInstanceOf(Refusal)
    refused(draft({ comment: 'c'.repeat(2001) }), /comment/)
    refused(draft({ comment: 7 }), /comment/)
  })

  it('holds the strokes to 2000, within the picture, and cuts a long one', () => {
    const stroke = { width: 4, points: [[1, 2]] }
    expect(checkNoteDraft(draft({ strokes: Array.from({ length: 2000 }, () => stroke), under: [] }))).not.toBeInstanceOf(Refusal)
    refused(draft({ strokes: Array.from({ length: 2001 }, () => stroke), under: [] }), /strokes/)
    refused(draft({ strokes: [{ width: 4, points: [[801, 2]] }], under: [] }), /stroke/)
    refused(draft({ strokes: [{ width: 0, points: [[1, 2]] }], under: [] }), /stroke/)
    refused(draft({ strokes: [{ width: 4, points: [] }], under: [] }), /stroke/)
    refused(draft({ strokes: [{ width: 4, points: [[1, NaN]] }], under: [] }), /stroke/)
    const long = checkNoteDraft(draft({ strokes: [{ width: 4, points: Array.from({ length: 500 }, (_, i) => [i, i]) }], under: [] })) as { strokes: Array<{ points: unknown[] }> }
    expect(long.strokes[0].points).toHaveLength(400)
  })

  it('tells of the ink of at most as many strokes as drawings tell, and of each label with an arrow', () => {
    const strokes = Array.from({ length: 40 }, () => ({ width: 4, points: [[1, 2]] }))
    const told = Array.from({ length: MOST_STROKES_TOLD }, () => UNDER)
    expect(checkNoteDraft(draft({ strokes, labels: [], under: told }))).not.toBeInstanceOf(Refusal)
    refused(draft({ strokes, labels: [], under: [...told, UNDER] }), /over/)
    // One more for the label with an arrow, and none for one without.
    expect(checkNoteDraft(draft({ strokes, labels: [{ x: 1, y: 1, text: 'a', to: { x: 2, y: 2 } }], under: [...told, UNDER] }))).not.toBeInstanceOf(Refusal)
    refused(draft({ strokes, labels: [{ x: 1, y: 1, text: 'a' }], under: [...told, UNDER] }), /over/)
  })

  it('checks each line of what the ink lies over as a drawing does', () => {
    refused(draft({ under: [{ ...UNDER, box: [10, 10, 900, 40] }] }), /over/)
    refused(draft({ under: [{ ...UNDER, refs: [{ ref: 'lid' }] }] }), /over/)
    refused(draft({ under: [{ ...UNDER, refs: [], bare: false }] }), /over/)
    refused(draft({ under: 'lid/F12' }), /over/)
  })

  it('refuses a camera that is not one, and a build or a layout that is not named', () => {
    refused(draft({ camera: { ...CAMERA, fov: 500 } }), /camera/)
    refused(draft({ revision: 0 }), /build/)
    refused(draft({ layout: '' }), /what it is of/)
    refused(draft({ objectId: 7 }), /what it is of/)
  })

  it('drops what only main says, and every file name, id and picture field', () => {
    const checked = checkNoteDraft(
      draft({ id: 'M9', by: 'agent', author: 'agent', status: 'sent', sentBefore: true, reopened: true, resolvedBy: 'agent', acknowledged: true, checkedRevision: 3, picture: 'n-0123456789ab.png', file: 'x', ink: 'n-0123456789ab.ink.png', kind: 'pin', createdAt: 'now', anchorState: 'orphaned' })
    ) as unknown as Record<string, unknown>
    expect(checked).not.toBeInstanceOf(Refusal)
    for (const key of ['id', 'by', 'author', 'status', 'sentBefore', 'reopened', 'resolvedBy', 'acknowledged', 'checkedRevision', 'picture', 'file', 'ink', 'kind', 'createdAt', 'anchorState']) expect(checked).not.toHaveProperty(key)
  })

  it('drops a file name inside a reference, an id inside a label and a field of a stroke it does not know', () => {
    const checked = checkNoteDraft(
      draft({
        references: [{ bytes: png(10, 10), mediaType: 'image/png', comment: 'c', file: 'r-0123456789ab.png', id: 'M1' }],
        labels: [{ x: 5, y: 5, text: 'a', file: 'x', id: 'M1' }],
        strokes: [{ width: 4, points: [[1, 2]], status: 'sent' }],
        under: []
      })
    ) as { references: object[]; labels: object[]; strokes: object[] }
    expect(Object.keys(checked.references[0]).sort()).toEqual(['bytes', 'comment', 'mediaType'])
    expect(Object.keys(checked.labels[0]).sort()).toEqual(['text', 'x', 'y'])
    expect(Object.keys(checked.strokes[0]).sort()).toEqual(['points', 'width'])
  })

  it('keeps an anchor for main to place, without the tag, and refuses one that has no point', () => {
    const anchor = { point: [1, 2, 3], part: 'lid', ref: 'lid/F12', tag: 'top', arranged: [0, 0, 0] }
    const checked = checkNoteDraft(draft({ anchor })) as { anchor?: Record<string, unknown> }
    expect(checked.anchor).toMatchObject({ point: [1, 2, 3], part: 'lid', ref: 'lid/F12' })
    expect(checked.anchor).not.toHaveProperty('tag')
    refused(draft({ anchor: { part: 'lid' } }), /anchor/)
    expect(checkNoteDraft(draft({ anchor: undefined }))).not.toHaveProperty('anchor')
  })
})

describe('checkNoteEdit', () => {
  const size = { w: 800, h: 600 }
  const edit = (over: Record<string, unknown> = {}): unknown => ({ ...over })
  const editRefused = (raw: unknown, reason: RegExp, of = size): void => {
    const checked = checkNoteEdit(raw, of)
    expect(checked).toBeInstanceOf(Refusal)
    expect((checked as Refusal).message).toMatch(reason)
  }

  it('takes a change of the comment alone', () => {
    expect(checkNoteEdit(edit({ comment: 'thicker' }), size)).toEqual({ comment: 'thicker' })
    expect(checkNoteEdit(edit({}), size)).toEqual({})
  })

  it('wants the picture with the new ink when strokes or labels change', () => {
    editRefused(edit({ labels: [] }), /inked/)
    editRefused(edit({ strokes: [] }), /inked/)
    const checked = checkNoteEdit(edit({ strokes: [{ width: 3, points: [[1, 1]] }], labels: [{ x: 1, y: 1, text: 'a' }], under: [UNDER], inked: png(800, 600) }), size)
    expect(checked).not.toBeInstanceOf(Refusal)
    expect(checked).toMatchObject({ labels: [{ x: 1, y: 1, text: 'a' }] })
  })

  it('holds the inked picture to the size of the note', () => {
    editRefused(edit({ labels: [], inked: png(640, 480) }), /size/)
    editRefused(edit({ labels: [], inked: new Uint8Array(100) }), /inked/)
  })

  it('holds labels and strokes to the caps and the picture of the note', () => {
    const label = { x: 5, y: 5, text: 'a' }
    editRefused(edit({ labels: Array.from({ length: 21 }, () => label), inked: png(800, 600) }), /labels/)
    editRefused(edit({ labels: [{ x: 5, y: 5, text: 'a'.repeat(201) }], inked: png(800, 600) }), /label/)
    editRefused(edit({ strokes: [{ width: 4, points: [[900, 5]] }], inked: png(800, 600) }), /stroke/)
    editRefused(edit({ labels: [{ x: 700, y: 5, text: 'a' }], inked: png(800, 600) }), /label/, { w: 400, h: 300 })
  })

  it('keeps the indexes of the references to keep, and holds the new ones to the caps', () => {
    const checked = checkNoteEdit(edit({ keepReferences: [2, 0], addReferences: [{ bytes: jpeg(10, 10), mediaType: 'image/jpeg', comment: 'new' }] }), size)
    expect(checked).toMatchObject({ keepReferences: [0, 2] })
    expect((checked as { addReferences: unknown[] }).addReferences).toHaveLength(1)
    editRefused(edit({ keepReferences: [-1] }), /references/)
    editRefused(edit({ keepReferences: [1.5] }), /references/)
    editRefused(edit({ keepReferences: [0, 0] }), /references/)
    editRefused(edit({ keepReferences: 'all' }), /references/)
    editRefused(edit({ addReferences: Array.from({ length: 7 }, () => ({ bytes: png(10, 10), mediaType: 'image/png', comment: '' })) }), /references/)
    editRefused(edit({ addReferences: [{ bytes: png(10, 10), mediaType: 'image/png', comment: 'c'.repeat(301) }] }), /comment/)
  })

  it('drops what only main says and every file name', () => {
    const checked = checkNoteEdit(edit({ comment: 'x', id: 'M2', status: 'resolved', sentBefore: true, ink: 'n-0123456789ab.ink.png', picture: 'n-0123456789ab.png', references: [{ file: 'r-0123456789ab.png', comment: '' }], size: { w: 1, h: 1 }, anchor: { point: [0, 0, 0] } }), size)
    expect(checked).toEqual({ comment: 'x' })
  })

  it('refuses what is no object', () => {
    editRefused(null, /not one/)
    editRefused('thicker', /not one/)
  })
})
