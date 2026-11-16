import { describe, expect, it } from 'vitest'
import { MOST_CUTS_TOLD, MOST_REFS_TOLD } from '../../shared/drawing'
import { cameraOf, overText, strokeLine, strokeOf } from './drawing'

// What a view note holds of what its ink lies over, as the window gives it (`strokeOf`, `cameraOf`) and as the agent
// reads it (`strokeLine`, `overText`). The note's own checks are in `notes/check.test.ts`, its words in `notes/text.test.ts`.

const camera = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const stroke = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ box: [10, 12, 40, 30], refs: [{ ref: 'base/F12', descriptor: 'plane, normal +Z, z = 20' }, { ref: 'base/F3' }], cuts: [], scans: [], bare: true, ...over })

describe('strokeOf', () => {
  it('takes a whole stroke, and only what a stroke has', () => {
    expect(strokeOf({ ...stroke(), extra: 1 }, 64, 48)).toEqual({ box: [10, 12, 40, 30], refs: [{ ref: 'base/F12', descriptor: 'plane, normal +Z, z = 20' }, { ref: 'base/F3' }], cuts: [], scans: [], bare: true })
  })
  it('folds a descriptor to one line and cuts a long one', () => {
    const got = strokeOf(stroke({ refs: [{ ref: 'base/F1', descriptor: `plane,\n  normal +Z ${'x'.repeat(300)}` }] }), 64, 48)
    expect(got?.refs[0].descriptor?.startsWith('plane, normal +Z x')).toBe(true)
    expect(got?.refs[0].descriptor).toHaveLength(200)
  })
  it('takes a face as the window names it: from F0, of a part of any name on one line', () => {
    expect(strokeOf(stroke({ refs: [{ ref: 'base F0/F0' }, { ref: 'Lid, #2/F10' }] }), 64, 48)?.refs.map((r) => r.ref)).toEqual(['base F0/F0', 'Lid, #2/F10'])
  })
  it('takes the parts whose cut face the stroke lies over, and the count of faces it has more of', () => {
    expect(strokeOf(stroke({ refs: [], cuts: ['lid', 'base'], moreRefs: 3 }), 64, 48)).toMatchObject({ cuts: ['lid', 'base'], moreRefs: 3 })
  })
  it.each([
    ['not an object', null],
    ['a stroke outside the picture', stroke({ box: [0, 0, 65, 1] })],
    ['a box that is upside down', stroke({ box: [30, 0, 10, 1] })],
    ['an edge where a face is said', stroke({ refs: [{ ref: 'base/E3' }] })],
    ['a mark where a face is said', stroke({ refs: [{ ref: 'M3' }] })],
    ['a face of a part named on two lines', stroke({ refs: [{ ref: 'base\nlid/F1' }] })],
    ['a face of a part named across a line separator', stroke({ refs: [{ ref: 'base lid/F1' }] })],
    ['a face numbered from a nought', stroke({ refs: [{ ref: 'base/F01' }] })],
    ['too many faces', stroke({ refs: Array.from({ length: MOST_REFS_TOLD + 1 }, (_, i) => ({ ref: `base/F${i + 1}` })) })],
    ['a scan that is no scan', stroke({ refs: [], scans: ['scan one'] })],
    ['a stroke over something it does not name', stroke({ refs: [], bare: false })],
    ['cut faces that are no list', stroke({ refs: [], cuts: 'lid' })],
    ['a cut face of a part named on two lines', stroke({ refs: [], cuts: ['lid\nbase'] })],
    ['too many cut faces', stroke({ refs: [], cuts: Array.from({ length: MOST_CUTS_TOLD + 1 }, (_, i) => `p${i}`) })],
    ['a count of faces that is no count', stroke({ moreRefs: -1 })]
  ])('refuses %s', (_what, value) => {
    expect(strokeOf(value, 64, 48)).toBeNull()
  })
})

describe('cameraOf', () => {
  it('takes a camera that looks somewhere', () => {
    expect(cameraOf(camera)).toEqual(camera)
  })
  it.each([
    ['one that looks nowhere', { ...camera, target: camera.position }],
    ['one with no projection', { ...camera, ortho: 'no' }],
    ['one beyond reach', { ...camera, position: [1e10, 0, 0] }],
    ['one with no up', { ...camera, up: [0, 0, 0] }]
  ])('refuses %s', (_what, value) => {
    expect(cameraOf(value)).toBeNull()
  })
})

describe('strokeLine and overText', () => {
  const under = (over: Record<string, unknown> = {}): NonNullable<ReturnType<typeof strokeOf>> => strokeOf(stroke(over), 64, 48)!
  it('says stroke by stroke what the ink lies over: faces with their lines, scans, and what is over no part', () => {
    expect(strokeLine(under({ box: [10.4, 12, 40.6, 30], moreRefs: 2, scans: ['S1'] }), 1)).toBe('- stroke 1, x 10–41, y 12–30: base/F12 (plane, normal +Z, z = 20), base/F3, and 2 more faces; scan S1 where no part is; partly over no part')
    expect(strokeLine(under({ box: [0, 0, 5, 5], refs: [], scans: ['S1', 'S2'], bare: false }), 2)).toBe('- stroke 2, x 0–5, y 0–5: over no part: scan S1, S2')
    expect(strokeLine(under({ box: [1, 2, 3, 4], refs: [], bare: true }), 3)).toBe('- stroke 3, x 1–3, y 2–4: over no part')
  })
  it('says a cut face as the cut face of its part, beside the faces', () => {
    expect(overText(under({ refs: [{ ref: 'base/F2' }], cuts: ['lid'], bare: false }))).toBe('base/F2, the cut face of lid')
    expect(overText(under({ refs: [], cuts: ['lid', 'base'], scans: ['S1'], bare: true }))).toBe('the cut face of lid, the cut face of base; scan S1 where no part is; partly over no part')
  })
  it('starts no line with a word the stand-in agent would take for a command', () => {
    expect(strokeLine(under(), 1)).not.toMatch(/^(say|tool|ask|slow|work|rate|images|garbage)\b/)
  })
})
