import { describe, expect, it } from 'vitest'
import type { DimensionMark, Mark, PinMark } from '../../shared/marks'
import type { ViewportPointer } from '../viewport/Viewport'
import { chipSays, markChips } from './markChips'

const CAMERA = { position: [100, -100, 80] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera: CAMERA, createdAt: '2026-10-22T10:00:00.000Z' } as const

describe('what a chip says at the pointer', () => {
  const pin: PinMark = { ...BASE, id: 'M1', kind: 'pin', note: 'too thin here', anchor: { point: [0, 0, 0] } }
  const height: DimensionMark = { ...BASE, id: 'M3', kind: 'dimension', note: 'height with the lid', measure: 'distance', a: { point: [0, 0, 0] }, b: { point: [0, 0, 40] }, expected: 42, tolerance: 0.1, value: 40, verdict: 'fail', measuredRevision: 2 }

  it('is the note of a mark, and says when there is none', () => {
    expect(chipSays(pin, 2)).toBe('too thin here')
    expect(chipSays({ ...pin, note: '' }, 2)).toBe('No note')
  })

  it('is the name and take of a 3D sketch, then its comment', () => {
    const sketch = { ...BASE, id: 'M7', kind: 'sketch', name: 'Hose route', take: 'flow', diameter: 19, note: 'round the block', planes: [], strokes: [] } as unknown as Mark
    expect(chipSays(sketch, 2)).toBe('Hose route, flow ⌀19 mm, round the block')
    expect(chipSays({ ...sketch, name: '', note: '', take: 'rough' } as Mark, 2)).toBe('Sketch M7, rough')
  })

  it('is the numbers of a dimension: its value, what was expected, and by how much it misses', () => {
    expect(chipSays(height, 2)).toBe('40 mm, expected 42 ± 0.1, 2 under')
    expect(chipSays({ ...height, value: 42.05, verdict: 'pass' }, 2)).toBe('42.05 mm, expected 42 ± 0.1')
    expect(chipSays({ ...height, expected: undefined, verdict: undefined }, 2)).toBe('40 mm')
    // Of another build: what its chip says, and no verdict.
    expect(chipSays(height, 3)).toBe('40 mm, not measured on r3: this is what it was on r2')
  })
})

/** A pointer event at a place, with what is held. */
function at(type: ViewportPointer['type'], x: number, y: number, buttons = 0): ViewportPointer {
  return { type, hit: null, ray: { origin: [0, 0, 0], direction: [0, 0, -1] }, client: [x, y], buttons, shift: false, alt: false }
}

function chips() {
  const told: string[] = []
  const router = markChips({
    // One chip, from 100 to 130 across.
    markAt: ([x]) => (x >= 100 && x <= 130 ? 'M1' : null),
    point: (id) => void told.push(`point ${id}`),
    say: ([x], id) => void told.push(`say ${id} at ${x}`),
    open: (id) => void told.push(`open ${id}`)
  })
  return { router, told }
}

describe('a mark’s chip under the pointer', () => {
  it('is pointed at as the pointer goes on and off it, and says its line wherever the pointer is on it; the tool is told of none of it', () => {
    const { router, told } = chips()
    expect(router.route(at('move', 50, 0))).toBe(false)
    expect(router.route(at('move', 110, 0))).toBe(true)
    expect(router.route(at('move', 120, 0))).toBe(true)
    expect(told).toEqual(['point M1', 'say M1 at 110', 'say M1 at 120'])
    // Off it, the move is the tool's again.
    expect(router.route(at('move', 140, 0))).toBe(false)
    expect(told.at(-1)).toBe('point null')
  })

  it('opens its mark on a click, which the tool is not handed: not the press, the release or the click', () => {
    const { router, told } = chips()
    expect([router.route(at('down', 110, 0, 1)), router.route(at('up', 110, 0)), router.route(at('click', 110, 0))]).toEqual([true, true, true])
    expect(told.filter((t) => t.startsWith('open'))).toEqual(['open M1'])
  })

  it('leaves a drag that starts on it to the camera: no mark is opened, and the tool is handed nothing of it', () => {
    const { router, told } = chips()
    expect(router.route(at('down', 110, 0, 1))).toBe(true)
    expect(router.route(at('move', 200, 0, 1))).toBe(true)
    expect(router.route(at('up', 200, 0))).toBe(true)
    expect(told.filter((t) => t.startsWith('open'))).toEqual([])
    // The next press elsewhere is the tool's.
    expect(router.route(at('down', 50, 0, 1))).toBe(false)
  })

  it('takes nothing of a press that began beside it, though it ends on it', () => {
    const { router, told } = chips()
    expect(router.route(at('down', 50, 0, 1))).toBe(false)
    expect(router.route(at('move', 110, 0, 1))).toBe(false)
    expect(router.route(at('up', 110, 0))).toBe(false)
    expect(router.route(at('click', 110, 0))).toBe(false)
    expect(told).toEqual([])
  })

  it('is let go when the pointer leaves the view, and the tool is told so too', () => {
    const { router, told } = chips()
    router.route(at('move', 110, 0))
    expect(router.route(at('cancel', 110, 0))).toBe(false)
    expect(told.at(-1)).toBe('point null')
    // Let go from outside, as when another tool is taken: once.
    router.route(at('move', 110, 0))
    router.drop()
    router.drop()
    expect(told.filter((t) => t === 'point null')).toHaveLength(2)
  })
})

describe('a drag that starts on a chip, with a tool in hand that takes presses', () => {
  function withTool(takes = true) {
    const told: string[] = []
    const router = markChips({
      markAt: ([x]) => (x >= 100 && x <= 130 ? 'M1' : null),
      point: () => {},
      say: ([x], id) => void told.push(`say ${id} at ${x}`),
      open: (id) => void told.push(`open ${id}`),
      tool: {
        takes: () => takes,
        holdCamera: () => void told.push('hold'),
        releaseCamera: () => void told.push('release'),
        send: (e) => void told.push(`tool ${e.type} at ${e.client[0]}${e.hit === null ? '' : ' hit'}`)
      }
    })
    return { router, told }
  }

  it('holds the camera at the press, and a click still opens the chip', () => {
    const { router, told } = withTool()
    expect([router.route(at('down', 110, 0, 1)), router.route(at('move', 112, 0, 1)), router.route(at('up', 112, 0)), router.route(at('click', 112, 0))]).toEqual([true, true, true, true])
    expect(told).toEqual(['hold', 'open M1'])
  })

  it('hands the tool the press where it was made once the pointer passes the click threshold, and every event after it', () => {
    const { router, told } = withTool()
    const down = { ...at('down', 110, 0, 1), hit: { ref: 'a/F1' } as ViewportPointer['hit'] }
    expect(router.route(down)).toBe(true)
    expect(router.route(at('move', 140, 0, 1))).toBe(false)
    expect(router.route(at('move', 150, 0, 1))).toBe(false)
    expect(router.route(at('up', 150, 0))).toBe(false)
    expect(told).toEqual(['hold', 'tool down at 110 hit', 'release'])
  })

  it('feeds the tool the moves over a chip, with nothing under them but the chip', () => {
    const { router, told } = withTool()
    expect(router.route(at('move', 110, 0))).toBe(true)
    expect(told).toEqual(['tool move at 110', 'say M1 at 110'])
  })

  it('leaves the drag to the camera when the tool takes no press here', () => {
    const { router, told } = withTool(false)
    expect(router.route(at('down', 110, 0, 1))).toBe(true)
    expect(router.route(at('move', 200, 0, 1))).toBe(true)
    expect(told).toEqual([])
  })
})
