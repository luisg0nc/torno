import { existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import { type BuildError, type BuildState, REBUILD_KEY } from '../shared/build'
import type { Scene } from '../shared/scene'
import type { ObjectInfo } from '../shared/workspace'
import { type KernelClient, KernelError } from './kernel/client'
import { FOLDER } from './own'
import { realPathOrNearest } from './sessions/inside'

const DEBOUNCE_MS = 300
// torno's own folder, and where models and tools keep what they make: exports,
// caches, environments. A model may write there while it builds.
const IGNORED_FOLDERS = new Set(['out', FOLDER, '__pycache__', 'cache', 'build', 'dist', 'node_modules', '.venv', '.git'])

/** Told the files that changed in a burst, as absolute paths. */
export type OnChange = (paths: string[]) => void

/**
 * Watch a folder and call `onChange` once per burst of changes, 300 ms after
 * the last one, with the paths that changed. Ignores dotfiles and the folders
 * named `out`, `.torno`, `__pycache__`, `cache`, `build`, `dist`,
 * `node_modules`, `.venv` and `.git`, at any depth. The folder need not exist
 * yet. Returns a function that stops the watch.
 */
export function watchFolder(dir: string, onChange: OnChange): () => void {
  let timer: NodeJS.Timeout | undefined
  let changed = new Set<string>()
  const realDir = realPathOrNearest(dir)
  // Paths come as the watcher knows them: by the real path on macOS when `dir` is reached through a link
  // (`/var` is `/private/var`), so they are taken from whichever of the two the path lies under.
  const isIgnored = (path: string): boolean => {
    let from = relative(dir, path)
    if (from.startsWith('..')) from = relative(realDir, path)
    return from.split(sep).some((part) => IGNORED_FOLDERS.has(part) || (part.startsWith('.') && part !== '..'))
  }
  const watcher = chokidarWatch(dir, {
    ignoreInitial: true,
    ignored: (path) => isIgnored(path)
  })
  watcher.on('all', (event, path) => {
    // FSEvents may tell of a change in a folder that was ignored, and of the watched folder itself.
    if (isIgnored(path) || (event === 'change' && (path === dir || path === realDir))) return
    changed.add(path)
    clearTimeout(timer)
    timer = setTimeout(() => {
      const paths = [...changed]
      changed = new Set()
      onChange(paths)
    }, DEBOUNCE_MS)
  })
  // A watch that fails (the folder became unreadable) just reports nothing more.
  watcher.on('error', () => {})
  return () => {
    clearTimeout(timer)
    void watcher.close()
  }
}

/**
 * The build timeout the person asked for in TORNO_BUILD_TIMEOUT, in seconds.
 * Undefined when it is unset or not a positive number: the kernel's default
 * then holds.
 */
export function buildTimeout(env: Record<string, string | undefined>): number | undefined {
  const text = env.TORNO_BUILD_TIMEOUT?.trim()
  if (!text) return undefined
  const seconds = Number(text)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

/** What a query that never restores is answered when the kernel holds no build of the object any more. */
export const NOT_HELD = 'the kernel no longer holds this build'

/**
 * A query that found no build to answer from because the kernel let the last one go and the model, as its
 * sources are, does not build: nothing answers until a source changes or a build is asked for. Whoever records
 * why something was not checked says that, and not only that the build is gone.
 */
export class NotBuilding extends KernelError {}

type SceneMessage = { objectId: string; revision: number; scene: Scene; blob: Buffer }
type LastGood = { revision: number; scene: Scene; blob: Buffer }

interface Entry {
  obj: ObjectInfo
  state: BuildState
  lastGood?: LastGood
  /** The successful build before `lastGood`, for `diff`; its blob is not kept. */
  previousGood?: { revision: number; scene: Scene }
  attempt: number // counts builds started; a result for an older attempt is dropped
  startedAt: number
  /** Something other than Python changed while it was building: build once more when that build ends. */
  changedMeanwhile: boolean
  /**
   * The build wanted, or running, is of sources that have not changed: the
   * kernel let go of the last one and a query needs it back (see `query`). The
   * parts on screen are what it will make, so they are not stale meanwhile.
   */
  restoring: boolean
  unwatch: Array<() => void>
  /**
   * What the last build of these sources failed with: until a source changes, or the person asks for a
   * build, building them again would fail alike, and no query starts one (see `query`).
   */
  failure?: BuildError
  /** The kernel let this object's last build go to make room when a build of it started, and none has landed since. */
  letGo: boolean
  /** Queries waiting for the next build to end, because the kernel no longer holds the last one (see `query`). */
  rebuilt?: { promise: Promise<void>; resolve: () => void; reject: (e: KernelError) => void }
}

/**
 * Build state of the open objects. Each is built when opened and again when
 * its folder, or the workspace's `common/`, changes.
 *
 * The kernel runs one build at a time: starting one cancels the one running.
 * For the same object that is what a save of its Python mid-build wants. Any
 * other file changing mid-build may be the model's own doing (a cache, an
 * export), so that build is left to finish and one more follows it: one, since
 * a model that writes such a file every time it builds would otherwise build
 * for ever. A build displaced by another object's is started again once the
 * kernel is free, the object shown in the window first.
 */
export class Builds {
  private readonly kernel: KernelClient
  private readonly watch: (dir: string, onChange: OnChange) => () => void
  private readonly now: () => number
  private readonly exists: (path: string) => boolean
  private readonly timeout: number | undefined
  private readonly entries = new Map<string, Entry>()
  private readonly buildListeners: Array<(s: BuildState) => void> = []
  private readonly sceneListeners: Array<(m: SceneMessage) => void> = []
  private running: string | null = null // the object the kernel is building
  private readonly displaced = new Set<string>()
  private shown: string | null = null

  constructor(deps: {
    kernel: KernelClient
    watch: (dir: string, onChange: OnChange) => () => void
    now?: () => number
    exists?: (path: string) => boolean
    /** Seconds a build may take; the kernel's default when left out. */
    timeout?: number
  }) {
    this.kernel = deps.kernel
    this.watch = deps.watch
    this.now = deps.now ?? Date.now
    this.exists = deps.exists ?? existsSync
    this.timeout = deps.timeout
    this.kernel.onExit(() => this.kernelStopped())
  }

  /** The object the window shows from now on: of those waiting for the kernel, it is built first. */
  show(objectId: string | null): void {
    this.shown = objectId
  }

  /**
   * Start watching and building an object. For one that is already open this
   * returns its state, building again only if its model has changed.
   */
  open(obj: ObjectInfo): BuildState {
    let entry = this.entries.get(obj.id)
    if (entry) {
      this.update(obj)
      return entry.state
    } else {
      entry = {
        obj,
        state: { objectId: obj.id, status: 'idle', revision: 0, stale: false },
        attempt: 0,
        startedAt: 0,
        changedMeanwhile: false,
        restoring: false,
        letGo: false,
        unwatch: []
      }
      this.entries.set(obj.id, entry)
      const changed: OnChange = (paths) => this.changed(obj.id, paths)
      entry.unwatch.push(this.watch(obj.dir, changed), this.watch(join(dirname(obj.dir), 'common'), changed))
    }
    this.start(entry)
    return entry.state
  }

  /**
   * An object as it is built here, given what a fresh scan says of it. While
   * the model file held for an open object still exists, it stays the model,
   * whatever else has appeared in the folder: a scratch script beside it does
   * not make the object ambiguous. Otherwise the scan's choice stands.
   */
  choice(scanned: ObjectInfo): ObjectInfo {
    const held = this.entries.get(scanned.id)?.obj
    if (!held || held.model === null || held.model === scanned.model) return scanned
    return this.exists(join(held.dir, held.model)) ? held : scanned
  }

  /**
   * Take a fresh scan of an open object. If its model is now another than the
   * one held here (see `choice`), build with the new one and return true.
   */
  update(scanned: ObjectInfo): boolean {
    const entry = this.entries.get(scanned.id)
    const obj = this.choice(scanned)
    if (!entry || (entry.obj.model === obj.model && entry.obj.problem === obj.problem)) return false
    entry.obj = obj
    entry.restoring = false
    entry.failure = undefined
    this.start(entry)
    return true
  }

  /**
   * Files of an open object, or of `common/`, changed. A build under way is
   * started again only for Python; anything else waits for it to end.
   */
  changed(objectId: string, paths: string[] = []): void {
    const entry = this.entries.get(objectId)
    if (!entry) return
    const building = entry.state.status === 'building'
    if (building && paths.length > 0 && !paths.some((path) => path.endsWith('.py'))) entry.changedMeanwhile = true
    else this.startChanged(entry)
  }

  /**
   * Build an object again by hand ("Rebuild"). Not while a build of it runs: that one is of the sources as
   * they are (a change of them starts another by itself), and starting it over would only cost its time again.
   * False when nothing was started.
   */
  rebuild(objectId: string): boolean {
    const entry = this.entries.get(objectId)
    if (!entry || entry.state.status === 'building') return false
    this.startChanged(entry)
    return true
  }

  /** Build because the sources may have changed: what is on screen is stale until it ends. */
  private startChanged(entry: Entry): void {
    entry.restoring = false
    entry.failure = undefined
    this.start(entry)
  }

  close(objectId: string): void {
    const entry = this.entries.get(objectId)
    if (!entry) return
    this.entries.delete(objectId)
    this.displaced.delete(objectId)
    for (const unwatch of entry.unwatch) unwatch()
    this.settleRebuilt(entry, new KernelError('no_build', `${objectId} was closed, so there is nothing to ask about`))
    this.abandon(objectId)
  }

  state(objectId: string): BuildState | undefined {
    return this.entries.get(objectId)?.state
  }

  /** The last successful build, whatever has happened since. */
  scene(objectId: string): LastGood | undefined {
    return this.entries.get(objectId)?.lastGood
  }

  /** The last two successful builds of an object, the older first: what `diff` compares. Empty before the first. */
  scenes(objectId: string): Array<{ revision: number; scene: Scene }> {
    const entry = this.entries.get(objectId)
    if (!entry?.lastGood) return []
    const last = { revision: entry.lastGood.revision, scene: entry.lastGood.scene }
    return entry.previousGood ? [entry.previousGood, last] : [last]
  }

  /**
   * Ask the kernel about the last successful build of an open object. Rejects
   * with a KernelError: `no_build` when the object has not been built
   * successfully yet (or is not open), or whatever kind the kernel answers with.
   *
   * The kernel keeps the builds of a few objects only, and none across a
   * restart, and lets one go to make room for the next (memory). When it no
   * longer holds this one, the object is built again and the kernel asked once
   * more; if that build fails, the rejection is its error. The build takes its
   * turn: it never stops one that is running, and queries that wait at the
   * same time share it. The sources are the ones the parts on screen were
   * built from, so that build does not make them stale.
   *
   * No build is started for sources that have just failed to build: until one
   * changes, or the person asks for a build, the rejection says that there is
   * no build to answer from, with that failure. And none at all with
   * `restore: false`, for whoever asks unasked (a check on a timer): the
   * rejection is then the kernel's `no_build`.
   */
  async query<T = unknown>(objectId: string, name: string, args: object, opts?: { restore?: boolean }): Promise<T> {
    const entry = this.entries.get(objectId)
    if (!entry?.lastGood) {
      const message = `${objectId} has not been built successfully yet, so there is nothing to ask about`
      throw new KernelError('no_build', message)
    }
    try {
      return await this.kernel.query<T>(entry.obj.dir, name, args)
    } catch (e) {
      const gone = e instanceof KernelError && e.kind === 'no_build'
      if (!gone || this.entries.get(objectId) !== entry) throw e
      // Let go to make room for another object's build: the status says so until a build of this one lands.
      if (e.reason === 'memory' && !entry.letGo) {
        entry.letGo = true
        this.set(entry, { ...entry.state })
      }
    }
    // A build of it that is running or waiting may be of sources that changed since: that one is waited for.
    const failure = entry.state.status === 'failed' && !this.displaced.has(objectId) ? entry.failure : undefined
    if (opts?.restore === false) throw failure ? new NotBuilding('no_build', NOT_HELD) : new KernelError('no_build', NOT_HELD)
    if (failure) {
      throw new NotBuilding(failure.kind, `there is no build of ${objectId} to answer from: the kernel let the last one go, and the model does not build now (${failure.message}). It is built again when a source changes, or when the user presses Rebuild in the status line of torno (${REBUILD_KEY}).`)
    }
    try {
      await this.builtAgain(entry)
    } catch (e) {
      // The build that was to answer failed: with the build's own error, known for what it is.
      if (e instanceof KernelError && this.entries.get(objectId) === entry && entry.state.status === 'failed' && entry.failure) throw new NotBuilding(e.kind, e.message, e.reason)
      throw e
    }
    return this.kernel.query<T>(entry.obj.dir, name, args)
  }

  /** For tests: as when the kernel let an object's build go to make room for another's (`letGo`), without a kernel short of memory. */
  letGoForTest(objectId: string): void {
    const entry = this.entries.get(objectId)
    if (!entry || entry.letGo) return
    entry.letGo = true
    this.set(entry, { ...entry.state })
  }

  /**
   * What the kernel says of a part, a face or an edge of the last build, for what the pointer rests on: asked
   * without ever having the object built again. A hover is no reason to build a model.
   */
  describe<T = unknown>(objectId: string, layout: string, ref: string): Promise<T> {
    return this.query<T>(objectId, 'describe', { ref: `${layout}:${ref}` }, { restore: false })
  }

  /** Resolves when the next build of an object succeeds, starting one if none is on its way; rejects with its error. */
  private builtAgain(entry: Entry): Promise<void> {
    if (!entry.rebuilt) {
      let resolve!: () => void
      let reject!: (e: KernelError) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      entry.rebuilt = { promise, resolve, reject }
      // A build of this object that is running, or waiting for its turn, will do.
      if (entry.state.status !== 'building') {
        entry.restoring = true
        if (this.running === null) this.start(entry)
        else this.displaced.add(entry.obj.id) // started when the kernel is free
      }
    }
    return entry.rebuilt.promise
  }

  private settleRebuilt(entry: Entry, error?: KernelError): void {
    const waiting = entry.rebuilt
    if (!waiting) return
    entry.rebuilt = undefined
    if (error) waiting.reject(error)
    else waiting.resolve()
  }

  on(event: 'build', cb: (s: BuildState) => void): void
  on(event: 'scene', cb: (m: SceneMessage) => void): void
  on(event: 'build' | 'scene', cb: ((s: BuildState) => void) | ((m: SceneMessage) => void)): void {
    if (event === 'build') this.buildListeners.push(cb as (s: BuildState) => void)
    else this.sceneListeners.push(cb as (m: SceneMessage) => void)
  }

  /** `followUp`: the build is started only because something other than Python changed during the last one. */
  private start(entry: Entry, followUp = false): void {
    const { obj } = entry
    const id = obj.id
    const attempt = ++entry.attempt
    const revision = entry.state.revision
    // A build for a query's sake says nothing new of the parts on screen: stale parts stay stale, fresh ones fresh.
    const stale = entry.restoring ? entry.state.stale : revision > 0
    this.displaced.delete(id)
    entry.changedMeanwhile = false // this build sees whatever changed

    if (obj.model === null) {
      const message = obj.problem ?? `no model file in ${obj.dir}`
      entry.restoring = false
      this.set(entry, { objectId: id, status: 'failed', revision, error: { kind: 'no_model', message }, stale: revision > 0 })
      this.abandon(id)
      return
    }

    // The kernel drops the build it is running for this one. Its `cancelled` may land after this build
    // has ended and the kernel is free again, when nothing would say any more that it was displaced.
    if (this.running !== null && this.running !== id) this.displaced.add(this.running)
    entry.startedAt = this.now()
    this.set(entry, { objectId: id, status: 'building', revision, startedAt: entry.startedAt, stale })
    this.running = id
    // The kernel says which builds it let go to make room for this one: when this object's own is among
    // them, nothing answers of it until this build lands, and the status says so.
    const onStarted = (started: { retired: string[] }): void => {
      // Of every open object whose build went, not only this one: the others answer nothing either, until something is asked of them.
      for (const other of this.entries.values()) {
        if (other.letGo || !started.retired.includes(other.obj.dir)) continue
        if (other === entry && (this.entries.get(id) !== entry || entry.attempt !== attempt)) continue
        other.letGo = true
        this.set(other, { ...other.state })
      }
    }
    const opts = { ...(this.timeout === undefined ? {} : { timeout: this.timeout }), onStarted }
    void this.kernel.build(obj.dir, obj.model, opts).then((result) => {
      const current = this.entries.get(id) === entry && entry.attempt === attempt
      if (current && this.running === id) this.running = null
      if (current) {
        // Cancelled while another object holds the kernel: displaced by that
        // build, and started again after it. Cancelled otherwise (the kernel was
        // shut down, or refused): a failure. Starting it again from here could
        // loop without ever yielding, since such a reply need not be a round trip.
        const displaced = !result.ok && result.error.kind === 'cancelled' && this.running !== null
        // Once: the build that follows such a change is not followed for another.
        const again = entry.changedMeanwhile && !followUp
        if (!displaced) {
          entry.restoring = false
          this.displaced.delete(id) // it ended by itself after all: there is nothing to start again
        }
        if (result.ok) this.succeeded(entry, result.scene, result.blob)
        else if (displaced) this.displaced.add(id)
        else this.failed(entry, result.error)
        // A listener may have closed the object, or started it again, by now.
        if (again && !displaced && this.entries.get(id) === entry && entry.attempt === attempt) this.start(entry, true)
      }
      // Otherwise a newer build of this object replaced this one, or the object
      // was closed: whatever the result says, it is not shown.
      this.startDisplaced()
    })
  }

  private succeeded(entry: Entry, scene: Scene, blob: Buffer): void {
    const id = entry.obj.id
    const revision = entry.state.revision + 1
    if (entry.lastGood) entry.previousGood = { revision: entry.lastGood.revision, scene: entry.lastGood.scene }
    entry.lastGood = { revision, scene, blob }
    entry.failure = undefined
    entry.letGo = false
    this.set(entry, { objectId: id, status: 'ok', revision, seconds: scene.seconds, stale: false })
    for (const cb of this.sceneListeners) cb({ objectId: id, revision, scene, blob })
  }

  private failed(entry: Entry, error: BuildError): void {
    const revision = entry.state.revision
    const seconds = (this.now() - entry.startedAt) / 1000
    entry.failure = error
    this.set(entry, { objectId: entry.obj.id, status: 'failed', revision, seconds, error, stale: revision > 0 })
  }

  private set(entry: Entry, given: BuildState): void {
    const { letGo: _was, ...rest } = given
    const state: BuildState = entry.letGo ? { ...rest, letGo: 'memory' } : rest
    entry.state = state
    if (state.status === 'ok') this.settleRebuilt(entry)
    else if (state.status === 'failed') this.settleRebuilt(entry, new KernelError(state.error?.kind ?? 'exception', state.error?.message ?? 'the build failed'))
    for (const cb of this.buildListeners) cb(state)
  }

  /** Stop the kernel's build if it is this object's, and let a displaced one run. */
  private abandon(objectId: string): void {
    if (this.running !== objectId) return
    this.running = null
    this.kernel.cancel()
    this.startDisplaced()
  }

  private startDisplaced(): void {
    if (this.running !== null) return
    const waiting = [...this.displaced]
    if (this.shown !== null && this.displaced.has(this.shown)) waiting.unshift(this.shown)
    for (const id of waiting) {
      this.displaced.delete(id)
      const entry = this.entries.get(id)
      if (entry) {
        this.start(entry)
        return
      }
    }
  }

  /** The kernel is gone and was not restarted. A later rebuild asks it to start again. */
  private kernelStopped(): void {
    this.running = null
    this.displaced.clear()
    const tail = this.kernel.stderrTail()
    for (const entry of this.entries.values()) {
      entry.attempt += 1 // nothing still on its way is shown
      const revision = entry.state.revision
      const error: BuildError = { kind: 'crash', message: 'kernel stopped', output: tail }
      this.set(entry, { objectId: entry.obj.id, status: 'failed', revision, error, stale: revision > 0 })
    }
  }
}
