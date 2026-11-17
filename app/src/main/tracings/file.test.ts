import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mainPlaneFrame } from '../../shared/planes'
import { MOST_LAYERS, MOST_TRACINGS, type TracingsFile } from '../../shared/tracings'
import { loadTracingsFile, readTracingsFile, sanitiseTracing, saveTracingsFile, textOf } from './file'

const plane = { ...mainPlaneFrame('XZ', 40), from: { kind: 'main', axis: 'XZ', offset: 40 } }
const layer = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `layer ${id}`,
  colour: 'teal',
  by: 'agent',
  shapes: [{ kind: 'polyline', points: [[0, 0], [10, 0], [10, 5]], closed: true }],
  revision: 3,
  ...extra
})
const raw = (extra: Record<string, unknown> = {}) => ({
  id: 'T1',
  by: 'person',
  name: 'front',
  layout: 'assembly',
  createdAt: '2026-11-17T10:00:00.000Z',
  plane,
  layers: [layer(1), layer(2)],
  nextLayer: 3,
  ...extra
})

let root: string
let dir: string
const path = () => join(dir, '.torno', 'tracings.json')
const asides = (prefix: string) => readdirSync(join(dir, '.torno')).filter((n) => n.startsWith(prefix))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-tracings-file-'))
  dir = join(root, 'bracket')
  mkdirSync(join(dir, '.torno'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('sanitiseTracing', () => {
  it('keeps a whole tracing', () => {
    const t = sanitiseTracing(raw())
    expect(t).toMatchObject({ id: 'T1', by: 'person', name: 'front', layout: 'assembly', nextLayer: 3 })
    expect(t?.layers.map((l) => [l.id, l.name, l.colour, l.by, l.revision])).toEqual([[1, 'layer 1', 'teal', 'agent', 3], [2, 'layer 2', 'teal', 'agent', 3]])
    expect(t?.plane.from).toEqual({ kind: 'main', axis: 'XZ', offset: 40 })
  })

  it('drops the build number of a tracing, which restarts every run, and keeps the build it names', () => {
    const t = sanitiseTracing(raw({ revision: 7, build: { id: 'h41', sources: 'abc' } }))
    expect(t).not.toHaveProperty('revision')
    expect(t?.build).toEqual({ id: 'h41', sources: 'abc' })
  })

  it('is not a tracing without a good id, layout or plane', () => {
    expect(sanitiseTracing(raw({ id: 'M1' }))).toBeNull()
    expect(sanitiseTracing(raw({ id: 'T0' }))).toBeNull()
    expect(sanitiseTracing(raw({ layout: '' }))).toBeNull()
    expect(sanitiseTracing(raw({ plane: { ...plane, x: [1, 0, 0], y: [1, 0, 0] } }))).toBeNull()
    expect(sanitiseTracing(raw({ plane: { ...plane, origin: [0, 'x', 0] } }))).toBeNull()
    expect(sanitiseTracing(raw({ plane: { ...plane, from: { kind: 'wall' } } }))).toBeNull()
    expect(sanitiseTracing(null)).toBeNull()
    expect(sanitiseTracing([])).toBeNull()
  })

  it('reads every kind of origin of a plane', () => {
    const face = sanitiseTracing(raw({ plane: { ...plane, from: { kind: 'face', ref: 'block/F31', tag: 'deck', revision: 4 } } }))
    expect(face?.plane.from).toEqual({ kind: 'face', ref: 'block/F31', tag: 'deck', revision: 4 })
    const section = sanitiseTracing(raw({ plane: { ...plane, from: { kind: 'section', origin: [1, 2, 3], normal: [0, 1, 0] } } }))
    expect(section?.plane.from).toEqual({ kind: 'section', origin: [1, 2, 3], normal: [0, 1, 0] })
  })

  it('raises nextLayer above every layer id', () => {
    expect(sanitiseTracing(raw({ nextLayer: 1 }))?.nextLayer).toBe(3)
    expect(sanitiseTracing(raw({ nextLayer: 'x', layers: [layer(9)] }))?.nextLayer).toBe(10)
    expect(sanitiseTracing(raw({ nextLayer: 8 }))?.nextLayer).toBe(8)
  })

  it('leaves out a layer that is not whole, a layer of an id used, and a shape that is not whole', () => {
    const t = sanitiseTracing(
      raw({
        layers: [
          layer(1),
          layer(1, { name: 'again' }),
          layer(2, { colour: 'red' }),
          layer(3, { name: '' }),
          layer(4, { shapes: [{ kind: 'circle', centre: [1, 2], radius: 3 }, { kind: 'circle', centre: [1, 2], radius: -3 }, { kind: 'polyline', points: [[0, 0]] }, { kind: 'label', at: [0, Number.NaN], text: 'x' }, { kind: 'label', at: [1, 1], text: 'ok' }, 5] })
        ]
      })
    )
    expect(t?.layers.map((l) => l.id)).toEqual([1, 4])
    expect(t?.layers[1].shapes).toEqual([{ kind: 'circle', centre: [1, 2], radius: 3 }, { kind: 'label', at: [1, 1], text: 'ok' }])
    // an id that was in the file is never given again, whether its layer was kept or not
    expect(t?.nextLayer).toBeGreaterThanOrEqual(5)
  })

  it('keeps only the keys a shape has', () => {
    const t = sanitiseTracing(raw({ layers: [layer(1, { shapes: [{ kind: 'circle', centre: [1, 2], radius: 3, name: 'bolt', junk: 1 }] })] }))
    expect(t?.layers[0].shapes).toEqual([{ kind: 'circle', centre: [1, 2], radius: 3, name: 'bolt' }])
  })

  it('keeps hidden only as true, and a part list of names', () => {
    const t = sanitiseTracing(raw({ parts: ['block', 4, 'lid'], layers: [layer(1, { hidden: true }), layer(2, { hidden: 'yes' })] }))
    expect(t?.parts).toEqual(['block', 'lid'])
    expect(t?.layers.map((l) => l.hidden)).toEqual([true, undefined])
  })

  it('keeps a whole photo and drops one that is not', () => {
    const photo = { file: 'p-0123456789ab.jpg', sha256: 'a'.repeat(64), width: 4000, height: 3000, pairs: [{ photo: [1, 2], uv: [3, 4] }, { photo: [5, 6], uv: [7, 8], snap: { corner: [7, 8] } }], method: 'similar', fade: 0.25, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1], scale: 2, angle: 1.5 }
    expect(sanitiseTracing(raw({ photo }))?.photo).toMatchObject({ file: 'p-0123456789ab.jpg', width: 4000, fade: 0.25, method: 'similar', pairs: [{ photo: [1, 2], uv: [3, 4] }, { photo: [5, 6], uv: [7, 8], snap: { corner: [7, 8] } }] })
    // The pairs of a photo that was swapped have the tracing's side only, and a snap is read in each of its forms.
    const swapped = { ...photo, pairs: [{ uv: [3, 4], snap: { centre: 'block/E14' } }, { uv: [5, 6], snap: { centre: [5, 6] } }, { uv: [7, 8], snap: { vertex: 'block/V3' } }, { photo: ['x', 1], uv: [1, 1] }, { uv: [9, 9], snap: { corner: 'block/V1' } }] }
    expect(sanitiseTracing(raw({ photo: swapped }))?.photo?.pairs).toEqual([{ uv: [3, 4], snap: { centre: 'block/E14' } }, { uv: [5, 6], snap: { centre: [5, 6] } }, { uv: [7, 8], snap: { vertex: 'block/V3' } }, { uv: [9, 9] }])
    expect(sanitiseTracing(raw({ photo: { ...photo, file: '../../etc/passwd' } }))?.photo).toBeUndefined()
    expect(sanitiseTracing(raw({ photo: { ...photo, sha256: 'zz' } }))?.photo).toBeUndefined()
    expect(sanitiseTracing(raw({ photo: { ...photo, width: 0 } }))?.photo).toBeUndefined()
    expect(sanitiseTracing(raw({ photo: { ...photo, fade: 7 } }))?.photo?.fade).toBe(1)
  })
})

describe('readTracingsFile', () => {
  it('is null for a value that is no tracings file', () => {
    expect(readTracingsFile(null)).toBeNull()
    expect(readTracingsFile({ next: 2 })).toBeNull()
    expect(readTracingsFile([])).toBeNull()
  })

  it('raises next above every T<n> the file holds', () => {
    const got = readTracingsFile({ next: 1, tracings: [raw({ id: 'T4' })] })
    expect(got?.file.next).toBe(5)
    expect(got?.dropped).toBe(0)
  })

  it('keeps next when it is higher, and starts at 1 when it is not a number', () => {
    expect(readTracingsFile({ next: 9, tracings: [raw()] })?.file.next).toBe(9)
    expect(readTracingsFile({ next: 'x', tracings: [] })?.file.next).toBe(1)
    expect(readTracingsFile({ next: -4, tracings: [] })?.file.next).toBe(1)
  })

  it('keeps next above the id of a tracing it had to drop', () => {
    const got = readTracingsFile({ next: 1, tracings: [raw({ id: 'T7', layout: '' })] })
    expect(got?.file.tracings).toEqual([])
    expect(got?.file.next).toBe(8)
    expect(got?.dropped).toBe(1)
  })

  it('leaves out a tracing of an id used once already, and counts it', () => {
    const got = readTracingsFile({ next: 3, tracings: [raw(), raw({ name: 'again' })] })
    expect(got?.file.tracings).toHaveLength(1)
    expect(got?.dropped).toBe(1)
  })

  it('counts what it left out of a tracing', () => {
    const got = readTracingsFile({ next: 3, tracings: [raw({ layers: [layer(1), layer(2, { colour: 'red' })] })] })
    expect(got?.file.tracings[0].layers).toHaveLength(1)
    expect(got?.dropped).toBe(1)
  })

  it('keeps no more than the caps', () => {
    const many = Array.from({ length: MOST_TRACINGS + 3 }, (_, i) => raw({ id: `T${i + 1}`, layers: [] }))
    const got = readTracingsFile({ next: 1, tracings: many })
    expect(got?.file.tracings).toHaveLength(MOST_TRACINGS)
    expect(got?.dropped).toBe(3)
    expect(got?.file.next).toBe(MOST_TRACINGS + 4)
    const layers = Array.from({ length: MOST_LAYERS + 2 }, (_, i) => layer(i + 1, { shapes: [] }))
    expect(readTracingsFile({ next: 1, tracings: [raw({ layers })] })?.file.tracings[0].layers).toHaveLength(MOST_LAYERS)
  })
})

describe('loadTracingsFile', () => {
  const now = () => new Date('2026-11-17T12:00:00.000Z')

  it('reads no file as no tracings and writes nothing', async () => {
    rmSync(join(dir, '.torno'), { recursive: true })
    const got = await loadTracingsFile(dir, now)
    expect(got).toEqual({ file: { next: 1, tracings: [] }, text: null })
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('reads a good file, with its text, and writes nothing', async () => {
    const text = `${JSON.stringify({ next: 2, tracings: [raw()] })}\n`
    writeFileSync(path(), text)
    const got = await loadTracingsFile(dir, now)
    expect(got.problem).toBeUndefined()
    expect(got.text).toBe(text)
    expect(got.file.tracings.map((t) => t.id)).toEqual(['T1'])
    expect(readFileSync(path(), 'utf8')).toBe(text)
    expect(asides('tracings.json.')).toEqual([])
  })

  it('keeps a file that is not JSON aside, starts a new list past its ids and says so', async () => {
    writeFileSync(path(), '{"next": 3, "tracings": [{"id": "T9", "name": ')
    const got = await loadTracingsFile(dir, now)
    expect(got.problem).toMatch(/could not be read.*tracings\.json\.corrupt-2026-11-17T12-00-00-000Z/)
    expect(got.file).toEqual({ next: 10, tracings: [] })
    expect(asides('tracings.json.corrupt-')).toEqual(['tracings.json.corrupt-2026-11-17T12-00-00-000Z'])
    expect(readFileSync(join(dir, '.torno', 'tracings.json.corrupt-2026-11-17T12-00-00-000Z'), 'utf8')).toContain('"T9"')
    expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual({ next: 10, tracings: [] })
    expect(got.text).toBe(readFileSync(path(), 'utf8'))
  })

  it('keeps a file that is valid JSON but no tracings file aside as well', async () => {
    writeFileSync(path(), '[1, 2]')
    const got = await loadTracingsFile(dir, now)
    expect(got.problem).toMatch(/could not be read/)
    expect(asides('tracings.json.corrupt-')).toHaveLength(1)
  })

  it('keeps a file some of whose tracings were not whole aside as dropped, and rewrites the rest', async () => {
    writeFileSync(path(), JSON.stringify({ next: 3, tracings: [raw(), raw({ id: 'T2', layout: '' })] }))
    const got = await loadTracingsFile(dir, now)
    expect(got.problem).toMatch(/not whole/)
    expect(got.problem).toMatch(/tracings\.json\.dropped-/)
    expect(got.file.tracings.map((t) => t.id)).toEqual(['T1'])
    expect(JSON.parse(readFileSync(path(), 'utf8')).next).toBe(3)
    expect(asides('tracings.json.dropped-')).toHaveLength(1)
  })

  it('does not read a link in its place', async () => {
    writeFileSync(join(root, 'elsewhere.json'), JSON.stringify({ next: 2, tracings: [raw()] }))
    symlinkSync(join(root, 'elsewhere.json'), path())
    const got = await loadTracingsFile(dir, now)
    expect(got.file).toEqual({ next: 1, tracings: [] })
    expect(got.text).toBeNull()
    expect(got.problem).toMatch(/not a plain file/)
    expect(asides('tracings.json.')).toEqual([])
  })
})

describe('saveTracingsFile', () => {
  it('writes the file whole, readable again, and leaves out what a run does not carry', async () => {
    const file = readTracingsFile({ next: 3, tracings: [raw()] })?.file as TracingsFile
    file.tracings[0].revision = 12
    await saveTracingsFile(dir, file)
    const text = readFileSync(path(), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toContain('"revision": 12')
    expect(JSON.parse(text).next).toBe(3)
    expect((await loadTracingsFile(dir)).file.tracings[0].layers).toHaveLength(2)
  })

  it('writes the text textOf says, so that a change is told from the disk by text', async () => {
    const file = readTracingsFile({ next: 3, tracings: [raw()] })?.file as TracingsFile
    await saveTracingsFile(dir, file)
    expect(readFileSync(path(), 'utf8')).toBe(textOf(file))
  })

  it('refuses a link in the place of .torno', async () => {
    rmSync(join(dir, '.torno'), { recursive: true })
    mkdirSync(join(root, 'out'))
    symlinkSync(join(root, 'out'), join(dir, '.torno'))
    await expect(saveTracingsFile(dir, { next: 1, tracings: [] })).rejects.toThrow(/is a link/)
    expect(readdirSync(join(root, 'out'))).toEqual([])
  })
})
