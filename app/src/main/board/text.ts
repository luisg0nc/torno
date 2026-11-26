import { createHash } from 'node:crypto'
import { type Arrow, type BoardCounts, type BoardFile, type Card, type CardKind, MAX_BOARD_PICTURES, MAX_TEXT_CHARS, readingOrder } from '../../shared/board'
import { type Mark, markAnchors } from '../../shared/marks'
import { describeMark } from '../marks/describe'
import { lineupsOf } from '../tracings/text'
import { checkText, type ModelCheck } from '../../shared/modelChecks'
import { number } from '../../shared/format'
import { parseSize, saySize } from '../../shared/size'
import { type Tracing, tracingName } from '../../shared/tracings'
import { said } from '../../shared/params'
import type { Param } from '../../shared/scene'
import type { Overrides } from '../paramsfile'
import { REFERENCE_FILE } from '../sessions/reference'

// The one text form of a board, for what is attached to a prompt and what the `board` tool answers, and the one line
// every prompt carries (what is new on the board since the agent was last told). Pure: what the project holds that a
// card shows (the marks, the Params, the checks, the brief) is given in `LiveFacts`.

/** What main already has of the project, for the cards that show something of it. */
export interface LiveFacts {
  marks: Map<string, Mark>
  /** The model's `Params` as the last build read them. */
  params?: Param[]
  /** The person's tries of them (`.torno/params.json`). */
  tried?: Overrides
  /** The model's own checks, of the last build. */
  checks?: ModelCheck[]
  /** The text of `brief.md`, cut to `MAX_TEXT_CHARS`. */
  brief?: string
  /** The project's tracings, by id, as the tracings file has them. */
  tracings?: ReadonlyMap<string, Tracing>
}

export const CUT_SENTENCE = 'The rest of the board is cut here: read it with board.'
/** What the agent is told of a card that is not on this computer. */
const MISSING = 'picture not on this computer'
/** The most cards a line names as new, and frames it names. */
const MOST_NAMED = 8
const MOST_FRAMES = 6
const FRAME_NAME = 30

const WHO: Record<Card['by'], string> = { person: 'the person', agent: 'you', torno: 'torno' }
const LABEL: Record<CardKind, string> = {
  brief: 'brief',
  reference: 'reference',
  mark: 'mark',
  scan: 'scan',
  tracing: 'tracing',
  build: 'build',
  view: 'view',
  params: 'Params',
  checks: 'checks',
  text: 'text',
  picture: 'picture',
  sketch: 'doodle',
  frame: 'frame',
  size: 'size'
}
/** What a new card of each kind is called in the line. */
const NEW_AS: Record<CardKind, string> = {
  brief: 'the brief',
  reference: 'a reference',
  mark: 'a mark',
  scan: 'a scan',
  tracing: 'a tracing',
  build: 'a build',
  view: 'a view',
  params: 'the Params',
  checks: 'the checks',
  text: 'text',
  picture: 'a photo',
  sketch: 'a doodle',
  frame: 'a frame',
  size: 'a size'
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

function paramsText(live: LiveFacts): string {
  if (!live.params) return '(nothing is built yet, so there are no Params to tell)'
  if (live.params.length === 0) return '(the model has no Params)'
  return live.params
    .map((p) => {
      const tried = live.tried?.[p.name]
      const value = tried ? tried.value : (p.value ?? p.default)
      return `${p.name} ${said(value)}${tried ? ` (tried; file ${said(p.default)})` : ''}`
    })
    .join('\n')
}

function checksText(live: LiveFacts): string {
  if (!live.checks) return '(nothing is built yet, so there are no checks to tell)'
  if (live.checks.length === 0) return '(the model declares no checks)'
  return live.checks.map((c) => `${c.status}: ${checkText(c)}`).join('\n')
}

function markText(card: Card, live: LiveFacts): string {
  const mark = card.source === undefined ? undefined : live.marks.get(card.source)
  if (!mark) return `${card.source ?? 'A mark'} (not among the marks of this project now)`
  // A view note and a sketch are said as everywhere else they are: by their line (what each holds, and the build it is of). So are a measure and a "should be here".
  if (mark.kind === 'note' || mark.kind === 'sketch' || mark.kind === 'span' || mark.kind === 'offset') return describeMark(mark, live.tracings ? { tracings: [...live.tracings.keys()], lineups: lineupsOf([...live.tracings.values()]) } : {})
  const ref = markAnchors(mark)[0]?.ref
  const note = oneLine(mark.note)
  return `${mark.id} (${mark.kind}${ref ? `, on ${ref}` : ''}): ${note ? `${note}, ` : ''}${mark.status}`
}

/**
 * What a tracing card says: `T1 "Front of the block"` and then its plane without the axes (`XZ at y = 0`), its layers and the line-up of its
 * photo, never said to be exact. `said` is absent when the project has no such tracing now. The fade of the photo is no part of it: a fade is news to no one.
 */
function tracingSaid(card: Card, live: LiveFacts): { head: string; said?: string } {
  const id = card.source ?? 'A tracing'
  const t = card.source === undefined ? undefined : live.tracings?.get(card.source)
  if (!t) return { head: id, said: undefined }
  const layers = `${t.layers.length} ${t.layers.length === 1 ? 'layer' : 'layers'}`
  const photo = t.photo === undefined ? [] : [t.photo.scale !== undefined && t.photo.pairs.length > 0 ? `photo lined up (${number(t.photo.scale)} px/mm, ≈)` : 'photo not lined up']
  return { head: `${t.id} "${tracingName(t)}"`, said: [t.plane.label.replace(/ \(u = .*$/, ''), layers, ...photo].join(', ') }
}

const buildText = (card: Card): string => (card.copy ? `Build ${card.copy.id}: ${card.copy.line} (${card.copy.cause})` : `Build ${card.source ?? ''}`.trim())

/** What a file of `reference/` that is not a picture is, for the agent, who reads it with its own tools. */
function referenceText(card: Card): string {
  const source = card.source ?? ''
  const what = /\.(?:step|stp)$/i.test(source) ? " (a bought part's STEP)" : /\.pdf$/i.test(source) ? ' (a PDF: read it with your own tools)' : ''
  return [`${source}${what}`, ...(card.caption ? [card.caption] : [])].join('\n')
}

/** What a card says, in words, without the picture it may carry: the one thing `saysHash` and the text are both made of. */
function contentOf(card: Card, live: LiveFacts): string {
  switch (card.kind) {
    case 'text':
      return card.text ?? ''
    case 'frame':
      return card.name ?? ''
    case 'picture':
    case 'sketch':
      return card.caption ?? ''
    case 'size':
      return card.size ? saySize(card.size) : ''
    case 'brief':
      return live.brief ? live.brief.slice(0, MAX_TEXT_CHARS) : '(there is no brief.md)'
    case 'reference':
      return referenceText(card)
    case 'mark':
      return markText(card, live)
    case 'scan':
      return `Scan ${card.source ?? ''}`.trim()
    case 'tracing': {
      const { head, said } = tracingSaid(card, live)
      return said === undefined ? `${head} (not among the tracings of this project now)` : `${head}: ${said}`
    }
    case 'build':
      return buildText(card)
    case 'view':
      return `View ${card.source ?? ''}${card.layout ? ` (layout ${card.layout})` : ''}`
    case 'params':
      return paramsText(live)
    case 'checks':
      return checksText(live)
  }
}

/** What the card says, not where it is: a change of it is news to the agent, a move or a resize or a frame is not. */
export function saysHash(card: Card, live: LiveFacts): string {
  // A card the person made theirs (#339) is news once: Claude may no longer change it.
  return hash([card.kind, contentOf(card, live), card.picture ?? '', card.source ?? '', ...(card.from ? ['from', card.from.by] : [])])
}

const arrowHash = (arrow: Arrow): string => hash([arrow.from, arrow.to, arrow.label ?? ''])

const arrowText = (arrow: Arrow): string => `${arrow.from} → ${arrow.to}${arrow.label ? `: ${arrow.label}` : ''}`

type Fate = 'attached' | 'missing' | 'left out'

/** A picture that goes with the text: a file of `pictures/`, or (`reference`) a photo or doodle of `reference/`, by the name its card has. */
export interface BoardPicture {
  card: string
  file: string
  reference?: true
}

export interface BoardText {
  text: string
  /** The pictures that go with the text, in reading order: at most `MAX_BOARD_PICTURES`. */
  pictures: BoardPicture[]
  /** Pictures that are there and were not attached (past the most, or in a part that was cut): read them with the tool. */
  leftOut: string[]
  /** What the text tells: the cards (not the frames), the arrows, and the frames by name (or id when it has none). Of what the text holds after a cut, not of what was asked for. */
  counts: { cards: number; arrows: number; frames: string[] }
}

/** What a list of cards and a number of arrows come to, as `BoardText.counts` has it. */
function countsOf(cards: readonly Card[], arrows: number): BoardText['counts'] {
  return { cards: cards.filter((c) => c.kind !== 'frame').length, arrows, frames: cards.filter((c) => c.kind === 'frame').map((c) => c.name || c.id) }
}

/** The picture a card shows, if it shows one: the file it names, or for a card of a photo of `reference/` that photo. */
function pictureOf(card: Card): Omit<BoardPicture, 'card'> | undefined {
  if (card.picture !== undefined) return { file: card.picture }
  if (card.kind === 'reference' && card.source !== undefined && REFERENCE_FILE.test(card.source)) return { file: card.source, reference: true }
  return undefined
}

/** The prompt a card of the agent's was written in, after its author: `, prompt 11`; nothing when it has none or its number is not known here. */
function promptOf(card: Card, prompts: ReadonlyMap<string, number> | undefined): string {
  if (card.by === 'person' && card.from?.by === 'agent') {
    const was = card.from.turn && prompts?.get(card.from.turn.prompt)
    return ` (it was yours${was ? `, prompt ${was}` : ''}: theirs now, not yours to change)`
  }
  const number = card.turn && prompts?.get(card.turn.prompt)
  return card.by === 'agent' && number ? `, prompt ${number}` : ''
}

/**
 * The board, or the frames and cards named in `only` (the frames' cards with them), as text: a block for each card in
 * reading order, then the arrows between what is told. Hidden cards are not in it. `exists` says whether a picture's
 * file is on this computer. The text is at most `limit` characters; what does not fit is replaced by a sentence.
 */
export function boardText(board: BoardFile, live: LiveFacts, opts: { only?: string[] | 'all'; limit: number; exists?: (file: string) => boolean; /** The number of each prompt by its id (`listPrompts`): a card of the agent's says the prompt it was written in. */ prompts?: ReadonlyMap<string, number> }): BoardText {
  const only = opts.only === undefined || opts.only === 'all' ? null : new Set(opts.only)
  const cards = readingOrder(board.cards).filter((c) => only === null || only.has(c.id) || (c.frame !== undefined && only.has(c.frame)))
  const exists = opts.exists ?? ((): boolean => true)
  const frames = new Map(cards.filter((c) => c.kind === 'frame').map((c) => [c.id, c.name ?? c.id]))

  const fate = new Map<string, Fate>()
  const pictures: BoardText['pictures'] = []
  const leftOut: string[] = []
  for (const card of cards) {
    const shows = pictureOf(card)
    if (shows === undefined) continue
    if (!exists(shows.file)) fate.set(card.id, 'missing')
    else if (pictures.length < MAX_BOARD_PICTURES) {
      fate.set(card.id, 'attached')
      pictures.push({ card: card.id, ...shows })
    } else {
      fate.set(card.id, 'left out')
      leftOut.push(card.id)
    }
  }

  const block = (card: Card): string => {
    const where = card.frame !== undefined && frames.has(card.frame) ? ` · in ${frames.get(card.frame)}` : ''
    const head = `${card.id} · ${LABEL[card.kind]} · by ${WHO[card.by]}${promptOf(card, opts.prompts)}${where}`
    // A size is one line, said after its head; the numbers it holds follow it in full.
    if (card.kind === 'size') {
      const numbers = card.size ? parseSize(card.size.value, card.size.unit)?.numbers : undefined
      return [`${head}: ${contentOf(card, live)}`, ...(numbers ? [`numbers: [${numbers.join(', ')}]`] : [])].join('\n')
    }
    // A tracing is one line, in the head's place: its number and name, where it is, then what it says.
    if (card.kind === 'tracing') {
      const { head, said } = tracingSaid(card, live)
      return said === undefined ? `${card.id} · tracing ${head} (not among the tracings of this project now)` : `${card.id} · tracing ${head}${where}: ${said}`
    }
    const body = card.kind === 'picture' || card.kind === 'sketch' ? '' : contentOf(card, live)
    const picture = ((): string => {
      const state = fate.get(card.id)
      if (state === undefined) return ''
      const what = card.kind === 'sketch' ? 'doodle' : 'picture'
      const caption = card.kind === 'picture' || card.kind === 'sketch' ? (card.caption ?? '') : `of ${card.source ?? card.id}`
      const note = state === 'missing' ? MISSING : state === 'left out' ? 'not attached, read it with board' : ''
      const said = [caption, note].filter(Boolean).join(', ')
      return `[${what} ${card.id}${said ? `: ${said}` : ''}]`
    })()
    return [head, body, picture].filter((part, i) => i === 0 || part !== '').join('\n')
  }

  const blocks = cards.map(block)
  const shown = new Set(cards.map((c) => c.id))
  const arrows = board.arrows.filter((a) => shown.has(a.from) && shown.has(a.to))
  if (arrows.length > 0) blocks.push(`Arrows:\n${arrows.map(arrowText).join('\n')}`)

  const full = blocks.join('\n\n')
  if (full.length <= opts.limit) return { text: full, pictures, leftOut, counts: countsOf(cards, arrows.length) }

  // Cut at the end of the last whole block that fits, with the sentence after it.
  const budget = Math.max(0, opts.limit - CUT_SENTENCE.length - 2)
  const kept: string[] = []
  let used = 0
  for (const b of blocks) {
    const next = used + (kept.length > 0 ? 2 : 0) + b.length
    if (next > budget) break
    kept.push(b)
    used = next
  }
  if (kept.length === 0 && blocks.length > 0) kept.push(blocks[0].slice(0, budget))
  const text = kept.length > 0 ? `${kept.join('\n\n')}\n\n${CUT_SENTENCE}` : CUT_SENTENCE.slice(0, opts.limit)
  // A picture of a card that was cut is not sent: it is left for the tool.
  const told = new Set(cards.slice(0, Math.min(kept.length, cards.length)).map((c) => c.id))
  const cut = pictures.filter((p) => !told.has(p.card))
  const tellsArrows = kept.length > cards.length
  return { text, pictures: pictures.filter((p) => told.has(p.card)), leftOut: [...leftOut, ...cut.map((p) => p.card)], counts: countsOf(cards.slice(0, Math.min(kept.length, cards.length)), tellsArrows ? arrows.length : 0) }
}

/** The most the brief takes of a prompt, in characters (`briefOf`). */
export const BRIEF_LIMIT = 1000
/** The most of it the rules may take; the sizes have the rest. */
const RULES_ROOM = 400
/** The name of the frame whose text cards are the person's rules (`startBoard` makes it). */
const RULES_FRAME = 'rules'

/**
 * The brief of the board: the person's sizes (every visible `size` card) and their rules (the text cards of the frame named
 * Rules), in at most BRIEF_LIMIT characters, by whole sizes with the rest counted. `hash` changes with what they say, never
 * with a move or a resize, so that a change is told again once. Nothing for a board with neither.
 */
export function briefOf(board: BoardFile, toolName: (tool: string) => string = (t) => t): { text: string; hash: string } | undefined {
  const cards = readingOrder(board.cards)
  const sizes = cards.flatMap((c) => (c.kind === 'size' && c.size ? [saySize(c.size)] : []))
  const frames = new Set(cards.filter((c) => c.kind === 'frame' && (c.name ?? '').trim().toLowerCase() === RULES_FRAME).map((c) => c.id))
  const said = cards.flatMap((c) => (c.kind === 'text' && c.frame !== undefined && frames.has(c.frame) && oneLine(c.text ?? '') !== '' ? [oneLine(c.text ?? '')] : []))
  if (sizes.length === 0 && said.length === 0) return undefined
  const joined = said.join(' / ')
  const rules = joined.length > RULES_ROOM ? `${joined.slice(0, RULES_ROOM - 1).trimEnd()}…` : joined
  const head = "The person's brief:"
  const tail = `The board has the rest: read it with ${toolName('board')}.`
  const rulesPart = rules === '' ? '' : ` Rules: ${rules}.`
  const room = BRIEF_LIMIT - head.length - ' sizes: '.length - rulesPart.length - 1 - tail.length - ' and 99 more'.length - 1
  let kept = 0
  let used = 0
  for (const size of sizes) {
    const next = used + (kept > 0 ? 2 : 0) + size.length
    if (next > room) break
    used = next
    kept++
  }
  const more = sizes.length > kept ? ` and ${sizes.length - kept} more` : ''
  const sizesPart = sizes.length === 0 ? '' : kept === 0 ? ` sizes: ${sizes.length} (read them with ${toolName('board')}).` : ` sizes: ${sizes.slice(0, kept).join('; ')}${more}.`
  return { text: `${head}${sizesPart}${rulesPart} ${tail}`.slice(0, BRIEF_LIMIT), hash: hash([sizes, said]) }
}

/**
 * The one line every prompt carries: how many cards there are, which are new to the agent since it was last told,
 * and the frames by name. A card is new when it is not in `told` or what it says has changed (`saysHash`); a mark
 * card follows the marks' own news and the agent's own cards are never news to it. Nothing for a board with nothing
 * on it. `told` in the answer is what the agent will have been told once the prompt is delivered: kept by whoever delivers.
 */
export function boardLine(board: BoardFile, told: Record<string, string>, live: LiveFacts, toolName: (tool: string) => string = (t) => t, opts: { again?: boolean } = {}): { line: string; told: Record<string, string>; counts?: BoardCounts; brief?: string } {
  const cards = readingOrder(board.cards)
  if (cards.length === 0 && board.arrows.length === 0) return { line: '', told: {} }
  const known: Record<string, string> = {}
  const news: string[] = []
  const check = (id: string, now: string, news_: boolean, as: string): void => {
    known[id] = now
    if (news_ && told[id] !== now) news.push(`${id} ${as}`)
  }
  for (const card of cards) check(card.id, saysHash(card, live), card.kind !== 'mark' && card.by !== 'agent', NEW_AS[card.kind])
  const there = new Set(cards.map((c) => c.id))
  for (const arrow of board.arrows) if (there.has(arrow.from) && there.has(arrow.to)) check(arrow.id, arrowHash(arrow), arrow.by !== 'agent', 'an arrow')
  // The brief (sizes and rules) is said to a conversation that begins (`again`) and whenever what it says has changed since it was told.
  const brief = briefOf(board, toolName)
  if (brief) known.brief = brief.hash
  const briefed = brief && (opts.again === true || told.brief !== brief.hash) ? brief.text : undefined
  const named = news.slice(0, MOST_NAMED).join(', ')
  const more = news.length > MOST_NAMED ? ` and ${news.length - MOST_NAMED} more` : ''
  const frames = cards.filter((c) => c.kind === 'frame' && c.name).map((c) => oneLine(c.name as string).slice(0, FRAME_NAME))
  const framed = frames.length === 0 ? '' : `, frames ${frames.slice(0, MOST_FRAMES).join(', ')}${frames.length > MOST_FRAMES ? ` and ${frames.length - MOST_FRAMES} more` : ''}`
  // As an attachment tells them: the frames by name, and the cards not counting them.
  const total = cards.filter((c) => c.kind !== 'frame').length
  const count = `${total} card${total === 1 ? '' : 's'}`
  return { line: `Board: ${count} (${news.length} new${news.length > 0 ? `: ${named}${more}` : ''})${framed}. Read it with ${toolName('board')}.`, told: known, counts: { total, new: news.length }, ...(briefed ? { brief: briefed } : {}) }
}
