import type { Mark } from '../../../shared/marks'
import { type NamedSet, lostText, memberRef } from '../../../shared/sets'

/** What can be done with a set from its row. `light` is the pointer on the row; the others are buttons. */
export type SetAction = 'light' | 'isolate' | 'rename' | 'recolour' | 'add' | 'take' | 'repick' | 'tag' | 'delete' | 'accept' | 'dismiss'

/** One set as the Layers list draws it. */
export interface SetRow {
  id: string
  /** `#deck`: what it is called in a prompt. */
  ref: string
  name: string
  /** Which of the eight colours, 0 to 7. */
  colour: number
  /** How many members it has, lost ones too. */
  count: number
  /** `2 of 5 faces lost`, or null when none is: with it the row offers Re-pick. */
  lost: string | null
  /** Claude's proposal, not yet the person's: its swatch is dashed and its row says so. */
  proposed: boolean
  actions: SetAction[]
}

/** The parts a set has members in: faces, edges and parts it holds that are not lost, once each. A stroke is of no part. */
export function partsOfSet(set: Pick<NamedSet, 'members'>): string[] {
  return [...new Set(set.members.filter((m) => !('stroke' in m) && m.state !== 'lost').map((m) => memberRef(m).split('/')[0]))]
}

/** The part every member of a set is of, lost ones included, or null: it has strokes, or members in more parts, or none. */
function onlyPart(set: Pick<NamedSet, 'members'>): string | null {
  if (set.members.length === 0 || set.members.some((m) => 'stroke' in m)) return null
  const parts = new Set(set.members.map((m) => memberRef(m).split('/')[0]))
  return parts.size === 1 ? [...parts][0] : null
}

function rowOf(set: NamedSet, marks: readonly Mark[]): SetRow {
  const lost = lostText(set, marks)
  const actions: SetAction[] = set.proposed
    ? ['light', 'isolate', 'accept', 'dismiss']
    : ['light', 'isolate', 'rename', 'recolour', 'add', 'take', ...(lost !== null ? (['repick'] as const) : []), 'tag', 'delete']
  return { id: set.id, ref: `#${set.slug}`, name: set.name, colour: set.colour, count: set.members.length, lost, proposed: set.proposed === true, actions }
}

/**
 * The sets of the layout shown as rows of the Layers list, in the order given: a set whose members are all of one part (and
 * that part is in the layout) stands under that part (`byPart`), and any other, with members in several parts or with
 * strokes, under "Named sets" (`across`). `sets` are those of the layout; `marks` say which strokes are still there.
 */
export function setRows(sets: readonly NamedSet[], parts: readonly { name: string }[], marks: readonly Mark[]): { byPart: Record<string, SetRow[]>; across: SetRow[] } {
  const byPart: Record<string, SetRow[]> = {}
  const across: SetRow[] = []
  for (const set of sets) {
    const part = onlyPart(set)
    const row = rowOf(set, marks)
    if (part !== null && parts.some((p) => p.name === part)) (byPart[part] ??= []).push(row)
    else across.push(row)
  }
  return { byPart, across }
}
