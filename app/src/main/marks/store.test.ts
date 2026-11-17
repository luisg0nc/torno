import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Anchor, DimensionMark, Mark, MarksFile, NewMark, NewNote, NoteMark, OffsetMark, PinMark, Replacement, ShapeMark, SketchMark, SketchStroke, SpanMark } from '../../shared/marks'
import type { SketchDraft } from '../../shared/bridge'
import { isHeld, openRound, roundCounts, roundItems } from '../../shared/reviews'
import * as file from './file'
import { droppedNames } from '../dropped'
import { isNoteFile } from '../notes/files'
import { MarkStore, SketchChanged } from './store'

// The real file module, with its writes counted.
vi.mock('./file', async (importActual) => {
  const actual = await importActual<typeof import('./file')>()
  return { ...actual, saveMarksFile: vi.fn(actual.saveMarksFile) }
})
const saves = vi.mocked(file.saveMarksFile)

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', note: '', layout: 'assembly', revision: 1, camera: CAMERA } as const
const ANCHOR: Anchor = { point: [1, 2, 20], part: 'base', ref: 'base/F4' }

const pin = (note = 'here', anchor: Anchor = ANCHOR): NewMark => ({ ...BASE, kind: 'pin', note, anchor }) as NewMark
const arrow = (): NewMark => ({ ...BASE, kind: 'arrow', from: ANCHOR, to: [1, 2, 30] }) as NewMark
const shape = (anchor?: Anchor): NewMark =>
  ({ ...BASE, kind: 'shape', shape: 'box', intent: 'add', position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [10, 10, 10], ...(anchor ? { anchor } : {}) }) as NewMark

let root: string
let dirs: Record<string, string>
let store: MarkStore
let changes: Array<{ objectId: string; marks: Mark[] }>
let problems: Array<{ objectId: string; message: string }>

const onDisk = (objectId: string): MarksFile => JSON.parse(readFileSync(join(dirs[objectId], '.torno', 'marks.json'), 'utf8'))
const ids = (marks: Mark[]): string[] => marks.map((m) => m.id)

function newStore(): MarkStore {
  const s = new MarkStore({ dirOf: (id) => dirs[id], now: () => new Date('2026-10-09T12:00:00.000Z') })
  s.on('changed', (m) => changes.push(m))
  s.on('problem', (m) => problems.push(m))
  return s
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-marks-store-'))
  dirs = { bracket: join(root, 'bracket'), two: join(root, 'two') }
  for (const dir of Object.values(dirs)) mkdirSync(dir)
  changes = []
  problems = []
  saves.mockClear()
  store = newStore()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('marks on a tracing', () => {
  const onT1 = (point: [number, number, number], over: Record<string, unknown> = {}): NewMark => ({ ...BASE, kind: 'pin', anchor: { point }, tracing: 'T1', uv: [[point[0], point[1]]], ...over }) as NewMark

  it('is not put on a part of the 3D view: it lies in its plane', async () => {
    await store.add('bracket', onT1([3, 4, 10]))
    const replacement = { anchor: { point: [0, 0, 0], part: 'base', ref: 'base/F4' }, revision: 1, camera: CAMERA } as Replacement
    await expect(store.replace('bracket', 'M1', replacement)).rejects.toThrow('M1 is on T1: it lies in that plane and is not put on a part of the 3D view')
  })

  it('is not moved by the spread of its layout, and a check does not take its point from where it is', async () => {
    const spread = { ...ANCHOR, point: [3, 4, 10], arranged: [0, 0, 0] } as Anchor
    const mark = await store.add('bracket', onT1([3, 4, 10], { anchor: spread }))
    await store.reanchor('bracket', [{ id: mark.id, judged: [spread], anchors: [{ ...spread, point: [9, 9, 9], ref: 'base/F9', arranged: [5, 0, 0] }], anchorState: 'ok', shift: [5, 0, 0], checkedRevision: 2 } as never])
    const [after] = (await store.list('bracket')) as PinMark[]
    expect(after.anchor).toMatchObject({ point: [3, 4, 10], ref: 'base/F9' })
    expect(after.uv).toEqual([[3, 4]])
  })

  it('followTracing refuses what is not a vector, and moves the marks of that tracing alone', async () => {
    await store.add('bracket', onT1([3, 4, 10]))
    await store.add('bracket', onT1([5, 5, 20], { tracing: 'T2' }))
    await expect(store.followTracing('bracket', 'T1', [0, 0, Number.NaN])).rejects.toThrow('three finite numbers')
    await store.followTracing('bracket', 'T1', [0, 0, 0.5])
    const [one, two] = (await store.list('bracket')) as PinMark[]
    expect(one.anchor.point).toEqual([3, 4, 10.5])
    expect(two.anchor.point).toEqual([5, 5, 20])
  })

  it('tells the marks it moved as unchecked, after their change', async () => {
    await store.add('bracket', onT1([3, 4, 10]))
    const told: string[][] = []
    store.on('unchecked', (m) => told.push(m.ids))
    await store.followTracing('bracket', 'T1', [0, 0, 0.5])
    expect(told).toEqual([['M1']])
  })

  describe('healTracings', () => {
    /** T1: the plane z = 10, u along X, v along Y (normal +Z). */
    const T1 = { id: 'T1', plane: { origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0] } } as never
    const T2 = { id: 'T2', plane: { origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0] } } as never

    it('moves the marks of a tracing that are off its plane back onto it, in one write, and tells them unchecked', async () => {
      await store.add('bracket', onT1([3, 4, 10.5]))
      await store.add('bracket', onT1([5, 5, 9.2]))
      await store.add('bracket', onT1([6, 6, 10]))
      const told: string[][] = []
      store.on('unchecked', (m) => told.push(m.ids))
      saves.mockClear()
      expect(await store.healTracings('bracket', [T1])).toEqual(['M1', 'M2'])
      const marks = (await store.list('bracket')) as PinMark[]
      expect(marks.map((m) => m.anchor.point[2])).toEqual([10, 10, 10])
      expect(marks[0].uv).toEqual([[3, 4]])
      expect(saves).toHaveBeenCalledTimes(1)
      expect(told).toEqual([['M1', 'M2']])
    })

    it('writes and tells nothing when every mark is in its plane (within 1e-6 mm), or is of no tracing it is given', async () => {
      await store.add('bracket', onT1([3, 4, 10 + 5e-7]))
      await store.add('bracket', onT1([5, 5, 30], { tracing: 'T3' }))
      await store.add('bracket', pin())
      saves.mockClear()
      expect(await store.healTracings('bracket', [T1, T2])).toEqual([])
      expect(saves).not.toHaveBeenCalled()
    })

    it('moves a span and an offset by the one distance their points lie from the plane', async () => {
      await store.addSpan('bracket', { ...BASE, kind: 'span', tracing: 'T1', uv: [[0, 0], [30, 40]], a: { uv: [0, 0], point: [0, 0, 10.3], on: 'tracing' }, b: { uv: [30, 40], point: [30, 40, 10.3], on: 'tracing' }, value: 50, exact: false, how: 'freehand' } as unknown as NewMark)
      await store.saveOffset('bracket', { ...BASE, kind: 'offset', tracing: 'T1', uv: [[1, 1], [2, 2]], layer: { id: 1, name: 'l', revision: 1 }, shape: { index: 0, name: '' }, was: { kind: 'circle', centre: [1, 1], radius: 1 }, by: [1, 1], from: [1, 1, 10.3], to: [2, 2, 10.3] } as unknown as NewMark)
      expect(await store.healTracings('bracket', [T1])).toEqual(['M1', 'M2'])
      const [span, offset] = (await store.list('bracket')) as [SpanMark, OffsetMark]
      expect([span.a.point[2], span.b.point[2], offset.from[2], offset.to[2]].map((z) => Math.round(z * 1e9) / 1e9)).toEqual([10, 10, 10, 10])
    })

    it('leaves a mark whose points lie at different distances: it is not bent', async () => {
      await store.addSpan('bracket', { ...BASE, kind: 'span', tracing: 'T1', uv: [[0, 0], [3, 4]], a: { uv: [0, 0], point: [0, 0, 10.3], on: 'tracing' }, b: { uv: [3, 4], point: [3, 4, 11], on: 'tracing' }, value: 5, exact: false, how: 'freehand' } as unknown as NewMark)
      saves.mockClear()
      expect(await store.healTracings('bracket', [T1])).toEqual([])
      expect(saves).not.toHaveBeenCalled()
    })

    it('puts a mark back that a tracing removed and put back left off the new plane', async () => {
      await store.add('bracket', onT1([3, 4, 20]))
      expect(await store.healTracings('bracket', [T1])).toEqual(['M1'])
      expect(((await store.list('bracket')) as PinMark[])[0].anchor.point).toEqual([3, 4, 10])
    })
  })

  it('drops the run\'s number of a span when the file is read, and keeps its history id', async () => {
    await store.addSpan('bracket', { ...BASE, kind: 'span', tracing: 'T1', uv: [[0, 0], [3, 4]], a: { uv: [0, 0], point: [0, 0, 0], on: 'tracing' }, b: { uv: [3, 4], point: [3, 4, 0], on: 'tracing' }, value: 5, exact: true, how: 'exact on build h41', build: 'h41', measuredOn: 1 } as unknown as NewMark)
    expect(((await store.list('bracket')) as SpanMark[])[0].measuredOn).toBe(1)
    const [read] = (await newStore().list('bracket')) as SpanMark[]
    expect(read.measuredOn).toBeUndefined()
    expect(read.build).toBe('h41')
  })
})

describe('a span and an offset', () => {
  const span = (over: Record<string, unknown> = {}): SpanMark =>
    ({ ...BASE, kind: 'span', tracing: 'T1', uv: [[0, 0], [30, 40]], a: { uv: [0, 0], point: [0, 0, 0], on: 'tracing' }, b: { uv: [30, 40], point: [30, 0, 40], on: 'tracing' }, value: 50, exact: false, how: 'freehand', measuredOn: 1, ...over }) as unknown as SpanMark
  const offset = (by: [number, number] = [-1.8, 0.6], over: Record<string, unknown> = {}): OffsetMark =>
    ({ ...BASE, kind: 'offset', tracing: 'T1', uv: [[10, 5], [10 + by[0], 5 + by[1]]], layer: { id: 2, name: 'head bolts', revision: 1 }, shape: { index: 2, name: 'head bolt 3' }, was: { kind: 'circle', centre: [10, 5], radius: 3 }, by, from: [10, 0, 5], to: [10 + by[0], 0, 5 + by[1]], ...over }) as unknown as OffsetMark
  const ROUND = { build: 'h1', sources: 'abc', layout: 'assembly', line: 'a line' }

  it('are not added as any other mark is: main makes them from its own numbers', async () => {
    await expect(store.add('bracket', span() as unknown as NewMark)).rejects.toThrow('a measure on a tracing is made with the Measure tool')
    await expect(store.add('bracket', offset() as unknown as NewMark)).rejects.toThrow('is made with the Should be here tool')
  })

  it('keeps a span as main made it, never takes what only main says from the window, and never joins a round', async () => {
    await store.startRound('bracket', ROUND)
    const made = await store.addSpan('bracket', { ...span(), intent: 'want', round: 'R1', judged: 'ok' } as never)
    expect(made).toMatchObject({ id: 'M1', kind: 'span', value: 50, how: 'freehand', status: 'draft', anchorState: 'ok' })
    expect(made).not.toHaveProperty('intent')
    expect(made).not.toHaveProperty('round')
    expect(onDisk('bracket').marks[0]).toEqual(made)
  })

  it('keeps an offset, and dragging the same shape again changes the draft\'s `by`, not its number', async () => {
    const first = await store.saveOffset('bracket', offset([-1.8, 0.6]))
    const again = await store.saveOffset('bracket', offset([-2, 0.5]))
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ by: [-2, 0.5], to: [8, 0, 5.5], createdAt: first.createdAt })
    expect(await store.list('bracket')).toHaveLength(1)
    // Another shape of the layer, or another layer, is another mark.
    await store.saveOffset('bracket', offset([1, 1], { shape: { index: 3, name: '' } }))
    await store.saveOffset('bracket', offset([1, 1], { layer: { id: 3, name: 'other', revision: 1 } }))
    expect(await store.list('bracket')).toHaveLength(3)
  })

  it('does not change an offset the agent has been told of: a sent one is a new mark', async () => {
    const sent = await store.saveOffset('bracket', offset([-1.8, 0.6]))
    await store.markSent('bracket', [sent.id])
    const next = await store.saveOffset('bracket', offset([-2, 0.5]))
    expect(next.id).not.toBe(sent.id)
  })

  it('never joins an open round, and has no intent to say', async () => {
    await store.startRound('bracket', ROUND)
    const made = await store.saveOffset('bracket', offset())
    expect(made.round).toBeUndefined()
    await expect(store.setIntent('bracket', made.id, 'want')).rejects.toThrow('a "should be here" says nothing of want or don\'t want')
  })

  it('stays ok through reanchor, and is not unchecked', async () => {
    const made = await store.saveOffset('bracket', offset())
    await store.reanchor('bracket', [{ id: made.id, judged: [], anchors: [], anchorState: 'drifted', checkedRevision: 3 }])
    const [after] = await store.list('bracket')
    expect(after.anchorState).toBe('ok')
  })

  it('move with their tracing\'s plane', async () => {
    await store.addSpan('bracket', span())
    await store.saveOffset('bracket', offset())
    await store.followTracing('bracket', 'T1', [0, 2, 0])
    const [one, two] = (await store.list('bracket')) as [SpanMark, OffsetMark]
    expect(one.a.point).toEqual([0, 2, 0])
    expect(one.value).toBe(50)
    expect(two.from).toEqual([10, 2, 5])
  })
})

describe('adding marks', () => {
  it('numbers them M1, M2, and fills in what main decides', async () => {
    const first = await store.add('bracket', pin('first'))
    const second = await store.add('bracket', arrow())
    expect(first).toMatchObject({ id: 'M1', kind: 'pin', note: 'first', status: 'draft', anchorState: 'ok', createdAt: '2026-10-09T12:00:00.000Z' })
    expect(second).toMatchObject({ id: 'M2', kind: 'arrow', status: 'draft' })
    expect(await store.list('bracket')).toEqual([first, second])
    expect(onDisk('bracket')).toEqual({ next: 3, marks: [first, second] })
  })

  it('tells of each change with the whole list', async () => {
    const first = await store.add('bracket', pin())
    expect(changes).toEqual([{ objectId: 'bracket', marks: [first], rounds: [], sending: null }])
  })

  it('never reuses an id after a remove, in this run or the next', async () => {
    await store.add('bracket', pin())
    await store.add('bracket', pin())
    await store.remove('bracket', 'M2')
    expect((await store.add('bracket', pin())).id).toBe('M3')
    await store.remove('bracket', 'M3')
    await store.remove('bracket', 'M1')
    expect(onDisk('bracket')).toEqual({ next: 4, marks: [] })
    expect((await newStore().add('bracket', pin())).id).toBe('M4')
  })

  it('puts back the mark deleted last, whole and with its number, once', async () => {
    const first = await store.add('bracket', pin('keep'))
    const second = await store.add('bracket', pin('this one'))
    const third = await store.add('bracket', pin('and this'))
    await store.remove('bracket', 'M2')
    await expect(store.restore('bracket', 'M1')).rejects.toThrow('cannot be put back')
    expect(await store.restore('bracket', 'M2')).toEqual(second)
    // In its place, and written.
    expect(await store.list('bracket')).toEqual([first, second, third])
    expect(onDisk('bracket')).toEqual({ next: 4, marks: [first, second, third] })
    await expect(store.restore('bracket', 'M2')).rejects.toThrow('cannot be put back')
    // Only the last one deleted.
    await store.remove('bracket', 'M1')
    await store.remove('bracket', 'M3')
    await expect(store.restore('bracket', 'M1')).rejects.toThrow('cannot be put back')
    expect((await store.restore('bracket', 'M3')).note).toBe('and this')
    expect((await store.add('bracket', pin())).id).toBe('M4')
  })

  it('gives concurrent adds distinct ids, and keeps them all', async () => {
    const added = await Promise.all(Array.from({ length: 12 }, (_, i) => store.add('bracket', pin(`n${i}`))))
    expect(ids(added)).toEqual(Array.from({ length: 12 }, (_, i) => `M${i + 1}`))
    expect(added.map((m) => m.note)).toEqual(Array.from({ length: 12 }, (_, i) => `n${i}`))
    expect(ids(onDisk('bracket').marks)).toEqual(ids(added))
    expect(onDisk('bracket').next).toBe(13)
  })

  it('ignores what a caller says of the id and the status, and refuses what is not a mark', async () => {
    const forged = { ...pin(), id: 'M40', status: 'resolved', anchorState: 'orphaned', createdAt: 'then' } as unknown as NewMark
    expect(await store.add('bracket', forged)).toMatchObject({ id: 'M1', status: 'draft', anchorState: 'ok', createdAt: '2026-10-09T12:00:00.000Z' })
    await expect(store.add('bracket', { ...pin(), kind: 'dimension' } as unknown as NewMark)).rejects.toThrow('not a mark')
    await expect(store.add('bracket', pin('x', { point: [0, NaN, 0] }))).rejects.toThrow('not a mark')
    // A refused mark uses no id and writes nothing.
    expect((await store.add('bracket', pin())).id).toBe('M2')
    expect(saves).toHaveBeenCalledTimes(2)
  })

  it('keeps two objects apart', async () => {
    const a = await store.add('bracket', pin('on the bracket'))
    const b = await store.add('two', pin('on two'))
    expect([a.id, b.id]).toEqual(['M1', 'M1'])
    expect(await store.list('bracket')).toEqual([a])
    expect(await store.list('two')).toEqual([b])
    expect(onDisk('two').marks).toEqual([b])
    await store.remove('two', 'M1')
    expect(await store.list('bracket')).toEqual([a])
    expect(changes.map((c) => c.objectId)).toEqual(['bracket', 'two', 'two'])
  })

  it('rejects an object whose folder is not known, with a plain message', async () => {
    await expect(store.list('ghost')).rejects.toThrow('no project named ghost in the open workspace')
    await expect(store.add('ghost', pin())).rejects.toThrow('no project named ghost in the open workspace')
    expect(saves).not.toHaveBeenCalled()
  })

  it('hands out copies: changing what it returned changes nothing', async () => {
    const mark = (await store.add('bracket', pin())) as PinMark
    mark.note = 'scribbled over'
    mark.anchor.point[0] = 99
    const listed = (await store.list('bracket'))[0] as PinMark
    expect(listed.note).toBe('here')
    expect(listed.anchor.point).toEqual([1, 2, 20])
  })
})

describe('updating a mark', () => {
  it('names the marks there are when the id is unknown', async () => {
    await store.add('bracket', pin())
    await store.add('bracket', pin())
    await expect(store.update('bracket', 'M9', { note: 'x' })).rejects.toThrow('no mark M9; marks: M1, M2')
    await expect(store.remove('bracket', 'M9')).rejects.toThrow('no mark M9; marks: M1, M2')
    await expect(store.update('two', 'M1', { note: 'x' })).rejects.toThrow('no mark M1; marks: none')
  })

  it('changes the note and writes it', async () => {
    await store.add('bracket', pin())
    const updated = await store.update('bracket', 'M1', { note: 'thicker, 4 mm' })
    expect(updated).toMatchObject({ id: 'M1', note: 'thicker, 4 mm', status: 'draft' })
    expect(onDisk('bracket').marks).toEqual([updated])
    expect(changes.at(-1)).toEqual({ objectId: 'bracket', marks: [updated], rounds: [], sending: null })
  })

  it('moves status forward, to resolved from anywhere, and back to draft when asked', async () => {
    await store.add('bracket', pin())
    expect((await store.update('bracket', 'M1', { status: 'sent' })).status).toBe('sent')
    expect((await store.update('bracket', 'M1', { status: 'resolved', resolvedNote: 'done' })).status).toBe('resolved')
    await expect(store.update('bracket', 'M1', { status: 'sent' })).rejects.toThrow('M1 is resolved')
    expect((await store.list('bracket'))[0]).toMatchObject({ status: 'resolved', resolvedNote: 'done' })
    expect((await store.update('bracket', 'M1', { status: 'draft' })).status).toBe('draft')
    expect((await store.update('bracket', 'M1', { status: 'resolved' })).status).toBe('resolved')
    await store.add('bracket', pin())
    await store.update('bracket', 'M2', { status: 'sent' })
    expect((await store.update('bracket', 'M2', { status: 'draft' })).status).toBe('draft')
  })

  it('moves and resizes a shape, and refuses to do so to anything else', async () => {
    await store.add('bracket', shape())
    await store.add('bracket', pin())
    const moved = (await store.update('bracket', 'M1', { position: [5, 0, 0], size: [2, 3, 4], shape: 'cylinder', intent: 'remove', rotation: [0, 0, 1, 0] })) as ShapeMark
    // A cylinder has one diameter: the size is held to what the kind has.
    expect(moved).toMatchObject({ position: [5, 0, 0], size: [2, 2, 4], shape: 'cylinder', intent: 'remove', rotation: [0, 0, 1, 0] })
    await expect(store.update('bracket', 'M2', { position: [5, 0, 0] })).rejects.toThrow('M2 is a pin, not a shape')
  })

  it('refuses a patch that would leave something that is not a mark, and changes nothing', async () => {
    await store.add('bracket', shape())
    saves.mockClear()
    changes = []
    await expect(store.update('bracket', 'M1', { size: [1, NaN, 1] })).rejects.toThrow('not a valid change to M1')
    await expect(store.update('bracket', 'M1', { status: 'done' as never })).rejects.toThrow('not a valid change to M1')
    expect((await store.list('bracket'))[0]).toMatchObject({ size: [10, 10, 10], status: 'draft' })
    expect(saves).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('takes nothing from a patch but what a patch may hold', async () => {
    await store.add('bracket', pin())
    const patched = await store.update('bracket', 'M1', { note: 'n', id: 'M7', author: 'agent', anchorState: 'orphaned' } as never)
    expect(patched).toMatchObject({ id: 'M1', author: 'user', anchorState: 'ok', note: 'n' })
    expect(await store.update('bracket', 'M1', null as never)).toEqual(patched)
  })
})

describe('what is still being written', () => {
  it('is waited for by whoever must not leave before it is on the disk, and is nothing when nothing was asked', async () => {
    expect(store.settled()).toBeNull()
    await store.add('bracket', pin('here'))
    expect(store.settled()).toBeNull()
    // Asked and not waited for, as a note handed over by a window that is closing; then the workspace is left.
    void store.update('bracket', 'M1', { note: 'thicker here' })
    void store.update('two', 'M9', { note: 'no such mark' }).catch(() => {})
    store.forget()
    const settled = store.settled()
    expect(settled).not.toBeNull()
    expect(onDisk('bracket').marks[0].note).toBe('here')
    await settled
    expect(onDisk('bracket').marks[0].note).toBe('thicker here')
    expect(store.settled()).toBeNull()
  })
})

describe('changing a mark the agent has been sent', () => {
  const sentShape = async (): Promise<void> => {
    await store.add('bracket', shape())
    await store.markSent('bracket')
  }

  it('is sent again when its note changes, and says it was sent before', async () => {
    await store.add('bracket', pin('here'))
    expect(await store.markSent('bracket')).toMatchObject([{ id: 'M1', status: 'sent', sentBefore: true }])
    const changed = await store.update('bracket', 'M1', { note: 'here, 2 mm thicker' })
    expect(changed).toMatchObject({ status: 'draft', sentBefore: true, note: 'here, 2 mm thicker' })
    expect(onDisk('bracket').marks[0]).toMatchObject({ status: 'draft', sentBefore: true })
  })

  it.each([
    ['intent', { intent: 'remove' }],
    ['position', { position: [1, 0, 0] }],
    ['rotation', { rotation: [0, 0, 1, 0] }],
    ['size', { size: [10, 10, 12] }],
    ['shape', { shape: 'sphere' }]
  ] as const)('is sent again when its %s changes', async (_field, patch) => {
    await sentShape()
    expect(await store.update('bracket', 'M1', patch as never)).toMatchObject({ status: 'draft', sentBefore: true })
  })

  it('stays sent when the patch changes nothing of it', async () => {
    await sentShape()
    saves.mockClear()
    const same = await store.update('bracket', 'M1', { note: '', intent: 'add', position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [10, 10, 10], shape: 'box' })
    expect(same.status).toBe('sent')
  })

  it('takes the status the patch names, when it names one', async () => {
    await store.add('bracket', pin('here'))
    await store.markSent('bracket')
    expect((await store.update('bracket', 'M1', { note: 'done with', status: 'resolved' })).status).toBe('resolved')
    await store.add('bracket', pin('there'))
    await store.markSent('bracket')
    expect((await store.update('bracket', 'M2', { note: 'still told', status: 'sent' })).status).toBe('sent')
  })

  it("leaves a mark of the agent's as sent: it wrote the note itself", async () => {
    await store.add('bracket', { ...pin('this face?'), author: 'agent' }, 'sent')
    expect((await store.update('bracket', 'M1', { note: 'this face, then' })).status).toBe('sent')
  })

  it('a draft that was never sent does not say it was', async () => {
    await store.add('bracket', pin('here'))
    expect(await store.update('bracket', 'M1', { note: 'there' })).not.toHaveProperty('sentBefore')
  })

  it('says of a mark that was resolved and is a draft again that the person reopened it, until it is sent', async () => {
    await store.add('bracket', pin('here'))
    await store.markSent('bracket')
    await store.update('bracket', 'M1', { status: 'resolved', resolvedNote: 'made it thicker' }, 'agent')
    const reopened = await store.update('bracket', 'M1', { status: 'draft' })
    expect(reopened).toMatchObject({ status: 'draft', sentBefore: true, reopened: true })
    expect(onDisk('bracket').marks[0]).toMatchObject({ status: 'draft', reopened: true })
    // A change to its note meanwhile leaves that said.
    expect(await store.update('bracket', 'M1', { note: 'no: thicker still' })).toMatchObject({ status: 'draft', reopened: true })
    const [sent] = await store.markSent('bracket')
    expect(sent).not.toHaveProperty('reopened')
    expect(onDisk('bracket').marks[0]).not.toHaveProperty('reopened')
    // Changed afterwards, it has changed and no more.
    expect(await store.update('bracket', 'M1', { note: 'thicker by 3 mm' })).not.toHaveProperty('reopened')
  })

  it('says it of one the person had resolved themselves once it had been sent, and of none that is resolved again before it is sent', async () => {
    await store.add('bracket', pin('here'))
    await store.markSent('bracket')
    await store.update('bracket', 'M1', { status: 'resolved' })
    expect(await store.update('bracket', 'M1', { status: 'draft' })).toMatchObject({ status: 'draft', reopened: true })
    expect(await store.update('bracket', 'M1', { status: 'resolved' })).not.toHaveProperty('reopened')
    // Nor of a draft that was never resolved.
    await store.add('bracket', pin('there'))
    expect(await store.update('bracket', 'M2', { status: 'draft', note: 'there, then' })).not.toHaveProperty('reopened')
  })

  it('does not say it of a mark the agent never saw: one the person resolved before it was sent, and reopened', async () => {
    await store.add('bracket', pin('here'))
    await store.update('bracket', 'M1', { status: 'resolved' })
    const again = await store.update('bracket', 'M1', { status: 'draft' })
    expect(again).toMatchObject({ status: 'draft' })
    expect(again).not.toHaveProperty('reopened')
    // One the agent resolved was seen by it, sent before or not.
    await store.add('bracket', pin('there'))
    await store.update('bracket', 'M2', { status: 'resolved' }, 'agent')
    expect(await store.update('bracket', 'M2', { status: 'draft' })).toMatchObject({ status: 'draft', reopened: true })
  })

  it('takes neither from whoever adds or patches a mark: only sending says a mark was sent', async () => {
    const added = await store.add('bracket', { ...pin('here'), sentBefore: true, reopened: true, checkedRevision: 9, resolvedBy: 'agent', acknowledged: true } as never)
    expect(added).not.toHaveProperty('sentBefore')
    expect(added).not.toHaveProperty('reopened')
    expect(added).not.toHaveProperty('checkedRevision')
    expect(added).not.toHaveProperty('resolvedBy')
    expect(added).not.toHaveProperty('acknowledged')
    expect(await store.update('bracket', 'M1', { sentBefore: true, reopened: true, checkedRevision: 9, resolvedBy: 'agent' } as never)).toEqual(added)
  })
})

describe('resolving a mark', () => {
  it('says who resolved it: the person from the window, the agent through its tools', async () => {
    await store.add('bracket', pin('one'))
    await store.add('bracket', pin('two'))
    expect(await store.update('bracket', 'M1', { status: 'resolved' })).toMatchObject({ status: 'resolved', resolvedBy: 'user' })
    expect(await store.update('bracket', 'M2', { status: 'resolved', resolvedNote: 'filleted at 2 mm' }, 'agent')).toMatchObject({ status: 'resolved', resolvedBy: 'agent', resolvedNote: 'filleted at 2 mm' })
    expect(onDisk('bracket').marks.map((m) => m.resolvedBy)).toEqual(['user', 'agent'])
    // Not from what the patch says of it.
    await store.add('bracket', pin('three'))
    expect(await store.update('bracket', 'M3', { status: 'resolved', resolvedBy: 'agent' } as never)).toMatchObject({ resolvedBy: 'user' })
  })

  it('keeps who resolved it when something else of it is changed, and forgets it when the mark is reopened', async () => {
    await store.add('bracket', pin('one'))
    await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
    expect(await store.update('bracket', 'M1', { note: 'still one' })).toMatchObject({ status: 'resolved', resolvedBy: 'agent' })
    expect(await store.update('bracket', 'M1', { status: 'resolved' })).toMatchObject({ resolvedBy: 'agent' })
    const reopened = await store.update('bracket', 'M1', { status: 'draft' })
    expect(reopened).not.toHaveProperty('resolvedBy')
    expect(reopened).not.toHaveProperty('acknowledged')
  })

  it('is acknowledged by the person when the agent resolved it, and by nothing else', async () => {
    await store.add('bracket', pin('one'))
    await store.add('bracket', pin('two'))
    await store.add('bracket', pin('three'))
    await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
    await store.update('bracket', 'M2', { status: 'resolved' })
    expect(await store.update('bracket', 'M1', { acknowledged: true })).toMatchObject({ status: 'resolved', resolvedBy: 'agent', acknowledged: true })
    await expect(store.update('bracket', 'M2', { acknowledged: true })).rejects.toThrow('M2 was not resolved by the agent: there is nothing to acknowledge')
    await expect(store.update('bracket', 'M3', { acknowledged: true })).rejects.toThrow('M3 was not resolved by the agent')
    await expect(store.update('bracket', 'M1', { acknowledged: false })).rejects.toThrow('there is nothing to acknowledge')
    // Reopened and resolved again by the agent, it is to be seen again.
    await store.update('bracket', 'M1', { status: 'draft' })
    expect(await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')).not.toHaveProperty('acknowledged')
  })

  it('acknowledges many marks the agent resolved in one write', async () => {
    for (const note of ['one', 'two', 'three']) await store.add('bracket', pin(note))
    await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
    await store.update('bracket', 'M2', { status: 'resolved' }, 'agent')
    const told = changes.length
    saves.mockClear()
    const changed = await store.acknowledge('bracket', ['M1', 'M2', 'M1'])
    expect(changed.map((m) => [m.id, m.acknowledged])).toEqual([
      ['M1', true],
      ['M2', true]
    ])
    expect(onDisk('bracket').marks.filter((m) => m.acknowledged).map((m) => m.id)).toEqual(['M1', 'M2'])
    expect(saves).toHaveBeenCalledTimes(1)
    expect(changes).toHaveLength(told + 1)
  })

  it('acknowledges none when one of them was not resolved by the agent', async () => {
    for (const note of ['one', 'two', 'three']) await store.add('bracket', pin(note))
    await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
    await store.update('bracket', 'M2', { status: 'resolved' })
    const told = changes.length
    await expect(store.acknowledge('bracket', ['M1', 'M3'])).rejects.toThrow('M3 was not resolved by the agent: there is nothing to acknowledge')
    await expect(store.acknowledge('bracket', ['M1', 'M2'])).rejects.toThrow('M2 was not resolved by the agent')
    await expect(store.acknowledge('bracket', ['M1', 'M9'])).rejects.toThrow('no mark M9')
    expect(onDisk('bracket').marks.some((m) => m.acknowledged)).toBe(false)
    expect(changes).toHaveLength(told)
  })
})

describe('sending marks', () => {
  it('turns every draft into sent, returns those, and tells of it once', async () => {
    await store.add('bracket', pin('one'))
    await store.add('bracket', pin('two'))
    await store.add('bracket', pin('three'))
    await store.update('bracket', 'M2', { status: 'resolved' })
    await store.add('two', pin('elsewhere'))
    saves.mockClear()
    changes = []

    const sent = await store.markSent('bracket')
    expect(ids(sent)).toEqual(['M1', 'M3'])
    expect(sent.every((m) => m.status === 'sent')).toBe(true)
    expect((await store.list('bracket')).map((m) => m.status)).toEqual(['sent', 'resolved', 'sent'])
    expect(onDisk('bracket').marks.map((m) => m.status)).toEqual(['sent', 'resolved', 'sent'])
    expect(changes).toHaveLength(1)
    expect(saves).toHaveBeenCalledTimes(1)
    // The drafts of another object are not its to send.
    expect((await store.list('two'))[0].status).toBe('draft')
  })

  it('a second time finds nothing to send, writes nothing and says nothing', async () => {
    await store.add('bracket', pin())
    await store.markSent('bracket')
    saves.mockClear()
    changes = []
    expect(await store.markSent('bracket')).toEqual([])
    expect(saves).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('given ids, sends those drafts only, in one write', async () => {
    await store.add('bracket', pin('one'))
    await store.add('bracket', pin('two'))
    await store.add('bracket', pin('three'))
    await store.update('bracket', 'M3', { status: 'resolved' })
    saves.mockClear()
    changes = []

    // M3 is no draft and M9 no mark: neither is an error, since the list may have changed since it was read.
    expect(ids(await store.markSent('bracket', ['M1', 'M3', 'M9']))).toEqual(['M1'])
    expect((await store.list('bracket')).map((m) => m.status)).toEqual(['sent', 'draft', 'resolved'])
    expect(saves).toHaveBeenCalledTimes(1)
    expect(changes).toHaveLength(1)
    expect(await store.markSent('bracket', [])).toEqual([])
    expect(saves).toHaveBeenCalledTimes(1)
  })

  it("keeps a mark of the agent's as sent from the start: there is nothing to tell it", async () => {
    const added = await store.add('bracket', { ...pin('this face?'), author: 'agent' }, 'sent')
    expect(added).toMatchObject({ id: 'M1', author: 'agent', status: 'sent' })
    expect(onDisk('bracket').marks[0].status).toBe('sent')
  })
})

describe('re-anchoring after a build', () => {
  it('replaces anchors and their states in one write, leaving the marks not listed', async () => {
    await store.add('bracket', pin('pin'))
    await store.add('bracket', arrow())
    await store.add('bracket', shape(ANCHOR))
    await store.add('bracket', pin('untouched'))
    await store.add('bracket', shape())
    saves.mockClear()
    changes = []

    const moved: Anchor = { point: [1, 2, 21], normal: [0, 0, 1], part: 'base', ref: 'base/F7', descriptor: 'plane, normal +Z, z = 21' }
    await store.reanchor('bracket', [
      { id: 'M1', judged: [ANCHOR], anchors: [moved], anchorState: 'drifted', checkedRevision: 7 },
      { id: 'M2', judged: [ANCHOR], anchors: [{ point: [1, 2, 20] }], anchorState: 'orphaned' },
      { id: 'M3', judged: [ANCHOR], anchors: [moved], anchorState: 'ok' },
      { id: 'M5', judged: [], anchors: [], anchorState: 'ok' },
      { id: 'M9', judged: [ANCHOR], anchors: [moved], anchorState: 'ok' } // removed while the build ran: passed over
    ])
    const marks = await store.list('bracket')
    expect(marks[0]).toMatchObject({ id: 'M1', anchor: moved, anchorState: 'drifted', checkedRevision: 7 })
    expect(marks[1]).toMatchObject({ id: 'M2', from: { point: [1, 2, 20] }, to: [1, 2, 30], anchorState: 'orphaned' })
    expect(marks[1]).not.toHaveProperty('from.ref')
    expect(marks[2]).toMatchObject({ id: 'M3', anchor: moved, anchorState: 'ok' })
    expect(marks[3]).toMatchObject({ id: 'M4', anchor: ANCHOR, anchorState: 'ok' })
    expect(marks[4]).not.toHaveProperty('anchor')
    expect(saves).toHaveBeenCalledTimes(1)
    expect(changes).toEqual([{ objectId: 'bracket', marks, rounds: [], sending: null }])
    expect(onDisk('bracket').marks).toEqual(marks)
  })

  it('writes nothing when no mark it names is there', async () => {
    await store.add('bracket', pin())
    saves.mockClear()
    await store.reanchor('bracket', [{ id: 'M4', judged: [ANCHOR], anchors: [ANCHOR], anchorState: 'ok' }])
    await store.reanchor('bracket', [])
    expect(saves).not.toHaveBeenCalled()
  })

  it('leaves a mark as it was when it is given no anchor to put in place of the one it must have', async () => {
    await store.add('bracket', pin())
    await store.reanchor('bracket', [{ id: 'M1', judged: [ANCHOR], anchors: [], anchorState: 'orphaned' }])
    expect((await store.list('bracket'))[0]).toMatchObject({ anchor: ANCHOR, anchorState: 'orphaned' })
  })

  it('passes over a mark whose anchors are no longer the ones that were judged, and writes the others', async () => {
    await store.add('bracket', pin('moved meanwhile'))
    await store.add('bracket', arrow())
    const elsewhere: Anchor = { point: [9, 9, 20], part: 'base', ref: 'base/F4' }
    const judged: Anchor = { point: [1, 2, 20], part: 'base', ref: 'base/F7' }
    await store.replace('bracket', 'M1', { anchor: elsewhere, revision: 1, camera: CAMERA } as Replacement)
    await store.reanchor('bracket', [
      { id: 'M1', judged: [ANCHOR], anchors: [judged], anchorState: 'drifted', checkedRevision: 2 },
      { id: 'M2', judged: [ANCHOR], anchors: [judged], anchorState: 'ok', checkedRevision: 2 }
    ])
    const [first, second] = await store.list('bracket')
    expect(first).toMatchObject({ anchor: elsewhere, anchorState: 'ok' })
    expect(first).not.toHaveProperty('checkedRevision')
    expect(second).toMatchObject({ from: judged, checkedRevision: 2 })
  })

  it('moves what else the mark holds by the shift, from where it is now, in the same write', async () => {
    const tied: Anchor = { ...ANCHOR, arranged: [50, 0, 0] }
    await store.add('bracket', { ...shape(tied), position: [60, 0, 20] } as NewMark)
    await store.add('bracket', { ...arrow(), from: tied } as NewMark)
    await store.update('bracket', 'M1', { position: [60, 7, 20] })
    saves.mockClear()
    const now: Anchor = { ...ANCHOR, point: [6, 2, 20], arranged: [55, 0, 0] }
    await store.reanchor('bracket', [
      { id: 'M1', judged: [tied], anchors: [now], anchorState: 'ok', shift: [5, 0, 0] },
      { id: 'M2', judged: [tied], anchors: [now], anchorState: 'ok', shift: [5, 0, 0] }
    ])
    const [box, pointer] = await store.list('bracket')
    expect(box).toMatchObject({ position: [65, 7, 20], anchor: now })
    expect(pointer).toMatchObject({ from: now, to: [6, 2, 30] })
    expect(saves).toHaveBeenCalledTimes(1)
  })
})

describe('putting a mark somewhere else', () => {
  const THERE: Anchor = { point: [5, 6, 28], normal: [0, 0, 1], part: 'base', ref: 'base/F9', descriptor: 'plane, normal +Z, z = 28, 900 mm²' }
  const VIEW = { ...CAMERA, position: [50, -50, 40] }
  const placed = { anchor: THERE, revision: 4, camera: VIEW } as Replacement
  let unchecked: string[][]

  beforeEach(() => {
    unchecked = []
    store.on('unchecked', (m) => unchecked.push(m.ids))
  })

  it('ties a pin where it was clicked: the same number and note, ok until it is checked, and asks for the check', async () => {
    await store.add('bracket', pin('too thin here'))
    await store.reanchor('bracket', [{ id: 'M1', judged: [ANCHOR], anchors: [ANCHOR], anchorState: 'drifted' }])
    await store.markSent('bracket')
    unchecked = []
    const moved = await store.replace('bracket', 'M1', placed)
    expect(moved).toMatchObject({ id: 'M1', kind: 'pin', note: 'too thin here', anchorState: 'ok', anchor: THERE, revision: 4, camera: VIEW, createdAt: '2026-10-09T12:00:00.000Z' })
    // The agent was told where it used to be: it is told again.
    expect(moved.status).toBe('draft')
    expect(unchecked).toEqual([['M1']])
    expect(onDisk('bracket').marks).toEqual([moved])
    expect(changes.at(-1)).toEqual({ objectId: 'bracket', marks: [moved], rounds: [], sending: null })
  })

  it('moves the start of an arrow and keeps its length and direction', async () => {
    await store.add('bracket', arrow())
    const moved = await store.replace('bracket', 'M1', placed)
    expect(moved).toMatchObject({ kind: 'arrow', from: THERE, to: [5, 6, 38] })
  })

  it('makes a pick one of what was clicked, and keeps a pick of a part a pick of the part', async () => {
    await store.add('bracket', { ...BASE, kind: 'pick', target: 'face', anchor: ANCHOR } as NewMark)
    await store.add('bracket', { ...BASE, kind: 'pick', target: 'part', anchor: { ...ANCHOR, ref: 'base' } } as NewMark)
    const edge: Anchor = { point: [20, 0, 28], part: 'base', ref: 'base/E3' }
    expect(await store.replace('bracket', 'M1', { ...placed, anchor: edge })).toMatchObject({ target: 'edge', anchor: edge })
    expect(await store.replace('bracket', 'M1', placed)).toMatchObject({ target: 'face', anchor: THERE })
    const whole = await store.replace('bracket', 'M2', { ...placed, anchor: { ...THERE, part: 'post', ref: 'post/F2' } })
    expect(whole).toMatchObject({ target: 'part', anchor: { point: THERE.point, part: 'post', ref: 'post' } })
    expect((whole as PinMark).anchor.descriptor).toBeUndefined()
  })

  it("refuses a mark of the agent's: where it is, is what the agent said", async () => {
    const said = await store.add('bracket', { ...pin(), author: 'agent' } as NewMark, 'sent')
    await expect(store.replace('bracket', 'M1', placed)).rejects.toThrow("M1 is the agent's mark: it is not put somewhere else")
    expect(await store.list('bracket')).toEqual([said])
  })

  it('says nothing has checked it where it now is', async () => {
    await store.add('bracket', pin())
    await store.reanchor('bracket', [{ id: 'M1', judged: [ANCHOR], anchors: [ANCHOR], anchorState: 'ok', checkedRevision: 3 }])
    expect((await store.list('bracket'))[0].checkedRevision).toBe(3)
    expect(await store.replace('bracket', 'M1', placed)).not.toHaveProperty('checkedRevision')
  })

  it('refuses a stroke, a shape, a resolved mark, a place that is on no part, and a mark that is not there', async () => {
    await store.add('bracket', shape())
    await store.add('bracket', { ...BASE, kind: 'stroke', space: 'surface', anchor: ANCHOR, points: [[1, 2, 20], [3, 2, 20]] } as NewMark)
    await store.add('bracket', pin())
    await store.add('bracket', pin())
    await store.update('bracket', 'M4', { status: 'resolved' })
    saves.mockClear()
    unchecked = []
    await expect(store.replace('bracket', 'M1', placed)).rejects.toThrow('M1 is a shape: only a pin, a pick or an arrow is put somewhere else')
    await expect(store.replace('bracket', 'M2', placed)).rejects.toThrow('M2 is a stroke')
    await expect(store.replace('bracket', 'M4', placed)).rejects.toThrow('M4 is resolved: reopen it first')
    await expect(store.replace('bracket', 'M3', { ...placed, anchor: { point: [0, 0, 90] } })).rejects.toThrow('M3 was not put on a part')
    await expect(store.replace('bracket', 'M3', null as never)).rejects.toThrow('M3 was not put on a part')
    await expect(store.replace('bracket', 'M3', { ...placed, anchor: { ...THERE, point: [0, NaN, 0] } })).rejects.toThrow('M3 cannot be put there')
    await expect(store.replace('bracket', 'M9', placed)).rejects.toThrow('no mark M9')
    expect(saves).not.toHaveBeenCalled()
    expect(unchecked).toEqual([])
  })
})

describe('what is on disk', () => {
  it('is read once, then kept in memory', async () => {
    const first = await store.add('bracket', pin())
    writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), JSON.stringify({ next: 1, marks: [] }))
    expect(await store.list('bracket')).toEqual([first])
    // Until the store is told to forget, as when the workspace is left.
    store.forget()
    expect(await store.list('bracket')).toEqual([])
  })

  it('does not take from the file which build a mark was checked against: that was said in another run, whose revisions are not these', async () => {
    await store.add('bracket', pin())
    await store.reanchor('bracket', [{ id: 'M1', judged: [ANCHOR], anchors: [{ ...ANCHOR, arranged: [35, 0, 0] }], anchorState: 'ok', checkedRevision: 12 }])
    expect(onDisk('bracket').marks[0].checkedRevision).toBe(12)
    // The next run reads the file: the spread recorded is kept, the revision is not.
    const next = (await newStore().list('bracket'))[0] as PinMark
    expect(next).not.toHaveProperty('checkedRevision')
    expect(next.anchor.arranged).toEqual([35, 0, 0])
    // So is a workspace left and opened again in the same run.
    store.forget()
    expect((await store.list('bracket'))[0]).not.toHaveProperty('checkedRevision')
  })

  it('a corrupt file is kept aside, said once, and a fresh list started', async () => {
    mkdirSync(join(dirs.bracket, '.torno'))
    writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), '{"next": 2, "marks": [')
    expect(await store.list('bracket')).toEqual([])
    expect(await store.list('bracket')).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0].objectId).toBe('bracket')
    expect(problems[0].message).toContain('marks.json.corrupt-2026-10-09T12-00-00-000Z')
    // M1 was given out by the file that was lost: it is not given out again.
    expect((await store.add('bracket', pin())).id).toBe('M2')
    expect(readdirSync(join(dirs.bracket, '.torno')).sort()).toEqual(['marks.json', 'marks.json.corrupt-2026-10-09T12-00-00-000Z'])
    expect(problems).toHaveLength(1)
  })

  it('marks it cannot read are left out, kept in a copy and said once; their ids are not given out again', async () => {
    const first = await store.add('bracket', pin())
    const raw = JSON.stringify({ next: 2, marks: [first, { ...first, id: 'M5', kind: 'dimension' }] })
    writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), raw)
    store.forget()
    expect(await store.list('bracket')).toEqual([first])
    expect(problems).toEqual([{ objectId: 'bracket', message: expect.stringContaining('marks.json.dropped-2026-10-09T12-00-00-000Z') }])
    expect((await store.add('bracket', pin())).id).toBe('M6')
    expect(readFileSync(join(dirs.bracket, '.torno', 'marks.json.dropped-2026-10-09T12-00-00-000Z'), 'utf8')).toBe(raw)
    store.forget()
    await store.list('bracket')
    expect(problems).toHaveLength(1)
  })

  it('says nothing of an object once the workspace it was asked in has been left', async () => {
    await store.add('bracket', pin())
    changes = []
    // Asked, then the workspace is left before the write lands.
    const pending = store.add('bracket', pin('late'))
    store.forget()
    expect((await pending).id).toBe('M2')
    expect(changes).toEqual([])
    // The write itself went through: the file is the truth the next read starts from.
    expect(ids(onDisk('bracket').marks)).toEqual(['M1', 'M2'])
    expect(ids(await store.list('bracket'))).toEqual(['M1', 'M2'])

    mkdirSync(join(dirs.two, '.torno'))
    writeFileSync(join(dirs.two, '.torno', 'marks.json'), 'not json')
    const listing = store.list('two')
    store.forget()
    await listing
    expect(problems).toEqual([])
  })

  it('keeps what was wrong with a folder to be asked for, until it is dismissed', async () => {
    mkdirSync(join(dirs.bracket, '.torno'))
    writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), 'not json')
    // Asking is what reads the file, when nothing has yet.
    const said = await store.problem('bracket')
    expect(said).toContain('marks.json.corrupt-2026-10-09T12-00-00-000Z')
    expect(problems).toEqual([{ objectId: 'bracket', message: said }])
    // Whoever was not listening can still ask, any number of times, and of this folder only.
    expect(await store.problem('bracket')).toBe(said)
    expect(await store.problem('two')).toBeNull()
    await store.dismissProblem('bracket')
    expect(await store.problem('bracket')).toBeNull()
    await expect(store.problem('ghost')).rejects.toThrow('no project named ghost')
  })

  it('a problem found while the workspace was being left is not told, and is still there to be asked for', async () => {
    mkdirSync(join(dirs.two, '.torno'))
    writeFileSync(join(dirs.two, '.torno', 'marks.json'), 'not json')
    const listing = store.list('two')
    store.forget()
    await listing
    expect(problems).toEqual([])
    expect(await store.problem('two')).toContain('marks.json.corrupt-')
    expect(problems).toEqual([])
  })

  it('a write that fails changes nothing in memory, and the next one goes through', async () => {
    await store.add('bracket', pin())
    changes = []
    saves.mockRejectedValueOnce(new Error('disk full'))
    await expect(store.add('bracket', pin('lost'))).rejects.toThrow('disk full')
    expect(ids(await store.list('bracket'))).toEqual(['M1'])
    expect(changes).toEqual([])
    expect((await store.add('bracket', pin('kept'))).id).toBe('M2')
  })
})

describe('a dimension', () => {
  const TOP: Anchor = { point: [5, 3, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5' }
  const BOTTOM: Anchor = { point: [5, 3, -3], normal: [0, 0, -1], part: 'plate', ref: 'plate/F0' }
  const distance = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'distance', a: TOP, b: BOTTOM, ...more }) as NewMark
  const hole = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'diameter', a: { point: [-6, 5, 0], part: 'plate', ref: 'plate/F9' }, ...more }) as NewMark
  const EIGHT = { value: 8, how: 'cylinder', points: [[-14, 5, 0], [-6, 5, 0]] as [[number, number, number], [number, number, number]], measuredRevision: 2 }

  it('is a mark like any other: the next number, a draft, written and told', async () => {
    await store.add('bracket', pin())
    const added = await store.add('bracket', distance())
    expect(added).toMatchObject({ id: 'M2', kind: 'dimension', measure: 'distance', status: 'draft', anchorState: 'ok', a: TOP, b: BOTTOM })
    expect(onDisk('bracket').marks[1]).toEqual(added)
    expect(ids(changes.at(-1)!.marks)).toEqual(['M1', 'M2'])
  })

  it('takes what was measured from main alone: never from whoever adds it or patches it', async () => {
    const forged = await store.add('bracket', hole({ value: 8.5, how: 'as I say', points: [[0, 0, 0], [1, 1, 1]], measuredRevision: 9, verdict: 'pass', expected: 8.5 }))
    for (const key of ['value', 'how', 'points', 'measuredRevision', 'verdict']) expect(forged).not.toHaveProperty(key)
    expect(forged).toMatchObject({ expected: 8.5 })
    const patched = await store.update('bracket', 'M1', { value: 8.5, verdict: 'pass', how: 'x', note: 'the hole' } as never)
    for (const key of ['value', 'how', 'verdict']) expect(patched).not.toHaveProperty(key)
    // Main's own, given beside the mark, is kept: in the one write, told once.
    changes = []
    const measured = await store.add('bracket', hole({ value: 99 }), 'draft', EIGHT)
    expect(measured).toMatchObject({ id: 'M2', ...EIGHT })
    expect(changes).toHaveLength(1)
  })

  it('writes what the kernel measured of it, while its ends are those that were measured', async () => {
    const added = (await store.add('bracket', hole({ expected: 8.5 }))) as DimensionMark
    expect(await store.measured('bracket', 'M1', added, EIGHT)).toMatchObject({ ...EIGHT, expected: 8.5, verdict: 'fail', status: 'draft' })
    expect(onDisk('bracket').marks[0]).toMatchObject({ value: 8, verdict: 'fail' })
    // Not measurable: the value it had is gone, with the points and the verdict.
    const gone = await store.measured('bracket', 'M1', added, { measuredRevision: 3 })
    expect(gone).toMatchObject({ measuredRevision: 3, expected: 8.5 })
    for (const key of ['value', 'how', 'points', 'verdict']) expect(gone).not.toHaveProperty(key)
    // A check that says more of its ends and leaves them on the same refs leaves them the ends that were measured.
    await store.reanchor('bracket', [{ id: 'M1', judged: [added.a], anchors: [{ ...added.a, descriptor: 'cylinder, radius 4' }], anchorState: 'ok', checkedRevision: 3 }])
    expect(await store.measured('bracket', 'M1', added, EIGHT)).toMatchObject({ value: 8, a: { ref: 'plate/F9', descriptor: 'cylinder, radius 4' } })
    // A mark that is gone, or is no dimension, is passed over.
    await store.add('bracket', pin())
    expect(await store.measured('bracket', 'M2', added, EIGHT)).toBeNull()
    expect(await store.measured('bracket', 'M9', added, EIGHT)).toBeNull()
    // And one resolved meanwhile: it is no longer measured, and keeps what it had when it was resolved.
    await store.update('bracket', 'M1', { status: 'resolved' })
    expect(await store.measured('bracket', 'M1', added, { ...EIGHT, value: 9, measuredRevision: 4 })).toBeNull()
    expect((await store.list('bracket'))[0]).toMatchObject({ status: 'resolved', value: 8, measuredRevision: 2 })
  })

  it('does not keep a value that was measured through a ref the check has since replaced', async () => {
    // The kernel measures the feature a ref names: plate/F9 was the hole, and after the build that renumbered the
    // faces it is something else. What was measured through it is not the value of the mark that now says plate/F11.
    const added = (await store.add('bracket', hole({ expected: 8 }))) as DimensionMark
    await store.reanchor('bracket', [{ id: 'M1', judged: [added.a], anchors: [{ ...added.a, ref: 'plate/F11' }], anchorState: 'ok', checkedRevision: 3 }])
    changes = []
    expect(await store.measured('bracket', 'M1', added, { ...EIGHT, value: 30, measuredRevision: 3 })).toBeNull()
    expect(changes).toEqual([])
    const [kept] = (await store.list('bracket')) as DimensionMark[]
    for (const key of ['value', 'measuredRevision', 'verdict']) expect(kept).not.toHaveProperty(key)
    // Measured through the ref it has now, it is kept.
    expect(await store.measured('bracket', 'M1', kept, { ...EIGHT, measuredRevision: 3 })).toMatchObject({ value: 8, verdict: 'pass', a: { ref: 'plate/F11' } })
  })

  describe('measured again after a build, all of them in one write', () => {
    const of = (m: DimensionMark) => ({ measure: m.measure, a: m.a, ...(m.b ? { b: m.b } : {}), ...(m.expected === undefined ? {} : { expected: m.expected }), ...(m.tolerance === undefined ? {} : { tolerance: m.tolerance }) })
    const NINE = { ...EIGHT, value: 9, measuredRevision: 3 }
    const FIVE = { value: 5, how: 'between planes', points: [[5, 3, 2], [5, 3, -3]] as [[number, number, number], [number, number, number]], measuredRevision: 3 }

    it('gives each its value and its verdict, writes once, and is not news of any mark', async () => {
      const first = (await store.add('bracket', hole({ expected: 8 }), 'draft', EIGHT)) as DimensionMark
      const second = (await store.add('bracket', distance({ expected: 6 }), 'draft', { ...FIVE, value: 6, measuredRevision: 2 })) as DimensionMark
      await store.markSent('bracket')
      const [a, b] = (await store.list('bracket')) as DimensionMark[]
      expect([first.verdict, second.verdict, a.status, b.status]).toEqual(['pass', 'pass', 'sent', 'sent'])
      changes = []
      const written = saves.mock.calls.length
      await store.remeasured('bracket', [{ id: 'M1', of: of(a), result: NINE }, { id: 'M2', of: of(b), result: FIVE }])
      expect(saves.mock.calls.length).toBe(written + 1)
      expect(changes).toHaveLength(1)
      const now = (await store.list('bracket')) as DimensionMark[]
      expect(now[0]).toMatchObject({ value: 9, measuredRevision: 3, verdict: 'fail', status: 'sent', sentBefore: true })
      expect(now[1]).toMatchObject({ value: 5, measuredRevision: 3, verdict: 'fail', status: 'sent', points: FIVE.points })
      expect(onDisk('bracket').marks).toEqual(now)
    })

    it('one with no value on that build loses the one it had, with the verdict, and keeps the reason', async () => {
      const added = (await store.add('bracket', hole({ expected: 8 }), 'draft', EIGHT)) as DimensionMark
      await store.remeasured('bracket', [{ id: 'M1', of: of(added), result: { measuredRevision: 3, refused: 'plate/F9 is a plane face: it has no diameter' } }])
      const [now] = (await store.list('bracket')) as DimensionMark[]
      expect(now).toMatchObject({ measuredRevision: 3, expected: 8, refused: 'plate/F9 is a plane face: it has no diameter' })
      for (const key of ['value', 'how', 'points', 'verdict']) expect(now).not.toHaveProperty(key)
      // Measurable again: the reason is gone with it.
      await store.remeasured('bracket', [{ id: 'M1', of: of(now), result: { ...EIGHT, measuredRevision: 4 } }])
      const [again] = (await store.list('bracket')) as DimensionMark[]
      expect(again).toMatchObject({ value: 8, verdict: 'pass' })
      expect(again).not.toHaveProperty('refused')
    })

    it('passes over a mark that changed underneath: its ends, what it should be, resolved, gone or no dimension', async () => {
      const moved = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark // M1
      const expects = (await store.add('bracket', hole({ expected: 8 }), 'draft', EIGHT)) as DimensionMark // M2
      const done = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark // M3
      const gone = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark // M4
      await store.add('bracket', pin()) // M5
      const fine = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark // M6
      // Meanwhile: a check gave M1 another ref, the person changed what M2 should be, resolved M3 and deleted M4.
      await store.reanchor('bracket', [{ id: 'M1', judged: [moved.a], anchors: [{ ...moved.a, ref: 'plate/F11' }], anchorState: 'ok', checkedRevision: 3 }])
      await store.update('bracket', 'M2', { expected: 9 })
      await store.update('bracket', 'M3', { status: 'resolved' })
      await store.remove('bracket', 'M4')
      await store.remeasured('bracket', [moved, expects, done, gone, { ...fine, id: 'M5' }, fine, { ...fine, id: 'M9' }].map((m) => ({ id: m.id, of: of(m), result: NINE })))
      const now = Object.fromEntries((await store.list('bracket')).map((m) => [m.id, m])) as Record<string, DimensionMark>
      expect([now.M1.value, now.M2.value, now.M3.value, now.M6.value]).toEqual([8, 8, 8, 9])
      expect(now.M2).toMatchObject({ expected: 9, verdict: 'fail', measuredRevision: 2 })
      expect(now.M5.kind).toBe('pin')
    })

    it('writes and tells nothing when nothing changed', async () => {
      const added = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark
      changes = []
      const written = saves.mock.calls.length
      await store.remeasured('bracket', [{ id: 'M1', of: of(added), result: EIGHT }])
      await store.remeasured('bracket', [])
      expect(saves.mock.calls.length).toBe(written)
      expect(changes).toEqual([])
    })
  })

  it('judges anew when what it should measure or the tolerance is changed, without another measurement', async () => {
    await store.add('bracket', hole(), 'draft', EIGHT)
    expect(await store.update('bracket', 'M1', { expected: 8.5 })).toMatchObject({ value: 8, expected: 8.5, verdict: 'fail' })
    expect(await store.update('bracket', 'M1', { tolerance: 0.5 })).toMatchObject({ expected: 8.5, tolerance: 0.5, verdict: 'pass' })
    // Null puts the tolerance back to the default, and takes the expectation away.
    const strict = await store.update('bracket', 'M1', { tolerance: null })
    expect(strict).toMatchObject({ verdict: 'fail' })
    expect(strict).not.toHaveProperty('tolerance')
    const free = await store.update('bracket', 'M1', { expected: null })
    expect(free).toMatchObject({ value: 8 })
    expect(free).not.toHaveProperty('expected')
    expect(free).not.toHaveProperty('verdict')
    await expect(store.update('bracket', 'M1', { expected: 'eight' } as never)).rejects.toThrow('expected is a number')
    await expect(store.update('bracket', 'M1', { tolerance: -0.1 })).rejects.toThrow('tolerance is a number, zero or more')
  })

  it('has no expectation on any other mark', async () => {
    await store.add('bracket', pin())
    await expect(store.update('bracket', 'M1', { expected: 8 })).rejects.toThrow('M1 is a pin, not a dimension: it has no expected')
  })

  it('is told again when what it should be changes, and not when it is measured again', async () => {
    const added = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark
    await store.markSent('bracket')
    expect(await store.measured('bracket', 'M1', added, { ...EIGHT, value: 8.2, measuredRevision: 3 })).toMatchObject({ status: 'sent', value: 8.2 })
    expect(await store.update('bracket', 'M1', { expected: 8 })).toMatchObject({ status: 'draft', sentBefore: true, verdict: 'fail' })
    await store.markSent('bracket')
    expect(await store.update('bracket', 'M1', { expected: 8 })).toMatchObject({ status: 'sent' })
    expect(await store.update('bracket', 'M1', { tolerance: 0.3 })).toMatchObject({ status: 'draft', verdict: 'pass' })
  })

  it('of the agent’s own is news to it when the person changes what it should be: told as changed, not as reopened', async () => {
    await store.add('bracket', { ...hole({ expected: 8 }), author: 'agent' } as NewMark, 'sent', EIGHT)
    const changed = await store.update('bracket', 'M1', { expected: 8.5 })
    expect(changed).toMatchObject({ status: 'draft', sentBefore: true, expected: 8.5, verdict: 'fail' })
    expect(changed).not.toHaveProperty('reopened')
    await store.markSent('bracket')
    expect(await store.update('bracket', 'M1', { tolerance: 1 })).toMatchObject({ status: 'draft', verdict: 'pass' })
    // What the agent changes of its own is no news to it, nor is the person's note on it.
    await store.markSent('bracket')
    expect(await store.update('bracket', 'M1', { expected: 9 }, 'agent')).toMatchObject({ status: 'sent' })
  })

  it('has both its ends moved by a check, each by how far its own part was moved, with the point its value was taken at', async () => {
    const added = (await store.add('bracket', distance({ measure: 'angle' }), 'draft', { value: 90, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]], measuredRevision: 1 })) as DimensionMark
    await store.reanchor('bracket', [{ id: 'M1', judged: [added.a, added.b!], anchors: [added.a, { ...BOTTOM, point: [10, 3, -3] }], anchorState: 'ok', shiftB: [5, 0, 0], checkedRevision: 2 }])
    const [now] = (await store.list('bracket')) as DimensionMark[]
    expect(now).toMatchObject({ a: { point: [5, 3, 3] }, b: { point: [10, 3, -3] }, points: [[5, 3, 3], [10, 3, -3]], checkedRevision: 2 })
  })

  it('has both its ends refreshed by a check, and moves with them, with the points it was measured between', async () => {
    const added = (await store.add('bracket', distance(), 'draft', { value: 6, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]], measuredRevision: 1 })) as DimensionMark
    await store.reanchor('bracket', [
      { id: 'M1', judged: [added.a, added.b!], anchors: [{ ...TOP, point: [15, 3, 3], ref: 'plate/F7' }, { ...BOTTOM, point: [15, 3, -3], ref: 'plate/F2' }], anchorState: 'ok', shift: [10, 0, 0], shiftB: [10, 0, 0], checkedRevision: 2 }
    ])
    const [now] = (await store.list('bracket')) as DimensionMark[]
    expect(now).toMatchObject({ a: { point: [15, 3, 3], ref: 'plate/F7' }, b: { point: [15, 3, -3], ref: 'plate/F2' }, points: [[15, 3, 3], [15, 3, -3]], value: 6, checkedRevision: 2 })
  })

  it('no longer says which build it was measured on once a check gives an end another ref or another point', async () => {
    const SIX = { value: 6, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]] as [[number, number, number], [number, number, number]], measuredRevision: 2 }
    const added = (await store.add('bracket', distance({ expected: 6 }), 'draft', SIX)) as DimensionMark
    const check = (anchors: Anchor[], more: object = {}) => store.reanchor('bracket', [{ id: 'M1', judged: [added.a, added.b!], anchors, anchorState: 'ok', checkedRevision: 2, ...more }])
    // More said of the same ends: it is still the measurement of r2.
    await check([{ ...added.a, descriptor: 'plane, normal +Z' }, added.b!])
    expect((await store.list('bracket'))[0]).toMatchObject({ value: 6, measuredRevision: 2, verdict: 'pass' })
    // The second end is on another face now: what was measured through plate/F0 is of no build of this mark.
    const refreshed = [{ ...added.a, descriptor: 'plane, normal +Z' }, { ...added.b!, ref: 'plate/F3' }]
    await store.reanchor('bracket', [{ id: 'M1', judged: [refreshed[0], added.b!], anchors: refreshed, anchorState: 'ok', checkedRevision: 2 }])
    const [now] = (await store.list('bracket')) as DimensionMark[]
    expect(now).toMatchObject({ value: 6, b: { ref: 'plate/F3' }, checkedRevision: 2 })
    expect(now).not.toHaveProperty('measuredRevision')
    // So too when it is moved with its part.
    const again = (await store.add('bracket', distance(), 'draft', SIX)) as DimensionMark
    await store.reanchor('bracket', [{ id: 'M2', judged: [again.a, again.b!], anchors: [{ ...again.a, point: [15, 3, 3] }, { ...again.b!, point: [15, 3, -3] }], anchorState: 'ok', shift: [10, 0, 0], checkedRevision: 3 }])
    expect((await store.list('bracket'))[1]).not.toHaveProperty('measuredRevision')
  })

  it('is not put somewhere else by a click', async () => {
    await store.add('bracket', distance())
    await expect(store.replace('bracket', 'M1', { anchor: ANCHOR, revision: 2, camera: CAMERA } as Replacement)).rejects.toThrow('M1 is a dimension: only a pin, a pick or an arrow is put somewhere else')
  })

  it('forgets which build it was measured on when the file is read in another run: the value stays', async () => {
    await store.add('bracket', hole(), 'draft', EIGHT)
    expect(onDisk('bracket').marks[0]).toMatchObject({ measuredRevision: 2 })
    const [read] = await newStore().list('bracket')
    expect(read).toMatchObject({ value: 8 })
    expect(read).not.toHaveProperty('measuredRevision')
  })
})

describe('a region of a scan', () => {
  const STATS = { triangles: 2, area: 100, local: { centroid: [-15, -15, 0], bbox: { min: [-20, -20, 0], max: [-10, -10, 0] }, plane: { origin: [-15, -15, 0], normal: [0, 0, 1], rms: 0 } } } as const
  const region = (scan = 'S1', over: object = {}): NewMark => ({ ...BASE, kind: 'region', scan, note: 'loom', ...over }) as NewMark
  const kept = (before: (id: string) => Promise<void> = async () => {}) => ({ stats: structuredClone(STATS) as never, before })

  it('is kept with the numbers main worked out, whatever came in their place', async () => {
    const added = await store.add('bracket', region('S1', { triangles: 999999, area: 1, local: { centroid: [9, 9, 9] }, checkedRevision: 4 }), 'draft', undefined, kept())
    expect(added).toMatchObject({ id: 'M1', kind: 'region', scan: 'S1', status: 'draft', anchorState: 'ok', ...STATS })
    expect(added).not.toHaveProperty('checkedRevision')
    expect(onDisk('bracket').marks[0]).toMatchObject(STATS)
    // Without what main says of it, it is no region.
    await expect(store.add('bracket', region())).rejects.toThrow('that is not a mark')
  })

  it('has its mask written once it has its number, before the mark is written or told', async () => {
    await store.add('bracket', pin())
    changes = []
    const seen: string[] = []
    await store.add('bracket', region(), 'draft', undefined, kept(async (id) => {
      seen.push(id, ...ids(onDisk('bracket').marks), `told ${changes.length}`)
    }))
    expect(seen).toEqual(['M2', 'M1', 'told 0'])
    expect(ids(onDisk('bracket').marks)).toEqual(['M1', 'M2'])
    expect(changes).toHaveLength(1)
  })

  it('is no mark when its mask could not be written: nothing is told, and the next mark has that number', async () => {
    await expect(store.add('bracket', region(), 'draft', undefined, kept(async () => Promise.reject(new Error('the disk is full'))))).rejects.toThrow('the disk is full')
    expect(changes).toEqual([])
    expect(await store.list('bracket')).toEqual([])
    expect((await store.add('bracket', pin())).id).toBe('M1')
  })

  it('is orphaned with its scan, and no other mark is', async () => {
    await store.add('bracket', region('S1'), 'draft', undefined, kept())
    await store.add('bracket', region('S2'), 'draft', undefined, kept())
    await store.add('bracket', pin())
    await store.add('bracket', region('S1'), 'sent', undefined, kept())
    saves.mockClear()
    await store.orphanRegions('bracket', 'S1')
    expect((await store.list('bracket')).map((m) => m.anchorState)).toEqual(['orphaned', 'ok', 'ok', 'orphaned'])
    // What the agent was told of a region it was sent no longer holds: it is told again.
    expect((await store.list('bracket')).map((m) => m.status)).toEqual(['draft', 'draft', 'draft', 'draft'])
    expect(saves).toHaveBeenCalledTimes(1)
    // Nothing left to say: nothing written.
    await store.orphanRegions('bracket', 'S1')
    await store.orphanRegions('bracket', 'S9')
    expect(saves).toHaveBeenCalledTimes(1)
    // Only those named, when some are.
    await store.orphanRegions('bracket', 'S2', ['M9'])
    expect((await store.list('bracket'))[1].anchorState).toBe('ok')
  })

  it('changes by its note and its status only', async () => {
    await store.add('bracket', region(), 'sent', undefined, kept())
    await expect(store.update('bracket', 'M1', { size: [1, 1, 1] })).rejects.toThrow('M1 is a region, not a shape')
    expect(await store.update('bracket', 'M1', { note: 'battery' })).toMatchObject({ note: 'battery', status: 'draft', ...STATS })
    await expect(store.replace('bracket', 'M1', { anchor: ANCHOR, revision: 2, camera: CAMERA } as Replacement)).rejects.toThrow('M1 is a region: only a pin, a pick or an arrow is put somewhere else')
  })
})

describe('what a dimension measured on the builds of this run', () => {
  const TOP: Anchor = { point: [5, 3, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5' }
  const BOTTOM: Anchor = { point: [5, 3, -3], normal: [0, 0, -1], part: 'plate', ref: 'plate/F0' }
  const distance = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'distance', a: TOP, b: BOTTOM, ...more }) as NewMark
  const at = (value: number, measuredRevision: number) => ({ value, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]] as [[number, number, number], [number, number, number]], measuredRevision })
  const of = (m: DimensionMark) => ({ measure: m.measure, a: m.a, ...(m.b ? { b: m.b } : {}), ...(m.expected === undefined ? {} : { expected: m.expected }) })
  const shownOf = async (): Promise<DimensionMark> => (store.shown('bracket', await store.list('bracket')) as DimensionMark[])[0]

  it('is told to the window with the marks, build after build, and is in no file and in no other listing', async () => {
    const added = (await store.add('bracket', distance({ expected: 6 }), 'draft', at(6, 1))) as DimensionMark
    await store.remeasured('bracket', [{ id: 'M1', of: of(added), result: at(5.5, 2) }])
    await store.remeasured('bracket', [{ id: 'M1', of: of(added), result: at(6, 3) }])
    expect((await shownOf()).history).toEqual([{ revision: 1, value: 6 }, { revision: 2, value: 5.5 }, { revision: 3, value: 6 }])
    // The event that told the window carries the same, and the listing the agent's tools read does not.
    expect((store.shown('bracket', changes.at(-1)!.marks)[0] as DimensionMark).history).toHaveLength(3)
    expect(changes.at(-1)!.marks[0]).not.toHaveProperty('history')
    expect((await store.list('bracket'))[0]).not.toHaveProperty('history')
    expect(JSON.stringify(onDisk('bracket'))).not.toContain('history')
    // Nor is it taken from whoever gives a mark.
    await store.add('bracket', distance({ history: [{ revision: 1, value: 1 }] }))
    expect(((await store.list('bracket')) as DimensionMark[])[1]).not.toHaveProperty('history')
  })

  it('records a build with no value, replaces a build measured again, and is not recorded by a change that measured nothing', async () => {
    const added = (await store.add('bracket', distance({ expected: 6 }), 'draft', at(6, 1))) as DimensionMark
    await store.remeasured('bracket', [{ id: 'M1', of: of(added), result: { measuredRevision: 2, refused: 'no' } }])
    await store.remeasured('bracket', [{ id: 'M1', of: of(added), result: at(7, 2) }])
    await store.update('bracket', 'M1', { note: 'thick enough' })
    expect((await shownOf()).history).toEqual([{ revision: 1, value: 6 }, { revision: 2, value: 7 }])
  })

  it('starts again when its ends are put on other geometry, and when the workspace is left', async () => {
    const added = (await store.add('bracket', distance({ expected: 6 }), 'draft', at(6, 1))) as DimensionMark
    await store.remeasured('bracket', [{ id: 'M1', of: of(added), result: at(6, 2) }])
    await store.reanchor('bracket', [{ id: 'M1', judged: [added.a, added.b!], anchors: [{ ...added.a, ref: 'plate/F7' }, added.b!], anchorState: 'ok', checkedRevision: 3 }])
    expect((await shownOf()).history).toBeUndefined()
    const [moved] = (await store.list('bracket')) as DimensionMark[]
    await store.remeasured('bracket', [{ id: 'M1', of: of(moved), result: at(6, 3) }])
    expect((await shownOf()).history).toEqual([{ revision: 3, value: 6 }])
    store.forget()
    expect((await shownOf()).history).toBeUndefined()
  })
})

describe('a view note', () => {
  const under = { box: [10, 10, 60, 40] as [number, number, number, number], refs: [{ ref: 'base/F4' }], cuts: [], scans: [], bare: false }
  const note = (over: object = {}): NewNote =>
    ({
      ...BASE,
      note: 'too thin here',
      kind: 'note',
      anchor: ANCHOR,
      picture: 'n-0123456789ab.png',
      ink: 'n-0123456789ab.ink.png',
      size: { w: 800, h: 600 },
      strokes: [{ width: 4, points: [[10, 10], [60, 40]] }],
      inkColour: '#ff00ff',
      labels: [],
      under: [under],
      references: [],
      ...over
    }) as unknown as NewNote

  it('is added as a draft of the person, with its number', async () => {
    const added = await store.addNote('bracket', note())
    expect(added).toMatchObject({ id: 'M1', kind: 'note', author: 'user', status: 'draft', anchorState: 'ok', note: 'too thin here', picture: 'n-0123456789ab.png' })
    expect(onDisk('bracket')).toEqual({ next: 2, marks: [added] })
    expect(changes).toHaveLength(1)
  })

  it('is never added through add, which is what the window asks for: only addNote keeps one, its files being main\'s', async () => {
    await expect(store.add('bracket', note())).rejects.toThrow(/note/)
    expect(await store.list('bracket')).toEqual([])
  })

  it('names the files of its notes, and apart those of the notes removed in this run, to whoever sweeps them', async () => {
    await store.addNote('bracket', note({ picture: 'n-aaaaaaaaaaaa.png', ink: 'n-aaaaaaaaaaaa.ink.png', references: [{ file: 'r-aaaaaaaaaaaa.jpg', comment: '' }] }))
    await store.addNote('bracket', note({ picture: 'n-bbbbbbbbbbbb.png', ink: 'n-bbbbbbbbbbbb.ink.png' }))
    await store.add('bracket', pin())
    await store.remove('bracket', 'M3')
    const seen = await store.withNoteFiles('bracket', async ({ live, kept }, dir, problem) => ({ live: [...live].sort(), kept: [...kept], dir, problem }))
    expect(seen).toEqual({ live: ['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png', 'n-bbbbbbbbbbbb.ink.png', 'n-bbbbbbbbbbbb.png', 'r-aaaaaaaaaaaa.jpg'], kept: [], dir: dirs.bracket, problem: null })
    await store.remove('bracket', 'M2')
    expect(await store.withNoteFiles('bracket', async ({ live, kept }) => ({ live: [...live].sort(), kept: [...kept].sort() }))).toEqual({ live: ['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png', 'r-aaaaaaaaaaaa.jpg'], kept: ['n-bbbbbbbbbbbb.ink.png', 'n-bbbbbbbbbbbb.png'] })
  })

  it('forgets the files of the notes removed when the workspace is left, and keeps a restored one named', async () => {
    await store.addNote('bracket', note())
    await store.remove('bracket', 'M1')
    await store.restore('bracket', 'M1')
    const both = ['n-0123456789ab.ink.png', 'n-0123456789ab.png']
    expect(await store.withNoteFiles('bracket', async ({ live, kept }) => ({ live: [...live].sort(), kept: [...kept].sort() }))).toEqual({ live: both, kept: both })
    await store.remove('bracket', 'M1')
    store.forget()
    expect(await store.withNoteFiles('bracket', async ({ live, kept }) => [...live, ...kept])).toEqual([])
  })

  it('lists the files torno drops in the folder of the notes: those of a note removed, the ink an edit replaced, the references it took away', async () => {
    mkdirSync(join(dirs.bracket, '.torno', 'notes'), { recursive: true })
    const listed = (): Promise<string[]> => droppedNames(dirs.bracket, ['notes'], isNoteFile).then((names) => names.sort())
    await store.addNote('bracket', note({ picture: 'n-aaaaaaaaaaaa.png', ink: 'n-aaaaaaaaaaaa.ink.png', references: [{ file: 'r-aaaaaaaaaaaa.jpg', comment: '' }, { file: 'r-bbbbbbbbbbbb.jpg', comment: '' }] }))
    expect(await listed()).toEqual([])
    // A new ink and one reference less: the old ink and that reference are dropped, the plain picture and the other reference are not.
    await store.editNote('bracket', 'M1', { ink: 'n-cccccccccccc.ink.png', references: [{ file: 'r-aaaaaaaaaaaa.jpg', comment: '' }] })
    expect(await listed()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'r-bbbbbbbbbbbb.jpg'])
    // A change that lets go of nothing lists nothing.
    await store.editNote('bracket', 'M1', { note: 'thicker' })
    expect(await listed()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'r-bbbbbbbbbbbb.jpg'])
    await store.remove('bracket', 'M1')
    expect(await listed()).toEqual(['n-aaaaaaaaaaaa.ink.png', 'n-aaaaaaaaaaaa.png', 'n-cccccccccccc.ink.png', 'r-aaaaaaaaaaaa.jpg', 'r-bbbbbbbbbbbb.jpg'])
    // Nothing but the list was written there: the pictures are not made by the store.
    expect(readdirSync(join(dirs.bracket, '.torno', 'notes'))).toEqual(['dropped.json'])
  })

  it('says what was wrong with its marks file to the sweep, which then leaves the files alone', async () => {
    mkdirSync(join(dirs.bracket, '.torno'))
    writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), 'not json')
    expect(await store.withNoteFiles('bracket', async (_named, _dir, problem) => problem)).toMatch(/could not be read/)
  })

  it('waits its turn: no change lands while the sweep runs', async () => {
    const order: string[] = []
    const sweeping = store.withNoteFiles('bracket', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('swept')
    })
    const added = store.addNote('bracket', note()).then(() => order.push('added'))
    await Promise.all([sweeping, added])
    expect(order).toEqual(['swept', 'added'])
  })

  it('is added without an anchor when the ink lay over no face', async () => {
    const { anchor: _anchor, ...bare } = note() as NewNote & { anchor?: Anchor }
    expect(await store.addNote('bracket', bare as NewNote)).not.toHaveProperty('anchor')
  })

  it('takes nothing main alone says, and is the person’s whoever asks', async () => {
    const added = await store.addNote('bracket', { ...note(), author: 'agent', sentBefore: true, reopened: true, checkedRevision: 9, resolvedBy: 'agent', acknowledged: true, status: 'resolved' } as never)
    expect(added).toMatchObject({ author: 'user', status: 'draft' })
    for (const key of ['sentBefore', 'reopened', 'checkedRevision', 'resolvedBy', 'acknowledged']) expect(added).not.toHaveProperty(key)
  })

  it('is refused for a file name that is not main’s, and takes no number', async () => {
    await expect(store.addNote('bracket', note({ picture: '../../etc/passwd' }))).rejects.toThrow(/not a mark/)
    expect(saves).not.toHaveBeenCalled()
    expect((await store.addNote('bracket', note())).id).toBe('M1')
  })

  it('is edited: its comment, labels, strokes, what they lie over, references and its inked file', async () => {
    await store.addNote('bracket', note())
    const edited = await store.editNote('bracket', 'M1', {
      note: 'thicker',
      labels: [{ x: 5, y: 6, text: 'here' }],
      strokes: [{ width: 2, points: [[1, 1], [2, 2]] }],
      under: [under, under],
      references: [{ file: 'r-0123456789ab.png', comment: 'like this' }],
      ink: 'n-0123456789ab.ink.png'
    })
    expect(edited).toMatchObject({ note: 'thicker', labels: [{ text: 'here' }], strokes: [{ width: 2 }], references: [{ comment: 'like this' }] })
    expect(onDisk('bracket').marks[0]).toEqual(edited)
    // It does not change what main alone names, nor the pictures' plain file.
    expect(edited.status).toBe('draft')
  })

  it('forgets what its ink lay over when its strokes or labels change and the edit does not say it anew', async () => {
    await store.addNote('bracket', note())
    const moved = await store.editNote('bracket', 'M1', { strokes: [{ width: 2, points: [[1, 1], [2, 2]] }], ink: 'n-0123456789ab.ink.png' })
    expect(moved).toMatchObject({ under: [] })
    await store.editNote('bracket', 'M1', { under: [under] })
    expect(await store.editNote('bracket', 'M1', { labels: [{ x: 5, y: 6, text: 'here' }] })).toMatchObject({ under: [] })
    // A comment alone leaves it, and an edit that says it anew keeps what it says.
    await store.editNote('bracket', 'M1', { under: [under] })
    expect(await store.editNote('bracket', 'M1', { note: 'thicker' })).toMatchObject({ under: [under] })
    expect(await store.editNote('bracket', 'M1', { labels: [], under: [under, under] })).toMatchObject({ under: [under, under] })
  })

  it('refuses an edit to anything but a note, to a file that is not main’s, and to a note that is not there', async () => {
    await store.add('bracket', pin('here'))
    await store.addNote('bracket', note()) // M2
    await expect(store.editNote('bracket', 'M1', { note: 'x' })).rejects.toThrow(/M1 is a pin, not a note/)
    await expect(store.editNote('bracket', 'M2', { ink: 'x.png' })).rejects.toThrow(/not a valid change/)
    await expect(store.editNote('bracket', 'M9', { note: 'x' })).rejects.toThrow(/no mark M9/)
    expect(((await store.list('bracket'))[1] as NoteMark).ink).toBe('n-0123456789ab.ink.png')
  })

  it('is a draft again, and reopened, when a note the agent was sent is edited', async () => {
    await store.addNote('bracket', note())
    await store.markSent('bracket')
    const edited = await store.editNote('bracket', 'M1', { note: 'thicker' })
    expect(edited).toMatchObject({ status: 'draft', sentBefore: true, reopened: true })
    expect(onDisk('bracket').marks[0]).toMatchObject({ status: 'draft', reopened: true })
  })

  it('is reopened when edited after the agent resolved it, and forgets who resolved it', async () => {
    await store.addNote('bracket', note())
    await store.markSent('bracket')
    await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
    const edited = await store.editNote('bracket', 'M1', { references: [{ file: 'r-0123456789ab.jpg', comment: '' }] })
    expect(edited).toMatchObject({ status: 'draft', reopened: true })
    expect(edited).not.toHaveProperty('resolvedBy')
  })

  it('stays as it is, and a draft stays a draft, when the edit changes nothing', async () => {
    await store.addNote('bracket', note())
    expect(await store.editNote('bracket', 'M1', { note: 'too thin here' })).not.toHaveProperty('reopened')
    await store.markSent('bracket')
    saves.mockClear()
    expect(await store.editNote('bracket', 'M1', { note: 'too thin here' })).toMatchObject({ status: 'sent' })
    expect(saves).not.toHaveBeenCalled()
  })

  it('is removed and put back whole', async () => {
    const added = await store.addNote('bracket', note())
    await store.addNote('bracket', note())
    await store.remove('bracket', 'M1')
    expect(ids(await store.list('bracket'))).toEqual(['M2'])
    expect(await store.restore('bracket', 'M1')).toEqual(added)
    expect(ids(await store.list('bracket'))).toEqual(['M1', 'M2'])
    expect((await store.list('bracket'))[0]).toEqual(added)
  })

  it('is resolved by the agent as any mark is, and nothing else of it changes: not its text, its ink or its files', async () => {
    const added = await store.addNote('bracket', note())
    const resolved = await store.update('bracket', 'M1', { status: 'resolved', resolvedNote: 'thickened to 3 mm' }, 'agent')
    expect(resolved).toEqual({ ...added, status: 'resolved', resolvedNote: 'thickened to 3 mm', resolvedBy: 'agent' })
    // What the agent is not given a tool for is not taken from a patch either: a note's files and ink are the person's alone (`editNote`).
    await expect(store.update('bracket', 'M1', { ink: 'n-ffffffffffff.ink.png', strokes: [] } as never, 'agent')).resolves.toMatchObject({ ink: (added as NoteMark).ink, strokes: (added as NoteMark).strokes })
  })

  it('has its anchor checked and its picture left alone by a check against a build', async () => {
    await store.addNote('bracket', note())
    const [mark] = await store.list('bracket')
    await store.reanchor('bracket', [{ id: 'M1', judged: [ANCHOR], anchors: [{ ...ANCHOR, ref: 'base/F9' }], anchorState: 'drifted', checkedRevision: 2 }])
    expect(await store.list('bracket')).toEqual([{ ...mark, anchor: { ...ANCHOR, ref: 'base/F9' }, anchorState: 'drifted', checkedRevision: 2 }])
  })
})

describe('a sketch', () => {
  const draft = (over: Partial<SketchDraft> = {}): SketchDraft => ({
    objectId: 'bracket',
    layout: 'assembly',
    revision: 3,
    camera: CAMERA as SketchDraft['camera'],
    name: 'Hose',
    note: 'route it here',
    take: 'flow',
    diameter: 19,
    planes: [{ id: 1, origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0', from: { kind: 'main', axis: 'XZ', offset: 40 } }],
    strokes: [{ plane: 1, pen: 'free', points2d: [[0, 0], [10, 0]], revision: 3 }, { pen: 'free', points: [[1, 2, 20], [2, 2, 20]], revision: 3 }],
    anchor: ANCHOR,
    ...over
  })

  it('is made when it has no id: the next number, a draft of the person, with what main worked out of its strokes', async () => {
    await store.add('bracket', pin())
    const made = (await store.saveSketch('bracket', draft(), [[], ['base/F4']])) as SketchMark
    expect(made).toMatchObject({ id: 'M2', kind: 'sketch', author: 'user', status: 'draft', anchorState: 'ok', name: 'Hose', take: 'flow', diameter: 19, createdAt: '2026-10-09T12:00:00.000Z' })
    expect(made.strokes.map((s) => s.touches)).toEqual([[], ['base/F4']])
    expect(onDisk('bracket')).toEqual({ next: 3, marks: [(await store.list('bracket'))[0], made] })
    expect(changes.at(-1)?.marks.at(-1)).toEqual(made)
  })

  it('is made with the intent the draft says, of the person\'s sketch only, and never changed by a later draft', async () => {
    const made = (await store.saveSketch('bracket', draft({ intent: 'dont' }))) as SketchMark
    expect(made.intent).toBe('dont')
    const again = (await store.saveSketch('bracket', { ...draft({ intent: 'want', name: 'Other' }), id: made.id })) as SketchMark
    expect(again).toMatchObject({ name: 'Other', intent: 'dont' })
    const agents = (await store.saveSketch('bracket', draft({ intent: 'dont' }), [], { author: 'agent' })) as SketchMark
    expect(agents).not.toHaveProperty('intent')
    const odd = (await store.saveSketch('bracket', draft({ intent: 'add' as never }))) as SketchMark
    expect(odd).not.toHaveProperty('intent')
  })

  it('takes the touches from main alone: a stroke given none by main has none, whatever the draft says', async () => {
    const strokes = draft().strokes.map((s, i) => ({ ...s, touches: [`window/F${i}`] }))
    const made = (await store.saveSketch('bracket', draft({ strokes }), [undefined, ['base/F9']])) as SketchMark
    expect(made.strokes.map((s) => s.touches)).toEqual([undefined, ['base/F9']])
  })

  it('keeps the touches of a stroke the sketch already had, identical, and no others', async () => {
    const made = (await store.saveSketch('bracket', draft(), [['base/F1'], ['base/F2']])) as SketchMark
    const more = { pen: 'free' as const, points: [[9, 9, 9]] as Array<[number, number, number]>, revision: 3, touches: ['window/F1'] }
    const changed = (await store.saveSketch('bracket', { ...draft(), id: made.id, strokes: [...made.strokes, more] }, [])) as SketchMark
    expect(changed.strokes.map((s) => s.touches)).toEqual([['base/F1'], ['base/F2'], undefined])
  })

  it('stores no touches and no snaps of the agent\'s strokes that main did not say', async () => {
    const strokes = [{ pen: 'points' as const, points: [[1, 2, 3], [4, 5, 6]] as Array<[number, number, number]>, snaps: [{ i: 0, vertex: 'base/V1' }], touches: ['window/F1'], revision: 3 }]
    const made = (await store.saveSketch('bracket', draft({ strokes }), [], { author: 'agent' })) as SketchMark
    expect(made.strokes[0]).not.toHaveProperty('touches')
    expect(made.strokes[0]).not.toHaveProperty('snaps')
    const told = (await store.saveSketch('bracket', draft({ strokes }), [['base/F4']], { author: 'agent' })) as SketchMark
    expect(told.strokes[0].touches).toEqual(['base/F4'])
    expect(told.strokes[0]).not.toHaveProperty('snaps')
  })

  it('is refused, for the caller to check again, when the sketch is no longer what the draft was checked against', async () => {
    const made = (await store.saveSketch('bracket', draft(), [[], []])) as SketchMark
    await store.reanchor('bracket', [{ id: made.id, judged: [ANCHOR], anchors: [{ ...ANCHOR, point: [1, 2, 25] }], anchorState: 'ok', shift: [0, 0, 5] }])
    await expect(store.saveSketch('bracket', { ...draft(), id: made.id }, [[], []], { from: made })).rejects.toBeInstanceOf(SketchChanged)
    const now = (await store.list('bracket'))[0] as SketchMark
    expect(await store.saveSketch('bracket', { ...draft(), id: made.id, note: 'again' }, [[], []], { from: now })).toMatchObject({ note: 'again' })
  })

  it('is refused when it is no sketch: a number too far gone, a plane that is not a frame', async () => {
    await expect(store.saveSketch('bracket', draft({ diameter: 600 }), [[], []])).rejects.toThrow(/sketch/)
    expect(await store.list('bracket')).toEqual([])
    await expect(store.saveSketch('bracket', draft({ planes: [{ id: 1, origin: [0, 0, 0], x: [1, 0, 0], y: [1, 1, 0], label: 'x', from: { kind: 'view', label: 'x' } }] }), [[], []])).rejects.toThrow(/sketch/)
    expect((await store.add('bracket', pin())).id).toBe('M1')
  })

  describe('stroke ids', () => {
    const idsOf = (m: Mark): string[] => (m as SketchMark).strokes.map((s) => s.id)
    const three = (): SketchDraft => draft({ strokes: [0, 1, 2].map((n) => ({ plane: 1, pen: 'free' as const, points2d: [[n, 0], [n, 10]] as Array<[number, number]>, revision: 3 })) })

    it('are k1, k2, k3 for a new sketch of three strokes, with nextStroke 4, whatever the window names', async () => {
      const made = (await store.saveSketch('bracket', three())) as SketchMark
      expect(idsOf(made)).toEqual(['k1', 'k2', 'k3'])
      expect(made.nextStroke).toBe(4)
      const named = (await store.saveSketch('bracket', { ...three(), strokes: three().strokes.map((s, n) => ({ ...s, id: `k${9 - n}` })) })) as SketchMark
      expect(idsOf(named)).toEqual(['k1', 'k2', 'k3'])
      expect(onDisk('bracket')).toMatchObject({ marks: [made, named] })
    })

    it('are kept by a stroke that stays, and an erase of k2 with one added gives k1, k3, k4', async () => {
      const made = (await store.saveSketch('bracket', three())) as SketchMark
      const [k1, , k3] = made.strokes
      const fresh = { plane: 1, pen: 'free' as const, points2d: [[7, 0], [7, 10]] as Array<[number, number]>, revision: 3 }
      const changed = (await store.saveSketch('bracket', { ...three(), id: made.id, strokes: [k1, k3, fresh] }, [])) as SketchMark
      expect(idsOf(changed)).toEqual(['k1', 'k3', 'k4'])
      expect(changed.nextStroke).toBe(5)
      expect(changed.strokes[1]).toEqual(k3)
    })

    it('are never given again: k2 sent again after its erase is a new stroke, k5', async () => {
      const made = (await store.saveSketch('bracket', three())) as SketchMark
      const [k1, k2, k3] = made.strokes
      const erased = (await store.saveSketch('bracket', { ...three(), id: made.id, strokes: [k1, k3] })) as SketchMark
      expect(idsOf(erased)).toEqual(['k1', 'k3'])
      expect(erased.nextStroke).toBe(4)
      // The window, with its own copy of the erased stroke, sends it again with the other: a new stroke.
      const again = (await store.saveSketch('bracket', { ...three(), id: made.id, strokes: [k1, k3, k2] })) as SketchMark
      expect(idsOf(again)).toEqual(['k1', 'k3', 'k4'])
      // Erasing the last and sending it again must not reuse its number either.
      const lastGone = (await store.saveSketch('bracket', { ...three(), id: made.id, strokes: [k1, k3] })) as SketchMark
      expect(lastGone.nextStroke).toBe(5)
      expect(idsOf(await store.saveSketch('bracket', { ...three(), id: made.id, strokes: [k1, k3, again.strokes[2]] }))).toEqual(['k1', 'k3', 'k5'])
    })

    it('a repeated id in a draft is kept once: the second stroke is new', async () => {
      const made = (await store.saveSketch('bracket', three())) as SketchMark
      const [k1] = made.strokes
      const twice = (await store.saveSketch('bracket', { ...three(), id: made.id, strokes: [k1, { ...k1 }] })) as SketchMark
      expect(idsOf(twice)).toEqual(['k1', 'k4'])
    })

    it('never take nextStroke from the draft, and keep it with an edit that adds nothing', async () => {
      const made = (await store.saveSketch('bracket', three())) as SketchMark
      const edit = await store.saveSketch('bracket', { ...three(), id: made.id, strokes: made.strokes, nextStroke: 1, note: 'again' } as SketchDraft)
      expect(edit).toMatchObject({ nextStroke: 4, note: 'again' })
      const fresh = (await store.saveSketch('bracket', { ...three(), nextStroke: 1 } as SketchDraft)) as SketchMark
      expect(fresh.nextStroke).toBe(4)
    })

    it('number the agent\'s strokes the same way, from its own sketch', async () => {
      const made = (await store.saveSketch('bracket', three(), [], { author: 'agent' })) as SketchMark
      expect(idsOf(made)).toEqual(['k1', 'k2', 'k3'])
      const replaced = (await store.saveSketch('bracket', { ...three(), id: made.id }, [], { author: 'agent' })) as SketchMark
      expect(idsOf(replaced)).toEqual(['k4', 'k5', 'k6'])
      expect(replaced.nextStroke).toBe(7)
    })

    it('are read from a file that has none, in order, and are the same after a restart', async () => {
      const made = (await store.saveSketch('bracket', three())) as SketchMark
      const old = JSON.parse(JSON.stringify(onDisk('bracket'))) as { marks: Array<Record<string, unknown>> }
      for (const stroke of old.marks[0].strokes as Array<Record<string, unknown>>) delete stroke.id
      delete old.marks[0].nextStroke
      writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), JSON.stringify(old))
      store.forget()
      const first = (await store.list('bracket'))[0] as SketchMark
      expect(idsOf(first)).toEqual(['k1', 'k2', 'k3'])
      expect(first.nextStroke).toBe(made.nextStroke)
      store.forget()
      expect((await store.list('bracket'))[0]).toEqual(first)
    })
  })

  it('is never added through add, which is what the window and the agent ask for', async () => {
    await expect(store.add('bracket', { ...BASE, ...draft(), kind: 'sketch' } as unknown as NewMark)).rejects.toThrow(/sketch/)
    expect(await store.list('bracket')).toEqual([])
  })

  it('is replaced when it has an id of a sketch of the person: the number, the creation and the picture stay', async () => {
    const made = await store.saveSketch('bracket', draft(), [[], []])
    await store.setSketchPicture('bracket', made.id, 'k-0123456789ab.png')
    const changed = (await store.saveSketch('bracket', { ...draft({ name: 'Hose, longer', take: 'exact', diameter: undefined, strokes: (made as SketchMark).strokes }), id: made.id }, [[], []])) as SketchMark
    expect(changed).toMatchObject({ id: 'M1', name: 'Hose, longer', take: 'exact', createdAt: made.createdAt, picture: 'k-0123456789ab.png', status: 'draft' })
    expect(changed).not.toHaveProperty('diameter')
    expect(await store.list('bracket')).toEqual([changed])
  })

  it('loses its picture, and lists it as dropped, when its planes or strokes change, so that it is drawn again', async () => {
    mkdirSync(join(dirs.bracket, '.torno', 'notes'), { recursive: true })
    const made = await store.saveSketch('bracket', draft(), [[], []])
    await store.setSketchPicture('bracket', made.id, 'k-aaaaaaaaaaaa.png')
    const more: SketchStroke = { id: 'k1', pen: 'free', points: [[3, 2, 20], [4, 2, 20]], revision: 3 }
    const changed = (await store.saveSketch('bracket', { ...draft({ strokes: [...draft().strokes, more] }), id: made.id }, [])) as SketchMark
    expect(changed).not.toHaveProperty('picture')
    expect(await droppedNames(dirs.bracket, ['notes'], isNoteFile)).toEqual(['k-aaaaaaaaaaaa.png'])
    expect(await store.withNoteFiles('bracket', async ({ live }) => [...live])).toEqual([])
  })

  it('is a draft again when it was sent, and says it was sent before, and that is what it asks to be checked for', async () => {
    const made = await store.saveSketch('bracket', draft(), [[], []])
    await store.markSent('bracket')
    const unchecked: string[][] = []
    store.on('unchecked', (u) => unchecked.push(u.ids))
    const changed = await store.saveSketch('bracket', { ...draft({ note: 'longer' }), id: made.id }, [[], []])
    expect(changed).toMatchObject({ status: 'draft', sentBefore: true, note: 'longer', anchorState: 'ok' })
    expect(unchecked).toEqual([['M1']])
  })

  it('is a draft again, reopened, when it was resolved', async () => {
    const made = await store.saveSketch('bracket', draft(), [[], []])
    await store.markSent('bracket')
    await store.update('bracket', made.id, { status: 'resolved' }, 'agent')
    const changed = await store.saveSketch('bracket', { ...draft({ note: 'again' }), id: made.id }, [[], []])
    expect(changed).toMatchObject({ status: 'draft', sentBefore: true, reopened: true })
    expect(changed).not.toHaveProperty('resolvedBy')
  })

  it('writes and tells nothing when the edit changes nothing', async () => {
    const made = (await store.saveSketch('bracket', draft(), [[], ['base/F4']])) as SketchMark
    saves.mockClear()
    changes = []
    const again = await store.saveSketch('bracket', { ...draft(), id: made.id, strokes: made.strokes }, [])
    expect(again).toEqual(made)
    expect(saves).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('refuses an id that is not a sketch of the person\'s: another kind, one the agent made, one that is not there', async () => {
    await store.add('bracket', pin())
    await expect(store.saveSketch('bracket', { ...draft(), id: 'M1' }, [[], []])).rejects.toThrow('M1 is a pin, not a sketch')
    const agents = await store.saveSketch('bracket', draft(), [[], []], { author: 'agent' })
    expect(agents).toMatchObject({ author: 'agent', status: 'sent' })
    await expect(store.saveSketch('bracket', { ...draft(), id: agents.id }, [[], []])).rejects.toThrow(/the agent's sketch/)
    await expect(store.saveSketch('bracket', { ...draft(), id: 'M9' }, [[], []])).rejects.toThrow('no mark M9')
  })

  it('may be replaced by the agent only when it is the agent\'s own, and is then not told to it again', async () => {
    const mine = await store.saveSketch('bracket', draft(), [[], []])
    const agents = await store.saveSketch('bracket', draft(), [[], []], { author: 'agent' })
    await expect(store.saveSketch('bracket', { ...draft(), id: mine.id }, [[], []], { author: 'agent' })).rejects.toThrow(/person's sketch/)
    const changed = await store.saveSketch('bracket', { ...draft({ name: 'Other route' }), id: agents.id }, [[], []], { author: 'agent' })
    expect(changed).toMatchObject({ id: agents.id, author: 'agent', status: 'sent', name: 'Other route' })
    expect(changed).not.toHaveProperty('sentBefore')
  })

  it('names itself Sketch and its number when the name is empty', async () => {
    expect(await store.saveSketch('bracket', draft({ name: '' }), [[], []])).toMatchObject({ name: 'Sketch M1' })
  })

  it('has its picture set apart from its edits: the one it replaces is listed as dropped, and nothing is told but the change', async () => {
    const made = await store.saveSketch('bracket', draft(), [[], []])
    mkdirSync(join(dirs.bracket, '.torno', 'notes'), { recursive: true })
    const first = await store.setSketchPicture('bracket', made.id, 'k-aaaaaaaaaaaa.png')
    expect(first).toMatchObject({ id: 'M1', picture: 'k-aaaaaaaaaaaa.png', status: 'draft' })
    expect(await droppedNames(dirs.bracket, ['notes'], isNoteFile)).toEqual([])
    await store.setSketchPicture('bracket', made.id, 'k-bbbbbbbbbbbb.png')
    expect(await droppedNames(dirs.bracket, ['notes'], isNoteFile)).toEqual(['k-aaaaaaaaaaaa.png'])
    await expect(store.setSketchPicture('bracket', made.id, 'n-bbbbbbbbbbbb.png')).rejects.toThrow(/picture/)
    await store.add('bracket', pin())
    await expect(store.setSketchPicture('bracket', 'M2', 'k-cccccccccccc.png')).rejects.toThrow('M2 is a pin, not a sketch')
  })

  it('does not send a draft back to the agent when only its picture was set', async () => {
    const made = await store.saveSketch('bracket', draft(), [[], []])
    await store.markSent('bracket')
    expect(await store.setSketchPicture('bracket', made.id, 'k-aaaaaaaaaaaa.png')).toMatchObject({ status: 'sent' })
  })

  it('is taken away and put back whole, with its picture, and its picture is not swept while it can come back', async () => {
    const made = await store.saveSketch('bracket', draft(), [[], ['base/F4']])
    const pictured = await store.setSketchPicture('bracket', made.id, 'k-aaaaaaaaaaaa.png')
    mkdirSync(join(dirs.bracket, '.torno', 'notes'), { recursive: true })
    await store.remove('bracket', made.id)
    expect(await store.list('bracket')).toEqual([])
    expect(await store.withNoteFiles('bracket', async ({ live, kept }) => ({ live: [...live], kept: [...kept] }))).toEqual({ live: [], kept: ['k-aaaaaaaaaaaa.png'] })
    expect(await droppedNames(dirs.bracket, ['notes'], isNoteFile)).toEqual(['k-aaaaaaaaaaaa.png'])
    expect(await store.restore('bracket', made.id)).toEqual(pictured)
    expect(await store.list('bracket')).toEqual([pictured])
  })

  it('names its picture as live, and the one it replaced as no longer', async () => {
    const made = await store.saveSketch('bracket', draft(), [[], []])
    await store.setSketchPicture('bracket', made.id, 'k-aaaaaaaaaaaa.png')
    expect(await store.withNoteFiles('bracket', async ({ live }) => [...live])).toEqual(['k-aaaaaaaaaaaa.png'])
    await store.setSketchPicture('bracket', made.id, 'k-bbbbbbbbbbbb.png')
    expect(await store.withNoteFiles('bracket', async ({ live }) => [...live])).toEqual(['k-bbbbbbbbbbbb.png'])
  })
})

describe('a review', () => {
  const OF = { layout: 'assembly', build: 'h41', sources: 'abc123', line: 'check the lid' }
  const NEXT = { layout: 'assembly', build: 'h42', sources: 'def456', line: 'check the lid again' }
  const aNote = (): NewNote =>
    ({ ...BASE, note: 'too thin', kind: 'note', anchor: ANCHOR, picture: 'n-0123456789ab.png', ink: 'n-0123456789ab.ink.png', size: { w: 8, h: 6 }, strokes: [], inkColour: '#ff00ff', labels: [], under: [], references: [] }) as unknown as NewNote
  const pick = (over: object = {}): NewMark => ({ ...BASE, kind: 'pick', target: 'face', anchor: ANCHOR, ...over }) as NewMark
  const sketch = (over: Partial<SketchDraft> = {}): SketchDraft => ({
    objectId: 'bracket',
    layout: 'assembly',
    revision: 3,
    camera: CAMERA as SketchDraft['camera'],
    name: 'Hose',
    note: '',
    take: 'rough',
    planes: [],
    strokes: [{ pen: 'free', points: [[1, 2, 20], [2, 2, 20]], revision: 3 }],
    anchor: ANCHOR,
    ...over
  })
  /** A mark of the person's in round R1 that the agent resolved and R1's prompt carried. */
  async function answered(intent: 'want' | 'dont' = 'dont'): Promise<Mark> {
    await store.startRound('bracket', OF)
    const made = await store.add('bracket', pick({ intent }))
    await store.endRound('bracket', 'R1')
    await store.sendRound('bracket', 'R1')
    await store.markSent('bracket')
    await store.roundSent('bracket', 'R1')
    return store.update('bracket', made.id, { status: 'resolved', resolvedNote: 'thicker now' }, 'agent')
  }

  describe('a mark made in a round', () => {
    it('is in the open round of its layout', async () => {
      await store.startRound('bracket', OF)
      expect(await store.add('bracket', pick({ intent: 'dont' }))).toMatchObject({ round: 'R1', intent: 'dont' })
      expect((await store.addNote('bracket', aNote())) as Mark).toMatchObject({ round: 'R1' })
      expect(await store.saveSketch('bracket', sketch())).toMatchObject({ round: 'R1' })
    })

    it('is in none when it was made in another layout, before the round, or by the agent', async () => {
      expect((await store.add('bracket', pick())).round).toBeUndefined()
      await store.startRound('bracket', OF)
      expect((await store.add('bracket', pick({ layout: 'print' }))).round).toBeUndefined()
      expect((await store.add('bracket', pick({ author: 'agent' }), 'sent')).round).toBeUndefined()
      expect((await store.saveSketch('bracket', sketch({ layout: 'print' }))).round).toBeUndefined()
      expect((await store.saveSketch('bracket', sketch(), [], { author: 'agent' })).round).toBeUndefined()
    })

    it('is in none once the round has ended', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      await store.endRound('bracket', 'R1')
      expect((await store.add('bracket', pick())).round).toBeUndefined()
    })

    it("takes no round and no judgment from the window's mark, and no review intent from the agent", async () => {
      const made = await store.add('bracket', pick({ round: 'R7', judged: { verdict: 'ok', build: 'h9' } }))
      expect(made).not.toHaveProperty('round')
      expect(made).not.toHaveProperty('judged')
      expect(await store.add('bracket', pick({ author: 'agent', intent: 'want' }), 'sent')).not.toHaveProperty('intent')
      await store.startRound('bracket', OF)
      const inRound = await store.add('bracket', pick({ round: 'R7', judged: { verdict: 'ok', build: 'h9' } }))
      expect(inRound).toMatchObject({ round: 'R1' })
      expect(inRound).not.toHaveProperty('judged')
    })
  })

  describe('want and don\'t want', () => {
    it('is set on a mark of the person\'s, and taken away', async () => {
      await store.add('bracket', pick())
      expect(await store.setIntent('bracket', 'M1', 'dont')).toMatchObject({ intent: 'dont', status: 'draft' })
      expect(await store.setIntent('bracket', 'M1', 'want')).toMatchObject({ intent: 'want' })
      expect(await store.setIntent('bracket', 'M1', null)).not.toHaveProperty('intent')
    })

    it('never puts the mark in a round', async () => {
      await store.add('bracket', pick())
      await store.startRound('bracket', OF)
      expect(await store.setIntent('bracket', 'M1', 'want')).not.toHaveProperty('round')
    })

    it('makes a sent mark a draft again, told as changed', async () => {
      await store.add('bracket', pick())
      await store.markSent('bracket')
      expect(await store.setIntent('bracket', 'M1', 'dont')).toMatchObject({ status: 'draft', sentBefore: true, intent: 'dont' })
    })

    it('says nothing and writes nothing when it is what it was', async () => {
      await store.add('bracket', pick({ intent: 'want' }))
      saves.mockClear()
      expect(await store.setIntent('bracket', 'M1', 'want')).toMatchObject({ intent: 'want' })
      expect(saves).not.toHaveBeenCalled()
    })

    it('is add or remove on a shape, and its other intents are not for this', async () => {
      await store.add('bracket', shape())
      expect(await store.setIntent('bracket', 'M1', 'dont')).toMatchObject({ intent: 'remove' })
      expect(await store.setIntent('bracket', 'M1', 'want')).toMatchObject({ intent: 'add' })
      await expect(store.setIntent('bracket', 'M1', null)).rejects.toThrow('M1 is a shape: keep-out and reference are set in its fields')
    })

    it('is refused for a mark of the agent\'s, and for a mark that is not there', async () => {
      await store.add('bracket', pick({ author: 'agent' }), 'sent')
      await expect(store.setIntent('bracket', 'M1', 'want')).rejects.toThrow("M1 is the agent's mark")
      await expect(store.setIntent('bracket', 'M9', 'want')).rejects.toThrow('no mark M9')
    })
  })

  describe('a round', () => {
    it('is started on the build, once: asking again gives the one that is open', async () => {
      const first = await store.startRound('bracket', OF)
      expect(first).toEqual({ id: 'R1', ...OF, startedAt: '2026-10-09T12:00:00.000Z' })
      expect(await store.startRound('bracket', { ...OF, build: 'h50' })).toEqual(first)
      expect((await store.rounds('bracket')).rounds).toEqual([first])
      expect(onDisk('bracket')).toMatchObject({ rounds: [first], nextRound: 2 })
    })

    it('is told with the rounds and what is being sent', async () => {
      const round = await store.startRound('bracket', OF)
      expect(changes.at(-1)).toEqual({ objectId: 'bracket', marks: [], rounds: [round], sending: null })
    })

    it('is refused when it is not of a build', async () => {
      await expect(store.startRound('bracket', { ...OF, build: '' })).rejects.toThrow('a round is of')
      await expect(store.startRound('bracket', null as never)).rejects.toThrow('a round is of')
    })

    it('is dropped when it ends with no items, and its number is not given again', async () => {
      await store.startRound('bracket', OF)
      await store.endRound('bracket', 'R1')
      expect((await store.rounds('bracket')).rounds).toEqual([])
      expect((await store.startRound('bracket', OF)).id).toBe('R2')
      await store.endRound('bracket', 'R2')
      expect((await store.startRound('bracket', OF)).id).toBe('R3')
      // And the next run: the number is in the file.
      store.forget()
      expect((await store.startRound('bracket', OF)).id).toBe('R3')
    })

    it('ends with its items, which stay drafts, and is reopened while unsent', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick({ intent: 'dont' }))
      const ended = await store.endRound('bracket', 'R1')
      expect(ended.endedAt).toBe('2026-10-09T12:00:00.000Z')
      expect((await store.list('bracket'))[0]).toMatchObject({ status: 'draft', round: 'R1', intent: 'dont' })
      const reopened = await store.reopenRound('bracket', 'R1')
      expect(reopened).not.toHaveProperty('endedAt')
      expect(await store.startRound('bracket', OF)).toEqual(reopened)
    })

    it('is not reopened while another is open, or once it was sent; one id that is not there is refused', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      await store.endRound('bracket', 'R1')
      await store.startRound('bracket', OF)
      await expect(store.reopenRound('bracket', 'R1')).rejects.toThrow('R2 is open')
      await store.endRound('bracket', 'R2')
      await store.sendRound('bracket', 'R1')
      await store.roundSent('bracket', 'R1')
      await expect(store.reopenRound('bracket', 'R1')).rejects.toThrow('R1 was sent')
      await expect(store.endRound('bracket', 'R9')).rejects.toThrow('no round R9; rounds: R1')
    })

    it('is being sent from sendRound until it is sent, and told so', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      const sending = await store.sendRound('bracket', 'R1')
      expect(sending.endedAt).toBeDefined()
      expect(sending.sentAt).toBeUndefined()
      expect(await store.rounds('bracket')).toEqual({ rounds: [sending], sending: 'R1' })
      expect(changes.at(-1)).toMatchObject({ sending: 'R1' })
      const sent = await store.roundSent('bracket', 'R1')
      expect(sent.sentAt).toBe('2026-10-09T12:00:00.000Z')
      expect((await store.rounds('bracket')).sending).toBeNull()
      expect(changes.at(-1)).toMatchObject({ sending: null })
    })

    it('is told being sent again, when it was ended already, and forgets it with the workspace', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      await store.endRound('bracket', 'R1')
      const told = changes.length
      await store.sendRound('bracket', 'R1')
      expect(changes).toHaveLength(told + 1)
      store.forget()
      expect((await store.rounds('bracket')).sending).toBeNull()
    })

    it('is not sent with nothing in it, nor twice', async () => {
      await store.startRound('bracket', OF)
      await expect(store.sendRound('bracket', 'R1')).rejects.toThrow('R1 has no items')
      expect((await store.rounds('bracket')).sending).toBeNull()
      await store.add('bracket', pick())
      await store.sendRound('bracket', 'R1')
      await store.roundSent('bracket', 'R1')
      await expect(store.sendRound('bracket', 'R1')).rejects.toThrow('R1 was sent already')
    })

    it('is let go as plain marks: ended, unsent, its items no longer held', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      await store.sendRound('bracket', 'R1')
      const plain = await store.plainRound('bracket', 'R1')
      expect(plain.plain).toBe('2026-10-09T12:00:00.000Z')
      expect(plain.endedAt).toBeDefined()
      const view = await store.rounds('bracket')
      expect(view.sending).toBeNull()
      expect(isHeld((await store.list('bracket'))[0], view)).toBe(false)
    })

    it('is never dropped once it was sent, however empty', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      await store.endRound('bracket', 'R1')
      await store.sendRound('bracket', 'R1')
      await store.roundSent('bracket', 'R1')
      await store.remove('bracket', 'M1')
      expect(await store.endRound('bracket', 'R1')).toMatchObject({ id: 'R1', sentAt: expect.any(String) })
      expect((await store.rounds('bracket')).rounds.map((r) => r.id)).toEqual(['R1'])
      await expect(store.plainRound('bracket', 'R1')).rejects.toThrow('R1 was sent already')
    })

    it('is kept, empty, while an undo can still bring back its item', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      await store.remove('bracket', 'M1')
      await store.endRound('bracket', 'R1')
      expect((await store.rounds('bracket')).rounds.map((r) => r.id)).toEqual(['R1'])
      const back = await store.restore('bracket', 'M1')
      expect(back.round).toBe('R1')
      expect(isHeld(back, await store.rounds('bracket'))).toBe(true)
    })

    it('is dropped, empty, when what was removed is not from it', async () => {
      await store.add('bracket', pick())
      await store.startRound('bracket', OF)
      await store.remove('bracket', 'M1')
      await store.endRound('bracket', 'R1')
      expect((await store.rounds('bracket')).rounds).toEqual([])
    })

    it('has its items taken out one at a time', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      expect(await store.roundOut('bracket', 'M1')).not.toHaveProperty('round')
      await expect(store.roundOut('bracket', 'M1')).rejects.toThrow('M1 is in no round')
    })
  })

  describe('a verdict', () => {
    it('OK is kept, with the build, and acknowledges the mark', async () => {
      const resolved = await answered()
      const judged = await store.judge('bracket', resolved.id, 'ok', { build: 'h42', next: NEXT })
      expect(judged).toMatchObject({ status: 'resolved', acknowledged: true, judged: { verdict: 'ok', build: 'h42' }, round: 'R1' })
      expect((await store.rounds('bracket')).rounds).toHaveLength(1)
    })

    it('Still wrong makes the mark a draft again, in a next round that is ended, unsent and holds it', async () => {
      const resolved = await answered()
      const wrong = await store.judge('bracket', resolved.id, 'still-wrong', { build: 'h42', note: 'still thin', next: NEXT })
      expect(wrong).toMatchObject({ status: 'draft', reopened: true, sentBefore: true, round: 'R2', judged: { verdict: 'still-wrong', build: 'h42' } })
      expect(wrong).not.toHaveProperty('resolvedBy')
      expect(wrong).not.toHaveProperty('acknowledged')
      expect(wrong.note).toBe('Still wrong in h42: still thin')
      const view = await store.rounds('bracket')
      expect(view.rounds[1]).toEqual({ id: 'R2', ...NEXT, startedAt: '2026-10-09T12:00:00.000Z', endedAt: '2026-10-09T12:00:00.000Z', from: 'R1' })
      expect(isHeld(wrong, view)).toBe(true)
      expect(openRound(view.rounds)).toBeUndefined()
    })

    it('keeps all of what it says when the note is too long for both, and cuts the end of the old note', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick({ note: 'n'.repeat(1995) }))
      await store.endRound('bracket', 'R1')
      await store.sendRound('bracket', 'R1')
      await store.markSent('bracket')
      await store.roundSent('bracket', 'R1')
      await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
      const { note } = await store.judge('bracket', 'M1', 'still-wrong', { build: 'h42', note: 'still thin', next: NEXT })
      expect(note).toHaveLength(2000)
      expect(note.endsWith(' Still wrong in h42: still thin')).toBe(true)
      expect(note.startsWith('nnnn')).toBe(true)
    })

    it('puts what it says after the note, and goes into the same next round for the next one', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick({ note: 'too thin' }))
      await store.add('bracket', pick({ note: 'bad hole' }))
      await store.endRound('bracket', 'R1')
      await store.sendRound('bracket', 'R1')
      await store.markSent('bracket')
      await store.roundSent('bracket', 'R1')
      for (const id of ['M1', 'M2']) await store.update('bracket', id, { status: 'resolved' }, 'agent')
      expect((await store.judge('bracket', 'M1', 'still-wrong', { build: 'h42', note: 'still', next: NEXT })).note).toBe('too thin Still wrong in h42: still')
      expect((await store.judge('bracket', 'M2', 'still-wrong', { build: 'h42', next: NEXT })).note).toBe('bad hole Still wrong in h42')
      const { rounds } = await store.rounds('bracket')
      expect(rounds.map((r) => r.id)).toEqual(['R1', 'R2'])
      expect(roundItems(await store.list('bracket'), 'R2').map((m) => m.id)).toEqual(['M1', 'M2'])
    })

    it('goes into the next round when that was opened (carried on) already', async () => {
      const resolved = await answered()
      const carried = await store.carryRound('bracket', 'R1', NEXT)
      expect(carried).toMatchObject({ id: 'R2', from: 'R1' })
      expect(carried).not.toHaveProperty('endedAt')
      expect((await store.judge('bracket', resolved.id, 'still-wrong', { build: 'h42', next: NEXT })).round).toBe('R2')
      expect((await store.rounds('bracket')).rounds).toHaveLength(2)
    })

    it('goes into a fresh round when the one it carried into was let go as plain marks, so that it is held', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      await store.add('bracket', pick())
      await store.endRound('bracket', 'R1')
      await store.sendRound('bracket', 'R1')
      await store.markSent('bracket')
      await store.roundSent('bracket', 'R1')
      for (const id of ['M1', 'M2']) await store.update('bracket', id, { status: 'resolved' }, 'agent')
      await store.judge('bracket', 'M1', 'still-wrong', { build: 'h42', next: NEXT })
      await store.plainRound('bracket', 'R2')
      const wrong = await store.judge('bracket', 'M2', 'still-wrong', { build: 'h43', next: { ...NEXT, build: 'h43' } })
      expect(wrong.round).toBe('R3')
      const view = await store.rounds('bracket')
      expect(view.rounds[2]).toMatchObject({ id: 'R3', from: 'R1', build: 'h43', endedAt: expect.any(String) })
      expect(view.rounds[2]).not.toHaveProperty('sentAt')
      expect(view.rounds[2]).not.toHaveProperty('plain')
      expect(isHeld(wrong, view)).toBe(true)
    })

    it('is for a mark the agent resolved, that is in a round that was sent', async () => {
      await store.startRound('bracket', OF)
      await store.add('bracket', pick())
      await expect(store.judge('bracket', 'M1', 'ok', { build: 'h42', next: NEXT })).rejects.toThrow('M1 was not resolved by the agent')
      await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
      await expect(store.judge('bracket', 'M1', 'ok', { build: 'h42', next: NEXT })).rejects.toThrow('M1 is in no round that was sent')
      await store.add('bracket', pick({ author: 'agent' }), 'sent')
      await store.update('bracket', 'M2', { status: 'resolved' }, 'agent')
      await expect(store.judge('bracket', 'M2', 'ok', { build: 'h42', next: NEXT })).rejects.toThrow('M2 is in no round that was sent')
      await expect(store.judge('bracket', 'M1', 'fine' as never, { build: 'h42', next: NEXT })).rejects.toThrow('not a verdict')
    })

    it('is set by the verdict alone: OK all and the acknowledge of the list leave it unset', async () => {
      const resolved = await answered()
      const [acknowledged] = await store.acknowledge('bracket', [resolved.id])
      expect(acknowledged).toMatchObject({ acknowledged: true, round: 'R1' })
      expect(acknowledged).not.toHaveProperty('judged')
      expect(await store.update('bracket', resolved.id, { acknowledged: true })).not.toHaveProperty('judged')
    })

    it('is not lost when the mark is sent again, and the round is not either', async () => {
      const resolved = await answered()
      await store.judge('bracket', resolved.id, 'still-wrong', { build: 'h42', next: NEXT })
      await store.markSent('bracket', [resolved.id])
      expect((await store.list('bracket'))[0]).toMatchObject({ status: 'sent', judged: { verdict: 'still-wrong', build: 'h42' }, round: 'R2' })
    })
  })

  describe('carrying on', () => {
    it('opens the round the Still wrong items were moved into, or makes one on the build', async () => {
      const resolved = await answered()
      await store.judge('bracket', resolved.id, 'still-wrong', { build: 'h42', next: NEXT })
      const opened = await store.carryRound('bracket', 'R1', NEXT)
      expect(opened).toMatchObject({ id: 'R2', from: 'R1', build: 'h42' })
      expect(opened).not.toHaveProperty('endedAt')
      expect((await store.rounds('bracket')).rounds).toHaveLength(2)
    })

    it('makes the next round on the build when nothing was carried, and has the one open from then on', async () => {
      await answered('want')
      const made = await store.carryRound('bracket', 'R1', NEXT)
      expect(made).toEqual({ id: 'R2', ...NEXT, from: 'R1', startedAt: '2026-10-09T12:00:00.000Z' })
      expect(await store.carryRound('bracket', 'R1', { ...NEXT, build: 'h60' })).toEqual(made)
    })

    it('makes a new round when the one it carried into was let go as plain marks or sent', async () => {
      const resolved = await answered()
      await store.judge('bracket', resolved.id, 'still-wrong', { build: 'h42', next: NEXT })
      await store.plainRound('bracket', 'R2')
      expect(await store.carryRound('bracket', 'R1', { ...NEXT, build: 'h43' })).toMatchObject({ id: 'R3', from: 'R1', build: 'h43' })
    })

    it('is refused while another round is open', async () => {
      await answered()
      await store.startRound('bracket', NEXT)
      await expect(store.carryRound('bracket', 'R1', NEXT)).rejects.toThrow('R2 is open')
      await expect(store.carryRound('bracket', 'R9', NEXT)).rejects.toThrow('no round R9')
    })
  })

  describe('an item taken away and put back', () => {
    it('comes back with its round, its intent and its judgment, and the round counts what it did', async () => {
      const resolved = await answered('dont')
      await store.judge('bracket', resolved.id, 'ok', { build: 'h42', next: NEXT })
      const before = roundCounts(await store.list('bracket'), 'R1')
      expect(before).toEqual({ dont: 1, want: 0, plain: 0 })
      await store.remove('bracket', resolved.id)
      expect(roundCounts(await store.list('bracket'), 'R1')).toEqual({ dont: 0, want: 0, plain: 0 })
      const back = await store.restore('bracket', resolved.id)
      expect(back).toMatchObject({ round: 'R1', intent: 'dont', judged: { verdict: 'ok', build: 'h42' } })
      expect(roundCounts(await store.list('bracket'), 'R1')).toEqual(before)
      expect(onDisk('bracket').marks[0]).toMatchObject({ round: 'R1', intent: 'dont', judged: { verdict: 'ok', build: 'h42' } })
    })
  })

  it('is kept in marks.json, and is there in the next run', async () => {
    await store.startRound('bracket', OF)
    await store.add('bracket', pick({ intent: 'want' }))
    await store.sendRound('bracket', 'R1')
    store.forget()
    const again = newStore()
    expect(await again.rounds('bracket')).toEqual({ rounds: [expect.objectContaining({ id: 'R1', endedAt: expect.any(String) })], sending: null })
    expect((await again.list('bracket'))[0]).toMatchObject({ round: 'R1', intent: 'want' })
  })
})
