import { describe, expect, it } from 'vitest'
import type { Scene } from '../../shared/scene'
import type { SavedView } from '../../shared/views'
import type { Camera, LookRequest, LookResult, ViewState } from '../../shared/view'
import type { ToolDeps, ToolResult } from './tools'
import { lookTool } from './viewTools'

// `look` with `views` (#348): several views in one picture, so that a survey is one call.

const CAMERA: Camera = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const VIEW: ViewState = { objectId: 'box', layout: 'assembly', camera: CAMERA, visible: ['assembly:tub'] }
const part = (name: string) => ({ name, layout: 'assembly', key: `assembly:${name}`, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, volume: 1, faces: 6, edges: 12, solids: 1, valid: true })
const SCENE = { model: 'box.py', layouts: ['assembly'], parts: [part('tub'), part('lid')], seconds: 1, output: '' } as unknown as Scene
const HINGE: SavedView = { name: 'Hinge side', author: 'user', layout: 'assembly', camera: CAMERA, hidden: ['lid'], at: '' }

function fake(over: Partial<ToolDeps> = {}): ToolDeps & { looks: LookRequest[]; saved: number } {
  const made = {
    looks: [] as LookRequest[],
    saved: 0,
    object: (id: string) => ({ id, name: id, dir: '/ws/box', model: 'box.py' }),
    build: () => ({ objectId: 'box', status: 'ok', revision: 4, seconds: 1, stale: false }),
    scene: () => ({ revision: 4, scene: SCENE }),
    view: () => VIEW,
    openObjectId: () => 'box',
    look: async (objectId: string, req: LookRequest): Promise<LookResult> => {
      made.looks.push(req)
      const tiles = req.tiles?.map((tile, i) => ({ caption: `view ${typeof tile.view === 'string' ? tile.view : 'custom'} · tile ${i + 1}`, layout: 'assembly', scans: [], exploded: false }))
      return { png: new Uint8Array([1]), width: 1280, height: 960, caption: tiles ? `${tiles.length} views in one picture` : 'one view', ...(tiles ? { tiles } : {}), objectId, revision: 4, stale: false }
    },
    saveImage: async () => {
      made.saved++
      return '/ws/box/.torno/views/1.png'
    },
    scans: async () => [],
    scansBusy: () => [],
    views: async () => [HINGE],
    ...over
  }
  return made as unknown as ToolDeps & { looks: LookRequest[]; saved: number }
}

const text = (result: ToolResult): string => result.content.find((block) => block.type === 'text')!.text as string

describe('look with several views', () => {
  it('asks the window for one picture of them all, at the size of one look, and keeps one picture', async () => {
    const deps = fake()
    const result = await lookTool(deps, 'box', { views: ['iso', 'front', 'current'] })
    expect(result.isError).toBeFalsy()
    expect(deps.looks).toEqual([{ size: 1280, tiles: [{ view: 'iso', explode: null }, { view: 'front', explode: null }, { view: 'current', explode: 'current' }] }])
    expect(result.content.filter((block) => block.type === 'image')).toHaveLength(1)
    expect(deps.saved).toBe(1)
    expect(text(result)).toBe('3 views in one picture\n1: view iso · tile 1\n2: view front · tile 2\n3: view current · tile 3\nrevision r4\nsaved as /ws/box/.torno/views/1.png')
  })

  it('draws every view with the other arguments, and the whole picture at the size asked for', async () => {
    const deps = fake()
    await lookTool(deps, 'box', { views: ['iso', 'top'], size: 5000, layout: 'assembly', parts: ['lid'], marks: false, section: null })
    const each = { layout: 'assembly', parts: ['lid'], marks: false, section: null, explode: null }
    expect(deps.looks).toEqual([{ size: 2000, tiles: [{ view: 'iso', ...each }, { view: 'top', ...each }] }])
  })

  it('takes a camera and the name of a saved view among them, each as view takes it', async () => {
    const deps = fake()
    const result = await lookTool(deps, 'box', { views: [{ position: [100, 0, 0], target: [0, 0, 0] }, 'hinge side'] })
    expect(result.isError, text(result)).toBeFalsy()
    const [camera, saved] = deps.looks[0].tiles!
    expect(camera.view).toMatchObject({ position: [100, 0, 0], up: [0, 0, 1] })
    expect(saved).toMatchObject({ view: CAMERA, viewName: 'Hinge side', layout: 'assembly', parts: ['tub'] })
    // The saved view's parts are its own tile's alone.
    expect(camera.parts).toBeUndefined()
  })

  it.each([
    [{ views: ['iso'] }, /views is 2 to 6 views/],
    [{ views: ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom'] }, /views is 2 to 6 views/],
    [{ views: 'iso' }, /views is 2 to 6 views/],
    [{ views: ['iso', 3] }, /^view 2 of views: .*iso/],
    [{ views: ['iso', 'front'], view: 'top' }, /view or views, not both/],
    [{ views: ['iso', 'hinge'] }, /^view 2 of views: no view "hinge"/],
    [{ views: ['iso', { position: [0, 0, 0], target: [0, 0, 0] }] }, /^view 2 of views: position and target are the same/],
    [{ views: ['iso', 'front'], parts: ['rim'] }, /^unknown part 'rim'/]
  ])('refuses %j and draws nothing', async (args, why) => {
    const deps = fake()
    const result = await lookTool(deps, 'box', args as never)
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(why)
    expect(deps.looks).toEqual([])
  })

  it('frames every view on a focus, says it once, and says on each tile what hides it there', async () => {
    const deps = fake()
    const drawn = deps.look
    deps.look = async (id, req) => {
      const picture = await drawn(id, req)
      return { ...picture, tiles: picture.tiles!.map((tile, i) => (i === 1 ? { ...tile, hiddenBy: ['lid'] } : tile)) }
    }
    const result = await lookTool(deps, 'box', { views: ['iso', 'front'], focus: { min: [0, 0, 0], max: [1, 1, 1] } })
    expect(result.isError, text(result)).toBeFalsy()
    expect(deps.looks[0].tiles!.map((tile) => tile.focus !== undefined)).toEqual([true, true])
    const lines = text(result).split('\n')
    expect(lines[1]).toBe('1: view iso · tile 1')
    expect(lines[2]).toMatch(/^2: view front · tile 2 · The middle of the focus is hidden from this side: lid stands between it and the camera\./)
    expect(text(result).match(/framed with/g)).toHaveLength(1)
  })

  it('says of one tile what is said after a picture of that view alone', async () => {
    const gone = { ...HINGE, hidden: ['clip'] }
    const result = await lookTool(fake({ views: async () => [gone] }), 'box', { views: ['iso', 'Hinge side'] })
    expect(text(result)).toContain('\n2: view custom · tile 2 · passed over, of the view "Hinge side": the part clip, which layout assembly no longer has\n')
  })
})
