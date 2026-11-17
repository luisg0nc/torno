import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NewMark, PinMark } from '../../shared/marks'
import type { TracingPlane } from '../../shared/tracings'
import { MarkStore } from '../marks/store'
import { healMarks } from './heal'
import { TracingStore } from './store'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
/** T1: a face's plane, z = 10, u along X and v along Y. */
const FACE: TracingPlane = { origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'plane through block/F31', from: { kind: 'face', ref: 'block/F31', revision: 1 } }

let root: string
let tracings: TracingStore
let marks: MarkStore
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-heal-'))
  const dir = join(root, 'bracket')
  mkdirSync(dir)
  tracings = new TracingStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  marks = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T10:00:00.000Z') })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const pin = (z: number): NewMark => ({ author: 'user', note: '', layout: 'assembly', revision: 1, camera: CAMERA, kind: 'pin', anchor: { point: [3, 4, z] }, tracing: 'T1', uv: [[3, 4]] }) as NewMark

describe('healMarks, when a project is opened', () => {
  it('puts back a mark the crash between the plane\'s write and its marks\' left off the plane', async () => {
    await tracings.make('bracket', { name: '', layout: 'assembly', plane: FACE }, 'person')
    await marks.add('bracket', pin(10))
    // The plane was moved 0.3 mm along its normal; the process ended before the marks followed.
    await tracings.movePlane('bracket', 'T1', { origin: [0, 0, 10.3] })
    expect(await healMarks({ tracings, marks }, 'bracket')).toEqual(['M1'])
    expect(((await marks.list('bracket')) as PinMark[])[0].anchor.point).toEqual([3, 4, 10.3])
    // Once: the next open finds nothing to do.
    expect(await healMarks({ tracings, marks }, 'bracket')).toEqual([])
  })

  it('does nothing for a project with no tracings, and fails quietly where the files cannot be read', async () => {
    expect(await healMarks({ tracings, marks }, 'bracket')).toEqual([])
    expect(await healMarks({ tracings, marks }, 'nowhere')).toEqual([])
  })
})
