import type { DrivenIn, DrivesAnswer } from '../../shared/drives'
import type { Param, ParamValue, Scene } from '../../shared/scene'
import { type LayoutPrints, compareBuilds } from './compare'
import { nudgeOf } from './nudge'

/** What `Drives` needs of `Builds`: the last good build, a query of it that never builds again, and a trial. */
export interface DrivesDeps {
  scene(objectId: string): { revision: number; scene: Scene } | undefined
  query<T>(objectId: string, name: string, args: object, opts: { restore: false }): Promise<T>
  trial(objectId: string, set: Record<string, ParamValue>, queries: Array<{ name: string; args: object }>): Promise<
    | { ok: true; answers: Array<{ ok: true; result: unknown } | { ok: false; error: { kind: string; message: string } }> }
    | { ok: false; error: { kind: string; message: string } }
  >
}

/** Why a trial gave no answer that is not the model's: asked again at another time, it may. Never kept. */
const PASSING = new Set(['busy', 'no_room', 'cancelled', 'timeout', 'crash', 'no_build', 'bad_request'])
/** The queries one trial carries (`MOST_TRIAL_QUERIES` of the kernel is 20): one `face_prints` for each layout. */
const MOST_LAYOUTS = 20

interface Held {
  revision: number
  shown: Promise<Record<string, LayoutPrints>> | null
  answers: Map<string, Promise<DrivesAnswer>>
}

/**
 * What each field of an object's `Params` drives, found the way the agent's `try_params` and Compare build: the model is
 * built once more in a worker the kernel throws away, with that one value nudged (`nudgeOf`), and `face_prints` of that
 * build is held against those of the build on show (`compareBuilds`). Nothing of the build on show is touched: it is asked
 * with a query that never builds it again, and a build that starts cancels the trial.
 *
 * The answer is kept for the field, and the prints of the build on show for every field, until the next build of the
 * object (a new revision of its scene): a second hover is instant. A trial the kernel could not make now (busy, no room,
 * cancelled) is not kept; one the model's own error ended is, until the next build. Trials run one at a time, as the kernel
 * allows one.
 */
export class Drives {
  private readonly held = new Map<string, Held>()
  private line: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: DrivesDeps) {}

  of(objectId: string, name: string): Promise<DrivesAnswer> {
    const last = this.deps.scene(objectId)
    const param = last?.scene.params?.find((p) => p.name === name)
    if (!last) return Promise.resolve({ ok: false, message: 'There is no build to compare with yet.' })
    if (!param || !param.editable) return Promise.resolve({ ok: false, message: `${name} cannot be tried, so there is nothing to nudge.` })
    const nudged = nudgeOf(param)
    if (nudged === null) return Promise.resolve({ ok: false, message: `${name} has no other value to try.` })

    let held = this.held.get(objectId)
    if (!held || held.revision !== last.revision) {
      held = { revision: last.revision, shown: null, answers: new Map() }
      this.held.set(objectId, held)
    }
    const kept = held.answers.get(name)
    if (kept) return kept
    const mine = held
    const work = this.work(objectId, last.revision, last.scene, param, nudged, mine).then((answer) => {
      // Not kept: what passes, and what was worked out for a build that is no longer the one on show.
      if (!answer.ok && answer.passing) mine.answers.delete(name)
      return answer.ok ? answer : { ok: false as const, message: answer.message }
    })
    held.answers.set(name, work)
    return work
  }

  /** Forgets what is kept of an object (it was closed). */
  forget(objectId: string): void {
    this.held.delete(objectId)
  }

  private work(objectId: string, revision: number, scene: Scene, param: Param, nudged: ParamValue, held: Held): Promise<DrivesAnswer & { passing?: boolean }> {
    const run = async (): Promise<DrivesAnswer & { passing?: boolean }> => {
      const layouts = scene.layouts.slice(0, MOST_LAYOUTS)
      const superseded = (): boolean => this.deps.scene(objectId)?.revision !== revision
      try {
        held.shown ??= Promise.all(layouts.map((layout) => this.deps.query<{ parts: LayoutPrints }>(objectId, 'face_prints', { layout }, { restore: false }))).then((told) => Object.fromEntries(layouts.map((layout, i) => [layout, told[i].parts])))
        const shown = await held.shown
        if (superseded()) return { ok: false, message: 'The model was built again meanwhile.', passing: true }
        const trial = await this.deps.trial(objectId, { [param.name]: nudged }, layouts.map((layout) => ({ name: 'face_prints', args: { layout } })))
        if (superseded()) return { ok: false, message: 'The model was built again meanwhile.', passing: true }
        if (!trial.ok) {
          const passing = PASSING.has(trial.error.kind)
          return { ok: false, message: passing ? `Could not work this out just now (${trial.error.message}). Rest on the row again later.` : `${param.name} = ${String(nudged)} did not build: ${trial.error.message}`, passing }
        }
        const out: Record<string, DrivenIn> = {}
        for (const [i, layout] of layouts.entries()) {
          const answer = trial.answers[i]
          if (!answer?.ok) return { ok: false, message: `The build with ${param.name} = ${String(nudged)} could not be compared${answer ? `: ${answer.error.message}` : ''}`, passing: true }
          out[layout] = compareBuilds(shown[layout], (answer.result as { parts: LayoutPrints }).parts)
        }
        return { ok: true, nudged, layouts: out }
      } catch (e) {
        // The build on show was let go of, or the kernel is not there: asked again once it is.
        held.shown = null
        return { ok: false, message: e instanceof Error ? e.message : String(e), passing: true }
      }
    }
    const next = this.line.then(run, run)
    this.line = next.catch(() => undefined)
    return next
  }
}
