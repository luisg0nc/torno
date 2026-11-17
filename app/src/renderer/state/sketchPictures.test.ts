import { describe, expect, it } from 'vitest'
import type { Mark, SketchMark, Vec3 } from '../../shared/marks'
import { MissingPictures } from './sketchPictures'

const CAMERA = { position: [100, -100, 80] as Vec3, target: [0, 0, 10] as Vec3, up: [0, 0, 1] as Vec3, ortho: false, fov: 35, zoom: 1 }
const sketch = (n: number, over: Partial<SketchMark> = {}): SketchMark => ({
  author: 'agent',
  note: '',
  status: 'sent',
  anchorState: 'ok',
  layout: 'assembly',
  revision: 1,
  camera: CAMERA,
  createdAt: '2026-11-17T10:00:00.000Z',
  id: `M${n}`,
  kind: 'sketch',
  name: 'Hose',
  take: 'rough',
  planes: [],
  strokes: [{ points: [[0, 0, 0], [1, 1, 1]], pen: 'free', revision: 1 }],
  ...over
})
const pin = { id: 'M1', kind: 'pin' } as unknown as Mark

/** A queue whose turns are run by hand, one each, so that "off the frame loop" and "one at a time" can be seen. */
function queue(over: { draw?: (mark: SketchMark) => Promise<Uint8Array | null>; busy?: () => boolean } = {}) {
  const turns: Array<() => void> = []
  const drawn: string[] = []
  const kept: string[] = []
  const missing = new MissingPictures({
    later: (run) => void turns.push(run),
    draw: over.draw ?? (async (mark) => (drawn.push(mark.id), new Uint8Array([1]))),
    keep: async (objectId, id) => void kept.push(`${objectId}/${id}`),
    busy: over.busy ?? (() => false)
  })
  /** Runs the turns that wait, until none does. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 50 && turns.length > 0; i++) {
      turns.shift()!()
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { missing, turns, drawn, kept, settle }
}

describe('the pictures of sketches that have none', () => {
  it('draws nothing in the turn it is told, and one picture a turn after that, in the order of the numbers', async () => {
    const { missing, turns, drawn, kept, settle } = queue()
    missing.offer('bracket', [pin, sketch(5), sketch(3)])
    expect(drawn).toEqual([])
    expect(turns).toHaveLength(1)
    turns.shift()!()
    await new Promise((r) => setTimeout(r, 0))
    expect(drawn).toEqual(['M3'])
    // The next waits for its own turn.
    expect(turns).toHaveLength(1)
    await settle()
    expect(drawn).toEqual(['M3', 'M5'])
    expect(kept).toEqual(['bracket/M3', 'bracket/M5'])
  })

  it('leaves alone a sketch that has its picture, one with no stroke, and a mark of another kind', async () => {
    const { missing, drawn, settle } = queue()
    missing.offer('bracket', [pin, sketch(2, { picture: 'k-aaaaaaaaaaaa.png' }), sketch(3, { strokes: [] })])
    await settle()
    expect(drawn).toEqual([])
  })

  it('does not ask twice for one that could not be drawn, but draws one that came after', async () => {
    const failing = new Set(['M3'])
    const asked: string[] = []
    const { missing, settle } = queue({
      draw: async (mark) => {
        asked.push(mark.id)
        if (failing.has(mark.id)) throw new Error('no view')
        return new Uint8Array([1])
      }
    })
    missing.offer('bracket', [sketch(3)])
    await settle()
    missing.offer('bracket', [sketch(3), sketch(4)])
    await settle()
    expect(asked).toEqual(['M3', 'M4'])
  })

  it('does not draw while a sketch is being drawn, and goes on when it is done', async () => {
    let drawing = true
    const { missing, drawn, settle } = queue({ busy: () => drawing })
    missing.offer('bracket', [sketch(3)])
    await settle()
    expect(drawn).toEqual([])
    drawing = false
    missing.offer('bracket', [sketch(3)])
    await settle()
    expect(drawn).toEqual(['M3'])
  })

  it('does not keep a picture of a project that is no longer the one on show, and starts over with the next', async () => {
    const { missing, kept, settle } = queue()
    missing.offer('bracket', [sketch(3), sketch(4)])
    missing.offer('lid', [sketch(3)])
    await settle()
    expect(kept).toEqual(['lid/M3'])
  })

  it('is told of none when no project is on show', async () => {
    const { missing, drawn, settle } = queue()
    missing.offer(null, [sketch(3)])
    await settle()
    expect(drawn).toEqual([])
  })
})
