import type { BoardFile, Card } from '../../shared/board'
import type { DimensionMark, Mark } from '../../shared/marks'
import { CARD_ID } from '../../shared/board'
import { type SizeTie } from '../../shared/size'
import { tieNumber, tieRefusal, tieToleranceFor } from '../../shared/ties'
import { Refusal } from '../refusal'
import type { BoardStore } from './store'
import type { MarkStore } from '../marks/store'

// Tying a size of the brief to a dimension (#262). The size card holds the tie (`size.tie`: the mark and the tolerance), and the
// dimension holds what the size sets (`expected`, `tolerance`) and whose it is (`expectedFrom`). The two files are written
// by their own stores; this keeps them saying the same thing. Everything is done by `reconcile`, which is safe to run at any
// time and says only what the cards say: a tie that is asked for is first written on the card, and then made true on the mark.

export interface TieDeps {
  board: Pick<BoardStore, 'read' | 'torno'>
  marks: Pick<MarkStore, 'list' | 'update'>
}

/** Who asks: the person may tie any dimension; the agent only its own (it never changes what the person checks the part by). */
export type Tier = 'person' | 'agent'

const isDimension = (mark: Mark | undefined): mark is DimensionMark => mark?.kind === 'dimension'

export class Ties {
  /** One change at a time per project. */
  private chain = new Map<string, Promise<unknown>>()

  constructor(private deps: TieDeps) {}

  private turn<T>(objectId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.chain.get(objectId) ?? Promise.resolve()).then(task, task)
    this.chain.set(objectId, run.catch(() => undefined))
    return run
  }

  /**
   * Ties the size card `cardId` to the dimension `markId` with `tolerance` (the size's source says it when none is given), or
   * again to the same one with another tolerance. Refused, with the reason, when the card is no size, the dimension is
   * another's or cannot check it, or another size already ties it.
   */
  tie(objectId: string, cardId: string, markId: string, by: Tier, tolerance?: number): Promise<BoardFile> {
    return this.turn(objectId, async () => {
      const board = await this.deps.board.read(objectId)
      const card = sizeCard(board, cardId)
      const mark = (await this.deps.marks.list(objectId)).find((m) => m.id === markId)
      if (!isDimension(mark)) throw new Refusal(`${markId} is not a dimension of this project: a size is tied to a dimension.`)
      const size = card.size!
      const refusal = tieRefusal(size, mark)
      if (refusal !== null) throw new Refusal(refusal)
      if (by === 'agent' && mark.author !== 'agent') throw new Refusal(`${markId} is the person's dimension: tie a size to one of your own, and leave theirs to them.`)
      const other = board.cards.find((c) => c.id !== cardId && c.size?.tie?.mark === markId)
      if (other) throw new Refusal(`${markId} already checks ${other.id}: a dimension holds one size, so untie that one first.`)
      const tol = tolerance ?? (size.tie?.mark === markId ? size.tie.tolerance : tieToleranceFor(size))
      if (typeof tol !== 'number' || !Number.isFinite(tol) || tol < 0) throw new Refusal('The tolerance is a number, zero or more.')
      const tie: SizeTie = { mark: markId, tolerance: tol }
      const was = size.tie
      // The card first, since it is what travels in git and says what is meant; then the mark is made to agree.
      const next = await this.deps.board.torno(objectId, (current) => {
        const c = current.cards.find((x) => x.id === cardId)
        if (!c?.size) return null
        c.size = { ...c.size, tie }
        return current
      })
      // A size the dimension of another was tied to gives that one up.
      if (was && was.mark !== markId) await this.release(objectId, was.mark, cardId, by)
      await this.reconcileNow(objectId, by)
      return next
    })
  }

  /** Takes the tie off a size card: its dimension keeps no expectation of it. */
  untie(objectId: string, cardId: string, by: Tier = 'person'): Promise<BoardFile> {
    return this.turn(objectId, async () => {
      const board = await this.deps.board.read(objectId)
      const card = sizeCard(board, cardId)
      const tied = card.size?.tie
      if (!tied) throw new Refusal(`${cardId} is not tied to a dimension.`)
      if (by === 'agent') {
        const mark = (await this.deps.marks.list(objectId)).find((m) => m.id === tied.mark)
        if (mark && mark.author !== 'agent') throw new Refusal(`${cardId} is tied to ${tied.mark}, the person's dimension: that is theirs to untie.`)
      }
      const next = await this.deps.board.torno(objectId, (current) => {
        const c = current.cards.find((x) => x.id === cardId)
        if (!c?.size?.tie) return null
        const { tie: _gone, ...rest } = c.size
        c.size = rest
        return current
      })
      await this.reconcileNow(objectId, by)
      return next
    })
  }

  /** Makes the marks say what the cards say (see above). Does nothing, and writes nothing, when they already do. */
  reconcile(objectId: string): Promise<void> {
    return this.turn(objectId, () => this.reconcileNow(objectId, 'person'))
  }

  /** The dimension `markId` no longer takes its expectation from `cardId`. */
  private async release(objectId: string, markId: string, cardId: string, by: Tier): Promise<void> {
    const mark = (await this.deps.marks.list(objectId)).find((m) => m.id === markId)
    if (isDimension(mark) && mark.expectedFrom === cardId) await this.deps.marks.update(objectId, markId, { expected: null, tolerance: null }, by === 'agent' ? 'agent' : 'user', { from: null })
  }

  private async reconcileNow(objectId: string, by: Tier): Promise<void> {
    const board = await this.deps.board.read(objectId)
    const marks = await this.deps.marks.list(objectId)
    const who = by === 'agent' ? 'agent' : 'user'
    const taken = new Set<string>()
    const broken: string[] = []
    for (const card of board.cards) {
      const tie = card.kind === 'size' ? card.size?.tie : undefined
      if (!card.size || !tie || card.hidden) continue
      const mark = marks.find((m) => m.id === tie.mark)
      // A dimension that is not there (yet: a pull may bring it) is left alone; the page says it is gone.
      if (!isDimension(mark)) continue
      if (tieRefusal(card.size, mark) !== null && !(mark.status === 'resolved')) {
        broken.push(card.id)
        continue
      }
      if (mark.status === 'resolved' || taken.has(mark.id)) continue
      taken.add(mark.id)
      const number = tieNumber(card.size)
      if (typeof number !== 'number') continue
      if (mark.expectedFrom === card.id && mark.expected === number && mark.tolerance === tie.tolerance) continue
      // Another size already holds it (a board pulled with two ties to one dimension): the first stays.
      if (mark.expectedFrom !== undefined && mark.expectedFrom !== card.id && board.cards.some((c) => c.id === mark.expectedFrom && c.size?.tie?.mark === mark.id)) continue
      await this.deps.marks.update(objectId, mark.id, { expected: number, tolerance: tie.tolerance }, who, { from: card.id })
    }
    // A size edited so that no dimension can hold to it any more (two numbers, another unit) is no longer tied.
    if (broken.length > 0) {
      await this.deps.board.torno(objectId, (current) => {
        let changed = false
        for (const id of broken) {
          const c = current.cards.find((x) => x.id === id)
          if (c?.size?.tie) {
            const { tie: _gone, ...rest } = c.size
            c.size = rest
            changed = true
          }
        }
        return changed ? current : null
      })
    }
    // Dimensions that hold a size's number which no size claims any more (removed, untied, another dimension) give it up.
    const after = broken.length > 0 ? await this.deps.board.read(objectId) : board
    for (const mark of marks) {
      if (!isDimension(mark) || mark.expectedFrom === undefined) continue
      const from = mark.expectedFrom
      const card = after.cards.find((c) => c.id === from && CARD_ID.test(c.id))
      if (!card?.size?.tie || card.size.tie.mark !== mark.id) await this.deps.marks.update(objectId, mark.id, { expected: null, tolerance: null }, who, { from: null })
    }
  }
}

function sizeCard(board: BoardFile, cardId: string): Card {
  const card = board.cards.find((c) => c.id === cardId && !c.hidden)
  if (!card) throw new Refusal(`There is no card ${String(cardId)} on the brief.`)
  if (card.kind !== 'size' || !card.size) throw new Refusal(`${cardId} is not a size: only a size is tied to a dimension.`)
  return card
}
