import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Mark, NoteMark, PinMark, ShapeMark, Vec3 } from '../../../shared/marks'
import { MarkLayer, cutAway } from './MarkLayer'

const CAMERA = { position: [100, -100, 80] as Vec3, target: [0, 0, 10] as Vec3, up: [0, 0, 1] as Vec3, ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera: CAMERA, createdAt: '2026-10-09T10:00:00.000Z' } as const
const COLOURS = { user: '#cf3f2c', agent: '#288156', reference: '#686d74' }

const low: PinMark = { ...BASE, id: 'M1', kind: 'pin', anchor: { point: [1, 2, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F4' } }
const high: PinMark = { ...BASE, id: 'M2', kind: 'pin', anchor: { point: [0, 0, 22.5], normal: [0, 0, 1], part: 'post', ref: 'post/F1' } }
const onPlane: PinMark = { ...BASE, id: 'M3', kind: 'pin', anchor: { point: [4, 0, 12.5], part: 'post', ref: 'post/F0' } }
const loose: ShapeMark = { ...BASE, id: 'M4', kind: 'shape', shape: 'box', intent: 'add', position: [50, 0, 30], rotation: [0, 0, 0, 1], size: [5, 5, 5] }
const MARKS: Mark[] = [low, high, onPlane, loose]
const Z = { origin: [0, 0, 12.5] as Vec3, normal: [0, 0, 1] as Vec3 }

/** Of a mark's objects, how many are drawn where nothing covers them, and how the rest test the depth. */
function passes(marks: MarkLayer, id: string): { full: number; dimmed: THREE.DepthModes[] } {
  const root = marks.group.children.find((object) => object.name === id)!
  let full = 0
  const dimmed: THREE.DepthModes[] = []
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.Material | undefined
    if (!material) return
    if (material.depthFunc === THREE.LessEqualDepth) full += object.visible ? 1 : 0
    else dimmed.push(material.depthFunc)
  })
  return { full, dimmed }
}

describe('marks and a section', () => {
  it('a mark anchored in the half that is taken away is drawn dimmed all over, and no other is', () => {
    const marks = new MarkLayer(COLOURS)
    marks.setMarks(MARKS)
    marks.show('assembly')
    const whole = passes(marks, 'M2')
    expect(whole.full).toBeGreaterThan(0)
    expect(new Set(whole.dimmed)).toEqual(new Set([THREE.GreaterDepth]))

    marks.setSection(Z)
    // It is still drawn: only its dimmed pass, wherever it is.
    expect(marks.group.children.find((object) => object.name === 'M2')!.visible).toBe(true)
    expect(passes(marks, 'M2')).toEqual({ full: 0, dimmed: whole.dimmed.map(() => THREE.AlwaysDepth) })
    // Below the plane, on it, and a shape tied to no part above it but placed there: by where it is anchored.
    expect(passes(marks, 'M1')).toEqual(passes(new MarkLayerOf([low]), 'M1'))
    expect(passes(marks, 'M3').full).toBeGreaterThan(0)
    expect(passes(marks, 'M4').full).toBe(0)

    // The other half taken away instead.
    marks.setSection({ origin: Z.origin, normal: [0, 0, -1] })
    expect(passes(marks, 'M2')).toEqual(whole)
    expect(passes(marks, 'M1').full).toBe(0)

    marks.setSection(null)
    for (const id of ['M1', 'M2', 'M3', 'M4']) expect(passes(marks, id).full).toBeGreaterThan(0)
  })

  it('holds for a mark made or changed while the section is on', () => {
    const marks = new MarkLayer(COLOURS)
    marks.setSection(Z)
    marks.setMarks([high])
    marks.show('assembly')
    expect(passes(marks, 'M2').full).toBe(0)
    marks.setMarks([{ ...high, anchor: { ...high.anchor, point: [0, 0, 5] } }])
    expect(passes(marks, 'M2').full).toBeGreaterThan(0)
  })
})

/** A layer with some marks and no section. */
class MarkLayerOf extends MarkLayer {
  constructor(marks: Mark[]) {
    super(COLOURS)
    this.setMarks(marks)
  }
}

describe('a view note with no anchor and a section', () => {
  it('is never in the half taken away: it is anywhere', () => {
    const note: NoteMark = { ...BASE, id: 'M7', kind: 'note', picture: 'n-0123456789ab.png', ink: 'n-0123456789ab.ink.png', size: { w: 100, h: 80 }, strokes: [], inkColour: '#cf3f2c', labels: [], under: [], references: [] }
    expect(cutAway(note, { origin: [0, 0, -5], normal: [0, 0, 1] })).toBe(false)
  })
})
