import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { type FileHandle, lstat, mkdir, open, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import type { CreateRequest } from '../../shared/bridge'
import { linkProblem, MAX_LINK_NOTE, MAX_LINKS, MAX_PDF_BYTES, MAX_PHOTO_BYTES, MAX_STEP_BYTES, moduleName, MOST_REFERENCES, objectNameProblem, PDF_FORMATS, referenceFiles, STEP_FORMATS } from '../../shared/objectName'
import { MAX_SIZES, checkSize, type SizeFact } from '../../shared/size'
import { SCAN_FORMATS } from '../../shared/scans'
import { MAX_TEXT_CHARS } from '../../shared/board'
import { writeFileAtomic } from '../atomic'
import { textOf } from '../board/file'
import { startBoard } from '../board/start'
import { FOLDER } from '../own'
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
/** The biggest vendor STEP file, in bytes (50 MB). */
export const MAX_STEP = MAX_STEP_BYTES
/** The biggest PDF, in bytes (25 MB). */
export const MAX_PDF = MAX_PDF_BYTES
export const MAX_DOODLE = 8 * 1024 * 1024
/** The longest description and the longest note, in characters. */
const MAX_DESCRIPTION = 20_000
const MAX_NOTE = 2_000
/** What a board takes of the rest: the rules (a text card holds this much), the links, and a link's note. */
export const MAX_RULES = MAX_TEXT_CHARS
export { MAX_LINKS }
const PDF_SIGNATURE = '%PDF-'
const PHOTO_TYPES = ['.png', '.jpg', '.jpeg', '.webp']
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface CreateDeps {
  /** The open workspace's folder. */
  root: string
  /** The ids of its objects, which are what another object may be referred to by. */
  objects: readonly string[]
  /** For tests: called with the temp folder when everything is written, before it takes the name. */
  hooks?: {
    /** Called with the temp folder once it is made, before anything is written in it. */
    afterTemp?: (temp: string) => void | Promise<void>
    /** Called with the temp folder when the files are written, before the board is. */
    beforeBoard?: (temp: string) => void | Promise<void>
    beforeRename?: (temp: string) => void | Promise<void>
  }
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
 * A plain file opened for reading, of at most `cap` bytes, and nothing else: a link, a folder, a pipe and a file that
 * is too big are refused before any of it is read. The file is opened without following a link and looked at
 * through the open handle, so that what was checked is what is read. The caller closes the handle.
 */
async function openRegular(path: unknown, cap: number, what: string, types: readonly string[]): Promise<{ handle: FileHandle; size: number; ext: string; path: string }> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`A ${what} is given by the path of a file; this is not one.`)
  const ext = extname(path).toLowerCase()
  if (!types.includes(ext)) throw new Error(`${path} is not a ${types.join(', ')} file.`)
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
    return { handle, size: opened.size, ext, path }
  } catch (e) {
    await handle.close()
    throw e
  }
}

/** The bytes of a regular file of at most `cap` bytes, and nothing else (`openRegular`). */
export async function readRegular(path: unknown, cap: number, what: string, types: readonly string[] = PHOTO_TYPES): Promise<{ bytes: Buffer; ext: string }> {
  const { handle, size, ext, path: at } = await openRegular(path, cap, what, types)
  try {
    // One byte more than the size said: a file that grew since is caught, not read whole.
    const bytes = Buffer.alloc(size + 1)
    let got = 0
    while (got < bytes.length) {
      const { bytesRead } = await handle.read(bytes, got, bytes.length - got, got)
      if (bytesRead === 0) break
      got += bytesRead
    }
    if (got > size) throw new Error(`${at} changed while it was read.`)
    return { bytes: bytes.subarray(0, got), ext }
  } finally {
    await handle.close()
  }
}

/** Whether `bytes` start as a PDF does. */
const isPdf = (bytes: Uint8Array): boolean => PDF_SIGNATURE.split('').every((c, i) => bytes[i] === c.charCodeAt(0))

/** Looks at a PDF without reading it: a plain file of at most 25 MB that starts `%PDF-`. Throws the reason. */
async function checkPdf(path: unknown): Promise<void> {
  const { handle, path: at } = await openRegular(path, MAX_PDF, 'PDF', PDF_FORMATS)
  try {
    const head = Buffer.alloc(PDF_SIGNATURE.length)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    if (bytesRead < head.length || !isPdf(head)) throw new Error(`${at} is not a PDF: it does not start with ${PDF_SIGNATURE}.`)
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

/** What the board is made from, once the request has been held to what it may be. */
interface Checked {
  sizes: SizeFact[]
  rules: string
  links: Array<{ url: string; note: string }>
}

/** A link: `http` or `https` only (any case of the scheme), one word, a host, at most 2000 characters. */
export function checkLink(link: unknown): { url: string; note: string } {
  const url = (link as { url?: unknown } | null)?.url
  const problem = linkProblem(url)
  if (problem !== null) throw new Error(problem)
  const note = oneLine((link as { note?: unknown }).note, 'link')
  if (note.length > MAX_LINK_NOTE) throw new Error(`The note of a link is over ${MAX_LINK_NOTE} characters.`)
  return { url: url as string, note }
}

/** The request, held to what it may be; throws a plain reason. Returns what the board needs. */
async function checked(req: CreateRequest, deps: CreateDeps, existing: readonly string[]): Promise<Checked> {
  if (typeof req !== 'object' || req === null) throw new Error('No project to make.')
  if (typeof req.name !== 'string') throw new Error('Give the project a name.')
  const problem = objectNameProblem(req.name, existing)
  if (problem) throw new Error(problem)
  if (typeof req.description !== 'string' || req.description.trim() === '') throw new Error('Say what it is first.')
  if (req.description.length > MAX_DESCRIPTION) throw new Error(`The description is over ${MAX_DESCRIPTION} characters.`)
  const named = { photos: 'photos', doodles: 'doodles', steps: 'bought parts', scans: 'scans', objects: 'projects', pdfs: 'PDFs' }
  for (const kind of ['photos', 'doodles', 'steps', 'scans', 'objects', 'pdfs'] as const) {
    if (!Array.isArray(req[kind])) throw new Error(`The ${named[kind]} are not a list.`)
    if (req[kind].length > MOST[kind]) throw new Error(`At most ${MOST[kind]} ${named[kind]}.`)
  }
  for (const scan of req.scans) {
    if (typeof scan?.path !== 'string' || !isAbsolute(scan.path) || !(SCAN_FORMATS as readonly string[]).includes(extname(scan.path).toLowerCase())) {
      throw new Error(`A scan is a ${SCAN_FORMATS.join(', ')} file given by its path.`)
    }
    oneLine(scan.note, 'scan')
    // The path is one line of `brief.md`: one with a line break (or any control character) could write lines of its own.
    if (/\p{Cc}/u.test(scan.path)) throw new Error('The path of a scan has a control character or a line break in it.')
  }
  for (const step of req.steps) {
    if (typeof step?.path !== 'string' || !isAbsolute(step.path) || !(STEP_FORMATS as readonly string[]).includes(extname(step.path).toLowerCase())) {
      throw new Error(`A bought part is a STEP file (${STEP_FORMATS.join(" or ")}) given by its path.`)
    }
    oneLine(step.note, 'bought part')
  }
  for (const photo of req.photos) {
    if (photo !== null && typeof photo === 'object' && 'png' in photo && !('path' in photo)) checkedPng(photo.png, 'photo')
    else if (typeof (photo as { path?: unknown })?.path !== 'string' || 'png' in photo) throw new Error('A photo is given by the path of a file, or as the bytes of a PNG; this is neither.')
    oneLine(photo.note, 'photo')
  }
  for (const doodle of req.doodles) {
    oneLine(doodle?.note, 'doodle')
    const over = doodle?.over
    if (doodle?.onPhoto !== undefined && doodle.onPhoto !== true) throw new Error('A doodle is over a photo or it is not.')
    if (over !== undefined && (!Number.isInteger(over) || over < 0 || over >= req.photos.length)) throw new Error('A doodle is drawn over one of the photos given.')
  }
  for (const pdf of req.pdfs) {
    if (typeof pdf?.path !== 'string' || !isAbsolute(pdf.path) || !(PDF_FORMATS as readonly string[]).includes(extname(pdf.path).toLowerCase())) {
      throw new Error('A PDF is a .pdf file given by its path.')
    }
    oneLine(pdf.note, 'PDF')
  }
  for (const [kind, keys] of [['photo', req.photos.flatMap((p) => ('path' in p ? [p.path] : []))], ['bought part', req.steps.map((s) => s.path)], ['PDF', req.pdfs.map((p) => p.path)], ['scan', req.scans.map((s) => s.path)], ['project', req.objects.map((o) => o?.id)]] as const) {
    if (new Set(keys).size !== keys.length) throw new Error(`The same ${kind} is given twice.`)
  }
  for (const other of req.objects) {
    oneLine(other?.note, 'project')
    if (typeof other?.id !== 'string' || !deps.objects.includes(other.id)) throw new Error(`There is no project ${JSON.stringify(other?.id)} in this workspace.`)
  }
  if (!Array.isArray(req.sizes)) throw new Error('The sizes are not a list.')
  if (req.sizes.length > MAX_SIZES) throw new Error(`At most ${MAX_SIZES} sizes.`)
  const sizes = req.sizes.map((raw) => {
    const size = checkSize(raw, 'person')
    if (typeof size === 'string') throw new Error(size)
    return size
  })
  if (typeof req.rules !== 'string') throw new Error('The rules are not text.')
  if (req.rules.length > MAX_RULES) throw new Error(`The rules are over ${MAX_RULES} characters.`)
  if (!Array.isArray(req.links)) throw new Error('The links are not a list.')
  if (req.links.length > MAX_LINKS) throw new Error(`At most ${MAX_LINKS} links.`)
  const links = req.links.map(checkLink)
  // The files last, the one thing that reads the disk: each is looked at, not read, so that nothing is made for a PDF that is no good.
  for (const pdf of req.pdfs) await checkPdf(pdf.path)
  return { sizes, rules: req.rules, links }
}

/** The bytes of a PNG that main writes (a doodle, or a picture pasted as a photo); rejects with what is wrong. */
function checkedPng(png: unknown, what: 'doodle' | 'photo'): Uint8Array {
  const article = what === 'doodle' ? 'A doodle' : 'A pasted photo'
  if (!(png instanceof Uint8Array)) throw new Error(`${article} is the bytes of a PNG.`)
  if (png.length > MAX_DOODLE) throw new Error(`${article} is at most 8 MB.`)
  if (png.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => png[i] !== b)) throw new Error(`${article} is a PNG; this is not one.`)
  return png
}

/** The extension `reference/photo-<n>` has: that of the file it is copied from, or `.png` for a pasted picture. */
const photoExt = (photo: CreateRequest['photos'][number]): string => ('path' in photo ? extname(photo.path).toLowerCase() : '.png')

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
  const board = await checked(req, deps, existing)
  const temp = join(deps.root, `.${name}.torno-new-${randomBytes(6).toString('hex')}`)
  let claimed = false
  await mkdir(temp)
  try {
    await deps.hooks?.afterTemp?.(temp)
    const references: string[] = []
    // What the board holds of the files written: each file with the note the person gave (`caption`).
    const made: Array<{ file: string; note: string }> = []
    const reference = (file: string, note: string): void => {
      references.push(line(file, note))
      made.push({ file, note })
    }
    await writeFileAtomic(join(temp, `${moduleName(name)}.py`), template)
    let n = 0
    for (const photo of req.photos) {
      const { bytes, ext } = 'path' in photo ? await readRegular(photo.path, MAX_PHOTO, 'photo') : { bytes: photo.png, ext: '.png' }
      const file = `reference/photo-${++n}${ext}`
      await writeFileAtomic(join(temp, file), bytes)
      reference(file, oneLine(photo.note, 'photo'))
    }
    n = 0
    for (const doodle of req.doodles) {
      const png = checkedPng(doodle?.png, 'doodle')
      const file = `reference/doodle-${++n}.png`
      await writeFileAtomic(join(temp, file), png)
      const note = oneLine(doodle.note, 'doodle')
      const over = doodle.over !== undefined ? `drawn over reference/photo-${doodle.over + 1}${photoExt(req.photos[doodle.over])}` : doodle.onPhoto ? 'drawn over a photo' : ''
      reference(file, over === '' ? note : note === '' ? over : `${note} (${over})`)
    }
    const stepNames = referenceFiles(req.steps.map((step) => step.path), STEP_FORMATS)
    for (const [i, step] of req.steps.entries()) {
      // Copied as it is, under its own name: the model reads it by that name. A STEP file is plain text, within its cap.
      const { bytes } = await readRegular(step.path, MAX_STEP, 'bought part', STEP_FORMATS)
      await writeFileAtomic(join(temp, stepNames[i]), bytes)
      reference(stepNames[i], oneLine(step.note, 'bought part'))
    }
    const pdfNames = referenceFiles(req.pdfs.map((pdf) => pdf.path), PDF_FORMATS)
    for (const [i, pdf] of req.pdfs.entries()) {
      // Copied as it is, under its own name, once it is read whole: a PDF that is no PDF is not kept.
      const { bytes } = await readRegular(pdf.path, MAX_PDF, 'PDF', PDF_FORMATS)
      if (!isPdf(bytes)) throw new Error(`${pdf.path} is not a PDF: it does not start with ${PDF_SIGNATURE}.`)
      await writeFileAtomic(join(temp, pdfNames[i]), bytes)
      reference(pdfNames[i], oneLine(pdf.note, 'PDF'))
    }
    for (const scan of req.scans) references.push(line(`scan ${homeRelative(scan.path)}`, oneLine(scan.note, 'scan')))
    for (const other of req.objects) references.push(line(`../${other.id}/`, oneLine(other.note, 'project')))
    const brief = [`# ${name}`, '', req.description.trim(), ...(references.length ? ['', '## References', '', ...references] : []), ''].join('\n')
    await writeFileAtomic(join(temp, 'brief.md'), brief)
    // The board, whole in the hidden folder like the rest: the brief and the references are cards of main's own, as the
    // first open would make them. Nothing else of `.torno/` is written; its `.gitignore` lines are the store's, when it
    // first writes what they are for.
    await deps.hooks?.beforeBoard?.(temp)
    await writeFileAtomic(join(temp, FOLDER, 'board', 'board.json'), textOf(startBoard({ description: req.description, references: made, sizes: board.sizes, rules: board.rules, links: board.links })))

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
