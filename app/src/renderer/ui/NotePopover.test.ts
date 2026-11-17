import { describe, expect, it } from 'vitest'
import type { ArrowMark, PickMark, PinMark, SketchMark, StrokeMark, Vec3 } from '../../shared/marks'
import { noteStillBelongs, subject, unsavedNote } from './NotePopover'

const CAMERA = { position: [100, -100, 80] as Vec3, target: [0, 0, 10] as Vec3, up: [0, 0, 1] as Vec3, ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera: CAMERA, createdAt: '2026-10-09T10:00:00.000Z' } as const
const ON = { point: [5, 0, 2.5] as Vec3, part: 'plate', ref: 'plate/E1', descriptor: 'line, 30 mm' }
const pick: PickMark = { ...BASE, id: 'M1', kind: 'pick', target: 'edge', anchor: ON }
const pin: PinMark = { ...BASE, id: 'M2', kind: 'pin', anchor: ON }
const arrow: ArrowMark = { ...BASE, id: 'M3', kind: 'arrow', from: ON, to: [5, 0, 14.5] }
const profile: StrokeMark = { ...BASE, id: 'M4', kind: 'stroke', space: 'plane', anchor: ON, plane: { origin: [5, 0, 2.5], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0' }, points2d: [[0, 0], [10, 0], [10, 5]] }

const sketch: SketchMark = { ...BASE, id: 'M5', kind: 'sketch', name: 'Hose route', take: 'flow', diameter: 19, nextStroke: 2, planes: [{ id: 1, origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 0.0', from: { kind: 'main', axis: 'XY', offset: 0 } }], strokes: [{ id: 'k1', plane: 1, points2d: [[0, 0], [1, 1]], pen: 'free', revision: 1 }] }

describe('what the note says its mark is on', () => {
  it('for a 3D sketch is its name and how it is taken, with what it holds', () => {
    expect(subject(sketch)).toEqual({ ref: 'Hose route', detail: 'flow ⌀19 mm, 1 stroke on 1 plane', state: 'ok' })
    expect(subject({ ...sketch, name: '', strokes: [], anchorState: 'drifted' })).toEqual({ ref: 'Sketch M5', detail: 'flow ⌀19 mm, no strokes yet, moved: check it', state: 'drifted' })
  })

  it('is the ref and the kernel’s line about it', () => {
    expect(subject(pick)).toEqual({ ref: 'plate/E1', detail: 'line, 30 mm', state: 'ok' })
    expect(subject(arrow)).toEqual({ ref: '12.0 mm', detail: 'from plate/E1', state: 'ok' })
    expect(subject(profile)).toEqual({ ref: 'XZ at y = 0.0', detail: '10.0 × 5.0 mm, from plate/E1', state: 'ok' })
  })

  it('for a mark the last build moved off its surface, is the ref it was placed on and that it moved: not what is under its point now', () => {
    // The descriptor is of what is there now; the ref is kept from where it was placed. They do not agree.
    const now = { ...ON, descriptor: 'line, 12 mm' }
    expect(subject({ ...pick, anchorState: 'drifted', anchor: now })).toEqual({ ref: 'plate/E1', detail: 'moved: check it', state: 'drifted' })
    expect(subject({ ...pin, anchorState: 'drifted', anchor: now })).toEqual({ ref: 'plate/E1', detail: 'moved: check it', state: 'drifted' })
    expect(subject({ ...arrow, anchorState: 'drifted', from: now })).toEqual({ ref: '12.0 mm', detail: 'from plate/E1, moved: check it', state: 'drifted' })
    expect(subject({ ...profile, anchorState: 'drifted', anchor: now })).toEqual({ ref: 'XZ at y = 0.0', detail: '10.0 × 5.0 mm, from plate/E1, moved: check it', state: 'drifted' })
  })

  it('for a mark whose part is gone, says so', () => {
    expect(subject({ ...pick, anchorState: 'orphaned' })).toEqual({ ref: 'plate/E1', detail: 'its part is gone', state: 'orphaned' })
    expect(subject({ ...arrow, anchorState: 'orphaned' })).toEqual({ ref: '12.0 mm', detail: 'from plate/E1, its part is gone', state: 'orphaned' })
  })
})

describe('what is kept of a note whose card went away by itself', () => {
  it('is what was typed, trimmed, when the mark does not say it yet', () => {
    expect(unsavedNote('  make this 8 mm ', '', false)).toBe('make this 8 mm')
    expect(unsavedNote('', 'old note', false)).toBe('')
  })

  it('is nothing when nothing was changed, or the person ended the writing themselves', () => {
    expect(unsavedNote('same ', 'same', false)).toBeNull()
    expect(unsavedNote('typed', '', true)).toBeNull()
  })
})

describe('whether a note typed when its card went still belongs to its mark', () => {
  it('does while the workspace it was typed in is the one open, whichever of its objects is shown', () => {
    expect(noteStillBelongs('/ws', '/ws')).toBe(true)
  })

  it('does not once another folder is open, or none: an object there may have the same name, and a mark of the same number', () => {
    expect(noteStillBelongs('/ws', '/other')).toBe(false)
    expect(noteStillBelongs('/ws', undefined)).toBe(false)
    expect(noteStillBelongs(undefined, undefined)).toBe(false)
  })
})
