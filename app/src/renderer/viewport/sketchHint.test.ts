import { describe, expect, it } from 'vitest'
import { hintLines } from './sketchHint'

describe('the hint at the pointer while sketching', () => {
  it('says what the pointer would snap to, by the ref the kernel numbers it by', () => {
    expect(hintLines({ snap: { kind: 'vertex', ref: 'block/V88' } })).toEqual(['vertex block/V88'])
    expect(hintLines({ snap: { kind: 'centre', ref: 'head/E14', radius: 8 } })).toEqual(['hole centre head/E14 ⌀16'])
    expect(hintLines({ snap: { kind: 'edge', ref: 'block/E40' } })).toEqual(['edge block/E40'])
    expect(hintLines({ snap: { kind: 'edge', ref: 'block/E40', approx: true } })).toEqual(['edge block/E40, approximate'])
  })

  it('says a snap is put on the plane, as the sketch will say it', () => {
    expect(hintLines({ snap: { kind: 'centre', ref: 'head/E14', radius: 8, projected: true } })).toEqual(['hole centre head/E14 ⌀16, projected on the plane'])
  })

  it('has the length and the angle of the segment being drawn, in the plane', () => {
    expect(hintLines({ segment: { length: 42.5, angle: 18 } })).toEqual(['42.5 mm · 18°'])
    // On the surface a segment has no angle.
    expect(hintLines({ segment: { length: 3.14159 } })).toEqual(['3.142 mm'])
    expect(hintLines({ snap: { kind: 'vertex', ref: 'block/V88' }, segment: { length: 12, angle: -45 } })).toEqual(['vertex block/V88', '12 mm · -45°'])
  })

  it('shows the length being typed, and that Enter fixes it', () => {
    expect(hintLines({ segment: { length: 20, angle: 0 }, typed: '20' })).toEqual(['20 mm · 0° · typed'])
    expect(hintLines({ segment: { length: 20, angle: 0 }, typed: '2.' })).toEqual(['2. mm · 0° · typed'])
  })

  it('says nothing of nothing', () => {
    expect(hintLines({})).toEqual([])
  })
})
