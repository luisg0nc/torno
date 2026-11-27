import type { BuildState } from '../../shared/build'
import type { KeptCause } from '../../shared/history'
import type { Scene } from '../../shared/scene'

// The builds Claude caused, as the `Stop` of a turn goes by them (#397): told by their cause (`BuildState.made`), so
// that a save of the person's is no turn's, whenever it was made.

/** How many of Claude's builds are kept for each project: far more than a `Stop` looks back over. */
const MOST_KEPT = 20

/** What a turn is told by: when it began (ms epoch, and as a count of builds ended) and the prompts its tool calls were made for. */
export interface TurnOfBuilds {
  startedAt: number
  since: number
  prompts: ReadonlySet<string>
}

/**
 * Whether a build that began at `startedAt` is Claude's in a turn. One made of a save for a prompt of the turn is its
 * whenever it began; one that is only of saves with no prompt to name must have begun since the turn did.
 */
export function claudesIn(made: KeptCause | undefined, startedAt: number, turn: TurnOfBuilds): boolean {
  if (made?.cause !== 'agent') return false
  const named = [...(made.turn ? [made.turn.prompt] : []), ...(made.also ?? [])]
  if (named.some((prompt) => turn.prompts.has(prompt))) return true
  return (named.length === 0 || made.unnamed === true) && startedAt >= turn.startedAt
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

  /**
   * What a `Stop` judges: the newest build of Claude's that ended in the turn. A failure that a later build drew past
   * is nothing to mend any more, and then it is the newest of Claude's in the turn that worked: what it changed may
   * still be there, unlooked at.
   */
  judged(objectId: string, turn: TurnOfBuilds): ClaudesBuild | undefined {
    const newest = this.find(objectId, turn, () => true)
    return newest?.status === 'failed' && newest.redrawn ? this.find(objectId, turn, (one) => one.status === 'ok') : newest
  }

  /** The good build of that revision, if it is Claude's in the turn. */
  of(objectId: string, turn: TurnOfBuilds, revision: number): ClaudesBuild | undefined {
    return this.find(objectId, turn, (one) => one.status === 'ok' && one.revision === revision)
  }

  /**
   * The newest that is wanted of Claude's builds in the turn. One that had ended before the turn began is not in it,
   * whatever it names: a terminal's resumed conversation names its prompts anew.
   */
  private find(objectId: string, turn: TurnOfBuilds, wanted: (one: ClaudesBuild) => boolean): ClaudesBuild | undefined {
    return this.kept.get(objectId)?.findLast((one) => one.ended > turn.since && claudesIn(one.made, one.startedAt, turn) && wanted(one))
  }
}
