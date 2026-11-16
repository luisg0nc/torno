import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { type BoardAttach, type BoardFile, type BoardOpen, CARD_ID, MAX_CARDS, type PersonChange, type PinWhat } from '../../shared/board'
import { type SavedView, findView } from '../../shared/views'
import type { ObjectInfo } from '../../shared/workspace'
import { Refusal } from '../refusal'
import { listReferences, readReference } from '../sessions/reference'
import { readBrief } from './live'
import { readPicture, savePicture } from './pictures'
import { pin } from './sources'
import type { BoardStore } from './store'

// What the window may ask of the board, as handlers that do not need Electron (`main/ipc.ts` registers them).
// The window names a project, never a folder; an id, an author or `hidden` is never taken from it (the store's `person`).

export interface BoardIpcDeps {
  board: Pick<BoardStore, 'read' | 'person' | 'torno' | 'problem' | 'dismissProblem'>
  /** A project of the open workspace. */
  object(objectId: string): ObjectInfo | undefined
  /** Pins a build of the history (`pinBuild`): main stars it and keeps its picture. */
  pinBuild(objectId: string, historyId: string): Promise<BoardFile | { refused: string }>
  /** The views saved of a project, as its scene file has them: a view is pinned only when it is one of them. */
  views(objectId: string): Promise<readonly SavedView[]>
  /** Has the system open a file of the project in the person's own program, or show it in its folder. The path is main's. */
  show(how: 'open' | 'reveal', path: string): void | Promise<void>
}

const NOT_OPEN = 'That project is not open.'

/** What the window says goes with a prompt of the board (`ids` of cards and frames, or all of it), or why it is not one. Nothing of what is on the board comes from the window. */
export function boardAttachOf(raw: unknown): BoardAttach | string {
  const ids = (raw as { ids?: unknown } | null)?.ids
  if (ids === 'all') return { ids: 'all' }
  if (!Array.isArray(ids) || ids.length > MAX_CARDS || !ids.every((id) => typeof id === 'string' && CARD_ID.test(id))) return 'That is not part of a board.'
  return { ids: [...new Set(ids as string[])] }
}

export function boardHandlers(deps: BoardIpcDeps) {
  const open = (objectId: unknown): { id: string; obj: ObjectInfo } => {
    const obj = typeof objectId === 'string' ? deps.object(objectId) : undefined
    if (!obj) throw new Refusal(NOT_OPEN)
    return { id: obj.id, obj }
  }

  return {
    async read(objectId: string): Promise<BoardFile> {
      return deps.board.read(open(objectId).id)
    },

    async change(objectId: string, change: PersonChange): Promise<BoardFile> {
      const { id } = open(objectId)
      if (typeof change !== 'object' || change === null || typeof (change as { op?: unknown }).op !== 'string') throw new Refusal('That is not a change the board takes.')
      return deps.board.person(id, change)
    },

    /** What was wrong with the board file of the project when it was read, as a sentence, or null. Answers the same until it is dismissed. */
    async problem(objectId: string): Promise<string | null> {
      return deps.board.problem(open(objectId).id)
    },

    async dismissProblem(objectId: string): Promise<void> {
      return deps.board.dismissProblem(open(objectId).id)
    },

    async picture(objectId: string, name: string): Promise<Uint8Array | null> {
      const { obj } = open(objectId)
      return typeof name === 'string' ? readPicture(obj.dir, name) : null
    },

    /** The text of the project's `brief.md` (the first `MAX_TEXT_CHARS` characters), or null when there is none. Read-only: the board never writes it. */
    async brief(objectId: string): Promise<string | null> {
      const { obj } = open(objectId)
      return (await readBrief(obj.dir)) ?? null
    },

    /** A photo or doodle of the project's `reference/`, by the name its card has (`reference/photo-1.jpg`); null for any other file. */
    async reference(objectId: string, file: string): Promise<{ mediaType: string; bytes: Uint8Array } | null> {
      const { obj } = open(objectId)
      return readReference(obj.dir, file)
    },

    /** Keeps a picture the person gave (dropped, pasted, drawn) under a name of main's own, and answers with the name. */
    async addPicture(objectId: string, bytes: Uint8Array): Promise<string> {
      const { obj } = open(objectId)
      if (!(bytes instanceof Uint8Array)) throw new Refusal('That is not a picture torno can keep.')
      return savePicture(obj.dir, bytes)
    },

    /** The brief opened in the person's program, or a file of `reference/` shown in its folder. The window names which; the paths are main's. */
    async open(objectId: string, what: BoardOpen): Promise<void> {
      const { obj } = open(objectId)
      if (typeof what !== 'object' || what === null) throw new Refusal('That is not something the board opens.')
      if (what.kind === 'brief') {
        const path = join(obj.dir, 'brief.md')
        if (!existsSync(path) || !lstatSync(path).isFile()) throw new Refusal('There is no brief.md in this project.')
        return void (await deps.show('open', path))
      }
      if (what.kind === 'reference' && typeof what.file === 'string' && /^reference\/[^/]+$/.test(what.file) && listReferences(obj.dir).includes(what.file.slice('reference/'.length))) {
        return void (await deps.show('reveal', join(obj.dir, what.file)))
      }
      throw new Refusal('That is not something the board opens.')
    },

    /** Pins what the project has to the board; why not, as a value, when it cannot be. */
    async pin(objectId: string, what: PinWhat): Promise<BoardFile | { refused: string }> {
      const obj = typeof objectId === 'string' ? deps.object(objectId) : undefined
      if (!obj) return { refused: NOT_OPEN }
      if (typeof what !== 'object' || what === null) return { refused: 'That is not something the board takes.' }
      if (what.kind === 'build') return deps.pinBuild(obj.id, String(what.id))
      if (what.kind !== 'view' && what.kind !== 'params' && what.kind !== 'checks') return { refused: 'That is not something the board takes.' }
      // A view is one of the saved ones, and its card keeps the layout it is of.
      let layout: string | undefined
      let name = ''
      if (what.kind === 'view') {
        const found = typeof what.name === 'string' ? findView(await deps.views(obj.id).catch(() => []), what.name) : undefined
        if (!found) return { refused: typeof what.name === 'string' && what.name !== '' ? `There is no saved view named "${what.name.slice(0, 60)}", so it is not pinned.` : 'A view is pinned by its name.' }
        layout = found.layout
        name = found.name
      }
      let refused: string | undefined
      const board = await deps.board.torno(obj.id, (current) => {
        const pinned = pin(current, what.kind === 'view' ? { kind: 'view', name, ...(layout !== undefined ? { layout } : {}) } : { kind: what.kind })
        if ('refused' in pinned) {
          refused = pinned.refused
          return null
        }
        return pinned
      })
      return refused === undefined ? board : { refused }
    }
  }
}

export type BoardHandlers = ReturnType<typeof boardHandlers>
