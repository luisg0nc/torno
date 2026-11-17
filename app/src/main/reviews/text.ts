import { type Mark, markIntent } from '../../shared/marks'
import { type Round, reviewName, roundItems } from '../../shared/reviews'
import { Refusal } from '../refusal'

// What Claude reads of the rounds of a project, in words: `marks` with `review`. Data, with a line per round and per item
// that says where it stands, so that what an earlier review took out is not brought back.

/** The person's words of a Still wrong, which `judge` put at the end of the note after `Still wrong in h42`. */
function stillWrongText(mark: Mark, build: string): string {
  const marker = `Still wrong in ${build}`
  const at = mark.note.lastIndexOf(marker)
  if (at < 0) return ''
  return mark.note.slice(at + marker.length).replace(/^:\s*/, '').trim()
}

/** Where an item stands, as one sentence for Claude. */
function itemSaid(mark: Mark): string {
  const judged = mark.judged
  if (judged?.verdict === 'still-wrong' && mark.status !== 'resolved') {
    const text = stillWrongText(mark, judged.build)
    return `still wrong in ${judged.build}${text === '' ? '' : `: ${text}`}`
  }
  if (mark.status !== 'resolved') return 'not answered yet'
  if (mark.resolvedBy !== 'agent') return 'resolved by the person'
  if (judged?.verdict === 'ok') return markIntent(mark) === 'dont' ? 'removed on purpose; keep it out' : 'done: the person accepted it'
  return `answered, not judged yet${mark.resolvedNote ? `: ${mark.resolvedNote}` : ''}`
}

/** Where a round stands. */
function roundState(round: Round): string {
  if (round.sentAt !== undefined) return `sent ${round.sentAt}`
  if (round.plain !== undefined) return 'let go as plain marks, never sent as a review'
  return round.endedAt === undefined ? 'open, not sent' : 'ended, not sent'
}

/**
 * The rounds Claude asked for: one by its id (`R1`), or `all`, oldest first, each with its build and its items with their
 * intent, status, resolution and judgment. An id there is none of is refused, naming the rounds there are.
 */
export function reviewData(rounds: readonly Round[], marks: readonly Mark[], which: string): object | Refusal {
  const ordered = [...rounds].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  const chosen = which === 'all' ? ordered : ordered.filter((round) => round.id === which)
  if (which !== 'all' && chosen.length === 0) return new Refusal(`no round ${which}; rounds: ${ordered.map((round) => round.id).join(', ') || 'none'}`)
  return {
    rounds: chosen.map((round) => ({
      id: round.id,
      build: round.build,
      line: round.line,
      layout: round.layout,
      startedAt: round.startedAt,
      ...(round.sentAt === undefined ? {} : { sentAt: round.sentAt }),
      ...(round.from === undefined ? {} : { from: round.from }),
      said: `${reviewName(round, marks)}; ${roundState(round)}`,
      items: roundItems(marks, round.id).map((mark) => ({
        id: mark.id,
        intent: markIntent(mark) ?? 'plain',
        note: mark.note,
        status: mark.status,
        ...(mark.resolvedNote === undefined ? {} : { resolvedNote: mark.resolvedNote }),
        ...(mark.judged === undefined ? {} : { judged: mark.judged }),
        said: itemSaid(mark)
      }))
    }))
  }
}
