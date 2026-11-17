import type { BoardFile, Card } from '../../../shared/board'
import { type NoteMark, markAnchors } from '../../../shared/marks'
import { type NamedSet, expandSet, splitSetRef } from '../../../shared/sets'
import { splitTagRef, tagRefs } from '../../../shared/tags'
import { layerOf, type TornoState } from '../../state/store'

/** What a ref shown in the chat is, and what the window can do with it. */
export interface RefInfo {
  kind: 'mark' | 'build' | 'geometry' | 'card' | 'none'
  /** Whether it names something in the window now: only such a chip lights, and answers a click. */
  live: boolean
  /** The refs of the layout shown to light in the viewport while the pointer is on the chip. */
  lights: string[]
  /** What a click does: go to the mark, select the face or edge, or open the sheet of the failed build. */
  act?: 'focus' | 'select' | 'build' | 'card'
  /** For a mark, who made it: its chip is in its colour. */
  author?: 'user' | 'agent'
  /** What a click selects, when that is not what it lights: a named set lights its strokes too, and selects faces and edges only. */
  select?: string[]
  /** The tooltip: what it is, or why it does nothing. */
  title: string
  /** It names nothing this object has (a mark it has not, a build it has not made, a part the build lacks): in prose it is only text. */
  plain: boolean
}

const NOTE_WORDS = 80
/** The most faces a view note lights at once: its ink may lie over a great many. */
const MOST_LIT = 60

/** The faces under a view note's ink (and arrow heads) that the build shown still has, each once: the rest lit nothing. */
function noteLights(s: RefState, note: NoteMark): string[] {
  const lit = new Set<string>()
  for (const under of note.under) {
    for (const { ref } of under.refs) {
      if (lit.size >= MOST_LIT) return [...lit]
      if (!lit.has(ref) && refInfo(s, ref).live) lit.add(ref)
    }
  }
  return [...lit]
}

/** What a ref (`M4`, `r12`, `lid/F12`, `lid/E3`) is among what the window shows now. */
/** The parts of the state a ref depends on: the rest of it (the selection, the camera) cannot change what a chip says. */
export type RefState = Pick<TornoState, 'marks' | 'scene' | 'layers' | 'layout' | 'revision' | 'build'> & {
  /** The board of the project as the window has it (`state/board.ts`): without it, a `C7` is only text. */
  board?: BoardFile | null
  /** The named sets of the project as the window has them: without them, a `#deck` is only text. */
  sets?: readonly NamedSet[]
}

/** What names a card in a tooltip: its words when it has them, else what it shows. */
function cardSaid(card: Card): string {
  const words = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_WORDS)
  switch (card.kind) {
    case 'text':
      return words(card.text) || 'text'
    case 'frame':
      return `frame ${words(card.name)}`.trim()
    case 'picture':
    case 'sketch':
      return [card.kind === 'sketch' ? 'doodle' : card.kind, words(card.caption)].filter(Boolean).join(', ')
    default:
      return [card.kind === 'reference' ? 'reference' : card.kind, card.source ?? ''].filter(Boolean).join(' ')
  }
}

export function refInfo(s: RefState, value: string): RefInfo {
  if (/^M\d+$/.test(value)) {
    const mark = s.marks.find((m) => m.id === value)
    if (!mark) return { kind: 'mark', live: false, lights: [], plain: true, title: `${value} is not among the marks of this project` }
    if (mark.kind !== 'region' && s.scene !== null && !s.scene.layouts.includes(mark.layout)) {
      return { kind: 'mark', live: false, lights: [], plain: false, author: mark.author, title: `${value} is on the layout ${mark.layout}, which this build does not have` }
    }
    // Lit where it is tied to the part, when the layout it is in is the one shown.
    const lights = mark.layout === s.layout ? (mark.kind === 'note' ? noteLights(s, mark) : markAnchors(mark).flatMap((a) => (a.ref ? [a.ref] : [])).slice(0, 2)) : []
    const note = mark.note.length > NOTE_WORDS ? `${mark.note.slice(0, NOTE_WORDS)}…` : mark.note
    return { kind: 'mark', live: true, lights, plain: false, act: 'focus', author: mark.author, title: note === '' ? `Go to ${value}` : `${value}: ${note}` }
  }
  if (/^C\d+$/.test(value)) {
    const card = s.board?.cards.find((c) => c.id === value)
    if (!card) return { kind: 'card', live: false, lights: [], plain: true, title: `${value} is not on the board of this project` }
    if (card.hidden) return { kind: 'card', live: false, lights: [], plain: false, title: `${value} is hidden on the board: show it again from "Hidden cards"` }
    return { kind: 'card', live: true, lights: [], plain: false, act: 'card', title: `${value}: ${cardSaid(card)}` }
  }
  if (/^r\d+$/.test(value)) {
    const n = Number(value.slice(1))
    const shown = s.scene !== null && n === s.revision
    // The build on show is live while the build after it has failed: a click says why. An older build stays inert.
    const failed = shown && s.build?.status === 'failed' && s.build.error !== undefined
    const title = shown ? `Build ${value}, the one on show${failed ? '; the build after it failed: show why' : ''}` : `Build ${value}`
    return { kind: 'build', live: failed, lights: [], plain: n < 1 || n > s.revision, ...(failed ? { act: 'build' as const } : {}), title }
  }
  if (splitSetRef(value)) return setInfo(s, value)
  const tagged = splitTagRef(value)
  if (tagged) {
    // A face or an edge the model names (`lid/@top`): it lights and selects what it names now, one face or several.
    const part = s.scene?.parts.find((p) => p.layout === s.layout && p.name === tagged.part)
    const no = (title: string): RefInfo => ({ kind: 'geometry', live: false, lights: [], plain: false, title })
    if (!part) {
      const anywhere = s.scene?.parts.some((p) => p.name === tagged.part) === true
      return { ...no(`${value} is not in the layout shown (${s.layout})`), plain: !anywhere }
    }
    if (layerOf(s.layers, part.name)?.visible === false) return no(`${value} is on a part that is switched off`)
    const refs = tagRefs(part, tagged.tag)
    if (!refs) return no(`${part.name} has no tag @${tagged.tag} in this build`)
    return { kind: 'geometry', live: true, lights: refs, plain: false, act: 'select', title: `Select ${value}${refs.length > 1 ? ` (${refs.length} faces and edges)` : ` (${refs[0]})`}` }
  }
  const sub = /^(.*)\/([FE])(\d+)$/.exec(value)
  if (!sub) return { kind: 'none', live: false, lights: [], plain: true, title: value }
  const [, name, letter, number] = sub
  const found = s.scene?.parts.find((p) => p.layout === s.layout && p.name === name)
  const no = (title: string): RefInfo => ({ kind: 'geometry', live: false, lights: [], plain: false, title })
  if (!found) {
    // A part the build has in no layout is not a part: the text names something else.
    const anywhere = s.scene?.parts.some((p) => p.name === name) === true
    return { ...no(`${value} is not in the layout shown (${s.layout})`), plain: !anywhere }
  }
  if (layerOf(s.layers, name)?.visible === false) return no(`${value} is on a part that is switched off`)
  if (Number(number) >= (letter === 'F' ? found.faceCount : found.edgeCount)) return no(`${name} has no ${letter}${number}`)
  return { kind: 'geometry', live: true, lights: [value], plain: false, act: 'select', title: `Select ${value}` }
}

/** A named set's ref (`#deck`, `block/#deck`): it lights its members the shown build has, strokes among them, and a click selects its faces and edges. */
function setInfo(s: RefState, value: string): RefInfo {
  const no = (title: string, plain = false): RefInfo => ({ kind: 'geometry', live: false, lights: [], plain, title })
  const sets = s.sets ?? []
  const parts = (s.scene?.parts ?? []).filter((p) => p.layout === s.layout)
  const expanded = expandSet(sets, parts, s.layout, value, s.marks)
  // A name no set has is only text: `#include` in a sentence.
  if (expanded === null || ('error' in expanded && /^no named set/.test(expanded.error))) return { kind: 'none', live: false, lights: [], plain: true, title: `${value} is not a named set of this project` }
  if ('error' in expanded) return no(expanded.error)
  const off = (ref: string): boolean => layerOf(s.layers, ref.split('/')[0])?.visible === false
  const faces = expanded.refs.filter((ref) => !off(ref))
  const lights = [...faces, ...expanded.strokes]
  const said = expanded.said.slice(expanded.said.indexOf(':') + 2)
  if (lights.length === 0) return no(`${value}: ${expanded.refs.length > 0 ? 'its parts are switched off' : said}`)
  return {
    kind: 'geometry',
    live: true,
    lights,
    plain: false,
    act: 'select',
    select: faces.filter((ref) => /\/[FE]\d+$/.test(ref)),
    title: `Select ${value}: ${said}`
  }
}
