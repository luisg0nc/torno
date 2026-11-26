import { describe, expect, it } from 'vitest'
import { partNameRefusal, renamedIn, renamedRef } from './rename'

describe('partNameRefusal', () => {
  const taken = new Set(['shell', 'lid', 'case'])
  it('takes a plain name, spaces and all', () => {
    expect(partNameRefusal('shell', 'front case', taken)).toBeNull()
    expect(partNameRefusal('shell', '  peça  ', taken)).toBeNull()
  })
  it('refuses an empty name, the same name, a slash, a mark id, and one taken', () => {
    expect(partNameRefusal('shell', '  ', taken)).toMatch(/needs a name/)
    expect(partNameRefusal('shell', 'shell', taken)).toMatch(/name it has/)
    expect(partNameRefusal('shell', 'a/b', taken)).toMatch(/no \//)
    expect(partNameRefusal('shell', 'M12', taken)).toMatch(/mark's id/)
    expect(partNameRefusal('shell', 'lid', taken)).toMatch(/already the name/)
    expect(partNameRefusal('shell', 'case', taken)).toMatch(/already the name/)
    expect(partNameRefusal('shell', '#deck', taken)).toMatch(/# or @/)
    expect(partNameRefusal('shell', 'a:b', taken)).toMatch(/:/)
    expect(partNameRefusal('shell', 'a\nb', taken)).toMatch(/one line/)
    expect(partNameRefusal('shell', 'x'.repeat(61), taken)).toMatch(/60 characters/)
  })
})

describe('renamedRef', () => {
  it('renames the part of a ref and leaves any other', () => {
    expect(renamedRef('shell', 'shell', 'case')).toBe('case')
    expect(renamedRef('shell/F3', 'shell', 'case')).toBe('case/F3')
    expect(renamedRef('assembly:shell/E2', 'shell', 'case')).toBe('assembly:case/E2')
    expect(renamedRef('shells/F3', 'shell', 'case')).toBe('shells/F3')
    expect(renamedRef('lid/F3', 'shell', 'case')).toBe('lid/F3')
    expect(renamedRef('M7/k3', 'shell', 'case')).toBe('M7/k3')
  })
})

describe('renamedIn', () => {
  it('renames the part wherever a mark names it, and never in what a person wrote', () => {
    const mark = {
      id: 'M1',
      comment: 'the shell is too thin',
      anchor: { point: [0, 0, 0], part: 'shell', ref: 'shell/F3', edge: 'shell/E4', between: ['shell/F3', 'shell/F9'] },
      under: [{ refs: [{ ref: 'shell/F3', descriptor: 'plane' }], cuts: ['shell', 'lid'] }],
      strokes: [{ id: 'k1', touches: ['shell/F1'], snaps: [{ i: 0, vertex: 'shell/V2' }, { i: 1, centre: 'shell/E3', radius: 2 }] }]
    }
    const { value, count } = renamedIn(mark, 'shell', 'front case')
    expect(value.comment).toBe('the shell is too thin')
    expect(value.anchor).toMatchObject({ part: 'front case', ref: 'front case/F3', edge: 'front case/E4', between: ['front case/F3', 'front case/F9'] })
    expect(value.under[0]).toEqual({ refs: [{ ref: 'front case/F3', descriptor: 'plane' }], cuts: ['front case', 'lid'] })
    expect(value.strokes[0].touches).toEqual(['front case/F1'])
    expect(value.strokes[0].snaps).toEqual([{ i: 0, vertex: 'front case/V2' }, { i: 1, centre: 'front case/E3', radius: 2 }])
    expect(count).toBe(10)
    expect(mark.anchor.part).toBe('shell')
  })
  it('renames a set member, a tracing and the frame of a scan, and counts nothing when the part is not named', () => {
    expect(renamedIn({ members: [{ part: 'shell' }, { face: 'shell/F2', point: [0, 0, 0], state: 'ok' }] }, 'shell', 'case').value).toEqual({ members: [{ part: 'case' }, { face: 'case/F2', point: [0, 0, 0], state: 'ok' }] })
    expect(renamedIn({ parts: ['shell'], plane: { from: { kind: 'face', ref: 'shell/F1', revision: 2 } } }, 'shell', 'case').value).toEqual({ parts: ['case'], plane: { from: { kind: 'face', ref: 'case/F1', revision: 2 } } })
    expect(renamedIn({ alignments: { assembly: { frame: { shell: [1, 0, 0], lid: [0, 0, 0] }, pairs: [{ part: 'shell' }] } } }, 'shell', 'case').value).toEqual({ alignments: { assembly: { frame: { case: [1, 0, 0], lid: [0, 0, 0] }, pairs: [{ part: 'case' }] } } })
    expect(renamedIn({ anchor: { part: 'lid', ref: 'lid/F1' } }, 'shell', 'case').count).toBe(0)
  })
})
