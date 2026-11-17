import type { BuildState } from '../../shared/build'
import type { HistoryEntry } from '../../shared/history'
import { type Mark, MAX_NOTE } from '../../shared/marks'
import { ROUND_ID, type Round, type RoundAsk, type RoundsView, carriedRound, openRound } from '../../shared/reviews'
import type { ObjectInfo } from '../../shared/workspace'
import type { History } from '../history'
import type { MarkStore } from '../marks/store'
import { Refusal } from '../refusal'

// What the window may ask of the rounds of a review (`marks:round`, `marks:rounds`, `marks:setIntent`, `marks:roundOut`,
// `marks:judge`), as handlers that do not need Electron (`main/ipc.ts` registers them). Everything the window says is
// untrusted: a project is one that is open, a round is `R<n>`, a mark `M<n>`, and an ask is exactly one of the known shapes.
// The build a round is of is never the window's word: main finds the one on show in the history and stars it.

export interface ReviewIpcDeps {
  marks: Pick<MarkStore, 'rounds' | 'list' | 'startRound' | 'endRound' | 'reopenRound' | 'carryRound' | 'sendRound' | 'plainRound' | 'roundOut' | 'setIntent' | 'judge'>
  /** A project of the open workspace. */
  object(objectId: string): ObjectInfo | undefined
  /** Where the project's build stands. */
  build(objectId: string): BuildState | undefined
  /** `History.star`: a build that is starred is never let go. */
  history: Pick<History, 'star'>
  /** The builds the history keeps, oldest first (`readHistory`). */
  readHistory(dir: string): Promise<HistoryEntry[]>
  /** The sources hash of the last successful build of a project (`BuildLog`'s record of it), when it is known. */
  lastSources(objectId: string): string | undefined
}

const NOT_OPEN = 'That project is not open.'
const MARK_ID = /^M[1-9]\d{0,14}$/
/** The longest layout name the window may name for a round. */
const MAX_LAYOUT = 200

type Shown = Pick<Round, 'build' | 'sources' | 'line'>

/** The newest kept build, not failed, that the last successful build was made from: the one on show. Null when there is none. */
async function foundBuild(deps: ReviewIpcDeps, obj: ObjectInfo): Promise<HistoryEntry | null> {
  const sources = deps.lastSources(obj.id)
  if (sources === undefined) return null
  const kept = await deps.readHistory(obj.dir)
  for (let i = kept.length - 1; i >= 0; i--) if (kept[i].failed !== true && kept[i].sources === sources) return kept[i]
  return null
}

const toShown = (entry: HistoryEntry): Shown => ({ build: entry.id, sources: entry.sources, line: entry.line })

const NO_BUILD = 'This project has not been built yet, so there is no build to review.'
const NOT_KEPT = 'The build on show is not one the history keeps, so it cannot be reviewed. Build again.'

/**
 * The build on show, which a round is of: the newest kept build, not failed, whose sources are those of the last
 * successful build. It is starred, as pinning it to the board does, so that it is never let go while it is reviewed.
 * A `Refusal` (returned, not thrown) while a build is running or has failed, and when the history keeps no such build.
 */
export async function shownBuild(deps: ReviewIpcDeps, objectId: string): Promise<Shown | Refusal> {
  const obj = deps.object(objectId)
  if (!obj) return new Refusal(NOT_OPEN)
  const state = deps.build(objectId)
  if (!state) return new Refusal(NO_BUILD)
  if (state.status === 'building') return new Refusal('A build is running: review the build once it lands.')
  if (state.status === 'failed') return new Refusal('The last build failed: there is no build on show to review. Fix the model and build again.')
  const entry = await foundBuild(deps, obj)
  if (!entry) return new Refusal(deps.lastSources(objectId) === undefined ? NO_BUILD : NOT_KEPT)
  if (!(await deps.history.star(obj, entry.id, true)) && entry.starred !== true) return new Refusal(`${entry.id} could not be starred, so it cannot be reviewed.`)
  return toShown(entry)
}

export function reviewHandlers(deps: ReviewIpcDeps) {
  const project = (objectId: unknown): ObjectInfo => {
    const obj = typeof objectId === 'string' ? deps.object(objectId) : undefined
    if (!obj) throw new Refusal(NOT_OPEN)
    return obj
  }

  const roundId = (id: unknown): string => {
    if (typeof id !== 'string' || !ROUND_ID.test(id)) throw new Refusal('That is not a round of the project: a round is named R1, R2, …')
    return id
  }

  const markId = (id: unknown): string => {
    if (typeof id !== 'string' || !MARK_ID.test(id)) throw new Refusal('That is not a mark of the project: a mark is named M1, M2, …')
    return id
  }

  const shown = async (objectId: string): Promise<Shown> => {
    const found = await shownBuild(deps, objectId)
    if (found instanceof Refusal) throw found
    return found
  }

  return {
    /** Asks one thing of the rounds, and answers them as they are now. */
    async round(objectId: string, ask: RoundAsk): Promise<RoundsView> {
      const obj = project(objectId)
      if (typeof ask !== 'object' || ask === null || Array.isArray(ask)) throw new Refusal('That is not something to ask of a round.')
      const keys = Object.keys(ask)
      const key = keys.length === 1 ? keys[0] : ''
      const value = (ask as unknown as Record<string, unknown>)[key]
      switch (key) {
        case 'start': {
          const layout = typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 ? (value as { layout?: unknown }).layout : undefined
          if (typeof layout !== 'string' || layout === '' || layout.length > MAX_LAYOUT) throw new Refusal('A round is started on a layout: name it.')
          // A round that is open is the one the person has: no other is made, and nothing is asked of the build.
          if (!openRound((await deps.marks.rounds(obj.id)).rounds)) await deps.marks.startRound(obj.id, { layout, ...(await shown(obj.id)) })
          break
        }
        case 'end':
          await deps.marks.endRound(obj.id, roundId(value))
          break
        case 'reopen':
          await deps.marks.reopenRound(obj.id, roundId(value))
          break
        case 'carry': {
          const id = roundId(value)
          const from = (await deps.marks.rounds(obj.id)).rounds.find((round) => round.id === id)
          if (!from) throw new Refusal(`There is no round ${id} in this project.`)
          // The build is asked of only when a round is to be made: one carried into already, or another that is open, needs none.
          const rounds = (await deps.marks.rounds(obj.id)).rounds
          const ready = carriedRound(rounds, id) ?? openRound(rounds)
          await deps.marks.carryRound(obj.id, id, { layout: from.layout, ...(ready ? { build: ready.build, sources: ready.sources, line: ready.line } : await shown(obj.id)) })
          break
        }
        case 'send':
          await deps.marks.sendRound(obj.id, roundId(value))
          break
        case 'plain':
          await deps.marks.plainRound(obj.id, roundId(value))
          break
        default:
          throw new Refusal('That is not something to ask of a round: start, end, reopen, carry, send or plain.')
      }
      return deps.marks.rounds(obj.id)
    },

    /** The rounds of a project, and which is being sent. */
    async rounds(objectId: string): Promise<RoundsView> {
      return deps.marks.rounds(project(objectId).id)
    },

    /** What the person wants of a mark of theirs: `want`, `dont`, or `null` for neither. */
    async setIntent(objectId: string, id: string, intent: 'want' | 'dont' | null): Promise<Mark> {
      const obj = project(objectId)
      const mark = markId(id)
      if (intent !== null && intent !== 'want' && intent !== 'dont') throw new Refusal('An intent is want, dont, or null for neither.')
      return deps.marks.setIntent(obj.id, mark, intent)
    },

    /** Takes a mark out of its round. */
    async roundOut(objectId: string, id: string): Promise<Mark> {
      const obj = project(objectId)
      return deps.marks.roundOut(obj.id, markId(id))
    },

    /**
     * The person's verdict on an item the agent resolved, judged on the build on show. Still wrong puts the item in the
     * next round, which is made on that build (and starred) when there is none.
     */
    async judge(objectId: string, id: string, verdict: 'ok' | 'still-wrong', note?: string): Promise<Mark> {
      const obj = project(objectId)
      const mark = markId(id)
      if (verdict !== 'ok' && verdict !== 'still-wrong') throw new Refusal('A verdict is ok or still-wrong.')
      if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE)) throw new Refusal(`A note is text of at most ${MAX_NOTE} characters.`)
      const found = (await deps.marks.list(obj.id)).find((m) => m.id === mark)
      if (!found) throw new Refusal(`There is no mark ${mark} in this project.`)
      const from = found.round === undefined ? undefined : (await deps.marks.rounds(obj.id)).rounds.find((round) => round.id === found.round)
      // Still wrong asks the build to be on show, as a review does, when it makes the next round. Into one that is there
      // already, or for OK, it only names the build the person was looking at: nothing is starred, and a build that runs does not refuse it.
      const there = from === undefined ? undefined : carriedRound((await deps.marks.rounds(obj.id)).rounds, from.id)
      let on: Shown
      if (verdict === 'still-wrong' && !there) on = await shown(obj.id)
      else {
        const entry = await foundBuild(deps, obj)
        if (!entry) throw new Refusal(deps.lastSources(obj.id) === undefined ? NO_BUILD : NOT_KEPT)
        on = toShown(entry)
      }
      return deps.marks.judge(obj.id, mark, verdict, { build: on.build, ...(note !== undefined ? { note } : {}), next: { layout: from?.layout ?? found.layout, ...on } })
    }
  }
}
