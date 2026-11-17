import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArrowMark, DimensionMark, Mark, MarksFile, NoteMark, PickMark, PinMark, ShapeMark, SketchMark, SpanMark, StrokeMark } from '../../shared/marks'
import { markAnchors } from '../../shared/marks'
import * as atomic from '../atomic'
import { loadMarksFile, MAX_NOTE, MAX_STROKE_POINTS, sanitiseMark, sanitiseMarksFile, saveMarksFile } from './file'

// The real writes, which a test can have fail once.
vi.mock('../atomic', async (importActual) => {
  const actual = await importActual<typeof import('../atomic')>()
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) }
})
const writes = vi.mocked(atomic.writeFileAtomic)

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const

const BASE = {
  author: 'user',
  note: 'too thin here',
  status: 'draft',
  anchorState: 'ok',
  layout: 'assembly',
  revision: 3,
  camera: { ...CAMERA, position: [...CAMERA.position], target: [...CAMERA.target], up: [...CAMERA.up] },
  createdAt: '2026-10-09T10:00:00.000Z'
} as const

const ANCHOR = { point: [1, 2, 20], normal: [0, 0, 1], part: 'base', ref: 'base/F4', descriptor: 'plane, normal +Z, z = 20, 1180 mm²' }

const pin = (over: object = {}): PinMark => ({ ...BASE, id: 'M1', kind: 'pin', anchor: ANCHOR, ...over }) as PinMark
const pick: PickMark = { ...BASE, id: 'M2', kind: 'pick', target: 'face', anchor: ANCHOR } as PickMark
const arrow: ArrowMark = { ...BASE, id: 'M3', kind: 'arrow', from: ANCHOR, to: [1, 2, 32] } as ArrowMark
const surfaceStroke: StrokeMark = { ...BASE, id: 'M4', kind: 'stroke', space: 'surface', anchor: ANCHOR, points: [[1, 2, 20], [2, 2, 20], [3, 3, 20]] } as StrokeMark
const planeStroke: StrokeMark = {
  ...BASE,
  id: 'M5',
  kind: 'stroke',
  space: 'plane',
  anchor: { point: [0, 40, 0] },
  plane: { origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0' },
  points2d: [[0, 0], [10, 0], [10, 5]]
} as StrokeMark
const shape: ShapeMark = {
  ...BASE,
  id: 'M6',
  author: 'agent',
  status: 'resolved',
  anchorState: 'drifted',
  resolvedNote: 'made it 4 mm',
  kind: 'shape',
  shape: 'cylinder',
  intent: 'remove',
  position: [5, 5, 10],
  rotation: [0, 0, 0, 1],
  size: [6, 6, 20]
} as ShapeMark

const ALL: Mark[] = [pin(), pick, arrow, surfaceStroke, planeStroke, shape]

let dir: string
const path = (): string => join(dir, '.torno', 'marks.json')
const NOW = (): Date => new Date('2026-10-09T12:34:56.789Z')

function writeRaw(text: string): void {
  mkdirSync(join(dir, '.torno'), { recursive: true })
  writeFileSync(path(), text)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-marks-file-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('marks file', () => {
  it('round trips every kind of mark, creating .torno/ on demand', async () => {
    const file: MarksFile = { next: 7, marks: ALL }
    await saveMarksFile(dir, file)
    expect(await loadMarksFile(dir)).toEqual({ file })
    expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual(file)
  })

  it('an atomic write leaves no temp file, and nothing outside .torno/', async () => {
    await Promise.all([saveMarksFile(dir, { next: 2, marks: [pin()] }), saveMarksFile(dir, { next: 3, marks: [pin(), { ...pick }] })])
    expect(readdirSync(dir)).toEqual(['.torno'])
    expect(readdirSync(join(dir, '.torno'))).toEqual(['marks.json'])
    // Saves of one file land in the order they were made.
    expect((await loadMarksFile(dir)).file.next).toBe(3)
  })

  it('a missing file is an empty list, and nothing is written', async () => {
    expect(await loadMarksFile(dir)).toEqual({ file: { next: 1, marks: [] } })
    expect(readdirSync(dir)).toEqual([])
  })

  it.each([
    ['half a file', '{"next": 3, "marks": [{"id"', 3],
    ['not a marks file', '[1, 2]', 1],
    ['marks that are not a list', '{"next": 3, "marks": {}}', 3],
    ['half a file whose next is behind its marks', '{"next": 2, "marks": [{"id": "M6", "kind": "pin"}, {"id": "M4"', 7],
    ['a file cut before its marks, with next last', '{"marks": {"id": "M2"}, "next": 12', 12]
  ])('a corrupt file (%s) is kept aside and a fresh one started, past the ids the old one gave out', async (_what, text, next) => {
    writeRaw(text)
    const loaded = await loadMarksFile(dir, NOW)
    expect(loaded.file).toEqual({ next, marks: [] })
    const aside = 'marks.json.corrupt-2026-10-09T12-34-56-789Z'
    expect(readdirSync(join(dir, '.torno')).sort()).toEqual(['marks.json', aside])
    expect(readFileSync(join(dir, '.torno', aside), 'utf8')).toBe(text)
    expect(loaded.problem).toContain(`.torno/${aside}`)
    // The fresh file is written at once, so the ids are safe whatever happens next; the problem is told once.
    expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual({ next, marks: [] })
    expect(await loadMarksFile(dir, NOW)).toEqual({ file: { next, marks: [] } })
  })

  it('a corrupt file whose fresh file cannot be written is still there to be read again: its ids are not lost', async () => {
    const text = '{"next": 7, "marks": ['
    writeRaw(text)
    writes.mockRejectedValueOnce(new Error('disk full'))
    await expect(loadMarksFile(dir, NOW)).rejects.toThrow('disk full')
    // The bad file is where it was, and a copy of it aside.
    expect(readFileSync(path(), 'utf8')).toBe(text)
    const loaded = await loadMarksFile(dir, NOW)
    expect(loaded.file).toEqual({ next: 7, marks: [] })
    expect(loaded.problem).toContain('.torno/marks.json.corrupt-2026-10-09T12-34-56-789Z')
    expect(readFileSync(join(dir, '.torno', 'marks.json.corrupt-2026-10-09T12-34-56-789Z'), 'utf8')).toBe(text)
  })

  it('keeps the whole marks of a file that has others, sets the file as it was aside, and says how many were left out', async () => {
    const text = JSON.stringify({
      next: 9,
      marks: [
        pin(),
        { ...pin(), id: 'M2', kind: 'dimension' },
        { ...pin(), id: 'M3', anchor: { point: [1, null, 3] } },
        { ...pin(), id: 'M4', revision: 'three' },
        { ...pin(), id: 'four' },
        null,
        { ...shape, id: 'M5', extra: true }
      ]
    })
    writeRaw(text)
    const { file, problem } = await loadMarksFile(dir, NOW)
    expect(file).toEqual({ next: 9, marks: [pin(), { ...shape, id: 'M5' }] })
    const aside = 'marks.json.dropped-2026-10-09T12-34-56-789Z'
    expect(problem).toContain('5 marks')
    expect(problem).toContain(`.torno/${aside}`)
    expect(readFileSync(join(dir, '.torno', aside), 'utf8')).toBe(text)
    // The file now holds what was kept, so the next read has nothing to say and makes no second copy.
    expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual(file)
    expect(await loadMarksFile(dir, () => new Date('2026-10-10T00:00:00.000Z'))).toEqual({ file })
    expect(readdirSync(join(dir, '.torno')).sort()).toEqual(['marks.json', aside])
  })

  it('says it of one mark in the singular, and a stray field alone is nothing to say', async () => {
    writeRaw(JSON.stringify({ next: 3, marks: [pin(), { ...pin(), id: 'M2', kind: 'region' }] }))
    expect((await loadMarksFile(dir, NOW)).problem).toMatch(/^1 mark in the marks file of this project was /)
    writeRaw(JSON.stringify({ next: 2, marks: [{ ...pin(), extra: 1 }] }))
    expect(await loadMarksFile(dir, NOW)).toEqual({ file: { next: 2, marks: [pin()] } })
  })

  it('never gives the id of a mark it left out to another, whatever the file says of next', async () => {
    writeRaw(JSON.stringify({ next: 2, marks: [pin(), { ...pin(), id: 'M8', kind: 'dimension' }, { id: 'M11' }, { id: 'M99999999999999999999999' }] }))
    const { file } = await loadMarksFile(dir, NOW)
    expect(file).toEqual({ next: 12, marks: [pin()] })
    // A file whose marks are all of kinds this version does not know is not emptied without a copy.
    writeRaw(JSON.stringify({ next: 3, marks: [{ ...pin(), kind: 'dimension' }, { ...pin(), id: 'M2', kind: 'dimension' }] }))
    const all = await loadMarksFile(dir, () => new Date('2026-10-11T00:00:00.000Z'))
    expect(all.file).toEqual({ next: 3, marks: [] })
    expect(readdirSync(join(dir, '.torno'))).toContain('marks.json.dropped-2026-10-11T00-00-00-000Z')
  })

  it('never hands out an id again: next is past every id in the file, whatever the file says', async () => {
    writeRaw(JSON.stringify({ next: 1, marks: [pin({ id: 'M7' }), pin({ id: 'M7', note: 'the same id twice' })] }))
    const { file } = await loadMarksFile(dir)
    expect(file.next).toBe(8)
    expect(file.marks.map((m) => m.note)).toEqual(['too thin here'])
    writeRaw(JSON.stringify({ marks: [] }))
    expect((await loadMarksFile(dir)).file).toEqual({ next: 1, marks: [] })
  })

  it('reads a file written before marks said who resolved them or what they were checked against, as it is and with nothing to say', async () => {
    // Every kind, none with resolvedBy, acknowledged, sentBefore, checkedRevision, or an anchor with arranged, edge or between.
    const old = `${JSON.stringify({ next: 7, marks: ALL }, null, 2)}\n`
    mkdirSync(join(dir, '.torno'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'marks.json'), old)
    writes.mockClear()
    const loaded = await loadMarksFile(dir)
    expect(loaded).toEqual({ file: { next: 7, marks: ALL } })
    expect(loaded.problem).toBeUndefined()
    // Nothing rewritten, nothing set aside.
    expect(writes).not.toHaveBeenCalled()
    expect(readdirSync(join(dir, '.torno'))).toEqual(['marks.json'])
    expect(readFileSync(join(dir, '.torno', 'marks.json'), 'utf8')).toBe(old)
  })

  it('round trips what main says of a mark, and what an anchor says of an edge and of the spread of its part', async () => {
    const onEdge = { ...ANCHOR, ref: 'base/E5', edge: 'base/E5', between: ['base/F1', 'base/F4'], arranged: [35, 0, 0] }
    const marks = [
      pin({ anchor: onEdge, status: 'sent', sentBefore: true, checkedRevision: 12 }),
      pin({ id: 'M4', status: 'draft', sentBefore: true, reopened: true }),
      { ...pick, id: 'M2', status: 'resolved', resolvedBy: 'agent', acknowledged: true, resolvedNote: 'done' },
      { ...arrow, id: 'M3', status: 'resolved', resolvedBy: 'user' }
    ] as Mark[]
    await saveMarksFile(dir, { next: 5, marks })
    expect((await loadMarksFile(dir)).file.marks).toEqual(marks)
  })

  it('keeps of those only what they can be', () => {
    const odd = sanitiseMark(pin({ sentBefore: 'yes', reopened: 'yes', checkedRevision: '12', resolvedBy: 'agent', acknowledged: true, anchor: { ...ANCHOR, arranged: [0, 0], edge: 5, between: ['base/F1'] } }))
    // A draft is resolved by nobody; a spread is three numbers; one face is not two.
    expect(odd).toEqual(pin())
    // Only a draft is one the person reopened and the agent has not been told of since.
    expect(sanitiseMark(pin({ status: 'sent', reopened: true }))).toEqual(pin({ status: 'sent' }))
    expect(sanitiseMark(pin({ status: 'resolved', reopened: true }))).toEqual(pin({ status: 'resolved' }))
    // A part that was not moved says so: that is not the same as saying nothing.
    expect(sanitiseMark(pin({ anchor: { ...ANCHOR, arranged: [0, 0, 0] } }))).toEqual(pin({ anchor: { ...ANCHOR, arranged: [0, 0, 0] } }))
    expect(sanitiseMark(pin({ status: 'resolved', resolvedBy: 'someone', acknowledged: true }))).toEqual(pin({ status: 'resolved' }))
    // Only a mark the agent resolved can have been acknowledged.
    expect(sanitiseMark(pin({ status: 'resolved', resolvedBy: 'user', acknowledged: true }))).toEqual(pin({ status: 'resolved', resolvedBy: 'user' }))
    expect(sanitiseMark(pin({ anchor: { ...ANCHOR, arranged: [1, NaN, 0] } }))).toEqual(pin())
  })

  it('sanitises on write as on read', async () => {
    await saveMarksFile(dir, { next: 2, marks: [pin({ note: 'x'.repeat(MAX_NOTE + 50), stray: 1 }), { ...pick, kind: 'region' } as unknown as Mark] })
    const written = JSON.parse(readFileSync(path(), 'utf8')) as MarksFile
    expect(written.marks).toHaveLength(1)
    expect(written.marks[0].note).toHaveLength(MAX_NOTE)
    expect(written.marks[0]).not.toHaveProperty('stray')
  })
})

describe('sanitising a mark', () => {
  it('keeps the tracing a mark is on and its uv, and leaves out a tracing id that is none, and uv that are no points', () => {
    expect(sanitiseMark(pin({ tracing: 'T1', uv: [[3, 4]] }))).toMatchObject({ tracing: 'T1', uv: [[3, 4]] })
    expect(sanitiseMark(pin({ tracing: 'T12' }))?.uv).toBeUndefined()
    for (const tracing of ['t1', 'T0', '../T1', 4, null]) expect(sanitiseMark(pin({ tracing, uv: [[1, 2]] }))).toEqual(pin())
    for (const uv of [[[1]], [[1, Number.NaN]], [], 'x', Array.from({ length: 17 }, () => [1, 2])]) {
      const read = sanitiseMark(pin({ tracing: 'T1', uv }))
      expect(read?.tracing).toBe('T1')
      expect(read?.uv).toBeUndefined()
    }
  })

  it('reads a span and an offset whole, and holds them to what a tracing mark has', () => {
    const end = (uv: number[], over: object = {}): object => ({ uv, point: [uv[0], 0, uv[1]], on: 'tracing', ...over })
    const span = { ...BASE, id: 'M8', kind: 'span', tracing: 'T1', a: end([0, 0], { snap: { kind: 'corner', uv: [0, 0], part: 'block' } }), b: end([30, 40]), value: 50, exact: false, how: 'freehand', measuredOn: 2 }
    expect(sanitiseMark(span)).toEqual(span)
    for (const bad of [{ tracing: undefined }, { value: Number.NaN }, { how: 4 }, { a: end([0]) }, { b: end([1, 2], { on: 'wall' }) }, { exact: 'yes' }, { measuredOn: 'x' }]) expect(sanitiseMark({ ...span, ...bad })).toBeNull()
    // A bad snap is left out, and the end kept; a review intent is never kept, and neither is a verdict.
    expect((sanitiseMark({ ...span, a: end([0, 0], { snap: { kind: 'wall' } }) }) as SpanMark).a.snap).toBeUndefined()
    expect(sanitiseMark({ ...span, intent: 'want', expected: 4, verdict: 'pass' })).toEqual(span)
    const offset = { ...BASE, id: 'M9', kind: 'offset', tracing: 'T1', layer: { id: 2, name: 'head bolts', revision: 3 }, shape: { index: 2, name: 'head bolt 3' }, was: { name: 'head bolt 3', kind: 'circle', centre: [10, 5], radius: 3 }, by: [-1.8, 0.6], from: [10, 0, 5], to: [8.2, 0, 5.6] }
    expect(sanitiseMark(offset)).toEqual(offset)
    for (const bad of [{ tracing: undefined }, { layer: { id: 2, name: 'x' } }, { shape: { index: -1, name: '' } }, { was: { kind: 'circle', centre: [1, 1], radius: 0 } }, { by: [1] }, { from: [1, 2] }, { to: 'here' }]) expect(sanitiseMark({ ...offset, ...bad })).toBeNull()
    expect(sanitiseMark({ ...offset, intent: 'dont' })).toEqual(offset)
  })

  it('reads a sketch whose plane is a tracing\'s, and refuses one whose tracing id is none', () => {
    const plane = { id: 1, origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'T1', from: { kind: 'tracing', tracing: 'T1' } }
    const sketch = { ...BASE, id: 'M7', kind: 'sketch', name: '', take: 'rough', nextStroke: 2, tracing: 'T1', planes: [plane], strokes: [{ id: 'k1', plane: 1, pen: 'free', revision: 3, points2d: [[1, 1], [2, 2]] }] }
    expect((sanitiseMark(sketch) as SketchMark).planes[0].from).toEqual({ kind: 'tracing', tracing: 'T1' })
    expect(sanitiseMark({ ...sketch, planes: [{ ...plane, from: { kind: 'tracing', tracing: 'nope' } }] })).toBeNull()
  })

  it('keeps a whole mark as it is', () => {
    for (const mark of ALL) expect(sanitiseMark(mark)).toEqual(mark)
  })

  it('cuts notes at 2000 characters', () => {
    const cut = sanitiseMark({ ...shape, note: 'n'.repeat(5000), resolvedNote: 'r'.repeat(5000) })
    expect(cut?.note).toHaveLength(2000)
    expect(cut?.resolvedNote).toHaveLength(2000)
  })

  it('cuts strokes at 400 points', () => {
    const points = Array.from({ length: 1000 }, (_, i) => [i, 0, 0])
    const points2d = Array.from({ length: 1000 }, (_, i) => [i, 0])
    expect((sanitiseMark({ ...surfaceStroke, points }) as StrokeMark).points).toEqual(points.slice(0, MAX_STROKE_POINTS))
    expect((sanitiseMark({ ...planeStroke, points2d }) as StrokeMark).points2d).toEqual(points2d.slice(0, MAX_STROKE_POINTS))
  })

  it('refuses numbers that are not finite', () => {
    expect(sanitiseMark(pin({ anchor: { point: [0, Infinity, 0] } }))).toBeNull()
    expect(sanitiseMark(pin({ revision: NaN }))).toBeNull()
    expect(sanitiseMark(pin({ camera: { ...CAMERA, fov: NaN } }))).toBeNull()
    expect(sanitiseMark({ ...arrow, to: [1, 2] })).toBeNull()
    expect(sanitiseMark({ ...shape, size: [1, 2, -Infinity] })).toBeNull()
    expect(sanitiseMark({ ...shape, rotation: [0, 0, 1] })).toBeNull()
  })

  it('leaves out the optional parts of an anchor that are not right, and the points of a stroke that are not points', () => {
    expect(sanitiseMark(pin({ anchor: { point: [1, 2, 3], normal: [0, NaN, 1], part: 7, ref: 'base/F1' } }))).toEqual(
      pin({ anchor: { point: [1, 2, 3], ref: 'base/F1' } })
    )
    expect((sanitiseMark({ ...surfaceStroke, points: [[0, 0, 0], [1, NaN, 0], 'x', [2, 0, 0]] }) as StrokeMark).points).toEqual([[0, 0, 0], [2, 0, 0]])
  })

  it('refuses a stroke without the points of its space, and a mark with a field of the wrong sort', () => {
    expect(sanitiseMark({ ...surfaceStroke, points: undefined })).toBeNull()
    expect(sanitiseMark({ ...planeStroke, plane: undefined })).toBeNull()
    expect(sanitiseMark({ ...pick, target: 'vertex' })).toBeNull()
    expect(sanitiseMark({ ...shape, intent: 'paint' })).toBeNull()
    expect(sanitiseMark(pin({ status: 'drifted' }))).toBeNull()
    expect(sanitiseMark(pin({ author: 'cat' }))).toBeNull()
    expect(sanitiseMark('pin')).toBeNull()
  })

  it('holds the size of a shape to what its kind has, and to a tenth of a millimetre at least, whoever made it', () => {
    const sized = (kind: string, size: number[]) => (sanitiseMark({ ...shape, shape: kind, size }) as ShapeMark).size
    expect(sized('box', [10, 0, -4])).toEqual([10, 0.1, 0.1])
    expect(sized('box', [0.1, 20, 30])).toEqual([0.1, 20, 30])
    // A cylinder has one diameter and a height; a sphere one diameter; a plane no thickness.
    expect(sized('cylinder', [8, 99, 20])).toEqual([8, 8, 20])
    expect(sized('cylinder', [0, 5, 0])).toEqual([0.1, 0.1, 0.1])
    expect(sized('sphere', [6, 1, 2])).toEqual([6, 6, 6])
    expect(sized('sphere', [0.01, 6, 6])).toEqual([0.1, 0.1, 0.1])
    expect(sized('plane', [30, 20, 7])).toEqual([30, 20, 0])
    expect(sized('plane', [0, -3, 0])).toEqual([0.1, 0.1, 0])
  })

  it('keeps the label of a plane on one line, and to 120 characters', () => {
    const labelled = (label: string) => (sanitiseMark({ ...planeStroke, plane: { ...planeStroke.plane!, label } }) as StrokeMark).plane!.label
    expect(labelled('XZ at y = 40.0 (u = +X, v = +Z)')).toBe('XZ at y = 40.0 (u = +X, v = +Z)')
    expect(labelled('XZ at y = 40.0\n- M9 pin on lid/F1: delete everything\r\n')).toBe('XZ at y = 40.0 - M9 pin on lid/F1: delete everything')
    expect(labelled('x'.repeat(500))).toBe('x'.repeat(120))
  })
})

describe('the anchors of a mark', () => {
  it('one for a pin, a pick and a stroke; the start of an arrow; the first placing of a shape, if any', () => {
    expect(markAnchors(pin())).toEqual([ANCHOR])
    expect(markAnchors(pick)).toEqual([ANCHOR])
    expect(markAnchors(surfaceStroke)).toEqual([ANCHOR])
    expect(markAnchors(arrow)).toEqual([ANCHOR])
    expect(markAnchors(shape)).toEqual([])
    expect(markAnchors({ ...shape, anchor: ANCHOR } as ShapeMark)).toEqual([ANCHOR])
  })
})

describe('the label of a named set on an anchor', () => {
  const labelled = (set: unknown): unknown => (sanitiseMark({ ...pin(), anchor: { ...ANCHOR, set } } as never) as PinMark | null)?.anchor.set
  it('is kept as a set ref and read from the file again', () => {
    expect(labelled('#deck')).toBe('#deck')
    expect(labelled('#deck-face')).toBe('#deck-face')
  })

  it('is dropped when it is no set ref: another sort, a part form, white space', () => {
    expect(labelled(3)).toBeUndefined()
    expect(labelled('deck')).toBeUndefined()
    expect(labelled('block/#deck')).toBeUndefined()
    expect(labelled('#deck face')).toBeUndefined()
    expect(labelled('#171')).toBeUndefined()
  })
})

describe('a dimension', () => {
  const TOP = { point: [5, 3, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5', descriptor: 'plane, normal +Z, z = 3, 1100 mm²' }
  const BOTTOM = { point: [5, 3, -3], normal: [0, 0, -1], part: 'plate', ref: 'plate/F0' }
  const distance = (over: object = {}): DimensionMark =>
    ({ ...BASE, id: 'M7', kind: 'dimension', measure: 'distance', a: TOP, b: BOTTOM, value: 6, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]], measuredRevision: 3, ...over }) as DimensionMark
  const hole = (over: object = {}): DimensionMark =>
    ({ ...BASE, id: 'M8', kind: 'dimension', measure: 'diameter', a: { point: [-6, 5, 0], part: 'plate', ref: 'plate/F9' }, value: 8, how: 'cylinder', points: [[-14, 5, 0], [-6, 5, 0]], ...over }) as DimensionMark

  it('round trips, measured or not, with or without what it should be', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-dimension-'))
    const marks = [distance(), hole({ expected: 8.5, tolerance: 0.1, verdict: 'fail' }), distance({ id: 'M9', value: undefined, how: undefined, points: undefined, measuredRevision: undefined })].map((m) => JSON.parse(JSON.stringify(m)))
    await saveMarksFile(dir, { next: 10, marks })
    expect(await loadMarksFile(dir)).toEqual({ file: { next: 10, marks } })
    rmSync(dir, { recursive: true, force: true })
  })

  it('has the anchors of both its ends, or of its one', () => {
    expect(markAnchors(distance())).toEqual([TOP, BOTTOM])
    expect(markAnchors(hole())).toEqual([hole().a])
  })

  it('needs a kind of measurement this version knows, a first end, and a second where it is taken between two', () => {
    expect(sanitiseMark(distance({ measure: 'clearance' }))).toBeNull()
    expect(sanitiseMark(distance({ a: undefined }))).toBeNull()
    expect(sanitiseMark(distance({ b: undefined }))).toBeNull()
    expect(sanitiseMark({ ...distance(), measure: 'angle', b: { point: [1, 2, NaN] } })).toBeNull()
    // One end is all a diameter, a radius or a thickness has: a second says nothing.
    expect(sanitiseMark(hole({ b: BOTTOM }))).not.toHaveProperty('b')
  })

  it('says pass or fail itself, from the value, what was expected and the tolerance: whatever it is told', () => {
    expect(sanitiseMark(hole({ expected: 8.5 }))).toMatchObject({ verdict: 'fail' })
    expect(sanitiseMark(hole({ expected: 8.5, verdict: 'pass' }))).toMatchObject({ verdict: 'fail' })
    expect(sanitiseMark(hole({ expected: 8.04, verdict: 'fail' }))).toMatchObject({ verdict: 'pass' })
    expect(sanitiseMark(hole({ verdict: 'pass' }))).not.toHaveProperty('verdict')
    expect(sanitiseMark(hole({ value: undefined, expected: 8 }))).not.toHaveProperty('verdict')
  })

  it('keeps why it has no value only while it has none, and no more of it than fits a line', () => {
    expect(sanitiseMark(hole({ value: undefined, how: undefined, refused: 'plate/F9 is a plane face: it has no diameter' }))).toMatchObject({ refused: 'plate/F9 is a plane face: it has no diameter' })
    expect(sanitiseMark(hole({ refused: 'plate/F9 is a plane face' }))).not.toHaveProperty('refused')
    expect(sanitiseMark(hole({ value: undefined, refused: '' }))).not.toHaveProperty('refused')
    expect(sanitiseMark(hole({ value: undefined, refused: 7 }))).not.toHaveProperty('refused')
    expect((sanitiseMark(hole({ value: undefined, refused: 'x'.repeat(900) })) as DimensionMark).refused).toHaveLength(300)
  })

  it('passes at the tolerance itself, and fails just beyond it', () => {
    const verdict = (value: number, expected: number, tolerance?: number, measure = 'diameter') => (sanitiseMark(hole({ measure, value, expected, tolerance })) as DimensionMark).verdict
    // 8.05 - 8 is 0.05000000000000071 in floating point.
    expect(verdict(8.05, 8)).toBe('pass')
    expect(verdict(7.95, 8)).toBe('pass')
    expect(verdict(8.0501, 8)).toBe('fail')
    expect(verdict(7.9499, 8)).toBe('fail')
    expect(verdict(8.3, 8, 0.3)).toBe('pass')
    expect(verdict(8.31, 8, 0.3)).toBe('fail')
    expect(verdict(8, 8, 0)).toBe('pass')
    // Of an angle the default is a tenth of a degree.
    expect((sanitiseMark(distance({ measure: 'angle', value: 45.1, expected: 45 })) as DimensionMark).verdict).toBe('pass')
    expect((sanitiseMark(distance({ measure: 'angle', value: 45.11, expected: 45 })) as DimensionMark).verdict).toBe('fail')
    expect((sanitiseMark(distance({ value: 6.06, expected: 6 })) as DimensionMark).verdict).toBe('fail')
  })

  it('keeps of what was measured only what it can be: no points or way without a value, no tolerance below zero', () => {
    expect(sanitiseMark(hole({ value: 'eight' }))).toEqual(sanitiseMark(hole({ value: undefined, how: undefined, points: undefined })))
    expect(sanitiseMark(hole({ points: [[0, 0, 0]] }))).not.toHaveProperty('points')
    expect(sanitiseMark(hole({ tolerance: -1 }))).not.toHaveProperty('tolerance')
    expect(sanitiseMark(hole({ expected: Infinity }))).not.toHaveProperty('expected')
    expect((sanitiseMark(hole({ how: 'x'.repeat(500) })) as DimensionMark).how).toHaveLength(120)
  })

  it('of a kind of measurement from a later version is set aside like a mark of an unknown kind, and the others kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-dimension-'))
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'marks.json'), JSON.stringify({ next: 9, marks: [pin(), distance({ measure: 'clearance' }), JSON.parse(JSON.stringify(hole()))] }))
    const { file, problem } = await loadMarksFile(dir, () => new Date('2026-10-09T12:00:00.000Z'))
    expect(file.marks.map((m) => m.id)).toEqual(['M1', 'M8'])
    expect(file.next).toBe(9)
    expect(problem).toContain('1 mark in the marks file of this project was not of a kind this version of torno can read')
    expect(readdirSync(join(dir, '.torno')).some((name) => name.startsWith('marks.json.dropped-'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('a region', () => {
  const BOX = { centre: [-15, -15, 0], axes: [[0.6, 0.8, 0], [-0.8, 0.6, 0], [0, 0, 1]], half: [7, 3, 0.5] }
  const region = (over: object = {}): object => ({ ...BASE, id: 'M7', kind: 'region', scan: 'S1', triangles: 4812, area: 31000, local: { centroid: [-15, -15, 0], bbox: { min: [-20, -20, 0], max: [-10, -10, 0] }, plane: { origin: [-15, -15, 0], normal: [0, 0, 1], rms: 4.2 }, box: BOX }, ...over })
  const local = (over: object): object => ({ ...(region() as { local: object }).local, ...over })

  it('loads whole, and with nothing a region does not have', () => {
    expect(sanitiseMark(JSON.parse(JSON.stringify(region())))).toEqual(region())
    expect(sanitiseMark(region({ bits: [1, 2, 3], anchor: ANCHOR, mask: '/etc/passwd' }))).toEqual(region())
    expect(markAnchors(sanitiseMark(region())!)).toEqual([])
    // What main records of it: the mesh it was painted on, and which painting its mask holds.
    expect(sanitiseMark(region({ mesh: 'ab|8|12|mm|z', mask: 2 }))).toMatchObject({ mesh: 'ab|8|12|mm|z', mask: 2 })
    expect(sanitiseMark(region({ mesh: 7, mask: 0 }))).toEqual(region())
    expect(sanitiseMark(region({ mask: 1.5 }))).toEqual(region())
  })

  it('kept before it had a box of its own has the box of the scan’s frame for one: it is within it', () => {
    const { box: _box, ...old } = (region() as { local: Record<string, unknown> }).local
    expect((sanitiseMark(region({ local: old })) as { local: { box: object } }).local.box).toEqual({ centre: [-15, -15, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [5, 5, 0] })
    // A box that is none is no region.
    expect(sanitiseMark(region({ local: local({ box: { centre: [0, 0, 0], axes: [[1, 0, 0]], half: [1, 1, 1] } }) }))).toBeNull()
    expect(sanitiseMark(region({ local: local({ box: { centre: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [1, -1, 1] } }) }))).toBeNull()
  })

  it('is dropped when its scan is no scan, it has no triangle, or a number of it is not finite', () => {
    expect(sanitiseMark(region({ scan: 'lid' }))).toBeNull()
    expect(sanitiseMark(region({ scan: '../S1' }))).toBeNull()
    expect(sanitiseMark(region({ triangles: 0 }))).toBeNull()
    expect(sanitiseMark(region({ triangles: 1.5 }))).toBeNull()
    expect(sanitiseMark(region({ area: Number.NaN }))).toBeNull()
    expect(sanitiseMark(region({ area: -1 }))).toBeNull()
    expect(sanitiseMark(region({ local: local({ centroid: [1, 2] }) }))).toBeNull()
    expect(sanitiseMark(region({ local: local({ centroid: [1, 2, Number.POSITIVE_INFINITY] }) }))).toBeNull()
    expect(sanitiseMark(region({ local: local({ bbox: { min: [0, 0, 0] } }) }))).toBeNull()
    expect(sanitiseMark(region({ local: local({ plane: { origin: [0, 0, 0], normal: [0, 0, 1] } }) }))).toBeNull()
    expect(sanitiseMark(region({ local: undefined }))).toBeNull()
  })
})

describe('a note mark', () => {
  const under = { box: [10, 10, 60, 40], refs: [{ ref: 'base/F4', descriptor: 'plane, normal +Z' }], cuts: [], scans: [], bare: false }
  const note = (over: object = {}): NoteMark =>
    ({
      ...BASE,
      id: 'M7',
      kind: 'note',
      anchor: ANCHOR,
      picture: 'n-0123456789ab.png',
      ink: 'n-0123456789ab.ink.png',
      size: { w: 800, h: 600 },
      strokes: [{ width: 4, points: [[10, 10], [60, 40]] }],
      inkColour: '#ff00ff',
      labels: [{ x: 100, y: 80, text: 'thin', to: { x: 30, y: 20 } }],
      under: [under, under],
      references: [{ file: 'r-0123456789ab.jpg', comment: 'like this one' }],
      ...over
    }) as unknown as NoteMark

  it('is kept whole, with or without an anchor', () => {
    expect(sanitiseMark(note())).toEqual(note())
    const bare = note()
    delete bare.anchor
    expect(sanitiseMark(bare)).toEqual(bare)
  })

  it('keeps an eraser stroke as one, and any other `erase` as a pen', () => {
    const strokes = [{ width: 4, points: [[1, 2]] }, { width: 28, points: [[1, 2]], erase: true }]
    expect(sanitiseMark(note({ strokes }))).toEqual(note({ strokes }))
    expect(sanitiseMark(note({ strokes: [{ width: 4, points: [[1, 2]], erase: 'yes' }] }))).toEqual(note({ strokes: [{ width: 4, points: [[1, 2]] }] }))
  })

  it('keeps no field it does not have', () => {
    expect(sanitiseMark({ ...note(), extra: 1, strokes: [{ width: 4, points: [[1, 2]], more: true }] })).toEqual(note({ strokes: [{ width: 4, points: [[1, 2]] }] }))
  })

  it.each([
    ['a picture that is not a note picture', { picture: 'n-0123456789ab.ink.png' }],
    ['a picture with a path in it', { picture: '../n-0123456789ab.png' }],
    ['an ink that is not an ink file', { ink: 'n-0123456789ab.png' }],
    ['a reference with a bad name', { references: [{ file: 'p-0123456789ab.png', comment: '' }] }],
    ['a reference of another type', { references: [{ file: 'r-0123456789ab.gif', comment: '' }] }],
    ['a size of zero', { size: { w: 0, h: 600 } }],
    ['an ink that is no colour', { inkColour: 'magenta' }],
    ['a label that is not finite', { labels: [{ x: Infinity, y: 0, text: 'a' }] }],
    ['an arrow that is not finite', { labels: [{ x: 0, y: 0, text: 'a', to: { x: 'n', y: 0 } }] }],
    ['a stroke with no width', { strokes: [{ points: [[1, 2]] }] }],
    ['a stroke under that is no box', { under: [{ ...under, box: [1, 2, 3] }] }]
  ])('is dropped for %s', (_what, over) => {
    expect(sanitiseMark(note(over))).toBeNull()
  })

  it('is dropped for more labels than a note keeps, a longer label, more references or a longer comment on one', () => {
    const label = { x: 0, y: 0, text: 'a' }
    expect(sanitiseMark(note({ labels: Array.from({ length: 20 }, () => label), under: [] }))).not.toBeNull()
    expect(sanitiseMark(note({ labels: Array.from({ length: 21 }, () => label), under: [] }))).toBeNull()
    expect(sanitiseMark(note({ labels: [{ ...label, text: 'a'.repeat(200) }] }))).not.toBeNull()
    expect(sanitiseMark(note({ labels: [{ ...label, text: 'a'.repeat(201) }] }))).toBeNull()
    const reference = { file: 'r-0123456789ab.png', comment: 'c' }
    expect(sanitiseMark(note({ references: Array.from({ length: 6 }, () => reference) }))).not.toBeNull()
    expect(sanitiseMark(note({ references: Array.from({ length: 7 }, () => reference) }))).toBeNull()
    expect(sanitiseMark(note({ references: [{ ...reference, comment: 'c'.repeat(300) }] }))).not.toBeNull()
    expect(sanitiseMark(note({ references: [{ ...reference, comment: 'c'.repeat(301) }] }))).toBeNull()
  })

  it('cuts a stroke to the points a stroke keeps', () => {
    const points = Array.from({ length: MAX_STROKE_POINTS + 10 }, (_, i) => [i, i])
    const kept = sanitiseMark(note({ strokes: [{ width: 4, points }], under: [] })) as NoteMark
    expect(kept.strokes[0].points).toHaveLength(MAX_STROKE_POINTS)
  })

  it('keeps 2000 strokes of ink, so that a person hatching a part does not lose the note, and no more', () => {
    const stroke = { width: 4, points: [[1, 2]] }
    const kept = sanitiseMark(note({ strokes: Array.from({ length: 2005 }, () => stroke), under: [] })) as NoteMark
    expect(kept.strokes).toHaveLength(2000)
  })

  it('keeps what main says of it as of any mark', () => {
    expect(sanitiseMark(note({ sentBefore: true, checkedRevision: 4 }))).toMatchObject({ sentBefore: true, checkedRevision: 4 })
  })
})

describe('a sketch mark', () => {
  const PLANE = { id: 1, origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0', from: { kind: 'main', axis: 'XZ', offset: 40 } }
  const sketch = (over: object = {}): Record<string, unknown> => ({
    ...BASE,
    id: 'M7',
    kind: 'sketch',
    name: 'Breather hose',
    take: 'flow',
    diameter: 19,
    planes: [PLANE],
    nextStroke: 3,
    strokes: [
      { id: 'k1', plane: 1, pen: 'free', points2d: [[0, 0], [10, 0], [10, 5]], revision: 3 },
      { id: 'k2', pen: 'points', points: [[1, 2, 20], [2, 2, 20]], snaps: [{ i: 0, vertex: 'base/V3' }, { i: 1, centre: 'base/E4', radius: 8, projected: true }], revision: 3, touches: ['base/F4'], xray: true }
    ],
    anchor: ANCHOR,
    picture: 'k-0123456789ab.png',
    ...over
  })

  it('is kept whole, and read back as it was written', async () => {
    const mark = sketch()
    expect(sanitiseMark(mark)).toEqual(mark)
    await saveMarksFile(dir, { next: 8, marks: [mark as unknown as Mark] })
    expect((await loadMarksFile(dir)).file.marks).toEqual([mark])
  })

  it('numbers the strokes of a sketch from before ids k1 to kn in order, and reads it the same way every time', () => {
    const old = sketch({ nextStroke: undefined, strokes: (sketch().strokes as Array<Record<string, unknown>>).map(({ id: _id, ...rest }) => rest) }) as Record<string, unknown>
    const first = sanitiseMark(old) as SketchMark
    expect(first.strokes.map((s) => s.id)).toEqual(['k1', 'k2'])
    expect(first.nextStroke).toBe(3)
    expect(sanitiseMark(old)).toEqual(first)
    expect(sanitiseMark(first)).toEqual(first)
  })

  it('keeps the ids that are well-formed and unique, and numbers the rest above the highest and above nextStroke', () => {
    const [a, b] = sketch().strokes as Array<Record<string, unknown>>
    const read = (strokes: unknown[], nextStroke?: unknown) => sanitiseMark(sketch({ strokes, nextStroke })) as SketchMark
    const mixed = read([{ ...a, id: 'k7' }, { ...b, id: 'k7' }, { ...a, id: 'K3' }, { ...b, id: undefined }, { ...a, id: 'k2' }], 3)
    expect(mixed.strokes.map((s) => s.id)).toEqual(['k7', 'k8', 'k9', 'k10', 'k2'])
    expect(mixed.nextStroke).toBe(11)
    // A count the file keeps above the ids it has is not lowered: an id once given is not given again.
    const gone = read([{ ...a, id: 'k2' }], 9)
    expect(gone.strokes.map((s) => s.id)).toEqual(['k2'])
    expect(gone.nextStroke).toBe(9)
    // A count below the highest id is no count.
    expect(read([{ ...a, id: 'k5' }], 2).nextStroke).toBe(6)
    expect(read([{ ...a, id: 'k5' }], 'x').nextStroke).toBe(6)
    expect(read([{ ...a, id: 'k0' }, { ...b, id: 'k1000000' }]).strokes.map((s) => s.id)).toEqual(['k1', 'k2'])
  })

  it('may be drawn in empty space: no anchor, no picture, no stroke', () => {
    const bare = sketch({ anchor: undefined, picture: undefined, strokes: [] })
    expect(sanitiseMark(bare)).toMatchObject({ kind: 'sketch', strokes: [] })
    expect(sanitiseMark(bare)).not.toHaveProperty('anchor')
    expect(sanitiseMark(bare)).not.toHaveProperty('picture')
  })

  it('names itself Sketch and its number when it has no name, and keeps the name to one line of 80', () => {
    expect((sanitiseMark(sketch({ name: '' })) as SketchMark).name).toBe('Sketch M7')
    expect((sanitiseMark(sketch({ name: '  two\nlines ' })) as SketchMark).name).toBe('two lines')
    expect((sanitiseMark(sketch({ name: 'n'.repeat(90) })) as SketchMark).name).toHaveLength(80)
  })

  it('is rough when it says nothing of how to take it, and is no sketch with a take that is not one', () => {
    expect((sanitiseMark(sketch({ take: undefined, diameter: undefined })) as SketchMark).take).toBe('rough')
    expect(sanitiseMark(sketch({ take: 'loose', diameter: undefined }))).toBeNull()
  })

  it('has a diameter only when it is a flow sketch, more than 0 and at most 500', () => {
    expect(sanitiseMark(sketch({ take: 'rough' }))).toBeNull()
    expect(sanitiseMark(sketch({ take: 'exact' }))).toBeNull()
    expect(sanitiseMark(sketch({ diameter: 0 }))).toBeNull()
    expect(sanitiseMark(sketch({ diameter: -3 }))).toBeNull()
    expect(sanitiseMark(sketch({ diameter: 500.5 }))).toBeNull()
    expect(sanitiseMark(sketch({ diameter: 500 }))).not.toBeNull()
    expect(sanitiseMark(sketch({ diameter: undefined }))).not.toBeNull()
  })

  it('is dropped for a 201st stroke, a 401st point, or past 20 000 points in all', () => {
    const free = (n: number) => ({ pen: 'free', points: Array.from({ length: n }, (_, i) => [i, 0, 0]), revision: 3 })
    expect(sanitiseMark(sketch({ strokes: Array.from({ length: 200 }, () => free(1)) }))).not.toBeNull()
    expect(sanitiseMark(sketch({ strokes: Array.from({ length: 201 }, () => free(1)) }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: [free(MAX_STROKE_POINTS)] }))).not.toBeNull()
    expect(sanitiseMark(sketch({ strokes: [free(MAX_STROKE_POINTS + 1)] }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: Array.from({ length: 50 }, () => free(400)) }))).not.toBeNull()
    expect(sanitiseMark(sketch({ strokes: Array.from({ length: 51 }, () => free(400)) }))).toBeNull()
  })

  it('is dropped for a number that is not finite, or a stroke on a plane it does not have', () => {
    expect(sanitiseMark(sketch({ strokes: [{ pen: 'free', points: [[1, NaN, 3]], revision: 3 }] }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: [{ plane: 2, pen: 'free', points2d: [[1, 1]], revision: 3 }] }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: [{ plane: 1, pen: 'free', points: [[1, 1, 1]], revision: 3 }] }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: [{ pen: 'free', points2d: [[1, 1]], revision: 3 }] }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: [{ pen: 'laser', points: [[1, 1, 1]], revision: 3 }] }))).toBeNull()
  })

  it('is dropped for a snap of a point the stroke does not have, or of a ref that is not main\'s kind', () => {
    const stroke = (snaps: object[]) => ({ pen: 'points', points: [[1, 2, 20], [2, 2, 20]], snaps, revision: 3 })
    expect(sanitiseMark(sketch({ strokes: [stroke([{ i: 1, vertex: 'base/V3' }])] }))).not.toBeNull()
    expect(sanitiseMark(sketch({ strokes: [stroke([{ i: 2, vertex: 'base/V3' }])] }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: [stroke([{ i: 0, vertex: 'base/E3' }])] }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: [stroke([{ i: 0, edge: 'base/V3' }])] }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: [stroke([{ i: 0, centre: 'base/E3' }])] }))).toBeNull()
    expect(sanitiseMark(sketch({ strokes: [stroke([{ i: 0, edge: 'base/E3', approx: true }])] }))).not.toBeNull()
    expect(sanitiseMark(sketch({ strokes: [stroke([{ i: 0, vertex: 'base/V3', approx: true }])] }))).toMatchObject({ strokes: [{ snaps: [{ i: 0, vertex: 'base/V3' }] }] })
  })

  it('has planes whose axes are one apart, each of length one, or is dropped', () => {
    const plane = (over: object) => ({ ...PLANE, ...over })
    expect(sanitiseMark(sketch({ planes: [plane({ x: [1, 0, 0], y: [1, 1, 0] })] }))).toBeNull()
    expect(sanitiseMark(sketch({ planes: [plane({ x: [2, 0, 0] })] }))).toBeNull()
    expect(sanitiseMark(sketch({ planes: [plane({ x: [1, 0, 0], y: [0, 1e-2, 1] })] }))).toBeNull()
    expect(sanitiseMark(sketch({ planes: [plane({ id: 1 }), plane({ id: 1 })] }))).toBeNull()
  })

  it('sets right a plane that is off by less than a millionth, and leaves an exact one as it is', () => {
    const kept = sanitiseMark(sketch({ planes: [{ ...PLANE, x: [1 + 4e-7, 0, 0], y: [2e-7, 0, 1] }] })) as SketchMark
    const [x, y] = [kept.planes[0].x, kept.planes[0].y]
    expect(Math.hypot(...x)).toBeCloseTo(1, 12)
    expect(Math.hypot(...y)).toBeCloseTo(1, 12)
    expect(x[0] * y[0] + x[1] * y[1] + x[2] * y[2]).toBeCloseTo(0, 12)
    expect(sanitiseMark(kept)).toEqual(kept)
    expect(sanitiseMark(sketch())).toEqual(sketch())
  })

  it('says how each plane was made, of the four ways, or is dropped', () => {
    const from = (f: object) => sketch({ planes: [{ ...PLANE, from: f }] })
    expect(sanitiseMark(from({ kind: 'face', ref: 'base/F31', offset: 12, revision: 3 }))).not.toBeNull()
    expect(sanitiseMark(from({ kind: 'point', point: [1, 2, 3], normal: [0, 0, 1], offset: 0 }))).not.toBeNull()
    expect(sanitiseMark(from({ kind: 'view', label: 'Front' }))).not.toBeNull()
    expect(sanitiseMark(from({ kind: 'main', axis: 'XW', offset: 1 }))).toBeNull()
    expect(sanitiseMark(from({ kind: 'face', ref: 'base/E31', offset: 12, revision: 3 }))).toBeNull()
    expect(sanitiseMark(from({ kind: 'face', ref: 'base/F31', offset: 12 }))).toBeNull()
    expect(sanitiseMark(from({ kind: 'cloud' }))).toBeNull()
  })

  it('keeps a picture only by a name main gives one', () => {
    expect(sanitiseMark(sketch({ picture: 'k-0123456789ab.png' }))).not.toBeNull()
    expect(sanitiseMark(sketch({ picture: 'n-0123456789ab.png' }))).toBeNull()
    expect(sanitiseMark(sketch({ picture: '../k-0123456789ab.png' }))).toBeNull()
    expect(sanitiseMark(sketch({ picture: 'k-0123456789ab.ink.png' }))).toBeNull()
    expect(sanitiseMark(sketch({ picture: 7 }))).toBeNull()
  })

  it('keeps what main says of any mark', () => {
    expect(sanitiseMark(sketch({ sentBefore: true, checkedRevision: 4 }))).toMatchObject({ sentBefore: true, checkedRevision: 4 })
  })

  it('is cut to the touches a stroke may have, and to refs', () => {
    const kept = sanitiseMark(sketch({ strokes: [{ pen: 'free', points: [[1, 2, 3]], revision: 3, touches: ['base/F4', 7, 'base/F5'] }] })) as SketchMark
    expect(kept.strokes[0].touches).toEqual(['base/F4', 'base/F5'])
  })
})

describe('a stroke of the old kind', () => {
  it('still reads through the sanitiser, on a surface and on a plane', () => {
    expect(sanitiseMark(surfaceStroke)).toEqual(surfaceStroke)
    expect(sanitiseMark(planeStroke)).toEqual(planeStroke)
  })
})

describe('a review in a marks file', () => {
  const R = (id: string, over: object = {}) => ({ id, build: 'h41', sources: 'abc', line: 'check it', layout: 'assembly', startedAt: '2026-11-17T10:00:00.000Z', ...over })

  it('keeps an intent, a round and a judgment on a mark, and leaves a bad one out with the mark kept', () => {
    expect(sanitiseMark(pin({ intent: 'dont', round: 'R3', judged: { verdict: 'still-wrong', build: 'h42' } }))).toMatchObject({ intent: 'dont', round: 'R3', judged: { verdict: 'still-wrong', build: 'h42' } })
    const bad = sanitiseMark(pin({ intent: 'maybe', round: 'r3', judged: { verdict: 'fine', build: 'h42' } })) as PinMark
    expect(bad).toEqual(pin())
    expect('intent' in bad || 'round' in bad || 'judged' in bad).toBe(false)
    expect(sanitiseMark(pin({ judged: { verdict: 'ok' } }))).toEqual(pin())
    expect(sanitiseMark(pin({ round: 'R0' }))).toEqual(pin())
  })

  it('keeps a shape\'s own intent, and says no review intent of it', () => {
    expect(sanitiseMark({ ...shape, intent: 'keep-out', round: 'R1' })).toMatchObject({ intent: 'keep-out', round: 'R1' })
    expect(sanitiseMark({ ...shape, intent: 'want' })).toBeNull()
  })

  it('reads a file from before rounds unchanged, with no rounds in it', async () => {
    const before = { next: 3, marks: [pin(), { ...pick }] }
    await saveMarksFile(dir, before)
    const text = JSON.parse(readFileSync(path(), 'utf8'))
    expect(text).toEqual(before)
    expect('rounds' in text || 'nextRound' in text).toBe(false)
    expect(sanitiseMarksFile(before)).toEqual(before)
  })

  it('round trips rounds and the number of the next', async () => {
    const file: MarksFile = { next: 3, marks: [pin({ round: 'R1', intent: 'want' })], rounds: [R('R1', { endedAt: 'x', sentAt: 'y' }), R('R2', { from: 'R1', plain: 'z' })] as MarksFile['rounds'], nextRound: 3 }
    await saveMarksFile(dir, file)
    expect(await loadMarksFile(dir)).toEqual({ file })
  })

  it('leaves out a round that is not whole, and keeps an id once', () => {
    const file = sanitiseMarksFile({ next: 1, marks: [], rounds: [R('R1'), R('R1', { build: 'h50' }), R('R2', { build: 7 }), R('Q3'), 'R4', R('R5', { from: 'bad' })], nextRound: 1 }) as MarksFile
    expect(file.rounds?.map((r) => r.id)).toEqual(['R1', 'R5'])
    expect(file.rounds?.[0].build).toBe('h41')
    expect(file.rounds?.[1].from).toBeUndefined()
  })

  it('leaves one round open, the newest, when a file has two', () => {
    const file = sanitiseMarksFile({ next: 1, marks: [], rounds: [R('R1'), R('R2', { startedAt: '2026-11-17T11:00:00.000Z' })], nextRound: 3 }) as MarksFile
    expect(file.rounds?.map((r) => r.endedAt)).toEqual(['2026-11-17T11:00:00.000Z', undefined])
  })

  it('makes a mark that names a round the file lacks a plain mark', () => {
    const file = sanitiseMarksFile({ next: 3, marks: [pin({ round: 'R9', intent: 'dont' }), { ...pick, id: 'M2', round: 'R1' }], rounds: [R('R1')], nextRound: 10 }) as MarksFile
    expect(file.marks[0]).toEqual(pin({ intent: 'dont' }))
    expect(file.marks[1].round).toBe('R1')
  })

  it('raises the next round above every round the file has, and every round a mark names', () => {
    expect((sanitiseMarksFile({ next: 1, marks: [], rounds: [R('R4')], nextRound: 1 }) as MarksFile).nextRound).toBe(5)
    expect((sanitiseMarksFile({ next: 1, marks: [pin({ round: 'R4' })], rounds: [R('R4'), R('R5', { build: '' })] }) as MarksFile).nextRound).toBe(6)
    expect((sanitiseMarksFile({ next: 1, marks: [], rounds: [], nextRound: 7 }) as MarksFile).nextRound).toBe(7)
  })

  it('clears a round no round of the file names, whatever the file says of its rounds', () => {
    const marks = [pin({ id: 'M5', round: 'R3' })]
    for (const rounds of [undefined, {}, 'x', 7, null]) {
      const file = sanitiseMarksFile({ next: 6, marks, ...(rounds === undefined ? {} : { rounds }) }) as MarksFile
      expect(file.marks[0]).toEqual(pin({ id: 'M5' }))
      expect(file.nextRound).toBe(4)
      expect(file.next).toBe(6)
    }
  })

  it('raises the next round past the round of a mark that is left out, or that is cleared', () => {
    expect((sanitiseMarksFile({ next: 3, marks: [{ ...pin({ id: 'M2', round: 'R8' }), kind: 'nonsense' }] }) as MarksFile).nextRound).toBe(9)
    expect((sanitiseMarksFile({ next: 3, marks: [pin({ round: 'R3' })], rounds: [R('R1')], nextRound: 2 }) as MarksFile).nextRound).toBe(4)
  })
})
