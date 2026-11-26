import { type BoardFile, type Card, type CardTurn, readingOrder } from './board'
import type { PromptRow } from './chat'
import { type SizeFact, parseSize } from './size'

// The brief page's reading of a project's board (`board.json`): the cards that say what the project is, sorted into the
// sections of the sheet. The file is not changed and nothing is dropped from it: a card of a kind the page does not draw
// (an old copy of a mark, a build, a frame's outline) simply is not a section's.

/** The name (lower case) of the frame whose text cards are the person's rules; `briefOf` in `main/board/text.ts` reads the same. */
export const RULES_FRAME = 'rules'

export interface BriefSections {
  /** Whether the board has the card of `brief.md`: the page shows the project's own words. */
  hasWhat: boolean
  /** Photos and doodles, to show beside what we are making. */
  pictures: Card[]
  /** STEP files and PDFs of `reference/`. */
  references: Card[]
  sizes: Card[]
  rules: Card[]
  /** Text cards of the person and Claude that are not rules (a link is one). */
  notes: Card[]
  /** The id of the frame named Rules, when the board has one. */
  rulesFrame: string | null
  /** What the person took off the page that main made by itself (the brief, a photo, a STEP file or a PDF): not lost, and shown again by "Show". */
  hidden: Card[]
}

const isPicture = (c: Card): boolean => c.kind === 'picture' || c.kind === 'sketch' || (c.kind === 'reference' && /\.(?:png|jpe?g|webp)$/i.test(c.source ?? ''))

export function briefSections(board: BoardFile): BriefSections {
  const cards = readingOrder(board.cards)
  const frame = cards.find((c) => c.kind === 'frame' && (c.name ?? '').trim().toLowerCase() === RULES_FRAME)
  const text = cards.filter((c) => c.kind === 'text')
  return {
    hasWhat: cards.some((c) => c.kind === 'brief'),
    pictures: cards.filter(isPicture),
    references: cards.filter((c) => c.kind === 'reference' && !isPicture(c)),
    sizes: cards.filter((c) => c.kind === 'size' && c.size !== undefined),
    rules: text.filter((c) => frame !== undefined && c.frame === frame.id),
    notes: text.filter((c) => frame === undefined || c.frame !== frame.id),
    rulesFrame: frame?.id ?? null,
    hidden: board.cards.filter((c) => c.hidden === true && (c.kind === 'brief' || c.kind === 'reference'))
  }
}

/** A size's value as the ledger shows it: the numbers read from it (`Ø 6.6`, `186 × 128`), or the value as typed when it is no numbers, with the unit it ends with left out. */
export function sizeValue(size: SizeFact): string {
  const parsed = parseSize(size.value, size.unit)
  if (parsed) return `${parsed.mark ? `${parsed.mark} ` : ''}${parsed.numbers.join(' × ')}`
  const text = size.value.trim()
  return text.toLowerCase().endsWith(size.unit) && text.length > size.unit.length ? text.slice(0, -size.unit.length).trimEnd() : text
}

/** Where a size came from, said as the ledger says it: the note after it. */
export function sizeSource(size: SizeFact): string {
  const from = size.source === 'from a manual or datasheet' ? 'from a datasheet' : size.source
  return size.note ? `${from} · ${size.note}` : from
}

/** The line over the sizes, for now with every size unchecked: `7 sizes, 7 not checked`. */
export function sizesSaid(sizes: number): string {
  return sizes === 0 ? 'none yet' : `${sizes} size${sizes === 1 ? '' : 's'}, ${sizes} not checked`
}

/** The line over the rules. */
export function rulesSaid(rules: number): string {
  return rules === 0 ? 'none yet' : `${rules} rule${rules === 1 ? '' : 's'}, ${rules} not checked`
}

/** What the person wrote, the way the page tells it: Claude's cards are those it wrote, made the person's since or not (#338). */
export const claudeWrote = (card: Card): boolean => card.by === 'agent' || card.from?.by === 'agent'

/** The kinds of card the spine of "What Claude wrote down" holds: its notes and rules, its sizes, its pictures of the view. */
const SPINE_KINDS: ReadonlySet<Card['kind']> = new Set(['text', 'size', 'picture', 'sketch'])

/** What a card of Claude's said before an edit, in the node of the prompt that wrote it: struck, with the prompt that changed it. */
export interface SpineGhost {
  card: string
  text: string
  /** The number of the prompt that changed it, when that prompt is known on this computer. */
  changedIn?: number
}

/** One prompt on the spine, with the cards of Claude's it wrote (or last changed) and the words of its cards that a later prompt changed. */
export interface SpineNode {
  /** The prompt's id, or '' for the cards written before torno kept their prompt. */
  id: string
  turn?: CardTurn
  /** The prompt as the chat's log has it, when it is on this computer. */
  prompt?: PromptRow
  /** When: the prompt's time, else the earliest of its cards', ms. */
  at?: number
  cards: Card[]
  ghosts: SpineGhost[]
}

/** The prompt a card of Claude's belongs to now: the one that wrote or last changed it, kept when the person made it theirs. */
export const turnOfCard = (card: Card): CardTurn | undefined => card.turn ?? card.from?.turn

const msOf = (at: string | undefined): number | undefined => {
  const ms = at === undefined ? Number.NaN : Date.parse(at)
  return Number.isFinite(ms) ? ms : undefined
}

/**
 * Claude's cards of a board on a spine of the prompts that wrote them, oldest first (#338): each card in the node of the
 * prompt that wrote or last changed it, and each of its earlier words, struck, in the node of the prompt that wrote those.
 * `cards` are in reading order and that order is kept within a node; the cards no prompt is known for (written before
 * torno kept it) are one node, first. `prompts` are the project's, by id (`chat:prompts`): a prompt that is not among
 * them has no number and is placed by its cards' time.
 */
export function briefSpine(cards: readonly Card[], prompts: ReadonlyMap<string, PromptRow>): SpineNode[] {
  const nodes = new Map<string, SpineNode>()
  const nodeOf = (turn: CardTurn | undefined): SpineNode => {
    const id = turn?.prompt ?? ''
    let node = nodes.get(id)
    if (!node) {
      const prompt = turn ? prompts.get(turn.prompt) : undefined
      node = { id, ...(turn ? { turn } : {}), ...(prompt ? { prompt, at: prompt.at } : {}), cards: [], ghosts: [] }
      nodes.set(id, node)
    }
    return node
  }
  const seen = (node: SpineNode, at: string | undefined): void => {
    const ms = msOf(at)
    if (node.prompt === undefined && ms !== undefined && (node.at === undefined || ms < node.at)) node.at = ms
  }
  for (const card of cards) {
    if (card.hidden || !SPINE_KINDS.has(card.kind) || !claudeWrote(card)) continue
    const now = turnOfCard(card)
    const node = nodeOf(now)
    node.cards.push(card)
    seen(node, card.from?.at ?? card.at)
    const was = card.was ?? []
    was.forEach((one, i) => {
      const next = i + 1 < was.length ? was[i + 1].turn : now
      const changedIn = next ? prompts.get(next.prompt)?.number : undefined
      const old = nodeOf(one.turn)
      old.ghosts.push({ card: card.id, text: one.text, ...(changedIn !== undefined ? { changedIn } : {}) })
      seen(old, one.at)
    })
  }
  return [...nodes.values()].sort((a, b) => (a.id === '' ? -1 : b.id === '' ? 1 : (a.at ?? 0) - (b.at ?? 0) || (a.prompt?.number ?? 0) - (b.prompt?.number ?? 0)))
}

/** Who wrote a card, said in a few words with its prompt: "You", "Claude, prompt 13", "Yours, from prompt 13". */
export function handOf(card: Card, prompts: ReadonlyMap<string, PromptRow>): { hand: 'you' | 'claude'; label: string } {
  const number = (turn: CardTurn | undefined): number | undefined => (turn ? prompts.get(turn.prompt)?.number : undefined)
  if (card.by === 'agent') {
    const n = number(card.turn)
    return { hand: 'claude', label: n === undefined ? 'Claude' : `Claude, prompt ${n}` }
  }
  if (card.from?.by === 'agent') {
    const n = number(card.from.turn)
    return { hand: 'you', label: n === undefined ? 'Yours, from Claude' : `Yours, from prompt ${n}` }
  }
  return { hand: 'you', label: card.by === 'torno' ? 'torno' : 'You' }
}

/** How many of each Claude wrote down, in a line: `9 notes, 4 sizes, a rule`. */
export function spineSaid(cards: readonly Card[], rulesFrame: string | null): string {
  const many = (n: number, one: string, a: string): string => (n === 1 ? a : `${n} ${one}s`)
  const rules = cards.filter((c) => c.kind === 'text' && rulesFrame !== null && c.frame === rulesFrame).length
  const notes = cards.filter((c) => c.kind === 'text').length - rules
  const sizes = cards.filter((c) => c.kind === 'size').length
  const pictures = cards.filter((c) => c.kind === 'picture' || c.kind === 'sketch').length
  const parts = [notes > 0 ? many(notes, 'note', 'a note') : '', sizes > 0 ? many(sizes, 'size', 'a size') : '', rules > 0 ? many(rules, 'rule', 'a rule') : '', pictures > 0 ? many(pictures, 'picture', 'a picture') : ''].filter(Boolean)
  return parts.length === 0 ? 'nothing yet' : parts.join(', ')
}

/** The topic a card of Claude's starts with ("Mount: an arm" is of Mount), when it starts with one: a short name and a colon. */
export function topicOf(text: string): { topic: string; rest: string } | null {
  const m = /^([A-Z][^:\n.]{0,39}):\s+(\S[\s\S]*)$/.exec(text.trim())
  return m ? { topic: m[1], rest: m[2] } : null
}

/** A web address as the page shows it: a short label (a file's name, or the host) and the host, never the address broken over lines. */
export function linkLabel(url: string): { label: string; host: string } {
  try {
    const u = new URL(url)
    const host = u.host.replace(/^www\./, '')
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).at(-1) ?? '')
    const pdf = /\.pdf$/i.test(last)
    const name = last.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]+/g, ' ').trim()
    if (name === '' || !/[a-z]/i.test(name)) return { label: host, host }
    return { label: `${name.length > 48 ? `${name.slice(0, 47)}…` : name}${pdf ? ', PDF' : ''}`, host }
  } catch {
    return { label: url.slice(0, 48), host: '' }
  }
}

/** A level-two section of `brief.md`: its heading's words and the lines under it. */
interface Section {
  heading: string
  body: string
}

/** `brief.md` cut at its level-two headings: what comes before the first, and each section. */
function sectionsOf(text: string): { head: string; sections: Section[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const head: string[] = []
  const sections: Section[] = []
  let fence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = fence ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) sections.push({ heading: h[1], body: '' })
    else if (sections.length === 0) head.push(line)
    else sections[sections.length - 1].body += `${line}\n`
  }
  return { head: head.join('\n'), sections }
}

/**
 * The person's words of `brief.md` as the page shows them (#338): without the `# name` line torno wrote at its top (the page
 * says what it is), and without the `## References` torno listed the files of `reference/` under (the page shows those
 * files, with their notes).
 */
export function briefWords(text: string): string {
  const { head, sections } = sectionsOf(text)
  const top = head.replace(/^\s*#\s[^\n]*\n?/, '')
  return [top.trim(), ...sections.filter((s) => s.heading.trim().toLowerCase() !== 'references' && !isClaudes(s)).map((s) => `## ${s.heading}\n${s.body.trimEnd()}`)].filter((part) => part !== '').join('\n\n')
}

/**
 * The headings of the sections Claude wrote into `brief.md` before it wrote the brief as cards (#341): `## Answers`,
 * `## Changes (2026-11-25, later)`, `## Decisions`, `## Assumptions`, and the like. torno never writes one, and the person's own
 * headings are of what the thing is, not of a conversation.
 */
const CLAUDES_HEADING = /^(?:answers?|changes?|decisions?|assumptions?|settled|clarifications?)\b/i

const isClaudes = (s: Section): boolean => CLAUDES_HEADING.test(s.heading.trim())

/** The sections Claude wrote into `brief.md` before (#341), each with its heading and what is under it; none for a brief of the person's words alone. */
export function claudeSections(text: string): Section[] {
  return sectionsOf(text).sections.filter(isClaudes).map((s) => ({ heading: s.heading.trim(), body: s.body.trim() }))
}

/** A section of `brief.md` as the page shows Claude's old ones. */
export type BriefSection = Section

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** When something was said, as the spine says it: `25 Nov 14:11`, in the computer's own time. */
export function whenSaid(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** What the person had seen of Claude's cards when they last had the Brief on screen (`.torno/board/seen.json`, #340): when, and a hash of each card. */
export interface Seen {
  at: string
  cards: Record<string, string>
}

/** A short hash of a string (FNV-1a, 32 bits, in hex): enough to tell that a card says something else, nothing more. */
function fnv(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** What a card of Claude's says, as a hash: its words, its size (without the tie, which is no news), and whose it is. A move is not news. */
export function seenHash(card: Card): string {
  const size = card.size ? { what: card.size.what, value: card.size.value, unit: card.size.unit, source: card.size.source, note: card.size.note ?? '' } : null
  return fnv(JSON.stringify([card.kind, card.text ?? '', card.caption ?? '', card.picture ?? '', size, card.by]))
}

/** What the person has now seen: every card of Claude's on the board, by its hash. */
export function seenOf(cards: readonly Card[], at: string): Seen {
  return { at, cards: Object.fromEntries(cards.filter((c) => !c.hidden && c.by === 'agent').map((c) => [c.id, seenHash(c)])) }
}

/** The cards of Claude's on the spine that are new since `seen`: added, or saying something else. Nothing is new without a `seen`. */
export function freshCards(nodes: readonly SpineNode[], seen: Seen | null): Set<string> {
  if (seen === null) return new Set()
  return new Set(nodes.flatMap((n) => n.cards.filter((c) => c.by === 'agent' && seen.cards[c.id] !== seenHash(c)).map((c) => c.id)))
}

/** The prompts named in a line, by number: `prompt 13`, `prompts 13 and 14`, `prompts 4, 9 and 13`. */
export function promptsSaid(numbers: readonly number[]): string {
  if (numbers.length === 0) return ''
  if (numbers.length === 1) return `prompt ${numbers[0]}`
  return `prompts ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`
}
