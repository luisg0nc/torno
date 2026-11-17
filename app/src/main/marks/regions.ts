import { stat as statFile } from 'node:fs/promises'
import type { Mark, NewMark, NewRegion, RegionMark } from '../../shared/marks'
import { bitsRefused, maskStem, meshIdentity, popcount, regionStats } from '../../shared/regions'
import { type ScanInfo, type ScanUnit, type ScanUp, maskBits, parseScanMesh } from '../../shared/scans'
import { MaskGone } from '../scans/masks'
import type { ScanStore } from '../scans/store'
import type { MarkStore, RegionSaid } from './store'
import { Refusal } from '../refusal'

// Regions of scans, kept: a region is a mark whose triangles are a mask beside its scan's mesh. What the window
// painted comes here as bits; everything said of the region is worked out here from the mesh, and the mask is
// written here, by the scan's and the mark's numbers alone. A region goes with the mesh it was painted on: the
// mark records which that is, and of another it is orphaned and says so.

export interface RegionDeps {
  marks: Pick<MarkStore, 'add' | 'list' | 'remove' | 'restore' | 'orphanRegions' | 'restateRegions' | 'repaintRegion' | 'report'>
  scans: Pick<ScanStore, 'list' | 'mesh' | 'mask' | 'masks' | 'writeMask' | 'removeMask' | 'problem' | 'convert'>
}

/** The masks being written for a mark that is not yet written, as `<object> <scan> <stem>`: nobody clears those away. */
const writing = new Set<string>()
/** The scans being converted, with their regions still to be said anew, as `<object> <scan>`: their regions are not held against the mesh meanwhile. */
const converting = new Set<string>()

/** The bytes the window sent as a region's bits, whatever view of them crossed; null for anything else. */
function bytesOf(given: unknown): Uint8Array | null {
  if (given instanceof Uint8Array) return given
  if (ArrayBuffer.isView(given)) return new Uint8Array(given.buffer, given.byteOffset, given.byteLength)
  if (given instanceof ArrayBuffer) return new Uint8Array(given)
  return null
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** A scan of an object by its number, or the error that names the ones there are. */
async function scanOf(deps: RegionDeps, objectId: string, id: unknown): Promise<ScanInfo> {
  const scans = await deps.scans.list(objectId)
  const scan = scans.find((one) => one.id === id)
  if (!scan) throw new Refusal(`no scan ${String(id)}; scans: ${scans.map((one) => one.id).join(', ') || 'none'}`)
  return scan
}

/** What bits painted on a scan are, worked out from its mesh as main keeps it; the refusal for bits that are no region of it. */
async function said(deps: RegionDeps, objectId: string, scan: ScanInfo, bits: Uint8Array): Promise<RegionSaid> {
  const refused = bitsRefused(bits, scan.imported.triangles)
  if (refused !== null) throw new Refusal(refused)
  if (popcount(bits) === 0) throw new Refusal('a region needs at least one triangle: paint some of the scan first')
  let blob: Buffer
  try {
    blob = await deps.scans.mesh(objectId, scan.id)
  } catch (e) {
    const gone = /^(.*'s mesh is gone from \S+)\./.exec(messageOf(e))
    throw gone ? new Error(`${gone[1]}: import it again before painting on it`) : e
  }
  const stats = regionStats(parseScanMesh(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer), bits)
  if (!stats) throw new Refusal('a region needs at least one triangle: paint some of the scan first')
  return { ...stats, mesh: meshIdentity(scan) }
}

/** Writes a mask for a mark that is about to be written, once the scan is seen to be the mesh the numbers are of. */
async function written(deps: RegionDeps, objectId: string, scan: ScanInfo, stem: string, bits: Uint8Array): Promise<void> {
  // It was not read again, converted or removed while they were worked out.
  if (meshIdentity(await scanOf(deps, objectId, scan.id)) !== meshIdentity(scan)) throw new Refusal(`${scan.id} was read again or converted while the region was being kept: paint it again`)
  writing.add(`${objectId} ${scan.id} ${stem}`)
  await deps.scans.writeMask(objectId, scan.id, stem, bits)
}

/**
 * Keeps what the person painted on a scan as a region: a draft of theirs, like any mark made in the window.
 * The scan must be there with its mesh; the bits must be one a triangle of that mesh, none set past its last,
 * and one set at least. Its count, its area and where it is are worked out from the mesh (`regionStats`), and
 * the mask is written once the mark has its number and before the mark is. Rejects with a plain sentence, and
 * then nothing is kept: no mark, no mask.
 */
export async function addRegion(deps: RegionDeps, objectId: string, given: NewRegion): Promise<Mark> {
  const asked = Object(given) as Partial<NewRegion>
  const bits = bytesOf(asked.bits)
  if (!bits) throw new Refusal('a region is given as the bits of its triangles')
  if (asked.intent !== undefined && asked.intent !== 'want' && asked.intent !== 'dont') throw new Refusal('the intent of a region is want or dont, or none')
  const scan = await scanOf(deps, objectId, asked.scan)
  const stats = await said(deps, objectId, scan, bits)
  const mark = { kind: 'region', author: 'user', scan: scan.id, note: asked.note, layout: asked.layout, revision: asked.revision, camera: asked.camera, ...(asked.intent ? { intent: asked.intent } : {}) } as NewMark
  let stem: string | null = null
  try {
    return await deps.marks.add(objectId, mark, 'draft', undefined, {
      stats,
      before: async (id) => {
        await written(deps, objectId, scan, id, bits)
        stem = id
      }
    })
  } catch (e) {
    if (stem !== null) await deps.scans.removeMask(objectId, scan.id, stem).catch(() => {})
    throw e
  } finally {
    for (const key of [...writing]) if (key.startsWith(`${objectId} ${scan.id} `)) writing.delete(key)
  }
}

/**
 * A region that was kept is painted again: the same mark, with its number and its note, of other triangles.
 * The new mask is a new file, never written over the old one, then the mark with its numbers worked out anew,
 * then the old mask is removed: whatever is cut short, the mark names a whole mask that its numbers are of.
 * One the agent was sent is a draft again, told as changed.
 */
export async function repaintRegion(deps: RegionDeps, objectId: string, id: string, given: unknown): Promise<Mark> {
  const bits = bytesOf(given)
  if (!bits) throw new Refusal('a region is given as the bits of its triangles')
  const mark = (await deps.marks.list(objectId)).find((one) => one.id === id)
  if (!mark) throw new Refusal(`no mark ${String(id)}`)
  if (mark.kind !== 'region') throw new Refusal(`${id} is a ${mark.kind}, not a region: it has no triangles to paint again`)
  const scan = await scanOf(deps, objectId, mark.scan)
  const stats = await said(deps, objectId, scan, bits)
  const next = { ...stats, mask: (mark.mask ?? 0) + 1 }
  const stem = maskStem({ id: mark.id, mask: next.mask })
  let wrote = false
  try {
    const kept = await deps.marks.repaintRegion(objectId, mark.id, next, async () => {
      await written(deps, objectId, scan, stem, bits)
      wrote = true
    })
    await deps.scans.removeMask(objectId, scan.id, maskStem(mark)).catch(() => {})
    return kept
  } catch (e) {
    if (wrote) await deps.scans.removeMask(objectId, scan.id, stem).catch(() => {})
    throw e
  } finally {
    writing.delete(`${objectId} ${scan.id} ${stem}`)
  }
}

/**
 * Removes a mark, and with a region the mask that held its triangles. The store keeps the mark, and the
 * triangles read first, so that `restoreMark` can put it back.
 */
export async function removeMark(deps: RegionDeps, objectId: string, id: string): Promise<void> {
  const mark = (await deps.marks.list(objectId)).find((one) => one.id === id)
  let bits: Uint8Array | undefined
  if (mark?.kind === 'region') {
    try {
      const scan = (await deps.scans.list(objectId)).find((one) => one.id === mark.scan)
      if (scan) bits = Uint8Array.from(maskBits(await deps.scans.mask(objectId, mark.scan, maskStem(mark)), scan.imported.triangles))
    } catch {
      // No triangles to keep: the region comes back without them, and says so.
    }
  }
  await deps.marks.remove(objectId, id, bits)
  if (mark?.kind === 'region') await deps.scans.removeMask(objectId, mark.scan, maskStem(mark)).catch((e) => console.error(`cannot delete the triangles of ${mark.id}: ${messageOf(e)}`))
}

/** Puts back the mark removed last (`MarkStore.restore`), with a region's triangles written before it. */
export function restoreMark(deps: RegionDeps, objectId: string, id: string): Promise<Mark> {
  return deps.marks.restore(objectId, id, async (mark, bits) => {
    if (mark.kind === 'region' && bits) await deps.scans.writeMask(objectId, mark.scan, maskStem(mark), bits)
  })
}

/**
 * Which mesh each scan of an object has now, by scan id, for the marks to be held against (`MarkStore`'s
 * `meshes`). Null while that is not known: the scans cannot be read, or their file was set aside (they may be
 * recovered). A scan that is being converted is left out of nothing and said of nothing: its regions are said
 * anew once it is done, and are held against it only then.
 */
export function meshesOf(scans: Pick<ScanStore, 'list' | 'problem'>): (objectId: string) => Promise<Map<string, string> | null> {
  return async (objectId) => {
    if (converting.size > 0 && [...converting].some((key) => key.startsWith(`${objectId} `))) return null
    try {
      if ((await scans.problem(objectId)) !== null) return null
      return new Map((await scans.list(objectId)).map((scan) => [scan.id, meshIdentity(scan)]))
    } catch {
      return null
    }
  }
}

/**
 * Whether the mask of a region reads as one of the mesh its scan has now, for the marks to bring back a region
 * whose cause for being orphaned has passed (`MarkStore`'s `maskReads`). False is of the file as it is: it is
 * gone, or is no mask of that mesh. Rejects when that could not be found out (the scans or the disk could not
 * be read just now): nothing is then known of the file.
 */
export function maskReadsOf(scans: Pick<ScanStore, 'list' | 'mask'>): (objectId: string, scan: string, stem: string) => Promise<boolean> {
  return async (objectId, scan, stem) => {
    const info = (await scans.list(objectId)).find((one) => one.id === scan)
    if (!info || info.meshState !== 'ok') return false
    let file: Buffer
    try {
      file = await scans.mask(objectId, scan, stem)
    } catch (e) {
      if (e instanceof MaskGone) return false
      throw e
    }
    try {
      maskBits(file, info.imported.triangles)
      return true
    } catch {
      return false
    }
  }
}

/**
 * What the file of a region's mask is now, as far as one `stat` says: its time and its size, or that it is
 * gone (`MarkStore`'s `maskStamp`). A mask that did not read is read again when this is another. The path is
 * the scan store's, of the scans as last listed.
 */
export function maskStampOf(scans: Pick<ScanStore, 'paths'>, stat: (path: string) => Promise<{ mtimeMs: number; size: number }> = statFile): (objectId: string, scan: string, stem: string) => Promise<string> {
  return async (objectId, scan, stem) => {
    const path = scans.paths(objectId, scan)?.mask(stem)
    if (path === undefined) return 'no scan'
    const found = await stat(path).catch(() => null)
    return found ? `${found.mtimeMs} ${found.size}` : 'gone'
  }
}

/**
 * Sees to the regions and the masks of an object, as when its scans are first listed: a region whose mask is
 * gone, or is of another triangle count than its scan's mesh, is orphaned; a mask no mark names (a keep that
 * was cut short between the mask and the mark) is removed. A mask that could not be read for any other reason
 * leaves its region as it was, and is said as a problem: the disk failing says nothing of the region. Nothing
 * is done while the object's scans file was set aside.
 */
export async function tendRegions(deps: RegionDeps, objectId: string): Promise<void> {
  if ((await deps.scans.problem(objectId)) !== null) return
  const scans = await deps.scans.list(objectId)
  // Listing them orphans those whose scan is gone or is another mesh.
  const regions = (await deps.marks.list(objectId)).filter((mark): mark is RegionMark => mark.kind === 'region')
  const lost = new Map<string, string[]>()
  const unread: string[] = []
  for (const region of regions) {
    const scan = scans.find((one) => one.id === region.scan)
    if (!scan || region.anchorState === 'orphaned') continue
    try {
      maskBits(await deps.scans.mask(objectId, scan.id, maskStem(region)), scan.imported.triangles)
    } catch (e) {
      // Gone, or of another mesh: it says nothing of this one. Anything else is the disk's trouble, not the region's.
      if (e instanceof MaskGone || e instanceof RangeError) lost.set(region.scan, [...(lost.get(region.scan) ?? []), region.id])
      else unread.push(`${region.id} (${messageOf(e)})`)
    }
  }
  for (const [scan, ids] of lost) await deps.marks.orphanRegions(objectId, scan, ids)
  if (unread.length > 0) await deps.marks.report(objectId, `The triangles of ${unread.join(', ')} could not be read from the disk just now. ${unread.length === 1 ? 'It is' : 'They are'} left as ${unread.length === 1 ? 'it was' : 'they were'}.`)
  for (const scan of scans) {
    const named = new Set(regions.filter((region) => region.scan === scan.id).map(maskStem))
    for (const stem of await deps.scans.masks(objectId, scan.id).catch(() => [] as string[])) {
      if (named.has(stem) || writing.has(`${objectId} ${scan.id} ${stem}`)) continue
      // A region may have been kept since the marks were read: they are read again before anything of it is deleted.
      const now = await deps.marks.list(objectId).catch(() => null)
      if (!now || now.some((mark) => mark.kind === 'region' && mark.scan === scan.id && maskStem(mark) === stem)) continue
      await deps.scans.removeMask(objectId, scan.id, stem).catch(() => {})
    }
  }
}

/**
 * Works out anew what the regions of a scan are, from the mesh the scan has now and their masks: after the scan
 * was converted to another unit or up axis, which leaves its triangles as they were and puts them elsewhere.
 * Each then records the mesh it is now of. A region whose mask is gone, or is not of that mesh, is orphaned.
 */
export async function restateRegions(deps: RegionDeps, objectId: string, scan: string): Promise<void> {
  const regions = (await deps.marks.list(objectId)).filter((mark): mark is RegionMark => mark.kind === 'region' && mark.scan === scan && mark.anchorState !== 'orphaned')
  if (regions.length === 0) return
  const info = (await deps.scans.list(objectId)).find((one) => one.id === scan)
  if (!info) return deps.marks.orphanRegions(objectId, scan)
  const blob = await deps.scans.mesh(objectId, scan)
  const mesh = parseScanMesh(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer)
  const restated: Array<{ id: string; stats: RegionSaid }> = []
  const lost: string[] = []
  for (const region of regions) {
    let file: Buffer
    try {
      file = await deps.scans.mask(objectId, scan, maskStem(region))
    } catch (e) {
      if (!(e instanceof MaskGone)) throw e
      lost.push(region.id)
      continue
    }
    try {
      const stats = regionStats(mesh, maskBits(file, mesh.triangles.length / 3))
      if (stats) restated.push({ id: region.id, stats: { ...stats, mesh: meshIdentity(info) } })
      else lost.push(region.id)
    } catch {
      lost.push(region.id)
    }
  }
  if (restated.length > 0) await deps.marks.restateRegions(objectId, restated)
  if (lost.length > 0) await deps.marks.orphanRegions(objectId, scan, lost)
}

/**
 * Has a scan read as being in another unit or with another axis up, and its regions said anew from the mesh
 * that leaves it with. While both are under way the regions are not held against the mesh. When they cannot be
 * said anew (the mesh or a mask could not be read) they are orphaned, with why as a problem line: numbers of
 * the scan as it was would tell an area a hundred times off.
 */
export async function convertScan(deps: RegionDeps, objectId: string, id: string, as: { unit: ScanUnit; up: ScanUp }): Promise<ScanInfo> {
  const key = `${objectId} ${id}`
  converting.add(key)
  try {
    const converted = await deps.scans.convert(objectId, id, as)
    try {
      await restateRegions(deps, objectId, converted.id)
    } catch (e) {
      await deps.marks.orphanRegions(objectId, converted.id).catch(() => {})
      await deps.marks.report(objectId, `The regions of ${converted.id} could not be worked out again after it was converted (${messageOf(e)}): they are of the scan as it was, and have to be painted again.`).catch(() => {})
    }
    return converted
  } finally {
    converting.delete(key)
  }
}
