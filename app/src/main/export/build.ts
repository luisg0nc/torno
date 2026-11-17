import { promisify } from 'node:util'
import { deflate } from 'node:zlib'
import { dimensionText, expectedText, notMeasuredText, shownDimension, unitOf } from '../../shared/dimension'
import { type ExplodeState, explodeOf } from '../../shared/explode'
import { type ExportData, type ExportMark, type ExportObject, type ExportPart, type ExportPlan, type ExportRequest, type ExportScan, type PackedMesh, NOT_BUILT, megabytes, own, packMesh, packScan, record } from '../../shared/exportdata'
import { isFaceted } from '../../shared/faceted'
import { count, number } from '../../shared/format'
import { type Mark, type Vec3, isUnchecked, markAnchors, markEndParts, shapeOutline, strokePoints } from '../../shared/marks'
import { colorFor, colorsOfParts } from '../../shared/palette'
import { meshIdentity } from '../../shared/regions'
import { type ScanInfo, alignmentOf, parseScanMesh } from '../../shared/scans'
import { type Part, type Scene, bufView } from '../../shared/scene'
import type { SceneFile } from '../../shared/scenefile'
import { thumbnailLayout } from '../../shared/thumbnail'
import type { ObjectInfo } from '../../shared/workspace'
import { clusterScanInTurns } from './decimate'
import { type PageAssets, exportHtml } from './html'

export type { ExportPlan, ExportRequest }

// An export, made in main from what it already holds: the last good build of this run of each object (nothing
// is built for an export), its scene file as the window last gave it, its marks and its scans. What goes into
// the file is what the request names and nothing else: no path of this machine, no folder, no source of a scan,
// nothing a model printed, no session. A scan goes only when ticked, reduced; a mark only when marks are ticked;
// a part that is switched off and a mark that is resolved only when those are ticked.
//
// Main has other work while a file is made: the deflating is zlib's, on its own threads, and a scan is reduced
// in turns of the event loop (`clusterScanInTurns`). Nothing here holds main for more than a moment.
//
// Whatever is keyed by the name of a part or a layout is a `Map` or a record without a prototype (`record`), and
// what was read from a file is asked only for keys of its own (`own`): a part may be called `constructor`.

/** zlib's deflate at its best, off the main thread. */
const squeeze = (bytes: Uint8Array): Promise<Buffer> => promisify(deflate)(bytes, { level: 9 })

export interface ExportDeps {
  object(objectId: string): ObjectInfo | undefined
  /** The last good build of this run, with its blob; undefined for an object not built in it. */
  last(objectId: string): { revision: number; scene: Scene; blob: Buffer } | undefined
  sceneFile(objectId: string): Promise<SceneFile>
  marks(objectId: string): Promise<Mark[]>
  scans(objectId: string): Promise<ScanInfo[]>
  scanMesh(objectId: string, id: string): Promise<Buffer>
  now(): Date
  /** Whether the object's newest build failed: what would be exported is then its last good one. */
  failing?(objectId: string): boolean
  /** For tests: other limits than `EXPORT_BUDGET` and `EXPORT_MOST`. */
  budget?: number
  most?: number
}

/** What a file should weigh at most: over it, scans are cut, and then the sheet says so. */
export const EXPORT_BUDGET = 12 * 1024 * 1024
/** What torno writes in one file at most. */
export const EXPORT_MOST = 64 * 1024 * 1024
/** What a scan is reduced to, and then to when the file is over its budget. */
export const SCAN_TRIANGLES = [60_000, 30_000, 15_000] as const

export { NOT_BUILT }
export const NO_OBJECT = 'There is no project of that name'
export const NOTHING_CHOSEN = 'Choose a project to export'
export const ONE_OBJECT = 'A STEP, STL or 3MF file is of one project: tick one'

/** The meshes packed of a build, by the blob they were read from: a plan and the save that follows pack once. */
const packed = new WeakMap<Buffer, Map<string, PackedMesh>>()

async function packedMeshes(parts: readonly Part[], blob: Buffer): Promise<Record<string, PackedMesh>> {
  let known = packed.get(blob)
  if (!known) packed.set(blob, (known = new Map()))
  let bytes: ArrayBuffer | null = null
  const meshes = record<PackedMesh>()
  for (const part of parts) {
    if (meshes[part.hash]) continue
    let mesh = known.get(part.hash)
    if (!mesh) {
      // A buffer of its own: the blob may be a view into a larger one, at an offset no typed array can start from.
      bytes ??= blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer
      const m = part.mesh
      // A solid made of a mesh has every triangle's outline for edges: none is kept, and the page draws its creases.
      const creased = isFaceted(bufView(bytes, m.trianglesPerFace, Uint32Array))
      const { header, bytes: raw } = packMesh({ positions: bufView(bytes, m.vertices, Float32Array), normals: bufView(bytes, m.normals, Float32Array), triangles: bufView(bytes, m.triangles, Uint32Array), edges: creased ? new Float32Array(0) : bufView(bytes, m.edges, Float32Array) })
      mesh = { ...header, data: (await squeeze(raw)).toString('base64') }
      known.set(part.hash, mesh)
    }
    meshes[part.hash] = mesh
  }
  return meshes
}

/** A scan as it goes into a file, less where it stands: reduced, packed and deflated. */
type ReducedScan = Omit<ExportScan, 'id' | 'name' | 'placed'>

/** The scans reduced for the export sheet that is up, by folder, scan, mesh (`meshIdentity`) and size: each tick of the sheet, and the save, find them made. */
const reduced = new Map<string, Promise<ReducedScan>>()

/** The sheet was put away, or the workspace left: what was reduced for it is let go. */
export function forgetExportScans(): void {
  reduced.clear()
}

function reducedScan(deps: ExportDeps, obj: ObjectInfo, scan: ScanInfo, most: number): Promise<ReducedScan> {
  const key = [obj.dir, scan.id, meshIdentity(scan), most].join('\n')
  let made = reduced.get(key)
  if (!made) {
    made = (async () => {
      const blob = await deps.scanMesh(obj.id, scan.id)
      const mesh = parseScanMesh(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer)
      const cut = await clusterScanInTurns({ positions: mesh.vertices, colours: mesh.colours, triangles: mesh.triangles }, most)
      const { header, bytes } = packScan(cut)
      return { reducedFrom: mesh.triangles.length / 3, ...header, data: (await squeeze(bytes)).toString('base64') }
    })()
    reduced.set(key, made)
    // One that could not be made is asked for again next time.
    made.catch(() => reduced.get(key) === made && reduced.delete(key))
  }
  return made
}

const HEX = /^#[0-9a-f]{6}$/i
const middle = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

/** A mark as a page tells it, on the build `revision`: a dimension with the value and the verdict torno has of that build, or with the words that say it has none. */
function exportMark(mark: Exclude<Mark, { kind: 'region' | 'note' | 'sketch' }>, revision: number, boxes: Record<string, { min: Vec3; max: Vec3 }>): ExportMark {
  const part = markAnchors(mark)[0]?.part
  const ends = markEndParts(mark, boxes)
  const said: ExportMark = {
    id: mark.id,
    kind: mark.kind,
    author: mark.author,
    layout: mark.layout,
    note: mark.note,
    status: mark.status,
    ...(part !== undefined ? { part } : {}),
    ...(ends.length === 2 ? { ends: [ends[0] ?? null, ends[1] ?? null] as [string | null, string | null] } : {}),
    at: [0, 0, 0],
    ...(mark.anchorState === 'drifted' ? { moved: true as const } : {}),
    ...(isUnchecked(mark, revision) ? { unchecked: true as const } : {})
  }
  switch (mark.kind) {
    case 'pin':
    case 'pick':
      return { ...said, at: mark.anchor.point }
    case 'arrow':
      return { ...said, at: mark.from.point, line: [mark.from.point, mark.to] }
    case 'stroke': {
      const points = strokePoints(mark)
      return { ...said, at: points[0] ?? mark.anchor.point, ...(points.length > 1 ? { line: points } : {}) }
    }
    case 'shape':
      // Its outline, as torno draws it: a shape is a thing in space, and a dot would say only where its middle is.
      return { ...said, at: mark.position, outline: shapeOutline(mark), says: `${mark.intent} ${mark.shape}, ${mark.size.filter((s) => s > 0).map(number).join(' × ')} mm` }
    case 'dimension': {
      const shown = shownDimension(mark, revision)
      // Between the points its value was taken between; not when the build moved its ends: that line would not run from where they were put.
      const line = mark.anchorState === 'drifted' ? undefined : (mark.points ?? (mark.b ? [mark.a.point, mark.b.point] : undefined))
      const valued = shown.value !== undefined
      return {
        ...said,
        at: line ? middle(line[0], line[1]) : mark.a.point,
        ...(line ? { line: [line[0], line[1]] } : {}),
        text: dimensionText(mark, revision),
        // A verdict is of a value: one of another build is none of this one.
        ...(valued && shown.verdict ? { verdict: shown.verdict } : {}),
        ...(mark.expected !== undefined ? { expected: `${expectedText(mark)}${unitOf(mark.measure) === 'mm' ? ' mm' : '°'}` } : {}),
        ...(valued && mark.how ? { how: mark.how } : {}),
        ...(valued ? {} : { says: shown.none ? shown.text : mark.status === 'resolved' ? 'resolved: it is no longer measured' : notMeasuredText(mark, revision) })
      }
    }
  }
}

const exportable = (mark: Mark): mark is Exclude<Mark, { kind: 'region' | 'note' | 'sketch' }> => mark.kind !== 'region' && mark.kind !== 'note' && mark.kind !== 'sketch' && mark.anchorState !== 'orphaned'

/** The colour of each part as torno draws it, by name: the one the person gave it, or the palette's. */
export function partColors(scene: Scene, file: SceneFile): Map<string, string> {
  const palette = colorsOfParts(scene.parts)
  return new Map(
    scene.parts.map((part) => {
      const layer = own(file.layers, part.name)
      return [part.name, typeof layer?.color === 'string' && HEX.test(layer.color) ? layer.color : (palette.get(part.name) ?? colorFor(part.name, -1))]
    })
  )
}

/** Whether a part has a solid: an STL or a 3MF is of solids alone. Of a kernel that does not count them, whether it has a volume. */
export function hasSolid(part: Part): boolean {
  return part.solids === undefined ? part.volume > 0 : part.solids > 0
}

/** The names of the parts that are switched off in torno, as the scene file has them. */
export function switchedOff(scene: Scene, file: SceneFile): Set<string> {
  return new Set(scene.parts.map((part) => part.name).filter((name) => own(file.layers, name)?.visible === false))
}

/**
 * The marks of an object that go into a file of this request, were marks ticked: not a region, not one whose
 * part is gone, not a resolved one unless those are ticked, and not one that is only on parts left out of the
 * file (it would be on nothing there).
 */
function marksGoing(marks: readonly Mark[], req: ExportRequest, left: ReadonlySet<string>): Array<Exclude<Mark, { kind: 'region' | 'note' | 'sketch' }>> {
  return marks.filter(exportable).filter((mark) => {
    if (mark.status === 'resolved' && req.resolved !== true) return false
    const on = markAnchors(mark).map((anchor) => anchor.part).filter((part): part is string => part !== undefined)
    return on.length === 0 || on.some((part) => !left.has(part))
  })
}

/** The scans of an object that can go into a file: those with a mesh, aligned in a layout the build has. */
function placedScans(scans: readonly ScanInfo[], layouts: readonly string[]): Array<{ scan: ScanInfo; placed: ExportScan['placed'] }> {
  return scans.flatMap((scan) => {
    const placed: ExportScan['placed'] = record()
    for (const layout of layouts) {
      const alignment = alignmentOf(scan, layout)
      if (alignment) placed[layout] = { t: alignment.transform.t, q: alignment.transform.q, s: alignment.transform.s }
    }
    return scan.meshState === 'ok' && Object.keys(placed).length > 0 ? [{ scan, placed }] : []
  })
}

/** How many triangles each scan is cut to (`<objectId>/<scanId>`): null for one left out, nothing for the first of `SCAN_TRIANGLES`. */
type ScanLevels = Record<string, number | null>

async function exportObject(deps: ExportDeps, id: string, req: ExportRequest, levels: ScanLevels, dropped: string[]): Promise<ExportObject> {
  const obj = deps.object(id)
  if (!obj) throw new Error(NO_OBJECT)
  const last = deps.last(id)
  if (!last) throw new Error(NOT_BUILT)
  const { scene, revision } = last
  const file = await deps.sceneFile(id)
  const colors = partColors(scene, file)
  // Switched off in torno, a part stays here unless the person ticked those too.
  const left = req.hidden === true ? new Set<string>() : switchedOff(scene, file)
  const going = scene.parts.filter((part) => !left.has(part.name))
  const meshes = await packedMeshes(going, last.blob)
  const parts: ExportPart[] = going.map((part) => {
    const layer = own(file.layers, part.name)
    const opacity = typeof layer?.opacity === 'number' && Number.isFinite(layer.opacity) ? Math.min(Math.max(layer.opacity, 0), 1) : 1
    return {
      name: part.name,
      layout: part.layout,
      loc: part.loc,
      bbox: part.bbox,
      color: colors.get(part.name)!,
      opacity,
      visible: layer?.visible !== false,
      faces: part.faceCount,
      mesh: part.hash,
      ...(meshes[part.hash].segments === 0 && part.edgeCount > 0 && meshes[part.hash].triangles > 0 ? { creased: true as const } : {})
    }
  })
  // Of a part left out, its box alone: where the parts that go are drawn apart depends on it too.
  const ghosts: NonNullable<ExportObject['ghosts']> = []
  const before = record<number>()
  for (const part of scene.parts) {
    if (left.has(part.name)) ghosts.push({ layout: part.layout, before: before[part.layout] ?? 0, bbox: part.bbox })
    else before[part.layout] = (before[part.layout] ?? 0) + 1
  }
  const explode = record<ExplodeState>()
  for (const layout of scene.layouts) {
    const kept = explodeOf(own(file.explode, layout))
    if (kept) explode[layout] = kept
  }
  const object: ExportObject = {
    id: obj.id,
    name: obj.name,
    revision,
    layouts: [...scene.layouts],
    layout: file.layout !== undefined && scene.layouts.includes(file.layout) ? file.layout : (thumbnailLayout(scene.layouts) ?? ''),
    parts,
    meshes,
    ...(ghosts.length > 0 ? { ghosts } : {}),
    explode,
    // The person's, and those of the agent's they kept: a proposal nobody kept is not theirs to send. Why the agent proposed one stays here.
    // Nor does a view name a part that is left out of the file: what it hides of the parts that go is all it says.
    views: (file.views ?? []).filter((view) => !view.proposed).map(({ note: _note, ...view }) => ({ ...view, hidden: view.hidden.filter((name) => !left.has(name)) }))
  }
  if (req.marks) {
    const boxes = new Map<string, Record<string, { min: Vec3; max: Vec3 }>>()
    for (const part of going) {
      if (!boxes.has(part.layout)) boxes.set(part.layout, record())
      boxes.get(part.layout)![part.name] = part.bbox
    }
    const marks = marksGoing(await deps.marks(id), req, left).map((mark) => exportMark(mark, revision, boxes.get(mark.layout) ?? record()))
    if (marks.length > 0) object.marks = marks
  }
  const asked = req.scans.filter((key) => key.startsWith(`${id}/`)).map((key) => key.slice(id.length + 1))
  if (asked.length > 0) {
    const listed = await deps.scans(id)
    const placed = placedScans(listed, scene.layouts)
    const scans: ExportScan[] = []
    for (const scanId of asked) {
      const found = placed.find((one) => one.scan.id === scanId)
      if (!found) {
        const scan = listed.find((one) => one.id === scanId)
        if (scan) dropped.push(`${scan.id} of ${obj.name} left out: ${scan.meshState === 'ok' ? 'it is aligned in no layout of this build' : 'its mesh is gone'}`)
        continue
      }
      const most = levels[`${id}/${scanId}`]
      if (most === null) continue
      // Its id and its name, never where it came from.
      scans.push({ id: found.scan.id, name: found.scan.name, ...(await reducedScan(deps, obj, found.scan, most ?? SCAN_TRIANGLES[0])), placed: found.placed })
    }
    if (scans.length > 0) object.scans = scans
  }
  return object
}

function titleOf(req: ExportRequest, objects: readonly ExportObject[]): string {
  const asked = req.title?.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (asked) return asked
  if (objects.length === 1) return `${objects[0].name} · r${objects[0].revision}`
  const names = objects.map((object) => object.name)
  return names.length <= 3 ? names.join(' · ') : `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

async function assemble(deps: ExportDeps, req: ExportRequest, levels: ScanLevels): Promise<ExportData> {
  const dropped: string[] = []
  const objects: ExportObject[] = []
  for (const id of [...new Set(req.objects)]) objects.push(await exportObject(deps, id, req, levels, dropped))
  return { format: 'torno-export', version: 1, title: titleOf(req, objects), exportedAt: deps.now().toISOString(), objects, dropped }
}

/** The data of a request, with each scan cut to `scanTriangles` of its key (`<objectId>/<scanId>`; null leaves it out; 60,000 when not said). Rejects for an object that cannot be exported. */
export function exportData(deps: ExportDeps, req: ExportRequest, scanTriangles: Record<string, number | null> = {}): Promise<ExportData> {
  return assemble(deps, req, scanTriangles)
}

interface Produced { html: string; bytes: number; dropped: string[]; over: boolean; refusal?: string }

async function produce(deps: ExportDeps, req: ExportRequest, assets: PageAssets): Promise<Produced> {
  const budget = deps.budget ?? EXPORT_BUDGET
  const most = deps.most ?? EXPORT_MOST
  const levels: ScanLevels = record()
  // By scan, the last that was done to it: one cut twice is said once, as it is in the file.
  const cut = new Map<string, string>()
  for (;;) {
    const data = await assemble(deps, req, levels)
    data.dropped.push(...cut.values())
    const html = exportHtml(data, assets)
    const bytes = Buffer.byteLength(html)
    // Over the budget: the largest scan goes to the next size down, then out. Parts are never reduced.
    const scans = data.objects.flatMap((object) => (object.scans ?? []).map((scan) => ({ key: `${object.id}/${scan.id}`, of: object.name, scan })))
    const largest = scans.sort((a, b) => b.scan.data.length - a.scan.data.length)[0]
    if (bytes <= budget || !largest) {
      const refusal = bytes > most ? `The export would be ${megabytes(bytes)}: more than the ${megabytes(most)} torno writes in one file. Export fewer projects.` : undefined
      return { html, bytes, dropped: data.dropped, over: bytes > budget, ...(refusal ? { refusal } : {}) }
    }
    const next = SCAN_TRIANGLES.find((level) => level < largest.scan.triangles && level < (levels[largest.key] ?? SCAN_TRIANGLES[0])) ?? null
    levels[largest.key] = next
    cut.set(largest.key, next === null ? `${largest.scan.id} of ${largest.of} left out` : `${largest.scan.id} of ${largest.of} reduced to at most ${count(next)} triangles`)
  }
}

/** The data and the page for a request, with scans cut until the file is under the budget (D7). Rejects above `EXPORT_MOST`, and when no object named can be exported. */
export async function exportFile(deps: ExportDeps, req: ExportRequest, assets: PageAssets): Promise<{ html: string; bytes: number; dropped: string[]; over: boolean }> {
  if (req.objects.length === 0) throw new Error(NOTHING_CHOSEN)
  const { refusal, ...made } = await produce(deps, req, assets)
  if (refusal) throw new Error(refusal)
  return made
}

/**
 * What `exportFile` would write, without the page: of each object `listed` whether it can be exported and what
 * it would give, and of those the request names what the file would weigh and what would be cut. Never rejects
 * for an object that cannot be exported: it says so of it, and sizes the file without it.
 */
export async function exportPlan(deps: ExportDeps, req: ExportRequest, assets: PageAssets, listed: readonly string[] = req.objects): Promise<ExportPlan> {
  const objects: ExportPlan['objects'] = []
  for (const id of [...new Set(listed)]) {
    const obj = deps.object(id)
    const last = obj && deps.last(id)
    if (!obj || !last) {
      objects.push({ id, exportable: false, why: obj ? NOT_BUILT : NO_OBJECT, scans: [] })
      continue
    }
    const { scene, revision } = last
    const [file, marks, scans] = await Promise.all([deps.sceneFile(id), deps.marks(id).catch(() => []), deps.scans(id).catch(() => [])])
    const off = switchedOff(scene, file)
    const left = req.hidden === true ? new Set<string>() : off
    const sent = marksGoing(marks, req, left)
    const shapes = new Map(scene.parts.filter((part) => !left.has(part.name)).map((part) => [part.hash, part.triangleCount]))
    objects.push({
      id,
      exportable: true,
      revision,
      ...(deps.failing?.(id) ? { failed: true as const } : {}),
      triangles: [...shapes.values()].reduce((sum, n) => sum + n, 0),
      layouts: [...scene.layouts],
      parts: new Set(scene.parts.map((part) => part.name).filter((name) => !left.has(name))).size,
      off: off.size,
      views: (file.views ?? []).filter((view) => !view.proposed).map((view) => view.name),
      marks: sent.filter((mark) => mark.kind !== 'dimension').length,
      dimensions: sent.filter((mark) => mark.kind === 'dimension').length,
      drafts: sent.filter((mark) => mark.status === 'draft').length,
      // Of every mark that could go, ticked or not: the sheet offers them.
      resolved: marksGoing(marks, { ...req, resolved: true }, left).filter((mark) => mark.status === 'resolved').length,
      scans: placedScans(scans, scene.layouts).map(({ scan }) => ({ id: scan.id, name: scan.name, triangles: scan.imported.triangles })),
      layoutParts: scene.layouts.map((layout) => ({
        layout,
        parts: scene.parts.filter((part) => part.layout === layout).map((part) => ({ name: part.name, solid: hasSolid(part), ...(off.has(part.name) ? { off: true as const } : {}), ...(part.arranged?.some((d) => d !== 0) ? { arranged: true as const } : {}), ...(part.role === 'reference' ? { reference: true as const } : {}) }))
      }))
    })
  }
  const can = new Set(objects.filter((object) => object.exportable).map((object) => object.id))
  const chosen = [...new Set(req.objects)].filter((id) => can.has(id))
  const budget = deps.budget ?? EXPORT_BUDGET
  if (chosen.length === 0) return { objects, bytes: 0, dropped: [], over: false, budget, refusal: NOTHING_CHOSEN }
  // A file of the model is made by the kernel when it is saved: there is no page to weigh.
  if (req.format !== undefined && req.format !== 'html') return { objects, bytes: 0, dropped: [], over: false, budget, ...(chosen.length > 1 ? { refusal: ONE_OBJECT } : {}) }
  const { html: _html, ...made } = await produce(deps, { ...req, objects: chosen }, assets)
  return { objects, ...made, budget }
}
