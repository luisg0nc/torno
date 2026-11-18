import { describe, expect, it } from 'vitest'
import type { Scene } from '../../shared/scene'
import { type ThumbDeps, connectThumbs } from './thumbs'

const scene = (model: string): Scene => ({ model, layouts: ['assembly'], parts: [], seconds: 0, output: '' })

/** A thumbnailer whose idle moments are the test's to give, and what it drew and handed to main. */
function made(over: Partial<ThumbDeps> = {}) {
  const idle: Array<() => void> = []
  const drawn: string[] = []
  const saved: Array<{ id: string; revision: number; layout: string; bench?: boolean }> = []
  let root: string | undefined = '/ws'
  const thumbs = connectThumbs(
    {
      thumbnail: async (s, _blob, view) => {
        drawn.push(`${s.model}${view?.layout ? ` as ${view.layout}` : ''}`)
        return s.model === 'nothing.py' ? null : { png: new Uint8Array([1]), layout: 'assembly', parts: 1, ...(s.model.startsWith('bench') ? { bench: true } : {}) }
      }
    },
    {
      loadSceneFile: async (id) => ({ layout: `${id}-layout`, layers: {} }),
      save: (id, revision, _png, of) => saved.push({ id, revision, layout: of.layout, ...(of.bench ? { bench: true } : {}) }),
      idle: (run) => void idle.push(run),
      root: () => root,
      ...over
    }
  )
  /** Gives the thumbnailer its idle moments until it asks for no more. */
  const rest = async (): Promise<void> => {
    for (let turn = 0; turn < 50; turn++) {
      idle.shift()?.()
      await new Promise((r) => setTimeout(r, 0))
      if (idle.length === 0) return
    }
  }
  return { thumbs, idle, drawn, saved, rest, leave: (to: string | undefined) => (root = to) }
}
const landed = (objectId: string, revision: number, model = `${objectId}-r${revision}.py`) => ({ objectId, revision, scene: scene(model), blob: new ArrayBuffer(8) })

describe('connectThumbs', () => {
  it('draws nothing until the window is idle, then each object once, as its scene file has it, and hands main the picture', async () => {
    const t = made()
    t.thumbs.landed(landed('a', 1))
    t.thumbs.landed(landed('b', 1))
    expect(t.drawn).toEqual([])
    expect(t.idle).toHaveLength(1)
    await t.rest()
    expect(t.drawn).toEqual(['a-r1.py as a-layout', 'b-r1.py as b-layout'])
    expect(t.saved).toEqual([{ id: 'a', revision: 1, layout: 'assembly' }, { id: 'b', revision: 1, layout: 'assembly' }])
  })

  it('hands main that a picture is at the bench scale as the window drew it, and no size: the size is main\'s', async () => {
    const t = made()
    t.thumbs.landed(landed('a', 1, 'bench-a.py'))
    t.thumbs.landed(landed('b', 1))
    await t.rest()
    expect(t.saved).toEqual([{ id: 'a', revision: 1, layout: 'assembly', bench: true }, { id: 'b', revision: 1, layout: 'assembly' }])
  })

  it('draws only the latest build of an object when several land before it is idle', async () => {
    const t = made()
    t.thumbs.landed(landed('a', 1))
    t.thumbs.landed(landed('a', 2))
    t.thumbs.landed(landed('a', 3))
    await t.rest()
    expect(t.drawn).toEqual(['a-r3.py as a-layout'])
    expect(t.saved).toEqual([{ id: 'a', revision: 3, layout: 'assembly' }])
  })

  it('passes over a build sent again as it was: main sends the last scene again whenever an object is opened', async () => {
    const t = made()
    t.thumbs.landed(landed('a', 1))
    await t.rest()
    t.thumbs.landed(landed('a', 1))
    expect(t.idle).toHaveLength(0)
    t.thumbs.landed(landed('a', 2))
    await t.rest()
    expect(t.saved.map((s) => s.revision)).toEqual([1, 2])
  })

  it('holds no build once its picture is drawn, and none it was told of again while that one waited', async () => {
    const t = made()
    const first = landed('a', 1)
    t.thumbs.landed(first)
    t.thumbs.landed({ ...first })
    expect(t.thumbs.waiting()).toBe(1)
    await t.rest()
    expect(t.thumbs.waiting()).toBe(0)
  })

  it('starts afresh in another workspace: revisions count from 1 there, and ids repeat', async () => {
    const t = made()
    t.thumbs.landed(landed('a', 1))
    await t.rest()
    t.leave('/other')
    t.thumbs.landed(landed('a', 1, 'another-a.py'))
    await t.rest()
    expect(t.drawn).toEqual(['a-r1.py as a-layout', 'another-a.py as a-layout'])
  })

  it('hands main nothing of a workspace that was left while the scene file was read, nor of a scene with nothing to draw', async () => {
    let leave = (): void => {}
    const t = made({
      loadSceneFile: async () => {
        leave()
        return { layers: {} }
      }
    })
    leave = () => t.leave('/other')
    t.thumbs.landed(landed('a', 1))
    await t.rest()
    expect(t.saved).toEqual([])
    const none = made()
    none.thumbs.landed(landed('a', 1, 'nothing.py'))
    await none.rest()
    expect(none.saved).toEqual([])
  })

  it('goes on to the next object when one cannot be drawn, and draws nothing once it is stopped', async () => {
    const t = made({ loadSceneFile: async (id) => (id === 'a' ? Promise.reject(new Error('no file')) : { layers: {} }) })
    t.thumbs.landed(landed('a', 1))
    t.thumbs.landed(landed('b', 1))
    await t.rest()
    // Without its scene file an object is drawn as one never looked at.
    expect(t.drawn).toEqual(['a-r1.py', 'b-r1.py'])
    const stopped = made()
    stopped.thumbs.landed(landed('a', 1))
    stopped.thumbs.stop()
    await stopped.rest()
    expect(stopped.drawn).toEqual([])
    expect(stopped.thumbs.waiting()).toBe(0)
  })
})

// Final review I7: a picture that is ready waited for the window to be idle, which is a wait for a frame; a
// window nobody looks at is given none, and the wait was up to two seconds (1,001 ms measured on a large one).
it('never waits on the window being idle to draw a picture that is ready', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const source = readFileSync(resolve(__dirname, 'thumbs.ts'), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
  expect(source).not.toMatch(/requestIdleCallback\s*\(|requestAnimationFrame\s*\(/)
})
