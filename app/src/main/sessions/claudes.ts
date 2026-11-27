import type { BuildState } from '../../shared/build'
import type { KeptCause } from '../../shared/history'
import type { Scene } from '../../shared/scene'

// The builds Claude caused, as the `Stop` of a turn goes by them (#397): told by their cause (`BuildState.made`), so
// that a save of the person's is no turn's, whenever it was made.

/** How many of Claude's builds are kept for each project: far more than a `Stop` looks back over. */
const MOST_KEPT = 20

/** What a turn is told by: when it began (ms epoch) and the prompts its tool calls were made for. */
export interface TurnOfBuilds {
  startedAt: number
  prompts: ReadonlySet<string>
}

/**
 * Whether a build that began at `startedAt` is Claude's in a turn. One that names a prompt of the turn is its whenever
 * it began; only one with no prompt to name must have begun since the turn did.
 */
export function claudesIn(made: KeptCause | undefined, startedAt: number, turn: TurnOfBuilds): boolean {
  if (made?.cause !== 'agent') return false
  return made.turn ? turn.prompts.has(made.turn.prompt) : startedAt >= turn.startedAt
}

/** A build of Claude's that ended. */
export interface ClaudesBuild {
  status: 'ok' | 'failed'
  revision: number
  /** What it failed with. */
  error?: string
  made: KeptCause
  /** Its scene, without the meshes: none for one that failed. */
  scene?: { revision: number; scene: Scene }
  startedAt: number
  /** The count of builds ended (`Sessions.finished`) when it did: a `look` before that did not see it. */
  ended: number
  /** A build after it worked, whoever's. */
  redrawn: boolean
}

export class ClaudesBuilds {
  /** By object, oldest first. A build of an earlier prompt's may come after this turn's, and hides none of them. */
  private readonly kept = new Map<string, ClaudesBuild[]>()

  /** A build ended: `state` is how, and for one of Claude's it is kept with what is given. */
  landed(state: BuildState & { status: 'ok' | 'failed' }, at: { startedAt: number; ended: number; scene?: { revision: number; scene: Scene } }): void {
    const list = this.kept.get(state.objectId) ?? []
    if (state.status === 'ok') for (const before of list) before.redrawn = true
    if (state.made?.cause !== 'agent') return
    list.push({
      status: state.status,
      revision: state.revision,
      ...(state.error ? { error: state.error.message } : {}),
      made: state.made,
      ...(at.scene ? { scene: at.scene } : {}),
      startedAt: at.startedAt,
      ended: at.ended,
      redrawn: false
    })
    if (list.length > MOST_KEPT) list.shift()
    this.kept.set(state.objectId, list)
  }

  /** The newest build of Claude's in a turn that has ended. */
  newest(objectId: string, turn: TurnOfBuilds): ClaudesBuild | undefined {
    return this.kept.get(objectId)?.findLast((one) => claudesIn(one.made, one.startedAt, turn))
  }

  /** The good build of that revision, if it is Claude's in the turn. */
  of(objectId: string, turn: TurnOfBuilds, revision: number): ClaudesBuild | undefined {
    return this.kept.get(objectId)?.findLast((one) => one.status === 'ok' && one.revision === revision && claudesIn(one.made, one.startedAt, turn))
  }
}
