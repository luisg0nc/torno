/**
 * What the sheet of keys answers a search in: sentences made from the rows of the table (`cheatSheet()`), one for each
 * place the key or the words are heard. A sentence is its place, its keys and what the row says they do: the row's
 * `does` is turned from the imperative the table keeps it in ("Draw the parts apart") to what the key does ("E draws
 * the parts apart"). Nothing is written by hand for a key; what is here is the grammar, and the words it needs to
 * know to turn a row (`VERBS`), which `keySentences.test.ts` holds to every row of the table.
 */
import { capsOf, cheatSheet, type KeyRow } from './keys'
import { contextOf, KEYBOARD, namesOf, type Context } from './keyboard'
import type { PointerRow } from './pointer'

type Rows = ReturnType<typeof cheatSheet>

/** Where each place is, said at the head of its sentence. */
export const HEADS: Record<Context, string> = {
  Everywhere: 'Everywhere',
  Viewport: 'In the view',
  Measure: 'With Measure in hand',
  Section: 'With Section in hand',
  Align: 'With Align scan in hand',
  Region: 'With Region of a scan in hand',
  Sketch: 'Sketching',
  Shape: 'With a shape in hand',
  Board: 'On the board',
  Tracing: 'On a tracing',
  Lineup: 'Lining up a photo',
  Projects: 'On the page of projects',
  NewProject: 'On the page of a new project',
  Session: 'In the session',
  Field: 'In a field, a menu or a sheet',
  Dev: 'Working on torno'
}

/** The words a place is already called in a row's own label (`Measure: ...` in Measure's place), which the sentence does not say twice. */
const ALIASES: Partial<Record<Context, string[]>> = {
  Measure: ['measure'],
  Section: ['section'],
  Align: ['align'],
  Region: ['region'],
  Sketch: ['sketch'],
  Board: ['board'],
  Tracing: ['tracing'],
  Lineup: ['line-up']
}

/** The imperative verbs a row of the table begins with, or follows an `or`, an `and` or a `then` with. A key does what the row says, so a verb takes its `s`. */
const VERBS = new Set([
  'add', 'align', 'allow', 'build', 'cancel', 'choose', 'clear', 'click', 'close', 'complete', 'copy', 'cut', 'draw', 'drag', 'end', 'export', 'filter', 'fit', 'fix', 'give', 'go', 'hide', 'hold', 'keep', 'leave', 'let',
  'measure', 'move', 'name', 'nudge', 'open', 'paint', 'pan', 'paste', 'place', 'put', 'rebuild', 'reload', 'remove', 'review', 'rotate', 'rub', 'send', 'show', 'size', 'start', 'step', 'stop', 'straighten', 'take',
  'turn', 'type', 'undo', 'zoom'
])

/** What a row may begin with that makes a noun or a question of what follows: the key is that thing, not something it does. */
const NOUNS = new Set(['a', 'an', 'the', 'one', 'two', 'nothing', 'this', 'which', 'what', 'how', 'all', 'wider', 'narrower', 'developer', 'perspective', 'iso', 'done', 'down'])

/** What a row may begin with that is already a sentence: the key means it. */
const CLAUSES = new Set(['new'])

const PREPOSITIONS = /^(?:with|on|in|for|at|while)\b/i

/** A verb as a key does it: `draw` is `draws`. */
function does(verb: string): string {
  if (verb === 'go') return 'goes'
  if (/(?:s|x|z|ch|sh|o)$/.test(verb)) return `${verb}es`
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`
  return `${verb}s`
}

const lowerFirst = (text: string): string => (/^[A-Z](?:[a-z]|\s|$)/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text)

/** The verbs that follow an `or`, an `and` or a `then` in a text, as one key does them. */
const andThen = (text: string): string => text.replace(/\b(or|and|then) ([a-z]+)\b/g, (all, joint: string, verb: string) => (VERBS.has(verb) ? `${joint} ${does(verb)}` : all))

/** What follows the keys: the row's text turned to say what they do. `plural` is for several keys, which take the verb as it is. */
function predicate(rest: string, plural: boolean): string {
  const said = lowerFirst(rest.replace(/\.$/, ''))
  const first = /^[a-z0-9-]+/.exec(said)?.[0] ?? ''
  if (first === 'to' || first === 'back') return `${plural ? 'go' : 'goes'} ${said}`
  if (VERBS.has(first)) return plural ? said : andThen(`${does(first)}${said.slice(first.length)}`)
  if (CLAUSES.has(first)) return `means ${said}`
  return `${plural ? 'are' : 'is'}${NOUNS.has(first) ? '' : ' for'} ${said}`
}

/** A row's text as its label and what it says: `Measure: the wall` is `Measure` and `the wall`. A label is short and does not begin a sentence of its own (`To the next part: projects`). */
function split(said: string): { label: string | null; rest: string } {
  const at = said.indexOf(': ')
  const label = at > 0 ? said.slice(0, at) : ''
  return at > 0 && label.replace(/\s*\([^)]*\)/g, '').length <= 42 && !/^To /.test(label) ? { label, rest: said.slice(at + 2) } : { label: null, rest: said }
}

/** The label of a row as it qualifies the sentence: left out where the place says it already, `with Measure in hand` as it is, otherwise `for Select`. */
function qualifier(label: string | null, context: Context): string | null {
  if (label === null) return null
  const aliases = ALIASES[context] ?? []
  const parts = label.split(', ')
  while (parts.length > 0 && aliases.includes(parts[0].toLowerCase())) parts.shift()
  const kept = parts.join(', ')
  if (kept === '') return null
  return PREPOSITIONS.test(kept) ? lowerFirst(kept) : `for ${kept}`
}

/** What a sentence is made of, in order: plain text, and the keys that are said in it (the sheet sets those in its mono face). */
export type Piece = { text: string; cap?: true }

/** The keys of a row as pieces: `E`, `A and B`, `A, B and C`, or the first three and how many more. Several keys take the verb as it is. */
function keyPieces(keys: readonly string[]): { pieces: Piece[]; plural: boolean } {
  const caps = capsOf(keys)
  const shown = caps.length > 4 ? caps.slice(0, 3) : caps
  const pieces: Piece[] = []
  shown.forEach((cap, i) => {
    if (i > 0) pieces.push({ text: i === shown.length - 1 && caps.length <= 4 ? ' and ' : ', ' })
    pieces.push({ text: cap, cap: true })
  })
  if (caps.length > 4) pieces.push({ text: ` and ${caps.length - 3} more keys` })
  return { pieces, plural: caps.length > 1 || /Arrows$/.test(caps[0]) }
}

/** Where a label that is a verb (`Step back`, `Rebuild`) is what the key does: not where it names a tool of the board, a tracing or the like. */
const LABEL_IS_VERB: readonly Context[] = ['Everywhere', 'Viewport', 'Projects', 'NewProject', 'Session']

/** One clause of a sentence: `E draws the parts apart`, as pieces. A tool's key picks the tool (`V picks Select: click a face`). */
function clause(keys: readonly string[], said: string, context: Context, tool = false): Piece[] {
  const { label, rest } = split(said)
  const { pieces, plural } = keyPieces(keys)
  if (label !== null && tool) return [...pieces, { text: ` ${plural ? 'pick' : 'picks'} ${label}: ${rest.replace(/\.$/, '')}` }]
  if (label !== null && LABEL_IS_VERB.includes(context) && VERBS.has(/^[a-z]+/i.exec(label)![0].toLowerCase()) && !CLAUSES.has(/^[a-z]+/i.exec(rest)?.[0].toLowerCase() ?? '')) {
    const verb = label.charAt(0).toLowerCase() + label.slice(1)
    return [...pieces, { text: ` ${plural ? verb : `${does(/^[a-z]+/.exec(verb)![0])}${verb.slice(/^[a-z]+/.exec(verb)![0].length)}`}: ${rest.replace(/\.$/, '')}` }]
  }
  const qual = qualifier(label, context)
  return [...(qual ? [{ text: `${qual}, ` }] : []), ...pieces, { text: ` ${predicate(rest, plural)}` }]
}

/** Where a key is not heard: while a field or the terminal has the keys, for most of them. `global` keys are, and those in the terminal or a field are heard only there. */
const NOT_WHILE_TYPING = new Set(['window', 'viewport', 'measure', 'section', 'align', 'region', 'sketch', 'shape', 'compare', 'board', 'tracing', 'lineup', 'page', 'newobject'])
const TOOLS = new Set(['measure', 'section', 'align', 'region', 'sketch'])

function notHeard(rows: readonly KeyRow[]): string | undefined {
  const said = new Set<string>()
  for (const row of rows) {
    if (NOT_WHILE_TYPING.has(row.scope)) said.add('Not while a field or the terminal has the keys.')
    if (TOOLS.has(row.scope)) said.add('The tool hears the key before the view does.')
  }
  return said.size > 0 ? [...said].join(' ') : undefined
}

/** The most clauses told of one place: the rest are counted. */
const MOST = 3

export interface Sentence {
  context: Context
  /** The sentence, in plain text. */
  sentence: string
  /** The same, in pieces, where the keys are told apart from the words. */
  pieces: Piece[]
  /** Where the keys are not heard, in a line of its own; absent where they are heard everywhere. */
  notHeard?: string
}

const text = (pieces: Piece[]): string => pieces.map((piece) => piece.text).join('')

function sentenceOf(context: Context, rows: readonly KeyRow[]): Sentence {
  const shown = rows.slice(0, MOST)
  const pieces: Piece[] = [{ text: `${HEADS[context]}, ` }]
  shown.forEach((row, i) => {
    if (i > 0) pieces.push({ text: '; ' })
    pieces.push(...clause(row.keys, row.does, context, row.id.startsWith('tool.')))
  })
  if (rows.length > shown.length) pieces.push({ text: `; and ${rows.length - shown.length} more` })
  pieces.push({ text: '.' })
  const note = notHeard(rows)
  return { context, sentence: text(pieces), pieces, ...(note ? { notHeard: note } : {}) }
}

const words = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

/**
 * The rows that say what was typed. A single key's name (`E`, `Esc`, `Ctrl+G`) is the rows that have that key; anything else is
 * the rows that say all of the words, in any order: in what they do, in their keys, in where they are listened to, or in their name in the table (`explode`). In the
 * order of the table.
 */
export function matchRows(query: string, rows: Rows = cheatSheet()): KeyRow[] {
  const asked = words(query)
  if (asked.length === 0) return []
  const all = rows.flatMap((group) => group.rows.map((row) => ({ row, place: group.context })))
  const typed = query.trim().toLowerCase()
  const byKey = all.filter(({ row }) => row.keys.some((key) => key.toLowerCase() === typed))
  if (asked.length === 1 && byKey.length > 0) return byKey.map(({ row }) => row)
  return all.filter(({ row, place }) => asked.every((word) => `${row.does} ${row.keys.join(' ')} ${place} ${row.id.replace(/\./g, ' ')}`.toLowerCase().includes(word))).map(({ row }) => row)
}

/**
 * What a search is answered with: one sentence for each place the key or the words are heard, the places in the table's order.
 * `sentencesFor('E')` says what E does in the view and with Region in hand; `sentencesFor('explo')` finds the row that explodes.
 */
export function sentencesFor(query: string, rows: Rows = cheatSheet()): Sentence[] {
  const byContext = new Map<Context, KeyRow[]>()
  for (const row of matchRows(query, rows)) byContext.set(contextOf(row), [...(byContext.get(contextOf(row)) ?? []), row])
  return [...byContext].map(([context, found]) => sentenceOf(context, found))
}

/** A gesture of the pointer as a sentence of the view: `In the view, Drag turns the view ...`. */
export function pointerSentence(row: PointerRow): Sentence {
  const pieces: Piece[] = [{ text: `${HEADS.Viewport}, ` }, ...clause([row.gesture], row.does, 'Viewport'), { text: '.' }]
  return { context: 'Viewport', sentence: text(pieces), pieces }
}

/**
 * The caps of the keyboard a search lights: those of the key asked for, or, when words were typed, of every key of the rows that
 * say them. The cap is named by its place (`KeyE`), which `drawnKeyboard` gives as `id`.
 */
export function capsFor(query: string, rows: Rows = cheatSheet()): Set<string> {
  const typed = query.trim().toLowerCase()
  const lit = new Set<string>()
  for (const row of matchRows(query, rows)) {
    const asked = row.keys.filter((key) => key.toLowerCase() === typed)
    for (const key of asked.length > 0 ? asked : row.keys) for (const cap of KEYBOARD.flat()) if (namesOf(cap.code).includes(key)) lit.add(cap.code)
  }
  return lit
}
