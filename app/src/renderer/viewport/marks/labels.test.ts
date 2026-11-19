import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { DimensionMark, Mark, SpanMark } from '../../../shared/marks'
import { chipAt, labelValue, needsCamera, project, type Placed } from './labels'

describe('bringing a selected mark into view', () => {
  it('moves the camera only for a mark whose label is not in view, or is not drawn at all', () => {
    expect(needsCamera({ visible: true })).toBe(false)
    expect(needsCamera({ visible: false })).toBe(true)
    expect(needsCamera(null)).toBe(true)
  })
})

describe('the chip under the pointer', () => {
  const chip = (id: string, x: number, y: number, visible = true): Placed => ({ id, text: id, author: 'user', x, y, visible, lean: [0, -1], gap: 9, box: { x, y, w: 30, h: 17 } })
  const placed = [chip('M1', 100, 100), chip('M2', 120, 108), chip('M3', 300, 300, false)]

  it('is the one whose box holds the point, the one drawn last where two meet', () => {
    expect(chipAt(placed, 105, 105)).toBe('M1')
    expect(chipAt(placed, 125, 112)).toBe('M2')
    expect(chipAt(placed, 145, 120)).toBe('M2')
  })

  it('takes in the hairline round a chip, and nothing further', () => {
    expect(chipAt(placed, 99, 100)).toBe('M1')
    expect(chipAt(placed, 96, 100)).toBeNull()
    expect(chipAt(placed, 110, 200)).toBeNull()
  })

  it('is never one that is not drawn', () => {
    expect(chipAt(placed, 305, 305)).toBeNull()
    expect(chipAt([], 0, 0)).toBeNull()
  })
})

describe('the value on a failing dimension\'s chip', () => {
  const camera = { position: [100, -100, 80] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], ortho: false, fov: 35, zoom: 1 }
  const height: DimensionMark = { id: 'M3', kind: 'dimension', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 1, camera, createdAt: '2026-10-22T10:00:00.000Z', measure: 'distance', a: { point: [0, 0, 0] }, b: { point: [0, 0, 40] }, expected: 42, value: 40, verdict: 'fail', measuredRevision: 2 }

  it('says by how much it misses, and which way, as its row does', () => {
    expect(labelValue(height, 2)).toEqual({ text: '40 mm', verdict: 'fail', off: '2 under' })
    expect(labelValue({ ...height, value: 42.25 }, 2)).toEqual({ text: '42.25 mm', verdict: 'fail', off: '0.25 over' })
  })

  it("says whose number a dimension holds when a size of the brief checks it, whether it fails or passes", () => {
    expect(labelValue({ ...height, expected: 42, expectedFrom: 'C7' }, 2)).toEqual({ text: '40 mm', verdict: 'fail', off: 'brief 42' })
    expect(labelValue({ ...height, value: 42, verdict: 'pass', expectedFrom: 'C7' }, 2)).toEqual({ text: '42 mm', verdict: 'pass', off: 'brief 42' })
    expect(labelValue({ ...height, expectedFrom: 'C7' }, 3)).toEqual({ text: '40 mm (r2)', stale: true })
  })

  it('says nothing more of one that passes, or of a value of another build', () => {
    expect(labelValue({ ...height, value: 42, verdict: 'pass' }, 2)).toEqual({ text: '42 mm', verdict: 'pass' })
    expect(labelValue(height, 3)).toEqual({ text: '40 mm (r2)', stale: true })
  })
})

describe('the chip of a mark the person says they want or do not want', () => {
  const camera = { position: [100, -100, 80] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], ortho: false, fov: 35, zoom: 1 }
  const view = (): THREE.PerspectiveCamera => {
    const c = new THREE.PerspectiveCamera(35, 1, 1, 1000)
    c.position.set(100, -100, 80)
    c.up.set(0, 0, 1)
    c.lookAt(0, 0, 0)
    c.updateMatrixWorld()
    return c
  }
  const pick = (over: object = {}): Mark => ({ id: 'M8', kind: 'pick', target: 'face', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera, createdAt: 't', anchor: { point: [0, 0, 0] }, ...over }) as unknown as Mark

  it('has its number for the text and its sign for the disc, which draws it beside the chip', () => {
    const [dont] = project([pick({ intent: 'dont' })], view(), { width: 400, height: 400 })
    expect([dont.text, dont.sign]).toEqual(['M8', '-'])
    expect(project([pick({ intent: 'want', anchorState: 'drifted' })], view(), { width: 400, height: 400 })[0]).toMatchObject({ text: 'M8~', sign: '+' })
    expect(project([pick()], view(), { width: 400, height: 400 })[0]).not.toHaveProperty('sign')
    expect(project([pick({ author: 'agent', intent: 'dont' })], view(), { width: 400, height: 400 })[0]).not.toHaveProperty('sign')
  })
})

describe('the chip of a span on a tracing', () => {
  const camera = { position: [100, -100, 80] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], ortho: false, fov: 35, zoom: 1 }
  const span = (over: Partial<SpanMark> = {}): SpanMark => ({ id: 'M7', kind: 'span', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera, createdAt: '2026-11-17T10:00:00.000Z', tracing: 'T1', a: { uv: [0, 0], point: [0, 0, 0], on: 'tracing' }, b: { uv: [41.8, 0], point: [41.8, 0, 0], on: 'photo' }, value: 41.8, exact: false, how: 'freehand', measuredOn: 1, ...over })
  const view = (): THREE.PerspectiveCamera => {
    const c = new THREE.PerspectiveCamera(35, 1, 1, 1000)
    c.position.set(100, -100, 80)
    c.up.set(0, 0, 1)
    c.lookAt(20, 0, 0)
    c.updateMatrixWorld()
    return c
  }

  it('writes its value beside its number, with ≈ unless it is exact', () => {
    expect(project([span()], view(), { width: 400, height: 400 })[0].value).toEqual({ text: '≈ 41.8 mm' })
    expect(project([span({ exact: true })], view(), { width: 400, height: 400 })[0].value).toEqual({ text: '41.8 mm' })
  })
})
