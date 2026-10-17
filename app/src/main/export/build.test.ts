import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { explodeOffsets, explodeShown } from '../../shared/explode'
import { apartParts, unpackMesh } from '../../shared/exportdata'
import type { Mark } from '../../shared/marks'
import { type ScanInfo, parseScanMesh } from '../../shared/scans'
import type { Part, Scene } from '../../shared/scene'
import { box, meshBin } from '../../test/scanFixtures'
import { type ExportDeps, exportData, exportFile, exportPlan, forgetExportScans } from './build'
import type { PageAssets } from './html'

const ASSETS: PageAssets = { viewer: 'window.__ran = true', css: 'body{margin:0}', fonts: [] }

/** A scene of `tray` and `lid` in `assembly` and `print`, the same two shapes in both, and its blob. */
function built(): { scene: Scene; blob: Buffer } {
  const chunks: Buffer[] = []
  let at = 0
  const put = (values: Float32Array | Uint32Array): { offset: number; length: number } => {
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength)
    chunks.push(bytes)
    at += bytes.length
    return { offset: at - bytes.length, length: bytes.length }
  }
  const shape = (size: [number, number, number]) => {
    const mesh = box(size)
    return {
      vertices: put(new Float32Array(mesh.vertices)),
      normals: put(new Float32Array(mesh.vertices.map((c, i) => (i % 3 === 2 ? Math.sign(c) : 0)))),
      triangles: put(new Uint32Array(mesh.triangles)),
      edges: put(new Float32Array([...mesh.vertices.slice(0, 6), ...mesh.vertices.slice(6, 12)])),
      trianglesPerFace: put(new Uint32Array([2, 2, 2, 2, 2, 2])),
      segmentsPerEdge: put(new Uint32Array([1, 1])),
      faceTypes: put(new Uint32Array(6)),
      edgeTypes: put(new Uint32Array(2))
    }
  }
  const meshes = { tray: shape([40, 30, 10]), lid: shape([40, 30, 2]) }
  const part = (layout: string, name: 'tray' | 'lid', t: [number, number, number]): Part => {
    const half = name === 'tray' ? [20, 15, 5] : [20, 15, 1]
    return { key: `${layout}:${name}`, name, layout, loc: { t, q: [0, 0, 0, 1] }, bbox: { min: [t[0] - half[0], t[1] - half[1], t[2] - half[2]], max: [t[0] + half[0], t[1] + half[1], t[2] + half[2]] }, volume: 1, faceCount: 6, edgeCount: 2, triangleCount: 12, valid: true, hash: `h-${name}`, mesh: meshes[name], ...(layout === 'print' && name === 'lid' ? { arranged: [50, 0, 0] as [number, number, number] } : {}) }
  }
  const scene: Scene = { model: '/ws/hollow/hollow.py', layouts: ['assembly', 'print'], parts: [part('assembly', 'tray', [0, 0, 5]), part('assembly', 'lid', [0, 0, 11]), part('print', 'tray', [0, 0, 5]), part('print', 'lid', [50, 0, 1])], seconds: 0.1, output: 'printed by the model: /ws/hollow' }
  return { scene, blob: Buffer.concat(chunks) }
}

const camera = { position: [120, -90, 60] as [number, number, number], target: [0, 0, 6] as [number, number, number], up: [0, 0, 1] as [number, number, number], ortho: false, fov: 35, zoom: 1 }
const base = { author: 'user' as const, status: 'sent' as const, anchorState: 'ok' as const, layout: 'assembly', revision: 3, camera, createdAt: '2026-10-09T20:00:00.000Z', checkedRevision: 3 }
const MARKS: Mark[] = [
  { ...base, id: 'M1', kind: 'pin', note: 'thin wall here', anchor: { point: [0, 0, 12], part: 'lid', ref: 'lid/F3' } },
  { ...base, id: 'M2', kind: 'dimension', note: '', measure: 'distance', a: { point: [-20, 0, 5], part: 'tray', ref: 'tray/F1' }, b: { point: [20, 0, 5], part: 'tray', ref: 'tray/F2' }, value: 6, how: 'between planes', measuredRevision: 3, expected: 6, verdict: 'pass', points: [[-3, 0, 5], [3, 0, 5]] },
  { ...base, id: 'M3', kind: 'region', note: 'the number plate', scan: 'S1', triangles: 10, area: 10, local: { centroid: [0, 0, 0], bbox: { min: [0, 0, 0], max: [1, 1, 1] }, plane: { origin: [0, 0, 0], normal: [0, 0, 1], rms: 0 }, box: { centre: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [1, 1, 1] } } },
  { ...base, id: 'M4', kind: 'pin', note: 'on a part that is gone', anchorState: 'orphaned', anchor: { point: [0, 0, 0], part: 'clip' } }
]

/** A sheet of 250 × 200 squares, 100,000 triangles, with heights and colours that no deflate makes much of. */
function scanMesh(): Buffer {
  const [nx, ny] = [250, 200]
  let seed = 7
  const noise = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
  const vertices: number[] = []
  const colours: number[] = []
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    vertices.push(x + noise() * 0.4, y + noise() * 0.4, noise() * 3)
    colours.push(Math.floor(noise() * 256), Math.floor(noise() * 256), Math.floor(noise() * 256), 255)
  }
  const triangles: number[] = []
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = y * (nx + 1) + x
    triangles.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1)
  }
  return Buffer.from(meshBin({ vertices, triangles }, colours))
}
const SCAN_MESH = scanMesh()
const SCAN = {
  id: 'S1',
  name: 'Car.glb',
  source: { path: '/home/someone/Downloads/Car.glb', bytes: 1, mtimeMs: 1, sha256: 'zq9-sha-marker' },
  imported: { unit: 'mm', up: 'z', assumed: { unit: false, up: false }, vertices: 50451, triangles: 100_000, colours: 'vertex', bbox: { min: [0, 0, 0], max: [250, 200, 3] }, area: 50000, at: '' },
  alignments: { assembly: { transform: { t: [1, 2, 3], q: [0, 0, 0, 1], s: 1 }, steps: ['typed'], frame: {}, at: '' } },
  sourceState: 'present',
  meshState: 'ok',
  checks: {}
} as unknown as ScanInfo

function deps(over: Partial<ExportDeps> = {}): ExportDeps {
  const last = built()
  return {
    object: (id) => (id === 'hollow' || id === 'never-built' ? { id, name: id, dir: `/ws/${id}`, model: `${id}.py` } : undefined),
    last: (id) => (id === 'hollow' ? { revision: 3, ...last } : undefined),
    sceneFile: async () => ({
      layout: 'assembly',
      layers: { lid: { color: '#aa5500', opacity: 0.4, visible: false } },
      explode: { assembly: { amount: 0.4, scale: 1, axis: 'z' }, gone: { amount: 1, scale: 1, axis: 'x' } },
      views: [
        { name: 'Hinge side', author: 'user', layout: 'assembly', camera, hidden: [], at: '2026-10-09T21:14:03.000Z' },
        { name: 'Wall at the latch', author: 'agent', proposed: true, note: 'conversationId 12', layout: 'assembly', camera, hidden: ['lid'], at: '2026-10-09T21:20:44.000Z' }
      ]
    }),
    marks: async () => MARKS,
    scans: async () => [SCAN],
    scanMesh: async () => SCAN_MESH,
    now: () => new Date('2026-10-09T21:30:00.000Z'),
    ...over
  }
}

describe('exportData', () => {
  it('holds each shape once, the views the person has, and nothing of this machine', async () => {
    const data = await exportData(deps(), { objects: ['hollow'], marks: false, scans: [], hidden: true })
    const [object] = data.objects
    expect(object).toMatchObject({ id: 'hollow', name: 'hollow', revision: 3, layouts: ['assembly', 'print'], layout: 'assembly' })
    expect(object.parts.map((p) => [p.layout, p.name, p.mesh])).toEqual([['assembly', 'tray', 'h-tray'], ['assembly', 'lid', 'h-lid'], ['print', 'tray', 'h-tray'], ['print', 'lid', 'h-lid']])
    expect(Object.keys(object.meshes).sort()).toEqual(['h-lid', 'h-tray'])
    expect(object.parts[1]).toMatchObject({ color: '#aa5500', opacity: 0.4, visible: false })        // from the scene file's layers
    expect(object.parts[0]).toMatchObject({ color: '#C28B6C', opacity: 1, visible: true })          // the palette's: `tray` is the second name of two
    expect(object.views.map((v) => v.name)).toEqual(['Hinge side'])                                    // the proposal that was not kept is left out
    expect(object.explode).toEqual({ assembly: { amount: 0.4, scale: 1, axis: 'z' } })               // of the layouts the build has
    expect(object.marks).toBeUndefined()
    expect(object.scans).toBeUndefined()
    expect(data).toMatchObject({ format: 'torno-export', version: 1, title: 'hollow · r3', exportedAt: '2026-10-09T21:30:00.000Z', dropped: [] })
    const text = JSON.stringify(data)
    for (const secret of ['/ws/', '/home/', 'Downloads', 'Car.glb', 'conversationId', 'thin wall here', 'printed by the model', 'hollow.py', 'number plate']) expect(text).not.toContain(secret)
  })

  it('packs a part so that it comes back as it was built, to the quantum', async () => {
    const { scene, blob } = built()
    const data = await exportData(deps(), { objects: ['hollow'], marks: false, scans: [] })
    const packed = data.objects[0].meshes['h-tray']
    const { data: base64, ...header } = packed
    const back = unpackMesh(header, new Uint8Array(inflateSync(Buffer.from(base64, 'base64'))))
    const tray = scene.parts[0].mesh
    const was = new Float32Array(blob.buffer.slice(blob.byteOffset + tray.vertices.offset, blob.byteOffset + tray.vertices.offset + tray.vertices.length))
    expect(back.positions).toHaveLength(was.length)
    for (let i = 0; i < was.length; i++) expect(Math.abs(back.positions[i] - was[i])).toBeLessThanOrEqual(header.span[i % 3] / 65535)
    expect(back.triangles).toHaveLength(36)
    expect(back.edges).toHaveLength(12)
  })

  it('holds marks and scans only when asked, a scan reduced and without its source', async () => {
    const data = await exportData(deps(), { objects: ['hollow'], marks: true, scans: ['hollow/S1'], hidden: true })
    const [object] = data.objects
    // Not the region (it is of a scan, and may name what the scan shows), not the mark whose part is gone.
    expect(object.marks!.map((m) => [m.id, m.kind, m.part, m.text])).toEqual([['M1', 'pin', 'lid', undefined], ['M2', 'dimension', 'tray', '6 mm']])
    expect(object.marks![0].note).toBe('thin wall here')
    expect(object.marks![1]).toMatchObject({ verdict: 'pass', expected: '6 ± 0.05 mm', how: 'between planes', line: [[-3, 0, 5], [3, 0, 5]], at: [0, 0, 5] })
    expect(object.scans![0]).toMatchObject({ id: 'S1', name: 'Car.glb', reducedFrom: 100_000, colours: true, placed: { assembly: { t: [1, 2, 3], s: 1 } } })
    expect(object.scans![0].triangles).toBeLessThanOrEqual(60_000)
    expect(object.scans![0].triangles).toBeGreaterThan(20_000)
    const text = JSON.stringify(data)
    for (const secret of ['/home/', 'Downloads', 'sha256', 'zq9-sha-marker', 'number plate', 'part that is gone']) expect(text).not.toContain(secret)
  })

  it('gives a dimension no value and no verdict that is not of the build exported', async () => {
    const stale = MARKS.map((m) => (m.id === 'M2' ? { ...m, measuredRevision: 2 } : m)) as Mark[]
    const [object] = (await exportData(deps({ marks: async () => stale }), { objects: ['hollow'], marks: true, scans: [], hidden: true })).objects
    const m2 = object.marks!.find((m) => m.id === 'M2')!
    expect(m2.text).toBe('—')
    expect(m2.verdict).toBeUndefined()
    expect(m2.says).toBe('not measured on r3')
    // One whose ends the build moved says so; one nothing checked on this build says that.
    const moved = MARKS.map((m) => (m.id === 'M1' ? { ...m, anchorState: 'drifted' as const } : m.id === 'M2' ? { ...m, checkedRevision: 2 } : m)) as Mark[]
    const [again] = (await exportData(deps({ marks: async () => moved }), { objects: ['hollow'], marks: true, scans: [], hidden: true })).objects
    expect(again.marks!.find((m) => m.id === 'M1')).toMatchObject({ moved: true })
    expect(again.marks!.find((m) => m.id === 'M2')).toMatchObject({ unchecked: true })
  })

  it('leaves out a scan that was not ticked, one of another object, and one that is aligned nowhere the build has', async () => {
    const none = await exportData(deps(), { objects: ['hollow'], marks: false, scans: ['other/S1', 'hollow/S9'] })
    expect(none.objects[0].scans).toBeUndefined()
    const nowhere = { ...SCAN, alignments: { gone: SCAN.alignments.assembly } } as unknown as ScanInfo
    const data = await exportData(deps({ scans: async () => [nowhere] }), { objects: ['hollow'], marks: false, scans: ['hollow/S1'] })
    expect(data.objects[0].scans).toBeUndefined()
    expect(data.dropped).toEqual(['S1 of hollow left out: it is aligned in no layout of this build'])
  })
})

describe('exportFile and exportPlan', () => {
  it('exports only what was built in this run, cuts scans before anything else, and stops at the most it writes', async () => {
    await expect(exportFile(deps(), { objects: ['never-built'], marks: false, scans: [] }, ASSETS)).rejects.toThrow('Open it first: torno exports the last build of this run')
    // The scan weighs about 443 kB at 60,000 triangles, 173 kB at 30,000 and 99 kB at 15,000.
    const tight = await exportFile(deps({ budget: 150_000 }), { objects: ['hollow'], marks: false, scans: ['hollow/S1'] }, ASSETS)
    // Cut twice, it is said once, as it is in the file.
    expect(tight.dropped).toEqual(['S1 of hollow reduced to at most 15,000 triangles'])
    expect(tight.bytes).toBe(Buffer.byteLength(tight.html))
    expect(tight.bytes).toBeLessThanOrEqual(150_000)
    expect(tight.over).toBe(false)
    // What was cut is said in the file too.
    expect(tight.html).toContain('S1 of hollow reduced to at most 15,000 triangles')
    expect(tight.html).not.toContain('30,000')
    await expect(exportFile(deps({ most: 1000 }), { objects: ['hollow'], marks: false, scans: [] }, ASSETS)).rejects.toThrow('more than the')
    await expect(exportFile(deps(), { objects: [], marks: false, scans: [] }, ASSETS)).rejects.toThrow('Choose an object to export')
  })

  it('says when the parts alone are over the budget, and writes them all the same', async () => {
    const big = await exportFile(deps({ budget: 500 }), { objects: ['hollow'], marks: false, scans: [] }, ASSETS)
    expect(big.over).toBe(true)
    expect(big.dropped).toEqual([])
  })

  it('plans without refusing: what each object would give, what the file would weigh, and why one cannot be exported', async () => {
    const plan = await exportPlan(deps(), { objects: ['hollow'], marks: true, scans: [] }, ASSETS, ['hollow', 'never-built', 'nobody'])
    expect(plan.objects).toEqual([
      // The lid is switched off: it is left out, and said. Triangles are of what goes.
      { id: 'hollow', exportable: true, revision: 3, triangles: 12, layouts: ['assembly', 'print'], parts: 1, off: 1, views: ['Hinge side'], marks: 0, dimensions: 1, drafts: 0, resolved: 0, scans: [{ id: 'S1', name: 'Car.glb', triangles: 100_000 }] },
      { id: 'never-built', exportable: false, why: 'Open it first: torno exports the last build of this run', scans: [] },
      { id: 'nobody', exportable: false, why: 'There is no object of that name', scans: [] }
    ])
    expect(plan.bytes).toBeGreaterThan(500)
    expect(plan).toMatchObject({ dropped: [], over: false })
    expect(plan.refusal).toBeUndefined()
    const none = await exportPlan(deps(), { objects: [], marks: false, scans: [] }, ASSETS, ['hollow'])
    expect(none).toMatchObject({ bytes: 0, budget: 12 * 1024 * 1024, refusal: 'Choose an object to export' })
    const most = await exportPlan(deps({ most: 1000 }), { objects: ['hollow'], marks: false, scans: [] }, ASSETS, ['hollow'])
    expect(most.refusal).toMatch(/^The export would be .* more than the .* torno writes in one file\. Export fewer objects\.$/)
  })
})

describe('what the person switched off or settled stays here unless they say otherwise', () => {
  it('leaves out a part that is switched off, its mesh and the marks on it, unless parts switched off are ticked', async () => {
    const [object] = (await exportData(deps(), { objects: ['hollow'], marks: true, scans: [] })).objects
    expect(object.parts.map((p) => [p.layout, p.name])).toEqual([['assembly', 'tray'], ['print', 'tray']])
    expect(Object.keys(object.meshes)).toEqual(['h-tray'])
    // M1 is on the lid: it has nothing to be on in the file.
    expect(object.marks!.map((m) => m.id)).toEqual(['M2'])
    const [all] = (await exportData(deps(), { objects: ['hollow'], marks: true, scans: [], hidden: true })).objects
    expect(all.parts).toHaveLength(4)
    expect(all.parts[1]).toMatchObject({ name: 'lid', visible: false })
    expect(all.marks!.map((m) => m.id)).toEqual(['M1', 'M2'])
  })

  it('leaves out resolved marks unless they are ticked, takes drafts with the marks, and the plan counts each', async () => {
    const more = [...MARKS, { ...MARKS[0], id: 'M5', status: 'resolved', note: 'done long ago', anchor: { point: [0, 0, 0], part: 'tray' } }, { ...MARKS[0], id: 'M6', status: 'draft', note: 'not sent yet', anchor: { point: [0, 0, 0], part: 'tray' } }, { ...MARKS[1], id: 'M7', status: 'resolved' }] as Mark[]
    const made = deps({ marks: async () => more })
    const [object] = (await exportData(made, { objects: ['hollow'], marks: true, scans: [], hidden: true })).objects
    expect(object.marks!.map((m) => [m.id, m.status])).toEqual([['M1', 'sent'], ['M2', 'sent'], ['M6', 'draft']])
    expect(JSON.stringify(object)).not.toContain('done long ago')
    const [withResolved] = (await exportData(made, { objects: ['hollow'], marks: true, scans: [], hidden: true, resolved: true })).objects
    expect(withResolved.marks!.map((m) => m.id)).toEqual(['M1', 'M2', 'M5', 'M6', 'M7'])
    const plan = await exportPlan(made, { objects: ['hollow'], marks: true, scans: [], hidden: true }, ASSETS)
    expect(plan.objects[0]).toMatchObject({ parts: 2, off: 1, triangles: 24, marks: 2, dimensions: 1, drafts: 1, resolved: 2 })
    expect((await exportPlan(made, { objects: ['hollow'], marks: true, scans: [], hidden: true, resolved: true }, ASSETS)).objects[0]).toMatchObject({ marks: 3, dimensions: 2, drafts: 1, resolved: 2 })
  })

  it('says of an object whose model has failed since that the file is of its last good build', async () => {
    const plan = await exportPlan(deps({ failing: () => true }), { objects: ['hollow'], marks: false, scans: [] }, ASSETS)
    expect(plan.objects[0]).toMatchObject({ exportable: true, revision: 3, failed: true })
    expect((await exportPlan(deps(), { objects: ['hollow'], marks: false, scans: [] }, ASSETS)).objects[0].failed).toBeUndefined()
  })
})

describe('names that every object has a property of', () => {
  it('are parts and layouts like any other, and leave nothing behind in main', async () => {
    const { scene, blob } = built()
    const names = ['constructor', 'toString', '__proto__', 'hasOwnProperty']
    const odd: Scene = { ...scene, layouts: ['__proto__', 'constructor'], parts: names.flatMap((name, n) => ['__proto__', 'constructor'].map((layout) => ({ ...scene.parts[n % 2], key: `${layout}:${name}`, name, layout }))) }
    const marks = names.map((part, n) => ({ ...MARKS[0], id: `M${n + 1}`, layout: n % 2 ? 'constructor' : '__proto__', anchor: { point: [0, 0, 0], part } })) as Mark[]
    const layers = JSON.parse('{"__proto__": {"visible": false}, "toString": {"opacity": 0.5}}')
    const made = deps({ last: () => ({ revision: 3, scene: odd, blob }), marks: async () => marks, sceneFile: async () => ({ layout: '__proto__', layers, explode: JSON.parse('{"__proto__": {"amount": 0.3, "scale": 1, "axis": "x"}}') }) })
    const [object] = (await exportData(made, { objects: ['hollow'], marks: true, scans: [], hidden: true })).objects
    expect(object.layouts).toEqual(['__proto__', 'constructor'])
    expect(object.layout).toBe('__proto__')
    expect(object.parts.map((p) => p.name)).toEqual(['constructor', 'constructor', 'toString', 'toString', '__proto__', '__proto__', 'hasOwnProperty', 'hasOwnProperty'])
    for (const part of object.parts) expect(part.color).toMatch(/^#[0-9A-F]{6}$/)
    expect(object.parts.find((p) => p.name === '__proto__')).toMatchObject({ visible: false })
    expect(object.parts.find((p) => p.name === 'toString')).toMatchObject({ opacity: 0.5, visible: true })
    expect(object.parts.find((p) => p.name === 'constructor')).toMatchObject({ opacity: 1, visible: true })
    expect(object.marks!.map((m) => [m.id, m.part])).toEqual([['M1', 'constructor'], ['M2', 'toString'], ['M3', '__proto__'], ['M4', 'hasOwnProperty']])
    expect(Object.keys(object.explode)).toEqual(['__proto__'])
    // The data keeps them as keys of its own, through JSON and back.
    expect(Object.keys(JSON.parse(JSON.stringify(object)).explode)).toEqual(['__proto__'])
    // Nothing was hung on every object of the process.
    expect(Object.keys(Object.prototype)).toEqual([])
    expect(({} as Record<string, unknown>).tray).toBeUndefined()
    const plan = await exportPlan(made, { objects: ['hollow'], marks: true, scans: [], hidden: true }, ASSETS)
    expect(plan.objects[0]).toMatchObject({ parts: 4, off: 1, marks: 4 })
  })
})

describe('making a file leaves main free', () => {
  it('lets other work run while a large part is packed', async () => {
    const last = freeform(387, 9000)                           // 299,538 triangles: 0.7 s of deflate
    const made = deps({ last: () => ({ revision: 1, ...last }), sceneFile: async () => ({ layers: {} }), marks: async () => [], scans: async () => [] })
    let turns = 0
    const timer = setInterval(() => (turns += 1), 5)
    await exportFile(made, { objects: ['hollow'], marks: false, scans: [] }, ASSETS)
    clearInterval(timer)
    // Blocked, the timer would not have run once.
    expect(turns).toBeGreaterThan(5)
  }, 30_000)

  it('reads and reduces a scan once for every plan and save of the same mesh, until the sheet is put away', async () => {
    forgetExportScans()
    let reads = 0
    const made = deps({ scanMesh: async () => (reads++, SCAN_MESH) })
    const req = { objects: ['hollow'], marks: false, scans: ['hollow/S1'] }
    const first = await exportPlan(made, req, ASSETS)
    await exportPlan(made, { ...req, marks: true }, ASSETS)
    const file = await exportFile(made, req, ASSETS)
    expect(reads).toBe(1)
    expect(file.bytes).toBe(first.bytes)
    // Another mesh under the same number is another scan.
    await exportPlan(deps({ scanMesh: async () => (reads++, SCAN_MESH), scans: async () => [{ ...SCAN, source: { ...SCAN.source, sha256: 'other' } }] }), req, ASSETS)
    expect(reads).toBe(2)
    forgetExportScans()
    await exportPlan(made, req, ASSETS)
    expect(reads).toBe(3)
  })

  it('reduces a scan in turns, and to the same as in one go', async () => {
    const { clusterScan, clusterScanInTurns } = await import('./decimate')
    const mesh = parseScanMesh(SCAN_MESH.buffer.slice(SCAN_MESH.byteOffset, SCAN_MESH.byteOffset + SCAN_MESH.byteLength) as ArrayBuffer)
    const scan = { positions: mesh.vertices, colours: mesh.colours, triangles: mesh.triangles }
    let turns = 0
    const cut = await clusterScanInTurns(scan, 30_000, async () => void (turns += 1), 10_000)
    expect(turns).toBeGreaterThan(5)
    const whole = clusterScan(scan, 30_000)
    expect(cut.triangles).toEqual(whole.triangles)
    expect(cut.positions).toEqual(whole.positions)
    expect(cut.colours).toEqual(whole.colours)
  })
})

/** A build of one freeform part: a wavy sheet of `n` × `n` squares (2 n² triangles) in `faces` faces, each with its outline for edges. */
export function freeform(n: number, faces: number): { scene: Scene; blob: Buffer } {
  const positions: number[] = []
  const normals: number[] = []
  const height = (x: number, y: number): number => 6 * Math.sin(x / 9) * Math.cos(y / 13) + 0.02 * x
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
    positions.push(x * 1.37, y * 1.37, height(x, y))
    const [dx, dy] = [(height(x + 0.5, y) - height(x - 0.5, y)) / 1.37, (height(x, y + 0.5) - height(x, y - 0.5)) / 1.37]
    const length = Math.hypot(dx, dy, 1)
    normals.push(-dx / length, -dy / length, 1 / length)
  }
  const triangles: number[] = []
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x
    triangles.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1)
  }
  // About three segments an edge, three edges a face: what the kernel's tessellation of a lofted part comes to.
  const edges: number[] = []
  for (let i = 0; i < faces * 9; i++) {
    const [x, y] = [(i * 7919) % n, (i * 104729) % n]
    edges.push(x * 1.37, y * 1.37, height(x, y), (x + 1) * 1.37, y * 1.37, height(x + 1, y))
  }
  const chunks = [new Float32Array(positions), new Float32Array(normals), new Uint32Array(triangles), new Float32Array(edges), new Uint32Array(faces).fill(8), new Uint32Array(faces * 3).fill(3), new Uint32Array(faces), new Uint32Array(faces * 3)]
  let at = 0
  const [vertices, normalsAt, trianglesAt, edgesAt, trianglesPerFace, segmentsPerEdge, faceTypes, edgeTypes] = chunks.map((chunk) => {
    at += chunk.byteLength
    return { offset: at - chunk.byteLength, length: chunk.byteLength }
  })
  const part: Part = { key: 'main:lid', name: 'lid', layout: 'main', loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, -6], max: [n * 1.37, n * 1.37, 8] }, volume: 1, faceCount: faces, edgeCount: faces * 3, triangleCount: triangles.length / 3, valid: true, hash: `h-${n}`, mesh: { vertices, normals: normalsAt, triangles: trianglesAt, edges: edgesAt, trianglesPerFace, segmentsPerEdge, faceTypes, edgeTypes } }
  return { scene: { model: '/ws/lid/lid.py', layouts: ['main'], parts: [part], seconds: 1, output: '' }, blob: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))) }
}

describe('a part of 2,635 faces and 20,000 triangles', () => {
  it('exports whole, at about what a triangle was measured to cost, and comes back to the vertex', async () => {
    const last = freeform(100, 2635)
    const made = deps({ last: () => ({ revision: 12, ...last }), sceneFile: async () => ({ layers: {} }), marks: async () => [], scans: async () => [] })
    const data = await exportData(made, { objects: ['hollow'], marks: false, scans: [] })
    const [object] = data.objects
    expect(object.parts).toMatchObject([{ name: 'lid', faces: 2635, mesh: 'h-100' }])
    expect(object.parts[0].creased).toBeUndefined()
    const mesh = object.meshes['h-100']
    expect(mesh).toMatchObject({ vertices: 10201, triangles: 20000, segments: 23715, wide: false })
    // Positions, normals, indices and 23,715 edge segments: under 20 bytes a triangle, edges and all (13 was measured on kernel meshes, which have fewer segments a face).
    expect(mesh.data.length / mesh.triangles).toBeLessThan(20)
    const file = await exportFile(made, { objects: ['hollow'], marks: false, scans: [] }, ASSETS)
    expect(file).toMatchObject({ over: false, dropped: [] })
    expect(file.html).toContain('<title>hollow · r12</title>')
    expect(file.bytes).toBeLessThan(450_000)
  })
})


describe('an explode in a file that leaves parts out', () => {
  /** The scene of `built()` with a third part in `assembly`, between the two in the scene's order when `between`. */
  function three(): { scene: Scene; blob: Buffer } {
    const last = built()
    const [tray, lid, ...print] = last.scene.parts
    const clip: Part = { ...lid, key: 'assembly:clip', name: 'clip', hash: 'h-lid', loc: { t: [60, 10, 3], q: [0, 0, 0, 1] }, bbox: { min: [55, 5, 2], max: [65, 15, 4] } }
    return { scene: { ...last.scene, parts: [tray, clip, lid, ...print] }, blob: last.blob }
  }
  const off = (names: string[], explode: unknown) => async () => ({ layout: 'assembly', layers: Object.fromEntries(names.map((name) => [name, { visible: false }])), explode: { assembly: explode }, views: [{ name: 'Clip side', author: 'user', layout: 'assembly', camera, hidden: ['clip', 'tray'], at: '2026-10-09T21:14:03.000Z' }] })

  for (const axis of ['centre', 'x', 'z'] as const) {
    it(`moves the parts that go as torno moves them, ${axis === 'centre' ? 'from the centre' : `along ${axis}`}, and names no part left out`, async () => {
      const last = three()
      const explode = { amount: 0.5, scale: 1, axis }
      const made = deps({ last: () => ({ revision: 3, ...last }), sceneFile: off(['clip'], explode) as ExportDeps['sceneFile'] })
      const [object] = (await exportData(made, { objects: ['hollow'], marks: false, scans: [] })).objects
      expect(object.parts.filter((part) => part.layout === 'assembly').map((part) => part.name)).toEqual(['tray', 'lid'])
      expect(JSON.stringify(object)).not.toContain('clip')
      // Nor does a saved view that hid it (re-review m4): what it hides of the parts that go is all it says.
      expect(object.views.map((view) => view.hidden)).toEqual([['tray']])
      const app = explodeOffsets(last.scene.parts.filter((part) => part.layout === 'assembly'), explode)
      const page = explodeOffsets(apartParts(object, 'assembly'), explodeShown(object.explode.assembly, null, apartParts(object, 'assembly')))
      expect(page.tray).toEqual(app.tray)
      expect(page.lid).toEqual(app.lid)
      expect(app.tray.some((c) => c !== 0) || app.lid.some((c) => c !== 0)).toBe(true)
      // Without the part left out the parts would go otherwise: that is what the file must not draw.
      expect(explodeOffsets(object.parts.filter((part) => part.layout === 'assembly'), explode).lid).not.toEqual(app.lid)
    })
  }

  it('draws two parts apart when one of them is left out, as torno does', async () => {
    const last = built()
    const explode = { amount: 0.5, scale: 1, axis: 'centre' as const }
    const made = deps({ sceneFile: off(['lid'], explode) as ExportDeps['sceneFile'] })
    const [object] = (await exportData(made, { objects: ['hollow'], marks: false, scans: [] })).objects
    expect(object.parts.filter((part) => part.layout === 'assembly').map((part) => part.name)).toEqual(['tray'])
    const shown = explodeShown(object.explode.assembly, null, apartParts(object, 'assembly'))
    expect(shown).toEqual(explode)
    expect(explodeOffsets(apartParts(object, 'assembly'), shown).tray).toEqual(explodeOffsets(last.scene.parts.filter((part) => part.layout === 'assembly'), explode).tray)
  })

  it('carries no box when every part goes', async () => {
    const [object] = (await exportData(deps(), { objects: ['hollow'], marks: false, scans: [], hidden: true })).objects
    expect(object.ghosts).toBeUndefined()
    expect(apartParts(object, 'assembly').map((part) => part.name)).toEqual(['tray', 'lid'])
  })

  it('gives a box left out a name no part has', () => {
    const bbox = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] }
    const parts = apartParts({ parts: [{ name: '\u0000left out 0', layout: 'a', bbox }, { name: 'b', layout: 'a', bbox }], ghosts: [{ layout: 'a', before: 1, bbox }, { layout: 'other', before: 0, bbox }] }, 'a')
    expect(parts).toHaveLength(3)
    expect(new Set(parts.map((part) => part.name)).size).toBe(3)
    expect(parts[1].name).not.toBe('b')
  })
})

// The sweep's finding 13: a shape went into a page as a dot and a label. It is drawn as it is in torno: its outline.
describe('a shape mark in a file', () => {
  const shape = (over: object): Mark => ({ ...base, id: 'M9', kind: 'shape', note: 'a boss here', shape: 'box', intent: 'add', position: [10, 0, 5], rotation: [0, 0, 0, 1], size: [4, 6, 10], ...over }) as Mark
  const outlineOf = async (mark: Mark) => (await exportData(deps({ marks: async () => [mark] }), { objects: ['hollow'], marks: true, scans: [], hidden: true })).objects[0].marks![0].outline!

  it('carries the outline of a box: its twelve edges, where the shape is', async () => {
    const outline = await outlineOf(shape({}))
    const points = outline.flat()
    // Two loops of five points (closed) and four uprights.
    expect(outline.map((line) => line.length)).toEqual([5, 5, 2, 2, 2, 2])
    for (const [i, lo, hi] of [[0, 8, 12], [1, -3, 3], [2, 0, 10]] as const) {
      expect(Math.min(...points.map((p) => p[i]))).toBeCloseTo(lo, 9)
      expect(Math.max(...points.map((p) => p[i]))).toBeCloseTo(hi, 9)
    }
  })

  it('turns the outline with the shape, and gives a plane its rectangle, a cylinder its two circles and a sphere its three', async () => {
    // A quarter turn about Z: what was 4 along x is along y.
    const turned = (await outlineOf(shape({ rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }))).flat()
    expect(Math.max(...turned.map((p) => p[0])) - Math.min(...turned.map((p) => p[0]))).toBeCloseTo(6, 9)
    expect(Math.max(...turned.map((p) => p[1])) - Math.min(...turned.map((p) => p[1]))).toBeCloseTo(4, 9)
    const plane = await outlineOf(shape({ shape: 'plane', size: [4, 6, 0] }))
    expect(plane.map((line) => line.length)).toEqual([5])
    expect(plane[0].every((p) => p[2] === 5)).toBe(true)
    const cylinder = await outlineOf(shape({ shape: 'cylinder', size: [8, 8, 10] }))
    expect(cylinder).toHaveLength(6)
    for (const circle of cylinder.slice(0, 2)) for (const p of circle) expect(Math.hypot(p[0] - 10, p[1])).toBeCloseTo(4, 9)
    expect(cylinder[0][0]).toEqual(cylinder[0].at(-1))
    const sphere = await outlineOf(shape({ shape: 'sphere', size: [8, 8, 8] }))
    expect(sphere).toHaveLength(3)
    for (const circle of sphere) for (const p of circle) expect(Math.hypot(p[0] - 10, p[1], p[2] - 5)).toBeCloseTo(4, 9)
  })

  it('still says what it is in words', async () => {
    const [mark] = (await exportData(deps({ marks: async () => [shape({})] }), { objects: ['hollow'], marks: true, scans: [], hidden: true })).objects[0].marks!
    expect(mark).toMatchObject({ kind: 'shape', at: [10, 0, 5], says: 'add box, 4 × 6 × 10 mm' })
  })
})
