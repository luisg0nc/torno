import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SketchDraft } from '../../../shared/bridge'
import type { Vec3 } from '../../../shared/marks'
import { plainText } from '../../../test/plainText'
import { leaveSketch, setLit, setSnapping, setTake, setXray, sketchStore } from '../../state/sketching'
import { store } from '../../state/store'
import { setTool, toolStore } from '../../state/tools'
import { selectStroke } from '../../state/sets'
import { planeRows, planeTagWords, strokeRows, surfaceStrokes } from './rows'
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

describe('what the plane\'s tag says', () => {
  it('names a main plane by its axes and says its place on the axis it is across, with that axis', () => {
    expect(planeTagWords(XZ, 40)).toEqual({ name: 'XZ plane', axis: 'y', value: '40.0' })
    expect(planeTagWords(XY, 12.04)).toEqual({ name: 'XY plane', axis: 'z', value: '12.0' })
    expect(planeTagWords({ ...XZ, from: { kind: 'main', axis: 'YZ', offset: -3.26 } }, -3.26)).toEqual({ name: 'XZ plane', axis: 'x', value: '-3.3' })
  })

  it('names any other plane as the card does, and has no axis to colour its place', () => {
    const face = { label: 'lid/F3 +2.0 (u = +X, v = +Y)', from: { kind: 'face' as const, ref: 'lid/F3', offset: 2, revision: 1 } }
    expect(planeTagWords(face, 2)).toEqual({ name: 'lid/F3 +2.0', value: '2.0' })
  })
})

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

describe('the strokes of a sketch by their ids', () => {
  const kept = draft({ id: 'M7', strokes: [stroke({ id: 'k1' }), stroke({ id: 'k3', plane: 2 }), stroke({ id: 'k4', plane: undefined, points: [[0, 0, 0], [1, 1, 1]], points2d: undefined }), stroke()] })
  it('lists those main has numbered, each with `M7/k3` and where it is, in the order drawn', () => {
    expect(strokeRows(kept, 'M7')).toEqual([
      { id: 'k1', ref: 'M7/k1', where: 'XZ at y = 40.0', plane: 1 },
      { id: 'k3', ref: 'M7/k3', where: 'XY at z = 12.0', plane: 2 },
      { id: 'k4', ref: 'M7/k4', where: 'On surfaces', plane: 'surface' }
    ])
  })
  it('lists none for a sketch that is not kept yet, which has no number to name a stroke by', () => {
    expect(strokeRows(kept, undefined)).toEqual([])
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
    expect(plainText(html())).toContain('newSketchnot kept yet')
    sketchStore.setState({ open: { id: 'M7', draft: draft({ id: 'M7' }) } })
    store.setState({ marks: [{ id: 'M7', kind: 'sketch', status: 'sent' } as never] })
    expect(plainText(html())).toContain('M7Sketchsent')
    store.setState({ marks: [{ id: 'M7', kind: 'sketch', status: 'draft' } as never] })
    expect(plainText(html())).toContain('M7Sketchdraft, goes with your next prompt')
  })

  it('is the head of the card: its container says so, and it names the order chip, Sketch, Name, Take it, Comment, Undo and Done', () => {
    const out = html()
    expect(out).toMatch(/^<aside[^>]*data-head="sketch"/)
    const text = plainText(out)
    for (const word of ['new', 'Sketch', 'Name', 'Take it', 'Planes and strokes', 'Comment', 'Undo', 'Done']) expect(text).toContain(word)
    // The order the spec gives: chip and title, Name, Take it, planes, the two switches, Comment, then Undo and Done.
    const at = ['Sketch', 'Name', 'Take it', 'Planes and strokes', 'Snap', 'X-ray', 'Comment', 'Undo', 'Done'].map((word) => text.indexOf(word))
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(at).not.toContain(-1)
    sketchStore.setState({ open: { draft: draft({ take: 'flow', diameter: 19 }) } })
    expect(html()).toContain('aria-label="Diameter"')
    expect(plainText(html())).toContain('⌀')
  })

  it('has the Snap and X-ray switches, each with its key, as they stand, and the actions the keys call turn them', () => {
    const switches = (): { on: boolean; text: string }[] => [...html().matchAll(/<button type="button" class="sketchpanel-switch" role="switch" aria-checked="(true|false)"[^>]*>(.*?)<\/button>/g)].map((m) => ({ on: m[1] === 'true', text: plainText(m[2]) }))
    expect(switches()).toEqual([
      { on: true, text: 'SnapCtrl' },
      { on: false, text: 'X-rayI' }
    ])
    setSnapping(false)
    setXray(true)
    expect(switches().map((s) => s.on)).toEqual([false, true])
    setSnapping(true)
    setXray(false)
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

  it('has a button for each stroke by its id, the selected ones pressed, and none before the sketch is kept', () => {
    expect(html()).not.toContain('sketchpanel-stroke')
    sketchStore.setState({ open: { id: 'M7', draft: draft({ id: 'M7', strokes: [stroke({ id: 'k1' }), stroke({ id: 'k3' })] }) } })
    store.setState({ selection: ['M7/k3'] })
    const out = html()
    const buttons = [...out.matchAll(/<button type="button" class="sketchpanel-stroke" aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)]
    expect(buttons.map((m) => [m[2], m[1]])).toEqual([['k1', 'false'], ['k3', 'true']])
    store.setState({ selection: [] })
  })

  it('has the planes as 28 px rows with a plane glyph, the plane in mono and its count, and the strokes folded under their plane', () => {
    const out = html()
    expect(out.match(/class="sketchpanel-plane-item"/g)).toHaveLength(3)
    expect(out).toContain('class="sketchpanel-plane-glyph"')
    expect(out).toMatch(/<span class="sketchpanel-plane-name num">XZ at y = 40\.0<\/span>/)
    // Folded: the strokes of a plane are listed under it while it is the one drawn on, or one of them is selected.
    sketchStore.setState({ open: { id: 'M7', draft: draft({ id: 'M7', strokes: [stroke({ id: 'k1' }), stroke({ id: 'k3', plane: 2 }), stroke({ id: 'k4', plane: undefined, points: [[0, 0, 0], [1, 1, 1]], points2d: undefined })] }) }, plane: 1 })
    store.setState({ selection: [] })
    const listed = (): string[] => [...html().matchAll(/<button type="button" class="sketchpanel-stroke"[^>]*>(.*?)<\/button>/g)].map((m) => m[1])
    expect(listed()).toEqual(['k1'])
    sketchStore.setState({ plane: 2 })
    expect(listed()).toEqual(['k3'])
    sketchStore.setState({ plane: 'surface' })
    expect(listed()).toEqual(['k4'])
    // A stroke that is selected keeps its plane open.
    store.setState({ selection: ['M7/k1'] })
    expect(listed()).toEqual(['k1', 'k4'])
    expect(plainText(html())).toContain('Planes and strokes')
    store.setState({ selection: [] })
  })

  it('puts the stroke in the selection when it is selected in the panel, and Shift adds to it', () => {
    store.setState({ selection: [], picked: {} })
    selectStroke('M7/k3')
    expect(store.getState().selection).toEqual(['M7/k3'])
    selectStroke('M7/k4', true)
    expect(store.getState().selection).toEqual(['M7/k3', 'M7/k4'])
    selectStroke('M7/k3', true)
    expect(store.getState().selection).toEqual(['M7/k4'])
    selectStroke('block/F1')
    expect(store.getState().selection).toEqual(['M7/k4'])
    store.setState({ selection: [] })
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
