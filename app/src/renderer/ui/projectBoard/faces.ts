import { type Card, type CardKind, firstLink } from '../../../shared/board'
import { count } from '../../../shared/format'
import { type Mark, markAnchors } from '../../../shared/marks'
import { checkText, type ModelCheck } from '../../../shared/modelChecks'
import { said } from '../../../shared/params'
import type { Param } from '../../../shared/scene'
import type { ScanInfo } from '../../../shared/scans'
import type { SavedView } from '../../../shared/views'

// What a card of the board says, as data: from the card and the facts the window holds of what it shows (the mark's
// note and status, the scan, the Params, the checks). A card whose source is not loaded shows its stored text. A face
// is the same while its inputs are, so a card is drawn again only when it or what it shows changes.

export const PICTURE_MISSING = 'picture not on this computer'
export const BUILD_MISSING = 'build not on this computer'
export const VIEW_MISSING = 'view not saved here'

/** What the window has of what cards show. A fact that is absent has not come (yet): the face says so, or says nothing. */
export interface Facts {
  mark?: Mark
  scan?: ScanInfo
  scanVisible?: boolean
  /** A saved view by the card's name; null when there is none of that name. */
  view?: SavedView | null
  params?: readonly Param[]
  checks?: readonly ModelCheck[]
  /** The text of `brief.md`; null when there is none. */
  brief?: string | null
  /** Whether the build the card keeps is in the history here and the same build; undefined while that is not known. */
  buildHere?: boolean
  /** Whether the picture of the card is on this computer: undefined while it is being read. */
  picture?: 'here' | 'missing'
}

export type Tone = 'ok' | 'fail' | 'tried' | 'muted'

export interface Line {
  text: string
  tone?: Tone
  /** Set in the monospace face: a number or a ref. */
  mono?: true
  /** Set large: the one figure a card is read for. */
  big?: true
}

export interface Face {
  label: string
  /** The id a card is known by on its face: `M3`, `S1`, `h41`. */
  chip?: string
  chipAuthor?: 'user' | 'agent'
  title?: string
  lines: Line[]
  /** Long text, shown whole in a body that scrolls. */
  body?: string
  scroll?: true
  picture?: 'here' | 'missing'
  /** What is wrong with where the card's thing is, as a sentence. */
  note?: string
  /** The web address of a text card that holds one, shown as a link that main opens in the browser. */
  link?: string
}

const LABEL: Record<CardKind, string> = {
  brief: 'Brief',
  reference: 'Reference',
  mark: 'Mark',
  scan: 'Scan',
  build: 'Build',
  view: 'View',
  params: 'Params',
  checks: 'Checks',
  text: 'Text',
  picture: 'Picture',
  sketch: 'Doodle',
  frame: 'Frame',
  size: 'Size'
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()
const IMAGE = /\.(?:png|jpe?g|webp)$/i

function markFace(card: Card, facts: Facts): Face {
  const mark = facts.mark
  if (!mark) {
    const stored = card.text ? oneLine(card.text) : 'not loaded yet'
    return { label: LABEL.mark, ...(card.source !== undefined ? { chip: card.source } : {}), lines: [{ text: stored }] }
  }
  const ref = markAnchors(mark)[0]?.ref
  const note = oneLine(mark.note)
  // A view note shows the picture with its ink (the card draws it from `facts.picture`) and its comment.
  if (mark.kind === 'note') {
    return {
      label: LABEL.mark,
      chip: mark.id,
      chipAuthor: mark.author,
      // Two lines, so that the picture keeps room on a card the size of a mark's: the comment (or what it is), and its status.
      lines: [note ? { text: note } : { text: 'view note', mono: true as const }, { text: mark.status, ...(mark.status === 'resolved' ? { tone: 'ok' as const } : {}) }],
      ...(facts.picture ? { picture: facts.picture } : {}),
      ...(facts.picture === 'missing' ? { note: PICTURE_MISSING } : {})
    }
  }
  const fails = mark.kind === 'dimension' && mark.verdict === 'fail'
  const status = [mark.status, ...(fails ? ['fails'] : []), ...(mark.anchorState === 'orphaned' ? ['anchor lost'] : [])].join(', ')
  return {
    label: LABEL.mark,
    chip: mark.id,
    chipAuthor: mark.author,
    lines: [
      { text: `${mark.kind}${ref ? ` · ${ref}` : ''}`, mono: true },
      ...(note ? [{ text: note }] : []),
      { text: status, ...(fails || mark.anchorState === 'orphaned' ? { tone: 'fail' as const } : mark.status === 'resolved' ? { tone: 'ok' as const } : {}) }
    ]
  }
}

function scanFace(card: Card, facts: Facts): Face {
  const scan = facts.scan
  if (!scan) return { label: LABEL.scan, ...(card.source !== undefined ? { chip: card.source } : {}), lines: [{ text: card.text ? oneLine(card.text) : 'not loaded yet' }] }
  const aligned = Object.keys(scan.alignments).length > 0
  return {
    label: LABEL.scan,
    chip: scan.id,
    lines: [{ text: scan.name }, { text: `${count(scan.imported.vertices)} points`, mono: true }, { text: `${aligned ? 'aligned' : 'not aligned'}, ${facts.scanVisible === false ? 'hidden' : 'shown'}` }]
  }
}

function paramLines(params: readonly Param[] | undefined): Line[] {
  if (!params) return [{ text: 'not built yet', tone: 'muted' }]
  if (params.length === 0) return [{ text: 'the model has no Params', tone: 'muted' }]
  return params.map((p) => {
    const tried = p.value !== undefined && p.value !== p.default
    return tried ? { text: `${p.name} ${said(p.value)} (tried; file ${said(p.default)})`, tone: 'tried' as const, mono: true as const } : { text: `${p.name} ${said(p.default)}`, mono: true as const }
  })
}

function checkLines(checks: readonly ModelCheck[] | undefined): Line[] {
  if (!checks) return [{ text: 'not built yet', tone: 'muted' }]
  if (checks.length === 0) return [{ text: 'the model declares no checks', tone: 'muted' }]
  return checks.map((c) => ({ text: checkText(c), tone: c.status === 'pass' ? ('ok' as const) : c.status === 'fail' || c.status === 'error' ? ('fail' as const) : ('muted' as const) }))
}

/** What a card says, from the card and what the window knows of what it shows. */
export function faceOf(card: Card, facts: Facts): Face {
  switch (card.kind) {
    case 'mark':
      return markFace(card, facts)
    case 'scan':
      return scanFace(card, facts)
    case 'brief':
      return { label: LABEL.brief, scroll: true, lines: facts.brief === null ? [{ text: 'no brief.md', tone: 'muted' }] : [], ...(typeof facts.brief === 'string' ? { body: facts.brief } : {}) }
    case 'reference': {
      const name = card.source ?? ''
      const image = IMAGE.test(name)
      if (!image) {
        // A STEP or a PDF: its name and what it is, and the person's note on it. It has no picture to show.
        const kind = /\.(?:step|stp)$/i.test(name) ? 'STEP file' : /\.pdf$/i.test(name) ? 'PDF' : 'file'
        return { label: LABEL.reference, title: name.replace(/^reference\//, ''), lines: [{ text: kind, tone: 'muted' }], ...(card.caption ? { body: card.caption } : {}) }
      }
      return { label: LABEL.reference, title: name.replace(/^reference\//, ''), lines: [], ...(card.caption ? { body: card.caption } : {}), ...(facts.picture ? { picture: facts.picture } : {}), ...(facts.picture === 'missing' ? { note: PICTURE_MISSING } : {}) }
    }
    case 'picture':
    case 'sketch':
      return {
        label: LABEL[card.kind],
        lines: [],
        ...(card.caption ? { body: card.caption } : {}),
        ...(facts.picture ? { picture: facts.picture } : {}),
        ...(facts.picture === 'missing' ? { note: PICTURE_MISSING } : {})
      }
    case 'build':
      return {
        label: LABEL.build,
        chip: card.copy?.id ?? card.source ?? '',
        lines: card.copy ? [{ text: card.copy.line }, { text: card.copy.cause, tone: 'muted' }] : [],
        ...(card.picture !== undefined && facts.picture ? { picture: facts.picture } : {}),
        ...(facts.buildHere === false ? { note: BUILD_MISSING } : {})
      }
    case 'view':
      return { label: LABEL.view, title: card.source ?? '', lines: facts.view?.note ? [{ text: facts.view.note }] : [], ...(facts.view === null ? { note: VIEW_MISSING } : {}) }
    case 'params':
      return { label: LABEL.params, lines: paramLines(facts.params) }
    case 'checks':
      return { label: LABEL.checks, lines: checkLines(facts.checks) }
    case 'text': {
      const link = firstLink(card.text ?? '')
      return { label: LABEL.text, lines: [], body: card.text ?? '', ...(link !== null ? { link } : {}) }
    }
    case 'frame':
      return { label: LABEL.frame, title: card.name ?? '', lines: [] }
    case 'size': {
      // The value and unit first, large, in the monospace face (the value as it was typed), then what it measures and where it came from.
      const size = card.size
      if (!size) return { label: LABEL.size, lines: [] }
      const unit = size.unit === '°' ? '°' : ` ${size.unit}`
      return {
        label: LABEL.size,
        lines: [{ text: `${size.value.trim()}${unit}`, mono: true, big: true }, { text: size.what }, { text: size.note ? `${size.source}: ${size.note}` : size.source, tone: 'muted' }]
      }
    }
  }
}

/** What names a mark, a scan, a build or a card (`M3`, `S2`, `h41`, `C7`) in a text. */
const REF = /\b([MSC][1-9]\d*|h[1-9]\d*)\b/g

/** A text cut at the refs in it, so that a ref is set apart (in the monospace face). */
export function refPieces(text: string): Array<{ text: string; ref?: true }> {
  const pieces: Array<{ text: string; ref?: true }> = []
  let last = 0
  for (const m of text.matchAll(REF)) {
    if (m.index > last) pieces.push({ text: text.slice(last, m.index) })
    pieces.push({ text: m[0], ref: true })
    last = m.index + m[0].length
  }
  if (last < text.length) pieces.push({ text: text.slice(last) })
  return pieces
}
