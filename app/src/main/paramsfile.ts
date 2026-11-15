import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureIgnored } from './ignored'
import { FOLDER, writeOwn } from './own'
import { said } from '../shared/params'
import type { ParamValue, Scene } from '../shared/scene'

// `<object>/.torno/params.json`: the values the person tries in place of the model's defaults. Main is the only
// writer, one change at a time per object, atomically. The model file is never written, and the file always wins:
// an override is dropped when the file's default of its field is not what it was when the override was made.

const NAME = 'params.json'
const MAX_FIELDS = 200
const MAX_TEXT = 200

/** An override: the value to build with, and the default the file had when it was made (what it is held against). */
export interface Override {
  value: ParamValue
  default: unknown
}
export type Overrides = Record<string, Override>
type Note = { name: string; reason: string }

/** The overrides of each folder as main last read or wrote them. */
const known = new Map<string, Overrides>()
/** By folder, what was let go of since the person last said anything of that field: shown on its row, told to the agent. */
const notes = new Map<string, Note[]>()
/** The last write of each folder: one change at a time. */
const writing = new Map<string, Promise<void>>()

const isValue = (v: unknown): v is ParamValue => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || (typeof v === 'string' && v.length <= MAX_TEXT)
const isName = (name: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && name.length <= 100
const same = (a: unknown, b: unknown): boolean => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)))

/** What a file may hold, whatever it was given: a field name to `{ value, default }` of a value an override can be. */
function clean(raw: unknown): Overrides {
  const kept: Overrides = {}
  const given = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).overrides : undefined
  if (typeof given !== 'object' || given === null || Array.isArray(given)) return kept
  for (const [name, one] of Object.entries(given)) {
    if (Object.keys(kept).length >= MAX_FIELDS) break
    if (!isName(name) || typeof one !== 'object' || one === null) continue
    const { value, default: file } = one as Record<string, unknown>
    if (isValue(value)) kept[name] = { value, default: file }
  }
  return kept
}

/** The overrides of the object in `dir`, read from the disk the first time (a missing or broken file holds none). Sync: a build asks for them as it starts. */
function load(dir: string): Overrides {
  const have = known.get(dir)
  if (have) return have
  let overrides: Overrides = {}
  try {
    overrides = clean(JSON.parse(readFileSync(join(dir, FOLDER, NAME), 'utf8')))
  } catch {
    // none, or not what this version writes: none
  }
  known.set(dir, overrides)
  return overrides
}

/** The values the next build of this object carries: field name to value. */
export function overrideValues(dir: string): Record<string, ParamValue> {
  return Object.fromEntries(Object.entries(load(dir)).map(([name, one]) => [name, one.value]))
}

/** The overrides the object holds, and why others went: what the window shows. */
export function overridesOf(dir: string): { overrides: Record<string, ParamValue>; dropped: Note[] } {
  return { overrides: overrideValues(dir), dropped: [...(notes.get(dir) ?? [])] }
}

function save(dir: string, overrides: Overrides): Promise<void> {
  const write = (writing.get(dir) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await writeOwn(dir, NAME, `${JSON.stringify({ overrides }, null, 2)}\n`)
      await ensureIgnored(dir, [NAME])
    })
  writing.set(dir, write)
  return write
}

/** Make a change to a folder's overrides, whole or not at all: the memory goes back when the write fails. */
async function change(dir: string, apply: (current: Overrides) => Overrides | null): Promise<void> {
  const before = load(dir)
  const after = apply(before)
  if (after === null) return
  known.set(dir, after)
  try {
    await save(dir, after)
  } catch (e) {
    known.set(dir, before)
    throw e
  }
}

/** The person tries `value` for `name`; `fileDefault` is the default the model's file has now. Rejects a value that is no value. */
export async function setOverride(dir: string, name: string, value: unknown, fileDefault: unknown): Promise<void> {
  if (!isName(name)) throw new Error(`${JSON.stringify(name)} is not the name of a field`)
  if (!isValue(value)) throw new Error(`the value of ${name} must be a number, a bool or a short text`)
  notes.set(dir, (notes.get(dir) ?? []).filter((n) => n.name !== name))
  await change(dir, (current) => {
    if (current[name] && same(current[name].value, value) && same(current[name].default, fileDefault)) return null
    return { ...current, [name]: { value, default: fileDefault } }
  })
}

/** Whether two values of a field are the same, as a number that went through JSON and a build is. */
export const sameValue = same

/**
 * The person's tries are put back as a Go back finds they were for an earlier build: these and no others, in one write.
 * A value that is no value, or a name that is no field's, is left out. Whoever asks says which defaults they were made against.
 */
export async function replaceOverrides(dir: string, wanted: Overrides): Promise<void> {
  const kept = clean({ overrides: wanted })
  notes.set(dir, [])
  await change(dir, (current) => {
    const unchanged = Object.keys(current).length === Object.keys(kept).length && Object.entries(kept).every(([name, one]) => current[name] && sameValue(current[name].value, one.value) && sameValue(current[name].default, one.default))
    return unchanged ? null : kept
  })
}

/** Back to the file's value: one field's override, or all of them. */
export async function resetOverrides(dir: string, name?: string): Promise<void> {
  notes.set(dir, name === undefined ? [] : (notes.get(dir) ?? []).filter((n) => n.name !== name))
  await change(dir, (current) => {
    if (name === undefined) return Object.keys(current).length === 0 ? null : {}
    if (!(name in current)) return null
    const { [name]: _gone, ...rest } = current
    return rest
  })
}

/**
 * Holds the overrides against a build that succeeded, and lets go of those that cannot stand: the model no
 * longer offers the field, the kernel refused the value, or the file's default is not what it was (the file
 * wins). One equal to the default is dropped with no word: the build is the file's. Sets `scene.overrides` to what
 * the build was made with and what is noted as let go of, and says whether the build is of a value that has been
 * let go of, so that it is to be made again.
 */
export async function reconcile(dir: string, scene: Scene): Promise<{ stale: boolean }> {
  const params = scene.params
  const kernelDropped = new Map((scene.overrides?.dropped ?? []).map((d) => [d.name, d.reason]))
  const gone: Array<Note & { quiet: boolean }> = []
  if (params) {
    for (const [name, one] of Object.entries(load(dir))) {
      const field = params.find((p) => p.name === name)
      if (!field || !field.editable) gone.push({ name, reason: `the model no longer offers ${name}`, quiet: false })
      else if (kernelDropped.has(name)) gone.push({ name, reason: kernelDropped.get(name) ?? '', quiet: false })
      else if (!same(field.default, one.default)) gone.push({ name, reason: `the file's default is now ${said(field.default)}, not ${said(one.default)}; the file wins`, quiet: false })
      else if (same(field.default, one.value)) gone.push({ name, reason: '', quiet: true })
    }
  }
  if (gone.length > 0) {
    const names = new Set(gone.map((g) => g.name))
    const told = gone.filter((g) => !g.quiet).map(({ name, reason }) => ({ name, reason }))
    notes.set(dir, [...(notes.get(dir) ?? []).filter((n) => !names.has(n.name)), ...told])
    await change(dir, (current) => Object.fromEntries(Object.entries(current).filter(([name]) => !names.has(name))))
  }
  scene.overrides = { applied: scene.overrides?.applied ?? {}, dropped: [...(notes.get(dir) ?? [])] }
  return { stale: gone.some((g) => !g.quiet) }
}

/** Folders mean nothing once their workspace is closed. */
export function forgetParamFiles(): void {
  known.clear()
  notes.clear()
  writing.clear()
}
