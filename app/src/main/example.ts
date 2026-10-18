import { existsSync } from 'node:fs'
import { cp, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

// The example the first screen offers: objects of the repository's own test workspace, which torno has
// beside it when it is run from the repository. It is never opened in place and never written to: what is
// opened is a copy in a temporary folder, which is removed when torno quits, once nothing is being written
// there any more. A copy that a crash left is removed at the next start. Whatever is removed is a folder that
// torno's own marker file names as such a copy: never a folder because of its name or its place.

/** The objects of the test workspace that build and show something. The others are there to fail. */
export const EXAMPLE_OBJECTS = ['bracket', 'gauge', 'hollow', 'measures'] as const

/**
 * Where the example is copied from, or null where there is none. Run from the repository it is the test workspace
 * beside `app/`; a packaged app carries the four objects in its resources (`example`, `extraResources` of
 * electron-builder.yml). Null when one of them is missing. `resources` is `process.resourcesPath`.
 */
export function exampleSource(appPath: string, packaged: boolean, resources: string = process.resourcesPath): string | null {
  const source = packaged ? join(resources, 'example') : join(appPath, '..', 'kernel', 'tests', 'fixtures', 'ws')
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

/** A copy of the example in a new folder under `tmp`, without what Python or torno left in the source. Answers with the copy's path. */
export async function copyExample(source: string, tmp: string): Promise<string> {
  const into = await mkdtemp(join(tmp, PREFIX))
  await writeFile(join(into, EXAMPLE_MARKER), `${JSON.stringify({ torno: 'example', pid: process.pid, at: new Date().toISOString() })}\n`)
  for (const name of EXAMPLE_OBJECTS) {
    await cp(join(source, name), join(into, name), {
      recursive: true,
      filter: (from) => from === join(source, name) || (basename(from) !== '__pycache__' && !basename(from).startsWith('.'))
    })
  }
  return into
}
