import { type KeyPress, which } from '../../shared/keys'
import { number } from '../../shared/format'
import type { ObjectCard } from '../../shared/show'

// What a card of the page of objects says, in words, and how the arrow keys go from card to card. A card says
// only what it can stand by: a build is said of this run alone, and what a dimension measured in a run before is
// said as that, never as a verdict.

export type Tone = 'fail' | 'warn' | 'ok'
export interface Said { text: string; tone?: Tone }
/** How a build of this run stands, as the status line's dot says it: none for an object not opened in it. */
export type Standing = 'ok' | 'failed' | 'building' | 'idle'

/**
 * How the object's build stands: in this run (`standing`: it is then said in ink, with the status line's dot
 * before it), or that it was not opened in it; why it cannot be built in place of all of it.
 */
export function buildLine(card: ObjectCard, now: number = Date.now()): Said & { standing?: Standing; title?: string } {
  if (card.problem !== undefined) return { text: card.problem }
  const build = card.opened ? card.build : undefined
  // Not built in this run: say what the files say, when the model was last saved; the plain fact is the tooltip.
  if (!build) return card.sourcesMtimeMs === undefined ? { text: 'Not opened in this run' } : { text: `Model saved ${ago(now - card.sourcesMtimeMs)}`, title: 'Not opened in this run' }
  if (build.status === 'building') return { text: 'Building…', standing: 'building' }
  if (build.status === 'failed') return { text: build.error ? `Failed: ${build.error}` : 'Failed', tone: 'fail', standing: 'failed' }
  // Let go: the kernel holds no build of it now, whatever the last one was.
  if (build.letGo === 'memory') return { text: 'Let go to make room: built again when opened', standing: 'idle' }
  return build.status === 'ok' ? { text: `Built, r${build.revision}`, standing: 'ok' } : { text: 'Not built yet', standing: 'idle' }
}

/** How long ago, in the one unit that fits: `just now`, `5 min ago`, `3 h ago`, `12 days ago`, `4 months ago`, `2 years ago`. */
export function ago(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  const months = Math.floor(days / 30)
  if (months < 24) return `${months} months ago`
  return `${Math.floor(days / 365)} years ago`
}

/** The size of the last build of the layout pictured, as the kernel gave it: `150 × 80 × 92 mm`, with `≈` when it is the mesh's box and not the B-rep's. None when the card has no size. */
export function sizeLine(card: ObjectCard): string | null {
  const box = card.box
  if (!box || card.thumb === null) return null
  return `${box.exact ? '' : '≈ '}${number(box.x)} × ${number(box.y)} × ${number(box.z)} mm`
}

/** How long a question has waited: `waiting under 1 min`, `waiting 4 min`, `waiting 2 h`, `waiting 3 days`. */
export function waitedFor(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'waiting under 1 min'
  if (min < 60) return `waiting ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `waiting ${hours} h`
  const days = Math.floor(hours / 24)
  return `waiting ${days} ${days === 1 ? 'day' : 'days'}`
}

/** What a project of the Working shelf is doing: the build that runs, or Claude Code at work in it. */
export function workLine(card: ObjectCard): string {
  return card.opened && card.build?.status === 'building' ? 'Building…' : 'Claude Code is working'
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const DAY_OF_A_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

/** Said under a picture that is older than what its object is built from. */
export const BEHIND = 'A source has changed since'

/**
 * When the picture on the card was made (with its year when that is not this one) and what it draws otherwise
 * than the object is, and whether a source has changed since (`behind`: `BEHIND` is said under it, in the colour
 * of a warning). Null for a card with no picture.
 */
export function pictureLine(card: ObjectCard, now: Date = new Date()): { text: string; behind: boolean } | null {
  const thumb = card.thumb
  if (!thumb) return null
  const made = new Date(thumb.at)
  const day = Number.isNaN(made.getTime()) ? 'an unknown day' : (made.getFullYear() === now.getFullYear() ? DAY : DAY_OF_A_YEAR).format(made)
  const said = [`Picture of ${day}`]
  if (thumb.cut) said.push('cut by its section')
  if (thumb.apart) said.push('parts drawn apart')
  if (thumb.hidden) said.push(`${thumb.hidden} ${thumb.hidden === 1 ? 'part' : 'parts'} left out`)
  // The status says the build failed: the picture is not of that.
  if (card.opened && card.build?.status === 'failed') said.push('of the last build that worked')
  return { text: said.join(', '), behind: thumb.behind }
}

const many = (n: number, one: string, more = `${one}s`): string => `${n} ${n === 1 ? one : more}`

/** The small things a card counts: the open marks, how the dimensions stand, where the session is. None for nothing. */
export function cardChips(card: ObjectCard): Said[] {
  const chips: Said[] = []
  if (card.marks === null) chips.push({ text: 'Marks could not be read', tone: 'warn' })
  else {
    if (card.marks.open > 0) chips.push({ text: many(card.marks.open, 'open mark') })
    if (card.marks.drafts > 0) chips.push({ text: `${card.marks.drafts} not sent yet` })
  }
  const dimensions = card.dimensions
  if (dimensions) {
    if (dimensions.failing > 0) chips.push({ text: `${dimensions.failing} ${dimensions.failing === 1 ? 'dimension fails' : 'dimensions fail'}`, tone: 'fail' })
    if (dimensions.unmeasured > 0) chips.push({ text: `${dimensions.unmeasured} not measured` })
    if (dimensions.passing > 0) chips.push({ text: `${dimensions.passing} pass`, tone: 'ok' })
  } else if (card.lastRun) {
    // Of no build of this run: no verdict, and no colour of one.
    const { dimensions: open, failed } = card.lastRun
    chips.push({ text: failed > 0 ? `${many(failed, 'dimension')} failed as of its last run` : `${many(open, 'dimension')}, not measured in this run` })
  }
  if (card.session === 'needs_input') chips.push({ text: 'Session needs you', tone: 'warn' })
  else if (card.session && card.session !== 'exited') chips.push({ text: `Session ${card.session}` })
  return chips
}

/** The cards whose name holds what was typed, whatever the case; all of them, as they are, for nothing typed. */
export function matching(cards: ObjectCard[], typed: string): ObjectCard[] {
  const wanted = typed.trim().toLowerCase()
  return wanted === '' ? cards : cards.filter((card) => card.name.toLowerCase().includes(wanted))
}

/**
 * Where an arrow key, Home or End takes the focus from the card at `at` (-1 for none) among `count` cards laid
 * `columns` to a row: the index of a card, `'field'` for the field above the first row, null for a key that
 * moves nothing.
 */
export function stepCard(press: KeyPress, at: number, count: number, columns: number): number | 'field' | null {
  // Left, right, up, down, Home, End: the order of the table's row.
  const move = which(press, 'page.move')
  if (count === 0 || move < 0) return null
  if (at < 0 || at >= count) return move === 5 ? count - 1 : 0
  const row = Math.max(columns, 1)
  switch (move) {
    case 0:
      return Math.max(at - 1, 0)
    case 1:
      return Math.min(at + 1, count - 1)
    case 2:
      return at - row < 0 ? 'field' : at - row
    case 3:
      // A shorter last row: its last card stands for the one that would be under this.
      return at + row < count ? at + row : Math.floor(at / row) < Math.floor((count - 1) / row) ? count - 1 : at
    case 4:
      return 0
    default:
      return count - 1
  }
}
