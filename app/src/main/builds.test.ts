import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildError, BuildState } from '../shared/build'
import type { Scene } from '../shared/scene'
import type { ObjectInfo } from '../shared/workspace'
import { Builds, NotBuilding, buildTimeout, watchFolder } from './builds'
import { type KernelClient, KernelError, startKernel } from './kernel/client'

type BuildResult = { ok: true; scene: Scene; blob: Buffer } | { ok: false; error: BuildError }

function sceneOf(model: string, seconds = 0.5): Scene {
  return { model, layouts: ['assembly'], parts: [], seconds, output: '' }
}

/** A kernel whose builds finish when the test says so. Like the real one, a new build cancels the one running. */
class FakeKernel implements KernelClient {
  ready = Promise.resolve({ versions: {} })
  calls: Array<{ dir: string; model: string; timeout?: number; settle: (r: BuildResult) => void; settled: boolean }> = []
  cancels = 0
  tail = ''
  private exitCbs: Array<(code: number | null) => void> = []

  /** The folders whose builds the kernel lets go to make room as the next build starts. */
  retiring: string[] = []
  build(dir: string, model: string, opts?: { timeout?: number; onStarted?: (started: { retired: string[] }) => void }): Promise<BuildResult> {
    const running = this.calls.at(-1)
    if (running && !running.settled) running.settle({ ok: false, error: { kind: 'cancelled', message: 'replaced' } })
    return new Promise((resolve) => {
      const call = {
        dir,
        model,
        timeout: opts?.timeout,
        settled: false,
        settle: (r: BuildResult) => {
          call.settled = true
          resolve(r)
        }
      }
      this.calls.push(call)
      opts?.onStarted?.({ retired: this.retiring })
    })
  }
  succeed(index: number, seconds = 0.5): void {
    const call = this.calls[index]
    this.retired.delete(call.dir)
    call.settle({ ok: true, scene: sceneOf(call.model, seconds), blob: Buffer.from([index]) })
  }
  fail(index: number, error: BuildError): void {
    this.calls[index].settle({ ok: false, error })
  }
  queries: Array<{ dir: string; name: string; args: object }> = []
  /** What the next queries fail with; they are answered with what they asked when unset. */
  queryError: KernelError | null = null
  /** Folders whose worker the kernel has retired: a query there is `no_build` until the folder is built again. */
  retired = new Set<string>()
  /** Why: `memory` when the kernel says it let them go to make room. */
  retiredFor: string | undefined
  query<T>(dir: string, name: string, args: object): Promise<T> {
    this.queries.push({ dir, name, args })
    if (this.retired.has(dir)) return Promise.reject(new KernelError('no_build', `no build of ${dir} to ask`, this.retiredFor))
    return this.queryError ? Promise.reject(this.queryError) : Promise.resolve({ dir, name, args } as T)
  }
  cancel(): void {
    this.cancels += 1
    const running = this.calls.at(-1)
    if (running && !running.settled) running.settle({ ok: false, error: { kind: 'cancelled', message: 'by request' } })
  }
  dispose(): Promise<void> {
    return Promise.resolve()
  }
  onExit(cb: (code: number | null) => void): void {
    this.exitCbs.push(cb)
  }
  stderrTail(): string {
    return this.tail
  }
  stop(code: number | null): void {
    for (const cb of this.exitCbs) cb(code)
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

const bracket: ObjectInfo = { id: 'bracket', name: 'bracket', dir: '/ws/bracket', model: 'bracket.py' }
const gear: ObjectInfo = { id: 'gear', name: 'gear', dir: '/ws/gear', model: 'gear.py' }

const widget: ObjectInfo = { id: 'widget', name: 'widget', dir: '/ws/widget', model: 'widget.py' }

function setup(over: { timeout?: number; exists?: (path: string) => boolean } = {}) {
  const kernel = new FakeKernel()
  const watched = new Map<string, (paths?: string[]) => void>()
  let clock = 1000
  const builds = new Builds({
    kernel,
    watch: (dir, onChange) => {
      watched.set(dir, (paths = []) => onChange(paths))
      return () => watched.delete(dir)
    },
    now: () => clock,
    ...over
  })
  const states: BuildState[] = []
  const scenes: Array<{ objectId: string; revision: number; scene: Scene; blob: Buffer }> = []
  builds.on('build', (s) => states.push(s))
  builds.on('scene', (m) => scenes.push(m))
  return { kernel, watched, builds, states, scenes, advance: (ms: number) => (clock += ms) }
}

describe('Builds.query', () => {
  it('rejects with no_build before the first successful build, without asking the kernel', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    const building = await builds.query('bracket', 'describe', { ref: 'assembly:base' }).catch((e) => e)
    expect(building).toBeInstanceOf(KernelError)
    expect(building).toMatchObject({ kind: 'no_build', message: 'bracket has not been built successfully yet, so there is nothing to ask about' })
    kernel.fail(0, { kind: 'exception', message: 'boom' })
    await flush()
    await expect(builds.query('bracket', 'describe', {})).rejects.toMatchObject({ kind: 'no_build' })
    await expect(builds.query('never-opened', 'describe', {})).rejects.toMatchObject({ kind: 'no_build' })
    expect(kernel.queries).toEqual([])
  })

  it("passes the object's own folder, whichever object was built last", async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.open(gear)
    kernel.succeed(1)
    await flush()
    expect(await builds.query('bracket', 'describe', { ref: 'assembly:base' })).toEqual(
      { dir: '/ws/bracket', name: 'describe', args: { ref: 'assembly:base' } }
    )
    expect(await builds.query('gear', 'nearest', { layout: 'assembly', anchors: [] })).toEqual(
      { dir: '/ws/gear', name: 'nearest', args: { layout: 'assembly', anchors: [] } }
    )
    expect(kernel.queries.map((q) => q.dir)).toEqual(['/ws/bracket', '/ws/gear'])
  })

  it('still asks about the last good build while a later build runs or after one failed', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.rebuild('bracket')
    await expect(builds.query('bracket', 'describe', {})).resolves.toMatchObject({ dir: '/ws/bracket' })
    kernel.fail(1, { kind: 'exception', message: 'boom' })
    await flush()
    await expect(builds.query('bracket', 'describe', {})).resolves.toMatchObject({ dir: '/ws/bracket' })
  })

  it("rejects with the kernel's own error", async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.queryError = new KernelError('bad_ref', 'no part named x')
    await expect(builds.query('bracket', 'describe', { ref: 'assembly:x' })).rejects.toBe(kernel.queryError)
  })

  it('has nothing to ask about an object that was closed', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.close('bracket')
    await expect(builds.query('bracket', 'describe', {})).rejects.toMatchObject({ kind: 'no_build' })
  })

  it('builds the object again when the kernel has let its worker go, and asks once more', async () => {
    const { kernel, builds, scenes } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retired.add('/ws/bracket')
    const answer = builds.query('bracket', 'describe', { ref: 'assembly:base' })
    await flush()
    expect(kernel.calls).toHaveLength(2)
    expect(kernel.calls[1]).toMatchObject({ dir: '/ws/bracket', model: 'bracket.py' })
    expect(builds.state('bracket')).toMatchObject({ status: 'building', revision: 1 })
    kernel.succeed(1)
    await expect(answer).resolves.toEqual({ dir: '/ws/bracket', name: 'describe', args: { ref: 'assembly:base' } })
    expect(kernel.calls).toHaveLength(2)
    expect(kernel.queries).toHaveLength(2)
    expect(scenes.map((m) => m.revision)).toEqual([1, 2])
  })

  it('does not call the parts on screen stale while it builds unchanged sources again for a query', async () => {
    const { kernel, builds, states } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retired.add('/ws/bracket')
    const answer = builds.query('bracket', 'describe', {})
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'building', revision: 1, stale: false })
    kernel.succeed(1)
    await answer
    expect(states.slice(-2).map((s) => [s.status, s.stale])).toEqual([['building', false], ['ok', false]])
    // A build for a change is stale as ever, also the next one.
    builds.rebuild('bracket')
    expect(builds.state('bracket')).toMatchObject({ status: 'building', stale: true })
  })

  it('does not build again for a query after a build that failed: the sources are the ones that failed, and it says there is no build to answer from', async () => {
    const { kernel, builds, watched } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.rebuild('bracket')
    kernel.fail(1, { kind: 'exception', message: 'no' })
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'failed', revision: 1, stale: true })
    // With its worker alive the last good build still answers; let go (to make room), there is none.
    await expect(builds.query('bracket', 'describe', {})).resolves.toMatchObject({ dir: '/ws/bracket' })
    kernel.retired.add('/ws/bracket')
    for (let i = 0; i < 3; i++) {
      const error = (await builds.query('bracket', 'describe', {}).catch((e) => e)) as KernelError
      expect(error).toBeInstanceOf(KernelError)
      expect(error).toMatchObject({ kind: 'exception' })
      expect(error.message).toBe('there is no build of bracket to answer from: the kernel let the last one go, and the model does not build now (no). It is built again when a source changes, or when the user presses Rebuild in the status line of torno (Ctrl+Shift+B).')
      expect(error).toBeInstanceOf(NotBuilding)
    }
    // Asked unasked (a check on a timer), it is the kernel's no_build still, and is known for what it is: the model does not build.
    const unasked = (await builds.query('bracket', 'describe', {}, { restore: false }).catch((e) => e)) as KernelError
    expect(unasked).toBeInstanceOf(NotBuilding)
    expect(unasked).toMatchObject({ kind: 'no_build', message: 'the kernel no longer holds this build' })
    expect(kernel.calls).toHaveLength(2)
    expect(builds.state('bracket')).toMatchObject({ status: 'failed', revision: 1, stale: true })
    // A source changes: the failure is no longer what is known of the model.
    watched.get('/ws/bracket')!(['/ws/bracket/bracket.py'])
    const answer = builds.query('bracket', 'describe', {})
    await flush()
    expect(kernel.calls).toHaveLength(3)
    kernel.succeed(2)
    await expect(answer).resolves.toMatchObject({ dir: '/ws/bracket' })
  })

  it('never restores for a query that says not to: the kernel is asked once and its no_build is the answer', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    await expect(builds.query('bracket', 'nearest', {}, { restore: false })).resolves.toMatchObject({ name: 'nearest' })
    kernel.retired.add('/ws/bracket')
    const error = await builds.query('bracket', 'nearest', {}, { restore: false }).catch((e) => e)
    expect(error).toMatchObject({ kind: 'no_build', message: 'the kernel no longer holds this build' })
    await flush()
    expect(kernel.calls).toHaveLength(1)
    expect(builds.state('bracket')).toMatchObject({ status: 'ok' })
  })

  it('says in the build status that the kernel let the last build go to make room, until a build lands', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retiring = ['/ws/bracket', '/ws/gear']
    builds.rebuild('bracket')
    expect(builds.state('bracket')).toMatchObject({ status: 'building', letGo: 'memory' })
    // A tool asked meanwhile waits for that build.
    kernel.retired.add('/ws/bracket')
    const answer = builds.query('bracket', 'describe', {})
    await flush()
    expect(kernel.calls).toHaveLength(2)
    kernel.fail(1, { kind: 'exception', message: 'no' })
    await expect(answer).rejects.toMatchObject({ kind: 'exception', message: 'no' })
    expect(builds.state('bracket')).toMatchObject({ status: 'failed', letGo: 'memory' })
    kernel.retiring = []
    builds.rebuild('bracket')
    expect(builds.state('bracket')).toMatchObject({ status: 'building', letGo: 'memory' })
    kernel.succeed(2)
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'ok' })
    expect(builds.state('bracket')!.letGo).toBeUndefined()
  })

  it('says so of an object whose build the kernel let go for another object\'s, once a query finds it gone for that reason', async () => {
    const { kernel, builds, states } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retired.add('/ws/bracket')
    kernel.retiredFor = 'memory'
    // A check by itself: nothing is built, and the status says why nothing answers.
    await expect(builds.query('bracket', 'nearest', {}, { restore: false })).rejects.toMatchObject({ kind: 'no_build' })
    expect(builds.state('bracket')).toMatchObject({ status: 'ok', letGo: 'memory' })
    expect(states.at(-1)).toMatchObject({ status: 'ok', letGo: 'memory' })
    expect(kernel.calls).toHaveLength(1)
    // Something is asked of it: it is built again, and the status says nothing more of it once that lands.
    const answer = builds.query('bracket', 'describe', {})
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'building', letGo: 'memory', stale: false })
    kernel.succeed(1)
    await answer
    expect(builds.state('bracket')!.letGo).toBeUndefined()
  })

  // Re-review (M1): every object whose build was let go for this one says so, not only the one being built.
  it('says so of every open object the kernel let go to make room for a build, at once', async () => {
    const { kernel, builds, states } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.open(gear)
    kernel.succeed(1)
    await flush()
    kernel.retiring = ['/ws/gear', '/ws/elsewhere']
    builds.rebuild('bracket')
    expect(builds.state('gear')).toMatchObject({ status: 'ok', letGo: 'memory' })
    expect(states.filter((s) => s.objectId === 'gear').at(-1)).toMatchObject({ status: 'ok', letGo: 'memory' })
    expect(builds.state('bracket')!.letGo).toBeUndefined()
    // Until a build of it lands.
    kernel.retiring = []
    kernel.succeed(2)
    await flush()
    builds.rebuild('gear')
    kernel.succeed(3)
    await flush()
    expect(builds.state('gear')!.letGo).toBeUndefined()
  })

  // Re-review (M4): what the pointer rests on is described from the build there is, and no build is started for it.
  it('describes a ref for a hover without ever having the object built again', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    await expect(builds.describe('bracket', 'assembly', 'base/F1')).resolves.toEqual({ dir: '/ws/bracket', name: 'describe', args: { ref: 'assembly:base/F1' } })
    kernel.retired.add('/ws/bracket')
    await expect(builds.describe('bracket', 'assembly', 'base/F1')).rejects.toMatchObject({ kind: 'no_build', message: 'the kernel no longer holds this build' })
    await flush()
    expect(kernel.calls).toHaveLength(1)
  })

  it('says nothing of memory when the kernel let go only the builds of other objects', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retiring = ['/ws/gear']
    builds.rebuild('bracket')
    expect(builds.state('bracket')!.letGo).toBeUndefined()
  })

  it('calls them stale once the sources change during that build', async () => {
    const { kernel, builds, watched } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retired.add('/ws/bracket')
    const answer = builds.query('bracket', 'describe', {})
    await flush()
    watched.get('/ws/bracket')!(['/ws/bracket/bracket.py'])
    expect(builds.state('bracket')).toMatchObject({ status: 'building', stale: true })
    await flush()
    kernel.succeed(2)
    await expect(answer).resolves.toMatchObject({ dir: '/ws/bracket' })
  })

  it('does not call them stale either when that build had to wait for the kernel', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.open(gear)
    kernel.retired.add('/ws/bracket')
    const answer = builds.query('bracket', 'describe', {})
    await flush()
    kernel.succeed(1)
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'building', revision: 1, stale: false })
    kernel.succeed(2)
    await answer
  })

  it('builds once for queries that find the worker gone at the same time', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retired.add('/ws/bracket')
    const first = builds.query('bracket', 'describe', { ref: 'assembly:base' })
    const second = builds.query('bracket', 'describe', { ref: 'assembly:post' })
    await flush()
    // And one that finds it gone while that build runs.
    const third = builds.query('bracket', 'describe', { ref: 'assembly:base/F1' })
    await flush()
    expect(kernel.calls).toHaveLength(2)
    kernel.succeed(1)
    await expect(first).resolves.toMatchObject({ args: { ref: 'assembly:base' } })
    await expect(second).resolves.toMatchObject({ args: { ref: 'assembly:post' } })
    await expect(third).resolves.toMatchObject({ args: { ref: 'assembly:base/F1' } })
    expect(kernel.calls).toHaveLength(2)
  })

  it('rejects with the error of the build when the object does not build again', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retired.add('/ws/bracket')
    const answer = builds.query('bracket', 'describe', {}).catch((e) => e)
    await flush()
    kernel.fail(1, { kind: 'exception', message: 'NameError: name x is not defined' })
    const error = await answer
    expect(error).toBeInstanceOf(KernelError)
    expect(error).toMatchObject({ kind: 'exception', message: 'NameError: name x is not defined' })
    expect(kernel.queries).toHaveLength(1) // not asked again
    // The next query does not build it once more: nothing has changed since it failed.
    const again = (await builds.query('bracket', 'describe', {}).catch((e) => e)) as KernelError
    await flush()
    expect(kernel.calls).toHaveLength(2)
    expect(again).toMatchObject({ kind: 'exception' })
    expect(again.message).toContain('NameError: name x is not defined')
    // Until the person asks for a build.
    builds.rebuild('bracket')
    kernel.succeed(2)
    await flush()
    await expect(builds.query('bracket', 'describe', {})).resolves.toMatchObject({ dir: '/ws/bracket' })
  })

  it('rejects with what the kernel says if the worker is gone again after the build', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retired.add('/ws/bracket')
    const answer = builds.query('bracket', 'describe', {}).catch((e) => e)
    await flush()
    kernel.calls[1].settle({ ok: true, scene: sceneOf('bracket.py'), blob: Buffer.from([1]) }) // built, yet still retired
    expect(await answer).toMatchObject({ kind: 'no_build' })
    expect(kernel.calls).toHaveLength(2) // one rebuild, no more
  })

  it("waits for another object's build instead of cancelling it", async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.open(gear)
    kernel.retired.add('/ws/bracket')
    let settled = false
    const answer = builds.query('bracket', 'describe', {}).finally(() => (settled = true))
    await flush()
    expect(kernel.calls).toHaveLength(2) // only gear's
    expect(kernel.calls[1]).toMatchObject({ dir: '/ws/gear', settled: false })
    expect(kernel.cancels).toBe(0)
    kernel.succeed(1)
    await flush()
    expect(builds.state('gear')).toMatchObject({ status: 'ok', revision: 1 })
    expect(kernel.calls[2]).toMatchObject({ dir: '/ws/bracket' })
    expect(settled).toBe(false)
    kernel.succeed(2)
    await expect(answer).resolves.toMatchObject({ dir: '/ws/bracket' })
  })

  it('waits for a build of the same object that is already running', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.rebuild('bracket')
    kernel.retired.add('/ws/bracket')
    const answer = builds.query('bracket', 'describe', {})
    await flush()
    expect(kernel.calls).toHaveLength(2)
    expect(kernel.calls[1].settled).toBe(false)
    kernel.succeed(1)
    await expect(answer).resolves.toMatchObject({ dir: '/ws/bracket' })
  })

  it('rejects a query that waits for a build when the object is closed', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    kernel.retired.add('/ws/bracket')
    const answer = builds.query('bracket', 'describe', {}).catch((e) => e)
    await flush()
    builds.close('bracket')
    expect(await answer).toMatchObject({ kind: 'no_build' })
  })
})

describe('Builds', () => {
  it('starts a build as soon as an object is opened', () => {
    const { kernel, builds, states } = setup()
    const state = builds.open(bracket)
    expect(state).toEqual({ objectId: 'bracket', status: 'building', revision: 0, startedAt: 1000, stale: false })
    expect(kernel.calls).toMatchObject([{ dir: '/ws/bracket', model: 'bracket.py' }])
    expect(states).toEqual([state])
    expect(builds.state('bracket')).toEqual(state)
    expect(builds.scene('bracket')).toBeUndefined()
  })

  it('goes to ok with the next revision and emits the scene when a build succeeds', async () => {
    const { kernel, builds, states, scenes } = setup()
    builds.open(bracket)
    kernel.succeed(0, 1.25)
    await flush()
    expect(builds.state('bracket')).toEqual({ objectId: 'bracket', status: 'ok', revision: 1, seconds: 1.25, stale: false })
    expect(states.map((s) => s.status)).toEqual(['building', 'ok'])
    expect(scenes).toHaveLength(1)
    expect(scenes[0]).toMatchObject({ objectId: 'bracket', revision: 1, scene: { model: 'bracket.py' } })
    expect(builds.scene('bracket')).toEqual({ revision: 1, scene: scenes[0].scene, blob: scenes[0].blob })
    expect(builds.scenes('bracket')).toEqual([{ revision: 1, scene: scenes[0].scene }])
  })

  it('keeps the last two successful scenes, oldest first, through a failure', async () => {
    const { kernel, builds, scenes } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.changed('bracket', ['/ws/bracket/bracket.py'])
    kernel.fail(1, { kind: 'exception', message: 'boom' })
    await flush()
    builds.changed('bracket', ['/ws/bracket/bracket.py'])
    kernel.succeed(2)
    await flush()
    builds.changed('bracket', ['/ws/bracket/bracket.py'])
    kernel.succeed(3)
    await flush()
    expect(builds.scenes('bracket').map((s) => s.revision)).toEqual([2, 3])
    expect(builds.scenes('bracket').map((s) => s.scene)).toEqual([scenes[1].scene, scenes[2].scene])
    expect(builds.scenes('nothing')).toEqual([])
  })

  it('goes to failed with the error when the first build fails, with nothing stale on screen', async () => {
    const { kernel, builds, advance } = setup()
    builds.open(bracket)
    advance(2000)
    kernel.fail(0, { kind: 'exception', message: 'boom', traceback: 'tb' })
    await flush()
    expect(builds.state('bracket')).toEqual({
      objectId: 'bracket',
      status: 'failed',
      revision: 0,
      seconds: 2,
      error: { kind: 'exception', message: 'boom', traceback: 'tb' },
      stale: false
    })
  })

  it('keeps the revision and marks it stale while rebuilding after a success', async () => {
    const { kernel, builds, advance } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    advance(500)
    builds.rebuild('bracket')
    expect(builds.state('bracket')).toEqual({ objectId: 'bracket', status: 'building', revision: 1, startedAt: 1500, stale: true })
    kernel.succeed(1)
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'ok', revision: 2, stale: false })
    expect(builds.scene('bracket')?.revision).toBe(2)
  })

  it('keeps the last good scene, marked stale, when a build fails after a success', async () => {
    const { kernel, builds, scenes } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.rebuild('bracket')
    kernel.fail(1, { kind: 'crash', message: 'the build process was killed by SIGSEGV' })
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'failed', revision: 1, stale: true, error: { kind: 'crash' } })
    expect(builds.scene('bracket')?.revision).toBe(1)
    expect(scenes).toHaveLength(1)

    // The next save builds normally.
    builds.rebuild('bracket')
    kernel.succeed(2)
    await flush()
    expect(builds.state('bracket')).toEqual({ objectId: 'bracket', status: 'ok', revision: 2, seconds: 0.5, stale: false })
  })

  it('rebuilds when the object folder or the common folder changes', () => {
    const { kernel, builds, watched } = setup()
    builds.open(bracket)
    expect([...watched.keys()]).toEqual(['/ws/bracket', '/ws/common'])
    watched.get('/ws/bracket')!()
    watched.get('/ws/common')!()
    expect(kernel.calls).toHaveLength(3)
  })

  it('shows only the second build when a change arrives mid-build', async () => {
    const { kernel, builds, watched, states, scenes } = setup()
    builds.open(bracket)
    watched.get('/ws/bracket')!() // the kernel cancels build 0
    await flush()
    expect(builds.state('bracket')?.status).toBe('building')
    kernel.succeed(1)
    await flush()
    expect(kernel.calls).toHaveLength(2)
    expect(scenes).toHaveLength(1)
    expect(scenes[0].blob).toEqual(Buffer.from([1]))
    expect(states.map((s) => s.status)).toEqual(['building', 'building', 'ok'])
    expect(builds.state('bracket')?.revision).toBe(1)
  })

  it('ignores the result of a build that a newer one has replaced, whatever it says', async () => {
    const { kernel, builds, scenes } = setup()
    builds.open(bracket)
    const old = kernel.calls[0]
    // A source changed: another build takes its place. (Rebuild by hand starts none while one runs.)
    builds.changed('bracket')
    // The old build's success was already on its way when the new one was requested.
    old.settle({ ok: true, scene: sceneOf('old'), blob: Buffer.from([9]) })
    await flush()
    expect(scenes).toHaveLength(0)
    expect(builds.state('bracket')).toMatchObject({ status: 'building', revision: 0 })
  })

  it('fails an object with no model without calling the kernel', () => {
    const { kernel, builds, watched, states } = setup()
    const two: ObjectInfo = { id: 'two', name: 'two', dir: '/ws/two', model: null, problem: 'more than one model file in /ws/two: a.py, b.py' }
    const state = builds.open(two)
    expect(state).toEqual({
      objectId: 'two',
      status: 'failed',
      revision: 0,
      error: { kind: 'no_model', message: 'more than one model file in /ws/two: a.py, b.py' },
      stale: false
    })
    expect(states).toEqual([state])
    watched.get('/ws/two')!()
    builds.rebuild('two')
    expect(kernel.calls).toHaveLength(0)
  })

  it('builds again with the new model when an open object is opened with different info', async () => {
    const { kernel, builds } = setup()
    builds.open({ ...bracket, model: null, problem: 'no model file in /ws/bracket' })
    expect(builds.open(bracket).status).toBe('building')
    expect(kernel.calls).toMatchObject([{ model: 'bracket.py' }])
    // Opening it again unchanged neither rebuilds nor watches twice.
    kernel.succeed(0)
    await flush()
    expect(builds.open(bracket).status).toBe('ok')
    expect(kernel.calls).toHaveLength(1)
  })

  it('stops watching and reporting an object once it is closed', async () => {
    const { kernel, builds, watched, states, scenes } = setup()
    builds.open(bracket)
    builds.close('bracket')
    expect(watched.size).toBe(0)
    expect(kernel.cancels).toBe(1)
    await flush()
    expect(builds.state('bracket')).toBeUndefined()
    expect(builds.scene('bracket')).toBeUndefined()
    expect(states.map((s) => s.status)).toEqual(['building'])
    expect(scenes).toHaveLength(0)
    builds.rebuild('bracket')
    expect(kernel.calls).toHaveLength(1)
  })

  it('does not cancel another object\'s build when closing one that is not building', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.open(gear)
    builds.close('bracket')
    expect(kernel.cancels).toBe(0)
  })

  it('rebuilds an object whose build another object displaced, once the kernel is free', async () => {
    const { kernel, builds, scenes } = setup()
    builds.open(bracket)
    builds.open(gear) // the kernel runs one build at a time: bracket's is cancelled
    await flush()
    expect(kernel.calls.map((c) => c.model)).toEqual(['bracket.py', 'gear.py'])
    expect(builds.state('bracket')?.status).toBe('building')
    kernel.succeed(1)
    await flush()
    expect(kernel.calls.map((c) => c.model)).toEqual(['bracket.py', 'gear.py', 'bracket.py'])
    expect(builds.state('gear')?.status).toBe('ok')
    kernel.succeed(2)
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'ok', revision: 1 })
    expect(scenes.map((s) => s.objectId)).toEqual(['gear', 'bracket'])
  })

  it('rebuilds a displaced object even when the displacing build ends before the cancelled reply lands', async () => {
    // A kernel whose `cancelled` for the build it replaced arrives late: after the build that replaced it has ended.
    class LateKernel extends FakeKernel {
      override build(dir: string, model: string, opts?: { timeout?: number; onStarted?: () => void }): Promise<BuildResult> {
        const running = this.calls.at(-1)
        const was = running?.settled
        if (running) running.settled = true // the base class then leaves it unanswered
        const promise = super.build(dir, model, opts)
        if (running) running.settled = was ?? false
        return promise
      }
    }
    const kernel = new LateKernel()
    const builds = new Builds({ kernel, watch: () => () => {} })
    builds.open(bracket)
    builds.open(gear)
    kernel.fail(1, { kind: 'exception', message: 'gear does not build' })
    await flush()
    // The kernel is free, and bracket has it again, though nothing has said yet that its first build was cancelled.
    expect(kernel.calls.map((c) => c.model)).toEqual(['bracket.py', 'gear.py', 'bracket.py'])
    kernel.calls[0].settle({ ok: false, error: { kind: 'cancelled', message: 'replaced' } })
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'building' })
    kernel.succeed(2)
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'ok', revision: 1 })
  })

  it('fails a build the kernel refuses, rather than starting it again for ever', async () => {
    // What a kernel that has been shut down answers: `cancelled`, at once, every time.
    class RefusingKernel extends FakeKernel {
      refused = 0
      override build(): Promise<BuildResult> {
        this.refused += 1
        if (this.refused > 1000) throw new Error('restart loop')
        return Promise.resolve({ ok: false, error: { kind: 'cancelled', message: 'the kernel was shut down' } })
      }
    }
    const kernel = new RefusingKernel()
    const builds = new Builds({ kernel, watch: () => () => {} })
    builds.open(bracket)
    builds.open(gear)
    // A timer only fires if the event loop is let run.
    await new Promise((resolve) => setTimeout(resolve, 20))
    // One each, and bracket once more: gear's build had taken the kernel from it.
    expect(kernel.refused).toBe(3)
    for (const id of ['bracket', 'gear']) {
      expect(builds.state(id)).toMatchObject({
        status: 'failed',
        revision: 0,
        error: { kind: 'cancelled', message: 'the kernel was shut down' }
      })
    }
  })

  it('fails a build that was cancelled while no other object holds the kernel', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.cancel()
    await flush()
    expect(kernel.calls).toHaveLength(1)
    expect(builds.state('bracket')).toMatchObject({ status: 'failed', error: { kind: 'cancelled' } })
    // The next save builds normally.
    builds.rebuild('bracket')
    kernel.succeed(1)
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'ok', revision: 1 })
  })

  it('update: builds again only when the scan chose differently from what it holds', async () => {
    const { kernel, builds } = setup()
    const two: ObjectInfo = { id: 'two', name: 'two', dir: '/ws/two', model: null, problem: 'more than one model file in /ws/two: a.py, b.py' }
    builds.open(two)
    expect(builds.state('two')).toMatchObject({ status: 'failed', error: { kind: 'no_model' } })
    // The same answer again is no change, whoever else has scanned in between.
    expect(builds.update({ ...two })).toBe(false)
    expect(kernel.calls).toHaveLength(0)
    expect(builds.update({ id: 'two', name: 'two', dir: '/ws/two', model: 'a.py' })).toBe(true)
    expect(kernel.calls).toMatchObject([{ dir: '/ws/two', model: 'a.py' }])
    kernel.succeed(0)
    await flush()
    expect(builds.state('two')).toMatchObject({ status: 'ok', revision: 1 })
    // An object that is not open is none of its business.
    expect(builds.update(gear)).toBe(false)
    expect(builds.state('gear')).toBeUndefined()
  })

  it('fails every open object with the stderr tail when the kernel stops for good', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    kernel.succeed(0)
    await flush()
    builds.open(gear)
    kernel.fail(1, { kind: 'crash', message: 'the kernel exited' })
    await flush()
    kernel.tail = 'ModuleNotFoundError: build123d'
    kernel.stop(1)
    const error = { kind: 'crash', message: 'kernel stopped', output: 'ModuleNotFoundError: build123d' }
    expect(builds.state('bracket')).toMatchObject({ status: 'failed', revision: 1, stale: true, error })
    expect(builds.state('gear')).toMatchObject({ status: 'failed', revision: 0, stale: false, error })
    expect(builds.scene('bracket')?.revision).toBe(1)
  })
  describe('a change while the object is building', () => {
    it('restarts the build when a .py file changed', async () => {
      const { kernel, builds, watched } = setup()
      builds.open(bracket)
      watched.get('/ws/bracket')!(['/ws/bracket/notes.txt', '/ws/bracket/bracket.py'])
      await flush()
      expect(kernel.calls).toHaveLength(2)
      expect(kernel.calls[0].settled).toBe(true) // cancelled by the second
      watched.get('/ws/common')!(['/ws/common/screws.py'])
      expect(kernel.calls).toHaveLength(3)
    })

    it('lets the build finish when anything else changed, then builds once more', async () => {
      const { kernel, builds, watched, scenes } = setup()
      builds.open(bracket)
      // What a model writes while it builds: a cache, an export.
      watched.get('/ws/bracket')!(['/ws/bracket/mesh.brep.4242.tmp'])
      watched.get('/ws/bracket')!(['/ws/bracket/mesh.brep', '/ws/bracket/part.step'])
      await flush()
      expect(kernel.calls).toHaveLength(1)
      expect(kernel.calls[0].settled).toBe(false)
      expect(builds.state('bracket')?.status).toBe('building')

      kernel.succeed(0)
      await flush()
      // The build's own result is shown, and one more build follows it.
      expect(scenes.map((m) => m.revision)).toEqual([1])
      expect(kernel.calls).toHaveLength(2)
      expect(builds.state('bracket')).toMatchObject({ status: 'building', revision: 1, stale: true })

      kernel.succeed(1)
      await flush()
      expect(kernel.calls).toHaveLength(2)
      expect(builds.state('bracket')).toMatchObject({ status: 'ok', revision: 2 })
    })

    it('builds once more after a build that failed, too', async () => {
      const { kernel, builds, watched } = setup()
      builds.open(bracket)
      watched.get('/ws/bracket')!(['/ws/bracket/data.csv'])
      kernel.fail(0, { kind: 'exception', message: 'data.csv is half written' })
      await flush()
      expect(kernel.calls).toHaveLength(2)
      kernel.succeed(1)
      await flush()
      expect(kernel.calls).toHaveLength(2)
      expect(builds.state('bracket')).toMatchObject({ status: 'ok', revision: 1 })
    })

    it('forgets what it remembered when a .py change restarts the build anyway', async () => {
      const { kernel, builds, watched } = setup()
      builds.open(bracket)
      watched.get('/ws/bracket')!(['/ws/bracket/data.csv'])
      watched.get('/ws/bracket')!(['/ws/bracket/bracket.py'])
      await flush()
      kernel.succeed(1)
      await flush()
      expect(kernel.calls).toHaveLength(2)
      expect(builds.state('bracket')?.status).toBe('ok')
    })

    it('does not build a third time when the follow-up build is itself followed by such a change', async () => {
      const { kernel, builds, watched } = setup()
      builds.open(bracket)
      // A model that writes a cache every time it builds.
      watched.get('/ws/bracket')!(['/ws/bracket/mesh.brep'])
      kernel.succeed(0)
      await flush()
      expect(kernel.calls).toHaveLength(2)
      watched.get('/ws/bracket')!(['/ws/bracket/mesh.brep'])
      kernel.succeed(1)
      await flush()
      expect(kernel.calls).toHaveLength(2)
      expect(builds.state('bracket')).toMatchObject({ status: 'ok', revision: 2, stale: false })
      // A change after it has ended builds as ever.
      watched.get('/ws/bracket')!(['/ws/bracket/data.csv'])
      expect(kernel.calls).toHaveLength(3)
    })

    it('still restarts a follow-up build when Python changes during it', async () => {
      const { kernel, builds, watched } = setup()
      builds.open(bracket)
      watched.get('/ws/bracket')!(['/ws/bracket/mesh.brep'])
      kernel.succeed(0)
      await flush()
      watched.get('/ws/bracket')!(['/ws/bracket/bracket.py'])
      await flush()
      expect(kernel.calls).toHaveLength(3)
      // That one is a build of its own: a change during it is followed up once more.
      watched.get('/ws/bracket')!(['/ws/bracket/mesh.brep'])
      kernel.succeed(2)
      await flush()
      expect(kernel.calls).toHaveLength(4)
    })

    it('rebuilds at once for any change when the object is not building', async () => {
      const { kernel, builds, watched } = setup()
      builds.open(bracket)
      kernel.succeed(0)
      await flush()
      watched.get('/ws/bracket')!(['/ws/bracket/data.csv'])
      expect(kernel.calls).toHaveLength(2)
    })
  })

  describe('the model of an open object', () => {
    const scratch: ObjectInfo = { ...bracket, model: null, problem: 'more than one model file in /ws/bracket: bracket.py, scratch.py' }

    it('stays the one it builds while that file exists, whatever else appears in the folder', async () => {
      const { kernel, builds } = setup({ exists: (path) => path === '/ws/bracket/bracket.py' })
      builds.open(bracket)
      kernel.succeed(0)
      await flush()
      // The agent wrote a scratch script beside the model: a fresh scan cannot choose.
      expect(builds.choice(scratch)).toEqual(bracket)
      expect(builds.update(scratch)).toBe(false)
      expect(builds.open(scratch)).toMatchObject({ status: 'ok', revision: 1 })
      expect(kernel.calls).toHaveLength(1)
      // A save still builds the model it holds.
      builds.rebuild('bracket')
      expect(kernel.calls.at(-1)).toMatchObject({ dir: '/ws/bracket', model: 'bracket.py' })
      expect(builds.state('bracket')?.status).toBe('building')
    })

    it('is chosen afresh once the file it built is gone', () => {
      const { kernel, builds } = setup({ exists: () => false })
      builds.open(bracket)
      const renamed: ObjectInfo = { ...bracket, model: 'holder.py' }
      expect(builds.choice(renamed)).toEqual(renamed)
      expect(builds.update(renamed)).toBe(true)
      expect(kernel.calls.at(-1)).toMatchObject({ model: 'holder.py' })
    })

    it('is whatever the scan says for an object that had none', () => {
      const { builds } = setup({ exists: () => true })
      builds.open(scratch)
      expect(builds.choice(bracket)).toEqual(bracket)
      expect(builds.update(bracket)).toBe(true)
      // An object that is not open is none of its business.
      expect(builds.choice(gear)).toEqual(gear)
    })
  })

  it('builds the object shown in the window first when several wait for the kernel', async () => {
    const { kernel, builds } = setup()
    builds.show('bracket')
    builds.open(bracket)
    builds.show('gear')
    builds.open(gear) // displaces bracket
    builds.show('widget')
    builds.open(widget) // displaces gear
    await flush()
    // The person goes back to gear while widget builds: bracket and gear both wait.
    builds.show('gear')
    kernel.succeed(2)
    await flush()
    expect(kernel.calls.map((c) => c.model)).toEqual(['bracket.py', 'gear.py', 'widget.py', 'gear.py'])
    kernel.succeed(3)
    await flush()
    expect(kernel.calls.map((c) => c.model)).toEqual(['bracket.py', 'gear.py', 'widget.py', 'gear.py', 'bracket.py'])
  })

  it('passes the build timeout it was given to the kernel, and none when it was given none', () => {
    const timed = setup({ timeout: 1200 })
    timed.builds.open(bracket)
    expect(timed.kernel.calls[0].timeout).toBe(1200)
    const plain = setup()
    plain.builds.open(bracket)
    expect(plain.kernel.calls[0].timeout).toBeUndefined()
  })

  it('fails an object of a workspace with a pyproject.toml and no .venv, and creates nothing there', async () => {
    const root = mkdtempSync(join(tmpdir(), 'torno-novenv-'))
    try {
      writeFileSync(join(root, 'pyproject.toml'), '[project]\nname = "ws"\nversion = "0"\n')
      mkdirSync(join(root, 'part'))
      writeFileSync(join(root, 'part', 'part.py'), 'x = 1\n')
      const kernel = startKernel({ workspaceRoot: root, hasProject: true, kernelDir: '/nonexistent/kernel' })
      const builds = new Builds({ kernel, watch: () => () => {} })
      builds.open({ id: 'part', name: 'part', dir: join(root, 'part'), model: 'part.py' })
      await flush()
      expect(builds.state('part')).toMatchObject({
        status: 'failed',
        revision: 0,
        error: { kind: 'crash', message: `This workspace has a pyproject.toml but no .venv. Run \`uv sync\` in ${root} once, then reopen it.` }
      })
      // Asked again, it answers the same: there is no kernel to restart.
      builds.rebuild('part')
      await flush()
      expect(builds.state('part')).toMatchObject({ status: 'failed', error: { kind: 'crash' } })
      expect(kernel.pid).toBeUndefined()
      await kernel.dispose()
      expect(readdirSync(root).sort()).toEqual(['part', 'pyproject.toml'])
      expect(readdirSync(join(root, 'part'))).toEqual(['part.py'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('buildTimeout', () => {
  it('reads TORNO_BUILD_TIMEOUT as seconds', () => {
    expect(buildTimeout({ TORNO_BUILD_TIMEOUT: '1200' })).toBe(1200)
    expect(buildTimeout({ TORNO_BUILD_TIMEOUT: '90.5' })).toBe(90.5)
  })

  it('leaves the kernel its default when the variable is unset or makes no sense', () => {
    for (const value of [undefined, '', 'soon', '0', '-5', 'Infinity', 'NaN']) {
      expect(buildTimeout({ TORNO_BUILD_TIMEOUT: value })).toBeUndefined()
    }
  })
})

describe('watchFolder', () => {
  let dir: string
  let stop: (() => void) | undefined
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'torno-watch-'))
    mkdirSync(join(dir, 'obj', 'out'), { recursive: true })
    mkdirSync(join(dir, 'obj', '.torno'))
    mkdirSync(join(dir, 'obj', '__pycache__'))
    writeFileSync(join(dir, 'obj', 'model.py'), 'x = 1\n')
  })
  afterEach(() => {
    stop?.()
    stop = undefined
    rmSync(dir, { recursive: true, force: true })
  })

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  async function watching(path: string): Promise<{ changes: () => number; paths: () => string[][] }> {
    const bursts: string[][] = []
    stop = watchFolder(path, (paths) => bursts.push(paths))
    await sleep(150) // let the watcher settle on what is already there
    if (process.platform === 'darwin') {
      // FSEvents replays what was written just before the watch began (the files this test made): let it, and drop it.
      await sleep(700)
      bursts.length = 0
    }
    return { changes: () => bursts.length, paths: () => bursts }
  }

  it('reports a burst of saves once, after the debounce', async () => {
    const { changes } = await watching(join(dir, 'obj'))
    writeFileSync(join(dir, 'obj', 'model.py'), 'x = 2\n')
    await sleep(100)
    writeFileSync(join(dir, 'obj', 'model.py'), 'x = 3\n')
    writeFileSync(join(dir, 'obj', 'notes.txt'), 'hello')
    await sleep(200)
    expect(changes()).toBe(0) // still inside the 300 ms after the last change
    await sleep(400)
    expect(changes()).toBe(1)
  })

  it('says which files changed in the burst', async () => {
    const { paths } = await watching(join(dir, 'obj'))
    writeFileSync(join(dir, 'obj', 'model.py'), 'x = 2\n')
    writeFileSync(join(dir, 'obj', 'model.py'), 'x = 3\n')
    writeFileSync(join(dir, 'obj', 'notes.txt'), 'hello')
    await sleep(600)
    expect(paths().map((burst) => [...burst].sort())).toEqual([[join(dir, 'obj', 'model.py'), join(dir, 'obj', 'notes.txt')]])
  })

  it('ignores what a model or a tool keeps in cache/, build/, dist/, node_modules/, .venv/ and .git/', async () => {
    for (const folder of ['cache', 'build', 'dist', 'node_modules', '.venv', '.git']) mkdirSync(join(dir, 'obj', folder))
    const { changes } = await watching(join(dir, 'obj'))
    // As micra-spoiler does while it builds: written under a temporary name, then renamed.
    const temp = join(dir, 'obj', 'cache', `hatch.brep.${process.pid}.tmp`)
    writeFileSync(temp, 'a'.repeat(1 << 16))
    renameSync(temp, join(dir, 'obj', 'cache', 'hatch.brep'))
    mkdirSync(join(dir, 'obj', 'cache', 'deep'))
    writeFileSync(join(dir, 'obj', 'cache', 'deep', 'x.bin'), 'b')
    for (const folder of ['build', 'dist', 'node_modules', '.venv', '.git']) writeFileSync(join(dir, 'obj', folder, 'file'), 'c')
    await sleep(600)
    expect(changes()).toBe(0)
  })

  it('ignores out/, .torno/, __pycache__/ and dotfiles', async () => {
    const { changes } = await watching(join(dir, 'obj'))
    writeFileSync(join(dir, 'obj', 'out', 'part.step'), 'a')
    writeFileSync(join(dir, 'obj', '.torno', 'state.json'), '{}')
    writeFileSync(join(dir, 'obj', '__pycache__', 'model.cpython-312.pyc'), 'b')
    writeFileSync(join(dir, 'obj', '.model.py.swp'), 'c')
    await sleep(600)
    expect(changes()).toBe(0)
  })

  it('picks up a folder that appears after watching began', async () => {
    const { changes } = await watching(join(dir, 'common'))
    mkdirSync(join(dir, 'common'))
    writeFileSync(join(dir, 'common', 'screws.py'), 'M3 = 3\n')
    await sleep(700)
    expect(changes()).toBe(1)
  })

  it('reports nothing after it is stopped', async () => {
    const { changes } = await watching(join(dir, 'obj'))
    writeFileSync(join(dir, 'obj', 'model.py'), 'x = 4\n')
    stop!()
    await sleep(500)
    expect(changes()).toBe(0)
  })
})

// Re-review m6: an impatient second press must not start a build of 17 s over.
describe('Rebuild pressed while a build runs', () => {
  it('starts nothing: the build under way goes on, and is the one that lands', async () => {
    const { kernel, builds } = setup()
    builds.open(bracket)
    expect(kernel.calls).toHaveLength(1)
    expect(builds.state('bracket')!.status).toBe('building')
    expect(builds.rebuild('bracket')).toBe(false)
    expect(kernel.calls).toHaveLength(1)
    expect(kernel.cancels).toBe(0)
    kernel.calls[0].settle({ ok: true, scene: { model: 'bracket.py', layouts: ['main'], parts: [], seconds: 0.1, output: '' } as never, blob: Buffer.alloc(0) })
    await flush()
    expect(builds.state('bracket')).toMatchObject({ status: 'ok', revision: 1 })
    // Once it has landed, Rebuild builds again, as ever.
    expect(builds.rebuild('bracket')).toBe(true)
    expect(kernel.calls).toHaveLength(2)
    expect(builds.rebuild('nowhere')).toBe(false)
  })
})
