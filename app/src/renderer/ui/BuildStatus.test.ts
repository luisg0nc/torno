import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DimensionMark, Mark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { letGoText } from '../../shared/build'
import { store } from '../state/store'
import { BuildStatus, dimensionCount, goToRow } from './BuildStatus'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OFF_EDGE_ADVICE, shownValue, verdictShown, whyNotMeasurable } from './DimensionFields'
import { DimensionValue } from './MarkRow'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const dim = (id: string, over: object = {}): DimensionMark =>
  ({ id, kind: 'dimension', measure: 'diameter', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 3, camera: CAMERA, createdAt: 't', a: { point: [0, 0, 0], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder', measuredRevision: 3, expected: 8.5, verdict: 'fail', ...over }) as DimensionMark
const SCENE = { model: 'm.py', layouts: ['assembly', 'print'], parts: [], seconds: 0, output: '' } as unknown as Scene

describe('the click on the count of failing dimensions', () => {
  let scrolled: string[]

  beforeEach(() => {
    scrolled = []
    vi.stubGlobal('document', { querySelector: (selector: string) => ({ scrollIntoView: () => void scrolled.push(selector) }) })
    store.setState({ objectId: 'bracket', scene: SCENE, revision: 3, layout: 'assembly', marks: [dim('M2', { layout: 'print' }), dim('M5')] as Mark[], activeMark: 'M5', markFocus: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('goes to the mark as its row does: its layout is shown when it is of another, it is the active one, and its row is brought into view', () => {
    goToRow('M2')
    const s = store.getState()
    expect(s.layout).toBe('print')
    expect(s.activeMark).toBe('M2')
    // The view goes to it, as on a click on the row.
    expect(s.markFocus).toBe(1)
    expect(scrolled).toEqual(['.mark-row[data-mark="M2"]'])
  })

  it('stays in the layout shown for a mark of that one', () => {
    goToRow('M5')
    expect(store.getState()).toMatchObject({ layout: 'assembly', activeMark: 'M5' })
  })

  it('makes a mark of a layout the build no longer has the active one, and shows no other layout for it', () => {
    store.setState({ marks: [dim('M2', { layout: 'gone' }), dim('M5')] as Mark[] })
    goToRow('M2')
    expect(store.getState()).toMatchObject({ layout: 'assembly', activeMark: 'M2', markFocus: 0 })
    expect(scrolled).toEqual(['.mark-row[data-mark="M2"]'])
  })
})

describe('what the status line and the row say of dimensions', () => {
  it('counts in words', () => {
    expect([dimensionCount(1, 'fail'), dimensionCount(2, 'fail'), dimensionCount(1, 'not measured'), dimensionCount(3, 'not measured')]).toEqual(['dimension fails', 'dimensions fail', 'dimension not measured', 'dimensions not measured'])
  })

  it('shows a value of the build on show, and one of another build as what it was', () => {
    expect(shownValue(dim('M1'), 3)).toEqual({ text: '⌀ 8 mm', value: 8, verdict: 'fail' })
    expect(shownValue(dim('M1'), 4)).toMatchObject({ text: '⌀ 8 mm', stale: true })
    expect(shownValue(dim('M1', { value: undefined, measuredRevision: undefined }), 4)).toEqual({ text: 'not measured yet', none: true })
    expect(shownValue(dim('M1', { anchorState: 'orphaned' }), 3)).toEqual({ text: 'not measurable', none: true })
  })

  it('the row of a resolved dimension shows what it was last measured as: greyed, with the build, and no tick', () => {
    // M2 ⌀ 8 passed on r5 and was resolved; r6 made the hole 9, and nothing measures it any more.
    const resolved = dim('M2', { status: 'resolved', resolvedBy: 'agent', expected: 8, verdict: 'pass', measuredRevision: 5 })
    const row = (mark: DimensionMark, revision: number): string => renderToStaticMarkup(createElement(DimensionValue, { mark, revision }))
    const stale = row(resolved, 6)
    expect(stale).toContain('data-stale=""')
    expect(stale).toContain('title="as measured on r5: resolved, it is no longer measured"')
    expect(stale).not.toContain('data-verdict')
    expect(stale).not.toContain('verdict-icon')
    expect(stale).toContain('⌀ 8 mm')
    // An open one measured on the build on show has its tick, and its value in full with the unit as everywhere.
    const open = row(dim('M1', { expected: 8, verdict: 'pass', value: 8.00000001 }), 3)
    expect(open).toContain('data-verdict="pass"')
    expect(open).toContain('verdict-icon')
    expect(open).toContain('title="8.00000001 mm, cylinder, as expected"')
    expect(row(dim('M1', { measure: 'angle', value: 45, how: 'between planes', expected: undefined, verdict: undefined }), 3)).toContain('title="45°, between planes"')
    // In words, the build is set in the face of numbers.
    expect(row(dim('M1', { value: undefined, measuredRevision: 2 }), 4)).toContain('not measured on <span class="num">r4</span>')
    // In the fields under it, nothing is held against what is expected.
    expect(verdictShown(resolved, 6)).toEqual({ verdict: 'none', why: 'Not checked: resolved, it is no longer measured' })
  })

  it('a verdict that is not there is not read as a failure', () => {
    expect(verdictShown(dim('M1', { expected: 8, verdict: undefined }), 3)).toEqual({ verdict: 'none', why: 'Not checked yet' })
    expect(verdictShown(dim('M1', { expected: 8, verdict: 'pass' }), 3)).toEqual({ verdict: 'pass' })
    expect(verdictShown(dim('M1', { expected: 9, verdict: 'fail' }), 3)).toEqual({ verdict: 'fail', off: '1 under' })
    expect(verdictShown(dim('M1', { expected: 9, verdict: 'fail' }), 4)).toEqual({ verdict: 'none', why: 'Not checked: there is no value of this build to compare' })
    expect(verdictShown(dim('M1', { expected: undefined }), 3)).toBeNull()
  })

  it('of an end that is off its edge says what can be done; of any other refusal only the kernel’s reason', () => {
    const off = dim('M1', { value: undefined, refused: 'the edge base/E7 it was on is not under its end on r3' })
    expect(whyNotMeasurable(off)).toBe('the edge base/E7 it was on is not under its end on r3 — measure it again, or between faces')
    expect(OFF_EDGE_ADVICE).toBe(' — measure it again, or between faces')
    expect(whyNotMeasurable(dim('M1', { value: undefined, refused: 'base/F9 is a plane face: it has no diameter' }))).toBe('base/F9 is a plane face: it has no diameter')
    expect(whyNotMeasurable(dim('M1', { value: undefined }))).toBe('the kernel could not measure it on this build')
  })
})

describe('a build the kernel let go to make room', () => {
  it('is said in the status line for as long as nothing answers of the object', () => {
    expect(letGoText({ status: 'building', letGo: 'memory' })).toBe('The last build was let go to make room (memory): tools answer when this one lands.')
    expect(letGoText({ status: 'failed', letGo: 'memory' })).toBe('The last build was let go to make room (memory) and this one failed: tools answer once the model builds again.')
    expect(letGoText({ status: 'building' })).toBeNull()
    expect(letGoText({ status: 'ok' })).toBeNull()
    expect(letGoText({ status: 'ok', letGo: 'memory' })).toBe('This build was let go to make room (memory): it is built again when something is asked of it.')
  })
})

describe('the status line on the New object page', () => {
  afterEach(() => store.setState({ page: 'object', objectId: null, build: null, scene: null, revision: 0 }))
  // A static render reads the store's first state (zustand's server snapshot): it is made the state there is now.
  const line = (): string => {
    const now = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
    try {
      return renderToStaticMarkup(createElement(BuildStatus, { errorOpen: false, onErrorOpen: () => {} }))
    } finally {
      now.mockRestore()
    }
  }

  it('says New object and nothing of the object that was open', () => {
    store.setState({ page: 'new', objectId: 'bracket', build: { status: 'ok', revision: 1, seconds: 1 } as never, scene: SCENE, revision: 1, marks: [] })
    const out = line()
    expect(out).toContain('New object')
    for (const gone of ['Rebuild', 'Export', 'r1', 'part', 'bracket']) expect(out).not.toContain(gone)
    store.setState({ page: 'object' })
    expect(line()).toContain('Rebuild')
    expect(line()).toContain('Export…')
  })
})
