import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Mark } from '../../shared/marks'
import { type Round, reviewName, roundItems } from '../../shared/reviews'
import type { ObjectInfo } from '../../shared/workspace'
import { listBoardReferences } from '../sessions/reference'
import { type Found, reconcile } from './sources'
import type { BoardStore } from './store'

export interface FollowDeps {
  board: BoardStore
  object(objectId: string): ObjectInfo | undefined
  /** The marks of the project, each with the layout it is in and the round it is an item of. Rejects when they cannot be read. */
  marks(objectId: string): Promise<Mark[]>
  /** The rounds of the project's reviews. Asked after the marks, so that a mark's round is among them. Rejects when they cannot be read. */
  rounds(objectId: string): Promise<Round[]>
  /** The ids of the project's scans. Rejects when they cannot be read. */
  scans(objectId: string): Promise<string[]>
  /** The project's tracings, by id. Rejects when they cannot be read. */
  tracings(objectId: string): Promise<Array<{ id: string }>>
}

/** Whether `<project>/brief.md` is a plain file (a link, or a folder, is not a brief). */
const hasBrief = (dir: string): Promise<boolean> =>
  lstat(join(dir, 'brief.md')).then(
    (s) => s.isFile(),
    () => false
  )

/** The rounds as the board has them: each with the name its frame carries and the marks that are its items. */
export function foundRounds(rounds: readonly Round[], marks: readonly Mark[]): Found['rounds'] {
  return rounds.map((round) => ({ id: round.id, name: reviewName(round, marks), items: roundItems(marks, round.id).map((m) => m.id), ...(round.from !== undefined ? { from: round.from } : {}) }))
}

/**
 * Brings the cards that appear by themselves up to date with what the project has (its brief, `reference/`, marks, the
 * frames of its review rounds, scans and tracings). What cannot be read is not known, which is not the same as there being none: then the board is left as it is.
 * Never rejects: the cards are no reason for a project not to open.
 */
export async function reconcileProject(deps: FollowDeps, objectId: string): Promise<void> {
  const obj = deps.object(objectId)
  if (!obj) return
  try {
    const [marks, scans, tracings, brief] = await Promise.all([deps.marks(objectId), deps.scans(objectId), deps.tracings(objectId), hasBrief(obj.dir)])
    const rounds = await deps.rounds(objectId)
    const found: Found = {
      brief,
      references: listBoardReferences(obj.dir).map((name) => `reference/${name}`),
      marks: marks.map((m) => ({ id: m.id, layout: m.layout, ...(m.round !== undefined ? { round: m.round } : {}), ...(m.kind === 'note' ? { picture: m.size } : {}) })),
      scans,
      tracings: tracings.map((t) => ({ id: t.id })),
      rounds: foundRounds(rounds, marks)
    }
    await deps.board.torno(objectId, (board) => reconcile(board, found))
  } catch (e) {
    console.error(`cannot bring the board of ${objectId} up to date: ${e instanceof Error ? e.message : String(e)}`)
  }
}
