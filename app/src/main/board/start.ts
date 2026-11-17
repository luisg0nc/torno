import type { BoardFile, Card } from '../../shared/board'
import type { SizeFact } from '../../shared/size'
import { FRAME_HEADER, GAP, MADE_SIZE } from './place'
import { CARD_SIZE } from './sources'

// The board a new project starts with: what the person gave, in frames, laid out left to right. Pure; `create.ts`
// writes it into the hidden folder before the folder takes its name. The brief and reference cards are main's own,
// exactly what `reconcile` makes for the folder (so the first open changes nothing); the frames and the size, rules and
// link cards are the person's.

/** A row of frames is wrapped before it passes this width, and frames are this far apart. */
export const START_WIDTH = 3200
export const FRAME_GAP = 40

/** What a frame's cards are: the size each has, and how many to a row. */
interface Kind {
  size: { w: number; h: number }
  perRow: number
}

const REFERENCES: Kind = { size: CARD_SIZE.reference, perRow: 4 }
const RULES: Kind = { size: { w: 480, h: 320 }, perRow: 1 }
const LINKS: Kind = { size: { w: 320, h: MADE_SIZE.text.h }, perRow: 3 }

type Part = Omit<Card, 'id' | 'x' | 'y' | 'w' | 'h' | 'frame'>
interface Group {
  name: string
  kind: Kind
  parts: Part[]
}

export interface StartRequest {
  description: string
  /** The files of `reference/` that `create` wrote (`reference/photo-1.jpg`), with the person's note on each. */
  references: Array<{ file: string; note: string }>
  sizes: SizeFact[]
  rules: string
  links: Array<{ url: string; note: string }>
}

const reference = (r: { file: string; note: string }): Part => ({ kind: 'reference', by: 'torno', source: r.file, ...(r.note !== '' ? { caption: r.note } : {}) })

/** The groups of cards, in the order of the frames, only the ones that hold something. */
function groups(req: StartRequest): Group[] {
  const of = (test: RegExp): Part[] => req.references.filter((r) => test.test(r.file)).map(reference)
  const all: Group[] = [
    { name: 'Brief', kind: { size: CARD_SIZE.brief, perRow: 1 }, parts: req.description.trim() !== '' ? [{ kind: 'brief', by: 'torno', source: 'brief' }] : [] },
    { name: 'Photos', kind: REFERENCES, parts: of(/^reference\/photo-\d+\.(?:png|jpe?g|webp)$/) },
    { name: 'Doodles', kind: REFERENCES, parts: of(/^reference\/doodle-\d+\.(?:png|jpe?g|webp)$/) },
    { name: 'Sizes', kind: { size: CARD_SIZE.size, perRow: 4 }, parts: req.sizes.map((size) => ({ kind: 'size', by: 'person', size })) },
    { name: 'Rules', kind: RULES, parts: req.rules.trim() !== '' ? [{ kind: 'text', by: 'person', text: req.rules.trim() }] : [] },
    { name: 'Links', kind: LINKS, parts: req.links.map((l) => ({ kind: 'text', by: 'person', text: l.note === '' ? l.url : `${l.url}\n${l.note}` })) },
    { name: 'Bought parts', kind: REFERENCES, parts: of(/\.(?:step|stp)$/) },
    { name: 'PDFs', kind: REFERENCES, parts: of(/\.pdf$/) }
  ]
  return all.filter((g) => g.parts.length > 0)
}

/** The board of a project made from `req`: a frame for each kind of thing the person gave, cards in them, ids `C1`, `C2`, and so on. */
export function startBoard(req: StartRequest): BoardFile {
  const cards: Card[] = []
  let next = 1
  let x = 0
  let y = 0
  let rowBottom = 0
  for (const group of groups(req)) {
    const cols = Math.min(group.parts.length, group.kind.perRow)
    const rows = Math.ceil(group.parts.length / cols)
    const { w, h } = group.kind.size
    const frame = { w: 2 * GAP + cols * w + (cols - 1) * GAP, h: FRAME_HEADER + rows * h + (rows - 1) * GAP + GAP }
    if (x > 0 && x + frame.w > START_WIDTH) {
      x = 0
      y = rowBottom + FRAME_GAP
    }
    const id = `C${next++}`
    cards.push({ id, kind: 'frame', x, y, ...frame, by: 'person', name: group.name })
    for (const [i, part] of group.parts.entries()) {
      cards.push({ id: `C${next++}`, x: x + GAP + (i % cols) * (w + GAP), y: y + FRAME_HEADER + Math.floor(i / cols) * (h + GAP), w, h, frame: id, ...part })
    }
    rowBottom = Math.max(rowBottom, y + frame.h)
    x += frame.w + FRAME_GAP
  }
  return { next, cards, arrows: [] }
}
