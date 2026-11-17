import { describe, expect, it } from 'vitest'
import { countsText, sketchName, takeText } from './sketchText'

describe('what a row, a card and the panel say of a sketch', () => {
  it('names a sketch by its name, or by "Sketch" and its number when it has none', () => {
    expect(sketchName({ id: 'M7', name: 'Hose route' })).toBe('Hose route')
    expect(sketchName({ id: 'M7', name: '  ' })).toBe('Sketch M7')
  })
  it('says how it is taken, with the diameter of a flow sketch', () => {
    expect(takeText({ take: 'exact' })).toBe('exact')
    expect(takeText({ take: 'flow', diameter: 19 })).toBe('flow ⌀19 mm')
    expect(takeText({ take: 'flow' })).toBe('flow')
    // A diameter belongs to flow alone.
    expect(takeText({ take: 'rough', diameter: 19 })).toBe('rough')
  })
  it('counts its strokes and the planes it has', () => {
    expect(countsText({ strokes: [], planes: [{}] })).toBe('no strokes yet')
    expect(countsText({ strokes: [{ pen: 'free', revision: 1 }], planes: [{}] })).toBe('1 stroke on 1 plane')
    expect(countsText({ strokes: [{ pen: 'free', revision: 1 }, { pen: 'line', revision: 1 }, { pen: 'line', revision: 1 }], planes: [{}, {}] })).toBe('3 strokes on 2 planes')
  })
})
