import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SketchDraft } from '../../../shared/bridge'
import type { Vec3 } from '../../../shared/marks'
import { plainText } from '../../../test/plainText'
import { leaveSketch, setLit, setTake, sketchStore } from '../../state/sketching'
import { store } from '../../state/store'
import { setTool, toolStore } from '../../state/tools'
import { planeRows, surfaceStrokes } from './rows'
import { SketchPanel } from './SketchPanel'

const CAMERA = { position: [100, -100, 80] as Vec3, target: [0, 0, 10] as Vec3, up: [0, 0, 1] as Vec3, ortho: false, fov: 35, zoom: 1 }
const XZ = { id: 1, origin: [0, 40, 0] as Vec3, x: [1, 0, 0] as Vec3, y: [0, 0, 1] as Vec3, label: 'XZ at y = 40.0 (u = +X, v = +Z)', from: { kind: 'main' as const, axis: 'XZ' as const, offset: 40 } }
const XY = { id: 2, origin: [0, 0, 12] as Vec3, x: [1, 0, 0] as Vec3, y: [0, 1, 0] as Vec3, label: 'XY at z = 12.0 (u = +X, v = +Y)', from: { kind: 'main' as const, axis: 'XY' as const, offset: 12 } }
const stroke = (over: Record<string, unknown> = {}) => ({ pen: 'free' as const, revision: 1, plane: 1, points2d: [[0, 0], [1, 1]] as [number, number][], ...over })
const draft = (over: Partial<SketchDraft> = {}): SketchDraft => ({ objectId: 'o', layout: 'assembly', revision: 1, camera: CAMERA, name: 'Hose route', note: 'round the block', take: 'rough', planes: [XZ, XY], strokes: [stroke(), stroke(), stroke({ plane: 2 }), stroke({ plane: undefined, points: [[0, 0, 0], [1, 1, 1]], points2d: undefined })], ...over })

/** The panel as the window draws it now: a static render reads each store's first state, which is made the state there is. */
function html(): string {
  const spies = [vi.spyOn(sketchStore, 'getInitialState').mockReturnValue(sketchStore.getState()), vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState()), vi.spyOn(toolStore, 'getInitialState').mockReturnValue(toolStore.getState())]
  try {
    return renderToStaticMarkup(createElement(SketchPanel))
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

describe('the rows of planes and strokes', () => {
  it('counts the strokes on each plane and on the surface', () => {
    expect(planeRows(draft())).toEqual([
      { id: 1, name: 'XZ at y = 40.0', strokes: 2 },
      { id: 2, name: 'XY at z = 12.0', strokes: 1 }
    ])
    expect(surfaceStrokes(draft())).toBe(1)
    expect(planeRows(draft({ strokes: [] })).map((r) => r.strokes)).toEqual([0, 0])
  })
})

describe('the sketch panel', () => {
  beforeEach(() => {
    store.setState({ marks: [] })
    sketchStore.setState({ open: { draft: draft() }, plane: 1 })
    setTool('draw')
  })
  afterEach(() => {
    leaveSketch()
    setTool('select')
  })

  it('is not there without a sketch open, nor with another tool in hand', () => {
    leaveSketch()
    expect(html()).toBe('')
    sketchStore.setState({ open: { draft: draft() } })
    setTool('select')
    expect(html()).toBe('')
  })

  it('says what the sketch is: a new one not yet kept, then a draft or sent', () => {
    expect(plainText(html())).toContain('newnot kept yet')
    sketchStore.setState({ open: { id: 'M7', draft: draft({ id: 'M7' }) } })
    store.setState({ marks: [{ id: 'M7', kind: 'sketch', status: 'sent' } as never] })
    expect(plainText(html())).toContain('M7sent')
    store.setState({ marks: [{ id: 'M7', kind: 'sketch', status: 'draft' } as never] })
    expect(plainText(html())).toContain('M7draft')
  })

  it('lists the planes with their stroke counts, the surface, and the one drawn on', () => {
    const out = html()
    expect(plainText(out)).toContain('Planes and strokes')
    const rows = [...out.matchAll(/<button type="button" class="sketchpanel-plane"([^>]*)>(.*?)<\/button>/g)]
    expect(rows.map((m) => plainText(m[2]))).toEqual(['XZ at y = 40.02', 'XY at z = 12.01', 'On surfaces1'])
    expect(rows.map((m) => m[1].includes('data-active'))).toEqual([true, false, false])
    sketchStore.setState({ plane: 'surface' })
    expect([...html().matchAll(/<button type="button" class="sketchpanel-plane"([^>]*)>/g)].map((m) => m[1].includes('data-active'))).toEqual([false, false, true])
  })

  it('offers a new plane of a face or a point, and the offset of the plane in hand', () => {
    const out = plainText(html())
    expect(out).toContain('+ New plane: picka faceora point')
    expect(html()).toContain('aria-label="Plane offset"')
    // On the surface there is no plane to move.
    sketchStore.setState({ plane: 'surface' })
    expect(html()).not.toContain('Plane offset')
  })

  it('has the diameter of a flow sketch only', () => {
    expect(html()).not.toContain('aria-label="Diameter"')
    expect(html()).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>Rough/)
    setTake('flow')
    const out = html()
    expect(out).toContain('aria-label="Diameter"')
    expect(out).toMatch(/aria-checked="true"[^>]*>Flow/)
    setTake('exact')
    expect(html()).not.toContain('aria-label="Diameter"')
  })

  it('shows the diameter it has, the name and the comment, and Undo only when there is a stroke to take back', () => {
    sketchStore.setState({ open: { draft: draft({ take: 'flow', diameter: 19 }) }, undoable: 0 })
    const out = html()
    expect(out).toContain('value="19"')
    expect(out).toContain('value="Hose route"')
    expect(out).toContain('round the block')
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Undo<\/button>/)
    sketchStore.setState({ undoable: 2 })
    expect(html()).not.toMatch(/<button[^>]*disabled=""[^>]*>Undo<\/button>/)
    expect(plainText(html())).toContain('Done')
  })

  it('lights the strokes of the row the pointer is on, and lets go', () => {
    setLit(2)
    expect(sketchStore.getState().lit).toBe(2)
    setLit('surface')
    expect(sketchStore.getState().lit).toBe('surface')
    setLit(null)
    expect(sketchStore.getState().lit).toBeNull()
  })

  it('says why the last change was refused', () => {
    sketchStore.setState({ problem: 'A sketch has at most 200 strokes.' })
    expect(html()).toContain('role="alert"')
    expect(plainText(html())).toContain('A sketch has at most 200 strokes.')
  })
})
