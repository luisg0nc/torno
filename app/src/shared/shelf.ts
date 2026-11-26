import { number } from './format'
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
