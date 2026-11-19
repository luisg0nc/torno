import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Mark } from '../../shared/marks'
import type { ObjectInfo } from '../../shared/workspace'
import { listBoardReferences } from '../sessions/reference'
import { type Found, reconcile } from './sources'
import type { BoardStore } from './store'

export interface FollowDeps {
  board: BoardStore
  object(objectId: string): ObjectInfo | undefined
  /** The marks of the project. Rejects when they cannot be read. */
  marks(objectId: string): Promise<Mark[]>
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

/**
 * Brings the cards of main's own up to date with what the project has: the brief and `reference/` get cards, and the old
 * card of a mark, scan or tracing goes when its thing does (none is made any more, #248). What cannot be read is not known, which is not the same as there being none: then the board is left as it is.
 * Never rejects: the cards are no reason for a project not to open.
 */
export async function reconcileProject(deps: FollowDeps, objectId: string): Promise<void> {
  const obj = deps.object(objectId)
  if (!obj) return
  try {
    const [marks, scans, tracings, brief] = await Promise.all([deps.marks(objectId), deps.scans(objectId), deps.tracings(objectId), hasBrief(obj.dir)])
    const found: Found = {
      brief,
      references: listBoardReferences(obj.dir).map((name) => `reference/${name}`),
      marks: marks.map((m) => m.id),
      scans,
      tracings: tracings.map((t) => t.id)
    }
    await deps.board.torno(objectId, (board) => reconcile(board, found))
  } catch (e) {
    console.error(`cannot bring the board of ${objectId} up to date: ${e instanceof Error ? e.message : String(e)}`)
  }
}
