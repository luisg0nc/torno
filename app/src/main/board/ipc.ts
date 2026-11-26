import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { type BoardAttach, type BoardFile, type BoardOpen, CARD_ID, MAX_CARDS, firstLink, linksIn, type PersonChange, type PinWhat } from '../../shared/board'
import { type SavedView, findView } from '../../shared/views'
import type { ObjectInfo } from '../../shared/workspace'
import type { Seen } from '../../shared/brief'
import { Refusal } from '../refusal'
import { listBoardReferences, readReference } from '../sessions/reference'
import { readBrief } from './live'
import { readPicture, savePicture } from './pictures'
import { pin } from './sources'
import type { BoardStore } from './store'
import type { Ties } from './ties'

// What the window may ask of the board, as handlers that do not need Electron (`main/ipc.ts` registers them).
// The window names a project, never a folder; an id, an author or `hidden` is never taken from it (the store's `person`).

export interface BoardIpcDeps {
  board: Pick<BoardStore, 'read' | 'person' | 'torno' | 'problem' | 'dismissProblem' | 'aside' | 'useAside' | 'undoAside' | 'letGoAside' | 'seen' | 'markSeen'>
  /** Keeps dimensions and the sizes that tie them saying the same thing (`ties.ts`). Absent: nothing is tied. */
  ties?: Pick<Ties, 'tie' | 'untie' | 'reconcile'>
  /** A project of the open workspace. */
  object(objectId: string): ObjectInfo | undefined
  /** Pins a build of the history (`pinBuild`): main stars it and keeps its picture. */
  pinBuild(objectId: string, historyId: string): Promise<BoardFile | { refused: string }>
  /** The views saved of a project, as its scene file has them: a view is pinned only when it is one of them. */
  views(objectId: string): Promise<readonly SavedView[]>
  /** Has the system open a file of the project in the person's own program, or show it in its folder. The path is main's. */
  show(how: 'open' | 'reveal', path: string): void | Promise<void>
  /** Has the system open an address in the person's browser (`shell.openExternal`). Only ever given an `http` or `https` one. */
  openExternal(url: string): void | Promise<void>
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
      const { id } = open(objectId)
      // A pull may have brought a board or marks that no longer agree: seen when the project is read.
      await deps.ties?.reconcile(id).catch(() => {})
      return deps.board.read(id)
    },

    async change(objectId: string, change: PersonChange): Promise<BoardFile> {
      const { id } = open(objectId)
      if (typeof change !== 'object' || change === null || typeof (change as { op?: unknown }).op !== 'string') throw new Refusal('That is not a change the board takes.')
      const board = await deps.board.person(id, change)
      // A size changed or taken off, or put back: the dimension it ties follows.
      if (change.op === 'edit' || change.op === 'remove' || change.op === 'restore') await deps.ties?.reconcile(id).catch(() => {})
      return deps.ties ? deps.board.read(id) : board
    },

    /** Ties a size to a dimension (`markId`, with a `tolerance` of the person's choosing), or takes the tie off (`markId` null). Rejects with why not. */
    async tie(objectId: string, cardId: string, markId: string | null, tolerance?: number): Promise<BoardFile> {
      const { id } = open(objectId)
      if (!deps.ties) throw new Refusal('Sizes cannot be tied here.')
      if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) throw new Refusal('That is not a card of the board.')
      if (markId === null) return deps.ties.untie(id, cardId, 'person')
      if (typeof markId !== 'string' || !/^M[1-9]\d*$/.test(markId)) throw new Refusal('That is not a mark of the project.')
      if (tolerance !== undefined && (typeof tolerance !== 'number' || !Number.isFinite(tolerance))) throw new Refusal('The tolerance is a number.')
      return deps.ties.tie(id, cardId, markId, 'person', tolerance)
    },

    /** What was wrong with the board file of the project when it was read, as a sentence, or null. Answers the same until it is dismissed. */
    async problem(objectId: string): Promise<string | null> {
      return deps.board.problem(open(objectId).id)
    },

    async dismissProblem(objectId: string): Promise<void> {
      return deps.board.dismissProblem(open(objectId).id)
    },

    /** What the person had seen of Claude's cards when they last had the Brief on screen (#340); null when nothing is kept. */
    async seen(objectId: string): Promise<Seen | null> {
      return deps.board.seen(open(objectId).id)
    },

    /** The person has seen the brief as it is now: main keeps a hash of each card of Claude's, from its own board. */
    async markSeen(objectId: string): Promise<Seen> {
      return deps.board.markSeen(open(objectId).id)
    },

    /** Whether a copy of the unreadable board file is kept aside and waits for the person. */
    async aside(objectId: string): Promise<boolean> {
      return deps.board.aside(open(objectId).id)
    },

    /** The person puts the copy kept aside back as the board. Rejects with a `Refusal` while it cannot be read whole. */
    async useAside(objectId: string, replace?: boolean): Promise<BoardFile | { made: number }> {
      return deps.board.useAside(open(objectId).id, replace === true)
    },

    /** The person takes back the last put back, while the brief is as it left it. */
    async undoAside(objectId: string): Promise<BoardFile> {
      return deps.board.undoAside(open(objectId).id)
    },

    /** The person lets the copy kept aside go. */
    async letGoAside(objectId: string): Promise<void> {
      return deps.board.letGoAside(open(objectId).id)
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
      if (what.kind === 'reference' && typeof what.file === 'string' && /^reference\/[^/]+$/.test(what.file) && listBoardReferences(obj.dir).includes(what.file.slice('reference/'.length))) {
        return void (await deps.show('reveal', join(obj.dir, what.file)))
      }
      throw new Refusal('That is not something the board opens.')
    },

    /** The first link of a text card, opened in the person's browser. The window names the card; the card is read from the store, and only `http` and `https` go. */
    async openLink(objectId: string, cardId: string, nth = 0): Promise<void> {
      const { id, obj } = open(objectId)
      if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) throw new Refusal('That is not a card of the board.')
      if (!Number.isSafeInteger(nth) || nth < 0) throw new Refusal('That is not a link of the card.')
      const card = (await deps.board.read(id)).cards.find((c) => c.id === cardId)
      if (!card) throw new Refusal('That card is not on the board.')
      // The brief's card opens the nth address of brief.md as main reads it now (`linksIn`, as the page numbers them); a text card its first.
      const brief = card.kind === 'brief' ? await readBrief(obj.dir) : undefined
      const link = card.kind === 'text' && card.text !== undefined && nth === 0 ? firstLink(card.text) : brief !== undefined ? (linksIn(brief)[nth] ?? null) : null
      let url: URL | undefined
      try {
        url = link === null ? undefined : new URL(link)
      } catch {
        url = undefined
      }
      if (link === null || !url || (url.protocol !== 'http:' && url.protocol !== 'https:')) throw new Refusal('There is no web address on that card to open.')
      await deps.openExternal(link)
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
