import { checkSize } from '../../shared/size'
import { type AgentChange, type Arrow, type BoardFile, type Card, type CardTurn, type PersonChange, CARD_ID, MADE_KINDS, MAX_CARDS, MAX_NAME_CHARS, MAX_TEXT_CHARS, MAX_WAS, PICTURE_NAME } from '../../shared/board'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FOLDER, ownTorno, writeOwn } from '../own'
import { ensureIgnored } from '../ignored'
import { Refusal } from '../refusal'
import { dropPictures } from './dropped'
import { asideText, diskText, loadBoardFile, nextAbove, readBoardFile, removeAside, saveBoardFile, textOf } from './file'
import { MADE_SIZE, freeSpot, freeSpotBelow } from './place'
import { type LiveFacts, boardLine } from './text'

interface BoardEvents {
  /** The board of a project changed: the whole board, as it now is. */
  changed: { objectId: string; board: BoardFile }
  /** Something about a project's board file the person should know, as a sentence. Said once; `problem()` answers it afterwards. */
  problem: { objectId: string; message: string; /** A copy of the file was kept aside, and `useAside` and `letGoAside` deal with it. */ aside?: true }
}

const TOLD = 'told.json'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function checkedText(text: unknown, max: number, what: string): string {
  if (typeof text !== 'string') throw new Refusal(`The ${what} must be text.`)
  if (text.length > max) throw new Refusal(`The ${what} is ${text.length} characters long, and a board keeps at most ${max}.`)
  return text
}

/** A size the person says, as a size card keeps it: whole, or a `Refusal` that says what is not. */
function checkedSize(raw: unknown): NonNullable<Card['size']> {
  const size = checkSize(raw, 'person')
  if (typeof size === 'string') throw new Refusal(size)
  return size
}

function checkedFrame(board: BoardFile, frame: unknown, of: Card | { kind: Card['kind']; id?: string }): string {
  if (typeof frame !== 'string' || !CARD_ID.test(frame)) throw new Refusal('A frame is named by its id.')
  const found = board.cards.find((c) => c.id === frame)
  if (!found || found.kind !== 'frame') throw new Refusal(`${frame} is not a frame of this board.`)
  if (of.id === frame) throw new Refusal('A card cannot be in itself.')
  if (of.kind === 'frame') throw new Refusal('A frame cannot be in another frame.')
  return frame
}

const cardOf = (board: BoardFile, id: unknown): Card => {
  const card = typeof id === 'string' ? board.cards.find((c) => c.id === id) : undefined
  if (!card) throw new Refusal(`There is no card ${String(id)} on this board.`)
  return card
}

const give = (board: BoardFile): string => `C${board.next++}`

/** Takes a card and the arrows that touch it off the board, and its cards out of it when it is a frame. */
function drop(board: BoardFile, id: string): void {
  board.cards = board.cards.filter((c) => c.id !== id)
  board.arrows = board.arrows.filter((a) => a.from !== id && a.to !== id)
  for (const c of board.cards) if (c.frame === id) delete c.frame
}

/** The pictures a list of cards shows. */
const picturesOf = (cards: readonly Card[]): Set<string> => new Set(cards.flatMap((c) => (c.picture === undefined ? [] : [c.picture])))

/** What main took off a board in this run: the cards and arrows as they were, by id. */
type Removed = Map<string, Card | Arrow>

const isArrow = (thing: Card | Arrow): thing is Arrow => 'from' in thing

/** How many things taken off a board `restore` can bring back: the last this many. */
export const REMOVED_KEPT = 200

/**
 * What the person asked, done to `board` (a copy of the file). Throws a `Refusal` and the copy is thrown away.
 * Nothing the window says is taken for an id, an author or `hidden`: those are main's.
 */
function applyPerson(board: BoardFile, change: PersonChange, removed: Removed, at: string): void {
  switch (change.op) {
    case 'add': {
      const said = change.card as Partial<Card> | undefined
      if (!said || !MADE_KINDS.includes(said.kind as Card['kind'])) throw new Refusal('The board takes a text, a picture, a doodle, a frame or a size from the person.')
      if (board.cards.length >= MAX_CARDS) throw new Refusal(`The board holds ${MAX_CARDS} cards, and that is all it takes.`)
      const { kind, x, y, w, h } = said
      if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w <= 0 || h <= 0) throw new Refusal('A card needs a place and a size.')
      const card: Card = { id: give(board), kind: kind as Card['kind'], x, y, w, h, by: 'person', at }
      if (kind === 'text') card.text = checkedText(said.text ?? '', MAX_TEXT_CHARS, 'text')
      if (kind === 'frame') card.name = checkedText(said.name ?? '', MAX_NAME_CHARS, 'name')
      if (kind === 'size') card.size = checkedSize(said.size)
      if (kind === 'picture' || kind === 'sketch') {
        if (typeof said.picture !== 'string' || !PICTURE_NAME.test(said.picture)) throw new Refusal('A picture card names a picture torno kept.')
        card.picture = said.picture
        if (said.caption !== undefined && said.caption !== '') card.caption = checkedText(said.caption, MAX_TEXT_CHARS, 'caption')
      }
      if (said.frame !== undefined) card.frame = checkedFrame(board, said.frame, card)
      board.cards.push(card)
      return
    }
    case 'move': {
      const moved = new Set(change.moves.map((m) => m.id))
      for (const move of change.moves) {
        const card = board.cards.find((c) => c.id === move.id)
        if (!card) continue
        if (!finite(move.x) || !finite(move.y)) throw new Refusal('A card is moved to a place.')
        for (const size of [move.w, move.h]) if (size !== undefined && (!finite(size) || size <= 0)) throw new Refusal('A card is never given a size of nothing.')
        const frame = move.frame === undefined || move.frame === null ? move.frame : checkedFrame(board, move.frame, card)
        const dx = move.x - card.x
        const dy = move.y - card.y
        // What is in a frame goes with it, unless it is moved on its own account in the same change.
        if (card.kind === 'frame' && (dx !== 0 || dy !== 0)) {
          for (const inside of board.cards) {
            if (inside.frame === card.id && !moved.has(inside.id)) {
              inside.x += dx
              inside.y += dy
            }
          }
        }
        card.x = move.x
        card.y = move.y
        if (move.w !== undefined) card.w = move.w
        if (move.h !== undefined) card.h = move.h
        if (frame === null) delete card.frame
        else if (frame !== undefined) card.frame = frame
      }
      return
    }
    case 'edit': {
      const card = cardOf(board, change.id)
      if (card.by !== 'person') throw new Refusal(`${card.id} is not the person's, and its words are not theirs to change here.`)
      const before = JSON.stringify(card)
      if (change.picture !== undefined) {
        // A sketch drawn on again: the file is one torno kept (`board:addPicture`), and it is the only card whose picture is the person's to change.
        if (card.kind !== 'sketch') throw new Refusal(`${card.id} is not a doodle, and its picture is not changed here.`)
        if (typeof change.picture !== 'string' || !PICTURE_NAME.test(change.picture)) throw new Refusal('A doodle names a picture torno kept.')
        card.picture = change.picture
      }
      if (change.size !== undefined) {
        if (card.kind !== 'size') throw new Refusal(`${card.id} is not a size card, and has no size to change.`)
        // What the person edits is the size; the tie to a dimension is main's (`ties.ts`) and stays.
        card.size = { ...checkedSize(change.size), ...(card.size?.tie ? { tie: card.size.tie } : {}) }
      }
      if (change.text !== undefined) card.text = checkedText(change.text, MAX_TEXT_CHARS, 'text')
      if (change.name !== undefined) card.name = checkedText(change.name, MAX_NAME_CHARS, 'name')
      if (change.caption !== undefined) {
        const caption = checkedText(change.caption, MAX_TEXT_CHARS, 'caption')
        if (caption === '') delete card.caption
        else card.caption = caption
      }
      // Changed when it says something else: an edit that changes nothing is no change, and writes nothing.
      if (JSON.stringify(card) !== before) card.at = at
      return
    }
    case 'remove': {
      for (const id of new Set(change.ids)) {
        const card = board.cards.find((c) => c.id === id)
        if (!card) continue
        // A card that appeared by itself is hidden, not lost: the thing it shows is untouched and may be brought back.
        if (card.by === 'torno') card.hidden = true
        else drop(board, id)
      }
      return
    }
    case 'unhide': {
      const card = board.cards.find((c) => c.id === change.id)
      if (card) delete card.hidden
      return
    }
    case 'arrow': {
      cardOf(board, change.from)
      cardOf(board, change.to)
      if (change.from === change.to) throw new Refusal('An arrow goes from one card to another.')
      const arrow: Arrow = { id: give(board), from: change.from, to: change.to, by: 'person' }
      if (change.label !== undefined && change.label !== '') arrow.label = checkedText(change.label, MAX_NAME_CHARS, 'word on the arrow')
      board.arrows.push(arrow)
      return
    }
    case 'unarrow': {
      board.arrows = board.arrows.filter((a) => a.id !== change.id)
      return
    }
    case 'restore': {
      const used = new Set([...board.cards.map((c) => c.id), ...board.arrows.map((a) => a.id)])
      // Only what main took off this board in this run, by the id it had: undo puts back what was there, nothing new, and nothing the window describes.
      const asked = new Set(Array.isArray(change.ids) ? change.ids.filter((id): id is string => typeof id === 'string') : [])
      const added: Card[] = []
      for (const id of asked) {
        const card = removed.get(id)
        if (!card || isArrow(card) || used.has(id) || board.cards.length + added.length >= MAX_CARDS) continue
        used.add(id)
        added.push(structuredClone(card))
      }
      // Each in a frame that is there: on the board, or put back with it.
      for (;;) {
        const frames = new Set([...board.cards, ...added].filter((c) => c.kind === 'frame' && c.frame === undefined).map((c) => c.id))
        const kept = added.filter((c) => c.frame === undefined || frames.has(c.frame))
        if (kept.length === added.length) break
        for (const gone of added) if (!kept.includes(gone)) used.delete(gone.id)
        added.length = 0
        added.push(...kept)
      }
      board.cards.push(...added)
      const there = new Set(board.cards.map((c) => c.id))
      for (const id of asked) {
        const arrow = removed.get(id)
        if (!arrow || !isArrow(arrow) || used.has(id) || !there.has(arrow.from) || !there.has(arrow.to)) continue
        used.add(id)
        board.arrows.push({ ...arrow })
      }
      return
    }
    default:
      throw new Refusal('That is not a change the board takes.')
  }
}

/** What the agent's change did, besides the board: the ids it was given, and where the card went when the frame had no room. */
export interface AgentResult {
  board: BoardFile
  /** The card added, or the card changed or removed. */
  id?: string
  /** The frame the card is in or was asked to be in: made now when `made`. */
  frame?: { id: string; name: string; made: boolean }
  /** The frame that had no free spot: the card is just below it, not in it. */
  below?: string
  /** The arrow drawn. */
  arrow?: string
}

const ownerOf = (card: { by: Card['by'] }): string => (card.by === 'person' ? "the person's" : "torno's own")

/** The card or arrow of `id`, when it is the agent's; a `Refusal` that says whose it is when it is not, or that there is none. */
function ownOf(board: BoardFile, id: string): { card: Card } | { arrow: Arrow } {
  const arrow = board.arrows.find((a) => a.id === id)
  const card = arrow ? undefined : cardOf(board, id)
  const thing = arrow ?? (card as Card)
  if (thing.by !== 'agent') throw new Refusal(`${id} is ${ownerOf(thing)}, not yours: you may change and remove only the cards and arrows you made.`)
  return arrow ? { arrow } : { card: card as Card }
}

/** The frame an added card is asked to be in, by name (without regard to case) or by id: one that is not there is made, the agent's. */
function frameFor(board: BoardFile, said: unknown): { frame: Card; made: boolean } {
  if (typeof said !== 'string' || said.trim() === '') throw new Refusal('A frame is named by its name or its id.')
  const asked = said.trim()
  if (CARD_ID.test(asked)) {
    const found = shown(board, asked)
    if (found.kind !== 'frame') throw new Refusal(`${asked} is not a frame of this board.`)
    return { frame: found, made: false }
  }
  const found = board.cards.find((c) => c.kind === 'frame' && !c.hidden && (c.name ?? '').trim().toLowerCase() === asked.toLowerCase())
  if (found) return { frame: found, made: false }
  if (board.cards.length >= MAX_CARDS - 1) throw new Refusal(`The board holds ${MAX_CARDS} cards, and that is all it takes.`)
  const name = checkedText(asked, MAX_NAME_CHARS, 'name of the frame')
  const spot = freeSpot(board.cards, MADE_SIZE.frame) as { x: number; y: number }
  const frame: Card = { id: give(board), kind: 'frame', ...spot, ...MADE_SIZE.frame, by: 'agent', name }
  board.cards.push(frame)
  return { frame, made: true }
}

/** A card that is on the board to be seen: a hidden card is not. */
const shown = (board: BoardFile, id: unknown): Card => {
  const card = cardOf(board, id)
  if (card.hidden) throw new Refusal(`There is no card ${card.id} on this board.`)
  return card
}

/**
 * What the agent asked, done to `board` (a copy of the file). Throws a `Refusal` and the copy is thrown away. It only
 * ever makes cards and arrows of its own, in a place main finds, and changes or removes only those: an id, an author,
 * a place and `hidden` are never its to say.
 */
function applyAgent(board: BoardFile, change: AgentChange, stamp: { at: string; turn?: CardTurn }): Omit<AgentResult, 'board'> {
  switch (change.op) {
    case 'add': {
      const said = change as Extract<AgentChange, { op: 'add' }>
      const hasText = typeof said.text === 'string' && said.text !== ''
      const hasPicture = said.picture !== undefined
      const hasSize = said.size !== undefined
      if (hasSize && (hasText || hasPicture)) throw new Refusal('A size card holds a size alone, not with text or a picture.')
      if (!hasText && !hasPicture && !hasSize) throw new Refusal('A card holds some text, a size or a picture.')
      let fact: ReturnType<typeof checkSize> | undefined
      if (hasSize) {
        fact = checkSize(said.size, 'agent')
        if (typeof fact === 'string') throw new Refusal(fact)
      }
      if (hasPicture && (typeof said.picture !== 'string' || !PICTURE_NAME.test(said.picture))) throw new Refusal('A picture card names a picture torno kept.')
      const words = hasText ? checkedText(said.text, MAX_TEXT_CHARS, hasPicture ? 'caption' : 'text') : undefined
      let end: { named: 'from' | 'to'; id: string } | undefined
      if (said.arrow !== undefined) {
        const { from, to, label } = said.arrow
        if ((from === undefined) === (to === undefined)) throw new Refusal('An arrow has one end named, a card that is on the board: the new card is the other end.')
        end = { named: from === undefined ? 'to' : 'from', id: shown(board, from ?? to).id }
        if (label !== undefined && label !== '') checkedText(label, MAX_NAME_CHARS, 'word on the arrow')
      }
      if (board.cards.length >= MAX_CARDS) throw new Refusal(`The board holds ${MAX_CARDS} cards, and that is all it takes.`)
      const out: Omit<AgentResult, 'board'> = {}
      const into = said.frame === undefined ? undefined : frameFor(board, said.frame)
      if (into) out.frame = { id: into.frame.id, name: into.frame.name ?? '', made: into.made }
      const size = hasPicture ? MADE_SIZE.picture : hasSize ? MADE_SIZE.size : MADE_SIZE.text
      let spot = into ? freeSpot(board.cards, size, into.frame) : freeSpot(board.cards, size)
      if (spot === null) {
        spot = freeSpotBelow(board.cards, size, into!.frame)
        out.below = into!.frame.id
      }
      const card: Card = { id: give(board), kind: hasPicture ? 'picture' : hasSize ? 'size' : 'text', ...spot, ...size, by: 'agent', ...(stamp.turn ? { turn: { ...stamp.turn } } : {}), at: stamp.at }
      if (typeof fact === 'object') card.size = fact
      else if (hasPicture) {
        card.picture = said.picture
        if (words !== undefined) card.caption = words
        if (said.camera !== undefined) card.camera = structuredClone(said.camera)
      } else card.text = words
      if (into && out.below === undefined) card.frame = into.frame.id
      board.cards.push(card)
      out.id = card.id
      if (end) {
        const arrow: Arrow = { id: give(board), from: end.named === 'from' ? end.id : card.id, to: end.named === 'from' ? card.id : end.id, by: 'agent' }
        const label = said.arrow?.label
        if (label !== undefined && label !== '') arrow.label = label
        board.arrows.push(arrow)
        out.arrow = arrow.id
      }
      return out
    }
    case 'edit': {
      const own = ownOf(board, change.id)
      if (!('card' in own)) throw new Refusal(`${change.id} is an arrow: take it down and draw it again.`)
      const { card } = own
      const before = card.kind === 'text' ? card.text : card.kind === 'frame' ? card.name : card.caption
      if (card.kind === 'text') card.text = checkedText(change.text, MAX_TEXT_CHARS, 'text')
      else if (card.kind === 'frame') {
        const name = checkedText(change.text, MAX_NAME_CHARS, 'name').trim()
        if (name === '') throw new Refusal('A frame has a name.')
        card.name = name
      } else if (card.kind === 'picture' || card.kind === 'sketch') {
        const caption = checkedText(change.text, MAX_TEXT_CHARS, 'caption')
        if (caption === '') delete card.caption
        else card.caption = caption
      } else throw new Refusal(`${card.id} shows ${card.kind}, and its words are not changed here.`)
      const after = card.kind === 'text' ? card.text : card.kind === 'frame' ? card.name : card.caption
      // Its words changed: what they were is kept, with the prompt and time they were written in, and the card is now of this prompt.
      if (after !== before) {
        card.was = [...(card.was ?? []), { text: before ?? '', ...(card.turn ? { turn: card.turn } : {}), ...(card.at ? { at: card.at } : {}) }].slice(-MAX_WAS)
        if (stamp.turn) card.turn = { ...stamp.turn }
        else delete card.turn
        card.at = stamp.at
      }
      return { id: card.id }
    }
    case 'remove': {
      const own = ownOf(board, change.id)
      if ('arrow' in own) {
        board.arrows = board.arrows.filter((a) => a.id !== change.id)
        return { id: change.id }
      }
      // An arrow of the person's to or from the card is theirs, and would go with it: the card stays.
      const theirs = board.arrows.find((a) => (a.from === change.id || a.to === change.id) && a.by !== 'agent')
      if (theirs) throw new Refusal(`${theirs.id} is the person's arrow, ${theirs.from === change.id ? 'from' : 'to'} ${change.id}: ${change.id} stays until they take it down.`)
      const others = board.cards.filter((c) => c.frame === change.id && c.by !== 'agent')
      if (others.length > 0) throw new Refusal(`${change.id} holds ${others.map((c) => c.id).join(', ')}, which are not yours: a frame of yours comes down only when it holds your own cards alone.`)
      drop(board, change.id)
      return { id: change.id }
    }
    default:
      throw new Refusal('That is not a change the board takes.')
  }
}

/**
 * The boards of the projects of the open workspace, and the only writer of their `.torno/board/board.json`. A
 * board is read once and then kept in memory; what is done to it is done one thing at a time per project, each
 * change written before it is told. Every method rejects for a project whose folder is not known.
 */
export class BoardStore {
  /** By project folder: the board as last read or written. */
  private files = new Map<string, BoardFile>()
  /** By project folder: the text of the board file as main last read or wrote it (null: no file, or none it may read). A file that is other than this was changed from outside. */
  private disk = new Map<string, string | null>()
  /** By project folder: what was taken off its board in this run (the last `REMOVED_KEPT`), which `restore` may bring back. */
  private removed = new Map<string, Removed>()
  /** By project folder: what was wrong with its board file when it was read, until it is dismissed. */
  private problems = new Map<string, string>()
  /** By project folder: the name of the copy of the board file kept aside when it was read (`board.json.corrupt-…`), until it is put back, let go, or the problem is dismissed. */
  private asides = new Map<string, string>()
  /** By project folder: the last `useAside`, for `undoAside`: the board as it was, the text it wrote, and the copy's name and text. */
  private putBack = new Map<string, { before: BoardFile; put: string; name: string; copy: string }>()
  /** By project folder: the last thing asked of its board, which the next waits for. */
  private turns = new Map<string, Promise<unknown>>()
  /** Counts `forget`: what was read before one is not kept after it, and what waited out one is not told. */
  private epoch = 0
  private listeners: { [E in keyof BoardEvents]: Array<(e: BoardEvents[E]) => void> } = { changed: [], problem: [] }

  constructor(private deps: { dirOf(objectId: string): string | undefined; /** What a card shows of the project besides the board (`liveFacts`), for `markAllTold`: none, and a card of the marks, Params or checks is then told as if there were nothing to show. */ live?(objectId: string): Promise<LiveFacts>; /** The clock a card's `at` is read from: the system's when none is given. */ now?(): Date }) {}

  private stamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  on<E extends keyof BoardEvents>(event: E, cb: (e: BoardEvents[E]) => void): void {
    this.listeners[event].push(cb)
  }

  /** Forget what was read, as when the workspace is left. Files are read again when next asked for. */
  forget(): void {
    this.epoch += 1
    this.files.clear()
    this.disk.clear()
    this.removed.clear()
    this.problems.clear()
    this.asides.clear()
    this.putBack.clear()
  }

  /**
   * What was wrong with the board file of a project when it was read, as a sentence, or null. It is told once as a
   * `problem` event, to whoever listens then; this is for whoever did not, and answers the same until `dismissProblem`.
   */
  problem(objectId: string): Promise<string | null> {
    return this.turn(objectId, (_file, dir) => this.problems.get(dir) ?? null)
  }

  /**
   * Runs `task` in the turn of the project's board, so that no change lands meanwhile, with the files the board names:
   * those of its cards (`live`) and of what was taken off it in this run (`kept`: an undo brings those back), and what
   * was wrong with the file.
   */
  withPictures<T>(objectId: string, task: (held: { live: Set<string>; kept: Set<string> }, dir: string, problem: string | null) => Promise<T>): Promise<T> {
    return this.turn(objectId, (file, dir) => {
      const live = picturesOf(file.cards)
      const kept = picturesOf([...(this.removed.get(dir)?.values() ?? [])].filter((t): t is Card => !isArrow(t)))
      return task({ live, kept }, dir, this.problems.get(dir) ?? null)
    })
  }

  /** The person has read what was wrong with the board file of a project. The copy kept aside stays where it is. */
  dismissProblem(objectId: string): Promise<void> {
    return this.turn(objectId, (_file, dir) => {
      this.problems.delete(dir)
      this.asides.delete(dir)
    })
  }

  /** Whether the board file of the project was kept aside when it was read, and the person has neither put it back nor let it go nor dismissed the notice. */
  aside(objectId: string): Promise<boolean> {
    return this.turn(objectId, (_file, dir) => this.asides.has(dir))
  }

  /**
   * Puts the copy kept aside in the place of the board: for a copy the person mended in their editor. It must read whole
   * (every card and arrow), otherwise a `Refusal` says so and nothing changes. It loses nothing without being told to: when
   * the board holds cards that are not main's own (the person's, the agent's) and `replace` is not true, it changes nothing
   * and answers how many (`made`). Replaced, the copy is deleted and the notice with it, the window is told, ids go on above
   * those of both boards, and `undoAside` brings the board back as it was.
   */
  useAside(objectId: string, replace = false): Promise<BoardFile | { made: number }> {
    return this.turn(objectId, async (current, dir, epoch) => {
      const name = this.asides.get(dir)
      if (name === undefined) throw new Refusal('There is no copy of the board file to put back.')
      const text = await asideText(dir, name)
      if (text === null) throw new Refusal(`The copy ${FOLDER}/board/${name} is not there any more, or is no plain file.`)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        // not JSON
      }
      const read = readBoardFile(parsed)
      if (!read || read.dropped > 0) throw new Refusal(`The copy ${FOLDER}/board/${name} still cannot be read whole. Mend it in your editor and try again.`)
      const made = current.cards.filter((c) => c.by !== 'torno').length
      if (made > 0 && !replace) return { made }
      const board: BoardFile = { ...read.file, next: nextAbove(Math.max(read.file.next, current.next), read.file.cards, read.file.arrows) }
      await saveBoardFile(dir, board)
      const gone = [...picturesOf(current.cards)].filter((picture) => !picturesOf(board.cards).has(picture))
      if (gone.length > 0) await dropPictures(dir, gone)
      await removeAside(dir, name)
      if (epoch === this.epoch) {
        this.files.set(dir, board)
        this.disk.set(dir, textOf(board))
        this.problems.delete(dir)
        this.asides.delete(dir)
        this.putBack.set(dir, { before: structuredClone(current), put: textOf(board), name, copy: text })
        for (const cb of this.listeners.changed) cb({ objectId, board: structuredClone(board) })
      }
      return structuredClone(board)
    })
  }

  /**
   * Takes back the last `useAside`: the board as it was, and the copy where it was kept (the notice does not come back).
   * Only while the board is still as the put back left it: once it changed, what was made since would be lost, so it is refused.
   */
  undoAside(objectId: string): Promise<BoardFile> {
    return this.turn(objectId, async (current, dir, epoch) => {
      const kept = this.putBack.get(dir)
      if (!kept) throw new Refusal('There is nothing to take back.')
      if (textOf(current) !== kept.put) throw new Refusal('The brief has changed since it was put back, so it is not taken back.')
      await ownTorno(dir, 'board')
      await writeOwn(dir, `board/${kept.name}`, kept.copy)
      await saveBoardFile(dir, kept.before)
      if (epoch === this.epoch) {
        this.files.set(dir, kept.before)
        this.disk.set(dir, textOf(kept.before))
        this.putBack.delete(dir)
        for (const cb of this.listeners.changed) cb({ objectId, board: structuredClone(kept.before) })
      }
      return structuredClone(kept.before)
    })
  }

  /** Deletes the copy kept aside and the notice: the pictures it named are then swept with the rest, in a later run. The board stays as it is. */
  letGoAside(objectId: string): Promise<void> {
    return this.turn(objectId, async (_file, dir) => {
      const name = this.asides.get(dir)
      if (name !== undefined) await removeAside(dir, name)
      this.asides.delete(dir)
      this.problems.delete(dir)
    })
  }

  /**
   * Looks at the board file again, for a watcher: when it is other than main last read or wrote (a git pull) it is
   * taken as the board and the window is told, with no change of anyone's. Never rejects for a file that cannot be read.
   */
  refresh(objectId: string): Promise<void> {
    return this.turn(objectId, async (current, dir, epoch) => {
      await this.takeDisk(objectId, dir, current, epoch)
    })
  }

  /** The board as it is now (a copy). */
  read(objectId: string): Promise<BoardFile> {
    return this.turn(objectId, (file) => structuredClone(file))
  }

  /** A change the person asked of their board. Resolves with the board, written, or rejects with a `Refusal` and changes nothing. */
  person(objectId: string, change: PersonChange): Promise<BoardFile> {
    return this.change(
      objectId,
      (board, removed) => {
        applyPerson(board, change, removed, this.stamp())
        return board
      },
      true
    )
  }

  /**
   * A change main makes of its own (the cards that appear by themselves, the pins): `edit` is given a copy of the
   * board and gives the board it should be, or null for no change.
   */
  torno(objectId: string, edit: (board: BoardFile) => BoardFile | null): Promise<BoardFile> {
    return this.change(objectId, (board) => edit(board))
  }

  /**
   * What Claude was last told of each card and arrow, as `saysHash` gave it (`.torno/board/told.json`, ignored by git).
   * Empty for a project that has none, or whose file cannot be read: everything is then news.
   */
  told(objectId: string): Promise<Record<string, string>> {
    return this.turn(objectId, async (_file, dir) => {
      try {
        const parsed: unknown = JSON.parse(await readFile(join(dir, FOLDER, 'board', TOLD), 'utf8'))
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
        return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'))
      } catch {
        return {}
      }
    })
  }

  /** Keeps what a prompt that has been delivered told of the board: in the turn of the board's changes, whole or not at all. */
  markTold(objectId: string, told: Record<string, string>): Promise<void> {
    return this.turn(objectId, async (_file, dir) => {
      await ownTorno(dir, 'board')
      // Ignored before it is there: a file written first is for a moment one that git would take.
      await ensureIgnored(dir, [`board/${TOLD}`])
      await writeOwn(dir, `board/${TOLD}`, `${JSON.stringify(told, null, 2)}\n`)
    })
  }

  /**
   * Counts everything on the board as told: the hashes the board line itself would keep (`boardLine`), written in the
   * board's turn, so that the line of the next prompt says no card is new. For a prompt that says what is on the board in
   * its own words (the first of a new project).
   */
  async markAllTold(objectId: string): Promise<void> {
    const live = (await this.deps.live?.(objectId).catch(() => undefined)) ?? { marks: new Map() }
    await this.turn(objectId, async (file, dir) => {
      await ownTorno(dir, 'board')
      await ensureIgnored(dir, [`board/${TOLD}`])
      await writeOwn(dir, `board/${TOLD}`, `${JSON.stringify(boardLine(file, {}, live).told, null, 2)}\n`)
    })
  }

  /**
   * A change the agent asked of the board through its tools: it makes cards and arrows of its own and changes or
   * removes those, and nothing of the person's or of main's own (`applyAgent`). Resolves with the board, written, and
   * what was done; or rejects with a `Refusal` and changes nothing. `turn` is the prompt the session is answering, main's
   * own (`Sessions.turnNow`): a card made or changed is stamped with it and the time.
   */
  async agent(objectId: string, change: AgentChange, turn?: CardTurn): Promise<AgentResult> {
    const stamp = { at: this.stamp(), ...(turn ? { turn } : {}) }
    const { board, result } = await this.changeWith(objectId, (board) => ({ board, result: applyAgent(board, change, stamp) }), true)
    return { board, ...result }
  }

  private async change(objectId: string, edit: (board: BoardFile, removed: Removed) => BoardFile | null, track = false): Promise<BoardFile> {
    return (await this.changeWith(objectId, (board, removed) => ({ board: edit(board, removed), result: undefined }), track)).board
  }

  /**
   * One change, written and told. Before it, the file is compared with what main last read or wrote: when it was changed
   * from outside (a git pull) the disk's board is the base the change is made on, and the window is told of it. `track`
   * keeps what the change took off the board, for `restore` (the person's and the agent's changes, not main's own).
   */
  private changeWith<R>(objectId: string, edit: (board: BoardFile, removed: Removed) => { board: BoardFile | null; result: R }, track = false): Promise<{ board: BoardFile; result: R }> {
    return this.turn(objectId, async (current, dir, epoch) => {
      const file = await this.takeDisk(objectId, dir, current, epoch)
      const before = textOf(file)
      let stash = this.removed.get(dir)
      if (!stash) this.removed.set(dir, (stash = new Map()))
      const { board: edited, result } = edit(structuredClone(file), stash)
      if (edited === null) return { board: structuredClone(file), result }
      const board: BoardFile = { ...edited, next: nextAbove(edited.next, edited.cards, edited.arrows) }
      if (textOf(board) === before) return { board: structuredClone(file), result }
      // Written before it is kept or told: a write that fails leaves the board as it was.
      await saveBoardFile(dir, board)
      // The pictures the change let go of (a card taken off, a sketch drawn on again) are what torno dropped: the sweep of a later run takes them.
      const gone = [...picturesOf(file.cards)].filter((name) => !picturesOf(board.cards).has(name))
      if (gone.length > 0) await dropPictures(dir, gone)
      if (epoch === this.epoch) {
        this.files.set(dir, board)
        this.disk.set(dir, textOf(board))
        if (track) this.keepRemoved(dir, file, board)
        for (const cb of this.listeners.changed) cb({ objectId, board: structuredClone(board) })
      }
      return { board: structuredClone(board), result }
    })
  }

  /** The board as the file now says it: read again when the file is other than main last read or wrote, and the window told when that changes the board. */
  private async takeDisk(objectId: string, dir: string, current: BoardFile, epoch: number): Promise<BoardFile> {
    if (epoch !== this.epoch || !this.disk.has(dir) || (await diskText(dir)) === this.disk.get(dir)) return current
    const file = await this.load(objectId, dir, epoch)
    if (epoch === this.epoch && textOf(file) !== textOf(current)) for (const cb of this.listeners.changed) cb({ objectId, board: structuredClone(file) })
    return file
  }

  /** What `after` lacks of `before` is kept for `restore`, the oldest let go past `REMOVED_KEPT`; what is back on the board is not kept. */
  private keepRemoved(dir: string, before: BoardFile, after: BoardFile): void {
    const kept = this.removed.get(dir) ?? new Map<string, Card | Arrow>()
    this.removed.set(dir, kept)
    const now = new Set([...after.cards.map((c) => c.id), ...after.arrows.map((a) => a.id)])
    for (const id of kept.keys()) if (now.has(id)) kept.delete(id)
    for (const thing of [...before.cards, ...before.arrows]) {
      if (now.has(thing.id)) continue
      kept.delete(thing.id)
      kept.set(thing.id, structuredClone(thing))
    }
    while (kept.size > REMOVED_KEPT) kept.delete(kept.keys().next().value as string)
  }

  /** Reads the board file of a project again, keeping what it says and what was wrong with it. */
  private async load(objectId: string, dir: string, epoch: number): Promise<BoardFile> {
    const loaded = await loadBoardFile(dir)
    if (epoch === this.epoch) {
      this.files.set(dir, loaded.file)
      this.disk.set(dir, loaded.text)
      if (loaded.problem !== undefined) {
        this.problems.set(dir, loaded.problem)
        if (loaded.aside !== undefined) this.asides.set(dir, loaded.aside)
        else this.asides.delete(dir)
        for (const cb of this.listeners.problem) cb({ objectId, message: loaded.problem, ...(loaded.aside !== undefined ? { aside: true as const } : {}) })
      }
    }
    return loaded.file
  }

  private turn<T>(objectId: string, task: (file: BoardFile, dir: string, epoch: number) => T | Promise<T>): Promise<T> {
    const dir = this.deps.dirOf(objectId)
    if (dir === undefined) return Promise.reject(new Error(`no project named ${objectId} in the open workspace`))
    // As of the asking: the workspace may be left while this waits its turn.
    const epoch = this.epoch
    const turn = (this.turns.get(dir) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const file = this.files.get(dir) ?? (await this.load(objectId, dir, epoch))
        return task(file, dir, epoch)
      })
      .finally(() => {
        if (this.turns.get(dir) === turn) this.turns.delete(dir)
      })
    this.turns.set(dir, turn)
    return turn
  }
}
