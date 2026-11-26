import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSize } from '../../shared/params'
import { isPartId, MOST_MEASURED, SHELF_DIR, type ShelfChecked, type ShelfPart } from '../../shared/shelf'
import { ownTorno, writeOwn } from '../own'

// "I measured it" (#352): the one file of the shelf torno writes, `common/parts/<id>/.torno/checked.json`, `{ <size>: { value, date } }`. The part
// folder is treated as a project's folder for `.torno/`: the write goes through `ownTorno` and `writeOwn` (a link or a file in `.torno`'s place is
// refused with a plain reason). The file travels with the part, like `marks.json` does with a project. Nothing else of the shelf is written here.

/** What `recordMeasured` needs of the shelf: the open workspace, the parts as the store has them, and the way to tell it a check was written. */
export interface MeasuredShelf {
  workspaceRoot(): string | null
  list(): ShelfPart[]
  checkedChanged(): Promise<void>
}

/** The date on the wall clock, `YYYY-MM-DD` (local time, not UTC: the day the person measured it). */
export function localDay(now: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

/** The writes to one file, in turn: a measurement reads the file and writes it whole, so two at once must not read the same one. */
const chain = new Map<string, Promise<unknown>>()

/** Reads the object `checked.json` is: `{}` for none, the object whole (entries torno does not know stay as they are), a plain reason for a file that is something else. */
async function existing(path: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`${path} could not be read: ${(e as Error).message}. torno wrote nothing.`)
  }
  try {
    const data: unknown = JSON.parse(text)
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
  } catch {
    // Said below.
  }
  throw new Error(`${path} is not a checked.json torno can read, so it was left as it is. Fix or remove it and measure again.`)
}

/** A folder of the way to the part that is a link is refused: the write would land wherever the link leads. */
async function realFolders(root: string, id: string): Promise<void> {
  let path = root
  for (const step of [...SHELF_DIR.split('/'), id]) {
    path = join(path, step)
    const what = await lstat(path).catch(() => null)
    if (what === null) throw new Error(`${path} is not there.`)
    if (what.isSymbolicLink()) throw new Error(`${path} is a link, not a folder of the shelf: torno writes nothing through it. Take the link away.`)
    if (!what.isDirectory()) throw new Error(`${path} is not a folder.`)
  }
}

/**
 * The person measured a size of a part on the real part: writes its value and today's date into the part's `.torno/checked.json`, merged with what
 * is there, and tells the store. Main checks all of it, never trusting the window: the id is a part id and a part of the shelf, the name one of its
 * sizes (a number's field, not a text or a flag), the value a number above 0 and under 10,000. Rejects with a plain reason; nothing is written then.
 */
export async function recordMeasured(shelf: MeasuredShelf, id: string, name: string, value: number, now: Date = new Date()): Promise<ShelfChecked> {
  const root = shelf.workspaceRoot()
  if (root === null) throw new Error('There is no workspace open.')
  if (typeof id !== 'string' || !isPartId(id)) throw new Error(`"${String(id)}" is not a part of the shelf: a part's name is a lower-case identifier.`)
  const part = shelf.list().find((p) => p.id === id)
  if (!part) throw new Error(`${id} is not on the shelf.`)
  if (typeof name !== 'string' || name === '' || !part.params.some((p) => p.name === name && isSize(p))) throw new Error(`"${String(name)}" is not a size of ${id}.`)
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= MOST_MEASURED) throw new Error('A measured size is a number of more than 0 and less than 10,000.')
  const entry: ShelfChecked = { value, date: localDay(now) }
  const dir = join(root, SHELF_DIR, id)
  const done = (chain.get(dir) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await realFolders(root, id)
      const folder = await ownTorno(dir)
      const file = join(folder, 'checked.json')
      const kept = await existing(file)
      const next = Object.create(null) as Record<string, unknown>
      Object.assign(next, kept)
      next[name] = entry
      await writeOwn(dir, 'checked.json', `${JSON.stringify(next, null, 2)}\n`)
    })
  chain.set(dir, done)
  try {
    await done
  } finally {
    if (chain.get(dir) === done) chain.delete(dir)
  }
  await shelf.checkedChanged()
  return entry
}
