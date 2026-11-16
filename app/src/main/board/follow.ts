import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ObjectInfo } from '../../shared/workspace'
import { listReferences } from '../sessions/reference'
import { reconcile } from './sources'
import type { BoardStore } from './store'

export interface FollowDeps {
  board: BoardStore
  object(objectId: string): ObjectInfo | undefined
  /** The marks of the project, each with the layout it is in. Rejects when they cannot be read. */
  marks(objectId: string): Promise<Array<{ id: string; layout: string }>>
  /** The ids of the project's scans. Rejects when they cannot be read. */
  scans(objectId: string): Promise<string[]>
}

/** Whether `<project>/brief.md` is a plain file (a link, or a folder, is not a brief). */
const hasBrief = (dir: string): Promise<boolean> =>
  lstat(join(dir, 'brief.md')).then(
    (s) => s.isFile(),
    () => false
  )

/**
 * Brings the cards that appear by themselves up to date with what the project has (its brief, `reference/`, marks and
 * scans). What cannot be read is not known, which is not the same as there being none: then the board is left as it is.
 * Never rejects: the cards are no reason for a project not to open.
 */
export async function reconcileProject(deps: FollowDeps, objectId: string): Promise<void> {
  const obj = deps.object(objectId)
  if (!obj) return
  try {
    const [marks, scans, brief] = await Promise.all([deps.marks(objectId), deps.scans(objectId), hasBrief(obj.dir)])
    const found = { brief, references: listReferences(obj.dir).map((name) => `reference/${name}`), marks, scans }
    await deps.board.torno(objectId, (board) => reconcile(board, found))
  } catch (e) {
    console.error(`cannot bring the board of ${objectId} up to date: ${e instanceof Error ? e.message : String(e)}`)
  }
}
