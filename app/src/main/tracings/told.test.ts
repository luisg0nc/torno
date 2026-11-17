import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mainPlaneFrame } from '../../shared/planes'
import type { Tracing, TracingPhoto, TracingsFile } from '../../shared/tracings'
import { TRACINGS_LIMIT, markTracingsTold, readTracingsTold, tracingsLine } from './told'

const tracing = (over: Partial<Tracing> = {}): Tracing => ({
  id: 'T1',
  by: 'person',
  name: 'Front of the block',
  layout: 'assembly',
  createdAt: '2026-11-17T12:00:00.000Z',
  plane: { ...mainPlaneFrame('XZ', 0), from: { kind: 'main', axis: 'XZ', offset: 0 } },
  layers: [],
  nextLayer: 1,
  ...over
})
const photo = (over: Partial<TracingPhoto> = {}): TracingPhoto =>
  ({
    file: 'p-0123456789ab.jpg',
    sha256: 'aa',
    width: 4000,
    height: 3000,
    pairs: [
      { photo: [10, 10], uv: [0, 0] },
      { photo: [200, 10], uv: [40, 0] }
    ],
    method: 'similar',
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    scale: 4.7,
    angle: 0,
    fade: 0.5,
    ...over
  }) as TracingPhoto
const file = (...tracings: Tracing[]): TracingsFile => ({ next: tracings.length + 1, tracings })
const tool = (name: string): string => `mcp__torno__${name}`

describe('tracingsLine', () => {
  it('is empty and tells nothing when the project has no tracings', () => {
    expect(tracingsLine(file(), {}, tool)).toEqual({ line: '', told: {} })
  })

  it('says once that every tracing it was told of was removed, and nothing after that', () => {
    const first = tracingsLine(file(tracing(), tracing({ id: 'T2' })), {}, tool)
    const gone = tracingsLine(file(), first.told, tool)
    expect(gone).toEqual({ line: 'tracings: none (T1 was removed; T2 was removed)', told: {} })
    expect(tracingsLine(file(), gone.told, tool)).toEqual({ line: '', told: {} })
    expect(tracingsLine(file(), { T1: 'abc' }, tool).line).toBe('tracings: none (T1 was removed)')
  })

  it('names every tracing, and says they are new to the agent when it was told of none', () => {
    const said = tracingsLine(file(tracing(), tracing({ id: 'T2' })), {}, tool)
    expect(said.line).toBe('tracings: T1, T2 (new to you). Read them with mcp__torno__tracings.')
    expect(Object.keys(said.told)).toEqual(['T1', 'T2'])
  })

  it('says none changed once told, and a fade, a hidden photo or a hidden layer is not news', () => {
    const first = tracingsLine(file(tracing({ photo: photo(), layers: [{ id: 1, name: 'bolts', colour: 'teal', by: 'agent', shapes: [], revision: 1 }] }), tracing({ id: 'T2' })), {}, tool)
    const again = tracingsLine(
      file(
        tracing({ photo: photo({ fade: 0.9, hidden: true }), layers: [{ id: 1, name: 'bolts', colour: 'teal', by: 'agent', shapes: [], revision: 1, hidden: true }] }),
        tracing({ id: 'T2' })
      ),
      first.told,
      tool
    )
    expect(again.line).toBe('tracings: T1, T2 (none changed since you were told). Read them with mcp__torno__tracings.')
    expect(again.told).toEqual(first.told)
  })

  it('says a photo was lined up again, naming the tracing', () => {
    const first = tracingsLine(file(tracing({ photo: photo() }), tracing({ id: 'T2' })), {}, tool)
    const lined = photo({ pairs: [{ photo: [10, 10], uv: [0, 0] }, { photo: [300, 10], uv: [40, 0] }] as TracingPhoto['pairs'], transform: [2, 0, 0, 0, 2, 0, 0, 0, 1], scale: 9.4 })
    const again = tracingsLine(file(tracing({ photo: lined }), tracing({ id: 'T2' })), first.told, tool)
    expect(again.line).toBe("tracings: T1, T2 (1 changed since you were told: T1's photo was lined up again). Read them with mcp__torno__tracings.")
  })

  it('says what else is news: a name, a plane, a layer, a photo got or taken, a face gone, a tracing made or removed', () => {
    const base = tracingsLine(file(tracing(), tracing({ id: 'T2' })), {}, tool)
    const line = (...tracings: Tracing[]): string => tracingsLine(file(...tracings), base.told, tool).line
    expect(line(tracing({ name: 'Back' }), tracing({ id: 'T2' }))).toContain('T1 was renamed')
    expect(line(tracing({ plane: { ...mainPlaneFrame('XZ', 5), from: { kind: 'main', axis: 'XZ', offset: 5 } } }), tracing({ id: 'T2' }))).toContain("T1's plane changed")
    expect(line(tracing({ layers: [{ id: 1, name: 'bolts', colour: 'teal', by: 'agent', shapes: [], revision: 1 }] }), tracing({ id: 'T2' }))).toContain("T1's layers changed")
    expect(line(tracing({ layers: [] }), tracing({ id: 'T2', photo: photo() }))).toContain('T2 got a photo')
    expect(line(tracing({ lost: 'block/F31 is not in this plane any more' }), tracing({ id: 'T2' }))).toContain("T1's face is no longer in its plane")
    expect(line(tracing(), tracing({ id: 'T2' }), tracing({ id: 'T3' }))).toContain('T3 is new')
    expect(line(tracing())).toContain('T2 was removed')
    expect(line(tracing({ name: 'Back', layers: [{ id: 1, name: 'b', colour: 'teal', by: 'agent', shapes: [], revision: 1 }] }), tracing({ id: 'T2' }))).toContain('1 changed since you were told: T1 changed: name, layers')
  })

  it('a swapped photo or a lined-up one taken away is told as such', () => {
    const lined = tracingsLine(file(tracing({ photo: photo() })), {}, tool).told
    expect(tracingsLine(file(tracing()), lined, tool).line).toContain("T1's photo was removed")
    expect(tracingsLine(file(tracing({ photo: photo({ sha256: 'bb', transform: undefined, scale: undefined, pairs: [] }) })), lined, tool).line).toContain("T1's photo changed")
  })

  it('keeps to its limit with 50 tracings, naming a few and counting the rest', () => {
    const many = Array.from({ length: 50 }, (_, i) => tracing({ id: `T${i + 1}`, name: 'x'.repeat(80) }))
    const first = tracingsLine(file(...many), {}, tool)
    expect(first.line.length).toBeLessThanOrEqual(TRACINGS_LIMIT)
    expect(first.line).toContain('and 42 more')
    expect(first.line).toContain('Read them with mcp__torno__tracings.')
    expect(Object.keys(first.told)).toHaveLength(50)
    const renamed = tracingsLine(file(...many.map((t) => ({ ...t, name: 'y', layers: [{ id: 1, name: 'l', colour: 'teal', by: 'agent', shapes: [], revision: 1 } as never] }))), first.told, tool)
    expect(renamed.line.length).toBeLessThanOrEqual(TRACINGS_LIMIT)
    expect(renamed.line).toContain('50 changed since you were told')
    expect(renamed.line).toContain('and 47 more')
  })
})

describe('the file of what was told', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'torno-told-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is empty when there is none, or it does not read as a record of strings', async () => {
    expect(await readTracingsTold(dir)).toEqual({})
    mkdirSync(join(dir, '.torno', 'tracings'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'tracings', 'told.json'), '[1,2]')
    expect(await readTracingsTold(dir)).toEqual({})
    writeFileSync(join(dir, '.torno', 'tracings', 'told.json'), '{"T1":"abc","T2":4}')
    expect(await readTracingsTold(dir)).toEqual({ T1: 'abc' })
  })

  it('is written whole, and git is told to pass over it before it is there', async () => {
    await markTracingsTold(dir, { T1: 'abc.def' })
    expect(JSON.parse(readFileSync(join(dir, '.torno', 'tracings', 'told.json'), 'utf8'))).toEqual({ T1: 'abc.def' })
    expect(readFileSync(join(dir, '.torno', '.gitignore'), 'utf8')).toContain('tracings/told.json')
    expect(await readTracingsTold(dir)).toEqual({ T1: 'abc.def' })
  })

  it('writes nothing in a .torno that is a link', async () => {
    mkdirSync(join(dir, 'elsewhere'))
    const { symlinkSync } = await import('node:fs')
    symlinkSync(join(dir, 'elsewhere'), join(dir, '.torno'))
    await expect(markTracingsTold(dir, { T1: 'a' })).rejects.toThrow()
    expect(existsSync(join(dir, 'elsewhere', 'tracings'))).toBe(false)
  })
})
