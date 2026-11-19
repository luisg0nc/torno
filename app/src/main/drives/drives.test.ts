import { describe, expect, it, vi } from 'vitest'
import type { Param, Scene } from '../../shared/scene'
import { Drives, type DrivesDeps } from './drives'
import type { FacePrint } from './compare'

const face = (x = 0): FacePrint => ({ type: 'plane', area: 10, center: [x, 0, 0], normal: [0, 0, 1], box: [[0, 0, 0], [1, 1, 0]] })
const wall: Param = { name: 'wall', type: 'float', default: 2, literal: true, doc: null, editable: 'float' }

function rig(over: { revision?: () => number; trial?: DrivesDeps['trial'] } = {}) {
  let revision = 1
  const scene = { layouts: ['main'], params: [wall, { ...wall, name: 'lid', type: 'bool', default: true, editable: 'bool' as const }] } as unknown as Scene
  const query = vi.fn(async () => ({ parts: { box: [face(0), face(0)] } }))
  const trial = vi.fn(over.trial ?? (async () => ({ ok: true as const, answers: [{ ok: true as const, result: { parts: { box: [face(0), face(3)] } } }] })))
  const deps: DrivesDeps = { scene: () => ({ revision: over.revision?.() ?? revision, scene }), query: query as unknown as DrivesDeps['query'], trial }
  return { drives: new Drives(deps), query, trial, build: () => (revision += 1) }
}

describe('Drives', () => {
  it('nudges the one field in a trial and lights the faces that differ', async () => {
    const { drives, trial } = rig()
    expect(await drives.of('o', 'wall')).toEqual({ ok: true, nudged: 2.5, layouts: { main: { faces: ['box/F1'], parts: [] } } })
    expect(trial).toHaveBeenCalledWith('o', { wall: 2.5 }, [{ name: 'face_prints', args: { layout: 'main' } }])
  })

  it('answers a second hover from what it kept, and asks the build on show once for every field', async () => {
    const { drives, trial, query } = rig()
    await drives.of('o', 'wall')
    await drives.of('o', 'wall')
    await drives.of('o', 'lid')
    expect(trial).toHaveBeenCalledTimes(2)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('shares one trial between hovers that come before it ends', async () => {
    const { drives, trial } = rig()
    await Promise.all([drives.of('o', 'wall'), drives.of('o', 'wall')])
    expect(trial).toHaveBeenCalledTimes(1)
  })

  it('works again after the next build', async () => {
    const { drives, trial, query, build } = rig()
    await drives.of('o', 'wall')
    build()
    await drives.of('o', 'wall')
    expect(trial).toHaveBeenCalledTimes(2)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('says a nudge that does not build did not, and keeps that until the next build', async () => {
    const { drives, trial } = rig({ trial: async () => ({ ok: false, error: { kind: 'exception', message: 'wall too thin' } }) })
    const told = await drives.of('o', 'wall')
    expect(told).toEqual({ ok: false, message: 'wall = 2.5 did not build: wall too thin' })
    await drives.of('o', 'wall')
    expect(trial).toHaveBeenCalledTimes(1)
  })

  it('does not keep a trial the kernel could not make now', async () => {
    const { drives, trial } = rig({ trial: async () => ({ ok: false, error: { kind: 'busy', message: 'a build is running' } }) })
    expect(await drives.of('o', 'wall')).toMatchObject({ ok: false, message: expect.stringContaining('a build is running') })
    await drives.of('o', 'wall')
    expect(trial).toHaveBeenCalledTimes(2)
  })

  it('drops an answer for a build that is no longer on show', async () => {
    let revision = 1
    const { drives, trial } = rig({ revision: () => revision, trial: async () => { revision = 2; return { ok: true, answers: [{ ok: true, result: { parts: { box: [face(), face()] } } }] } } })
    expect(await drives.of('o', 'wall')).toMatchObject({ ok: false })
    await drives.of('o', 'wall')
    expect(trial).toHaveBeenCalledTimes(2)
  })

  it('refuses a field that cannot be tried, or an unknown one, without building anything', async () => {
    const { drives, trial } = rig()
    expect((await drives.of('o', 'nope')).ok).toBe(false)
    expect(trial).not.toHaveBeenCalled()
  })
})
