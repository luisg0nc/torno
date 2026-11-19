import { describe, expect, it } from 'vitest'
import type { BuildState } from '../shared/build'
import { Freshness } from './freshness'

const state = (status: BuildState['status']): BuildState => ({ objectId: 'a', status, revision: 1, stale: false })

function setup(initial: { status: BuildState['status']; startedAt: number; saved: number | null }) {
  const world = { ...initial }
  const f = new Freshness({ state: () => state(world.status), startedAt: () => world.startedAt, newestSource: async () => world.saved })
  return { f, world }
}

describe('Freshness', () => {
  it('is current when the files are not newer than the build and none runs', async () => {
    const { f } = setup({ status: 'ok', startedAt: 500, saved: 400 })
    expect(await f.check('a')).toBe(false)
    await f.settle('a', 100, 50)
    expect(f.newer('a')).toBe(false)
  })

  it('says a file saved after the build began is newer, also when no build has begun, once the grace is spent', async () => {
    const { f } = setup({ status: 'ok', startedAt: 500, saved: 900 })
    await f.settle('a', 10_000, 40)
    expect(f.newer('a')).toBe(true)
  })

  it('does not take a save in the millisecond a build began for newer', async () => {
    const { f } = setup({ status: 'ok', startedAt: 500, saved: 500.7 })
    expect(await f.check('a')).toBe(false)
  })

  it('waits for the build the save started, and is then current', async () => {
    const { f, world } = setup({ status: 'ok', startedAt: 500, saved: 900 })
    const settled = f.settle('a', 5_000, 2_000)
    await new Promise((r) => setTimeout(r, 5))
    world.status = 'building'
    world.startedAt = 950
    f.changed()
    let done = false
    void settled.then(() => (done = true))
    await new Promise((r) => setTimeout(r, 20))
    expect(done).toBe(false)
    world.status = 'ok'
    f.changed()
    await settled
    expect(f.newer('a')).toBe(false)
  })

  it('gives up on a build that runs past the limit and leaves it running', async () => {
    const { f, world } = setup({ status: 'building', startedAt: 950, saved: 900 })
    await f.settle('a', 0, 0)
    expect(world.status).toBe('building')
    expect(f.newer('a')).toBe(false)
  })
})
