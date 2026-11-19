import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DimensionMark, Mark } from '../../../shared/marks'
import type { ModelCheck } from '../../../shared/modelChecks'
import type { Scene } from '../../../shared/scene'
import { plainText } from '../../../test/plainText'
import { pointedStore } from '../../state/pointed'
import { COLUMN_DEFAULT } from '../../state/column'
import { store } from '../../state/store'
import { checkRow } from '../checkRows'
import { Checks, valueBefore } from './Checks'
import { mergedChecks } from './checksOrder'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const dim = (id: string, over: object = {}): DimensionMark =>
  ({ id, kind: 'dimension', measure: 'distance', author: 'user', note: 'gap', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 3, camera: CAMERA, createdAt: 't', a: { point: [0, 0, 0], part: 'base', ref: 'base/F9' }, value: 3, how: 'planes', measuredRevision: 12, expected: 3, verdict: 'pass', ...over }) as DimensionMark
const fits: ModelCheck = { name: 'lid fits the tub', kind: 'clearance', status: 'fail', value: 0.12, unit: 'mm', min: 0.15, max: 0.25, exact: true, how: 'least distance between the parts', declared: { a: 'lid', b: 'tub' } }
const walls: ModelCheck = { name: 'walls', kind: 'thin', status: 'pass', value: null, unit: 'mm', min: 1.2, max: null, exact: false, how: 'by sampling' }
const gone: ModelCheck = { name: 'same part', kind: 'clearance', status: 'error', reason: 'a and b are the same part', unit: 'mm', min: 0, max: null }
const scene = (checks: ModelCheck[] | undefined, more: Partial<Scene> = {}): Scene => ({ model: 'm.py', layouts: ['assembly'], parts: [{ name: 'tub', layout: 'assembly' }, { name: 'lid', layout: 'assembly' }], seconds: 0, output: '', checks, ...more }) as unknown as Scene

describe("the Checks section: the model's checks and the person's dimension checks in one list", () => {
  afterEach(() => {
    store.setState({ scene: null, before: null, objectId: null, marks: [], activeMark: null, layout: '', revision: 0, column: COLUMN_DEFAULT })
    pointedStore.setState({ part: null })
  })
  const html = (scn: Scene | null, marks: Mark[] = [], more: Record<string, unknown> = {}): string => {
    store.setState({ scene: scn, objectId: 'p', layout: 'assembly', revision: 12, marks, column: COLUMN_DEFAULT, ...more })
    // A server render reads the initial state of a store: the state set here stands in for it.
    const now = [vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState()), vi.spyOn(pointedStore, 'getInitialState').mockReturnValue(pointedStore.getState())]
    try {
      return renderToStaticMarkup(createElement(Checks))
    } finally {
      for (const spy of now) spy.mockRestore()
    }
  }

  it('is no section for a model with no checks, or a kernel that does not read them, and no dimension checks', () => {
    expect(html(scene([]))).toBe('')
    expect(html(scene(undefined))).toBe('')
    expect(html(scene([]), [dim('M1', { expected: undefined, verdict: undefined })])).toBe('')
  })

  it('lists a row for each check with how it stands in a word, what was measured and what was wanted', () => {
    const text = html(scene([fits, walls]))
    expect(text).toContain('data-check="lid fits the tub"')
    expect(text).toContain('data-verdict="fails"')
    expect(text).toContain('<span class="check-standing">fails</span>')
    const words = plainText(text)
    expect(words).toContain('0.12 mm, wanted 0.15 to 0.25 mm')
    expect(words).toContain('found by sampling')
    expect(text).not.toMatch(/verified/i)
  })

  it('has the gauge of each with its words, and the person’s dimension in the same list, after what fails of the model', () => {
    const text = html(scene([walls, fits]), [dim('M2', { value: 2.8, verdict: 'fail' }), dim('M3')])
    expect(text).toContain('aria-label="0.12, outside 0.15 to 0.25"')
    expect(text).toContain('aria-label="2.8, outside 2.95 to 3.05"')
    const order = [...text.matchAll(/class="check-row"[^>]*?data-kind="(\w+)"[^>]*?data-verdict="([\w ]+)"/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(order).toEqual(['model fails', 'dimension fails', 'model passes', 'dimension passes'])
    expect(text).toContain('data-check-mark="M2"')
  })

  it('says what the agent made easier to pass, under the rows', () => {
    const note = { name: 'walls', what: 'loosened' as const, text: 'walls: min 1.2 → 0.6 mm', since: 3, from: walls }
    expect(plainText(html(scene([walls], { checkNotes: [note] })))).toContain('walls: min 1.2 → 0.6 mm (since r3)')
  })

  it('lights the rows of a part the pointer is on: the model’s checks by their parts, a dimension by its marks', () => {
    pointedStore.setState({ part: 'tub' })
    const text = html(scene([fits, walls]), [dim('M2', { a: { point: [0, 0, 0], part: 'tub', ref: 'tub/F1' } })])
    const lit = [...text.matchAll(/<li class="check-row"[^>]*?data-(?:check|check-mark)="([^"]+)"[^>]*?data-lit=""/g)].map((m) => m[1])
    expect(lit.sort()).toEqual(['M2', 'lid fits the tub'])
  })

  it('opens out the mark’s own row under the dimension that is the active mark', () => {
    const text = html(scene([]), [dim('M2'), dim('M3')], { activeMark: 'M3' })
    expect(text.match(/class="mark-row"/g)).toHaveLength(1)
    expect(text).toContain('data-mark="M3"')
  })
})

describe('where a value was on the build before', () => {
  const rowOf = (check: ModelCheck) => mergedChecks([check], [], 12)[0]
  it('is the model’s own value of the build before, when it moved', () => {
    expect(valueBefore(rowOf(fits), [{ ...fits, value: 0.3 }], [], 12)).toBe(0.3)
    expect(valueBefore(rowOf(fits), [{ ...fits, value: 0.12 }], [], 12)).toBeUndefined()
    expect(valueBefore(rowOf(fits), undefined, [], 12)).toBeUndefined()
    expect(valueBefore(rowOf(fits), [{ ...fits, status: 'error', value: undefined }], [], 12)).toBeUndefined()
  })
  it('is the last value in a dimension’s history of an earlier build', () => {
    const marks = [dim('M2', { value: 2.8, verdict: 'fail', history: [{ revision: 10, value: 3 }, { revision: 11, value: 3.4 }, { revision: 12, value: 2.8 }] })]
    const [row] = mergedChecks([], marks, 12)
    expect(valueBefore(row, undefined, marks, 12)).toBe(3.4)
    expect(valueBefore(mergedChecks([], [dim('M2', { history: [{ revision: 12, value: 3 }] })], 12)[0], undefined, [dim('M2', { history: [{ revision: 12, value: 3 }] })], 12)).toBeUndefined()
  })
})

describe('the rows of the checks, in words', () => {
  it('has a word for each way a check stands, and the reason for one that could not be measured', () => {
    expect(checkRow(fits)).toMatchObject({ standing: 'fails', reading: '0.12 mm', wanted: 'wanted 0.15 to 0.25 mm', caution: null })
    expect(checkRow(walls)).toMatchObject({ standing: 'pass', reading: 'none found by sampling', caution: 'found by sampling' })
    expect(checkRow(gone)).toMatchObject({ standing: 'not measured', reading: 'a and b are the same part', wanted: '' })
    expect(checkRow({ ...fits, status: 'pass', assumedRefs: ['radiator'] }).assumed).toBe('against an assumed reference: radiator')
    expect(checkRow(fits).assumed).toBeNull()
    expect(checkRow({ ...gone, status: 'not run', reason: 'the 10 s ran out' }).standing).toBe('not run')
  })
})
