import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import type { CreateRequest } from '../../shared/bridge'
import { MAX_PHOTO_BYTES, moduleName, MOST_REFERENCES, objectNameProblem } from '../../shared/objectName'
import { SCAN_FORMATS } from '../../shared/scans'
import { writeFileAtomic } from '../atomic'
import template from './template.py.txt?raw'

// Making an object is the one thing torno writes in a workspace outside `<object>/.torno/`: one new folder,
// `<root>/<name>/`, with the template model, `brief.md` and `reference/`. Everything is made in a hidden
// folder beside it (`.<name>.torno-new-<random>`, which the listing of a workspace never shows) and that
// folder takes the name as the last step, so that the folder is whole or not there. Nothing that exists is
// written into or replaced; whatever the window sent is checked here again.

/** The most of each kind of reference. */
export const MOST = MOST_REFERENCES
/** The biggest photo, and the biggest doodle, in bytes. */
export const MAX_PHOTO = MAX_PHOTO_BYTES
export const MAX_DOODLE = 8 * 1024 * 1024
/** The longest description and the longest note, in characters. */
const MAX_DESCRIPTION = 20_000
const MAX_NOTE = 2_000
const PHOTO_TYPES = ['.png', '.jpg', '.jpeg', '.webp']
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface CreateDeps {
  /** The open workspace's folder. */
  root: string
  /** The ids of its objects, which are what another object may be referred to by. */
  objects: readonly string[]
  /** For tests: called with the temp folder when everything is written, before it takes the name. */
  hooks?: { beforeRename?: (temp: string) => void | Promise<void> }
}

/** What a crash between the claim and the rename leaves: `.<name>.torno-new-<12 hex>`. Nothing else is ours to remove. */
const TEMP_FOLDER = /^\.[A-Za-z0-9][A-Za-z0-9._-]*\.torno-new-[0-9a-f]{12}$/

/** How old a hidden folder is before it is taken for a crash's: no create takes this long, however big the photos. */
export const STALE_AFTER_MS = 10 * 60 * 1000

/** Whether a crashed create's folder holds files in `reference/`: the doodles in it exist nowhere else, so it is left for the person. */
function holdsReferences(folder: string): boolean {
  try {
    return readdirSync(join(folder, 'reference')).length > 0
  } catch {
    return false
  }
}

/**
 * Removes the hidden folders of a create that never ended (`.<name>.torno-new-<random>`) from the root of a
 * workspace, when they are real folders last changed more than 10 minutes before `now` (another torno may be
 * creating in the same workspace) and hold nothing in `reference/` (what the person gave is not deleted). A link of that name is left alone, as is
 * whatever it leads to. Whatever cannot be removed is left; nothing is said.
 */
export function sweepStaleNew(root: string, now: number): void {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return
  }
  for (const name of names) {
    if (!TEMP_FOLDER.test(name)) continue
    try {
      const stat = lstatSync(join(root, name))
      if (stat.isDirectory() && stat.mtimeMs < now - STALE_AFTER_MS && !holdsReferences(join(root, name))) rmSync(join(root, name), { recursive: true, force: true })
    } catch {
      // Gone, or not ours to remove.
    }
  }
}

/** Whether the path is a real folder with nothing in it (not a link to one). */
async function isEmptyFolder(path: string): Promise<boolean> {
  const stat = await lstat(path).catch(() => null)
  return stat !== null && stat.isDirectory() && (await readdir(path).catch(() => ['?'])).length === 0
}

/** What the window sent as a sentence in one line: a note is a line of `brief.md`. */
export function oneLine(note: unknown, what: string): string {
  if (note === undefined || note === null) return ''
  if (typeof note !== 'string') throw new Error(`The note of a ${what} is not text.`)
  if (note.length > 10 * MAX_NOTE) throw new Error(`The note of a ${what} is over ${MAX_NOTE} characters.`)
  const folded = note.replace(/\s+/g, ' ').trim()
  if (folded.length > MAX_NOTE) throw new Error(`The note of a ${what} is over ${MAX_NOTE} characters.`)
  return folded
}

/** A path under the person's home folder with `~` for it: `brief.md` is meant to be committed. */
function homeRelative(path: string): string {
  const home = homedir()
  return home.length > 1 && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

const line = (what: string, note: string): string => (note === '' ? `- ${what}` : `- ${what}: ${note}`)

/**
 * The bytes of a regular file of at most `cap` bytes, and nothing else: a link, a folder, a pipe and a file that
 * is too big are refused before any of it is read. The file is opened without following a link and looked at
 * through the open handle, so that what was checked is what is read.
 */
export async function readRegular(path: unknown, cap: number, what: string): Promise<{ bytes: Buffer; ext: string }> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`A ${what} is given by the path of a file; this is not one.`)
  const ext = extname(path).toLowerCase()
  if (!PHOTO_TYPES.includes(ext)) throw new Error(`${path} is not a ${PHOTO_TYPES.join(', ')} file.`)
  const stat = await lstat(path).catch(() => null)
  if (!stat) throw new Error(`${path} is not there.`)
  if (!stat.isFile()) throw new Error(`${path} is ${stat.isSymbolicLink() ? 'a link' : 'not a plain file'}: torno copies only plain files.`)
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => {
    throw new Error(`${path} cannot be opened as a plain file.`)
  })
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) throw new Error(`${path} is not a plain file: torno copies only plain files.`)
    if (opened.size > cap) throw new Error(`${path} is over ${cap / (1024 * 1024)} MB.`)
    // One byte more than the size said: a file that grew since is caught, not read whole.
    const bytes = Buffer.alloc(opened.size + 1)
    let got = 0
    while (got < bytes.length) {
      const { bytesRead } = await handle.read(bytes, got, bytes.length - got, got)
      if (bytesRead === 0) break
      got += bytesRead
    }
    if (got > opened.size) throw new Error(`${path} changed while it was read.`)
    return { bytes: bytes.subarray(0, got), ext }
  } finally {
    await handle.close()
  }
}

/**
 * The bytes of an image file the window was given by a dialog or a drop, for it to draw a thumbnail and scale a
 * copy for the first prompt (it cannot read a file itself). The same file rules as a photo copied into `reference/`.
 */
export async function readPhoto(path: unknown): Promise<Uint8Array> {
  const { bytes } = await readRegular(path, MAX_PHOTO, 'photo')
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length)
}

/** The request, held to what it may be; throws a plain reason. Returns what `brief.md` needs. */
function checked(req: CreateRequest, deps: CreateDeps, existing: readonly string[]): void {
  if (typeof req !== 'object' || req === null) throw new Error('No object to make.')
  if (typeof req.name !== 'string') throw new Error('Give the object a name.')
  const problem = objectNameProblem(req.name, existing)
  if (problem) throw new Error(problem)
  if (typeof req.description !== 'string' || req.description.trim() === '') throw new Error('Say what it is first.')
  if (req.description.length > MAX_DESCRIPTION) throw new Error(`The description is over ${MAX_DESCRIPTION} characters.`)
  for (const kind of ['photos', 'doodles', 'scans', 'objects'] as const) {
    if (!Array.isArray(req[kind])) throw new Error(`The ${kind} are not a list.`)
    if (req[kind].length > MOST[kind]) throw new Error(`At most ${MOST[kind]} ${kind}.`)
  }
  for (const scan of req.scans) {
    if (typeof scan?.path !== 'string' || !isAbsolute(scan.path) || !(SCAN_FORMATS as readonly string[]).includes(extname(scan.path).toLowerCase())) {
      throw new Error(`A scan is a ${SCAN_FORMATS.join(', ')} file given by its path.`)
    }
    oneLine(scan.note, 'scan')
    // The path is one line of `brief.md`: one with a line break (or any control character) could write lines of its own.
    if (/\p{Cc}/u.test(scan.path)) throw new Error('The path of a scan has a control character or a line break in it.')
  }
  for (const photo of req.photos) {
    if (typeof photo?.path !== 'string') throw new Error('A photo is given by the path of a file; this is not one.')
    oneLine(photo.note, 'photo')
  }
  for (const doodle of req.doodles) oneLine(doodle?.note, 'doodle')
  for (const [kind, keys] of [['photo', req.photos.map((p) => p.path)], ['scan', req.scans.map((s) => s.path)], ['object', req.objects.map((o) => o?.id)]] as const) {
    if (new Set(keys).size !== keys.length) throw new Error(`The same ${kind} is given twice.`)
  }
  for (const other of req.objects) {
    oneLine(other?.note, 'object')
    if (typeof other?.id !== 'string' || !deps.objects.includes(other.id)) throw new Error(`There is no object ${JSON.stringify(other?.id)} in this workspace.`)
  }
}

/**
 * Makes `<root>/<name>/` and answers with the object's id. Rejects, with the reason, when it could not, and
 * then nothing of it is left. The caller refreshes the workspace's listing.
 */
export async function createObject(req: CreateRequest, deps: CreateDeps): Promise<{ objectId: string }> {
  const name = typeof req?.name === 'string' ? req.name : ''
  const target = join(deps.root, name)
  let existing = await readdir(deps.root)
  // A folder of the name with nothing in it is free (a crash between the claim and the rename leaves one; it holds
  // nothing to lose): the finished folder takes its place.
  const reuse = name !== '' && existing.includes(name) && (await isEmptyFolder(target))
  if (reuse) existing = existing.filter((entry) => entry !== name)
  checked(req, deps, existing)
  const temp = join(deps.root, `.${name}.torno-new-${randomBytes(6).toString('hex')}`)
  let claimed = false
  await mkdir(temp)
  try {
    const references: string[] = []
    await writeFileAtomic(join(temp, `${moduleName(name)}.py`), template)
    let n = 0
    for (const photo of req.photos) {
      const { bytes, ext } = await readRegular(photo?.path, MAX_PHOTO, 'photo')
      const file = `reference/photo-${++n}${ext}`
      await writeFileAtomic(join(temp, file), bytes)
      references.push(line(file, oneLine(photo.note, 'photo')))
    }
    n = 0
    for (const doodle of req.doodles) {
      const png = doodle?.png
      if (!(png instanceof Uint8Array)) throw new Error('A doodle is the bytes of a PNG.')
      if (png.length > MAX_DOODLE) throw new Error('A doodle is at most 8 MB.')
      if (png.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('A doodle is a PNG; this is not one.')
      const file = `reference/doodle-${++n}.png`
      await writeFileAtomic(join(temp, file), png)
      references.push(line(file, oneLine(doodle.note, 'doodle')))
    }
    for (const scan of req.scans) references.push(line(`scan ${homeRelative(scan.path)}`, oneLine(scan.note, 'scan')))
    for (const other of req.objects) references.push(line(`../${other.id}/`, oneLine(other.note, 'object')))
    const brief = [`# ${name}`, '', req.description.trim(), ...(references.length ? ['', '## References', '', ...references] : []), ''].join('\n')
    await writeFileAtomic(join(temp, 'brief.md'), brief)

    await deps.hooks?.beforeRename?.(temp)
    // The name is taken by making it, which fails if it is there (in any case, on a disk that does not tell them
    // apart): then the finished folder takes the place of that empty one, which refuses to be replaced if anyone
    // put anything in it meanwhile. The last step.
    if (!reuse) {
      await mkdir(target).catch((e: NodeJS.ErrnoException) => {
        throw e.code === 'EEXIST' ? new Error(`A folder \`${name}\` is there already.`) : e
      })
    }
    // Only a folder made here is removed again: an empty one that was there is the person's.
    claimed = !reuse
    // A folder that was empty and had something put in it meanwhile is not replaced: the rename fails.
    await rename(temp, target).catch((e: NodeJS.ErrnoException) => {
      throw e.code === 'ENOTEMPTY' || e.code === 'EEXIST' ? new Error(`A folder \`${name}\` is there already.`) : e
    })
  } catch (e) {
    if (claimed) await rmdir(target).catch(() => {})
    await rm(temp, { recursive: true, force: true }).catch(() => {})
    throw e
  }
  return { objectId: name }
}
