import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SketchMark, Vec3 } from '../../shared/marks'
import { plainText } from '../../test/plainText'
import { SketchSummary } from './MarkRow'

const CAMERA = { position: [100, -100, 80] as Vec3, target: [0, 0, 10] as Vec3, up: [0, 0, 1] as Vec3, ortho: false, fov: 35, zoom: 1 }
const sketch = (over: Partial<SketchMark> = {}): SketchMark => ({
  author: 'user',
  note: 'round the block',
  status: 'draft',
  anchorState: 'ok',
  layout: 'assembly',
  revision: 1,
  camera: CAMERA,
  createdAt: '2026-11-17T10:00:00.000Z',
  id: 'M7',
  kind: 'sketch',
  name: 'Hose route',
  take: 'flow',
  diameter: 19,
  planes: [{ id: 1, origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 0.0', from: { kind: 'main', axis: 'XY', offset: 0 } }],
  nextStroke: 3,
  strokes: [{ id: 'k1', plane: 1, points2d: [[0, 0], [1, 1]], pen: 'free', revision: 1 }, { id: 'k2', points: [[0, 0, 0], [1, 1, 1]], pen: 'free', revision: 1 }],
  ...over
})

describe("a 3D sketch's row", () => {
  it('says its name, how it is taken with its diameter, and how many strokes and planes it has', () => {
    const out = renderToStaticMarkup(createElement(SketchSummary, { mark: sketch() }))
    expect(plainText(out)).toBe('Hose routeflow ⌀19 mm2 strokes on 1 plane')
    // The numbers are in the face of numbers.
    expect(out).toMatch(/class="mark-sketch-take num"/)
    expect(out).toMatch(/class="mark-sketch-counts num"/)
  })

  it('is called by its number when it has no name, and says it has no strokes yet', () => {
    expect(plainText(renderToStaticMarkup(createElement(SketchSummary, { mark: sketch({ name: '', take: 'rough', strokes: [] }) })))).toBe('Sketch M7roughno strokes yet')
  })
})
