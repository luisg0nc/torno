import { copyFile, lstat, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { type Arrow, type BoardFile, type Card, type CardKind, type CardTurn, type CardWas, type SavedCamera, CARD_ID, MAX_NAME_CHARS, MAX_TEXT_CHARS, MAX_WAS, PICTURE_NAME } from '../../shared/board'
import { checkSize, checkTie } from '../../shared/size'
import { FOLDER, ownTorno, writeOwn } from '../own'

const FOLDER_NAME = 'board'
const NAME = 'board.json'
const KINDS: readonly CardKind[] = ['brief', 'reference', 'mark', 'scan', 'build', 'view', 'params', 'checks', 'text', 'picture', 'sketch', 'frame', 'size', 'tracing']

/** The text of a board file: what is written, and what a change is compared with. */
export const textOf = (file: BoardFile): string => `${JSON.stringify(file, null, 2)}\n`

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const str = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.length <= max ? value : undefined)
const idNumber = (id: string): number => Number(id.slice(1))

function cameraOf(value: unknown): SavedCamera | undefined {
  if (!isRecord(value)) return undefined
  const vec = (v: unknown): [number, number, number] | undefined => (Array.isArray(v) && v.length === 3 && v.every(finite) ? [v[0], v[1], v[2]] : undefined)
  const position = vec(value.position)
  const target = vec(value.target)
  const up = vec(value.up)
  if (!position || !target || !up || typeof value.ortho !== 'boolean' || !finite(value.fov) || !finite(value.zoom)) return undefined
  return { position, target, up, ortho: value.ortho, fov: value.fov, zoom: value.zoom }
}

/** The longest id of a prompt or a conversation a card keeps. */
const MAX_TURN_ID = 200

/** A prompt as a card names it (`turn`), with only its two fields; undefined when it is not one. */
function turnOf(value: unknown): CardTurn | undefined {
  if (!isRecord(value)) return undefined
  const prompt = str(value.prompt, MAX_TURN_ID)
  if (prompt === undefined || prompt === '') return undefined
  const conversation = str(value.conversation, MAX_TURN_ID)
  return { prompt, ...(conversation !== undefined && conversation !== '' ? { conversation } : {}) }
}

/** A time as a card keeps it: ISO 8601 that reads as a date; undefined otherwise. */
const timeOf = (value: unknown): string | undefined => (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : undefined)

/** What a card said before its edits, each whole, the last `MAX_WAS`; undefined when none is. */
function wasOf(value: unknown): CardWas[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.flatMap((one): CardWas[] => {
    if (!isRecord(one)) return []
    const text = str(one.text, MAX_TEXT_CHARS)
    if (text === undefined) return []
    const turn = turnOf(one.turn)
    const at = timeOf(one.at)
    return [{ text, ...(turn ? { turn } : {}), ...(at ? { at } : {}) }]
  })
  return kept.length > 0 ? kept.slice(-MAX_WAS) : undefined
}

/** A card as the file holds it, with only the fields this version knows and each of the right shape; null when it is not a card. */
export function sanitiseCard(value: unknown): Card | null {
  if (!isRecord(value)) return null
  const { id, kind, x, y, w, h, by } = value
  if (typeof id !== 'string' || !CARD_ID.test(id) || !KINDS.includes(kind as CardKind)) return null
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w <= 0 || h <= 0) return null
  if (by !== 'person' && by !== 'agent' && by !== 'torno') return null
  const card: Card = { id, kind: kind as CardKind, x, y, w, h, by }
  if (typeof value.frame === 'string' && CARD_ID.test(value.frame)) card.frame = value.frame
  const source = str(value.source, 500)
  if (source !== undefined) card.source = source
  const layout = str(value.layout, 200)
  if (layout !== undefined) card.layout = layout
  const text = str(value.text, MAX_TEXT_CHARS)
  if (text !== undefined) card.text = text
  const name = str(value.name, MAX_NAME_CHARS)
  if (name !== undefined) card.name = name
  if (typeof value.picture === 'string' && PICTURE_NAME.test(value.picture)) card.picture = value.picture
  const caption = str(value.caption, MAX_TEXT_CHARS)
  if (caption !== undefined) card.caption = caption
  const camera = cameraOf(value.camera)
  if (camera) card.camera = camera
  if (value.hidden === true) card.hidden = true
  const turn = turnOf(value.turn)
  if (turn) card.turn = turn
  const at = timeOf(value.at)
  if (at !== undefined) card.at = at
  const was = wasOf(value.was)
  if (was) card.was = was
  // A card the person made theirs: it was the agent's (#339). Only on the person's.
  if (card.by === 'person' && isRecord(value.from) && value.from.by === 'agent') {
    const from = value.from
    const fromTurn = turnOf(from.turn)
    const fromAt = timeOf(from.at)
    card.from = { by: 'agent', ...(fromTurn ? { turn: fromTurn } : {}), ...(fromAt !== undefined ? { at: fromAt } : {}) }
  }
  const copy = value.copy
  if (isRecord(copy) && typeof copy.id === 'string' && typeof copy.line === 'string' && typeof copy.cause === 'string' && typeof copy.sources === 'string') {
    card.copy = { id: copy.id, line: copy.line, cause: copy.cause, sources: copy.sources }
  }
  // A size is kept only on a card of its kind, and a card of that kind without a whole one is not a card.
  if (card.kind === 'size') {
    let size = checkSize(value.size, card.by === 'agent' ? 'agent' : 'person')
    // A size of Claude's the person made theirs keeps Claude's source until they say where it came from.
    if (typeof size === 'string' && card.from?.by === 'agent' && (value.size as { source?: unknown } | undefined)?.source === 'from Claude') size = checkSize(value.size, 'agent')
    if (typeof size === 'string') return null
    const tie = checkTie((value.size as { tie?: unknown } | undefined)?.tie)
    card.size = tie ? { ...size, tie } : size
  }
  return card
}

/** An arrow as the file holds it; null when it is not one. Whether its ends are there is for the board to say. */
export function sanitiseArrow(value: unknown): Arrow | null {
  if (!isRecord(value)) return null
  const { id, from, to, by } = value
  if (typeof id !== 'string' || !CARD_ID.test(id) || typeof from !== 'string' || typeof to !== 'string') return null
  if (!CARD_ID.test(from) || !CARD_ID.test(to) || (by !== 'person' && by !== 'agent')) return null
  const arrow: Arrow = { id, from, to, by }
  const label = str(value.label, MAX_NAME_CHARS)
  if (label !== undefined && label !== '') arrow.label = label
  return arrow
}

/** The next number to hand out, never at or below an id in use. */
export const nextAbove = (next: number, cards: readonly Card[], arrows: readonly Arrow[]): number =>
  Math.max(next, ...cards.map((c) => idNumber(c.id) + 1), ...arrows.map((a) => idNumber(a.id) + 1), 1)

/**
 * What a board file may hold: the cards and arrows that are whole, each id once, every `frame` naming a frame
 * that is there (a card that does not is dropped, and so are the cards in it, and so on) and every arrow with
 * both ends there. `dropped` counts what was left out. Null when the value is no board file at all.
 */
export function readBoardFile(value: unknown): { file: BoardFile; dropped: number } | null {
  if (!isRecord(value) || !Array.isArray(value.cards)) return null
  const seen = new Set<string>()
  let cards: Card[] = []
  let dropped = 0
  for (const raw of value.cards) {
    const card = sanitiseCard(raw)
    if (!card || seen.has(card.id)) {
      dropped += 1
      continue
    }
    seen.add(card.id)
    cards.push(card)
  }
  for (;;) {
    const frames = new Set(cards.filter((c) => c.kind === 'frame' && c.frame === undefined).map((c) => c.id))
    const kept = cards.filter((c) => c.frame === undefined || frames.has(c.frame))
    if (kept.length === cards.length) break
    dropped += cards.length - kept.length
    cards = kept
  }
  const ids = new Set(cards.map((c) => c.id))
  const arrows: Arrow[] = []
  for (const raw of Array.isArray(value.arrows) ? value.arrows : []) {
    const arrow = sanitiseArrow(raw)
    if (!arrow || ids.has(arrow.id) || !ids.has(arrow.from) || !ids.has(arrow.to) || arrow.from === arrow.to || arrows.some((a) => a.id === arrow.id)) {
      dropped += 1
      continue
    }
    arrows.push(arrow)
  }
  const next = finite(value.next) && Number.isInteger(value.next) ? value.next : 1
  return { file: { ...(value.tidied === true ? { tidied: true as const } : {}), next: nextAbove(next, cards, arrows), cards, arrows }, dropped }
}

/** The highest `C<n>` a file's text shows anywhere, plus one: where ids go on from when the file cannot be read. */
function salvagedNext(text: string): number {
  let highest = 0
  for (const match of text.matchAll(/"C([1-9]\d*)"/g)) highest = Math.max(highest, Number(match[1]))
  return highest + 1
}

/**
 * The text of the project's `board.json`: null when there is none, or when what stands in its place is not a plain file
 * (a link would have torno read, and copy aside, whatever it leads to).
 */
export async function diskText(dir: string): Promise<string | null> {
  const path = join(dir, FOLDER, FOLDER_NAME, NAME)
  try {
    if (!(await lstat(path)).isFile()) return null
    return await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return null
    throw e
  }
}

/**
 * The board of the project in `dir`; `text` is what the file holds afterwards (null: no file). A missing file is an empty
 * board, and nothing is written. A link or a folder in the file's place is not read: an empty board and a `problem`
 * (the next write puts a file there). A file that is no board file is copied aside as `board.json.corrupt-<time>` and a new
 * board started, its ids going on from the highest the old file shows. A file with cards or arrows that are not whole is
 * copied aside as `board.json.dropped-<time>` and the others kept. Either way the file is rewritten at once and
 * `problem` says so.
 */
export async function loadBoardFile(dir: string, now: () => Date = () => new Date()): Promise<{ file: BoardFile; text: string | null; problem?: string; aside?: string }> {
  const path = join(dir, FOLDER, FOLDER_NAME, NAME)
  const exists = await lstat(path).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false
      throw e
    }
  )
  const text = await diskText(dir)
  if (text === null) {
    const file: BoardFile = { next: 1, cards: [], arrows: [] }
    if (!exists) return { file, text: null }
    return { file, text: null, problem: `${FOLDER}/${FOLDER_NAME}/${NAME} of this project is not a plain file, so torno did not read it. Its next change puts a board file there.` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON
  }
  const read = readBoardFile(parsed)
  if (read && read.dropped === 0) return { file: read.file, text }

  const stamp = now().toISOString().replace(/[:.]/g, '-')
  await ownTorno(dir, FOLDER_NAME)
  if (!read) {
    const aside = `${NAME}.corrupt-${stamp}`
    // Copied, not moved: were the write below to fail, the next read must find the bad file again, and its ids with it.
    await copyFile(path, join(dir, FOLDER, FOLDER_NAME, aside))
    const file: BoardFile = { next: salvagedNext(text), cards: [], arrows: [] }
    await saveBoardFile(dir, file)
    return { file, text: textOf(file), problem: `The board file of this project could not be read. It was kept as ${FOLDER}/${FOLDER_NAME}/${aside}, and a new board was started.`, aside }
  }
  const aside = `${NAME}.dropped-${stamp}`
  await copyFile(path, join(dir, FOLDER, FOLDER_NAME, aside))
  await saveBoardFile(dir, read.file)
  const what = read.dropped === 1 ? '1 card or arrow in the board file of this project was' : `${read.dropped} cards or arrows in the board file of this project were`
  return { file: read.file, text: textOf(read.file), problem: `${what} not whole, and left out. The file as it was is kept as ${FOLDER}/${FOLDER_NAME}/${aside}.`, aside }
}

/** Writes `<dir>/.torno/board/board.json` whole or not at all, once the folders are known to be torno's own. */
export async function saveBoardFile(dir: string, file: BoardFile): Promise<void> {
  await ownTorno(dir, FOLDER_NAME)
  await writeOwn(dir, `${FOLDER_NAME}/${NAME}`, textOf(file))
}

/** The name of a copy kept aside, as `loadBoardFile` makes it. */
export const ASIDE_NAME = /^board\.json\.(?:corrupt|dropped)-[0-9TZ-]+$/

/** The text of a copy kept aside: null when it is gone or is no plain file (a link is not followed). */
export async function asideText(dir: string, aside: string): Promise<string | null> {
  if (!ASIDE_NAME.test(aside)) return null
  const path = join(dir, FOLDER, FOLDER_NAME, aside)
  try {
    if (!(await lstat(path)).isFile()) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** Deletes a copy kept aside, when it is still a plain file there. Never rejects. */
export async function removeAside(dir: string, aside: string): Promise<void> {
  if (!ASIDE_NAME.test(aside)) return
  const path = join(dir, FOLDER, FOLDER_NAME, aside)
  try {
    if ((await lstat(path)).isFile()) await unlink(path)
  } catch {
    // gone already
  }
}
