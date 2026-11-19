import type { BuildState } from '../shared/build'

/** How long a read tool waits for a build that a save started: past it the answer says it is stale. */
export const SETTLE_MS = 15_000
/** How long it waits for a build to begin after a save, the watcher having 300 ms to report it. */
export const BEGIN_GRACE_MS = 3_000
/** The wait looks at the disk again this often, for a save the watcher has not reported. */
const RECHECK_MS = 250

export const NEWER_FILES = "the model's files are newer than this build"

export interface FreshnessPorts {
  state(objectId: string): BuildState | undefined
  /** When the latest build of the object began (ms epoch); 0 when none has. */
  startedAt(objectId: string): number
  /** When the newest file the build is made from was saved (the project's, `common/`, the files it imports); null when none can be told. */
  newestSource(objectId: string): Promise<number | null>
  now?(): number
}

/**
 * Whether what the tools say of a build is of the model as it is on disk. A save is reported by the watcher some
 * 300 ms later, and the build it starts is queued or running after that: between the save and the end of that build
 * no answer from the last build is current. `settle` waits for the build (to `SETTLE_MS`), and `newer` says whether
 * the files are newer than the latest build, as of the last time it looked.
 */
export class Freshness {
  private readonly newerFiles = new Set<string>()
  private waiters = new Set<() => void>()
  private readonly now: () => number

  constructor(private readonly ports: FreshnessPorts) {
    this.now = ports.now ?? Date.now
  }

  /** A build of an object began or ended: whoever waits looks again. */
  changed(): void {
    const waiting = this.waiters
    this.waiters = new Set()
    for (const wake of waiting) wake()
  }

  /** Whether the files of the object were newer than its latest build when `check` last looked. */
  newer(objectId: string): boolean {
    return this.newerFiles.has(objectId)
  }

  /** Looks at the disk: true when a file the build is made from was saved after the latest build began. */
  async check(objectId: string): Promise<boolean> {
    const saved = await this.ports.newestSource(objectId).catch(() => null)
    // A file time has a fraction of a millisecond that a clock reading has not: a save before the build began is not later than it.
    const newer = saved !== null && Math.floor(saved) > this.ports.startedAt(objectId)
    if (newer) this.newerFiles.add(objectId)
    else this.newerFiles.delete(objectId)
    return newer
  }

  /**
   * Resolves once the object's build is of its files as they are: none running and none due. Gives up at `limitMs`
   * (a build running), or at `graceMs` when files are newer and no build has begun; `newer` and the build's state
   * then say what is still behind.
   */
  async settle(objectId: string, limitMs = SETTLE_MS, graceMs = BEGIN_GRACE_MS): Promise<void> {
    const arrived = this.now()
    const deadline = arrived + limitMs
    const grace = arrived + graceMs
    for (;;) {
      const newer = await this.check(objectId)
      // Read after the disk: a build that began while it was looked at is a build that runs.
      const building = this.ports.state(objectId)?.status === 'building'
      if (!building && !newer) return
      const now = this.now()
      if (now >= deadline || (!building && now >= grace)) return
      await this.nextChange(Math.min(RECHECK_MS, (building ? deadline : grace) - now))
    }
  }

  private nextChange(ms: number): Promise<void> {
    return new Promise((done) => {
      const wake = (): void => {
        clearTimeout(timer)
        this.waiters.delete(wake)
        done()
      }
      const timer = setTimeout(wake, Math.max(0, ms))
      this.waiters.add(wake)
    })
  }
}
