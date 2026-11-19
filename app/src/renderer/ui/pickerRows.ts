import { groupsIn } from '../../shared/groups'
import type { Param, Scene } from '../../shared/scene'
import type { LayerSettings } from '../../shared/scenefile'
import { paramRow } from './paramRows'

// The picker (`Ctrl+P`): every part of the layout and every value of the model in one list, found by what is typed.
// Pure: PartPicker.tsx draws what this says.

export type PickerRow =
  | { kind: 'part'; name: string; group: string | null; hidden: boolean; bought: boolean; head?: string }
  | { kind: 'param'; name: string; value: string | null; doc: string | null; head?: string }

/** Rows drawn at most: a model of 400 parts is searched, not scrolled; the rest is said as a count. */
export const PICKER_LIMIT = 60

export interface Picked {
  rows: PickerRow[]
  /** How many rows matched, before the limit. */
  found: number
  /** How many rows there are without a search. */
  total: number
}

const VALUES = 'Values'
const NO_GROUP = 'Parts'

/**
 * The parts of the layout in the order of the Parts tab (each group's, then the rest), then the values in the model's
 * order. A word typed finds a part by its name or its group's, a value by its name or its comment; every word must be
 * found. A row that begins a section has `head`: a group's name, "Parts" for those in none (only when the model has
 * groups), or "Values".
 */
export function pickerRows(scene: Pick<Scene, 'parts' | 'groups' | 'params'>, layout: string, layers: Record<string, LayerSettings>, query: string, limit = PICKER_LIMIT): Picked {
  const parts = scene.parts.filter((p) => p.layout === layout)
  const groups = groupsIn(scene, layout)
  const byName = new Map(parts.map((p) => [p.name, p]))
  const grouped = new Set(groups.flatMap((g) => g.parts))
  const entries: { group: string | null; name: string }[] = [
    ...groups.flatMap((g) => g.parts.map((name) => ({ group: g.name, name }))),
    ...parts.filter((p) => !grouped.has(p.name)).map((p) => ({ group: null, name: p.name }))
  ]
  const all: PickerRow[] = []
  for (const { group, name } of entries) {
    const part = byName.get(name)!
    all.push({ kind: 'part', name, group, hidden: layers[name]?.visible === false, bought: part.role === 'reference' })
  }
  for (const param of scene.params ?? []) all.push(paramItem(param))
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = (row: PickerRow): string => (row.kind === 'part' ? `${row.name} ${row.group ?? ''}` : `${row.name} ${row.doc ?? ''}`).toLowerCase()
  const matched = all.filter((row) => words.every((w) => text(row).includes(w)))
  const shown = matched.slice(0, limit)
  const named = groups.length > 0
  let last: string | null = null
  const rows = shown.map((row): PickerRow => {
    const section = row.kind === 'param' ? VALUES : (row.group ?? (named ? NO_GROUP : null))
    const head = section !== null && section !== last ? section : undefined
    last = section
    return head === undefined ? row : { ...row, head }
  })
  return { rows, found: matched.length, total: all.length }
}

function paramItem(param: Param): PickerRow {
  const row = paramRow(param)
  return { kind: 'param', name: row.name, value: row.value, doc: row.doc }
}

/** The row `n` steps from `at` in a list of `count`, round the ends; the first when nothing was chosen. */
export function stepPick(at: number, count: number, by: 1 | -1): number {
  if (count === 0) return -1
  if (at < 0 || at >= count) return by === 1 ? 0 : count - 1
  return (at + by + count) % count
}
