import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Mark, NewRegion, RegionMark } from '../../shared/marks'
import { grid, meshBin, stl } from '../../test/scanFixtures'
import type { ImportReply, Importer } from '../scans/importer'
import { ScanStore } from '../scans/store'
import { MarkStore } from './store'
import { UNIT_MM } from '../../shared/scans'
import { type RegionDeps, addRegion, convertScan, maskReadsOf, maskStampOf, meshesOf, removeMark, repaintRegion, restateRegions, tendRegions } from './regions'

// A region is kept by main from what the window painted: against the real stores, in a folder of the test's own.

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
// A sheet of 5 × 5 vertices 10 mm apart: 32 triangles of 50 mm² each.
let sheet = grid(5, 10)
const reply = (): ImportReply => ({ unit: 'mm', up: 'z', assumed: { unit: true, up: true }, vertices: sheet.vertices.length / 3, triangles: sheet.triangles.length / 3, colours: 'none', bbox: { min: [-20, -20, 0], max: [20, 20, 0] }, area: 1600, reduced: null, source: { bytes: 1, sha256: (sheet.triangles.length % 251).toString(16).padStart(2, '0').repeat(32) } })
const importer: Importer = {
  async import(_from, out) {
    writeFileSync(out, Buffer.from(meshBin(sheet)))
    return reply()
  },
  async convert(mesh, from, to) {
    // As the import process does: the same triangles, every coordinate in the new unit's millimetres.
    const by = UNIT_MM[to.unit] / UNIT_MM[from.unit]
    writeFileSync(mesh, Buffer.from(meshBin({ vertices: sheet.vertices.map((c) => c * by), triangles: sheet.triangles })))
    return { ...reply(), unit: to.unit, up: to.up, bbox: { min: [-20 * by, -20 * by, 0], max: [20 * by, 20 * by, 0] }, area: 1600 * by * by, source: undefined }
  },
  stop() {}
}
const bits = (triangles: number[], length = 4): Uint8Array => {
  const made = new Uint8Array(length)
  for (const t of triangles) made[t >> 3] |= 1 << (t & 7)
  return made
}

let root: string
let dir: string
let source: string
let marks: MarkStore
let scans: ScanStore
let told: Mark[][]
const deps = () => ({ marks, scans })
const region = (over: Partial<NewRegion> = {}): NewRegion => ({ scan: 'S1', note: '', layout: 'assembly', revision: 3, camera: CAMERA as never, bits: bits([0, 1]), ...over })
const maskOf = (mark: string, scan = 'S1'): string => join(dir, '.torno', 'scans', scan, `${mark}.mask`)

beforeEach(async () => {
  sheet = grid(5, 10)
  root = mkdtempSync(join(tmpdir(), 'torno-regions-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  source = join(root, 'sheet.stl')
  writeFileSync(source, stl(sheet))
  scans = new ScanStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), importer: () => importer })
  marks = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), meshes: meshesOf(scans), maskReads: maskReadsOf(scans), maskStamp: maskStampOf(scans) })
  told = []
  marks.on('changed', (m) => told.push(m.marks))
  await scans.import('bracket', source)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('addRegion', () => {
  it('keeps what was painted as a draft of the person\'s, with what main works out of the mesh, and its triangles beside the mesh', async () => {
    const kept = (await addRegion(deps(), 'bracket', { ...region(), triangles: 999, area: 1, author: 'agent', local: { centroid: [9, 9, 9] } } as never)) as RegionMark
    expect(kept).toMatchObject({ id: 'M1', kind: 'region', scan: 'S1', author: 'user', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 3, triangles: 2 })
    expect(kept.area).toBeCloseTo(100, 9)
    expect(kept.local.bbox).toEqual({ min: [-20, -20, 0], max: [-10, -10, 0] })
    const mask = readFileSync(maskOf('M1'))
    expect(mask.length).toBe(16 + 4)
    expect([...mask.subarray(16)]).toEqual([0b11, 0, 0, 0])
    const file = readFileSync(join(dir, '.torno', 'marks.json'), 'utf8')
    expect(file).not.toContain('bits')
    expect(JSON.parse(file).marks[0]).toEqual(kept)
    // The bits cross from the window as the bytes they are, whatever view they came in.
    const again = await addRegion(deps(), 'bracket', region({ bits: bits([3]).buffer as never }))
    expect(again).toMatchObject({ id: 'M2', triangles: 1 })
    const plain = await addRegion(deps(), 'bracket', region({ bits: new DataView(bits([4, 5, 6]).buffer) as never }))
    expect(plain).toMatchObject({ id: 'M3', triangles: 3 })
  })

  it('keeps want or don\'t want when the bar of a review said it, and refuses any other intent', async () => {
    expect(await addRegion(deps(), 'bracket', region({ intent: 'dont' }))).toMatchObject({ id: 'M1', intent: 'dont' })
    expect(await addRegion(deps(), 'bracket', region({ intent: 'want' }))).toMatchObject({ id: 'M2', intent: 'want' })
    expect(await addRegion(deps(), 'bracket', region())).not.toHaveProperty('intent')
    await expect(addRegion(deps(), 'bracket', region({ intent: 'add' as never }))).rejects.toThrow(/intent/)
    expect((await marks.list('bracket')).length).toBe(3)
  })

  it('keeps nothing of no triangle, of bits that are not of that mesh, or of a scan that is not there', async () => {
    const refused = async (over: object): Promise<string> => addRegion(deps(), 'bracket', { ...region(), ...over } as never).then(() => 'kept', (e: Error) => e.message)
    expect(await refused({ bits: bits([]) })).toBe('a region needs at least one triangle: paint some of the scan first')
    expect(await refused({ bits: bits([0], 5) })).toBe('5 bytes of triangles do not fit a mesh of 32 triangles: 4 bytes')
    expect(await refused({ bits: [3, 0, 0, 0] })).toBe('a region is given as the bits of its triangles')
    expect(await refused({ bits: undefined })).toBe('a region is given as the bits of its triangles')
    expect(await refused({ scan: 'S9' })).toBe('no scan S9; scans: S1')
    expect(await refused({ scan: '../S1' })).toBe('no scan ../S1; scans: S1')
    expect(await refused({ layout: 7 })).toBe('that is not a mark: its kind is unknown, or a field is missing or not a finite number')
    rmSync(join(dir, '.torno', 'scans', 'S1', 'mesh.bin'))
    expect(await refused({})).toMatch(/^S1's mesh is gone from .*: import it again before painting on it$/)
    expect(await marks.list('bracket')).toEqual([])
    expect(told).toEqual([])
    expect(existsSync(maskOf('M1'))).toBe(false)
    // The number a refused region would have had is the next mark's.
    writeFileSync(join(dir, '.torno', 'scans', 'S1', 'mesh.bin'), Buffer.from(meshBin(sheet)))
    expect((await addRegion(deps(), 'bracket', region())).id).toBe('M1')
  })

  it('refuses a bit past the last triangle of a mesh whose count is no multiple of eight', async () => {
    sheet = { vertices: sheet.vertices, triangles: sheet.triangles.slice(0, 30 * 3) }
    await scans.import('bracket', source)
    await expect(addRegion(deps(), 'bracket', region({ scan: 'S2', bits: bits([30]) }))).rejects.toThrow('the region names a triangle past the last of the mesh (30 triangles)')
    expect((await addRegion(deps(), 'bracket', region({ scan: 'S2', bits: bits([29]) }))) as RegionMark).toMatchObject({ scan: 'S2', triangles: 1 })
  })

  it('leaves no mask behind when the mark could not be written', async () => {
    writeFileSync(join(dir, '.torno', 'marks.json'), JSON.stringify({ next: 1, marks: [] }))
    // The folder cannot take a temp file beside the marks file: the write fails (the mask goes in a folder of its own).
    chmodSync(join(dir, '.torno'), 0o555)
    try {
      await expect(addRegion(deps(), 'bracket', region())).rejects.toThrow()
    } finally {
      chmodSync(join(dir, '.torno'), 0o755)
    }
    expect(existsSync(maskOf('M1'))).toBe(false)
  })
})

describe('the life of a region with its scan and its mark', () => {
  it('removes the mask with the mark, and of no other', async () => {
    await addRegion(deps(), 'bracket', region())
    await addRegion(deps(), 'bracket', region({ bits: bits([7]) }))
    await removeMark(deps(), 'bracket', 'M1')
    expect([existsSync(maskOf('M1')), existsSync(maskOf('M2'))]).toEqual([false, true])
    expect((await marks.list('bracket')).map((m) => m.id)).toEqual(['M2'])
    await expect(removeMark(deps(), 'bracket', 'M1')).rejects.toThrow('no mark M1; marks: M2')
  })

  it('orphans the regions of a scan that is gone, and those whose mask is no longer of the mesh, and leaves the others', async () => {
    await scans.import('bracket', source) // S2
    await addRegion(deps(), 'bracket', region()) // M1 on S1
    await addRegion(deps(), 'bracket', region({ scan: 'S2' })) // M2 on S2
    await addRegion(deps(), 'bracket', region({ scan: 'S2', bits: bits([9]) })) // M3 on S2
    await tendRegions(deps(), 'bracket')
    expect((await marks.list('bracket')).map((m) => m.anchorState)).toEqual(['ok', 'ok', 'ok'])
    await scans.remove('bracket', 'S1')
    // Its mask is another mesh's: written for 16 triangles.
    const stale = readFileSync(maskOf('M3', 'S2'))
    stale.writeUInt32LE(16, 12)
    writeFileSync(maskOf('M3', 'S2'), stale.subarray(0, 18))
    await tendRegions(deps(), 'bracket')
    expect((await marks.list('bracket')).map((m) => m.anchorState)).toEqual(['orphaned', 'ok', 'orphaned'])
    // One whose mask is gone has no triangles to be of.
    rmSync(maskOf('M2', 'S2'))
    await tendRegions(deps(), 'bracket')
    expect((await marks.list('bracket')).map((m) => m.anchorState)).toEqual(['orphaned', 'orphaned', 'orphaned'])
  })

  it('orphans nothing while the scans file was set aside: what is in the folders may be all there is of them', async () => {
    await addRegion(deps(), 'bracket', region())
    writeFileSync(join(dir, '.torno', 'scans.json'), 'not json')
    scans.forget()
    marks.forget()
    await tendRegions(deps(), 'bracket')
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
  })

  it('says a region anew from the mesh its scan has once that was converted: the same triangles, elsewhere', async () => {
    const kept = (await addRegion(deps(), 'bracket', region({ note: 'loom' }))) as RegionMark
    await marks.markSent('bracket')
    await convertScan(deps(), 'bracket', 'S1', { unit: 'cm', up: 'z' })
    const [now] = (await marks.list('bracket')) as RegionMark[]
    expect(now).toMatchObject({ id: 'M1', note: 'loom', status: 'sent', anchorState: 'ok', triangles: 2 })
    expect(now.area).toBeCloseTo(kept.area * 100, 6)
    expect(now.local.bbox).toEqual({ min: [-200, -200, 0], max: [-100, -100, 0] })
    expect(now.local.centroid.map((c) => Math.round(c))).toEqual([-150, -150, 0])
    // Said again of the same mesh: nothing is written.
    told = []
    await restateRegions(deps(), 'bracket', 'S1')
    expect(told).toEqual([])
    // One whose mask is not of the mesh the scan has is orphaned, not said of another's triangles.
    writeFileSync(maskOf('M1'), Buffer.alloc(18))
    await restateRegions(deps(), 'bracket', 'S1')
    expect((await marks.list('bracket'))[0].anchorState).toBe('orphaned')
  })
})

// Fix round 1.
describe('a region goes with the mesh it was painted on (M5)', () => {
  it('records which mesh that is, and is orphaned when the marks are listed once its scan has another, with no second step', async () => {
    const kept = (await addRegion(deps(), 'bracket', region())) as RegionMark
    expect(kept.mesh).toBe(`${reply().source!.sha256}|25|32|mm|z`)
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
    // The same counts from another file: nothing but the record of the mesh tells them apart. Nobody orphans by hand.
    const file = JSON.parse(readFileSync(join(dir, '.torno', 'scans.json'), 'utf8'))
    file.scans[0].source.sha256 = 'cd'.repeat(32)
    writeFileSync(join(dir, '.torno', 'scans.json'), JSON.stringify(file))
    scans.forget()
    expect((await marks.list('bracket'))[0]).toMatchObject({ anchorState: 'orphaned', status: 'draft' })
    expect(told[told.length - 1][0].anchorState).toBe('orphaned')
  })

  it('is orphaned when the marks are listed once its scan is gone, and left alone while the scans are not known', async () => {
    await addRegion(deps(), 'bracket', region())
    writeFileSync(join(dir, '.torno', 'scans.json'), 'not json')
    scans.forget()
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
    await scans.dismissProblem('bracket')
    // A new, empty list was started: now it is known that there is no S1.
    expect((await marks.list('bracket'))[0].anchorState).toBe('orphaned')
  })

  // Final fix wave (I7): orphaning is undone when its cause passes.
  it('is back when its scan is there again with the mesh it was painted on and its mask reads, and that is said once', async () => {
    await addRegion(deps(), 'bracket', region())
    const file = join(dir, '.torno', 'scans.json')
    const good = readFileSync(file, 'utf8')
    writeFileSync(file, 'not json')
    scans.forget()
    await scans.list('bracket')
    await scans.dismissProblem('bracket')
    expect((await marks.list('bracket'))[0].anchorState).toBe('orphaned')
    // The person puts the file back (from git, from the copy torno set aside): the mesh and the mask never went.
    writeFileSync(file, good)
    scans.forget()
    const problems: string[] = []
    marks.on('problem', (m) => problems.push(m.message))
    expect((await marks.list('bracket'))[0]).toMatchObject({ id: 'M1', anchorState: 'ok', status: 'draft' })
    expect(told[told.length - 1][0].anchorState).toBe('ok')
    expect(problems).toEqual(['M1 is back: its scan S1 is there again, with the mesh it was painted on.'])
    await marks.list('bracket')
    expect(problems).toHaveLength(1)
  })

  it('stays orphaned while its mask does not read, or its scan has another mesh than it was painted on', async () => {
    await addRegion(deps(), 'bracket', region())
    await addRegion(deps(), 'bracket', region({ bits: bits([4]) }))
    const mask = readFileSync(maskOf('M1'))
    rmSync(maskOf('M1'))
    await tendRegions(deps(), 'bracket')
    expect((await marks.list('bracket')).map((mark) => mark.anchorState)).toEqual(['orphaned', 'ok'])
    expect((await marks.list('bracket'))[0].anchorState).toBe('orphaned')
    // Of another triangle count: no region of this mesh.
    writeFileSync(maskOf('M1'), Buffer.concat([mask.subarray(0, 16), Buffer.alloc(9)]))
    expect((await marks.list('bracket'))[0].anchorState).toBe('orphaned')
    writeFileSync(maskOf('M1'), mask)
    // Fix round 1 (I3): put back by hand, it is another file than the one that did not read: the next listing reads it.
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
    // Orphaned because the scan was read again from a changed source: the mesh it records is not the scan's.
    await marks.orphanRegions('bracket', 'S1', ['M2'])
    const file = JSON.parse(readFileSync(join(dir, '.torno', 'marks.json'), 'utf8'))
    file.marks[1].mesh = `${'ef'.repeat(32)}|25|32|mm|z`
    writeFileSync(join(dir, '.torno', 'marks.json'), JSON.stringify(file))
    marks.forget()
    expect((await marks.list('bracket'))[1].anchorState).toBe('orphaned')
  })

  // Milestone 5 (M12), fix round 1 (I3): by the file itself, as it is on the disk.
  it('reads a mask that did not read once while its file is as it was, and again as soon as it is another', async () => {
    const read: string[] = []
    const reads = maskReadsOf(scans)
    marks = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), meshes: meshesOf(scans), maskReads: (objectId, scan, stem) => (read.push(`${scan}/${stem}`), reads(objectId, scan, stem)), maskStamp: maskStampOf(scans) })
    await addRegion(deps(), 'bracket', region())
    const mask = readFileSync(maskOf('M1'))
    rmSync(maskOf('M1'))
    await tendRegions(deps(), 'bracket')
    await marks.list('bracket')
    await marks.list('bracket')
    expect(read).toEqual(['S1/M1'])
    // Of another triangle count: there, and no region of this mesh. Read once.
    writeFileSync(maskOf('M1'), Buffer.concat([mask.subarray(0, 16), Buffer.alloc(9)]))
    await marks.list('bracket')
    expect((await marks.list('bracket'))[0].anchorState).toBe('orphaned')
    expect(read).toHaveLength(2)
    // Put back by hand: nothing told of the scans, and the next listing has the region back.
    writeFileSync(maskOf('M1'), mask)
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
    expect(read).toHaveLength(3)
  })

  it('asks again at the next listing for a mask whose read failed for a reason that may pass: that is not remembered of the file', async () => {
    let fails = true
    let asked = 0
    const reads = maskReadsOf({ list: (objectId) => scans.list(objectId), mask: (objectId, scan, stem) => ((asked += 1), fails ? Promise.reject(Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' })) : scans.mask(objectId, scan, stem)) })
    marks = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), meshes: meshesOf(scans), maskReads: reads, maskStamp: maskStampOf(scans) })
    await addRegion(deps(), 'bracket', region())
    await marks.orphanRegions('bracket', 'S1', ['M1'])
    // The mask is there and whole; the disk could not be read just now.
    expect((await marks.list('bracket'))[0].anchorState).toBe('orphaned')
    expect((await marks.list('bracket'))[0].anchorState).toBe('orphaned')
    expect(asked).toBe(2)
    fails = false
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
  })

  it('leaves a mark from before meshes were recorded as it is, while its scan is there', async () => {
    await addRegion(deps(), 'bracket', region())
    const file = JSON.parse(readFileSync(join(dir, '.torno', 'marks.json'), 'utf8'))
    delete file.marks[0].mesh
    writeFileSync(join(dir, '.torno', 'marks.json'), JSON.stringify(file))
    marks.forget()
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
  })
})

describe('a mask that cannot be read (I2)', () => {
  /** The scans, but for a mask that the disk will not give. */
  const failing = (why: Error): RegionDeps => ({ marks, scans: Object.assign(Object.create(scans), { mask: async () => Promise.reject(why) }) })

  it('orphans nothing when the disk fails, and says so; orphans when the mask is gone', async () => {
    await addRegion(deps(), 'bracket', region())
    const problems: string[] = []
    marks.on('problem', (m) => problems.push(m.message))
    await tendRegions(failing(Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' })), 'bracket')
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
    expect(problems).toEqual(['The triangles of M1 (EMFILE: too many open files) could not be read from the disk just now. It is left as it was.'])
    expect(await marks.problem('bracket')).toBe(problems[0])
    rmSync(maskOf('M1'))
    await tendRegions(deps(), 'bracket')
    expect((await marks.list('bracket'))[0].anchorState).toBe('orphaned')
  })

  it('orphans the regions of a scan that was converted when they cannot be said anew, with why: never numbers of the scan as it was', async () => {
    const kept = (await addRegion(deps(), 'bracket', region())) as RegionMark
    const problems: string[] = []
    marks.on('problem', (m) => problems.push(m.message))
    await convertScan(failing(new Error('EACCES: permission denied')), 'bracket', 'S1', { unit: 'cm', up: 'z' })
    const [now] = (await marks.list('bracket')) as RegionMark[]
    expect(now.anchorState).toBe('orphaned')
    expect(now.area).toBe(kept.area)
    expect(problems).toEqual(['The regions of S1 could not be worked out again after it was converted (EACCES: permission denied): they are of the scan as it was, and have to be painted again.'])
  })

  it('does not orphan the regions of a scan while it is being converted, though its mesh is already another', async () => {
    await addRegion(deps(), 'bracket', region())
    let during: string | undefined
    const slow: RegionDeps = { marks, scans: Object.assign(Object.create(scans), { convert: async (...args: Parameters<ScanStore['convert']>) => {
      const converted = await scans.convert(...args)
      // Converted, and its regions not yet said anew: something lists the marks.
      during = (await marks.list('bracket'))[0].anchorState
      return converted
    } }) }
    await convertScan(slow, 'bracket', 'S1', { unit: 'cm', up: 'z' })
    expect(during).toBe('ok')
    expect((await marks.list('bracket'))[0]).toMatchObject({ anchorState: 'ok', mesh: `${reply().source!.sha256}|25|32|cm|z` })
  })
})

describe('painting a kept region again', () => {
  it('writes its triangles as a new file, says its numbers anew, then removes the old file; one the agent had is a draft again', async () => {
    const kept = (await addRegion(deps(), 'bracket', region({ note: 'loom' }))) as RegionMark
    await marks.markSent('bracket')
    const old = readFileSync(maskOf('M1'))
    const again = (await repaintRegion(deps(), 'bracket', 'M1', bits([0, 1, 2, 3]))) as RegionMark
    expect(again).toMatchObject({ id: 'M1', note: 'loom', status: 'draft', sentBefore: true, anchorState: 'ok', triangles: 4, mask: 1, mesh: kept.mesh })
    expect(again.area).toBeCloseTo(200, 9)
    expect(existsSync(maskOf('M1'))).toBe(false)
    expect([...readFileSync(maskOf('M1.1')).subarray(16)]).toEqual([0b1111, 0, 0, 0])
    expect(old.length).toBe(20)
    // And again: the next file, never the one there is.
    const third = (await repaintRegion(deps(), 'bracket', 'M1', new Uint8Array(bits([9]).buffer) as never)) as RegionMark
    expect(third).toMatchObject({ triangles: 1, mask: 2 })
    expect([existsSync(maskOf('M1.1')), existsSync(maskOf('M1.2'))]).toEqual([false, true])
    // Deleting the mark takes the file it names.
    await removeMark(deps(), 'bracket', 'M1')
    expect(existsSync(maskOf('M1.2'))).toBe(false)
  })

  it('leaves the region as it was when the mark cannot be written, or what was sent is no region of that mesh', async () => {
    await addRegion(deps(), 'bracket', region())
    await expect(repaintRegion(deps(), 'bracket', 'M1', bits([]))).rejects.toThrow('a region needs at least one triangle')
    await expect(repaintRegion(deps(), 'bracket', 'M1', bits([1], 9))).rejects.toThrow('9 bytes of triangles do not fit')
    await expect(repaintRegion(deps(), 'bracket', 'M9', bits([1]))).rejects.toThrow('no mark M9')
    await marks.update('bracket', 'M1', { status: 'resolved' })
    await expect(repaintRegion(deps(), 'bracket', 'M1', bits([1]))).rejects.toThrow('M1 is resolved: reopen it first')
    expect(existsSync(maskOf('M1.1'))).toBe(false)
    await marks.update('bracket', 'M1', { status: 'draft' })
    chmodSync(join(dir, '.torno'), 0o555)
    try {
      await expect(repaintRegion(deps(), 'bracket', 'M1', bits([1]))).rejects.toThrow()
    } finally {
      chmodSync(join(dir, '.torno'), 0o755)
    }
    expect([existsSync(maskOf('M1')), existsSync(maskOf('M1.1'))]).toEqual([true, false])
    expect((await marks.list('bracket'))[0]).toMatchObject({ triangles: 2 })
    // Orphaned for a cause that has not passed: its triangles are gone.
    rmSync(maskOf('M1'))
    await marks.orphanRegions('bracket', 'S1')
    await expect(repaintRegion(deps(), 'bracket', 'M1', bits([1]))).rejects.toThrow('M1 is of a scan that is gone or was read again')
  })
})

describe('masks no mark names (M8)', () => {
  it('are cleared away when the object\'s regions are seen to, and those a mark names are not', async () => {
    await addRegion(deps(), 'bracket', region())
    await repaintRegion(deps(), 'bracket', 'M1', bits([3]))
    // Left by a keep that was cut short between the mask and the mark, and by a repaint cut short before the old file went.
    writeFileSync(maskOf('M7'), readFileSync(maskOf('M1.1')))
    writeFileSync(maskOf('M1'), readFileSync(maskOf('M1.1')))
    writeFileSync(join(dir, '.torno', 'scans', 'S1', 'notes.mask.txt'), 'not torno\'s')
    expect((await scans.masks('bracket', 'S1')).sort()).toEqual(['M1', 'M1.1', 'M7'])
    await tendRegions(deps(), 'bracket')
    expect(await scans.masks('bracket', 'S1')).toEqual(['M1.1'])
    expect(existsSync(join(dir, '.torno', 'scans', 'S1', 'notes.mask.txt'))).toBe(true)
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
  })
})
