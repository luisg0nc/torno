import { describe, expect, it } from 'vitest'
import { type FacePrint, compareBuilds } from './compare'

const face = (over: Partial<FacePrint> = {}): FacePrint => ({ type: 'plane', area: 10, center: [0, 0, 0], normal: [0, 0, 1], box: [[0, 0, 0], [1, 1, 0]], ...over })

describe('compareBuilds', () => {
  it('lights the faces that moved or changed size, and no other', () => {
    const shown = { lid: [face(), face({ center: [5, 0, 0] }), face({ area: 4 })] }
    const nudged = { lid: [face(), face({ center: [6, 0, 0], box: [[1, 0, 0], [2, 1, 0]] }), face({ area: 6 })] }
    expect(compareBuilds(shown, nudged)).toEqual({ faces: ['lid/F1', 'lid/F2'], parts: [] })
  })

  it('takes float noise for the same face', () => {
    expect(compareBuilds({ a: [face()] }, { a: [face({ area: 10 + 1e-9, center: [1e-9, 0, 0] })] })).toEqual({ faces: [], parts: [] })
  })

  it('lights a turned face, and a face that gained or lost its normal', () => {
    const turned = compareBuilds({ a: [face(), face()] }, { a: [face({ normal: [0, 1, 0] }), face({ normal: null })] })
    expect(turned.faces).toEqual(['a/F0', 'a/F1'])
  })

  it('lights the part whole when its faces are not the same ones: a count, a type, or the part is gone', () => {
    const shown = { a: [face(), face()], b: [face(), face()], c: [face()], d: [face()] }
    const nudged = { a: [face(), face(), face()], b: [face(), face({ type: 'cylinder' })], d: [face()] }
    expect(compareBuilds(shown, nudged)).toEqual({ faces: [], parts: ['a', 'b', 'c'] })
  })

  it('names nothing of a part only the nudged build has', () => {
    expect(compareBuilds({ a: [face()] }, { a: [face()], extra: [face()] })).toEqual({ faces: [], parts: [] })
  })
})
