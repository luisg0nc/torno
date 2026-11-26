import type { Scene } from './scene'

// Renaming a part by hand (#359): the one rule of what a new name may be, for the window and main, and the one rule of
// how torno's own files that name the part follow it (marks, named sets, tracings, scans), each written by its own store.

/** The most characters a part's new name has. */
export const PART_NAME_MAX = 60

/** What the person asks: rename the part `from` of the project's model to `to`. */
export interface RenameAsk {
  from: string
  to: string
}

/** What came of it: the files written and the new name, or why not, in a sentence. */
export type RenameResult = { done: true; to: string; files: string[] } | { done: false; refused: string }

/** The names a part's new name may not take in this build: every part's and reference's, of every layout, and every group's. */
export function namesTaken(scene: Pick<Scene, 'parts' | 'groups'>): Set<string> {
  return new Set([...scene.parts.map((p) => p.name), ...(scene.groups ?? []).map((g) => g.name)])
}

/**
 * Why `to` cannot be the new name of the part `from`, in a sentence; null when it can. `taken` is `namesTaken` of the build.
 * Trimmed first: what is kept is `to.trim()`.
 */
export function partNameRefusal(from: string, to: string, taken: ReadonlySet<string>): string | null {
  const name = to.trim()
  if (name === '') return 'A part needs a name.'
  if (name === from) return 'That is the name it has.'
  if (name.length > PART_NAME_MAX) return `A part's name is ${PART_NAME_MAX} characters at most.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return "A part's name is one line, with no tabs."
  if (name.includes('/')) return "A part's name has no /: it is what a ref like lid/F3 starts with."
  if (/^[#@]/.test(name) || name.includes(':')) return "A part's name does not start with # or @ and has no :, which refs use."
  if (/^M\d+$/.test(name)) return `${name} is the form of a mark's id; name it otherwise.`
  if (taken.has(name)) return `${name} is already the name of a part or a group.`
  return null
}

/** A ref with the part renamed: `lid` and `lid/F3` become `cover` and `cover/F3`, `assembly:lid/F3` `assembly:cover/F3`; any other is as it was. */
export function renamedRef(ref: string, from: string, to: string): string {
  if (ref === from) return to
  if (ref.startsWith(`${from}/`)) return `${to}${ref.slice(from.length)}`
  const colon = ref.indexOf(':')
  if (colon > 0) {
    const rest = ref.slice(colon + 1)
    const renamed = rest === from || rest.startsWith(`${from}/`) ? renamedRef(rest, from, to) : rest
    if (renamed !== rest) return `${ref.slice(0, colon + 1)}${renamed}`
  }
  return ref
}

/** Keys of torno's files whose strings are a part's name (`Anchor.part`, `Tracing.parts`, a note's `cuts`, a set's `{ part }`). */
const NAME_KEYS = new Set(['part', 'parts', 'cuts'])
/** Keys whose strings are refs that start with a part's name (`lid/F12`): an anchor's, a snap's, a set member's, what a stroke touches. */
const REF_KEYS = new Set(['ref', 'refs', 'edge', 'between', 'face', 'vertex', 'centre', 'touches'])
/** Keys whose object is keyed by part name (a scan's alignment `frame`). */
const BY_NAME_KEYS = new Set(['frame'])

/**
 * A copy of `value` (a mark, a set, a tracing, a scan, as their files hold them) with the part `from` renamed `to`
 * wherever it names it: by the keys above, never in what a person or Claude wrote (a comment, a label, a name), which
 * are under other keys. `count` is how many strings it changed.
 */
export function renamedIn<T>(value: T, from: string, to: string): { value: T; count: number } {
  let count = 0
  const strings = (v: unknown, as: (s: string) => string): unknown => {
    if (typeof v === 'string') {
      const now = as(v)
      if (now !== v) count++
      return now
    }
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? strings(x, as) : walk(x)))
    return walk(v)
  }
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v === null || typeof v !== 'object') return v
    const out: Record<string, unknown> = {}
    for (const [key, x] of Object.entries(v as Record<string, unknown>)) {
      if (NAME_KEYS.has(key)) out[key] = strings(x, (s) => (s === from ? to : s))
      else if (REF_KEYS.has(key)) out[key] = strings(x, (s) => renamedRef(s, from, to))
      else if (BY_NAME_KEYS.has(key) && x !== null && typeof x === 'object' && !Array.isArray(x) && from in x && !(to in x)) {
        out[key] = Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, y]) => [k === from ? to : k, y]))
        count++
      } else out[key] = walk(x)
    }
    return out
  }
  return { value: walk(value) as T, count }
}
