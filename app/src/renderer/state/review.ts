import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { NewMark, ReviewIntent } from '../../shared/marks'
import { type Round, type RoundAsk, type RoundsView, openRound } from '../../shared/reviews'
import { store } from './store'

// The review in the window: the rounds main keeps in `marks.json` as it last told them, which round is being sent, what the
// bar over the view says of the marks made next, and which round's panel is open. The round is main's; the choice and the
// panel are the window's alone. Nothing here changes with a pointer move.

export interface ReviewState {
  /** The project the rounds are of; null while none is open. */
  objectId: string | null
  rounds: Round[]
  /** The round whose prompt is on its way: its items go with it. */
  sending: string | null
  /** What a mark made now is: plain, or what the person does not want or wants. Only while a round is open. */
  choice: 'plain' | ReviewIntent
  /** The round whose panel is open, by its `R<n>`. */
  panel: string | null
  /** Why main refused the last thing asked of it, in its words; null when all is well. */
  refused: string | null
}

const INITIAL: ReviewState = { objectId: null, rounds: [], sending: null, choice: 'plain', panel: null, refused: null }

export const reviewStore = createStore<ReviewState>(() => INITIAL)

export function useReview<T>(select: (s: ReviewState) => T): T {
  return useZustand(reviewStore, select)
}

const state = (): ReviewState => reviewStore.getState()
const set = (patch: Partial<ReviewState>): void => reviewStore.setState(patch)

/** The round that is open, if any. */
export function openRoundNow(s: Pick<ReviewState, 'rounds'> = state()): Round | undefined {
  return openRound(s.rounds)
}

/** The rounds as a mark's card or row needs them to say it is held: those of this project, not another's, and none while they are not known. */
export function roundsViewOf(s: Pick<ReviewState, 'objectId' | 'rounds' | 'sending'>, objectId: string): RoundsView | undefined {
  return s.objectId === objectId ? { rounds: s.rounds, sending: s.sending } : undefined
}

/**
 * The mark as it is made while the bar says `intent`: the person's mark says it (a shape's own `add` or `remove`); the
 * agent's never does, and none leaves the mark as it was.
 */
export function withIntent(mark: NewMark, intent: ReviewIntent | undefined): NewMark {
  if (intent === undefined || mark.author !== 'user') return mark
  if (mark.kind === 'shape') return { ...mark, intent: intent === 'want' ? 'add' : 'remove' }
  return { ...mark, intent }
}

/** What main refused or failed at, in its words. */
const said = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Asks main one thing of the rounds and takes its answer for them; false (and why, in `refused`) when it refused. */
async function ask(what: RoundAsk): Promise<boolean> {
  const objectId = state().objectId
  if (objectId === null) return false
  try {
    const view = await window.torno.marks.round(objectId, what)
    reviewActions.told({ objectId, ...view })
    set({ refused: null })
    return true
  } catch (e) {
    set({ refused: said(e) })
    return false
  }
}

export const reviewActions = {
  /** What main told of the rounds of a project: kept when it is the project the window has. A round that is no longer open puts the bar back on plain. */
  told(m: { objectId: string; rounds: Round[]; sending: string | null }): void {
    const s = state()
    if (m.objectId !== s.objectId) return
    set({
      rounds: m.rounds,
      sending: m.sending,
      choice: openRound(m.rounds) ? s.choice : 'plain',
      panel: s.panel !== null && !m.rounds.some((round) => round.id === s.panel) ? null : s.panel
    })
  },

  /** A project is shown (or none): the rounds of another are not these. */
  open(objectId: string | null): void {
    reviewStore.setState({ ...INITIAL, objectId })
  },

  /** Starts a round on the build on show of the layout shown, or finds the one that is open. */
  async start(layout: string): Promise<boolean> {
    return ask({ start: { layout } })
  },
  /** Ends the round without sending it: its marks stay drafts, held. */
  async end(id: string): Promise<boolean> {
    return ask({ end: id })
  },
  /** Sends the round: it is closed and goes with the next prompt, in the composer's chip. */
  async send(id: string): Promise<boolean> {
    return ask({ send: id })
  },
  /** Opens a round that was ended and not sent again. */
  async reopen(id: string): Promise<boolean> {
    return ask({ reopen: id })
  },
  /** Starts the next round from a round that was sent: its Still wrong items are in it, and its bar opens. The panel of the round before is put away. */
  async carry(id: string): Promise<boolean> {
    const done = await ask({ carry: id })
    if (done) set({ panel: null })
    return done
  },
  /** Lets the round go as plain marks: they are ordinary drafts, and it is never sent. */
  async plain(id: string): Promise<boolean> {
    return ask({ plain: id })
  },

  /** What the marks made next are. */
  choose(choice: 'plain' | ReviewIntent): void {
    set({ choice, refused: null })
  },
  /** An intent key: the one that is chosen already takes it back to plain. */
  toggle(intent: ReviewIntent): void {
    set({ choice: state().choice === intent ? 'plain' : intent, refused: null })
  },
  openPanel(id: string | null): void {
    set({ panel: id })
  },

  /** What the bar says of a mark made now on `layout`: the choice while a round is open on that layout, else none. */
  intentForNew(layout: string): ReviewIntent | undefined {
    const s = state()
    const open = openRound(s.rounds)
    return open !== undefined && open.layout === layout && s.choice !== 'plain' ? s.choice : undefined
  },

  /** Says what the person wants, does not want or says nothing of (`null`) of a mark of theirs. It does not put the mark in a round. */
  async setIntent(id: string, intent: ReviewIntent | null): Promise<boolean> {
    const objectId = state().objectId
    if (objectId === null) return false
    try {
      await window.torno.marks.setIntent(objectId, id, intent)
      set({ refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** The person's verdict on what Claude did with an item of a round that was sent: OK, or Still wrong with a note of why, which puts it in the next round. */
  async judge(id: string, verdict: 'ok' | 'still-wrong', note?: string): Promise<boolean> {
    const objectId = state().objectId
    if (objectId === null) return false
    try {
      await (note === undefined ? window.torno.marks.judge(objectId, id, verdict) : window.torno.marks.judge(objectId, id, verdict, note))
      set({ refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** Takes a mark out of its round. */
  async takeOut(id: string): Promise<boolean> {
    const objectId = state().objectId
    if (objectId === null) return false
    try {
      await window.torno.marks.roundOut(objectId, id)
      set({ refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  }
}

/** The rounds of a project, as main has them. */
async function load(objectId: string): Promise<void> {
  try {
    const view: RoundsView = await window.torno.marks.rounds(objectId)
    reviewActions.told({ objectId, ...view })
  } catch {
    // None are known: the project has no review yet, or main could not say; the next change tells them.
  }
}

/**
 * Joins the review to the open project and to main: the rounds are read when a project opens and follow what main tells of
 * the marks. Returns what stops it.
 */
export function connectReview(): () => void {
  const open = store.getState().objectId
  reviewActions.open(open)
  if (open !== null) void load(open)
  const offStore = store.subscribe((s, prev) => {
    if (s.objectId === prev.objectId) return
    reviewActions.open(s.objectId)
    if (s.objectId !== null) void load(s.objectId)
  })
  const offMarks = window.torno.marks.onChanged((m) => reviewActions.told(m))
  return () => {
    offStore()
    offMarks()
  }
}
