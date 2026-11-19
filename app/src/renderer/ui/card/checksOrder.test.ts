import { describe, expect, it } from 'vitest'
import type { ModelCheck } from '../../../shared/modelChecks'
import type { DimensionMark, Mark } from '../../../shared/marks'
import { litChecks, mergedChecks } from './checksOrder'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const dim = (id: string, over: object = {}): DimensionMark =>
  ({ id, kind: 'dimension', measure: 'distance', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 3, camera: CAMERA, createdAt: 't', a: { point: [0, 0, 0], part: 'base', ref: 'base/F9' }, b: { point: [0, 0, 5], part: 'lid', ref: 'lid/F2' }, value: 3, how: 'planes', measuredRevision: 12, expected: 3, verdict: 'pass', ...over }) as DimensionMark

const fits: ModelCheck = { name: 'lid fits the tub', kind: 'clearance', status: 'fail', value: 0.12, unit: 'mm', min: 0.15, max: 0.25, exact: true, how: 'least distance', declared: { a: 'lid', b: 'tub' } }
const walls: ModelCheck = { name: 'walls', kind: 'thin', status: 'pass', value: null, unit: 'mm', min: 1.2, max: null, exact: false, declared: { a: 'tub' } }
const gone: ModelCheck = { name: 'same part', kind: 'clearance', status: 'error', reason: 'a and b are the same part', unit: 'mm', min: 0, max: null }
const late: ModelCheck = { name: 'slow', kind: 'volume', status: 'not run', reason: 'the 10 s ran out', unit: 'mm³', min: null, max: 5 }

describe('the merged list of checks', () => {
  it('puts what fails first, then what was not run or not measured, then what passes, stable within each', () => {
    const dims: Mark[] = [dim('M1'), dim('M2', { value: 2.8, verdict: 'fail', note: 'gap' })]
    const rows = mergedChecks([walls, fits, late], dims, 12)
    expect(rows.map((r) => r.verdict)).toEqual(['fails', 'fails', 'not run', 'passes', 'passes'])
    expect(rows.map((r) => r.id)).toEqual(['lid fits the tub', 'M2', 'slow', 'walls', 'M1'])
  })

  it('keeps the model before the person within a verdict, and lists a dimension that was not measured on the build as not measured', () => {
    const rows = mergedChecks([gone], [dim('M1', { measuredRevision: 11 })], 12)
    expect(rows.map((r) => [r.id, r.verdict])).toEqual([['same part', 'not measured'], ['M1', 'not measured']])
  })

  it('says who set a dimension, the person or the agent', () => {
    const rows = mergedChecks([], [dim('M1'), dim('M2', { author: 'agent' })], 12)
    expect(rows.map((r) => [r.id, r.author])).toEqual([['M1', 'user'], ['M2', 'agent']])
  })

  it('says a model check as the kernel measured it, with the gauge’s band and the parts it is of', () => {
    const [row] = mergedChecks([fits], [], 12)
    expect(row).toMatchObject({ kind: 'model', id: 'lid fits the tub', name: 'lid fits the tub', verdict: 'fails', value: 0.12, lo: 0.15, hi: 0.25, parts: ['lid', 'tub'] })
    expect(row.mark).toBeUndefined()
    expect(row.line).toBe('0.12 mm, wanted 0.15 to 0.25 mm')
  })

  it('says a sampled pass by its sampling, and a check that could not be measured by why', () => {
    const [cannot, sampled] = mergedChecks([walls, gone], [], 12)
    expect(sampled.line).toBe('none found by sampling, wanted at least 1.2 mm')
    expect(sampled.value).toBeUndefined()
    expect(cannot.line).toBe('a and b are the same part')
    expect(mergedChecks([{ ...walls, value: 1.5 }], [], 12)[0].line).toBe('1.5 mm, wanted at least 1.2 mm, found by sampling')
  })

  it('says a dimension check with its value and what was expected, the band being the tolerance each side', () => {
    const [row] = mergedChecks([], [dim('M2', { value: 2.8, verdict: 'fail', expected: 3, tolerance: 0.05, note: 'gap' })], 12)
    expect(row).toMatchObject({ kind: 'dimension', id: 'M2', mark: 'M2', name: 'gap', verdict: 'fails', value: 2.8, hi: 3.05, parts: ['base', 'lid'] })
    expect(row.lo).toBeCloseTo(2.95)
    expect(row.line).toBe('2.8 mm, wanted 3 ± 0.05')
  })

  it('names a dimension with no note by what it measures, and leaves out one with nothing expected or resolved', () => {
    const rows = mergedChecks([], [dim('M1', { note: '', measure: 'diameter' }), dim('M2', { expected: undefined, verdict: undefined }), dim('M3', { status: 'resolved' })], 12)
    expect(rows.map((r) => [r.id, r.name])).toEqual([['M1', 'diameter']])
  })

  it('has no value for a dimension of an older build, and says so', () => {
    const [row] = mergedChecks([], [dim('M1', { measuredRevision: 10 })], 12)
    expect(row.value).toBeUndefined()
    expect(row.verdict).toBe('not measured')
    expect(row.line).toBe('not measured on r12')
  })

  it('counts, as the head of the section does, what fails', () => {
    const rows = mergedChecks([fits, walls], [dim('M2', { value: 2.8, verdict: 'fail' })], 12)
    expect(rows.filter((r) => r.verdict === 'fails')).toHaveLength(2)
    expect(rows).toHaveLength(3)
  })
})

describe('the rows the view lights', () => {
  it('gives each part a check is of, as one entry each', () => {
    const rows = mergedChecks([fits, walls], [], 12)
    expect(litChecks(rows)).toEqual([
      { id: 'lid fits the tub', part: 'lid' },
      { id: 'lid fits the tub', part: 'tub' },
      { id: 'walls', part: 'tub' }
    ])
  })
})
