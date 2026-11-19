import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Card } from '../../shared/board'
import type { DimensionMark, Mark, NewMark } from '../../shared/marks'
import { tieRefusal, tieToleranceFor } from '../../shared/ties'
import { boardActions, boardStore } from './board'
import { keepHeld, measuredStore, type Held } from './measured'
import { setTool, toolStore } from './tools'

// Tying a size by measuring it on the part (#264, B's flow of the #250 mockups). "Measure it on the part" on a size's row shows
// the model, puts Measure in hand and turns the route card's head into "Tying 28.6 mm". The dimension that is kept (the Measure
// tool's "Keep and tie to the size", or Enter) or whose chip is clicked is tied to the size, with the tolerance of the head's
// field. Esc, Cancel, or leaving the model ends it with no change. Nothing here writes a file: main ties (`board:tie`).

export interface Tying {
  objectId: string
  /** The size card being tied. */
  cardId: string
  /** The tolerance as typed in the head (the size's source gives the first one). */
  tolerance: string
}

export const tyingStore = createStore<{ tying: Tying | null }>(() => ({ tying: null }))

export const useTying = <T>(select: (s: { tying: Tying | null }) => T): T => useZustand(tyingStore, select)

const wordsOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

/** The tolerance typed in the head as a number, or why it is not one. */
export function toleranceOf(text: string): number | string {
  const n = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : 'The tolerance is a number, zero or more.'
}

/** Why a measurement just taken could not check this size when kept, or null. A distance cannot check a diameter's size, nor an angle a length. */
export function heldRefusal(card: Card, held: Pick<Held, 'measure'>): string | null {
  if (!card.size) return 'This is not a size.'
  const stand = { id: 'the new dimension', kind: 'dimension', measure: held.measure, status: 'draft' } as DimensionMark
  return tieRefusal(card.size, stand)
}

/** The size card being tied, as the brief has it now; null when none is being tied or the card has gone. */
export function tyingCard(): Card | null {
  const { tying } = tyingStore.getState()
  const board = boardStore.getState()
  if (!tying || board.objectId !== tying.objectId) return null
  const card = board.board?.cards.find((c) => c.id === tying.cardId && c.kind === 'size' && !c.hidden)
  return card?.size ? card : null
}

export const tyingActions = {
  /** Takes the model and the Measure tool up for this size. The brief is left, and comes back when tying ends. */
  begin(objectId: string, card: Card): void {
    if (!card.size) return
    measuredStore.getState().clearHeld()
    boardActions.say(null)
    boardActions.show('model')
    setTool('measure')
    tyingStore.setState({ tying: { objectId, cardId: card.id, tolerance: String(card.size.tie?.tolerance ?? tieToleranceFor(card.size)) } })
  },

  setTolerance(tolerance: string): void {
    const { tying } = tyingStore.getState()
    if (tying) tyingStore.setState({ tying: { ...tying, tolerance } })
  },

  /** Leaves with no change. `to` is where the person goes: the brief they came from, unless they chose another. */
  end(to: 'brief' | null = 'brief'): void {
    const { tying } = tyingStore.getState()
    if (!tying) return
    tyingStore.setState({ tying: null })
    measuredStore.getState().clearHeld()
    if (toolStore.getState().tool === 'measure') setTool('select')
    if (to !== null && boardStore.getState().objectId === tying.objectId) boardActions.show(to)
  },

  /** Ties the size to the dimension `markId` with the head's tolerance. Whether main did it; when it did, the brief is shown, where the size reads its verdict. */
  async tieTo(markId: string): Promise<boolean> {
    const { tying } = tyingStore.getState()
    if (!tying) return false
    const tolerance = toleranceOf(tying.tolerance)
    if (typeof tolerance === 'string') {
      boardActions.say(tolerance)
      return false
    }
    try {
      const next = await window.torno.board.tie(tying.objectId, tying.cardId, markId, tolerance)
      // Tying was left meanwhile (Esc): the tie is made all the same, and nothing more is done.
      if (tyingStore.getState().tying === tying) {
        boardActions.say(null)
        boardActions.setBoard(tying.objectId, next)
        tyingActions.end('brief')
      } else boardActions.setBoard(tying.objectId, next)
      return true
    } catch (e) {
      boardActions.say(wordsOf(e))
      return false
    }
  }
}

/**
 * Keeps the last measurement as a dimension, as `keepHeld` does, and while a size is being tied ties it to that size. A measurement
 * that could not check the size is not kept: the reason is the rejection. Resolves with the mark, or null when none was kept.
 */
export async function keepHeldAndTie(commit: (objectId: string, mark: NewMark) => Promise<Mark>): Promise<Mark | null> {
  const { tying } = tyingStore.getState()
  const card = tying ? tyingCard() : null
  const held = measuredStore.getState().held
  if (tying && card && held && held.objectId === tying.objectId) {
    const refusal = heldRefusal(card, held)
    if (refusal !== null) throw new Error(refusal)
    const tolerance = toleranceOf(tying.tolerance)
    if (typeof tolerance === 'string') throw new Error(tolerance)
  }
  const mark = await keepHeld(commit)
  if (mark && tying && card && tyingStore.getState().tying === tying && mark.kind === 'dimension') await tyingActions.tieTo(mark.id)
  return mark
}

// Tying ends, with nothing changed, when the person goes to another project or to the brief or a tracing, or the size is gone.
boardStore.subscribe((s) => {
  const { tying } = tyingStore.getState()
  if (!tying) return
  if (s.objectId !== tying.objectId || s.shown !== 'model' || tyingCard() === null) tyingActions.end(null)
})
