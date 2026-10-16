import { describe, expect, it, vi } from 'vitest'
import { isSpreadRefusal } from '../../shared/dimension'
import type { Anchor, DimensionMark, Mark, Measurement, NewMark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { KernelError } from '../kernel/client'
import { Refusal } from '../refusal'
import { sanitiseMark } from './file'
import { addDimension, addDimensionTold, dueAfterEdit, measureDimension, measureOnce, measureRequest, remeasure, wire } from './measure'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', note: '', layout: 'assembly', revision: 3, camera: CAMERA } as const
const TOP: Anchor = { point: [5, 3, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5', descriptor: 'plane, normal +Z, z = 3, 1100 mm²' }
const BOTTOM: Anchor = { point: [5, 3, -3], normal: [0, 0, -1], part: 'plate', ref: 'plate/F0' }
const HOLE: Anchor = { point: [-6, 5, 0], part: 'plate', ref: 'plate/F9' }
const SCENE = { model: 'm.py', layouts: ['assembly'], parts: [], seconds: 0, output: '' } as unknown as Scene

const distance = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'distance', a: TOP, b: BOTTOM, ...more }) as NewMark
const hole = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'diameter', a: HOLE, ...more }) as NewMark
const SIX = { kind: 'distance', value: 6.000000000000001, unit: 'mm', how: 'between planes', points: [[5, 3, 3], [5, 3, -3]], exact: true }
const EIGHT = { kind: 'diameter', value: 8, unit: 'mm', how: 'cylinder', points: [[-14, 5, 0], [-6, 5, 0]], exact: true }

/** `measureDimension` on r3, the build the kernel of these tests has unless a test says otherwise, and the one the ends are of. */
const onR3 = (deps: Parameters<typeof measureDimension>[0], objectId: string, mark: Parameters<typeof measureDimension>[2]) => measureDimension(deps, objectId, mark, 3)

/** A kernel that answers `measure` as told, and the build there is. */
function kernel(answer: (args: Record<string, unknown>) => unknown, nearest: (args: Record<string, unknown>) => unknown = () => ({ anchors: [] })) {
  const asked: Array<{ objectId: string; name: string; args: Record<string, unknown> }> = []
  const world = { revision: 3 as number | undefined }
  return {
    asked,
    world,
    query: async <T>(objectId: string, name: string, args: object): Promise<T> => {
      asked.push({ objectId, name, args: structuredClone(args) as Record<string, unknown> })
      return (await (name === 'nearest' ? nearest : answer)(args as Record<string, unknown>)) as T
    },
    scene: () => (world.revision === undefined ? undefined : { revision: world.revision, scene: SCENE })
  }
}

/** The store, as far as a dimension is added to it: what was done to it, in order. */
function marks() {
  const did: string[] = []
  const kept: Mark[] = []
  return {
    did,
    kept,
    list: async (): Promise<Mark[]> => structuredClone(kept),
    add: async (_objectId: string, mark: NewMark, _status?: 'draft' | 'sent', measured?: Measurement): Promise<Mark> => {
      const given = Object.fromEntries(Object.entries(mark).filter(([key]) => !['value', 'how', 'points', 'measuredRevision', 'refused', 'verdict'].includes(key)))
      const added = sanitiseMark({ ...given, ...measured, id: `M${kept.length + 1}`, status: 'draft', anchorState: 'ok', createdAt: '2026-10-09T12:00:00.000Z' })
      if (!added) throw new Error('that is not a mark: its kind is unknown, or a field is missing or not a finite number')
      did.push(`add ${added.id}${measured?.value === undefined ? '' : ` = ${measured.value}`}`)
      kept.push(added)
      return added
    },
    measured: async (_objectId: string, id: string, _of: object, result: Measurement): Promise<Mark | null> => {
      did.push(`measured ${id}${result.value === undefined ? ': nothing' : ` = ${result.value}`}`)
      const at = kept.findIndex((m) => m.id === id)
      if (at < 0) return null
      kept[at] = sanitiseMark({ ...kept[at], ...result })!
      return kept[at]
    },
    remove: async (_objectId: string, id: string): Promise<void> => {
      did.push(`remove ${id}`)
      kept.splice(kept.findIndex((m) => m.id === id), 1)
    }
  }
}

describe('what the kernel is asked of a dimension', () => {
  it('names each end by its ref, with the layout in front, and the point it was put at', () => {
    expect(measureRequest(distance() as DimensionMark)).toEqual({ kind: 'distance', a: { ref: 'assembly:plate/F5', point: [5, 3, 3] }, b: { ref: 'assembly:plate/F0', point: [5, 3, -3] } })
    expect(measureRequest(hole({ layout: 'print' }) as DimensionMark)).toEqual({ kind: 'diameter', a: { ref: 'print:plate/F9', point: [-6, 5, 0] } })
    expect((measureRequest(distance({ a: { point: [1, 2, 3], part: 'plate', ref: 'plate/E4', edge: 'plate/E4' } }) as DimensionMark) as { a: object }).a).toEqual({ ref: 'assembly:plate/E4', point: [1, 2, 3] })
  })

  it('gives an end with no ref as a point of the layout', () => {
    expect(measureRequest(distance({ a: { point: [1, 2, 9.5] } }) as DimensionMark)).toEqual({ kind: 'distance', a: { layout: 'assembly', point: [1, 2, 9.5] }, b: { ref: 'assembly:plate/F0', point: [5, 3, -3] } })
  })

  it('leaves out a second end where the measurement has one', () => {
    expect(measureRequest({ ...(hole() as DimensionMark), b: BOTTOM })).not.toHaveProperty('b')
    expect(measureRequest(distance({ measure: 'thickness' }) as DimensionMark)).toEqual({ kind: 'thickness', a: { ref: 'assembly:plate/F5', point: [5, 3, 3] } })
  })
})

describe('measureDimension', () => {
  it('asks the kernel about the object, and keeps the value in full, how it was taken, between which points, on which build', async () => {
    const k = kernel(() => SIX)
    expect(await onR3(k, 'measures', distance() as DimensionMark)).toEqual({ value: 6.000000000000001, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]], measuredRevision: 3 })
    expect(k.asked).toEqual([{ objectId: 'measures', name: 'measure', args: { kind: 'distance', a: { ref: 'assembly:plate/F5', point: [5, 3, 3] }, b: { ref: 'assembly:plate/F0', point: [5, 3, -3] } } }])
  })

  it('says pass or fail against what was expected', async () => {
    const k = kernel(() => EIGHT)
    expect(await onR3(k, 'measures', hole({ expected: 8.5 }) as DimensionMark)).toMatchObject({ value: 8, verdict: 'fail' })
    expect(await onR3(k, 'measures', hole({ expected: 8.5, tolerance: 0.5 }) as DimensionMark)).toMatchObject({ value: 8, verdict: 'pass' })
    expect(await onR3(k, 'measures', hole({ expected: 8.05 }) as DimensionMark)).toMatchObject({ verdict: 'pass' })
    expect(await onR3(k, 'measures', hole() as DimensionMark)).not.toHaveProperty('verdict')
  })

  it('is not measurable when the kernel no longer has what an end names: no value, and why, without the layout in front of the refs', async () => {
    const k = kernel(() => {
      throw new KernelError('bad_ref', "assembly:plate has no face 9; assembly:plate has 8 faces")
    })
    const measured = await onR3(k, 'measures', hole({ expected: 8 }) as DimensionMark)
    expect(measured).toEqual({ measuredRevision: 3, refused: 'plate has no face 9; plate has 8 faces' })
  })

  it('is not measurable either when the kernel refuses what was asked, and says why', async () => {
    const k = kernel(() => {
      throw new KernelError('bad_request', 'angle is measured between two planar faces, two straight edges, or a planar face and a straight edge; assembly:plate/F9 is a cylinder face')
    })
    expect(await onR3(k, 'measures', distance({ measure: 'angle', b: HOLE }) as DimensionMark)).toEqual({
      measuredRevision: 3,
      refused: 'angle is measured between two planar faces, two straight edges, or a planar face and a straight edge; plate/F9 is a cylinder face'
    })
  })

  it('fails, with a plain message, when the kernel could not answer at all, or answered what is no measurement', async () => {
    const timeout = kernel(() => {
      throw new KernelError('timeout', 'the query took longer than 30 s')
    })
    const failed = await onR3(timeout, 'measures', hole() as DimensionMark).catch((e: unknown) => e)
    expect(failed).toBeInstanceOf(Error)
    expect(failed).not.toBeInstanceOf(KernelError)
    expect((failed as Error).message).toBe('the query took longer than 30 s')
    await expect(onR3(kernel(() => ({ kind: 'diameter', value: 'eight' })), 'measures', hole() as DimensionMark)).rejects.toThrow('the kernel did not answer with a measurement')
    await expect(onR3(kernel(() => ({ ...EIGHT, value: NaN })), 'measures', hole() as DimensionMark)).rejects.toThrow('the kernel did not answer with a measurement')
  })

  it('needs the build its ends are of to be the last: with none, or another, the kernel is not asked', async () => {
    const none = kernel(() => EIGHT)
    none.world.revision = undefined
    await expect(onR3(none, 'measures', hole() as DimensionMark)).rejects.toThrow('there is no build of measures to measure on')
    const newer = kernel(() => EIGHT)
    newer.world.revision = 4
    await expect(onR3(newer, 'measures', hole() as DimensionMark)).rejects.toThrow('measures was built again (r4) since its ends were found on r3')
    await expect(measureDimension(kernel(() => EIGHT), 'measures', hole() as DimensionMark, undefined)).rejects.toThrow('its ends have not been checked against r3')
    expect([...none.asked, ...newer.asked]).toEqual([])
  })

  it('rejects when a build lands while the kernel is asked, and never asks again on that build: the refs are not of it', async () => {
    // The faces were renumbered: on r4, plate/F9 is another face, and the kernel would measure that one.
    const k = kernel(() => {
      k.world.revision = 4
      return { ...EIGHT, value: 30 }
    })
    await expect(onR3(k, 'measures', hole() as DimensionMark)).rejects.toThrow('measures was built again (r4) since its ends were found on r3')
    expect(k.asked).toHaveLength(1)
    // So too when the kernel refused, or failed, as it does of a build it no longer holds.
    const refusing = kernel(() => {
      refusing.world.revision = 4
      throw new KernelError('bad_ref', 'assembly:plate has no face 9')
    })
    await expect(onR3(refusing, 'measures', hole() as DimensionMark)).rejects.toThrow('measures was built again (r4)')
  })

  describe('with an end on an edge, once the build has moved an end of it', () => {
    const ON_EDGE: Anchor = { point: [20, 3, 3], part: 'plate', ref: 'plate/E7', edge: 'plate/E7', between: ['plate/F5', 'plate/F2'] }
    const span = (more: object = {}): DimensionMark => ({ ...(distance({ a: ON_EDGE }) as DimensionMark), anchorState: 'drifted', ...more })
    const near = (more: object) => () => ({ anchors: [{ part: 'plate', found: true, point: [20, 3, 2], normal: [1, 0, 0], ref: 'plate/F2', distance: 1, descriptor: 'plane', ...more }] })

    it('is not measured through an edge that is no longer under its end: the number may be another edge’s now', async () => {
      const k = kernel(() => ({ ...SIX, value: 12 }), near({ support: 'face', edgeFound: true, edgeDistance: 14 }))
      expect(await onR3(k, 'measures', span())).toEqual({ measuredRevision: 3, refused: 'the edge plate/E7 it was on is not under its end on r3' })
      expect(k.asked).toEqual([{ objectId: 'measures', name: 'nearest', args: { layout: 'assembly', anchors: [{ part: 'plate', point: [20, 3, 3], edge: 'plate/E7' }] } }])
      // Nor when the part has no edge of that number any more.
      expect(await onR3(kernel(() => SIX, near({ support: 'face', edgeFound: false })), 'measures', span())).toMatchObject({ refused: 'the edge plate/E7 it was on is not under its end on r3' })
    })

    it('is measured when the edge is under its end still: it was another end that moved', async () => {
      const k = kernel(() => SIX, near({ distance: 0, support: 'edge', edgeUnder: 'plate/E7', edgeFound: true, edgeDistance: 0 }))
      expect(await onR3(k, 'measures', span())).toMatchObject({ value: 6.000000000000001, measuredRevision: 3 })
      expect(k.asked.map((q) => q.name)).toEqual(['nearest', 'measure'])
      expect(await onR3(kernel(() => SIX, near({ support: 'face', edgeFound: true, edgeDistance: 0.3 })), 'measures', span())).toMatchObject({ value: 6.000000000000001 })
    })

    it('is not measured through the edge of the same number when that is the nearest edge and not under its end: the plate got thinner', async () => {
      // No renumbering: plate/E7 is still the top edge, now 1 mm below where the end was put. The kernel says the
      // nearest point of the part is on an edge, as it does however far away that is.
      const k = kernel(() => ({ ...SIX, value: 5 }), near({ distance: 1, support: 'edge', edgeUnder: 'plate/E7', edgeFound: true, edgeDistance: 1 }))
      expect(await onR3(k, 'measures', span())).toEqual({ measuredRevision: 3, refused: 'the edge plate/E7 it was on is not under its end on r3' })
      expect(k.asked.map((q) => q.name)).toEqual(['nearest'])
      // Within the tolerance of the part's surface it is under it.
      const close = kernel(() => SIX, near({ distance: 0.4, support: 'edge', edgeUnder: 'plate/E7' }))
      expect(await onR3(close, 'measures', span())).toMatchObject({ value: 6.000000000000001 })
    })

    it('goes by the edge the end says it is on, before its ref', async () => {
      const k = kernel(() => SIX, near({ distance: 0, support: 'edge', edgeUnder: 'plate/E7' }))
      await onR3(k, 'measures', span({ a: { ...ON_EDGE, ref: 'plate/F5' } }))
      expect((k.asked[0].args.anchors as object[])[0]).toEqual({ part: 'plate', point: [20, 3, 3], edge: 'plate/E7' })
    })

    it('asks nothing first of ends on faces, nor while no end has moved', async () => {
      const faces = kernel(() => SIX)
      await onR3(faces, 'measures', { ...(distance() as DimensionMark), anchorState: 'drifted' })
      const settled = kernel(() => SIX)
      await onR3(settled, 'measures', span({ anchorState: 'ok' }))
      expect([...faces.asked, ...settled.asked].map((q) => q.name)).toEqual(['measure', 'measure'])
    })

    it('rejects when the kernel does not say what is under the end: nothing is known of the edge then', async () => {
      const silent = kernel(() => SIX, () => {
        throw new KernelError('timeout', 'the query took longer than 30 s')
      })
      await expect(onR3(silent, 'measures', span())).rejects.toThrow('the query took longer than 30 s')
      const unsure = kernel(() => SIX, () => ({ anchors: [{ part: 'plate', found: true, error: 'no nearest point' }] }))
      await expect(onR3(unsure, 'measures', span())).rejects.toThrow('the kernel did not say whether plate/E7 is under its end')
      expect([...silent.asked, ...unsure.asked].filter((q) => q.name === 'measure')).toEqual([])
    })
  })

  it('keeps points only when they are two points', async () => {
    expect(await onR3(kernel(() => ({ ...EIGHT, points: [[0, 0, 0]] })), 'measures', hole() as DimensionMark)).toEqual({ value: 8, how: 'cylinder', measuredRevision: 3 })
    expect(await onR3(kernel(() => ({ ...EIGHT, points: undefined })), 'measures', hole() as DimensionMark)).toEqual({ value: 8, how: 'cylinder', measuredRevision: 3 })
  })
})

describe('a thickness', () => {
  // The point clicked is on the mesh drawn, which on a curved face is a hair off the surface itself:
  // the kernel measures a wall only from a point on the face, so the point is brought onto it first.
  const WALL = { kind: 'thickness', value: 2, unit: 'mm', how: 'wall, along the normal', points: [[4, 0, 0], [6, 0, 0]], exact: true }
  const curved: Anchor = { point: [3.998, 0.01, 0], normal: [-1, 0, 0], part: 'plate', ref: 'plate/F9' }
  const wall = (): DimensionMark => ({ ...BASE, kind: 'dimension', measure: 'thickness', a: curved }) as DimensionMark

  it('is asked at the point of the face nearest to where it was put', async () => {
    const k = kernel(() => WALL, () => ({ anchors: [{ part: 'plate', found: true, point: [4, 0.01, 0], normal: [-1, 0, 0], ref: 'plate/F9', distance: 0.002, descriptor: 'cylinder' }] }))
    expect(await onR3(k, 'measures', wall())).toMatchObject({ value: 2, how: 'wall, along the normal' })
    expect(k.asked).toEqual([
      { objectId: 'measures', name: 'nearest', args: { layout: 'assembly', anchors: [{ part: 'plate', point: [3.998, 0.01, 0] }] } },
      { objectId: 'measures', name: 'measure', args: { kind: 'thickness', a: { ref: 'assembly:plate/F9', point: [4, 0.01, 0] } } }
    ])
  })

  it('is asked where it was put when the nearest point is on another face, or the kernel does not say', async () => {
    const elsewhere = kernel(() => WALL, () => ({ anchors: [{ part: 'plate', found: true, point: [4, 0, 3], normal: [0, 0, 1], ref: 'plate/F5', distance: 0.001, descriptor: 'plane' }] }))
    await onR3(elsewhere, 'measures', wall())
    expect(elsewhere.asked[1].args).toEqual({ kind: 'thickness', a: { ref: 'assembly:plate/F9', point: [3.998, 0.01, 0] } })
    const failing = kernel(() => WALL, () => {
      throw new KernelError('timeout', 'too long')
    })
    await onR3(failing, 'measures', wall())
    expect(failing.asked[1].args).toEqual({ kind: 'thickness', a: { ref: 'assembly:plate/F9', point: [3.998, 0.01, 0] } })
  })

  it('that the kernel refuses is not measurable, with its reason: a point off the face, a part that is no solid', async () => {
    const off = kernel(() => {
      throw new KernelError('bad_request', 'the point is 0.3 mm from assembly:plate/F9: give a point on the face')
    })
    expect(await onR3(off, 'measures', wall())).toEqual({ measuredRevision: 3, refused: 'the point is 0.3 mm from plate/F9: give a point on the face' })
    const shell = kernel(() => {
      throw new KernelError('bad_request', 'assembly:plate is not a solid: it has no volume to measure a wall of')
    })
    expect(await onR3(shell, 'measures', wall())).toMatchObject({ refused: 'plate is not a solid: it has no volume to measure a wall of' })
  })

  it('no other measurement asks where its ends are first', async () => {
    const k = kernel(() => EIGHT)
    await onR3(k, 'measures', hole() as DimensionMark)
    expect(k.asked.map((a) => a.name)).toEqual(['measure'])
  })
})

describe('adding a dimension', () => {
  it('is kept with its value at once when the kernel is quick: one change', async () => {
    const k = kernel(() => SIX)
    const store = marks()
    const added = await addDimension({ ...k, marks: store }, 'measures', distance())
    expect(added).toMatchObject({ id: 'M1', kind: 'dimension', value: 6.000000000000001, how: 'between planes', measuredRevision: 3 })
    expect(store.did).toEqual(['add M1 = 6.000000000000001'])
  })

  it('appears without one when the kernel takes longer, and is given it when it comes', async () => {
    vi.useFakeTimers()
    let answer!: (reply: unknown) => void
    const k = kernel(() => new Promise((resolve) => (answer = resolve)))
    const store = marks()
    const adding = addDimension({ ...k, marks: store }, 'measures', hole({ expected: 8.5 }))
    await vi.advanceTimersByTimeAsync(299)
    expect(store.did).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(store.did).toEqual(['add M1'])
    expect(store.kept[0]).not.toHaveProperty('value')
    answer(EIGHT)
    expect(await adding).toMatchObject({ id: 'M1', value: 8, verdict: 'fail' })
    expect(store.did).toEqual(['add M1', 'measured M1 = 8'])
    vi.useRealTimers()
  })

  it('is not kept when the kernel refuses it: the reason is what is said', async () => {
    const refusal = () => {
      throw new KernelError('bad_request', 'radius is measured of a cylindrical, spherical or toroidal face or a circular edge; assembly:plate/F5 is a plane face')
    }
    const store = marks()
    await expect(addDimension({ ...kernel(refusal), marks: store }, 'measures', hole({ a: TOP, measure: 'radius' }))).rejects.toThrow(
      'radius is measured of a cylindrical, spherical or toroidal face or a circular edge; plate/F5 is a plane face'
    )
    expect(store.did).toEqual([])
  })

  it('is taken away again when the kernel refuses it only after it appeared', async () => {
    vi.useFakeTimers()
    let refuse!: (e: unknown) => void
    const k = kernel(() => new Promise((_resolve, reject) => (refuse = reject)))
    const store = marks()
    const adding = addDimension({ ...k, marks: store }, 'measures', hole({ measure: 'radius', a: TOP }))
    const failed = adding.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(300)
    expect(store.did).toEqual(['add M1'])
    refuse(new KernelError('bad_request', 'radius is measured of a cylindrical, spherical or toroidal face or a circular edge; assembly:plate/F5 is a plane face'))
    expect(((await failed) as Error).message).toBe('radius is measured of a cylindrical, spherical or toroidal face or a circular edge; plate/F5 is a plane face')
    expect(store.did).toEqual(['add M1', 'remove M1'])
    vi.useRealTimers()
  })

  it('is kept, without a value, when the kernel could not be asked: a query that timed out takes no mark of the person’s away', async () => {
    vi.useFakeTimers()
    const logged: string[] = []
    let fail!: (e: unknown) => void
    const k = kernel(() => new Promise((_resolve, reject) => (fail = reject)))
    const store = marks()
    const adding = addDimension({ ...k, marks: store, log: (m) => logged.push(m) }, 'measures', hole({ expected: 8 }))
    await vi.advanceTimersByTimeAsync(300)
    fail(new KernelError('timeout', 'the query took longer than 30 s'))
    const added = (await adding) as DimensionMark
    expect(added).toMatchObject({ id: 'M1', expected: 8 })
    for (const key of ['value', 'measuredRevision', 'verdict']) expect(added).not.toHaveProperty(key)
    expect(store.did).toEqual(['add M1'])
    expect(logged).toEqual(['cannot measure a new dimension of measures yet: the query took longer than 30 s'])
    vi.useRealTimers()
    // So too when it fails at once: it is added as it is.
    const quick = marks()
    const atOnce = await addDimension({ ...kernel(() => { throw new KernelError('crash', 'the worker died') }), marks: quick, log: () => {} }, 'measures', hole())
    expect(atOnce).not.toHaveProperty('value')
    expect(quick.did).toEqual(['add M1'])
  })

  it('is kept without a value when a build lands while it is being measured: what the kernel said is of neither build for sure', async () => {
    vi.useFakeTimers()
    let answer!: (reply: unknown) => void
    const k = kernel(() => new Promise((resolve) => (answer = resolve)))
    const store = marks()
    const logged: string[] = []
    const adding = addDimension({ ...k, marks: store, log: (m) => logged.push(m) }, 'measures', hole({ expected: 8 }))
    await vi.advanceTimersByTimeAsync(300)
    // r4 lands, with its faces numbered otherwise; the kernel answers about plate/F9 as it is there.
    k.world.revision = 4
    answer({ ...EIGHT, value: 30 })
    const added = (await adding) as DimensionMark
    for (const key of ['value', 'measuredRevision', 'verdict']) expect(added).not.toHaveProperty(key)
    expect(store.did).toEqual(['add M1'])
    expect(k.asked).toHaveLength(1)
    expect(logged).toEqual(['cannot measure a new dimension of measures yet: measures was built again (r4) since its ends were found on r3'])
    vi.useRealTimers()
  })

  it('says why one that was kept has no value, for whoever is told of it: the model was rebuilt, or the kernel did not answer; and nothing of one that has', async () => {
    const slow = await addDimensionTold({ ...kernel(() => { throw new KernelError('timeout', 'the query took longer than 30 s') }), marks: marks(), log: () => {} }, 'measures', hole())
    expect(slow).toMatchObject({ unmeasured: 'unanswered', reason: 'the query took longer than 30 s' })
    expect(slow.mark).not.toHaveProperty('value')
    // A build lands while the kernel is asked.
    const k = kernel(() => ((k.world.revision = 4), EIGHT))
    const landed = await addDimensionTold({ ...k, marks: marks(), log: () => {} }, 'measures', hole())
    expect(landed.unmeasured).toBe('rebuilt')
    expect(landed.mark).not.toHaveProperty('value')
    const measured = await addDimensionTold({ ...kernel(() => EIGHT), marks: marks() }, 'measures', hole())
    expect(measured).toEqual({ mark: expect.objectContaining({ value: 8, measuredRevision: 3 }) })
    // What is no dimension is the store's, and has nothing to be told of.
    const pin = await addDimensionTold({ ...kernel(() => EIGHT), marks: marks() }, 'measures', { ...hole(), kind: 'pin', anchor: (hole() as DimensionMark).a } as never)
    expect(pin).not.toHaveProperty('unmeasured')
  })

  describe('between two parts torno spread apart for display', () => {
    const part = (name: string, arranged?: [number, number, number]) => ({ key: `print:${name}`, name, layout: 'print', ...(arranged ? { arranged } : {}) })
    const spreadScene = { model: 'm.py', layouts: ['print'], parts: [part('tray'), part('lid', [25, 0, 0])], seconds: 0, output: '' } as unknown as Scene
    const across = (more: object = {}): NewMark =>
      distance({ layout: 'print', a: { point: [0, 0, 4], part: 'tray', ref: 'tray/F5' }, b: { point: [30, 0, 2], part: 'lid', ref: 'lid/F5' }, ...more })
    const FULL =
      "In layout print torno spread these parts apart for display (they overlapped as the model placed them), so the distance between tray and lid there is torno's, not the model's. This object has no layout that places its parts as assembled: check each part by itself."

    it('a distance is not kept, for the person or the agent, and the kernel is not asked', async () => {
      const k = { ...kernel(() => SIX), scene: () => ({ revision: 3, scene: spreadScene }) }
      const store = marks()
      await expect(addDimension({ ...k, marks: store }, 'spread', across())).rejects.toThrow(FULL)
      await expect(addDimensionTold({ ...k, marks: store }, 'spread', across(), 'sent')).rejects.toThrow(FULL)
      expect(k.asked).toEqual([])
      expect(store.did).toEqual([])
      // Within one part, and an angle between two, are what they are wherever the parts are put.
      expect(await addDimension({ ...k, marks: store }, 'spread', across({ b: { point: [30, 0, 0], part: 'lid', ref: 'lid/F0' }, a: { point: [30, 0, 2], part: 'lid', ref: 'lid/F5' } }))).toMatchObject({ value: 6.000000000000001 })
      expect(await addDimension({ ...k, marks: store }, 'spread', across({ measure: 'angle' }))).toMatchObject({ id: 'M2' })
    })

    it('one that is there already is not measurable on such a build, and says why in short', async () => {
      const k = { ...kernel(() => SIX), scene: () => ({ revision: 3, scene: spreadScene }) }
      expect(await onR3(k, 'spread', across() as DimensionMark)).toEqual({
        measuredRevision: 3,
        refused: 'torno spread tray and lid apart for display in layout print, so the distance between them there is not the model’s: no layout places them as assembled'
      })
      expect(k.asked).toEqual([])
      // With a layout that places both as the model does, the reason says where to measure it.
      const both = { ...spreadScene, layouts: ['assembly', 'print'], parts: [...spreadScene.parts, { key: 'assembly:tray', name: 'tray', layout: 'assembly' }, { key: 'assembly:lid', name: 'lid', layout: 'assembly' }] } as unknown as Scene
      expect((await onR3({ ...k, scene: () => ({ revision: 3, scene: both }) }, 'spread', across() as DimensionMark)).refused).toBe(
        'torno spread tray and lid apart for display in layout print, so the distance between them there is not the model’s: measure it in layout assembly'
      )
    })

    it('nor is a distance from a bare point to a part torno moved: kept by no one, and not measurable when it is there already', async () => {
      const k = { ...kernel(() => SIX), scene: () => ({ revision: 3, scene: spreadScene }) }
      const store = marks()
      const POINT = "In layout print torno moved lid for display (the parts overlapped as the model placed them), so the distance between a point and lid there is torno's, not the model's. Measure between faces and edges of lid."
      for (const ends of [{ a: { point: [30, 0, 9] } }, { a: { point: [30, 0, 2], part: 'lid', ref: 'lid/F5' }, b: { point: [30, 0, 9] } }]) {
        await expect(addDimension({ ...k, marks: store }, 'spread', across(ends))).rejects.toThrow(POINT)
        expect(await onR3(k, 'spread', across(ends) as DimensionMark)).toEqual({ measuredRevision: 3, refused: 'torno moved lid for display in layout print, so the distance from a point to it there is not the model’s: measure between its faces' })
      }
      expect(k.asked).toEqual([])
      expect(store.did).toEqual([])
      // The window knows each of these reasons again by its words, to say them in a line of its own.
      const refusals = [FULL, POINT, (await onR3(k, 'spread', across() as DimensionMark)).refused, (await onR3(k, 'spread', across({ a: { point: [30, 0, 9] } }) as DimensionMark)).refused]
      expect(refusals.map(isSpreadRefusal)).toEqual([true, true, true, true])
      expect(isSpreadRefusal('angle is measured between two planar faces')).toBe(false)
      // From a point to the part that stayed where the model placed it, it is kept and measured.
      expect(await addDimension({ ...k, marks: store }, 'spread', across({ b: { point: [0, 0, 9] } }))).toMatchObject({ id: 'M1', value: 6.000000000000001 })
    })
  })

  it('refuses as a Refusal (told to the window, never logged) what the kernel will not measure, a build since, and parts spread apart; a kernel that is gone is no Refusal', async () => {
    const refusing = kernel(() => {
      throw new KernelError('bad_request', 'angle is measured between two planar faces; assembly:plate/F9 is a cylinder face')
    })
    await expect(addDimensionTold({ ...refusing, marks: marks() }, 'measures', distance({ measure: 'angle', b: HOLE }))).rejects.toBeInstanceOf(Refusal)
    await expect(addDimensionTold({ ...kernel(() => EIGHT), marks: marks() }, 'measures', hole({ revision: 2 }))).rejects.toBeInstanceOf(Refusal)
    const spreadScene = { model: 'm.py', layouts: ['print'], parts: [{ key: 'print:tray', name: 'tray', layout: 'print' }, { key: 'print:lid', name: 'lid', layout: 'print', arranged: [25, 0, 0] }], seconds: 0, output: '' } as unknown as Scene
    const spread = { ...kernel(() => SIX), scene: () => ({ revision: 3, scene: spreadScene }) }
    const across = distance({ layout: 'print', a: { point: [0, 0, 4], part: 'tray', ref: 'tray/F5' }, b: { point: [30, 0, 2], part: 'lid', ref: 'lid/F5' } })
    await expect(addDimensionTold({ ...spread, marks: marks() }, 'spread', across)).rejects.toBeInstanceOf(Refusal)
    const gone = await onR3(kernel(() => { throw new KernelError('exited', 'the kernel exited') }), 'measures', hole() as DimensionMark).catch((e: unknown) => e)
    expect(gone).toBeInstanceOf(Error)
    expect(gone).not.toBeInstanceOf(Refusal)
  })

  it('is refused when it was placed on another build than the last: its refs are of that build, and the kernel is not asked', async () => {
    const k = kernel(() => EIGHT)
    const store = marks()
    await expect(addDimension({ ...k, marks: store }, 'measures', hole({ revision: 2 }))).rejects.toThrow('it was placed on r2, and the part has been built again since (r3): measure it again')
    k.world.revision = undefined
    await expect(addDimension({ ...k, marks: store }, 'measures', hole())).rejects.toThrow('there is no build of measures to measure on')
    expect(k.asked).toEqual([])
    expect(store.did).toEqual([])
  })

  it('answers with the mark as it is when its value was not written: the check of the marks got there first', async () => {
    vi.useFakeTimers()
    let answer!: (reply: unknown) => void
    const k = kernel(() => new Promise((resolve) => (answer = resolve)))
    const store = marks()
    // The store passes the write over, as it does when the check has refreshed the ends meanwhile, and has measured it itself.
    store.measured = async (_objectId, id) => {
      store.did.push(`measured ${id}: passed over`)
      store.kept[0] = sanitiseMark({ ...store.kept[0], value: 8.1, how: 'cylinder', measuredRevision: 3 })!
      return null
    }
    const adding = addDimension({ ...k, marks: store }, 'measures', hole())
    await vi.advanceTimersByTimeAsync(300)
    answer(EIGHT)
    expect(await adding).toMatchObject({ id: 'M1', value: 8.1 })
    vi.useRealTimers()
  })

  it('leaves what is no dimension to the store to refuse, and asks the kernel nothing of it', async () => {
    const k = kernel(() => SIX)
    const store = marks()
    await expect(addDimension({ ...k, marks: store }, 'measures', distance({ b: undefined }))).rejects.toThrow('that is not a mark')
    await expect(addDimension({ ...k, marks: store }, 'measures', distance({ measure: 'clearance' }))).rejects.toThrow('that is not a mark')
    expect(k.asked).toEqual([])
  })

  it('never takes a value from whoever adds it', async () => {
    const store = marks()
    const added = await addDimension({ ...kernel(() => EIGHT), marks: store }, 'measures', hole({ value: 8.5, expected: 8.5, verdict: 'pass' }))
    expect(added).toMatchObject({ value: 8, verdict: 'fail' })
  })
})

describe('measuring a dimension again', () => {
  it('writes what the kernel says on the build its ends were checked against, and nothing when it could not be asked', async () => {
    const store = marks()
    const k = kernel(() => EIGHT)
    const added = (await addDimension({ ...k, marks: store }, 'measures', hole())) as DimensionMark
    const mark = { ...added, checkedRevision: 3 }
    const logged: string[] = []
    await remeasure({ ...kernel(() => ({ ...EIGHT, value: 9 })), marks: store, log: (m) => logged.push(m) }, 'measures', mark)
    expect(store.did.at(-1)).toBe('measured M1 = 9')
    await remeasure({ ...kernel(() => { throw new KernelError('bad_ref', 'assembly:plate has no face 9') }), marks: store, log: (m) => logged.push(m) }, 'measures', mark)
    expect(store.did.at(-1)).toBe('measured M1: nothing')
    const before = store.did.length
    await remeasure({ ...kernel(() => { throw new KernelError('timeout', 'too long') }), marks: store, log: (m) => logged.push(m) }, 'measures', mark)
    expect(store.did).toHaveLength(before)
    expect(logged).toEqual(['cannot measure M1 of measures: too long'])
  })

  it('writes nothing when a build lands while the kernel is asked, or has landed since its ends were checked: that build’s check measures it', async () => {
    const store = marks()
    const added = (await addDimension({ ...kernel(() => EIGHT), marks: store }, 'measures', hole())) as DimensionMark
    const before = store.did.length
    const logged: string[] = []
    const k = kernel(() => {
      k.world.revision = 4
      return { ...EIGHT, value: 30 }
    })
    await remeasure({ ...k, marks: store, log: (m) => logged.push(m) }, 'measures', { ...added, checkedRevision: 3 })
    await remeasure({ ...k, marks: store, log: (m) => logged.push(m) }, 'measures', { ...added, checkedRevision: 3 })
    await remeasure({ ...kernel(() => EIGHT), marks: store, log: (m) => logged.push(m) }, 'measures', added)
    expect(store.did).toHaveLength(before)
    expect(k.asked).toHaveLength(1)
    expect(logged).toEqual([
      'cannot measure M1 of measures: measures was built again (r4) since its ends were found on r3',
      'cannot measure M1 of measures: measures was built again (r4) since its ends were found on r3',
      'cannot measure M1 of measures: its ends have not been checked against r3'
    ])
  })
})

describe('after a change of what a dimension should be', () => {
  const kept = (more: object = {}): Mark => ({ ...hole(), id: 'M1', status: 'sent', anchorState: 'ok', createdAt: '', value: 8, measuredRevision: 3, checkedRevision: 4, ...more }) as Mark

  it('is measured at once when its value is of an older build and the last build’s check has judged its ends', () => {
    expect(dueAfterEdit({ expected: 8 }, kept(), 4)).toBe(true)
    expect(dueAfterEdit({ tolerance: null }, kept({ measuredRevision: undefined }), 4)).toBe(true)
  })

  it('is left to the check of the marks while that has not judged its ends on the last build: its refs are of an older one', () => {
    // The build renumbered the faces, and the check is still running or being tried again.
    expect(dueAfterEdit({ expected: 8 }, kept({ checkedRevision: 3 }), 4)).toBe(false)
    expect(dueAfterEdit({ expected: 8 }, kept({ checkedRevision: undefined }), 4)).toBe(false)
    expect(dueAfterEdit({ expected: 8 }, kept({ anchorState: 'orphaned' }), 4)).toBe(false)
  })

  it('is not measured again when it has a value of the last build, is resolved, is no dimension, or something else was changed', () => {
    expect(dueAfterEdit({ expected: 8 }, kept({ measuredRevision: 4 }), 4)).toBe(false)
    expect(dueAfterEdit({ expected: 8 }, kept({ status: 'resolved' }), 4)).toBe(false)
    expect(dueAfterEdit({ expected: 8 }, { ...kept(), kind: 'pin' } as Mark, 4)).toBe(false)
    expect(dueAfterEdit({ note: 'the hole' }, kept(), 4)).toBe(false)
    expect(dueAfterEdit(null, kept(), 4)).toBe(false)
    expect(dueAfterEdit({ expected: 8 }, kept(), undefined)).toBe(false)
  })
})

describe('a measurement as it goes to the kernel', () => {
  it('has the layout in front of the refs, and names the layout for a bare point', () => {
    expect(wire({ kind: 'distance', layout: 'assembly', a: { ref: 'plate/F5', point: [5, 3, 3] }, b: { point: [0, 0, 9] } })).toEqual({ kind: 'distance', a: { ref: 'assembly:plate/F5', point: [5, 3, 3] }, b: { layout: 'assembly', point: [0, 0, 9] } })
    expect(wire({ kind: 'mass', layout: 'assembly', a: { ref: 'plate' }, density: 1.05 })).toEqual({ kind: 'mass', a: { ref: 'assembly:plate' }, density: 1.05 })
  })
})

describe('a measurement not kept (measureOnce)', () => {
  type Probe = Parameters<typeof measureOnce>[2]
  const probe = (more: object = {}): Probe => ({ measure: 'distance', layout: 'assembly', revision: 3, a: TOP, b: BOTTOM, ...more }) as Probe

  it('answers the kernel’s value on the last build, and writes no mark', async () => {
    const k = kernel(() => ({ ...SIX, value: 6 }))
    const store = marks()
    expect(await measureOnce({ ...k, marks: store } as Parameters<typeof measureOnce>[0], 'measures', probe())).toEqual({ value: 6, how: 'between planes', revision: 3 })
    expect(store.did).toEqual([])
    expect(k.asked.map((a) => a.name)).toEqual(['measure'])
  })

  it('is refused when it was taken on another build than the last, and the kernel is not asked', async () => {
    const k = kernel(() => SIX)
    await expect(measureOnce(k, 'measures', probe({ revision: 2 }))).rejects.toThrow('it was placed on r2, and the part has been built again since (r3): measure it again')
    await expect(measureOnce(k, 'measures', probe({ revision: 2 }))).rejects.toBeInstanceOf(Refusal)
    expect(k.asked).toEqual([])
  })

  it('is refused between two parts torno spread apart, and the kernel is not asked', async () => {
    const part = (name: string, arranged?: [number, number, number]) => ({ key: `print:${name}`, name, layout: 'print', ...(arranged ? { arranged } : {}) })
    const spreadScene = { model: 'm.py', layouts: ['print'], parts: [part('tray'), part('lid', [25, 0, 0])], seconds: 0, output: '' } as unknown as Scene
    const k = { ...kernel(() => SIX), scene: () => ({ revision: 3, scene: spreadScene }) }
    const across = probe({ layout: 'print', a: { point: [0, 0, 4], part: 'tray', ref: 'tray/F5' }, b: { point: [30, 0, 2], part: 'lid', ref: 'lid/F5' } })
    const refused = await measureOnce(k, 'spread', across).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(Refusal)
    expect(isSpreadRefusal((refused as Error).message)).toBe(true)
    expect(k.asked).toEqual([])
  })

  it('is refused with the kernel’s reason, without the layout in front of the refs', async () => {
    const k = kernel(() => {
      throw new KernelError('bad_request', 'angle is measured between two planar faces; assembly:plate/F9 is a cylinder face')
    })
    const refused = await measureOnce(k, 'measures', probe({ measure: 'angle', b: HOLE })).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(Refusal)
    expect((refused as Error).message).toBe('angle is measured between two planar faces; plate/F9 is a cylinder face')
  })

  it('rejects with a plain message when the kernel cannot be asked, and keeps nothing for later', async () => {
    const k = kernel(() => {
      throw new KernelError('timeout', 'the kernel did not answer within 10 s')
    })
    const store = marks()
    await expect(measureOnce({ ...k, marks: store } as Parameters<typeof measureOnce>[0], 'measures', probe())).rejects.toThrow('the kernel did not answer within 10 s')
    expect(store.did).toEqual([])
    const none = kernel(() => SIX)
    none.world.revision = undefined
    await expect(measureOnce(none, 'measures', probe())).rejects.toThrow('there is no build of measures to measure on')
  })

  it('refuses what is no measurement, and asks the kernel nothing: an unknown kind, an end that is no point, a distance with one end', async () => {
    const k = kernel(() => SIX)
    await expect(measureOnce(k, 'measures', probe({ measure: 'volume' }))).rejects.toThrow()
    await expect(measureOnce(k, 'measures', probe({ a: { point: [0, Number.NaN, 0] } }))).rejects.toThrow()
    await expect(measureOnce(k, 'measures', probe({ b: undefined }))).rejects.toThrow()
    await expect(measureOnce(k, 'measures', null as unknown as Probe)).rejects.toThrow()
    expect(k.asked).toEqual([])
  })
})
