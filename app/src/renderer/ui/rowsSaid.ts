import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'

/** How long "Undo", and the line that closes a walk, are up. */
const UNDO_MS = 10_000

/** The part of the card a row is drawn in: what it says of a refusal or a delete is said there, not in both. */
export type RowsWhere = 'needs' | 'marks' | 'checks'

interface RowsSaid {
  /** What main said when it refused a change, until the next one goes through. */
  refused: { where: RowsWhere; message: string } | null
  /** The mark just deleted, which can be put back for ten seconds, or until the next delete. */
  undo: { where: RowsWhere; id: string } | null
  /** How the last walk through the marks to review went (`Reviewed 5: 4 OK`), for ten seconds. Needs you stays open while it is up. */
  reviewed: string | null
}

const rowsStore = createStore<RowsSaid>(() => ({ refused: null, undo: null, reviewed: null }))
let undoTimer: ReturnType<typeof setTimeout> | undefined
let reviewedTimer: ReturnType<typeof setTimeout> | undefined

export function useRowsSaid<T>(select: (s: RowsSaid) => T): T {
  return useZustand(rowsStore, select)
}

/** Offers the way back from a delete of `id`, for ten seconds; null takes it away. */
export function offerUndo(where: RowsWhere, id: string | null): void {
  clearTimeout(undoTimer)
  rowsStore.setState({ undo: id === null ? null : { where, id } })
  if (id !== null) undoTimer = setTimeout(() => rowsStore.setState({ undo: null }), UNDO_MS)
}

/** Settles a call to main: what it refuses is said, what it does is forgotten. */
export function done(where: RowsWhere, call: Promise<unknown>): void {
  call.then(
    () => rowsStore.setState({ refused: null }),
    (e: unknown) => rowsStore.setState({ refused: { where, message: e instanceof Error ? e.message : String(e) } })
  )
}

/** Says how a walk went for ten seconds; null takes it away. */
export function sayReviewed(text: string | null): void {
  clearTimeout(reviewedTimer)
  rowsStore.setState({ reviewed: text })
  if (text !== null) reviewedTimer = setTimeout(() => rowsStore.setState({ reviewed: null }), UNDO_MS)
}

/** Forgets what was said of the last project. */
export function forgetRows(): void {
  clearTimeout(undoTimer)
  clearTimeout(reviewedTimer)
  rowsStore.setState({ refused: null, undo: null, reviewed: null })
}

