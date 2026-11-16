import { describe, expect, it } from 'vitest'
import type { NoteMark } from '../../../shared/marks'
import type { StrokeUnder } from '../../../shared/drawing'
import type { RefItem } from './references'
import { type Now, changeOf, itsUnder } from './change'

const head: StrokeUnder = { box: [24, 24, 36, 36], refs: [{ ref: 'a/F1' }], cuts: [], scans: [], bare: false }
const stroke: StrokeUnder = { box: [1, 2, 10, 20], refs: [{ ref: 'a/F2' }], cuts: [], scans: [], bare: false }
const note: NoteMark = {
  id: 'M4', kind: 'note', author: 'user', note: 'the lid', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 3, createdAt: '2026-11-16T10:00:00Z',
  camera: { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }, picture: 'n-0123456789ab.png', ink: 'n-0123456789ab.ink.png', size: { w: 64, h: 48 }, inkColour: '#B5127A',
  strokes: [{ width: 3, points: [[1, 2], [10, 20]] }], labels: [{ x: 5, y: 5, text: 'here', to: { x: 30, y: 30 } }, { x: 9, y: 9, text: 'and here' }], under: [stroke, head], references: [{ file: 'r-0123456789ab.png', comment: 'a photo' }]
}
const refs = (): RefItem[] => [{ uid: -1, comment: 'a photo', old: 0, image: null, url: null }]
const same = (): Now => ({ strokes: [{ width: 3, points: [[1, 2], [10, 20]] }], labels: note.labels.map((l) => ({ ...l })), comment: 'the lid', references: refs() })

describe('changeOf', () => {
  it('is no change for what the sheet was opened with', () => {
    expect(changeOf(note, same())).toEqual({ ink: false, refs: {}, any: false })
  })
  it('is the comment alone when only it changed, folded to one line', () => {
    expect(changeOf(note, { ...same(), comment: ' the\nlid, thicker ' })).toEqual({ comment: 'the lid, thicker', ink: false, refs: {}, any: true })
  })
  it('is a change of ink when a stroke was drawn, or taken back', () => {
    const more = same()
    more.strokes.push({ width: 9, points: [[4, 4]] })
    expect(changeOf(note, more)).toMatchObject({ ink: true, any: true })
    expect(changeOf(note, { ...same(), strokes: [] })).toMatchObject({ ink: true })
  })
  it('is a change of ink when a label was written in, moved to another arrow or added', () => {
    const text = same()
    text.labels[1].text = 'there'
    expect(changeOf(note, text).ink).toBe(true)
    const arrow = same()
    arrow.labels[0].to = { x: 31, y: 30 }
    expect(changeOf(note, arrow).ink).toBe(true)
    expect(changeOf(note, { ...same(), labels: [...same().labels, { x: 1, y: 1, text: 'new' }] }).ink).toBe(true)
  })
  it('says which references stay when one was taken away, and is no change of ink', () => {
    expect(changeOf(note, { ...same(), references: [] })).toEqual({ ink: false, refs: { keepReferences: [] }, any: true })
  })
})

describe('itsUnder', () => {
  it('is what the note had, the strokes and then the heads, while neither the ink nor an arrow moved: a label\'s words changed alone', () => {
    const words = same()
    words.labels[1].text = 'there'
    expect(itsUnder(note, words)).toEqual([stroke, head])
  })
  it('is none (it is not worked out again) once a stroke or an arrow changed', () => {
    const arrow = same()
    arrow.labels[0].to = { x: 31, y: 30 }
    expect(itsUnder(note, arrow)).toEqual([])
    expect(itsUnder(note, { ...same(), strokes: [] })).toEqual([])
  })
})
