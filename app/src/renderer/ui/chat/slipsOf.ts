// The slip of a shelf file (#354): under the card of a `Write`, `Edit` or `MultiEdit` of a file in a part's folder, `common/parts/<id>/`, the chat says
// that the shelf changed. Worked out here from the items of the transcript, never stored; `ShelfSlip.tsx` draws it.
import type { ChatItem } from '../../../shared/chat'
import { shelfFileOf } from '../../../shared/shelf'

/** The tools that write a file. */
const WRITES = new Set(['Write', 'Edit', 'MultiEdit'])

export interface Slip {
  /** The part's folder. */
  id: string
  /** The files of it the turn wrote, each once, in the order they were first written (`part.py`). */
  files: string[]
}

/**
 * The slips of a run of items, by the id of the tool item each stands under. Only a call that finished counts (a refused or failed one
 * wrote nothing). Several writes to one part in one turn are one slip, under the last of them, naming every file written.
 */
export function shelfSlips(items: readonly ChatItem[]): Map<string, Slip> {
  const slips = new Map<string, Slip>()
  /** The part's slip in the turn under way, and the item it stands under. */
  let turn = new Map<string, { at: string; slip: Slip }>()
  for (const item of items) {
    if (item.kind === 'turn') {
      turn = new Map()
      continue
    }
    if (item.kind !== 'tool' || item.state !== 'done' || !WRITES.has(item.name)) continue
    const input = item.input as { file_path?: unknown } | null
    const where = shelfFileOf(input?.file_path)
    if (!where) continue
    const before = turn.get(where.id)
    if (before) slips.delete(before.at)
    const files = before ? [...before.slip.files] : []
    if (!files.includes(where.file)) files.push(where.file)
    const slip = { id: where.id, files }
    turn.set(where.id, { at: item.id, slip })
    slips.set(item.id, slip)
  }
  return slips
}
