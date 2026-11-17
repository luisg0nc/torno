import type { Described } from '../../shared/geometry'
import type { Anchor, Mark, NewMark, PickMark, Replacement, Vec3 } from '../../shared/marks'
import type { Camera } from '../../shared/view'
import { describeWhole } from '../state/descriptors'
import { reviewActions, withIntent } from '../state/review'
import { refOfSet, setsHolding, setsStore } from '../state/sets'
import { toolStore } from '../state/tools'
import { actions, store, type PickedAt } from '../state/store'
import { parseRef } from '../viewport/picking'
import { DESCRIBE_WITHIN_MS, within } from './Tool'

/**
 * Has main keep a mark of the person's. Main gives it its number and tells
 * every window, which is how it gets to the viewport and the panel. When main
 * refuses, the marks panel says so, and the promise is rejected.
 */
export function commitMark(objectId: string, mark: NewMark): Promise<Mark> {
  // While a round is open the bar says what a mark made now is (want, don't want or plain): main checks it, and puts the mark in the round.
  return window.torno.marks.add(objectId, withIntent(mark, reviewActions.intentForNew(mark.layout))).catch((e: unknown) => {
    // A dimension the kernel would not measure: the Measure tool says why at the pointer, and nothing is left to dismiss.
    if (mark.kind === 'dimension') throw e
    actions.setMarksProblem({ objectId, message: `The mark was not kept: ${e instanceof Error ? e.message : String(e)}` })
    throw e
  })
}

/**
 * Has main put a mark of the person's somewhere else. It comes back as it now
 * is, and becomes the active one. When main refuses, the marks panel says so,
 * and the promise is rejected.
 */
export function replaceMark(objectId: string, id: string, placed: Replacement): Promise<Mark> {
  return window.torno.marks.replace(objectId, id, placed).then(
    (mark) => {
      actions.setActiveMark(mark.id)
      return mark
    },
    (e: unknown) => {
      actions.setMarksProblem({ objectId, message: `${id} was not moved: ${e instanceof Error ? e.message : String(e)}` })
      throw e
    }
  )
}

/** The middle of what the kernel described, where a mark on it goes when nobody clicked a point of it. */
function middleOf(described: Described): Vec3 {
  if (described.kind !== 'part') return described.center
  const { min, max } = described.bbox
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

/**
 * What a pick made in the set scope says of the set its ref is in (`Anchor.set`): the first set of the layout shown that holds the ref.
 * Undefined in any other scope, where the selection is not of a set. Main keeps the label only when the set holds the ref.
 */
export function setOfSelection(): ((ref: string) => string | undefined) | undefined {
  if (toolStore.getState().selectScope !== 'set') return undefined
  const { layout } = store.getState()
  const sets = setsStore.getState().sets
  return (ref) => {
    const first = setsHolding(sets, layout, ref)[0]
    return first ? refOfSet(first) : undefined
  }
}

/**
 * One pick mark for each selected ref: "this one". Each is anchored where its
 * ref was clicked, or failing that at the middle the kernel gives for it; a
 * ref with neither is left out. The kernel's line is added when it comes
 * within `DESCRIBE_WITHIN_MS`; the marks do not wait longer.
 */
export async function pickMarks(
  refs: string[],
  picked: Record<string, PickedAt>,
  describe: (ref: string) => Promise<Described | null>,
  placed: { layout: string; revision: number; camera: Camera },
  setOf?: (ref: string) => string | undefined
): Promise<NewMark[]> {
  const marks = await Promise.all(
    refs.map(async (ref): Promise<NewMark | null> => {
      const { part, kind } = parseRef(ref)
      const described = await within(describe(ref), DESCRIBE_WITHIN_MS)
      const at = picked[ref]
      const point = at?.point ?? (described && middleOf(described))
      if (!point) return null
      const normal = at ? at.normal : described?.kind === 'face' ? described.normal : null
      const set = setOf?.(ref)
      const anchor: Anchor = { point, ...(normal ? { normal } : {}), part, ref, ...(described ? { descriptor: described.descriptor } : {}), ...(set ? { set } : {}) }
      return { kind: 'pick', target: kind satisfies PickMark['target'], author: 'user', note: '', ...placed, anchor }
    })
  )
  return marks.filter((mark) => mark !== null)
}

/**
 * Turns the selection into pick marks, in the order selected, empties it, and
 * opens the note of the first. The selection stays as it is when main keeps none.
 */
export async function noteSelection(camera: Camera): Promise<void> {
  const { objectId, layout, revision, selection, picked } = store.getState()
  if (!objectId || selection.length === 0) return
  const marks = await pickMarks(selection, picked, (ref) => describeWhole(objectId, revision, layout, ref), { layout, revision, camera }, setOfSelection())
  let first: Mark | undefined
  for (const mark of marks) {
    // One after the other: their numbers follow the order selected.
    const kept = await commitMark(objectId, mark).catch(() => null)
    if (!kept) break
    first ??= kept
  }
  if (!first) return
  const now = store.getState()
  if (now.objectId === objectId && now.selection === selection) actions.setSelection([])
  actions.openNote({ objectId, layout, id: first.id })
}
