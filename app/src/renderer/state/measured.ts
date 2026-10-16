import { useStore as useZustand } from 'zustand'
import { type StoreApi, createStore } from 'zustand/vanilla'
import type { Anchor, Mark, MeasureKind, NewMark } from '../../shared/marks'
import type { Camera } from '../../shared/view'

/**
 * The last measurement the Measure tool took and main measured (`geometry.measure`): its ends as anchors, its kind,
 * the kernel's value and how it was taken, and the object, layout, build and camera it was taken on. It is no mark:
 * nothing of it is told to the agent. It is kept as a dimension only by `keepHeld` (the strip's button, `Enter`);
 * `kept` is then the mark's number.
 */
export interface Held {
  objectId: string
  layout: string
  revision: number
  camera: Camera
  measure: MeasureKind
  a: Anchor
  b?: Anchor
  value: number
  how: string
  kept?: string
}

export interface MeasuredState {
  /** The last measurement; null when there is none, or it was let go of. */
  held: Held | null
  /** Main was asked to keep it and has not answered. */
  keeping: boolean
  /** Why main did not keep it, until the next measurement or the next try. */
  refused: string | null
  setHeld(held: Held): void
  clearHeld(): void
}

/** Changed once per measurement, and once per keeping: never by a pointer move. */
export const measuredStore: StoreApi<MeasuredState> = createStore<MeasuredState>((set) => ({
  held: null,
  keeping: false,
  refused: null,
  setHeld: (held) => set({ held, keeping: false, refused: null }),
  clearHeld: () => set({ held: null, keeping: false, refused: null })
}))

export function useHeld<T>(pick: (s: MeasuredState) => T): T {
  return useZustand(measuredStore, pick)
}

/** The dimension a held measurement is kept as: the same ends, kind, layout, build and camera it was taken with. */
export function dimensionOf(held: Held): NewMark {
  return { kind: 'dimension', measure: held.measure, author: 'user', note: '', layout: held.layout, revision: held.revision, camera: held.camera, a: held.a, ...(held.b ? { b: held.b } : {}) }
}

/**
 * Keeps the last measurement as a dimension, through `commit` (`commitMark` of its object): main measures it again
 * as it keeps it. Resolves with the mark, or null when there is nothing to keep, it is kept already, or it is being
 * kept. When main refuses, the measurement stays held, `refused` says why, and the promise rejects with it.
 */
export async function keepHeld(commit: (objectId: string, mark: NewMark) => Promise<Mark>): Promise<Mark | null> {
  const { held, keeping } = measuredStore.getState()
  if (!held || held.kept !== undefined || keeping) return null
  measuredStore.setState({ keeping: true, refused: null })
  try {
    const mark = await commit(held.objectId, dimensionOf(held))
    // Unless another measurement was taken meanwhile: that one is not kept.
    if (measuredStore.getState().held === held) measuredStore.setState({ held: { ...held, kept: mark.id }, keeping: false })
    return mark
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    if (measuredStore.getState().held === held) measuredStore.setState({ keeping: false, refused: reason })
    throw e
  }
}
