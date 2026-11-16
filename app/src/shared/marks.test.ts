import { describe, expect, it } from 'vitest'
import { type Anchor, type NoteMark, isUnchecked, markAnchors, markPoints, translated } from './marks'

const ANCHOR: Anchor = { point: [1, 2, 20], part: 'base', ref: 'base/F4' }
const note = (over: object = {}): NoteMark =>
  ({
    id: 'M4',
    kind: 'note',
    author: 'user',
    note: 'too thin here',
    status: 'draft',
    anchorState: 'ok',
    layout: 'assembly',
    revision: 12,
    camera: { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
    createdAt: '2026-11-16T10:00:00.000Z',
    picture: 'n-0123456789ab.png',
    ink: 'n-0123456789ab.ink.png',
    size: { w: 800, h: 600 },
    strokes: [],
    inkColour: '#ff00ff',
    labels: [],
    under: [],
    references: [],
    ...over
  }) as NoteMark

describe('a note mark', () => {
  it('has its anchor as its only anchor, and none when the ink lay over no face', () => {
    expect(markAnchors(note({ anchor: ANCHOR }))).toEqual([ANCHOR])
    expect(markAnchors(note())).toEqual([])
  })

  it('is unchecked like a pick: open, and not checked against the last build', () => {
    expect(isUnchecked(note({ anchor: ANCHOR }), 3)).toBe(true)
    expect(isUnchecked(note({ anchor: ANCHOR, checkedRevision: 3 }), 3)).toBe(false)
    expect(isUnchecked(note({ anchor: ANCHOR, status: 'resolved' }), 3)).toBe(false)
  })

  it('moves only its anchor when its part is spread otherwise', () => {
    expect(translated(note({ anchor: ANCHOR }), [0, 0, 5]).anchor?.point).toEqual([1, 2, 25])
    expect(translated(note(), [0, 0, 5])).toEqual(note())
  })

  it('is drawn in no view: no point to keep in', () => {
    expect(markPoints(note({ anchor: ANCHOR }))).toEqual([])
  })
})
