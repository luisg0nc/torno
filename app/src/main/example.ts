import { randomBytes } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

// The example the first screen offers: a project made to be shown (`app/resources/example`, which a packaged app
// carries in its resources too): a model with its brief, two marks, a dimension that fails and two saved views.
// It is never opened in place and never written to: what is opened is a copy in a temporary folder, which is
// removed when torno quits, once nothing is being written there any more. A copy that a crash left is removed at
// the next start. Whatever is removed is a folder that torno's own marker file names as such a copy: never a
// folder because of its name or its place.

/** The projects of the example, as folders of it. */
export const EXAMPLE_OBJECTS = ['enclosure'] as const

/**
 * Where the example is copied from, or null where there is none: `resources/example` beside `app/` when torno is run
 * from the repository, the `example` of its resources when packaged (`extraResources` of electron-builder.yml).
 * Null when one of its projects is missing. `resources` is `process.resourcesPath`.
 */
export function exampleSource(appPath: string, packaged: boolean, resources: string = process.resourcesPath): string | null {
  const source = packaged ? join(resources, 'example') : join(appPath, 'resources', 'example')
  return EXAMPLE_OBJECTS.every((name) => existsSync(join(source, name))) ? source : null
}

/** The file at the top of a copy that says it is one, and which torno made it. */
export const EXAMPLE_MARKER = '.torno-example'
const PREFIX = 'torno-example-'

/** The torno a folder's marker names, when the folder is a real one and its marker says it is a copy of the example; null otherwise. */
async function madeBy(folder: string): Promise<{ pid: number | null } | null> {
  try {
    if (!(await lstat(folder)).isDirectory()) return null
    if (!(await lstat(join(folder, EXAMPLE_MARKER))).isFile()) return null
    const said = JSON.parse(await readFile(join(folder, EXAMPLE_MARKER), 'utf8')) as { torno?: unknown; pid?: unknown } | null
    if (said?.torno !== 'example') return null
    return { pid: typeof said.pid === 'number' && Number.isSafeInteger(said.pid) && said.pid > 1 ? said.pid : null }
  } catch {
    return null
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // There, and someone else's: not ours to say it is gone.
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Removes a copy of the example: a folder its marker names, and nothing else, whatever the path. */
export async function removeExample(folder: string): Promise<void> {
  if ((await madeBy(folder)) !== null) await rm(folder, { recursive: true, force: true })
}

/**
 * Removes the copies under `tmp` that a torno which is gone left behind (a crash, a kill): each a real folder
 * named as a copy is, with torno's marker in it, whose torno no longer runs. Answers with those it removed.
 */
export async function sweepExamples(tmp: string): Promise<string[]> {
  const names = await readdir(tmp).catch(() => [] as string[])
  const swept: string[] = []
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue
    const folder = join(tmp, name)
    const by = await madeBy(folder)
    if (by === null || (by.pid !== null && running(by.pid))) continue
    await rm(folder, { recursive: true, force: true }).then(() => swept.push(folder), () => {})
  }
  return swept
}

/** What of a project's `.torno` the example is shown with. */
const SHOWN = ['marks.json', 'scene.json']

/**
 * Whether a file or folder of a project of the example is copied: what the example is made of (the model, the brief, and
 * the marks and views it is shown with), without what Python or torno left in the source. A dotted name is left out.
 */
export function copiedOfExample(project: string, from: string): boolean {
  const parts = relative(project, from).split(sep).filter((part) => part !== '')
  if (parts.length === 0) return true
  if (parts[0] === '.torno') return parts.length === 1 || (parts.length === 2 && SHOWN.includes(parts[1]))
  return parts.every((part) => part !== '__pycache__' && !part.startsWith('.'))
}

/** Copies the projects of the example into the folder `into`, which is there already. */
async function copyProjects(source: string, into: string): Promise<void> {
  for (const name of EXAMPLE_OBJECTS) {
    const project = join(source, name)
    await cp(project, join(into, name), { recursive: true, filter: (from) => copiedOfExample(project, from) })
  }
}

/** A copy of the example in a new folder under `tmp`, without what Python or torno left in the source. Answers with the copy's path. */
export async function copyExample(source: string, tmp: string): Promise<string> {
  const into = await mkdtemp(join(tmp, PREFIX))
  await writeFile(join(into, EXAMPLE_MARKER), `${JSON.stringify({ torno: 'example', pid: process.pid, at: new Date().toISOString() })}\n`)
  await copyProjects(source, into)
  return into
}

// Keeping the example (`keepExample`): "Keep this as a folder" in the window. It is a write in the person's files outside
// `.torno/`, an exception of the root CLAUDE.md (.claude/rules/workspace-writes.md) beside an object's creation and an export: ONE new folder, at the path the
// person chose in the save dialog (never from the window or from an agent), made the way `objects/create.ts` makes one:
// all of it is written in a hidden `.<name>.torno-new-<random>` folder beside it, which takes the name as the last step,
// so that the folder is whole or not there. It never writes into or replaces a folder that exists (compared without
// regard to case) and never follows a link: only plain folders and files are copied, each read through a handle opened
// without following a link, and a link or anything else is left out.

/** The most a kept copy may hold, in bytes, and in files and folders; more is refused before anything is written. */
export const MOST_KEPT_BYTES = 256 * 1024 * 1024
export const MOST_KEPT_ENTRIES = 5000
const MOST_KEPT_DEPTH = 12
/** What of a copy is not kept: torno's marker, what Python left, and what is only of the run that made it (the conversation to resume, the state file). */
const NOT_KEPT = /(^|\/)(__pycache__|\.torno-example)(\/|$)|(^|\/)\.torno\/(session\.json|state\.md)$/

interface Planned {
  dirs: string[]
  files: Array<{ path: string; size: number }>
}

/** What of the copy at `copy` is kept: its folders and plain files, relative to it. Throws when it is more than may be kept. */
async function planOf(copy: string): Promise<Planned> {
  const plan: Planned = { dirs: [], files: [] }
  let bytes = 0
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > MOST_KEPT_DEPTH) throw new Error('The example has folders nested deeper than torno keeps.')
    for (const entry of await readdir(join(copy, rel), { withFileTypes: true })) {
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (NOT_KEPT.test(path)) continue
      // A link is told by `lstat`; neither it nor anything else that is not a plain file or folder is kept.
      const kind = await lstat(join(copy, path))
      if (kind.isDirectory()) {
        plan.dirs.push(path)
        await walk(path, depth + 1)
      } else if (kind.isFile()) {
        bytes += kind.size
        plan.files.push({ path, size: kind.size })
      }
      if (plan.dirs.length + plan.files.length > MOST_KEPT_ENTRIES) throw new Error(`The example holds more than ${MOST_KEPT_ENTRIES} files and folders: torno keeps no more.`)
      if (bytes > MOST_KEPT_BYTES) throw new Error(`The example holds more than ${MOST_KEPT_BYTES / (1024 * 1024)} MB: torno keeps no more.`)
    }
  }
  await walk('', 0)
  return plan
}

/** The bytes of a plain file, read through a handle opened without following a link and looked at once open. */
async function readPlain(path: string, size: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => {
    throw new Error(`${path} cannot be opened as a plain file.`)
  })
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size !== size) throw new Error(`${path} changed while it was copied.`)
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

/**
 * Keeps the copy of the example at `copy` as a new folder at `to`, whole or not at all. Rejects with a plain reason when
 * it could not, and then nothing of it is left. `copy` must be a copy of the example that torno made (its marker names
 * it); `to` is an absolute path whose folder is there and whose name no entry of it has, in any case.
 * `hooks.beforeRename` is for tests: called with the hidden folder when everything is written.
 */
export async function keepExample(copy: string, to: string, hooks?: { beforeRename?: (temp: string) => void | Promise<void> }): Promise<void> {
  if ((await madeBy(copy)) === null) throw new Error('Only the copy of the example that torno made can be kept.')
  if (typeof to !== 'string' || !isAbsolute(to)) throw new Error('The folder to keep it in is not a path.')
  const name = basename(to)
  const parent = dirname(to)
  if (name === '' || name === '.' || name === '..' || /[\p{Cc}/\\]/u.test(name) || to !== join(parent, name)) throw new Error('That is not a name for a folder.')
  if (!(await stat(parent).catch(() => null))?.isDirectory()) throw new Error(`${parent} is not a folder.`)
  if ((await readdir(parent)).some((entry) => entry.toLowerCase() === name.toLowerCase())) throw new Error(`A folder \`${name}\` is there already.`)
  const plan = await planOf(copy)
  const temp = join(parent, `.${name}.torno-new-${randomBytes(6).toString('hex')}`)
  let claimed = false
  await mkdir(temp)
  try {
    for (const dir of plan.dirs) await mkdir(join(temp, dir))
    for (const file of plan.files) await writeFile(join(temp, file.path), await readPlain(join(copy, file.path), file.size), { flag: 'wx' })
    await hooks?.beforeRename?.(temp)
    // The name is taken by making it, which fails if it is there; then the finished folder takes the place of that
    // empty one, which refuses to be replaced if anyone put anything in it meanwhile. The last step.
    await mkdir(to).catch((e: NodeJS.ErrnoException) => {
      throw e.code === 'EEXIST' ? new Error(`A folder \`${name}\` is there already.`) : e
    })
    claimed = true
    await rename(temp, to).catch((e: NodeJS.ErrnoException) => {
      throw e.code === 'ENOTEMPTY' || e.code === 'EEXIST' ? new Error(`A folder \`${name}\` is there already.`) : e
    })
  } catch (e) {
    if (claimed) await rmdir(to).catch(() => {})
    await rm(temp, { recursive: true, force: true }).catch(() => {})
    throw e
  }
}
