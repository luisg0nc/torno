import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { isPartId, MAX_SHELF_FILES, shelfFileCap, shelfFileKind, shelfFileName, type ShelfAddResult, type ShelfFileKind } from '../../shared/shelf'

// Adding a part by hand (#355): files dropped on the Shelf tab open a short form (a name, what it is, a few sizes with their sources), and
// "Ask Claude to put it on the shelf" puts a request in the message box, shown first. The files are copied into `common/parts/<id>/` by main
// when the person sends that message (`shelfPending`, below). Nothing is written by the form. The pure rules are here; `ui/shelf/AddPart.tsx` draws.

export const MOST_ADD_SIZES = 20
const MAX_WHAT = 200
const MAX_VALUE = 60

/** Where a size came from, as the person says it: the word in the form, and the word the request tells (a guess is `assumed`, the shelf's own). */
export const ADD_SOURCES = [
  { id: 'datasheet', label: 'datasheet', word: 'datasheet' },
  { id: 'listing', label: 'listing', word: 'listing' },
  { id: 'measured', label: 'measured', word: 'measured' },
  { id: 'guess', label: 'a guess', word: 'assumed' }
] as const
export type AddSource = (typeof ADD_SOURCES)[number]['id']

/** A file dropped on the tab: its place on the disk (the window never reads it; main copies it), the name it will have, its kind, and a picture to show for an image. */
export interface AddFile {
  path: string
  name: string
  kind: ShelfFileKind
  url: string | null
}

/** A row of sizes: what it is, the value as typed (`6.2`, `13 × 8`, `Ø 6.2`) and where it came from. */
export interface AddSize {
  uid: string
  what: string
  value: string
  source: AddSource
}

export interface AddForm {
  files: AddFile[]
  id: string
  /** The person edited the name: it is no longer made from the first file's. */
  named: boolean
  what: string
  sizes: AddSize[]
  /** What was left out of the drops, in plain lines. */
  said: string[]
  /** Why the last ask did not go. */
  problem: string | null
}

const MB = 1024 * 1024
const KINDS = 'a PDF, a picture (png, jpg, webp) or a STEP file'

/** What a drop comes to: the files taken (by the name they will have) and a plain line for each left out. */
export interface Dropped<F> {
  taken: Array<{ file: F; path: string; name: string; kind: ShelfFileKind }>
  said: string[]
}

/**
 * Files dropped on the Shelf tab, held to what main will take (`shelfFileKind`, `shelfFileCap`, `MAX_SHELF_FILES`, the one name in the folder
 * for each file): `already` are those the form has. A file with no path, of another kind, too big, the same as one given or called the same
 * as one, or beyond the eighth, is left out and said.
 */
export function takeDrop<F extends { name: string; size: number }>(files: ArrayLike<F>, pathOf: (file: F) => string, already: readonly AddFile[] = []): Dropped<F> {
  const taken: Dropped<F>['taken'] = []
  const said: string[] = []
  const names = new Set(already.map((f) => f.name.toLowerCase()))
  const paths = new Set(already.map((f) => f.path))
  let over = 0
  for (const file of Array.from(files)) {
    const kind = shelfFileKind(file.name)
    if (kind === null) {
      said.push(`${file.name} is not ${KINDS}.`)
      continue
    }
    if (file.size > shelfFileCap(kind)) {
      said.push(`${file.name} is over ${shelfFileCap(kind) / MB} MB.`)
      continue
    }
    const path = pathOf(file)
    if (!path) {
      said.push(`${file.name}: that file has no place on the disk.`)
      continue
    }
    if (paths.has(path)) {
      said.push(`${file.name} is there already.`)
      continue
    }
    const name = shelfFileName(path)
    if (names.has(name.toLowerCase())) {
      said.push(`Two files are called ${name}: only the first is taken.`)
      continue
    }
    if (already.length + taken.length >= MAX_SHELF_FILES) {
      over += 1
      continue
    }
    names.add(name.toLowerCase())
    paths.add(path)
    taken.push({ file, path, name, kind })
  }
  if (over > 0) said.push(`A part takes at most ${MAX_SHELF_FILES} files: ${over} left out.`)
  return { taken, said }
}

const KEYWORD_SAFE = (id: string): string => (isPartId(id) ? id : `${id}_part`)

/** A file's name made into a part's id: the name without its ending, lower case, letters and digits joined by `_`, not starting with a digit, at most 48 characters. '' when nothing is left. */
export function idFromName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '')
  let id = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (id === '') return ''
  if (/^[0-9]/.test(id)) id = `p_${id}`
  id = id.slice(0, 48).replace(/_+$/, '')
  return KEYWORD_SAFE(id).slice(0, 48)
}

/** Why a name cannot be a new part's folder, or null: an identifier (`isPartId`) that is not a part of the shelf already. */
export function idProblem(id: string, onShelf: readonly string[]): string | null {
  if (id === '') return 'Give the part a name.'
  if (!isPartId(id)) return 'A lower-case name of letters, digits and _, not starting with a digit.'
  if (onShelf.includes(id)) return `${id} is already on the shelf.`
  return null
}

/** A row nothing is typed in: it is left alone. */
export const sizeBlank = (size: Pick<AddSize, 'what' | 'value'>): boolean => size.what.trim() === '' && size.value.trim() === ''

/** Why a row is not whole (one of its two boxes is empty, or it is too long), or null: a blank row is not a problem, it is left out. */
export function sizeIssue(size: Pick<AddSize, 'what' | 'value'>): string | null {
  if (sizeBlank(size)) return null
  if (size.what.trim() === '') return 'Say what it measures.'
  if (size.value.trim() === '') return 'Give its value.'
  if (size.what.trim().length > MAX_WHAT || size.value.trim().length > MAX_VALUE) return 'That is too long.'
  return null
}

/** The rows that are sizes: those with something in them, as they will be told. */
export const sizesOf = (sizes: readonly AddSize[]): AddSize[] => sizes.filter((s) => !sizeBlank(s))

/** Whether the ask can go: a name that is a new part's, at least a file, and no half-filled row. */
export const canAsk = (form: Pick<AddForm, 'id' | 'files' | 'sizes'>, onShelf: readonly string[]): boolean =>
  form.files.length > 0 && idProblem(form.id, onShelf) === null && form.sizes.every((s) => sizeIssue(s) === null)

const one = (text: string): string => text.trim().replace(/\s+/g, ' ')

/**
 * The request put in the message box: what the part is, its sizes as the `torno-model` skill's question has them (`<value> <what> (<source>)`, a
 * guess said as `assumed`), and where its files will be. Claude carries the sizes into the question it asks before it writes the folder.
 */
export function addRequest(form: Pick<AddForm, 'id' | 'what' | 'sizes'> & { files: ReadonlyArray<Pick<AddFile, 'name'>> }): string {
  const what = one(form.what) === '' ? 'part' : one(form.what)
  const sizes = sizesOf(form.sizes).map((s) => `${one(s.value)} ${one(s.what)} (${ADD_SOURCES.find((a) => a.id === s.source)?.word ?? s.source})`)
  const files = form.files.map((f) => f.name).join(', ')
  return `Put the ${what} on the shelf as ${form.id}${sizes.length > 0 ? `: ${sizes.join(', ')}` : ''}. Its files are in common/parts/${form.id}/: ${files}. Model it as the torno-model skill says.`
}

// ---- the form, as the window holds it ----

let counter = 0
const newUid = (): string => `a${++counter}`
const blankSize = (): AddSize => ({ uid: newUid(), what: '', value: '', source: 'datasheet' })

export const shelfAddStore = createStore<{ form: AddForm | null }>(() => ({ form: null }))
export const useShelfAdd = <T,>(select: (s: { form: AddForm | null }) => T): T => useZustand(shelfAddStore, select)

const revoke = (files: readonly AddFile[]): void => {
  for (const f of files) {
    if (f.url === null) continue
    try {
      URL.revokeObjectURL(f.url)
    } catch {
      // Not a URL made here.
    }
  }
}

const change = (patch: (form: AddForm) => AddForm): void => {
  const { form } = shelfAddStore.getState()
  if (form) shelfAddStore.setState({ form: patch(form) })
}

export const shelfAdd = {
  /** Files were dropped: the form opens with them, or takes them into the one that is open. `said` is what was left out. */
  drop(files: AddFile[], said: string[]): void {
    const { form } = shelfAddStore.getState()
    if (!form) {
      if (files.length === 0) return
      shelfAddStore.setState({ form: { files, id: idFromName(files[0].name), named: false, what: '', sizes: [blankSize()], said, problem: null } })
      return
    }
    change((f) => {
      const all = [...f.files, ...files]
      return { ...f, files: all, id: f.named ? f.id : idFromName(all[0].name), said, problem: null }
    })
  },
  /** Said of a drop that took nothing, with no form to put it in: shown in the tab until the next drop. */
  said(lines: string[]): void {
    const { form } = shelfAddStore.getState()
    if (form) change((f) => ({ ...f, said: lines }))
    else shelfDropSaid.setState({ lines })
  },
  setId: (id: string): void => change((f) => ({ ...f, id, named: true, problem: null })),
  setWhat: (what: string): void => change((f) => ({ ...f, what, problem: null })),
  setSize: (uid: string, patch: Partial<Omit<AddSize, 'uid'>>): void => change((f) => ({ ...f, problem: null, sizes: f.sizes.map((s) => (s.uid === uid ? { ...s, ...patch } : s)) })),
  addSize: (): boolean => {
    const { form } = shelfAddStore.getState()
    if (!form || form.sizes.length >= MOST_ADD_SIZES) return false
    change((f) => ({ ...f, sizes: [...f.sizes, blankSize()] }))
    return true
  },
  removeSize: (uid: string): void => change((f) => ({ ...f, sizes: f.sizes.length > 1 ? f.sizes.filter((s) => s.uid !== uid) : f.sizes.map((s) => ({ ...s, what: '', value: '' })) })),
  removeFile(path: string): void {
    const { form } = shelfAddStore.getState()
    if (!form) return
    const gone = form.files.filter((f) => f.path === path)
    revoke(gone)
    const files = form.files.filter((f) => f.path !== path)
    if (files.length === 0) return shelfAdd.close()
    change((f) => ({ ...f, files, id: f.named ? f.id : idFromName(files[0].name) }))
  },
  setProblem: (problem: string | null): void => change((f) => ({ ...f, problem })),
  /** Back, or Esc, or the ask went: the form is gone and nothing is written. */
  close(): void {
    const { form } = shelfAddStore.getState()
    if (form) revoke(form.files)
    shelfAddStore.setState({ form: null })
    shelfDropSaid.setState({ lines: [] })
  },
  /** A workspace was left: the form and the request waiting for a send go. */
  clear(): void {
    shelfAdd.close()
    shelfPending.clear()
  }
}

/** What a drop that opened no form said: shown in the Shelf tab's foot until the next drop or the next time a form closes. */
export const shelfDropSaid = createStore<{ lines: string[] }>(() => ({ lines: [] }))
export const useShelfDropSaid = <T,>(select: (s: { lines: string[] }) => T): T => useZustand(shelfDropSaid, select)

// ---- the request that waits for its send ----

/** The request put in the box, and the files that go with it, until the person sends a message that still names `common/parts/<id>/`. */
export interface Pending {
  id: string
  paths: string[]
  text: string
}

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** What the plain line says of what the copy left out: each file's reason, and what to do. */
export function refusedLine(answer: ShelfAddResult, id: string, terminal = false): string {
  const why = answer.refused.map((r) => r.why).join(' ')
  return terminal ? `${why} Nothing was put at the prompt.` : `${why} Nothing was sent. Send again to copy what is left, or take common/parts/${id}/ out of the message to send it without the files.`
}

let pending: Pending | null = null
let copying: Promise<string | null> | null = null

/** Asks main to copy `paths` into the part's folder; the plain reason it did not (all of it, or some files), or null. */
async function copy(id: string, paths: string[], ask: (id: string, paths: string[]) => Promise<ShelfAddResult>, terminal = false): Promise<{ problem: string | null; left: string[] }> {
  let answer: ShelfAddResult
  try {
    answer = await ask(id, paths)
  } catch (e) {
    return { problem: `${reason(e)} ${terminal ? 'Nothing was put at the prompt.' : 'Nothing was sent.'}`, left: paths }
  }
  if (answer.refused.length === 0) return { problem: null, left: [] }
  const names = new Set(answer.refused.map((r) => r.name))
  return { problem: refusedLine(answer, id, terminal), left: paths.filter((p) => names.has(shelfFileName(p))) }
}

export const shelfPending = {
  get: (): Pending | null => pending,
  set(next: Pending): void {
    pending = next
    copying = null
  },
  clear(): void {
    pending = null
    copying = null
  },
  /** Whether this message is the request that waits: it still names the part's folder. */
  holds: (text: string): boolean => pending !== null && text.includes(`common/parts/${pending.id}/`),
  /**
   * Before a message is sent from the box: with a request waiting and the message still naming its folder, the files are copied first (main checks them), and
   * the answer is null when it may go, or the plain reason it may not (a refusal, which keeps what was left for a second send). A message that no longer
   * names the folder lets the request go: the person changed their mind. Two sends at once copy once.
   */
  beforeSend(text: string, ask: (id: string, paths: string[]) => Promise<ShelfAddResult> = (id, paths) => window.torno.shelf.addFiles(id, paths)): Promise<string | null> {
    if (pending === null) return Promise.resolve(null)
    if (!shelfPending.holds(text)) {
      pending = null
      return Promise.resolve(null)
    }
    if (copying !== null) return copying
    const waiting = pending
    const run = copy(waiting.id, waiting.paths, ask).then(({ problem, left }) => {
      if (pending === waiting) pending = problem === null ? null : { ...waiting, paths: left }
      return problem
    })
    copying = run
    void run.finally(() => {
      if (copying === run) copying = null
    })
    return run
  },
  /** The copy, now, for a terminal session: there is no box to send from. The same answer as `beforeSend`. */
  now: (id: string, paths: string[], ask: (id: string, paths: string[]) => Promise<ShelfAddResult> = (i, p) => window.torno.shelf.addFiles(i, p)): Promise<string | null> => copy(id, paths, ask, true).then((r) => r.problem)
}
