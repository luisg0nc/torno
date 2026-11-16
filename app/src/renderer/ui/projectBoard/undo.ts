import type { Arrow, Card, PersonChange } from '../../../shared/board'

// The changes the person made to the board in this window, so that Ctrl+Z can take them back (at most 50). A change is
// kept as what it touched, before and after, and undoing it is made of what differs: the cards it removed come back
// (`restore`, by id: main keeps what it took off), the ones it hid are shown (`unhide`), the ones it moved or resized go to their old place (`move`), the
// words it changed are put back (`edit`), and what it added is taken away (`remove`, `unarrow`). Main is told each as
// an ordinary change of the person's.

export const UNDO_LIMIT = 50

/** The cards and arrows a change touched, as they were at one moment. */
export interface Snapshot {
  cards: Card[]
  arrows: Arrow[]
}

/** The named cards (copied), the arrows named and the arrows that touch a named card. */
export function pick(board: { cards: readonly Card[]; arrows: readonly Arrow[] }, ids: readonly string[]): Snapshot {
  const wanted = new Set(ids)
  return {
    cards: board.cards.filter((c) => wanted.has(c.id)).map((c) => structuredClone(c)),
    arrows: board.arrows.filter((a) => wanted.has(a.id) || wanted.has(a.from) || wanted.has(a.to)).map((a) => ({ ...a }))
  }
}

/** The ids of the cards named and the cards in the frames among them. */
export function withMembers(board: { cards: readonly Card[] }, ids: readonly string[]): string[] {
  const named = new Set(ids)
  return [...new Set([...ids, ...board.cards.filter((c) => c.frame !== undefined && named.has(c.frame)).map((c) => c.id)])]
}

const same = (a: Card, b: Card): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.frame === b.frame

/** What takes `after` back to `before`, in the order main needs it: cards first, then where they stand, then what they say, then what was added. */
function reverse(before: Snapshot, after: Snapshot): PersonChange[] {
  const now = new Map(after.cards.map((c) => [c.id, c]))
  const was = new Map(before.cards.map((c) => [c.id, c]))
  const nowArrows = new Set(after.arrows.map((a) => a.id))
  const wasArrows = new Set(before.arrows.map((a) => a.id))
  const changes: PersonChange[] = []

  const gone = before.cards.filter((c) => !now.has(c.id))
  const goneArrows = before.arrows.filter((a) => !nowArrows.has(a.id))
  if (gone.length > 0 || goneArrows.length > 0) changes.push({ op: 'restore', ids: [...gone.map((c) => c.id), ...goneArrows.map((a) => a.id)] })

  const kept = before.cards.filter((c) => now.has(c.id))
  for (const c of kept) if (c.hidden && !now.get(c.id)!.hidden) changes.push({ op: 'remove', ids: [c.id] })
  for (const c of kept) if (!c.hidden && now.get(c.id)!.hidden) changes.push({ op: 'unhide', id: c.id })

  const moves = kept
    .filter((c) => !same(c, now.get(c.id)!))
    .map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, ...(c.frame !== now.get(c.id)!.frame ? { frame: c.frame ?? null } : {}) }))
  if (moves.length > 0) changes.push({ op: 'move', moves })

  for (const c of kept) {
    const b = now.get(c.id)!
    const edit: PersonChange & { op: 'edit' } = { op: 'edit', id: c.id }
    let edited = false
    for (const field of ['text', 'name', 'caption'] as const) {
      if ((c[field] ?? '') !== (b[field] ?? '')) {
        edit[field] = c[field] ?? ''
        edited = true
      }
    }
    // A sketch drawn on again: the drawing before is a file main still has (it sweeps the unnamed ones when the project is opened).
    if (c.kind === 'sketch' && c.picture !== undefined && c.picture !== b.picture) {
      edit.picture = c.picture
      edited = true
    }
    // A size card's facts, as a whole: main checks them as it does a new size.
    if (c.kind === 'size' && c.size !== undefined && JSON.stringify(c.size) !== JSON.stringify(b.size)) {
      edit.size = structuredClone(c.size)
      edited = true
    }
    if (edited) changes.push(edit)
  }

  for (const a of after.arrows) if (!wasArrows.has(a.id)) changes.push({ op: 'unarrow', id: a.id })
  const added = after.cards.filter((c) => !was.has(c.id)).map((c) => c.id)
  if (added.length > 0) changes.push({ op: 'remove', ids: added })
  return changes
}

// The unhide of a card is an `unhide` and its hiding a `remove`: both of them put in order above, with the hides first
// only so that one change never holds both of a card.

export class BoardUndo {
  private readonly stack: PersonChange[][] = []
  /** What of the last undone change is still to be sent: a change of the person's can need more than one of main's. */
  private rest: PersonChange[] = []

  /** What a change did: the cards and arrows it touched, before it and after it. A change that altered nothing is not kept. */
  push(before: Snapshot, after: Snapshot): void {
    const changes = reverse(before, after)
    if (changes.length === 0) return
    this.stack.push(changes)
    if (this.stack.length > UNDO_LIMIT) this.stack.shift()
  }

  /** Whether the change `undo` last gave has another that goes with it, to be asked for next. */
  get chained(): boolean {
    return this.rest.length > 0
  }

  /** The change that takes the last one back, or null when there is none. Ask again while `chained`. */
  undo(): PersonChange | null {
    if (this.rest.length === 0) this.rest = this.stack.pop() ?? []
    return this.rest.shift() ?? null
  }

  get size(): number {
    return this.stack.length
  }
}
