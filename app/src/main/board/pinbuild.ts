import type { BoardFile } from '../../shared/board'
import { HISTORY_ID } from '../../shared/history'
import type { ObjectInfo } from '../../shared/workspace'
import { readHistory, readHistoryThumb } from '../history'
import { Refusal } from '../refusal'
import { savePicture } from './pictures'
import { pin } from './sources'
import type { BoardStore } from './store'

export interface PinBuildDeps {
  board: BoardStore
  object(objectId: string): ObjectInfo | undefined
  /** `History.star`. */
  history: { star(obj: ObjectInfo, id: string, starred: boolean): Promise<boolean> }
}

/**
 * The person pinned a build of the history to the board (the window sends only its id): main stars it, so it is
 * never let go, keeps its picture in the board's `pictures/` and pins a card that holds a copy of what the entry
 * says. Resolves with the board, or why it is not pinned. Removing the card later leaves the star.
 */
export async function pinBuild(deps: PinBuildDeps, objectId: string, historyId: string): Promise<BoardFile | { refused: string }> {
  const obj = deps.object(objectId)
  if (!obj) return { refused: 'That project is not open.' }
  if (typeof historyId !== 'string' || !HISTORY_ID.test(historyId)) return { refused: 'A build is named by its id, as h41.' }
  const entry = (await readHistory(obj.dir)).find((e) => e.id === historyId)
  if (!entry) return { refused: `${historyId} is not a build the history keeps.` }
  if (!(await deps.history.star(obj, entry.id, true)) && entry.starred !== true) return { refused: `${historyId} could not be starred, so it is not pinned.` }
  let picture: string | undefined
  const thumb = entry.thumb ? await readHistoryThumb(obj.dir, entry.id) : null
  if (thumb) {
    // A picture that cannot be kept is no reason to leave the build off the board.
    picture = await savePicture(obj.dir, new Uint8Array(thumb)).catch((e) => {
      if (e instanceof Refusal) return undefined
      throw e
    })
  }
  const copy = { id: entry.id, line: entry.line, cause: entry.cause ?? 'unknown', sources: entry.sources }
  let refused: string | undefined
  const board = await deps.board.torno(objectId, (current) => {
    const pinned = pin(current, { kind: 'build', copy, ...(picture !== undefined ? { picture } : {}) })
    if ('refused' in pinned) {
      refused = pinned.refused
      return null
    }
    return pinned
  })
  return refused === undefined ? board : { refused }
}
