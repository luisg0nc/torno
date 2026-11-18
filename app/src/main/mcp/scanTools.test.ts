import { describe, expect, it } from 'vitest'
import type { BuildState } from '../../shared/build'
import type { Mark } from '../../shared/marks'
import type { Part, Scene } from '../../shared/scene'
import type { ScanAlignment, ScanInfo } from '../../shared/scans'
import type { Camera, ViewState } from '../../shared/view'
import { KernelError } from '../kernel/client'
import { scanClashTool, scanDeviationTool, scansTool } from './scanTools'
import { TOOLS } from './schemas'
import type { ToolDeps, ToolResult } from './tools'

// The agent's tools for scans, against stand-ins for the kernel, the scans and the marks: what is asked of the
// kernel is kept, and what it says is whatever the test gives it to say, in the shapes `scanclash.py` answers in.

const part = (layout: string, name: string, more: Partial<Part> = {}): Part =>
  ({ key: `${layout}:${name}`, name, layout, bbox: { min: [-20, -15, -3], max: [20, 15, 3] }, volume: 6000, faceCount: 12, edgeCount: 30, valid: true, ...more }) as Part
const SCENE: Scene = { model: 'box.py', layouts: ['assembly', 'print'], parts: [part('assembly', 'tub'), part('assembly', 'lid'), part('print', 'tub'), part('print', 'lid', { arranged: [45, 0, 0] })], seconds: 1, output: '' }
/** As a real project: one layout, the first part where the model put it, the others moved. */
const PRINT_ONLY: Scene = { ...SCENE, layouts: ['print'], parts: [part('print', 'tub'), part('print', 'lid', { arranged: [45, 0, 0] })] }
const CAMERA: Camera = { position: [100, -80, 60], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const OK: BuildState = { objectId: 'box', status: 'ok', revision: 12, seconds: 1, stale: false }
// Each model end was clicked on the tub: the alignment is tied to the model, and a build can say whether it holds.
const pairs = [1.8, 3.4, 0.9, 1.2].map((residual) => ({ scan: [0, 0, 0] as [number, number, number], model: [0, 0, 0] as [number, number, number], part: 'tub', residual }))
const BY_PAIRS: ScanAlignment = { transform: { t: [1, 2, 3], q: [0, 0, 0, 1], s: 1 }, steps: ['pairs'], pairs, rms: 2.1, frame: {}, at: '' }
// Task 5's fix round 1 (R-basis): a scan placed by hand is not rough, it is said to be by hand; rough is a doubtful fit of pairs.
const TYPED: ScanAlignment = { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['typed'], frame: {}, at: '' }
const ROUGH: ScanAlignment = { ...BY_PAIRS, pairs: pairs.slice(0, 2), rough: 'it has 2 pairs of points: it takes three that are not in a line to fix a scan' }
/** What the last build's check found of each alignment, unless a test says otherwise: that it holds, on r12. */
const checkedOn = (alignments: Record<string, ScanAlignment>, revision = 12) => Object.fromEntries(Object.keys(alignments).map((layout) => [layout, { revision, of: 4, off: 0, worst: 0, moved: [] }]))
const scan = (id: string, alignments: Record<string, ScanAlignment> = {}, more: Partial<ScanInfo> = {}): ScanInfo =>
  ({ id, name: `${id}.glb`, source: { path: `/dl/${id}.glb`, bytes: 1, mtimeMs: 1, sha256: '' }, imported: { unit: 'm', up: 'y', assumed: { unit: true, up: true }, vertices: 936823, triangles: 1607144, colours: 'texture', bbox: { min: [-1258.9, -1175.3, 0], max: [1258.9, 1175.3, 1493.6] }, area: 1, at: '' }, alignments, sourceState: 'present', meshState: 'ok', checks: checkedOn(alignments), ...more }) as ScanInfo
const REGION = { id: 'M7', kind: 'region', scan: 'S1', author: 'user', note: 'wiring loom', status: 'sent', anchorState: 'ok', layout: 'print', revision: 12, camera: CAMERA, createdAt: '', triangles: 4812, area: 31000, local: { centroid: [0, 0, 0], bbox: { min: [0, 0, 0], max: [1, 1, 1] }, plane: { origin: [0, 0, 0], normal: [0, 0, 1], rms: 1 }, box: { centre: [0.5, 0.5, 0.5], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [0.5, 0.5, 0.5] } } } as unknown as Mark
const CLASHED = {
  part: 'tub', scan: 'S1', points: { scan: 936823, candidates: 13476, checked: 13476, ignored: 0, touching: 0 },
  inside: { count: 2168, crossing: 310, crossingAtLeast: false, clusters: [{ count: 1982, centre: [-98.1, 30.2, 44], bbox: { min: [-120, 10, 30], max: [-80, 52, 61] }, depth: 14.2, at: [-96.1, 31, 40.2], under: 'tub/F40' }], clustersOmitted: 3 },
  crossings: { triangles: { candidates: 17392, checked: 17392, every: 1 }, clusters: [{ count: 310, centre: [-98, 30, 44], bbox: { min: [-120, 10, 30], max: [-80, 52, 61] } }], clustersOmitted: 0 },
  deepest: { depth: 14.2, at: [-96.1, 31, 40.2], under: 'tub/F40' },
  nearest: { distance: 0.9, at: [61, -12.2, 9.1], on: [60.1, -12.2, 9.1], face: 'tub/F12' },
  sampling: { every: 1, cell: 5, surface: 1, deflection: 0.1, retaken: 9, retakesFailed: 0, partial: false, seconds: 3.2 }, how: 'scan vertices inside the part…', exact: false
}

interface Fake extends ToolDeps { queries: Array<{ name: string; args: any }> }
function fake(scans: ScanInfo[], says: (name: string, args: never) => unknown = () => CLASHED, over: { scene?: Scene; layout?: string; marks?: Mark[]; busy?: string[]; state?: BuildState } = {}): Fake {
  const scene = over.scene ?? SCENE
  const view: ViewState = { objectId: 'box', layout: over.layout ?? scene.layouts[0], camera: CAMERA, visible: [], scans: scans.map((s) => ({ id: s.id, visible: true, opacity: 0.6, loaded: true })) }
  const made = {
    queries: [] as Fake['queries'],
    object: (id: string) => (id === 'box' ? { id, name: id, dir: '/ws/box', model: 'box.py' } : undefined),
    build: () => over.state ?? OK,
    scene: () => ({ revision: 12, scene }),
    view: () => view,
    openObjectId: () => 'box',
    marks: async () => over.marks ?? [],
    scans: async () => scans,
    scansBusy: () => over.busy ?? [],
    scanPaths: (_objectId: string, id: string) => ({ mesh: `/ws/box/.torno/scans/${id}/mesh.bin`, mask: (mark: string) => `/ws/box/.torno/scans/${id}/${mark}.mask` }),
    query: async (_objectId: string, name: string, args: object) => {
      made.queries.push({ name, args })
      const said = says(name, args as never)
      if (said instanceof Error) throw said
      return said
    }
  }
  return made as unknown as Fake
}
const text = (result: ToolResult): string => result.content.find((block) => block.type === 'text')!.text as string
const data = (result: ToolResult): any => JSON.parse(text(result))
const refused = (message: string): ToolResult => ({ isError: true, content: [{ type: 'text', text: message }] })
const ALIGNED = 'S1 is aligned by 4 pairs (RMS 2.1 mm, worst 3.4 mm)'

describe('scans', () => {
  it('lists them with how each is aligned in the layout, and that nothing of them is exact', async () => {
    const said = data(await scansTool(fake([scan('S1', { assembly: BY_PAIRS }), scan('S2')], undefined, { marks: [REGION] }), 'box', {}))
    expect(said).toMatchObject({ layout: 'assembly', revision: 12, approximate: 'a scan is a mesh measured by a phone or a scanner: nothing from it is exact' })
    expect(said.scans[0]).toMatchObject({
      id: 'S1', name: 'S1.glb', source: { path: '/dl/S1.glb', state: 'present' }, mesh: 'ok', triangles: 1607144, unit: 'm', up: 'y', assumed: { unit: true, up: true }, size: [2517.8, 2350.6, 1493.6], visible: true, opacity: 0.6,
      alignment: { state: 'aligned', by: 'by 4 pairs (RMS 2.1 mm, worst 3.4 mm)', steps: ['pairs'], pairs: 4, rms: 2.1, worst: 3.4 },
      alignedIn: ['assembly'], bbox: { min: [-1257.9, -1173.3, 3], max: [1259.9, 1177.3, 1496.6] }, regions: ['M7 "wiring loom"']
    })
    expect(said.scans[1]).toMatchObject({ id: 'S2', alignment: { state: 'not aligned' }, alignedIn: [] })
    expect(said.scans[1].bbox).toBeUndefined()
    expect(said.reading).toBe(
      'S1 S1.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed), aligned in assembly by 4 pairs (RMS 2.1 mm, worst 3.4 mm), shown at 60 %, 1 region. S2 S2.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed), not aligned in assembly, shown at 60 %.'
    )
  })

  it('says when there are none, when the model has moved under one, when one is only rough, and what is wrong with its files', async () => {
    expect(data(await scansTool(fake([]), 'box', {}))).toMatchObject({ scans: [], reading: 'no scans: the user imports one in the Scans section of the torno window' })
    const stale = scan('S1', { assembly: BY_PAIRS }, { checks: { assembly: { revision: 12, of: 4, off: 2, worst: 6.2, moved: [] } } })
    expect(data(await scansTool(fake([stale]), 'box', {})).scans[0].alignment.stale).toBe('the model is no longer under 2 of its 4 points (worst 6.2 mm off) on r12: check the alignment')
    const rough = data(await scansTool(fake([scan('S1', { assembly: ROUGH }, { meshState: 'missing', sourceState: 'missing' })], undefined, { busy: ['S1'] }), 'box', {}))
    expect(rough.scans[0]).toMatchObject({ mesh: 'missing', busy: true, source: { state: 'missing' }, alignment: { state: 'aligned', basis: 'pairs', rough: ROUGH.rough } })
    expect(rough.reading).toBe(
      'S1 S1.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed), aligned roughly in assembly by 2 pairs (RMS 2.1 mm, worst 3.4 mm) (it has 2 pairs of points: it takes three that are not in a line to fix a scan), shown at 60 %, its mesh is gone, its source is missing, being converted or imported again.'
    )
    // Task 5's fix round 1: what an alignment rests on is said, and what no build can say of it; one not checked against this build says so.
    const byHand = data(await scansTool(fake([scan('S1', { assembly: TYPED })]), 'box', {}))
    expect(byHand.scans[0].alignment).toMatchObject({ state: 'aligned', basis: 'hand', by: 'by hand (typed values)', tied: 0 })
    expect(byHand.scans[0].alignment).not.toHaveProperty('rough')
    expect(byHand.reading).toContain('aligned in assembly by hand (typed values) (tied to no point of the model: not checked against builds), shown at 60 %')
    const unchecked = data(await scansTool(fake([scan('S1', { assembly: BY_PAIRS }, { checks: { assembly: { revision: 11, of: 4, off: 0, worst: 0, moved: [] } } })]), 'box', {}))
    expect(unchecked.scans[0].alignment).toMatchObject({ unchecked: true, stale: 'it was not checked against r12', tied: 4 })
    expect(unchecked.reading).toContain('aligned in assembly by 4 pairs (RMS 2.1 mm, worst 3.4 mm) (not checked against r12), shown at 60 %')
    const confirmed = data(await scansTool(fake([scan('S1', { assembly: { ...BY_PAIRS, confirmed: { revision: 12, at: '', held: [] } } })]), 'box', {}))
    expect(confirmed.reading).toContain('aligned in assembly by 4 pairs (RMS 2.1 mm, worst 3.4 mm) (confirmed by the user on r12), shown at 60 %')
  })

  it('answers for the layout asked, and refuses one the build has not', async () => {
    const deps = fake([scan('S1', { print: BY_PAIRS })])
    expect(data(await scansTool(deps, 'box', { layout: 'print' })).scans[0].alignment.state).toBe('aligned')
    expect(data(await scansTool(deps, 'box', {})).scans[0]).toMatchObject({ alignment: { state: 'not aligned' }, alignedIn: ['print'] })
    expect(text(await scansTool(deps, 'box', { layout: 'bed' }))).toBe("no layout 'bed'; layouts: assembly, print")
  })
})

describe('scan_clash', () => {
  it('gives the kernel the scan where it is aligned, and answers with its reply, the alignment and a reading', async () => {
    const deps = fake([scan('S1', { assembly: BY_PAIRS })])
    const result = await scanClashTool(deps, 'box', { part: 'tub' })
    expect(result.isError).toBeUndefined()
    expect(deps.queries).toEqual([{ name: 'scan_clash', args: { layout: 'assembly', part: 'tub', margin: 5, scan: { id: 'S1', path: '/ws/box/.torno/scans/S1/mesh.bin', transform: BY_PAIRS.transform, ignore: [], only: null } } }])
    expect(data(result)).toMatchObject({ layout: 'assembly', revision: 12, scan: 'S1', alignment: { state: 'aligned', rms: 2.1 }, inside: { count: 2168 }, exact: false, approximate: 'a scan is a mesh measured by a phone or a scanner: nothing from it is exact' })
    expect(data(result).reading).toBe(
      `scan_clash tub vs S1 (assembly, r12): ≈ 2,168 scan points inside the part in 4 clusters (the 1 largest is told), deepest 14.2 mm at (-96.1, 31, 40.2) under tub/F40; 310 scan triangles cross its surface; nearest scan point outside 0.9 mm from tub/F12. ${ALIGNED}: that RMS is of the clicked points, and says nothing of how true the scan is.`
    )
    expect(data(result).note).toBeUndefined()
    expect(data(result).stale).toBeUndefined()
  })

  it('reads a part the scan is clear of, a thinned answer and one that ran out of time', async () => {
    const clear = { ...CLASHED, inside: { count: 0, crossing: 0, crossingAtLeast: false, clusters: [], clustersOmitted: 0 }, crossings: { ...CLASHED.crossings, clusters: [] }, deepest: null, nearest: { ...CLASHED.nearest, distance: 12 } }
    const reading = async (said: object): Promise<string> => data(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS })], () => said), 'box', { part: 'tub' })).reading
    expect(await reading(clear)).toBe(`scan_clash tub vs S1 (assembly, r12): no scan point is inside the part (≈ 13,476 checked within 5 mm of it) and no scan triangle crosses its surface; nearest 12 mm from tub/F12. ${ALIGNED}: that RMS is of the clicked points, and says nothing of how true the scan is.`)
    // A count that is thinned or unfinished is not a "no": the reading opens with what was really checked.
    expect(await reading({ ...clear, points: { ...CLASHED.points, candidates: 540000, checked: 180000 }, sampling: { ...CLASHED.sampling, every: 3 } })).toBe(
      `scan_clash tub vs S1 (assembly, r12): none of the ≈ 180,000 scan points checked (every 3rd of the 540,000 within 5 mm of the part) is inside it, and no scan triangle crosses its surface; nearest of those checked 12 mm from tub/F12. ${ALIGNED}: that RMS is of the clicked points, and says nothing of how true the scan is.`
    )
    expect(await reading({ ...clear, points: { ...CLASHED.points, candidates: 180000, checked: 100000 }, sampling: { ...CLASHED.sampling, partial: true, seconds: 10.1 } })).toBe(
      `scan_clash tub vs S1 (assembly, r12): none of the ≈ 100,000 scan points checked before the time ran out (of the 180,000 within 5 mm of the part) is inside it, and no scan triangle crosses its surface; nearest of those checked 12 mm from tub/F12, the time ran out after 10.1 s with 100,000 of 180,000 points checked. ${ALIGNED}: that RMS is of the clicked points, and says nothing of how true the scan is.`
    )
    expect(await reading({ ...clear, points: { ...CLASHED.points, candidates: 0, checked: 0 }, nearest: null })).toContain('r12): no scan point is within 5 mm of the part. S1 is aligned')
  })

  it('says a sheet that passes through a wall with no vertex inside, at least how many triangles when not all were tried, what touches, and what could not be taken', async () => {
    const reading = async (said: object, args: object = {}): Promise<string> => data(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS })], () => said), 'box', { part: 'tub', ...args })).reading
    const through = { ...CLASHED, inside: { count: 0, crossing: 42, crossingAtLeast: false, clusters: [], clustersOmitted: 0 }, deepest: null }
    expect(await reading(through)).toContain('no scan point is inside the part (≈ 13,476 checked within 5 mm of it), but 42 scan triangles cross its surface; nearest 0.9 mm from tub/F12.')
    const thinned = { ...CLASHED, inside: { ...CLASHED.inside, crossingAtLeast: true }, crossings: { ...CLASHED.crossings, triangles: { candidates: 600000, checked: 200000, every: 3 } } }
    expect(await reading(thinned)).toContain('; at least 310 scan triangles cross its surface (only every 3rd was tried); ')
    const late = { ...CLASHED, inside: { ...CLASHED.inside, crossingAtLeast: true }, crossings: { ...CLASHED.crossings, triangles: { candidates: 17392, checked: 5000, every: 1 } }, sampling: { ...CLASHED.sampling, partial: true, seconds: 10 } }
    expect(await reading(late)).toContain('; at least 310 scan triangles cross its surface (the time ran out); ')
    expect(await reading(late)).toContain(', the time ran out after 10 s with 5,000 of 17,392 triangles tried.')
    const sampled = { ...CLASHED, points: { ...CLASHED.points, candidates: 540000, checked: 180000, touching: 12 }, sampling: { ...CLASHED.sampling, every: 3, retakesFailed: 2 } }
    expect(await reading(sampled)).toBe(
      `scan_clash tub vs S1 (assembly, r12): ≈ 2,168 of the scan points checked are inside the part in 4 clusters (the 1 largest is told), deepest 14.2 mm at (-96.1, 31, 40.2) under tub/F40; 310 scan triangles cross its surface; 12 scan points lie on its surface, counted on neither side; nearest scan point outside 0.9 mm from tub/F12, every 3rd point checked, 2 points could not be taken on the B-rep. ${ALIGNED}: that RMS is of the clicked points, and says nothing of how true the scan is.`
    )
    expect(await reading({ ...CLASHED, deepest: null, inside: { ...CLASHED.inside, clusters: [{ ...CLASHED.inside.clusters[0], depth: undefined, at: undefined, under: undefined }], clustersOmitted: 0 } })).toContain('≈ 2,168 scan points inside the part in 1 cluster, how deep was not taken on the B-rep; ')
    expect(await reading(CLASHED, { margin: 12.5 })).not.toContain('5 mm of it')
    // Final fix wave (F5, and the kernel's I2): nothing of a scan to the micron, and depths said to be of the points measured when not all were.
    const fine = { ...CLASHED, deepest: { ...CLASHED.deepest, depth: 2.36712, at: [-95.6312, 125.4444, 12.7649] }, nearest: { ...CLASHED.nearest, distance: 0.008139 } }
    expect(await reading(fine)).toContain('deepest 2.4 mm at (-95.6, 125.4, 12.8) under tub/F40; 310 scan triangles cross its surface; nearest scan point outside under 0.1 mm from tub/F12.')
    const some = { ...CLASHED, nearest: null, sampling: { ...CLASHED.sampling, partial: true, seconds: 10, measured: 4500 } }
    expect(await reading(some)).toContain('deepest 14.2 mm at (-96.1, 31, 40.2) under tub/F40 (of the 4,500 points measured to the part before the time ran out: others may be deeper); 310 scan triangles cross its surface, the time ran out after 10 s')
  })

  it('is refused where the scan is not aligned, naming where it is', async () => {
    const elsewhere = fake([scan('S1', { assembly: BY_PAIRS })], undefined, { layout: 'print' })
    expect(await scanClashTool(elsewhere, 'box', { part: 'tub' })).toEqual(refused('S1 is not aligned in layout print (it is aligned in: assembly), so nothing is checked against it there: the user aligns it in print with the Align tool (an alignment is of one layout), or ask in assembly'))
    expect(await scanClashTool(fake([scan('S1')]), 'box', { part: 'tub' })).toEqual(refused('S1 is not aligned in layout assembly (it is aligned in no layout), so nothing is checked against it there: the user aligns it in assembly with the Align tool (an alignment is of one layout)'))
    expect(elsewhere.queries).toEqual([])
  })

  it('answers for a part torno did not move in a spread layout, with a note, and refuses one it moved', async () => {
    const deps = fake([scan('S1', { print: BY_PAIRS })], undefined, { scene: PRINT_ONLY })
    const tub = data(await scanClashTool(deps, 'box', { part: 'tub' }))
    expect(tub).toMatchObject({ layout: 'print', inside: { count: 2168 }, note: 'layout print poses the parts for the bed: a part is where it is mounted only if the model leaves it there' })
    expect(await scanClashTool(deps, 'box', { part: 'lid' })).toEqual(
      refused("In layout print torno moved lid for display (the parts overlapped as the model placed them), so where the scan is against it there is torno's, not the model's. This project has no layout that places lid as it is mounted: add one to the model (def assembly(p)) and let it build; the user then aligns S1 in that layout with the Align tool (an alignment is of one layout: the one in print is not carried over), and only then is this answered there. Or check a part torno did not move (tub).")
    )
    const both = fake([scan('S1', { print: BY_PAIRS })], undefined, { layout: 'print' })
    expect(await scanClashTool(both, 'box', { part: 'lid' })).toEqual(
      refused("In layout print torno moved lid for display (the parts overlapped as the model placed them), so where the scan is against it there is torno's, not the model's. A layout that places lid as the model does is there (assembly), but S1 is not aligned in it: the user then aligns S1 in that layout with the Align tool (an alignment is of one layout: the one in print is not carried over), and only then is this answered there. Or check a part torno did not move (tub).")
    )
    // Aligned there too, it is asked there.
    const twice = fake([scan('S1', { print: BY_PAIRS, assembly: BY_PAIRS })], undefined, { layout: 'print' })
    expect(await scanClashTool(twice, 'box', { part: 'lid' })).toEqual(
      refused("In layout print torno moved lid for display (the parts overlapped as the model placed them), so where the scan is against it there is torno's, not the model's. Ask in a layout that places lid as the model does and in which S1 is aligned (assembly). Or check a part torno did not move (tub).")
    )
    // And a scan aligned only where the part was moved is not sent there from the layout that places it.
    const loop = fake([scan('S1', { print: BY_PAIRS })], undefined, { layout: 'assembly' })
    expect(await scanClashTool(loop, 'box', { part: 'lid' })).toEqual(refused('S1 is not aligned in layout assembly (it is aligned in: print), so nothing is checked against it there: the user aligns it in assembly with the Align tool (an alignment is of one layout)'))
    expect(await scanClashTool(loop, 'box', { part: 'tub' })).toEqual(refused('S1 is not aligned in layout assembly (it is aligned in: print), so nothing is checked against it there: the user aligns it in assembly with the Align tool (an alignment is of one layout), or ask in print'))
    expect(deps.queries).toHaveLength(1)
    expect(both.queries).toEqual([])
  })

  it('refuses a part that stood elsewhere when the scan was aligned: the alignment was made on another frame', async () => {
    // The lid was moved by torno when the scan was put where it is; the model no longer makes torno move it.
    const then: ScanAlignment = { ...BY_PAIRS, frame: { tub: [0, 0, 0], lid: [45, 0, 0] } }
    const deps = fake([scan('S1', { assembly: then })])
    expect(await scanClashTool(deps, 'box', { part: 'lid' })).toEqual(
      refused('S1 was aligned in layout assembly while torno had lid moved by (45, 0, 0) for display, and r12 has it where the model places it: where the scan is against lid is not known. The user aligns it again with the Align tool; a part that stands as it did then can be asked about (tub).')
    )
    expect((await scanClashTool(deps, 'box', { part: 'tub' })).isError).toBeUndefined()
    expect(deps.queries).toHaveLength(1)
  })

  it('says a doubt of the alignment first, and answers: one the model moved under, one that is rough', async () => {
    const stale = scan('S1', { assembly: BY_PAIRS }, { checks: { assembly: { revision: 12, of: 4, off: 2, worst: 6.2, moved: [] } } })
    const said = data(await scanClashTool(fake([stale]), 'box', { part: 'tub' }))
    const doubt = 'the model is no longer under 2 of its 4 points (worst 6.2 mm off) on r12: check the alignment'
    expect(said.alignment.stale).toBe(doubt)
    expect(said.note).toBe(`S1's alignment may no longer hold: ${doubt}`)
    expect(said.reading).toMatch(new RegExp(`^scan_clash tub vs S1 \\(assembly, r12\\): S1's alignment may no longer hold: ${doubt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. ≈ 2,168 scan points inside`))
    expect(said.inside.count).toBe(2168)
    const rough = data(await scanClashTool(fake([scan('S1', { assembly: ROUGH })]), 'box', { part: 'tub' }))
    expect(rough.alignment).toMatchObject({ state: 'aligned', basis: 'pairs', rough: ROUGH.rough })
    expect(rough.reading).toMatch(/^scan_clash tub vs S1 \(assembly, r12\): S1 is only roughly aligned: it has 2 pairs of points: it takes three that are not in a line to fix a scan\. ≈ 2,168 /)
    // Task 5's fix round 1 (R-basis): a scan placed by hand, or laid on its floor alone, is answered for, with what it rests on said first.
    const byHand = data(await scanClashTool(fake([scan('S1', { assembly: TYPED })]), 'box', { part: 'tub' }))
    expect(byHand.alignment).toMatchObject({ state: 'aligned', basis: 'hand', by: 'by hand (typed values)' })
    expect(byHand.reading).toMatch(/^scan_clash tub vs S1 \(assembly, r12\): S1 was placed by hand: no fit says how well\. ≈ 2,168 /)
    expect(byHand.reading).toMatch(/ S1 is aligned by hand \(typed values\) \(tied to no point of the model: not checked against builds\)\.$/)
    const floor = data(await scanClashTool(fake([scan('S1', { assembly: { ...TYPED, steps: ['floor'], rms: 0.4, floor: { part: 'tub', point: [0, 0, 0] } } })]), 'box', { part: 'tub' }))
    expect(floor.alignment).toMatchObject({ state: 'aligned', basis: 'floor', tied: 1 })
    expect(floor.reading).toMatch(/^scan_clash tub vs S1 \(assembly, r12\): S1 is aligned by its floor only: where it is on that floor is as imported\. ≈ 2,168 /)
    // Task 5's fix round 2 (m5): asked right after a build, the kernel answers after that build's check of the alignments: what is said is read then.
    const pending = scan('S1', { assembly: BY_PAIRS }, { checks: {} })
    const racing = fake([pending])
    let listed = 0
    racing.scans = async () => (listed++ === 0 ? [pending] : [scan('S1', { assembly: BY_PAIRS })])
    const settled = data(await scanClashTool(racing, 'box', { part: 'tub' }))
    expect(settled.reading).toMatch(/^scan_clash tub vs S1 \(assembly, r12\): ≈ 2,168 /)
    expect(settled.alignment).not.toHaveProperty('unchecked')
    // The ending of a rough one is as of any fit (restored in fix round 2, m8).
    expect(rough.reading).toMatch(/ S1 is aligned by 2 pairs \(RMS 2\.1 mm, worst 3\.4 mm\): that RMS is of the clicked points, and says nothing of how true the scan is\.$/)
    // And one that was not checked against the build asked about says that first.
    const unchecked = data(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS }, { checks: {} })]), 'box', { part: 'tub' }))
    expect(unchecked.reading).toMatch(/^scan_clash tub vs S1 \(assembly, r12\): S1's alignment was not checked against r12: whether it still holds on it is not known\. ≈ 2,168 /)
  })

  it('says which build it answers from, and that it is stale while a newer one runs or has failed', async () => {
    const failed = fake([scan('S1', { assembly: BY_PAIRS })], undefined, { state: { ...OK, status: 'failed', stale: true } })
    expect(data(await scanClashTool(failed, 'box', { part: 'tub' }))).toMatchObject({ revision: 12, stale: 'the latest build failed, so this is still what is known of r12: refs and descriptors may not hold for the model as it now is' })
  })

  it('leaves out the regions it is told to, by their masks, and refuses what is no region of that scan', async () => {
    const deps = fake([scan('S1', { assembly: BY_PAIRS })], () => ({ ...CLASHED, points: { ...CLASHED.points, ignored: 4812 } }), { marks: [REGION] })
    const said = data(await scanClashTool(deps, 'box', { part: 'tub', ignore: ['M7'] }))
    expect(deps.queries[0].args.scan.ignore).toEqual(['/ws/box/.torno/scans/S1/M7.mask'])
    expect(said.reading).toContain(', 4,812 points of M7 left out')
    expect(await scanClashTool(deps, 'box', { part: 'tub', ignore: ['M3'] })).toEqual(refused('M3 is not a region of S1; its regions: M7'))
    expect(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS })]), 'box', { part: 'tub', ignore: ['M3'] })).toEqual(refused('M3 is not a region of S1, which has no regions: the user paints one on the scan'))
  })

  it('asks which scan when there are several, and says what there is of one that is not', async () => {
    const two = fake([scan('S1', { assembly: BY_PAIRS }), scan('S2', { assembly: BY_PAIRS })])
    expect(await scanClashTool(two, 'box', { part: 'tub' })).toEqual(refused('name the scan: S1 (S1.glb), S2 (S2.glb)'))
    expect(await scanClashTool(two, 'box', { part: 'tub', scan: 'S9' })).toEqual(refused('no scan S9; scans: S1, S2'))
    expect((await scanClashTool(two, 'box', { part: 'tub', scan: 'S2' })).isError).toBeUndefined()
    expect(await scanClashTool(fake([]), 'box', { part: 'tub' })).toEqual(refused('this project has no scans: the user imports one in the Scans section of the torno window'))
    expect(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS }, { meshState: 'missing' })]), 'box', { part: 'tub' })).toEqual(
      refused("S1's mesh is gone from /ws/box/.torno/scans/S1/mesh.bin: the user imports it again from its row in the Scans section")
    )
    expect(text(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS })]), 'box', { part: 'cap' }))).toBe("no part 'cap' in layout assembly (parts: tub, lid)")
    expect(text(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS })]), 'box', { part: 'tub/F5' }))).toBe('scan_clash is of a whole part, and tub/F5 is a face: give tub')
  })

  it('refuses a scan whose files are being written, and says of an import that it is still running', async () => {
    const converting = fake([scan('S1', { assembly: BY_PAIRS })], undefined, { busy: ['S1'] })
    expect(await scanClashTool(converting, 'box', { part: 'tub' })).toEqual(refused('S1 is being converted or imported again: ask again when that is done'))
    expect(await scanClashTool(fake([], undefined, { busy: ['S1'] }), 'box', { part: 'tub' })).toEqual(refused('S1 is still being imported into this project: ask again when that is done'))
    expect(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS })], undefined, { busy: ['S2'] }), 'box', { part: 'tub', scan: 'S2' })).toEqual(refused('S2 is still being imported into this project: ask again when that is done'))
    expect(converting.queries).toEqual([])
  })

  it('answers what is no argument of its with what one looks like, before the kernel is asked', async () => {
    const deps = fake([scan('S1', { assembly: BY_PAIRS })])
    const said = async (args: object): Promise<string> => {
      const result = await scanClashTool(deps, 'box', args as never)
      expect(result.isError).toBe(true)
      return text(result)
    }
    const PART = 'part is the name of a part, as listed by scene: {"part": "tub"}'
    expect(await said({})).toBe(PART)
    expect(await said({ part: ['tub'] })).toBe(PART)
    const MARGIN = 'margin is a number of mm from 0 to 50 (default 5), how far round the part scan points are looked at: {"part": "tub", "margin": 5}'
    expect(await said({ part: 'tub', margin: 80 })).toBe(MARGIN)
    expect(await said({ part: 'tub', margin: '5' })).toBe(MARGIN)
    expect(await said({ part: 'tub', margin: -1 })).toBe(MARGIN)
    expect(await said({ part: 'tub', ignore: 'M7' })).toBe('ignore is a list of the numbers of region marks to leave out: {"part": "tub", "ignore": ["M7"]}')
    expect(await said({ part: 'tub', scan: 1 })).toBe('scan is the number of a scan, as listed by scans: {"scan": "S1"}')
    expect(deps.queries).toEqual([])
    expect((await scanClashTool(deps, 'box', { part: 'tub', margin: 0 })).isError).toBeUndefined()
    expect(deps.queries[0].args.margin).toBe(0)
  })

  it("answers with the kernel's reason when it refuses, and plainly when it does not answer in time", async () => {
    const no = (e: Error) => scanClashTool(fake([scan('S1', { assembly: BY_PAIRS })], () => e), 'box', { part: 'tub' })
    expect(await no(new KernelError('bad_request', 'tub is not a solid: nothing is inside it; scan_deviation says how far it is from the scan'))).toEqual(refused('tub is not a solid: nothing is inside it; scan_deviation says how far it is from the scan'))
    expect(await no(new KernelError('timeout', 'the kernel did not answer within 30 s'))).toEqual(refused('the kernel did not answer within 30 s; the part or the scan may be too large for this check against a scan'))
    expect(text(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS })], () => ({ nothing: true })), 'box', { part: 'tub' }))).toBe('the kernel did not answer with a clash')
  })
})

describe('scan_deviation', () => {
  const DEVIATED = {
    part: 'tub', faces: [5], scan: 'S1', from: 'part', samples: 20000, compared: 18840, beyond: 1160,
    distance: { min: 0, mean: 1.9, max: 7.4, rms: 2.4, p50: 1.3, p90: 4, p95: 5.1 }, signed: { min: -3.1, mean: 0.4, max: 7.4, inside: 212 },
    worst: { distance: 7.4, at: [10, 4, 6], on: [10, 4, 13.4], face: 'tub/F5' }, sampling: { deflection: 0.1, retakesFailed: 0, surface: 1, scanSurface: 1, asked: 20000, partial: false, unsure: 0, seconds: 1.1 }, how: '…', exact: false
  }
  const aligned = (says: (name: string, args: never) => unknown = () => DEVIATED, over: Parameters<typeof fake>[2] = {}): Fake => fake([scan('S1', { assembly: BY_PAIRS })], says, over)

  it('asks of faces by their numbers, of a region by its mask, and reads the answer', async () => {
    const deps = aligned(undefined, { marks: [REGION] })
    const said = data(await scanDeviationTool(deps, 'box', { part: 'tub', faces: ['tub/F5'], region: 'M7', samples: 20000 }))
    expect(deps.queries).toEqual([{ name: 'scan_deviation', args: { layout: 'assembly', part: 'tub', faces: [5], from: 'part', within: 50, samples: 20000, scan: { id: 'S1', path: '/ws/box/.torno/scans/S1/mesh.bin', transform: BY_PAIRS.transform, ignore: [], only: '/ws/box/.torno/scans/S1/M7.mask' } } }])
    expect(said.reading).toBe(
      `scan_deviation tub/F5 vs S1 region M7 (assembly, r12): within 0.1 mm at the nearest; of the 18,840 points of the part that have the scan within 50 mm (further is not looked at): ≈ 1.3 mm median, 1.9 mm mean, 7.4 mm the furthest, 95 % within 5.1 mm; the scan is inside the part at 212 of them; 1,160 more had no scan within 50 mm; furthest at (10, 4, 6) on tub/F5. ${ALIGNED}: that RMS is of the clicked points, and says nothing of how true the scan is.`
    )
    expect(said).toMatchObject({ layout: 'assembly', revision: 12, scan: 'S1', region: 'M7', exact: false, approximate: 'a scan is a mesh measured by a phone or a scanner: nothing from it is exact', alignment: { state: 'aligned' } })
  })

  it('asks for 10,000 samples within 50 mm of the whole part unless told otherwise, and reads the other way round', async () => {
    const from = { ...DEVIATED, faces: null, from: 'scan', samples: 400, compared: 400, beyond: 0, sampling: { ...DEVIATED.sampling, scanSurface: undefined, asked: 10000 } }
    const deps = aligned(() => from)
    const said = data(await scanDeviationTool(deps, 'box', { part: 'tub', from: 'scan' }))
    expect(deps.queries[0].args).toMatchObject({ faces: null, from: 'scan', within: 50, samples: 10000, scan: { only: null } })
    expect(said.reading).toContain('r12): within 0.1 mm at the nearest; of the 400 scan points that have the part within 50 mm (further is not looked at): ≈ 1.3 mm median, 1.9 mm mean, 7.4 mm the furthest, 95 % within 5.1 mm (10,000 were asked: no more are within 50 mm of it); 212 of them are inside the part; furthest at (10, 4, 6) from tub/F5.')
  })

  it('says what was asked and what was measured, what is unsure and by how much, and what could not be taken', async () => {
    const reading = async (said: object, args: object = {}): Promise<string> => data(await scanDeviationTool(aligned(() => said), 'box', { part: 'tub', ...args })).reading
    const partial = { ...DEVIATED, from: 'scan', samples: 15429, compared: 15429, beyond: 0, sampling: { ...DEVIATED.sampling, partial: true, unsure: 395, retakesFailed: 1 }, how: 'from 15,429 vertices of the scan to the triangles of the part\'s mesh; the time ran out after 15,429 of 20,000; 395 of them may be told up to 1.1 mm too far: not every triangle that near could be tried' }
    expect(await reading(partial, { from: 'scan', samples: 20000, within: 200 })).toContain(
      "of the 15,429 scan points that have the part within 200 mm (further is not looked at): ≈ 1.3 mm median, 1.9 mm mean, 7.4 mm the furthest, 95 % within 5.1 mm; the time ran out: 15,429 of the 20,000 asked were measured; 395 of the distances may be told up to 1.1 mm too far; 212 of them are inside the part; furthest at (10, 4, 6) from tub/F5, which could not be taken on the B-rep: its distance is to the part's mesh."
    )
    const few = { ...DEVIATED, faces: null, samples: 632, compared: 632, beyond: 0, signed: null, sampling: { ...DEVIATED.sampling, asked: 10000 } }
    expect(await reading(few)).toContain('of the 632 points of the part that have the scan within 50 mm (further is not looked at): ≈ 1.3 mm median, 1.9 mm mean, 7.4 mm the furthest, 95 % within 5.1 mm (10,000 were asked: the part has no more, 1 mm apart); the part is no solid, so no side is told; furthest')
    const unsure = { ...DEVIATED, sampling: { ...DEVIATED.sampling, unsure: 3 }, how: 'no figure here' }
    expect(await reading(unsure)).toContain('; 3 of the distances may be told too far, by less than the spacing of the points that stand for the scan (1 mm); ')
    expect(await reading({ ...DEVIATED, sampling: { ...DEVIATED.sampling, unsure: 3 }, how: '3 of them may be told up to 1.09545 mm too far: not every triangle' })).toContain('; 3 of the distances may be told up to 1.1 mm too far; ')
    // The time ran out, and none of those it got to had the scan within reach: that is not "nothing of the scan is within 50 mm".
    const unfinished = { ...DEVIATED, faces: null, samples: 500, compared: 0, beyond: 500, distance: null, signed: null, worst: null, sampling: { ...DEVIATED.sampling, asked: 10000, partial: true } }
    expect(await reading(unfinished)).toBe(`scan_deviation tub vs S1 (assembly, r12): none of the 500 points measured before the time ran out (of 10,000 asked) had the scan within 50 mm: ask for fewer samples or a smaller within. ${ALIGNED}: that RMS is of the clicked points, and says nothing of how true the scan is.`)
    const none = { ...DEVIATED, samples: 0, compared: 0, beyond: 0, distance: null, signed: null, worst: null, sampling: { ...DEVIATED.sampling, partial: true } }
    expect(await reading(none)).toBe(`scan_deviation tub vs S1 (assembly, r12): the time ran out before any point was measured: ask for fewer samples or a smaller within. ${ALIGNED}: that RMS is of the clicked points, and says nothing of how true the scan is.`)
  })

  it('says when nothing is within reach, and refuses faces of another part', async () => {
    const none = { ...DEVIATED, faces: null, compared: 0, beyond: 20000, distance: null, signed: null, worst: null }
    expect(data(await scanDeviationTool(aligned(() => none), 'box', { part: 'tub' })).reading).toBe(`scan_deviation tub vs S1 (assembly, r12): nothing of the scan is within 50 mm of the part. ${ALIGNED}: that RMS is of the clicked points, and says nothing of how true the scan is.`)
    expect(text(await scanDeviationTool(aligned(), 'box', { part: 'tub', faces: ['lid/F1'] }))).toBe('lid/F1 is not a face of tub: give refs such as tub/F0')
    expect(text(await scanDeviationTool(aligned(), 'box', { part: 'tub', faces: ['tub/E3'] }))).toBe('tub/E3 is not a face of tub: give refs such as tub/F0')
    expect(text(await scanDeviationTool(aligned(), 'box', { part: 'tub', faces: ['tub/F40'] }))).toBe('tub has 12 faces, F0 to F11: there is no F40')
  })

  it('answers what is no argument of its with what one looks like, and keeps to the kernel\'s caps', async () => {
    const deps = aligned()
    const said = async (args: object): Promise<string> => {
      const result = await scanDeviationTool(deps, 'box', args as never)
      expect(result.isError).toBe(true)
      return text(result)
    }
    const SAMPLES = 'samples is a whole number from 100 to 20,000 (default 10,000), how many points are measured: {"part": "tub", "samples": 10000}'
    expect(await said({ part: 'tub', samples: 100000 })).toBe(SAMPLES)
    expect(await said({ part: 'tub', samples: 99 })).toBe(SAMPLES)
    expect(await said({ part: 'tub', samples: 500.5 })).toBe(SAMPLES)
    const WITHIN = 'within is a number of mm from 0.1 to 200 (default 50), how far from each point the other is looked for: {"part": "tub", "within": 50}'
    expect(await said({ part: 'tub', within: 1000 })).toBe(WITHIN)
    expect(await said({ part: 'tub', within: 0 })).toBe(WITHIN)
    expect(await said({ part: 'tub', from: 'model' })).toBe('from is "part" (points of the part, each to the scan; the default) or "scan" (points of the scan, each to the part): {"part": "tub", "from": "scan"}')
    const FACES = 'faces is a list of refs of faces of the part: {"part": "tub", "faces": ["tub/F5"]}'
    expect(await said({ part: 'tub', faces: 'tub/F5' })).toBe(FACES)
    expect(await said({ part: 'tub', faces: [] })).toBe(FACES)
    expect(await said({ part: 'tub', faces: [5] })).toBe(FACES)
    expect(await said({ part: 'tub', region: ['M7'] })).toBe('region is the number of one region mark of the scan: {"part": "tub", "region": "M7"}')
    expect(await said({})).toBe('part is the name of a part, as listed by scene: {"part": "tub"}')
    expect(deps.queries).toEqual([])
  })

  it('is refused like a clash: unaligned, a part torno moved, a region that is none', async () => {
    expect(text(await scanDeviationTool(fake([scan('S1')]), 'box', { part: 'tub' }))).toBe('S1 is not aligned in layout assembly (it is aligned in no layout), so nothing is checked against it there: the user aligns it in assembly with the Align tool (an alignment is of one layout)')
    expect(text(await scanDeviationTool(fake([scan('S1', { print: BY_PAIRS })], undefined, { scene: PRINT_ONLY }), 'box', { part: 'lid' }))).toMatch(/^In layout print torno moved lid for display/)
    expect(text(await scanDeviationTool(aligned(undefined, { marks: [REGION] }), 'box', { part: 'tub', region: 'M1' }))).toBe('M1 is not a region of S1; its regions: M7')
  })
})

describe('what a scan tool says it did', () => {
  const DEVIATED = {
    part: 'tub', faces: [5], scan: 'S1', from: 'part', samples: 200, compared: 200, beyond: 0,
    distance: { min: 0, mean: 1.9, max: 7.4, rms: 2.4, p50: 1.3, p90: 4, p95: 5.1 }, signed: { min: -3.1, mean: 0.4, max: 7.4, inside: 2 },
    worst: { distance: 7.4, at: [10, 4, 6], on: [10, 4, 13.4], face: 'tub/F5' }, sampling: { deflection: 0.1, retakesFailed: 0, surface: 1, scanSurface: 1, asked: 200, partial: false, unsure: 0, seconds: 1.1 }, how: '…', exact: false
  }

  it('echoes what was applied: the regions left out, the region and the faces measured, or that there were none', async () => {
    const deps = fake([scan('S1', { assembly: BY_PAIRS })], undefined, { marks: [REGION] })
    expect(data(await scanClashTool(deps, 'box', { part: 'tub', ignore: ['M7', 'M7'] })).ignore).toEqual(['M7'])
    expect(data(await scanClashTool(deps, 'box', { part: 'tub' })).ignore).toEqual([])
    const of = fake([scan('S1', { assembly: BY_PAIRS })], () => DEVIATED, { marks: [REGION] })
    const some = data(await scanDeviationTool(of, 'box', { part: 'tub', faces: ['tub/F5'], region: 'M7' }))
    expect(some).toMatchObject({ region: 'M7', faces: ['tub/F5'] })
    // Only that part of the scan counted: the reading says of which region it is.
    expect(some.reading).toMatch(/^scan_deviation tub\/F5 vs S1 region M7 \(assembly, r12\): /)
    const whole = data(await scanDeviationTool(fake([scan('S1', { assembly: BY_PAIRS })], () => ({ ...DEVIATED, faces: null })), 'box', { part: 'tub' }))
    expect(whole).toMatchObject({ region: null, faces: null })
    expect(whole.reading).toMatch(/^scan_deviation tub vs S1 \(assembly, r12\): /)
  })

  it('never passes on an exact the kernel might say: nothing of a scan is', async () => {
    const clash = data(await scanClashTool(fake([scan('S1', { assembly: BY_PAIRS })], () => ({ ...CLASHED, exact: true })), 'box', { part: 'tub' }))
    expect(clash.exact).toBe(false)
    const deviation = data(await scanDeviationTool(fake([scan('S1', { assembly: BY_PAIRS })], () => ({ ...DEVIATED, exact: true })), 'box', { part: 'tub' }))
    expect(deviation.exact).toBe(false)
  })

  it('refuses a region that no longer fits the mesh of its scan, for leaving out and for measuring', async () => {
    const orphaned = { ...(REGION as unknown as Record<string, unknown>), anchorState: 'orphaned' } as unknown as Mark
    const deps = fake([scan('S1', { assembly: BY_PAIRS })], undefined, { marks: [orphaned] })
    const GONE = 'M7 no longer fits the mesh of S1 (the scan was imported again from a changed source since it was painted): the user paints it again'
    expect(await scanClashTool(deps, 'box', { part: 'tub', ignore: ['M7'] })).toEqual(refused(GONE))
    expect(await scanDeviationTool(deps, 'box', { part: 'tub', region: 'M7' })).toEqual(refused(GONE))
    expect(deps.queries).toEqual([])
  })

  it('says the build that was asked, whatever is built while the answer is written', async () => {
    for (const tool of [scanClashTool, scanDeviationTool]) {
      // The kernel answers of r12; r13 lands once that answer was checked against the build there was.
      let answered = false
      let asked = 0
      const deps = fake([scan('S1', { assembly: BY_PAIRS })], () => {
        answered = true
        return tool === scanClashTool ? CLASHED : DEVIATED
      })
      deps.scene = () => ({ revision: answered && ++asked > 1 ? 13 : 12, scene: SCENE })
      const said = data(await tool(deps, 'box', { part: 'tub' }))
      expect(said.revision).toBe(12)
      expect(said.reading).toContain('(assembly, r12)')
    }
  })
})

describe('scans before anything is built', () => {
  it('lists the scans there are, with the layouts each is aligned in, and says why no more is told', async () => {
    const deps = fake([scan('S1', { print: BY_PAIRS }), scan('S2')])
    deps.scene = () => undefined
    deps.build = () => ({ objectId: 'box', status: 'failed', revision: 0, stale: false, error: { kind: 'exception', message: 'boom' } }) as never
    const said = data(await scansTool(deps, 'box', {}))
    expect(said).toMatchObject({ layout: null, revision: null, note: 'nothing is built yet: how a scan is aligned is told for a layout of a build' })
    expect(said.scans).toMatchObject([{ id: 'S1', triangles: 1607144, alignedIn: ['print'] }, { id: 'S2', alignedIn: [] }])
    expect(said.scans[0].alignment).toBeUndefined()
    expect(said.reading).toBe('Nothing is built yet. S1 S1.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed), aligned in: print, shown at 60 %. S2 S2.glb: 1,607,144 triangles, 2518 × 2351 × 1494 mm, from m, Y up (assumed), aligned in no layout, shown at 60 %.')
    expect(text(await scansTool(fake([]), 'nowhere', {}))).toBe('unknown project: nowhere')
  })
})

describe('the descriptions of the scan tools', () => {
  it('say that nothing from a scan is exact, and when each is refused', () => {
    for (const tool of [TOOLS.scans, TOOLS.scan_clash, TOOLS.scan_deviation]) expect(tool.description).toMatch(/[Aa]pproximate|nothing from it is exact/)
    for (const tool of [TOOLS.scans, TOOLS.scan_clash, TOOLS.scan_deviation]) expect(tool.description).toMatch(/^Returns /)
    expect(TOOLS.scan_clash.description).toContain('Refused where the scan is not aligned, and for a part torno moved for display')
    expect(TOOLS.scan_deviation.description).toContain('up to 20,000 sample points')
  })
})
