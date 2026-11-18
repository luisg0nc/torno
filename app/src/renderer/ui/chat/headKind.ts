import { drawable, type HistoryEntry } from '../../../shared/history'

/** The builds a prompt made, as its head says them: none; `h40 → h41`; `h40 → failed`; `h40 → …` while one runs. `from` is the build the prompt started from, when there was one. */
export type HeadBuilds = { kind: 'none' } | { kind: 'built'; from?: string; to: string } | { kind: 'failed'; from?: string } | { kind: 'running'; from?: string }

/**
 * What the head of a prompt says of its builds, from the history's own labels (`turn.prompt`, which is the id of the
 * person's item). `ended`: the turn of the prompt is over, so that a prompt that built nothing says so; `building`: a
 * build is running now, which only the prompt still going can have started. A prompt with no build yet, going on, says
 * nothing of builds.
 */
export function headBuilds(entries: readonly HistoryEntry[], promptId: string, ended: boolean, building: boolean): HeadBuilds {
  const mine = entries.filter((e) => e.turn?.prompt === promptId)
  const first = mine.length > 0 ? entries.indexOf(mine[0]) : entries.length
  const from = entries.slice(0, first).findLast(drawable)?.id
  const base = from !== undefined ? { from } : {}
  if (!ended && building) return { kind: 'running', ...base }
  const last = mine.at(-1)
  if (!last) return { kind: 'none' }
  if (last.failed) return { kind: 'failed', ...base }
  return { kind: 'built', ...base, to: last.id }
}
