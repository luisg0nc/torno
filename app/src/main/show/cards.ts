import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BuildState } from '../../shared/build'
import { standingOf, unmetDimensions } from '../../shared/dimension'
import type { DimensionMark, Mark } from '../../shared/marks'
import type { GitState } from '../../shared/git'
import type { Scene } from '../../shared/scene'
import type { ObjectCard, ThumbnailOf } from '../../shared/show'
import { layoutSize } from '../../shared/thumbnail'
import type { ObjectInfo } from '../../shared/workspace'
import { FOLDER, writeOwn } from '../own'
import { ensureIgnored } from '../ignored'
import { sanitiseMarksFile } from '../marks/file'

// The cards of the page of objects, and the picture each has on file. A card is read, never made: nothing here
// builds an object, starts a worker, opens a session or loads a scan, and of an object not opened in this run
// nothing is written or set aside either.

export const THUMB_PNG = 'thumb.png'
export const THUMB_JSON = 'thumb.json'
/** The most a picture may weigh. One of 480 × 360 is some 20 KB; the worst there is, noise in every pixel, 700 KB. */
export const THUMB_MAX_BYTES = 512 * 1024
const THUMB_WIDTH = 480
const THUMB_HEIGHT = 360
/** The longest first line of a build's error a card carries. */
const MAX_ERROR = 200
/** The most of the question a session waits on that a card carries. */
export const MAX_WAITING = 140

export interface CardDeps {
  objects(): ObjectInfo[]
  opened(objectId: string): boolean
  build(objectId: string): BuildState | undefined
  /** The marks of an object opened in this run, from the store. */
  marks(objectId: string): Promise<Mark[]>
  session(objectId: string): ObjectCard['session']
  /** Rejects when there is none. */
  readFile(path: string): Promise<string>
  /** When the newest of the Python files directly in a folder was last saved (`newestPython`); null when it has none, or is none. */
  sourcesMtimeMs(dir: string): Promise<number | null>
  /** How many bytes a file has; null when there is none. */
  size(path: string): Promise<number | null>
  /** What git says of an object's sources (`gitState`); null for none. Left out: git is not asked. */
  git?(dir: string): Promise<GitState | null>
  /** What the last good build of an opened object imported from outside its folder (`Scene.uses`), paths from the workspace. Absent: none is known. */
  uses?(objectId: string): string[]
  /** The question a session waits on for an object (`Asks.of`), and when it was put; null or absent for none. */
  waiting?(objectId: string): { question: string; since: number } | null | undefined
}

/**
 * What an object is built from, as far as torno can tell without building it: the Python files directly in its
 * folder and in the workspace's `common/` beside it, the two folders a change in which has it built again
 * (`Builds.open`). The kernel does not say which files a model read, so there is nothing finer.
 */
export function sourceFolders(dir: string): [own: string, common: string] {
  return [dir, join(dirname(dir), 'common')]
}

/** When the newest `.py` file directly in a folder was last saved, in ms; null for a folder with none, or for none. */
export async function newestPython(dir: string): Promise<number | null> {
  const names = await readdir(dir).catch(() => [] as string[])
  const saved = await Promise.all(names.filter((name) => name.endsWith('.py')).map((name) => stat(join(dir, name)).then((s) => (s.isFile() ? s.mtimeMs : null), () => null)))
  const found = saved.filter((at): at is number => at !== null)
  return found.length > 0 ? Math.max(...found) : null
}

/** The newer of two such moments; null when the object's own folder has no source to speak of. */
const newestOf = (own: number | null, common: number | null): number | null => (own === null ? null : Math.max(own, common ?? -Infinity))

/** When the newest of the files a build imported from beside its project was last saved, in ms; null when it imported none or they are gone. `uses` are paths from the workspace root. */
export async function newestUsed(root: string, uses: string[]): Promise<number | null> {
  const saved = await Promise.all(uses.map((file) => stat(join(root, file)).then((s) => (s.isFile() ? s.mtimeMs : null), () => null)))
  const found = saved.filter((at): at is number => at !== null)
  return found.length > 0 ? Math.max(...found) : null
}

/** The most files of `Scene.uses` a card names. */
const MAX_USES = 20

/** One card per object of the workspace, in the list's order. */
export function cardsOf(deps: CardDeps): Promise<ObjectCard[]> {
  // The common folder is every object's: looked at once for all the cards.
  const asked = new Map<string, Promise<number | null>>()
  const common = (dir: string): Promise<number | null> => {
    const found = asked.get(dir) ?? deps.sourcesMtimeMs(dir).catch(() => null)
    asked.set(dir, found)
    return found
  }
  return Promise.all(deps.objects().map((obj) => cardOf(deps, obj, common)))
}

async function cardOf(deps: CardDeps, obj: ObjectInfo, commonOf: (dir: string) => Promise<number | null>): Promise<ObjectCard> {
  const opened = deps.opened(obj.id)
  const state = opened ? deps.build(obj.id) : undefined
  // Of an object opened here the store has the marks, checked against its build. Of another, what its file
  // says is read and nothing more: the store would set a file it cannot read aside, and that is a write.
  const marks = opened ? await deps.marks(obj.id).catch(() => null) : await deps.readFile(join(obj.dir, FOLDER, 'marks.json')).then(peekMarks, (e: unknown) => (isMissing(e) ? [] : null))
  const meta = await deps.readFile(join(obj.dir, FOLDER, THUMB_JSON)).then((text) => JSON.parse(text) as unknown).catch(() => null)
  const [own, common] = sourceFolders(obj.dir)
  // What the last build of this run imported from other projects counts as a source too.
  const uses = opened ? (deps.uses?.(obj.id) ?? []) : []
  const used = uses.length > 0 ? await newestUsed(dirname(obj.dir), uses) : null
  // When a source was last saved: one read of two folders' listings, nothing built. For the picture's `behind` and for the card's own line.
  const newest = obj.model === null ? null : newestOf(await deps.sourcesMtimeMs(own).catch(() => null), await commonOf(common))
  const saved = newest === null || used === null ? newest : Math.max(newest, used)
  let thumb = meta === null ? null : thumbOf(meta, saved)
  // A picture of what another file made is behind, whenever that one was last saved.
  if (thumb && (meta as { model?: unknown }).model !== obj.model) thumb = { ...thumb, behind: true }
  // The picture on file is not the one these facts are of (two builds landed close together, a file was put
  // there by hand): there is then no picture to show. By its size here; by its bytes when it is asked for.
  if (thumb && (await deps.size(join(obj.dir, FOLDER, THUMB_PNG)).catch(() => null)) !== (meta as { bytes?: unknown }).bytes) thumb = null

  const card: ObjectCard = { id: obj.id, name: obj.name, opened, thumb, marks: marks && { open: marks.filter((m) => m.status !== 'resolved').length, drafts: marks.filter((m) => m.status === 'draft').length }, dimensions: null, session: deps.session(obj.id) }
  const git = obj.model === null ? null : await deps.git?.(obj.dir).catch(() => null)
  if (git) card.git = git
  // The size is the picture's: told of none when there is no picture, and of none the kernel did not give.
  const box = thumb ? boxOf(meta) : undefined
  if (box) card.box = box
  const waiting = deps.waiting?.(obj.id)
  if (waiting) card.waiting = { question: waiting.question.slice(0, MAX_WAITING), since: waiting.since }
  if (saved !== null) card.sourcesMtimeMs = saved
  if (uses.length > 0) card.uses = uses.slice(0, MAX_USES)
  if (obj.problem !== undefined) {
    // The folder by its name: the card is of that folder, and where it is on this machine is for whoever asks.
    card.problem = obj.problem.split(obj.dir).join(obj.name)
    if (card.problem !== obj.problem) card.problemAt = obj.problem
  }
  if (state) {
    card.build = { status: state.status, revision: state.revision, stale: state.stale }
    if (state.letGo) card.build.letGo = state.letGo
    if (state.error) card.build.error = firstLine(state.error.message)
  }
  if (!marks) return card
  const open = marks.filter((m): m is DimensionMark => m.kind === 'dimension' && m.status !== 'resolved')
  if (state && state.revision > 0) {
    // As the status line counts them: against the last build of this run, and by no other.
    const unmet = unmetDimensions(marks, state.revision)
    card.dimensions = { failing: unmet.failing.length, unmeasured: unmet.unmeasured.length, passing: open.filter((m) => standingOf(m, state.revision) === 'pass').length }
  } else if (open.length > 0) {
    card.lastRun = { dimensions: open.length, failed: open.filter((m) => m.verdict === 'fail').length }
  }
  return card
}

function firstLine(message: string): string {
  return (message.split('\n').find((line) => line.trim() !== '') ?? '').trim().slice(0, MAX_ERROR)
}

function isMissing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** The marks of a folder as its file has them, read and nothing else: no file is set aside, nothing is written. Null when it cannot be read as one. */
export function peekMarks(text: string): Mark[] | null {
  try {
    return sanitiseMarksFile(JSON.parse(text))?.marks ?? null
  } catch {
    return null
  }
}

/**
 * What a `thumb.json` says, against when the newest source of its object was last saved (null when that cannot
 * be said). `behind` when a source is newer than the newest there was when the picture's build was started, or
 * when either is not known. Null for what is not one.
 */
export function thumbOf(meta: unknown, sourcesMtimeMs: number | null): ObjectCard['thumb'] {
  const said = meta as { at?: unknown; layout?: unknown; sourcesMtimeMs?: unknown; cut?: unknown; apart?: unknown; hidden?: unknown; bench?: unknown } | null
  if (typeof said !== 'object' || said === null || typeof said.at !== 'string' || typeof said.layout !== 'string' || said.layout === '') return null
  const made = typeof said.sourcesMtimeMs === 'number' ? said.sourcesMtimeMs : null
  const thumb: NonNullable<ObjectCard['thumb']> = { at: said.at.slice(0, 40), layout: said.layout.slice(0, 100), behind: made === null || sourcesMtimeMs === null || sourcesMtimeMs > made }
  if (said.cut === true) thumb.cut = true
  if (said.apart === true) thumb.apart = true
  if (said.bench === true) thumb.bench = true
  if (typeof said.hidden === 'number' && Number.isSafeInteger(said.hidden) && said.hidden > 0) thumb.hidden = said.hidden
  return thumb
}

/** The size a `thumb.json` keeps (`saveThumbnail`): three lengths in mm and whether the kernel's box was exact; undefined for anything else. */
function boxOf(meta: unknown): ObjectCard['box'] {
  const said = (meta as { box?: { x?: unknown; y?: unknown; z?: unknown; exact?: unknown } | null } | null)?.box
  if (typeof said !== 'object' || said === null || typeof said.exact !== 'boolean') return undefined
  const { x, y, z } = said
  const length = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  return length(x) && length(y) && length(z) ? { x, y, z, exact: said.exact } : undefined
}

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** `IHDR`: the chunk a PNG starts with, which holds its width and height. */
const PNG_FIRST_CHUNK = [0x49, 0x48, 0x44, 0x52]

/** Why bytes the window handed over are not kept as a picture, or null: a PNG, 480 × 360, at most `THUMB_MAX_BYTES`. */
export function thumbnailRefusal(png: Uint8Array): string | null {
  if (!(png instanceof Uint8Array)) return 'not a PNG'
  if (png.length > THUMB_MAX_BYTES) return 'a picture of more than 512 KB'
  if (png.length < 24 || PNG_HEAD.some((byte, i) => png[i] !== byte) || PNG_FIRST_CHUNK.some((byte, i) => png[12 + i] !== byte)) return 'not a PNG'
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return header.getUint32(16) === THUMB_WIDTH && header.getUint32(20) === THUMB_HEIGHT ? null : 'not a 480 × 360 picture'
}

const hashOf = (png: Uint8Array): string => createHash('sha256').update(png).digest('hex')

/** The last save of each folder: a picture and its facts are written as a pair, one pair after the other. */
const saves = new Map<string, Promise<void>>()

/**
 * Keeps a picture of an object and what it is of: `<dir>/.torno/thumb.png`, then `thumb.json`, each whole or not
 * at all, and one save of a folder after the other, so that the last one asked for is what is there. The facts
 * say how many bytes the picture has and what they hash to: a picture that is not the one its facts are of (a
 * crash between the two writes) is shown as none (`thumbnailOnFile`, `cardsOf`). Git is told to pass over the
 * two, which change with every build (`ensureIgnored`).
 */
export function saveThumbnail(dir: string, png: Uint8Array, of: ThumbnailOf & { model: string; sourcesMtimeMs: number | null; box?: NonNullable<ObjectCard['box']> }, now: Date): Promise<void> {
  const save = (saves.get(dir) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const meta: Record<string, unknown> = { at: now.toISOString(), layout: of.layout, parts: of.parts, model: of.model, sourcesMtimeMs: of.sourcesMtimeMs, bytes: png.length, hash: hashOf(png) }
      if (of.cut) meta.cut = true
      if (of.apart) meta.apart = true
      if (of.hidden) meta.hidden = of.hidden
      if (of.box) meta.box = of.box
      if (of.box && of.bench) meta.bench = true
      await writeOwn(dir, THUMB_PNG, png)
      await writeOwn(dir, THUMB_JSON, `${JSON.stringify(meta)}\n`)
      await ensureIgnored(dir, [THUMB_PNG, THUMB_JSON])
    })
    .finally(() => {
      if (saves.get(dir) === save) saves.delete(dir)
    })
  saves.set(dir, save)
  return save
}

/**
 * The picture a folder has on file, when it is one a card may show: of the size of one (`thumbnailRefusal`, and
 * not read at all when the file is larger), and the very bytes its facts are of. Null otherwise.
 */
export async function thumbnailOnFile(dir: string): Promise<Uint8Array | null> {
  const path = join(dir, FOLDER, THUMB_PNG)
  try {
    if ((await stat(path)).size > THUMB_MAX_BYTES) return null
    const facts = JSON.parse(await readFile(join(dir, FOLDER, THUMB_JSON), 'utf8')) as { bytes?: unknown; hash?: unknown } | null
    const png = await readFile(path)
    return thumbnailRefusal(png) === null && facts?.bytes === png.length && facts.hash === hashOf(png) ? png : null
  } catch {
    return null
  }
}

/** What keeping a picture asks of the open workspace. */
export interface KeepDeps {
  /** An object of the open workspace as of the last scan. */
  object(objectId: string): ObjectInfo | undefined
  /** Opened in this run. */
  opened(objectId: string): boolean
  /** The last good build of an object: its revision, and when the build it came of was started (ms epoch) when that is known. */
  lastBuild(objectId: string): { revision: number; startedMs?: number; uses?: string[]; scene?: Scene } | undefined
}

/**
 * Keeps the picture the window drew of an object's build; says whether it did. Only of an object opened in this
 * run of the open workspace, only of its last good build, and only bytes that are such a picture: anything else
 * is dropped. What it is said to be of is main's to say: the model file, and when the newest of the object's
 * sources was last saved as far as the build read them (one saved again since the build started is newer than
 * its picture).
 */
export async function keepThumbnail(deps: KeepDeps, objectId: string, revision: number, png: Uint8Array, of: ThumbnailOf): Promise<boolean> {
  const obj = deps.object(objectId)
  const built = deps.lastBuild(objectId)
  if (!obj || obj.model === null || !deps.opened(objectId) || built?.revision !== revision) return false
  const said = Object(of) as Partial<ThumbnailOf>
  if (thumbnailRefusal(png) !== null || typeof said.layout !== 'string' || said.layout === '' || said.layout.length > 100 || !Number.isSafeInteger(said.parts) || said.parts! < 0) return false
  const [own, common] = sourceFolders(obj.dir)
  const ownSaved = newestOf(await newestPython(own), await newestPython(common))
  const used = built.uses && built.uses.length > 0 ? await newestUsed(dirname(obj.dir), built.uses) : null
  const saved = ownSaved === null || used === null ? ownSaved : Math.max(ownSaved, used)
  const sourcesMtimeMs = saved === null ? null : built.startedMs === undefined ? saved : Math.min(saved, built.startedMs)
  // The workspace may have been left, or the object built again, while the folders were looked at.
  if (deps.object(objectId)?.dir !== obj.dir || deps.lastBuild(objectId)?.revision !== revision) return false
  // The size is the kernel's, from the build's own scene: what the window says of it is not taken.
  const box = built.scene ? layoutSize(built.scene, said.layout) : null
  const hidden = typeof said.hidden === 'number' && Number.isSafeInteger(said.hidden) && said.hidden > 0 ? said.hidden : 0
  await saveThumbnail(obj.dir, png, { layout: said.layout, parts: said.parts!, model: obj.model, sourcesMtimeMs, ...(said.cut === true ? { cut: true } : {}), ...(said.apart === true ? { apart: true } : {}), ...(hidden ? { hidden } : {}), ...(box ? { box, ...(said.bench === true ? { bench: true } : {}) } : {}) }, new Date())
  return true
}
