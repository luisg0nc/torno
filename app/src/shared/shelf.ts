import { number } from './format'
import { MAX_PDF_BYTES, MAX_PHOTO_BYTES, MAX_STEP_BYTES, PDF_FORMATS, referenceFiles, STEP_FORMATS } from './objectName'
import { sourceCount } from './params'
import type { Param } from './scene'

// The parts shelf (#345): `common/parts/<id>/part.py` of the workspace, one folder a bought part. The shapes both sides use,
// and the few rules that are one rule: what a part's id may be, how its hole is said, how many of its sizes are guessed.

/** A box in the part's own frame, millimetres: the kernel's. */
export interface ShelfBox {
  min: [number, number, number]
  max: [number, number, number]
}

/** One closed outline of a section, in millimetres: the points of its polyline, and whether it is a hole in what it is drawn with. */
export interface Outline {
  points: Array<[number, number]>
  hole?: boolean
}

/** The part as bought: its box, and its section by the plane through the centre, seen from the side (x across, z up). */
export interface ShelfBody {
  bbox: ShelfBox
  side: Outline[]
}

/** What the part cuts of a panel: its section from the side, from above (`z = -0.5`, inside the panel), and the size of that hole. */
export interface ShelfCutout {
  side: Outline[]
  plan: Outline[]
  /** `{ d }` when the plan is one circle, else the plan's box. */
  size: { d: number } | { w: number; h: number }
}

/** What it keeps clear: the room around and behind the part. */
export interface ShelfKeepout {
  bbox: ShelfBox
  side: Outline[]
  plan: Outline[]
}

/** The day a size was checked on the part (`YYYY-MM-DD`), and the value then (torno's own `.torno/checked.json`). */
export interface ShelfChecked {
  value: number
  date: string
}

/** One part of the shelf, as main serves it: the kernel's answer for `common/parts/<id>/part.py` with the checks merged in. */
export interface ShelfPart {
  /** The folder's name, a Python identifier (`isPartId`). */
  id: string
  /** `common/parts/<id>/part.py`, from the workspace. */
  file: string
  /** The first line of the module's docstring. */
  name: string
  /** The rest of it: what the part is. */
  what: string
  /** The fields of its `Params` as the kernel reads them, with their defaults. */
  params: Param[]
  /** The sizes the person checked, by the field's name. */
  checked: Record<string, ShelfChecked>
  /** The other files of its folder (datasheets, photos), by name. */
  files: string[]
  body?: ShelfBody
  cutout?: ShelfCutout
  keepout?: ShelfKeepout
  /** Why the part could not be read or drawn; the rest of it is then what could be. */
  error?: string
}

/** What the kernel's `shelf` op says of one part: a `ShelfPart` without what main adds, its `file` and the `checked` sizes. */
export type KernelShelfPart = Omit<ShelfPart, 'file' | 'checked'>

/** The folder of the shelf, from the workspace. */
export const SHELF_DIR = 'common/parts'

/** A size the person measured on a part is more than 0 and less than this, in millimetres: the window and main hold to the one number. */
export const MOST_MEASURED = 10_000

/** The most parts the shelf lists. */
export const MOST_PARTS = 60

const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
])

/**
 * Whether a string can be a part's folder: a lower-case Python identifier of 48 characters at most, not a keyword. A project
 * imports a part as `from common.parts.ec11.part import ...`, which a name with a `-` or a keyword cannot be.
 */
export const isPartId = (id: string): boolean => typeof id === 'string' && /^[a-z_][a-z0-9_]{0,47}$/.test(id) && !KEYWORDS.has(id)

/** What the part cuts, in a few words: `hole Ø7` for a round one, `window 33.4 × 18.4` for the rest; '' for a part with no cutout. */
export function holeText(part: Pick<ShelfPart, 'cutout'>): string {
  const size = part.cutout?.size
  if (!size) return ''
  return 'd' in size ? `hole Ø${number(size.d)}` : `window ${number(size.w)} × ${number(size.h)}`
}

/** How many of the part's sizes say `assumed` in their comment's source. */
export const assumedCount = (part: Pick<ShelfPart, 'params'>): number => sourceCount(part.params).assumed.length

/**
 * The part and the file a path names when it is inside a shelf part's folder (`common/parts/<id>/<file>`), as the path of a tool call is
 * given (relative to the workspace or absolute: the folder is found by its segments, not by the workspace's root); null for any other path,
 * a folder with no file in it, a name that is no part id and a path that climbs with `..`.
 */
export function shelfFileOf(path: unknown): { id: string; file: string } | null {
  if (typeof path !== 'string' || path === '') return null
  const parts = path.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.')
  if (parts.includes('..')) return null
  const at = parts.findLastIndex((segment, n) => segment === 'common' && parts[n + 1] === 'parts')
  if (at < 0) return null
  const id = parts[at + 2]
  const file = parts.slice(at + 3)
  return id !== undefined && isPartId(id) && file.length > 0 ? { id, file: file.join('/') } : null
}

// Adding a part by hand (#355): the files a person drops on the Shelf tab are copied into `common/parts/<id>/` by main (`main/shelf/add.ts`).
// What they may be, how many and how big, and what they are called there, is one rule for the window and main.

/** The kinds of file the shelf takes: a datasheet or drawing (PDF), a picture, a vendor's STEP. */
export type ShelfFileKind = 'pdf' | 'image' | 'step'

const IMAGE_FORMATS = ['.png', '.jpg', '.jpeg', '.webp'] as const

/** Every ending the shelf takes, as the new project page's own (pictures, PDF, STEP). */
export const SHELF_FILE_ENDINGS: readonly string[] = [...IMAGE_FORMATS, ...PDF_FORMATS, ...STEP_FORMATS]

/** The most files one part takes in one go. */
export const MAX_SHELF_FILES = 8

/** What a file is, from its name's ending in any case; null for any kind the shelf does not take. */
export function shelfFileKind(name: string): ShelfFileKind | null {
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null
  const ending = base.slice(dot).toLowerCase()
  if ((IMAGE_FORMATS as readonly string[]).includes(ending)) return 'image'
  if ((PDF_FORMATS as readonly string[]).includes(ending)) return 'pdf'
  if ((STEP_FORMATS as readonly string[]).includes(ending)) return 'step'
  return null
}

/** The most bytes of a file of a kind: what a new project copies of the same kind (a STEP 50 MB, a PDF or a picture 25 MB). */
export const shelfFileCap = (kind: ShelfFileKind): number => (kind === 'step' ? MAX_STEP_BYTES : kind === 'pdf' ? MAX_PDF_BYTES : MAX_PHOTO_BYTES)

/** The name a dropped file has in the part's folder: as a new project names a reference (`referenceFiles`), without its folder. */
export const shelfFileName = (path: string): string => referenceFiles([path], SHELF_FILE_ENDINGS)[0].slice('reference/'.length)

/** What copying the dropped files answers: the names they have in the part's folder, and each file that was left out, by name, with the reason. */
export interface ShelfAddResult {
  copied: string[]
  refused: Array<{ name: string; why: string }>
}
