import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SketchDraft } from '../../shared/bridge'
import type { Mark, NewStroke, SketchMark } from '../../shared/marks'
import type { Camera } from '../../shared/view'
import { reviewStore } from './review'
import { toolStore } from './tools'
import {
  TYPED_MS,
  activatePlane,
  activePlane,
  addPlane,
  addStroke,
  cycleTake,
  dropSketchOf,
  editSketch,
  eraseStroke,
  finishSketch,
  leaveSketch,
  setDiameter,
  setName,
  setOffset,
  setSketchEnv,
  setTake,
  settled,
  sketchStore,
  startSketch,
  takeMarks,
  undoStroke,
  type SketchEnv
} from './sketching'
import { mainPlane } from '../tools/sketch/planes'

const CAMERA: Camera = { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }

const line = (n: number, over: Partial<NewStroke> = {}): NewStroke => ({ plane: 1, pen: 'line', points2d: [[n, 0], [n, 10]], revision: 3, ...over })

/** An env that records what the sketch asks of main, and answers as main does: a number for a sketch made, the mark as sent. */
function fake(over: Partial<SketchEnv> = {}) {
  const calls: SketchDraft[] = []
  const pictures: Array<[string, string, number]> = []
  const open: Array<string | null> = []
  const said: string[] = []
  let made = 0
  let revision = 3
  const answer = (d: SketchDraft): SketchMark => ({ ...d, kind: 'sketch', id: d.id ?? `M${++made}`, author: 'user', status: 'draft', anchorState: 'ok', createdAt: '2026-11-17T00:00:00.000Z' }) as unknown as SketchMark
  const env: SketchEnv = {
    marks: {
      sketch: async (d) => {
        calls.push(structuredClone(d))
        return answer(d)
      },
      sketchPicture: async (objectId, id, png) => void pictures.push([objectId, id, png.length]),
      sketching: (_objectId, id) => void open.push(id)
    },
    here: () => ({ objectId: 'bracket', layout: 'assembly', revision, camera: CAMERA, centre: [0, 0, 10] }),
    picture: async () => new Uint8Array([1, 2, 3]),
    say: (_objectId, message) => void said.push(message),
    ...over
  }
  return { env, calls, pictures, open, said, bump: () => void (revision += 1) }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  leaveSketch()
  setSketchEnv(null)
  vi.useRealTimers()
  toolStore.setState({ tool: 'select' })
})

const draftOf = () => sketchStore.getState().open!.draft

describe('opening a sketch', () => {
  it('starts on the plane the view faces through the middle of the parts, and sends nothing: starting and leaving with no stroke writes nothing', async () => {
    const f = fake()
    setSketchEnv(f.env)
    expect(startSketch('bracket')).toBe(true)
    // The camera is on -Y looking along +Y: it faces XZ, through the middle of the parts (y = 0).
    expect(activePlane()).toMatchObject({ id: 1, label: 'XZ at y = 0.0 (u = +X, v = +Z)', from: { kind: 'main', axis: 'XZ', offset: 0 } })
    expect(draftOf()).toMatchObject({ objectId: 'bracket', layout: 'assembly', revision: 3, take: 'rough', name: '', note: '', strokes: [] })
    setName('Breather hose')
    setTake('flow')
    await vi.advanceTimersByTimeAsync(1000)
    leaveSketch()
    await finishSketch()
    expect(f.calls).toEqual([])
    expect(f.open).toEqual([])
    expect(f.pictures).toEqual([])
    expect(sketchStore.getState().open).toBeNull()
  })

  it('does not start with no project on show, or another one', () => {
    setSketchEnv(fake({ here: () => null }).env)
    expect(startSketch('bracket')).toBe(false)
    setSketchEnv(fake().env)
    expect(startSketch('other')).toBe(false)
  })
})

describe('strokes', () => {
  it('makes the sketch with the first stroke, with no id, and the second carries the id main gave', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).not.toHaveProperty('id')
    expect(f.calls[0].strokes).toEqual([line(0)])
    expect(f.calls[0].planes).toHaveLength(1)
    expect(sketchStore.getState().open?.id).toBe('M1')
    // It is told main that this sketch is open, once there is one.
    expect(f.open).toEqual(['M1'])
    addStroke(line(5))
    await settled()
    expect(f.calls).toHaveLength(2)
    expect(f.calls[1].id).toBe('M1')
    expect(f.calls[1].strokes).toEqual([line(0), line(5)])
    expect(sketchStore.getState().problem).toBeNull()
  })

  it('makes the sketch with what the bar of an open review says, until main gives it its id, and then says nothing of it', async () => {
    const f = fake()
    setSketchEnv(f.env)
    reviewStore.setState({ objectId: 'bracket', rounds: [{ id: 'R1', build: 'h41', sources: 'abc', line: '', layout: 'assembly', startedAt: 't' }], choice: 'dont' })
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    addStroke(line(5))
    await settled()
    expect(f.calls[0]).toMatchObject({ intent: 'dont' })
    expect(f.calls[1]).not.toHaveProperty('intent')
    leaveSketch()
    // On another layout than the round's, or with the bar on plain, it is a plain sketch.
    reviewStore.setState({ choice: 'plain' })
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    expect(f.calls[2]).not.toHaveProperty('intent')
    reviewStore.setState({ objectId: null, rounds: [], choice: 'plain' })
  })

  it('waits for the first answer before sending the second, so that the second has its id, and sends the latest', async () => {
    let release!: () => void
    const f = fake()
    const first = f.env.marks.sketch
    f.env.marks.sketch = async (d) => {
      if (!d.id) await new Promise<void>((resolve) => (release = resolve))
      return first(d)
    }
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    addStroke(line(5))
    addStroke(line(9))
    expect(f.calls).toHaveLength(0)
    release()
    await settled()
    expect(f.calls.map((d) => [d.id, d.strokes.length])).toEqual([[undefined, 1], ['M1', 3]])
  })

  it('erase sends the draft without that stroke, and Undo sends it back', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    for (const n of [0, 5, 9]) addStroke(line(n))
    await settled()
    // Main has not numbered them yet: the stroke itself is what is erased.
    eraseStroke(draftOf().strokes[1])
    await settled()
    expect(f.calls.at(-1)!.strokes).toEqual([line(0), line(9)])
    expect(sketchStore.getState().undoable).toBe(4)
    expect(undoStroke()).toBe(true)
    await settled()
    expect(f.calls.at(-1)!.strokes).toEqual([line(0), line(5), line(9)])
    // Undo goes back through the adds too, as one list.
    undoStroke()
    await settled()
    expect(f.calls.at(-1)!.strokes).toEqual([line(0), line(5)])
    expect(sketchStore.getState().undoable).toBe(2)
    undoStroke()
    undoStroke()
    expect(undoStroke()).toBe(false)
    await settled()
    expect(f.calls.at(-1)!.strokes).toEqual([])
  })

  it('keeps the draft, says main’s words and sends again with the next change when main refuses', async () => {
    const f = fake()
    let refuse = true
    const ok = f.env.marks.sketch
    f.env.marks.sketch = async (d) => {
      if (refuse) throw new Error('Stroke 1 was drawn on build 2, and the last build is 3.')
      return ok(d)
    }
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    expect(f.said).toEqual(['The sketch was not kept: Stroke 1 was drawn on build 2, and the last build is 3.'])
    expect(sketchStore.getState().problem).toMatch(/last build is 3/)
    expect(draftOf().strokes).toEqual([line(0)])
    refuse = false
    addStroke(line(5))
    await settled()
    expect(sketchStore.getState().problem).toBeNull()
    expect(sketchStore.getState().open?.id).toBe('M1')
  })

  it('refuses a stroke past what a sketch keeps, with why, and keeps the rest', () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    for (let i = 0; i < 200; i++) expect(addStroke(line(i))).toBe(true)
    expect(addStroke(line(201))).toBe(false)
    expect(f.said).toEqual(['A sketch has at most 200 strokes.'])
    expect(draftOf().strokes).toHaveLength(200)
  })

  it('ties the sketch to the first anchor it is given, and no later one', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0), { point: [1, 2, 3], part: 'block', ref: 'block/F2' })
    addStroke(line(5), { point: [9, 9, 9], part: 'block', ref: 'block/F3' })
    await settled()
    expect(f.calls.at(-1)!.anchor).toEqual({ point: [1, 2, 3], part: 'block', ref: 'block/F2' })
  })
})

describe('the fields', () => {
  it('sends a typed field 300 ms after the last key, once, and not before the sketch has a stroke', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    f.calls.length = 0
    setName('B')
    await vi.advanceTimersByTimeAsync(TYPED_MS - 50)
    setName('Br')
    await vi.advanceTimersByTimeAsync(TYPED_MS - 50)
    expect(f.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(60)
    await settled()
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toMatchObject({ id: 'M1', name: 'Br' })
  })

  it('sends what is waiting when the sketch is let go, a typed field or what queued behind a send', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    f.calls.length = 0
    setName('Hose')
    leaveSketch()
    await settled()
    expect(sketchStore.getState().open).toBeNull()
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toMatchObject({ id: 'M1', name: 'Hose' })
    // Nothing waits any more: the timer is gone.
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.calls).toHaveLength(1)
  })

  it('sends what queued behind a send in the air when the sketch is let go', async () => {
    let release: () => void = () => {}
    const calls: SketchDraft[] = []
    const f = fake({})
    const slow: SketchEnv['marks']['sketch'] = async (d) => {
      calls.push(structuredClone(d))
      if (calls.length === 2) await new Promise<void>((r) => (release = r))
      return { ...d, kind: 'sketch', id: d.id ?? 'M1', author: 'user', status: 'draft', anchorState: 'ok', createdAt: '' } as unknown as SketchMark
    }
    setSketchEnv({ ...f.env, marks: { ...f.env.marks, sketch: slow } })
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    addStroke(line(5)) // in the air
    setName('Hose') // typed: waits 300 ms
    leaveSketch()
    release()
    await settled()
    expect(calls).toHaveLength(3)
    expect(calls[2]).toMatchObject({ id: 'M1', name: 'Hose' })
    expect(calls[2].strokes).toHaveLength(2)
  })

  it('sends what waits for a sketch let go while its first send is in the air to the sketch main made, and makes no second one', async () => {
    let release: () => void = () => {}
    const calls: SketchDraft[] = []
    const f = fake()
    const slow: SketchEnv['marks']['sketch'] = async (d) => {
      calls.push(structuredClone(d))
      if (calls.length === 1) await new Promise<void>((r) => (release = r))
      return { ...d, kind: 'sketch', id: d.id ?? 'M1', author: 'user', status: 'draft', anchorState: 'ok', createdAt: '' } as unknown as SketchMark
    }
    setSketchEnv({ ...f.env, marks: { ...f.env.marks, sketch: slow } })
    startSketch('bracket')
    addStroke(line(0))
    setName('Hose')
    leaveSketch()
    release()
    await settled()
    expect(calls.map((d) => [d.id, d.name])).toEqual([[undefined, ''], ['M1', 'Hose']])
  })

  it('sends a sketch let go with the revision and camera it has, not those of the view it was let go for', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    f.calls.length = 0
    const other: Camera = { ...CAMERA, position: [5, 5, 5] }
    setSketchEnv({ ...f.env, here: () => ({ objectId: 'bracket', layout: 'other', revision: 9, camera: other, centre: [0, 0, 0] }) })
    setName('Hose')
    // Another layout is shown within the 300 ms.
    dropSketchOf('bracket', 'other')
    await settled()
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toMatchObject({ id: 'M1', name: 'Hose', layout: 'assembly', revision: 3, camera: CAMERA })
  })

  it('sends take at once, and a diameter only of flow, kept until the take is something else', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    setDiameter(19)
    expect(draftOf().diameter).toBeUndefined()
    cycleTake()
    await settled()
    expect(draftOf().take).toBe('flow')
    expect(f.calls.at(-1)!.take).toBe('flow')
    setDiameter(19)
    await vi.advanceTimersByTimeAsync(TYPED_MS)
    await settled()
    expect(f.calls.at(-1)).toMatchObject({ take: 'flow', diameter: 19 })
    setDiameter(0)
    setDiameter(501)
    expect(draftOf().diameter).toBe(19)
    cycleTake()
    await settled()
    expect(f.calls.at(-1)!.take).toBe('exact')
    expect(f.calls.at(-1)).not.toHaveProperty('diameter')
  })

  it('keeps a name to one line and at most 80 characters', () => {
    setSketchEnv(fake().env)
    startSketch('bracket')
    setName(`a\nb${'x'.repeat(100)}`)
    expect(draftOf().name).toHaveLength(80)
    expect(draftOf().name).not.toContain('\n')
  })
})

describe('the planes', () => {
  it('replaces the plane in hand while nothing is drawn on it, and makes a plane of its own after', () => {
    setSketchEnv(fake().env)
    startSketch('bracket')
    activatePlane(mainPlane('XY', 0, [0, 0, 10]))
    activatePlane(mainPlane('YZ', 0, [0, 0, 10]))
    expect(draftOf().planes.map((p) => [p.id, p.label.slice(0, 2)])).toEqual([[1, 'YZ']])
    addStroke(line(0))
    activatePlane(mainPlane('XY', 12, [0, 0, 10]))
    expect(draftOf().planes.map((p) => [p.id, p.label.slice(0, 2)])).toEqual([[1, 'YZ'], [2, 'XY']])
    expect(sketchStore.getState().plane).toBe(2)
  })

  it('moves the plane in hand by its offset, and leaves a plane with strokes where it is', () => {
    setSketchEnv(fake().env)
    startSketch('bracket')
    setOffset(40)
    expect(activePlane()).toMatchObject({ id: 1, from: { kind: 'main', axis: 'XZ', offset: 40 }, label: 'XZ at y = 40.0 (u = +X, v = +Z)' })
    addStroke(line(0))
    setOffset(55)
    expect(draftOf().planes).toHaveLength(2)
    expect(draftOf().planes[0].from).toMatchObject({ offset: 40 })
    expect(activePlane()).toMatchObject({ id: 2, from: { offset: 55 } })
  })

  it('refuses a plane past the fifty a sketch keeps', () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    for (let i = 0; i < 60; i++) addPlane(mainPlane('XY', i, [0, 0, 0]))
    expect(draftOf().planes).toHaveLength(50)
    expect(f.said.at(-1)).toBe('A sketch has at most 50 planes.')
  })
})

describe('what main says meanwhile', () => {
  const kept = (m: SketchMark, strokes: NewStroke[]): SketchMark => ({ ...m, strokes } as SketchMark)

  it('takes a sketch that main moved into the draft, so that the next send is not refused for what the window had as it was', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    addStroke(line(5))
    await settled()
    const stored = { ...f.calls.at(-1)!, kind: 'sketch', id: 'M1', author: 'user', status: 'draft', anchorState: 'ok', createdAt: '' } as unknown as SketchMark
    // A rebuild moved it: another build, and another place.
    const moved = kept(stored, [line(2, { revision: 4 }), line(7, { revision: 4, touches: ['block/F1'] })])
    takeMarks([moved as Mark])
    expect(draftOf().strokes).toEqual([line(2, { revision: 4 }), line(7, { revision: 4 })])
    // Undo still knows the strokes.
    expect(sketchStore.getState().undoable).toBe(2)
    undoStroke()
    expect(draftOf().strokes).toEqual([line(2, { revision: 4 })])
  })

  it('takes the ids main gave, and erases a stroke by its id, never by where it stands', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    for (const n of [0, 5, 9]) addStroke(line(n))
    await settled()
    const stored = { ...f.calls.at(-1)!, kind: 'sketch', id: 'M1', author: 'user', status: 'draft', anchorState: 'ok', createdAt: '', nextStroke: 4 } as unknown as SketchMark
    takeMarks([kept(stored, [line(0, { id: 'k1' }), line(5, { id: 'k2' }), line(9, { id: 'k3' })]) as Mark])
    expect(draftOf().strokes.map((s) => s.id)).toEqual(['k1', 'k2', 'k3'])
    // Undo still knows the strokes it remembers, now with their ids.
    expect(undoStroke()).toBe(true)
    await settled()
    expect(f.calls.at(-1)!.strokes.map((s) => s.id)).toEqual(['k1', 'k2'])
    takeMarks([kept(stored, [line(0, { id: 'k1' }), line(5, { id: 'k2' })]) as Mark])
    // Another stroke is where k2 was: an erase of k2 is of k2, wherever it stands now.
    addStroke(line(7))
    eraseStroke('k1')
    await settled()
    expect(f.calls.at(-1)!.strokes.map((s) => s.id)).toEqual(['k2', undefined])
    // An id the draft has not is nothing to erase.
    const sent = f.calls.length
    eraseStroke('k9')
    await settled()
    expect(f.calls).toHaveLength(sent)
    expect(draftOf().strokes).toHaveLength(2)
  })

  it('leaves the draft alone while a send is on its way, and when main has what the window has', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    const before = draftOf()
    const stored = { ...f.calls.at(-1)!, kind: 'sketch', id: 'M1', author: 'user', status: 'draft', anchorState: 'ok', createdAt: '' } as unknown as SketchMark
    takeMarks([{ ...stored, strokes: [{ ...stored.strokes[0], touches: ['block/F2'] }] } as Mark])
    expect(draftOf()).toBe(before)
  })

  it('takes the name and the comment main has, while nothing is waiting, so that a comment typed in the marks row is not written over', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    const stored = { ...f.calls.at(-1)!, kind: 'sketch', id: 'M1', author: 'user', status: 'draft', anchorState: 'ok', createdAt: '' } as unknown as SketchMark
    takeMarks([{ ...stored, note: 'from the row', name: 'Renamed' } as Mark])
    expect(draftOf()).toMatchObject({ note: 'from the row', name: 'Renamed' })
    f.calls.length = 0
    addStroke(line(5))
    await settled()
    expect(f.calls.at(-1)).toMatchObject({ note: 'from the row', name: 'Renamed' })
    // Not while a typed field waits.
    setName('Typed')
    takeMarks([{ ...stored, note: 'later', name: 'Other' } as Mark])
    expect(draftOf()).toMatchObject({ name: 'Typed', note: 'from the row' })
  })

  it('takes again what main moved during a send, once the send is answered', async () => {
    let release: () => void = () => {}
    let n = 0
    const f = fake()
    const slow: SketchEnv['marks']['sketch'] = async (d) => {
      n += 1
      if (n === 2) await new Promise<void>((r) => (release = r))
      return { ...d, kind: 'sketch', id: d.id ?? 'M1', author: 'user', status: 'draft', anchorState: 'ok', createdAt: '' } as unknown as SketchMark
    }
    setSketchEnv({ ...f.env, marks: { ...f.env.marks, sketch: slow } })
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    addStroke(line(5)) // the send is in the air
    const stored = { ...draftOf(), kind: 'sketch', id: 'M1', author: 'user', status: 'draft', anchorState: 'ok', createdAt: '' } as unknown as SketchMark
    const moved = [line(2, { revision: 4 }), line(7, { revision: 4 })]
    takeMarks([{ ...stored, strokes: moved } as Mark])
    expect(draftOf().strokes).toEqual([line(0), line(5)])
    release()
    await settled()
    expect(draftOf().strokes).toEqual(moved)
  })

  it('closes a sketch that main no longer has', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    takeMarks([])
    expect(sketchStore.getState().open).toBeNull()
    // Nothing more is sent for it.
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.calls).toHaveLength(1)
  })
})

describe('Done', () => {
  it('draws the card’s picture from the sketch’s camera, has main keep it, and closes the sketch', async () => {
    const asked: Camera[] = []
    const f = fake({
      picture: async (camera) => {
        asked.push(camera)
        return new Uint8Array([9, 9, 9, 9])
      }
    })
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await finishSketch()
    expect(asked).toEqual([CAMERA])
    expect(f.pictures).toEqual([['bracket', 'M1', 4]])
    expect(f.open).toEqual(['M1', null])
    expect(sketchStore.getState().open).toBeNull()
    expect(sketchStore.getState().xray).toBe(false)
  })

  it('sends a typed field that is waiting first, and closes even when the picture cannot be drawn', async () => {
    const f = fake({
      picture: async () => {
        throw new Error('no canvas')
      }
    })
    setSketchEnv(f.env)
    startSketch('bracket')
    addStroke(line(0))
    await settled()
    setName('Hose')
    await finishSketch()
    expect(f.calls.at(-1)).toMatchObject({ id: 'M1', name: 'Hose' })
    expect(f.pictures).toEqual([])
    expect(sketchStore.getState().open).toBeNull()
  })

  it('has no picture to draw for a sketch that was started and given up', async () => {
    const f = fake()
    setSketchEnv(f.env)
    startSketch('bracket')
    await finishSketch()
    expect(f.pictures).toEqual([])
    expect(f.open).toEqual([])
  })
})

describe('editing a sketch again', () => {
  const stored = (over: Partial<SketchMark> = {}): SketchMark => ({
    kind: 'sketch',
    id: 'M7',
    author: 'user',
    status: 'sent',
    anchorState: 'ok',
    createdAt: '',
    note: 'where the hose goes',
    layout: 'assembly',
    revision: 2,
    camera: CAMERA,
    name: 'Hose',
    take: 'flow',
    diameter: 19,
    planes: [{ id: 1, ...mainPlane('XY', 5, [0, 0, 0]) }, { id: 2, ...mainPlane('XZ', 0, [0, 0, 0]) }],
    strokes: [line(0, { plane: 1, revision: 2 }), line(1, { plane: 2, revision: 2 })],
    ...over
  } as SketchMark)

  it('opens the sketch as it is, tells main it is open, and takes up the Draw tool', async () => {
    const f = fake()
    setSketchEnv(f.env)
    await editSketch(stored())
    expect(draftOf()).toMatchObject({ id: 'M7', name: 'Hose', take: 'flow', diameter: 19, note: 'where the hose goes', revision: 3 })
    expect(draftOf().strokes).toHaveLength(2)
    expect(sketchStore.getState()).toMatchObject({ plane: 2, undoable: 0 })
    expect(f.open).toEqual(['M7'])
    expect(toolStore.getState().tool).toBe('draw')
    // The next stroke carries its id: it is the same sketch.
    addStroke(line(9, { plane: 2 }))
    await settled()
    expect(f.calls[0].id).toBe('M7')
    expect(f.calls[0].strokes).toHaveLength(3)
  })

  it('does not open an agent’s sketch, and says whose it is', async () => {
    const f = fake()
    setSketchEnv(f.env)
    await editSketch(stored({ author: 'agent' }))
    expect(sketchStore.getState().open).toBeNull()
    expect(f.said).toEqual(["M7 is Claude's sketch: only Claude changes it."])
  })
})
