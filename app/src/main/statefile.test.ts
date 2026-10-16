import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildState } from '../shared/build'
import type { Mark } from '../shared/marks'
import type { ScanAlignment, ScanInfo } from '../shared/scans'
import type { Part, Scene } from '../shared/scene'
import type { SavedView } from '../shared/views'
import type { ObjectInfo } from '../shared/workspace'
import { StateFiles, stateText, writtenLine } from './statefile'

const part = (layout: string, name: string, min: number[], max: number[]): Part => ({ key: `${layout}:${name}`, name, layout, bbox: { min, max }, bboxExact: true, volumeExact: true }) as Part
const SCENE: Scene = {
  model: 'bracket.py',
  layouts: ['assembly', 'print'],
  parts: [part('assembly', 'base', [-20, -15, -2.5], [20, 15, 2.5]), part('assembly', 'post', [-3.9975, -3.999, 2.5], [3.9975, 3.999, 22.5]), part('print', 'base', [-20, -15, 0], [20, 15, 5.00004])],
  seconds: 0.8,
  output: ''
}
const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 3, seconds: 0.8123, stale: false }
const CAMERA = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const pin = (n: number, over: object = {}): Mark =>
  ({ id: `M${n}`, kind: 'pin', author: 'user', note: `note ${n}`, status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 3, camera: CAMERA, createdAt: 't', checkedRevision: 3, anchor: { point: [n, 0, 5], part: 'base', ref: 'base/F1' }, ...over }) as Mark

// As in mcp/scanTools.test.ts: four pairs clicked on a part, so that a build can say whether the alignment holds.
const pairs = [1.8, 3.4, 0.9, 1.2].map((residual) => ({ scan: [0, 0, 0] as [number, number, number], model: [0, 0, 0] as [number, number, number], part: 'base', residual }))
const BY_PAIRS: ScanAlignment = { transform: { t: [1, 2, 3], q: [0, 0, 0, 1], s: 1 }, steps: ['pairs'], pairs, rms: 2.1, frame: {}, at: '' }
const TYPED: ScanAlignment = { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['typed'], frame: {}, at: '' }
const checkedOn = (alignments: Record<string, ScanAlignment>, revision = 3) => Object.fromEntries(Object.keys(alignments).map((layout) => [layout, { revision, of: 4, off: 0, worst: 0, moved: [] }]))
const scan = (id: string, alignments: Record<string, ScanAlignment> = {}, more: Partial<ScanInfo> = {}): ScanInfo =>
  ({ id, name: `${id}.glb`, source: { path: `/dl/${id}.glb`, bytes: 1, mtimeMs: 1, sha256: '' }, imported: { unit: 'm', up: 'y', assumed: { unit: true, up: true }, vertices: 936823, triangles: 1607144, colours: 'texture', bbox: { min: [-1258.9, -1175.3, 0], max: [1258.9, 1175.3, 1493.6] }, area: 1, at: '' }, alignments, sourceState: 'present', meshState: 'ok', checks: checkedOn(alignments), ...more }) as ScanInfo
const REGION = { id: 'M7', kind: 'region', scan: 'S1', author: 'user', note: 'wiring loom', status: 'sent', anchorState: 'ok', layout: 'print', revision: 3, camera: CAMERA, createdAt: '', triangles: 4812, area: 31000, local: { centroid: [0, 0, 0], bbox: { min: [0, 0, 0], max: [1, 1, 1] }, plane: { origin: [0, 0, 0], normal: [0, 0, 1], rms: 1 }, box: { centre: [0.5, 0.5, 0.5], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [0.5, 0.5, 0.5] } } } as unknown as Mark

let root: string
let obj: ObjectInfo

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-state-'))
  obj = { id: 'bracket', name: 'bracket', dir: root, model: 'bracket.py' }
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

describe('stateText', () => {
  it('writes ≈ before the size of a part whose box the kernel does not say is exact', () => {
    const loft = { ...part('assembly', 'stand', [-64.4355, 0, 0], [65, 207.96, 120]), bboxExact: false }
    const old = { ...part('assembly', 'legacy', [0, 0, 0], [1, 2, 3]), bboxExact: undefined }
    const text = stateText(obj, OK, { revision: 3, scene: { ...SCENE, layouts: ['assembly'], parts: [SCENE.parts[0], loft, old as Part] } }, [])
    expect(text).toContain('- assembly: base 40 × 30 × 5 mm, stand ≈ 129.4 × 208 × 120 mm, legacy ≈ 1 × 2 × 3 mm')
    expect(text).toContain('A size with ≈ is approximate')
    // Where every size is exact nothing is said of it.
    expect(stateText(obj, OK, { revision: 3, scene: SCENE }, [])).not.toContain('≈')
  })

  it("names the model's groups of parts in each layout that has any of their parts, before the parts", () => {
    const parts = [part('assembly', 'flat-a', [0, 0, 0], [10, 10, 2]), part('assembly', 'flat-b', [20, 0, 0], [30, 10, 2]), part('assembly', 'key', [0, 30, 0], [4, 34, 4]), part('print', 'key', [0, 30, 0], [4, 34, 4])]
    const scene = { ...SCENE, layouts: ['assembly', 'print'], parts, groups: [{ name: 'flat', parts: ['flat-a', 'flat-b'] }] }
    const text = stateText(obj, OK, { revision: 3, scene }, [])
    expect(text).toContain('- assembly: groups flat (flat-a, flat-b); flat-a 10 × 10 × 2 mm, flat-b 10 × 10 × 2 mm, key 4 × 4 × 4 mm')
    expect(text).toContain('- print: key 4 × 4 × 4 mm')
    expect(stateText(obj, OK, { revision: 3, scene: SCENE }, [])).not.toContain('groups')
  })

  it('names the saved views, and of each whether the agent proposed it or a part of it is gone', () => {
    const view = (name: string, more: Partial<SavedView> = {}): SavedView => ({ name, author: 'user', layout: 'assembly', camera: CAMERA as SavedView['camera'], hidden: [], at: '', ...more })
    const none = stateText(obj, OK, { revision: 3, scene: SCENE }, [])
    expect(none).not.toContain('Saved views')
    expect(stateText(obj, OK, { revision: 3, scene: SCENE }, [], undefined, [])).toBe(none)
    const text = stateText(obj, OK, { revision: 3, scene: SCENE }, [], undefined, [view('Hinge side'), view('Wall at the latch', { author: 'agent', proposed: true }), view('Kept', { author: 'agent' }), view('Old', { layout: 'bed' }), view('Less', { hidden: ['post', 'clip'] })])
    expect(text).toContain('- print: base 40 × 30 × 5 mm\n\nSaved views: "Hinge side", "Wall at the latch" (proposed by the agent), "Kept", "Old" (of layout bed, which the model no longer has), "Less" (hides clip, which layout assembly no longer has).\n\n## Marks')
    // Before anything is built, nothing can be said to be gone.
    expect(stateText(obj, OK, undefined, [], undefined, [view('Old', { layout: 'bed' })])).toContain('Saved views: "Old".')
  })

  it('says how the build stands, what each layout holds and every mark that is not resolved', () => {
    const marks = [pin(1), pin(2, { status: 'resolved' }), pin(3, { author: 'agent', status: 'sent', layout: 'print' }), pin(4, { status: 'sent', anchorState: 'orphaned' })]
    expect(stateText(obj, OK, { revision: 3, scene: SCENE }, marks)).toBe(
      [
        '# bracket',
        '',
        'torno keeps this file: it is rewritten after every build and every change of the marks or the scans. Do not edit it.',
        'Lengths are millimetres, Z up, in the frame of the layout named.',
        '',
        '## Build',
        '',
        'Build ok, r3.',
        '',
        '## Layouts and parts',
        '',
        'Model: bracket.py, r3.',
        '',
        '- assembly: base 40 × 30 × 5 mm, post 8 × 8 × 20 mm',
        '- print: base 40 × 30 × 5 mm',
        '',
        '## Marks',
        '',
        'What the user and the agent have pointed at and not resolved. `lid/F12` is face 12 of the part lid, `lid/E3` its edge 3, in the layout the mark is in.',
        '',
        'In layout assembly:',
        '',
        '- M1 pin on base/F1 at (1, 0, 5): "note 1"',
        '- M4 pin placed on base/F1 at (4, 0, 5): "note 4" [its part is gone]',
        '',
        'In layout print:',
        '',
        '- (yours) M3 pin on base/F1 at (3, 0, 5): "note 3"',
        ''
      ].join('\n')
    )
  })

  it('says of a mark that nothing has checked it against the build the parts are of', () => {
    const text = stateText(obj, OK, { revision: 3, scene: SCENE }, [pin(1, { checkedRevision: 2 }), pin(2)])
    expect(text).toContain('- M1 pin on base/F1 at (1, 0, 5): "note 1" [not checked against r3]\n- M2 pin on base/F1 at (2, 0, 5): "note 2"\n')
  })

  it('lists the dimensions with the marks of their layout: each its value and verdict as of the build, or that it has none of it', () => {
    const dim = (n: number, over: object = {}): Mark =>
      ({ ...pin(n, { status: 'sent', note: '' }), kind: 'dimension', measure: 'diameter', a: { point: [n, 0, 5], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder', measuredRevision: 3, ...over }) as Mark
    const marks = [
      pin(1),
      dim(2, { expected: 8.5, verdict: 'fail' }),
      dim(3, { expected: 8, verdict: 'pass', layout: 'print' }),
      dim(4, { status: 'draft' }),
      dim(5, { expected: 8, verdict: 'pass', measuredRevision: 2 }),
      dim(6, { anchorState: 'drifted', expected: 8, verdict: 'pass' }),
      dim(7, { anchorState: 'orphaned', expected: 8, verdict: 'pass' }),
      dim(8, { status: 'resolved', expected: 8, verdict: 'pass' })
    ]
    const text = stateText(obj, OK, { revision: 3, scene: SCENE }, marks)
    expect(text.slice(text.indexOf('In layout assembly:'))).toBe(
      [
        'In layout assembly:',
        '',
        '- M1 pin on base/F1 at (1, 0, 5): "note 1"',
        '- M2 diameter 8 mm, base/F9 (expected 8.5 ± 0.05: FAIL, 0.5 under)',
        '- M4 diameter 8 mm, base/F9',
        '- M5 diameter: not measured on r3 (was 8 mm on r2), base/F9 (expected 8 ± 0.05)',
        '- M6 diameter 8 mm, base/F9 (expected 8 ± 0.05: pass) [moved since it was placed: check it]',
        '- M7 diameter: not measurable, [its part is gone]',
        '',
        'In layout print:',
        '',
        '- M3 diameter 8 mm, base/F9 (expected 8 ± 0.05: pass)',
        ''
      ].join('\n')
    )
  })

  it('gives the error of a build that failed, and says which build the parts are of', () => {
    const traceback = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 3, stale: true, error: { kind: 'exception', message: "NameError: name 'Boxx' is not defined", traceback } }
    const text = stateText(obj, failed, { revision: 3, scene: SCENE }, [])
    expect(text).toContain("## Build\n\nBUILD FAILED. The parts below are those of r3, the last build that worked.\n\n```\nNameError: name 'Boxx' is not defined\nline 9\n")
    expect(text).toContain('line 20\n```\n')
    expect(text).not.toContain('line 8\n')
    expect(text).toContain('## Marks\n\nNone.\n')
  })

  it('lists the scans after the parts, each with how it is aligned in every layout, and tells regions with the marks', () => {
    const text = stateText(obj, OK, { revision: 3, scene: SCENE }, [REGION], [scan('S1', { print: BY_PAIRS }), scan('S2')])
    expect(text).toContain(
      [
        '## Scans',
        '',
        'A scan is a mesh of the real surroundings: nothing from it is exact.',
        '',
        '- S1 S1.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed); source /dl/S1.glb; aligned in print by 4 pairs (RMS 2.1 mm, worst 3.4 mm); not aligned in assembly.',
        '- S2 S2.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed); source /dl/S2.glb; not aligned in assembly, print.',
        '',
        '## Marks'
      ].join('\n')
    )
    expect(text).toContain('- M7 region on scan S1: 4,812 triangles')
    expect(text).toContain('it is rewritten after every build and every change of the marks or the scans.')
    expect(text.indexOf('## Scans')).toBeGreaterThan(text.indexOf('## Layouts and parts'))
    expect(stateText(obj, OK, { revision: 3, scene: SCENE }, [], [])).not.toContain('## Scans')
    expect(stateText(obj, OK, { revision: 3, scene: SCENE }, [])).not.toContain('## Scans')
  })

  it('says of a scan what the tools say of it: a mesh or a source that is gone, and an alignment for what it is worth', () => {
    const lines = (scans: ScanInfo[], revision = 3) => stateText(obj, OK, { revision, scene: SCENE }, [], scans).split('\n').filter((line) => line.startsWith('- S'))
    expect(lines([scan('S1', {}, { sourceState: 'missing' })])).toEqual(['- S1 S1.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed); source /dl/S1.glb (missing); not aligned in assembly, print.'])
    expect(lines([scan('S1', {}, { sourceState: 'changed', meshState: 'missing' })])[0]).toBe('- S1 S1.glb: MESH MISSING, 2518 × 2351 × 1494 mm, from m, Y up (assumed); source /dl/S1.glb (changed since it was read); not aligned in assembly, print.')
    // What the model moved under, in the words every tool uses.
    const off = scan('S1', { assembly: BY_PAIRS }, { checks: { assembly: { revision: 3, of: 4, off: 2, worst: 6.2, moved: [] } } })
    expect(lines([off])[0]).toContain('; aligned in assembly by 4 pairs (RMS 2.1 mm, worst 3.4 mm) but the model is no longer under 2 of its 4 points (worst 6.2 mm off) on r3: check the alignment; not aligned in print.')
    // Not checked against the build the parts are of: never told as holding.
    expect(lines([scan('S1', { assembly: BY_PAIRS })], 4)[0]).toContain('; aligned in assembly by 4 pairs (RMS 2.1 mm, worst 3.4 mm) (not checked against r4); not aligned in print.')
    // By hand, tied to no point of the model; and in both layouts: nothing is "not aligned".
    const both = lines([scan('S1', { assembly: TYPED, print: BY_PAIRS })])[0]
    expect(both).toContain('; aligned in assembly by hand (typed values) (tied to no point of the model: not checked against builds); aligned in print by 4 pairs (RMS 2.1 mm, worst 3.4 mm).')
    expect(both).not.toContain('not aligned')
    // An alignment in a layout the build no longer has is not passed over.
    expect(lines([scan('S1', { old: BY_PAIRS })])[0]).toContain('; not aligned in assembly, print; aligned in old, which r3 does not have.')
  })

  it('lists the scans before anything is built, with the layouts each is aligned in', () => {
    const building: BuildState = { objectId: 'bracket', status: 'building', revision: 0, startedAt: 1000, stale: true }
    const text = stateText(obj, building, undefined, [], [scan('S1', { print: BY_PAIRS }), scan('S2')])
    expect(text).toContain('- S1 S1.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed); source /dl/S1.glb; aligned in: print.\n- S2 S2.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed); source /dl/S2.glb; aligned in no layout.\n')
  })

  it('says so while a build runs and before anything was built, with nothing that changes by itself', () => {
    const building: BuildState = { objectId: 'bracket', status: 'building', revision: 3, startedAt: 1000, stale: true }
    expect(stateText(obj, building, { revision: 3, scene: SCENE }, [])).toContain('A build is running. The parts below are those of r3, the last build that worked.')
    const first = stateText(obj, { ...building, revision: 0 }, undefined, [])
    expect(first).toContain('A build is running. Nothing has been built yet.')
    expect(first).toContain('## Layouts and parts\n\nNothing has been built yet.\n')
    expect(stateText(obj, { objectId: 'bracket', status: 'idle', revision: 0, stale: false }, undefined, [])).toContain('## Build\n\nNot built yet.\n')
  })
})

describe('StateFiles', () => {
  const path = () => join(root, '.torno', 'state.md')
  let build: BuildState | undefined
  let marks: Mark[]
  let writes: number
  let files: StateFiles

  beforeEach(() => {
    build = OK
    marks = [pin(1)]
    writes = 0
    files = new StateFiles({
      object: (id) => (id === 'bracket' ? obj : undefined),
      build: (id) => (id === 'bracket' ? build : undefined),
      scene: () => ({ revision: 3, scene: SCENE }),
      marks: async () => marks,
      delayMs: 20,
      now: () => new Date(Date.UTC(2026, 9, 9, 4, 30, writes)),
      write: async (file, text) => {
        writes += 1
        const { writeFileAtomic } = await import('./atomic')
        return writeFileAtomic(file, text)
      }
    })
  })

  it('names the saved views it is given, and writes without them when they cannot be read', async () => {
    const view = { name: 'Hinge side', author: 'user', layout: 'assembly', camera: CAMERA, hidden: [], at: '' } as unknown as SavedView
    const withViews = (views: () => Promise<SavedView[]>) => new StateFiles({ object: () => obj, build: () => build, scene: () => ({ revision: 3, scene: SCENE }), marks: async () => marks, views })
    await withViews(async () => [view]).write('bracket')
    expect(readFileSync(path(), 'utf8')).toContain('Saved views: "Hinge side".')
    await withViews(async () => Promise.reject(new Error('EACCES'))).write('bracket')
    expect(readFileSync(path(), 'utf8')).not.toContain('Saved views')
  })

  it('lists the scans of the object, whether or not a region is among the marks, and writes without them when they cannot be read', async () => {
    const withScans = (scans: () => Promise<ScanInfo[]>) =>
      new StateFiles({ object: () => obj, build: () => build, scene: () => ({ revision: 3, scene: SCENE }), marks: async () => marks, scans })
    await withScans(async () => [scan('S1', { print: BY_PAIRS })]).write('bracket')
    expect(readFileSync(path(), 'utf8')).toContain('## Scans\n\nA scan is a mesh of the real surroundings: nothing from it is exact.\n\n- S1 S1.glb: ')
    await withScans(async () => Promise.reject(new Error('scans.json cannot be read'))).write('bracket')
    const text = readFileSync(path(), 'utf8')
    expect(text).not.toContain('## Scans')
    expect(text).toContain('- M1 pin on base/F1')
  })

  it('writes the file whole, through a temp file that is gone afterwards', async () => {
    await files.write('bracket')
    const first = 'Written by torno at 2026-10-09T04:30:00.000Z; it is only current while torno is running.'
    expect(readFileSync(path(), 'utf8')).toBe(`${first}\n\n${stateText(obj, OK, { revision: 3, scene: SCENE }, marks)}`)
    expect(readdirSync(join(root, '.torno'))).toEqual(['state.md'])
  })

  it('says in its first line when it was written, and that it is only current while torno runs', () => {
    expect(writtenLine(new Date('2026-10-09T04:30:00Z'))).toBe('Written by torno at 2026-10-09T04:30:00.000Z; it is only current while torno is running.')
  })

  it('writes once for a burst of changes, a moment after the last', async () => {
    for (let i = 0; i < 5; i += 1) files.changed('bracket')
    expect(writes).toBe(0)
    await vi.waitFor(() => expect(writes).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(writes).toBe(1)
  })

  it('waits a second by default', async () => {
    vi.useFakeTimers()
    const asked: string[] = []
    const slow = new StateFiles({ object: () => obj, build: () => OK, scene: () => undefined, marks: async () => (asked.push('marks'), []), write: async () => {} })
    slow.changed('bracket')
    await vi.advanceTimersByTimeAsync(900)
    slow.changed('bracket') // a change within the second starts the wait again
    await vi.advanceTimersByTimeAsync(900)
    expect(asked).toEqual([])
    await vi.advanceTimersByTimeAsync(100)
    expect(asked).toEqual(['marks'])
  })

  it('forgotten with the workspace, writes nothing that was still waiting', async () => {
    files.changed('bracket')
    files.forget()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(writes).toBe(0)
  })

  it('does not write what the file already says', async () => {
    await files.write('bracket')
    const before = statSync(path()).mtimeMs
    await files.write('bracket')
    expect(writes).toBe(1)
    marks = [pin(1), pin(2)]
    await files.write('bracket')
    expect(writes).toBe(2)
    expect(readFileSync(path(), 'utf8')).toContain('- M2 pin')
    // The time is that of the write that changed it.
    expect(readFileSync(path(), 'utf8').split('\n')[0]).toContain('2026-10-09T04:30:01.000Z')
    expect(statSync(path()).mtimeMs).toBeGreaterThanOrEqual(before)
  })

  it('writes the file of an earlier run again, though it says the same: its time was of that run', async () => {
    await files.write('bracket')
    files.forget() // as a new run: nothing is remembered of what was written
    await files.write('bracket')
    expect(writes).toBe(2)
    expect(readFileSync(path(), 'utf8').split('\n')[0]).toContain('2026-10-09T04:30:01.000Z')
    await files.write('bracket')
    expect(writes).toBe(2)
  })

  it('writes nothing for an object that is not open, or not known', async () => {
    build = undefined
    await files.write('bracket')
    await files.write('nothing')
    expect(writes).toBe(0)
  })

  it('logs a write that fails, and writes the next time', async () => {
    const logged: string[] = []
    let fail = true
    const failing = new StateFiles({
      object: () => obj,
      build: () => OK,
      scene: () => undefined,
      marks: async () => [],
      delayMs: 5,
      log: (message) => logged.push(message),
      write: async () => {
        if (fail) throw new Error('disk full')
        writes += 1
      }
    })
    failing.changed('bracket')
    await vi.waitFor(() => expect(logged).toEqual(['cannot write the state file of bracket: disk full']))
    fail = false
    failing.changed('bracket')
    await vi.waitFor(() => expect(writes).toBe(1))
  })
})
