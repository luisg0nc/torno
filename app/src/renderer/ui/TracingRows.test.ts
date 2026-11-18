import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { plainText } from '../../test/plainText'
import { planeOfFrom, type Tracing } from '../../shared/tracings'
import { boardStore } from '../state/board'
import { actions, store } from '../state/store'
import { tracingsStore } from '../state/tracings'
import { TracingRows, tracingLine } from './TracingRows'

const tracing = (id: string, over: Partial<Tracing> = {}): Tracing => ({ id, by: 'person', name: '', layout: 'assembly', createdAt: '2026-11-17T10:00:00.000Z', plane: planeOfFrom({ kind: 'main', axis: 'XZ', offset: 0 })!, layers: [], nextLayer: 1, ...over })
const photo = { file: 'p-0123456789ab.jpg', sha256: 'a'.repeat(64), width: 400, height: 300, pairs: [{ photo: [1, 1] as [number, number], uv: [0, 0] as [number, number] }], method: 'similar' as const, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] as never, scale: 2, fade: 0.5 }

describe('the rows of the Tracings section', () => {
  afterEach(() => {
    store.setState({ tracingsShown: [] })
    tracingsStore.setState({ objectId: null, file: null, open: null }, false)
    boardStore.setState({ shown: 'model' })
  })
  // A static render reads each store's first state: they are made the state there is now.
  const rows = (panel?: string): string => {
    const spies = [store, tracingsStore, boardStore].map((s) => vi.spyOn(s as typeof store, 'getInitialState').mockReturnValue(s.getState() as never))
    try {
      return renderToStaticMarkup(createElement(TracingRows, { panel: panel === undefined ? undefined : createElement('div', { className: 'the-panel' }, panel) }))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  }
  const open = (shown: string[], tracings: Tracing[], now: string | null = null): void => {
    store.setState({ tracingsShown: shown })
    tracingsStore.setState({ file: { next: 9, tracings }, open: now })
  }

  it('has no row, and nothing else, while the project has no tracing', () => {
    open([], [])
    expect(rows()).toBe('')
  })

  it('has a row for each tracing, whatever its layout and whether it is shown in 3D, with the eye that shows or hides it', () => {
    open(['T1'], [tracing('T1', { name: 'Front of the block' }), tracing('T2', { layout: 'print' })])
    const out = rows()
    expect(out).toContain('data-tracing="T1"')
    expect(out).toContain('data-tracing="T2"')
    expect(out).toContain('Front of the block')
    expect(out).toContain('aria-label="Hide T1 in 3D"')
    expect(out).toContain('aria-label="Show T2 in 3D"')
  })

  it('names a tracing with no name by its plane, beside its number', () => {
    open([], [tracing('T3')])
    expect(plainText(rows())).toContain('T3XZ at y = 0')
  })

  it('names the photo at the right of its row: the reference it was taken from, else its file', () => {
    open([], [tracing('T1', { photo: { ...photo, from: 'reference/bay-front.jpg' } }), tracing('T2', { photo })])
    const out = plainText(rows())
    expect(out).toContain('bay-front.jpg')
    expect(out).not.toContain('reference/bay-front')
    expect(out).toContain('p-0123456789ab.jpg')
  })

  it('puts the line-up line under a tracing that is open or shown, and under no other', () => {
    open(['T2'], [tracing('T1', { photo }), tracing('T2', { photo }), tracing('T3', { photo })], 'T1')
    expect(rows().match(/class="tracing-line"/g)).toHaveLength(2)
  })

  it('hides a tracing from its eye: it is no longer shown in 3D, and its row stays to show it again', () => {
    open(['T1', 'T2'], [tracing('T1'), tracing('T2')])
    actions.setTracingShown('T1', false)
    const out = rows()
    expect(out).toContain('aria-label="Show T1 in 3D"')
    expect(out).toContain('aria-label="Hide T2 in 3D"')
  })

  it('puts the panel under the open tracing only while the Tracing view shows', () => {
    open([], [tracing('T1'), tracing('T2')], 'T1')
    expect(rows('x')).not.toContain('the-panel')
    boardStore.setState({ shown: 'tracing' })
    const out = rows('x')
    expect(out.match(/the-panel/g)).toHaveLength(1)
    expect(out.indexOf('the-panel')).toBeGreaterThan(out.indexOf('data-tracing="T1"'))
    expect(out.indexOf('the-panel')).toBeLessThan(out.indexOf('data-tracing="T2"'))
  })
})

describe('the line under a tracing', () => {
  it('says how the photo is lined up, in points and in millimetres a pixel, and that the drawing follows the build', () => {
    expect(tracingLine(tracing('T1', { photo: { ...photo, pairs: [photo.pairs[0], photo.pairs[0], photo.pairs[0], photo.pairs[0]], scale: 2.381 } }))).toBe('Photo lined up by 4 points, 0.42 mm a pixel. Redrawn at each build.')
  })
  it('says only that it is redrawn when there is no photo, or none lined up', () => {
    expect(tracingLine(tracing('T1'))).toBe('Redrawn at each build.')
    expect(tracingLine(tracing('T1', { photo: { ...photo, transform: undefined, scale: undefined } }))).toBe('Redrawn at each build.')
  })
})
