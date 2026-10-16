import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { BuildState } from '../../shared/build'
import type { Part, Scene } from '../../shared/scene'
import type { ScanAlignment, ScanInfo } from '../../shared/scans'
import type { Described } from '../../shared/geometry'
import type { Anchor, Mark, MarkPatch, NewMark } from '../../shared/marks'
import type { Camera, LookRequest, LookResult, SaveViewRequest, ShowRequest, ViewState } from '../../shared/view'
import type { SavedView } from '../../shared/views'
import type { ObjectInfo } from '../../shared/workspace'
import type { NearestAnchor } from '../marks/reanchor'
import { addMarkTool, highlightTool, resolveMarkTool } from './markTools'
import { TOOLS, refusedKeys } from './schemas'
import { describeTool, marksTool, type ToolDeps } from './tools'
import { explodeAsked, lookTool, saveViewTool, sceneTool, showTool } from './viewTools'

const BRACKET: ObjectInfo = { id: 'bracket', name: 'bracket', dir: '/ws/bracket', model: 'bracket.py' }
const STAND: ObjectInfo = { id: 'helmet-stand', name: 'helmet-stand', dir: '/ws/helmet-stand', model: 'stand.py' }

function part(layout: string, name: string, min: [number, number, number], max: [number, number, number], more: Partial<Part> = {}): Part {
  return { key: `${layout}:${name}`, name, layout, bbox: { min, max }, volume: 6000, volumeExact: true, bboxExact: true, faceCount: 6, edgeCount: 12, valid: true, ...more } as Part
}

const SCENE: Scene = {
  model: 'bracket.py',
  layouts: ['assembly', 'print'],
  parts: [
    part('assembly', 'base', [-20, -15, -2.5], [20, 15, 2.5]),
    part('assembly', 'post', [-4.0000001, -3.999, 2.5], [4, 4, 22.50499], { volume: 1005.3096491, faceCount: 3, edgeCount: 3, valid: false }),
    part('print', 'base', [-20, -15, -2.5], [20, 15, 2.5]),
    part('print', 'post', [56, -10, 0], [64, 10, 8])
  ],
  seconds: 0.8123,
  output: ''
}

const CAMERA: Camera = { position: [100.123456, -80, 60], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const VIEW: ViewState = { objectId: 'bracket', layout: 'assembly', camera: CAMERA, visible: ['assembly:base'] }
const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 3, seconds: 0.8123, stale: false }
const PICTURE: LookResult = {
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  width: 1280,
  height: 960,
  caption: 'view iso · layout assembly · parts base, post · orthographic · 1280×960',
  objectId: 'bracket',
  revision: 3,
  stale: false
}

const MARK_BASE = { author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 3, camera: CAMERA, createdAt: '2026-10-09T12:00:00.000Z', checkedRevision: 3 } as const
const FACE: Described = { kind: 'face', ref: 'assembly:base/F5', type: 'plane', area: 1200.00004, center: [0, 0, 2.5], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' }
const EDGE: Described = { kind: 'edge', ref: 'assembly:base/E7', type: 'line', length: 40, center: [0, 15, 2.5], descriptor: 'line, 40 mm' }
const WHOLE: Described = { kind: 'part', key: 'assembly:base', bbox: { min: [-20, -15, -2.5], max: [20, 15, 2.5] }, volume: 6000, area: 3100, faceCount: 6, edgeCount: 12, valid: true, descriptor: 'part, 40 × 30 × 5 mm, 6000 mm³, 6 faces' }

/** The marks, the kernel and the window, as far as the tools ask: what was asked of each is kept. */
interface World {
  list: Mark[]
  added: NewMark[]
  updates: Array<{ id: string; patch: MarkPatch }>
  /** What else the kernel says of each point: what it lies on, the edge under it. */
  near: object
  described: Array<{ layout: string; ref: string }>
  asked: Array<{ layout: string; anchors: Array<{ part: string; point: number[]; edge?: string }> }>
  /** How far from the edge it names the kernel finds a point. */
  edgeDistance: number | undefined
  shows: ShowRequest[]
  highlights: Array<{ layout: string; refs: string[]; note?: string }>
  /** How far from the surface the kernel finds each point asked about. */
  distance: (part: string, point: number[]) => number
}

function world(): Pick<ToolDeps, 'marks' | 'addMark' | 'updateMark' | 'describe' | 'nearest' | 'show' | 'highlight'> & { w: World } {
  const w: World = {
    list: [
      { ...MARK_BASE, id: 'M1', kind: 'pin', note: 'here', anchor: { point: [1.00000004, 2, 2.5], part: 'base', ref: 'base/F5', descriptor: FACE.descriptor } },
      { ...MARK_BASE, id: 'M2', kind: 'stroke', space: 'plane', status: 'sent', anchor: { point: [0, 40, 0] }, plane: { origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0' }, points2d: [[0, 0], [10, 5]] },
      { ...MARK_BASE, id: 'M3', kind: 'pin', status: 'resolved', layout: 'print', anchor: { point: [60, 0, 8], part: 'post', ref: 'post/F1' } },
      { ...MARK_BASE, id: 'M4', kind: 'pin', author: 'agent', status: 'sent', anchor: { point: [9, 9, 9] } }
    ],
    added: [],
    updates: [],
    described: [],
    asked: [],
    shows: [],
    highlights: [],
    distance: () => 0,
    edgeDistance: 0,
    near: {}
  }
  return {
    w,
    marks: async () => structuredClone(w.list),
    addMark: async (_objectId, mark) => {
      w.added.push(mark)
      return { ...mark, id: `M${w.list.length + w.added.length}`, status: 'sent', anchorState: 'ok', createdAt: MARK_BASE.createdAt } as Mark
    },
    updateMark: async (_objectId, id, patch) => {
      const mark = w.list.find((m) => m.id === id)
      if (!mark) throw new Error(`no mark ${id}; marks: ${w.list.map((m) => m.id).join(', ')}`)
      w.updates.push({ id, patch })
      return { ...mark, ...patch } as Mark
    },
    describe: async (_objectId, layout, ref) => {
      w.described.push({ layout, ref })
      return ref.includes('/F') ? { ...FACE, ref: `${layout}:${ref}` } : ref.includes('/E') ? { ...EDGE, ref: `${layout}:${ref}` } : { ...WHOLE, key: `${layout}:${ref}` }
    },
    nearest: async (_objectId, layout, anchors) => {
      w.asked.push({ layout, anchors })
      return anchors.map(({ part, point, edge }) => ({
        part,
        found: true,
        point: [point[0], point[1], 2.5],
        normal: [0, 0, 1],
        ref: `${part}/F5`,
        distance: w.distance(part, point),
        descriptor: `nearest of ${part}`,
        ...(edge === undefined || w.edgeDistance === undefined ? {} : { edgeFound: true, edgeDistance: w.edgeDistance, edgeDescriptor: 'line, 40 mm', edgeBetween: [`${part}/F2`, `${part}/F5`] }),
        ...w.near
      })) as NearestAnchor[]
    },
    show: async (objectId, req) => {
      w.shows.push(req)
      return { caption: 'view top · layout assembly · parts base, post · orthographic', objectId, revision: 3, stale: false }
    },
    highlight: async (objectId, layout, refs, note) => {
      w.highlights.push({ layout, refs, ...(note === undefined ? {} : { note }) })
      return { objectId, layout, refs, revision: 3 }
    }
  }
}

interface Fake extends ToolDeps {
  w: World
  looks: Array<{ objectId: string; req: LookRequest }>
  saved: Array<{ objectId: string; png: Uint8Array }>
  /** What the window was asked to keep as a view of the agent's. */
  savedViews: SaveViewRequest[]
}

function fake(over: Partial<ToolDeps> & { state?: BuildState | null; noScene?: boolean } = {}): Fake {
  const looks: Fake['looks'] = []
  const saved: Fake['saved'] = []
  const savedViews: Fake['savedViews'] = []
  return {
    looks,
    saved,
    savedViews,
    views: async () => [],
    saveView: async (objectId, req) => {
      savedViews.push(req)
      return { objectId, revision: 3, replaced: false, view: { name: req.name, author: 'agent', proposed: true, layout: req.layout ?? 'assembly', camera: { ...CAMERA, ortho: typeof req.view === 'string' }, hidden: req.parts ? ['base', 'post'].filter((name) => !req.parts!.includes(name)) : [], at: '', ...(req.note ? { note: req.note } : {}), ...(req.section ? { section: req.section } : {}), ...(req.explode ? { explode: req.explode } : {}) } }
    },
    object: (id) => [BRACKET, STAND].find((o) => o.id === id),
    build: (id) => (id === 'bracket' ? (over.state === null ? undefined : (over.state ?? OK)) : undefined),
    scene: (id) => (id === 'bracket' && !over.noScene ? { revision: (over.state ?? OK).revision, scene: SCENE } : undefined),
    view: (id) => (id === 'bracket' ? VIEW : undefined),
    openObjectId: () => 'bracket',
    look: async (objectId, req) => {
      looks.push({ objectId, req })
      return { ...PICTURE, revision: (over.state ?? OK).revision, stale: (over.state ?? OK).stale }
    },
    saveImage: async (objectId, png) => {
      saved.push({ objectId, png })
      return `/ws/${objectId}/.torno/views/${saved.length}.png`
    },
    // The kernel's own queries and the drawing of a section are the read tools': see readTools.test.ts.
    addDimension: async () => Promise.reject(new Error('no dimension was expected to be added')),
    query: async () => Promise.reject(new Error('the kernel was not expected to be asked')),
    sectionDrawing: async () => Promise.reject(new Error('no drawing was expected to be asked for')),
    scans: async () => [],
    scansBusy: () => [],
    scanPaths: (_objectId, id) => ({ mesh: `/ws/bracket/.torno/scans/${id}/mesh.bin`, mask: (mark) => `/ws/bracket/.torno/scans/${id}/${mark}.mask` }),
    ...world(),
    ...over
  }
}

const textOf = (result: { content: Array<{ type: string; text?: string }> }): string =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

describe('the tool descriptions', () => {
  it('say in two or three sentences each what the tool returns and when to use it', () => {
    expect(Object.keys(TOOLS)).toEqual(['scene', 'look', 'marks', 'describe', 'highlight', 'show', 'save_view', 'add_mark', 'resolve_mark', 'measure', 'section', 'check', 'diff', 'scans', 'scan_clash', 'scan_deviation'])
    for (const tool of Object.values(TOOLS)) {
      expect(tool.description).toMatch(/^Returns /)
      const sentences = tool.description.match(/[.?!]"?(\s|$)/g)!.length
      expect(sentences).toBeGreaterThanOrEqual(2)
      expect(sentences).toBeLessThanOrEqual(3)
    }
  })

  it('add_mark shows a whole call for a pin, which its schema takes as it is', () => {
    expect(TOOLS.add_mark.description).toMatch(/\{"kind": "pin", /)
  })

  it('every example call a description gives is JSON its tool takes as it is: no key it would refuse, no value its schema would', () => {
    let examples = 0
    for (const [name, tool] of Object.entries(TOOLS) as Array<[keyof typeof TOOLS, (typeof TOOLS)[keyof typeof TOOLS]]>) {
      for (const [example] of tool.description.matchAll(/\{"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)) {
        const args = JSON.parse(example) as Record<string, unknown>
        examples += 1
        expect([name, refusedKeys(name, args)]).toEqual([name, null])
        const schema = z.object('inputSchema' in tool ? tool.inputSchema : {}).strict()
        expect([name, example, schema.safeParse(args).success]).toEqual([name, example, true])
      }
    }
    expect(examples).toBeGreaterThan(0)
  })

  it('marks says which marks have not been checked against the build as the code does: no checkedRevision, or any other than the revision', () => {
    expect(TOOLS.marks.description).toContain('a checkedRevision that is absent or is not the revision means')
    expect(TOOLS.marks.description).not.toContain('lower than')
  })

  it('say where refs come from, that show changes what the user sees, and what highlight is for', () => {
    for (const tool of [TOOLS.describe, TOOLS.add_mark]) expect(tool.description).toContain('marks, scene and')
    expect(TOOLS.show.description).toMatch(/moves the user's own camera/)
    expect(TOOLS.highlight.description).toContain('"this one?"')
  })
})

describe('scene', () => {
  it('says of each part whether its size and its volume are exact, as the kernel says, and what to do for a number to rely on', () => {
    const loft = part('assembly', 'stand', [-64.4355, 0, 0], [65, 207.96, 120], { volume: 609220.72, volumeExact: false, bboxExact: false })
    const old = part('assembly', 'legacy', [0, 0, 0], [1, 2, 3], { volumeExact: undefined, bboxExact: undefined })
    const scene = JSON.parse(textOf(sceneTool(fake({ scene: () => ({ revision: 3, scene: { ...SCENE, parts: [SCENE.parts[0], loft, old] } }) }), 'bracket')))
    expect(scene.parts.map((p: { name: string; sizeExact: boolean; volumeExact: boolean }) => [p.name, p.sizeExact, p.volumeExact])).toEqual([['base', true, true], ['stand', false, false], ['legacy', false, false]])
    expect(scene.note).toContain('A size (and bbox) with sizeExact false, or a volume with volumeExact false, is approximate: call measure for a number to rely on.')
    // Nothing is said where everything is exact.
    expect(JSON.parse(textOf(sceneTool(fake(), 'bracket'))).note ?? '').not.toContain('approximate')
    // And the description no longer sends the agent here for dimensions.
    expect(TOOLS.scene.description).not.toContain('whenever you need dimensions')
    expect(TOOLS.scene.description).toContain('Sizes and volumes here are for orientation (sizeExact and volumeExact say which are exact): call measure for a number to rely on.')
    expect(TOOLS.check.description).not.toContain('Overlap and clearance are exact')
  })

  it("lists the model's Params as the kernel read them, and none from a kernel that read none", () => {
    const params = [
      { name: 'wall', type: 'float', default: 2.5, literal: true, doc: 'thickness of every wall, mm' },
      { name: 'depth', type: 'float', default: 8, literal: false, doc: null }
    ]
    const told = JSON.parse(textOf(sceneTool(fake({ scene: () => ({ revision: 3, scene: { ...SCENE, params } }) }), 'bracket')))
    expect(told.params).toEqual(params)
    expect(JSON.parse(textOf(sceneTool(fake(), 'bracket'))).params).toEqual([])
    expect(TOOLS.scene.description).toContain('under params')
  })

  // Final fix wave (I11's seam): the kernel let the build go to make room, and the agent is told what to expect.
  it('says when the kernel let the last build go to make room, and when tools will answer again', () => {
    const building = JSON.parse(textOf(sceneTool(fake({ state: { ...OK, status: 'building', stale: true, letGo: 'memory' } }), 'bracket')))
    expect(building.build.letGo).toBe('memory')
    expect(building.note).toContain('The last build was let go to make room (memory): tools answer when this one lands.')
    const failed = JSON.parse(textOf(sceneTool(fake({ state: { ...OK, status: 'failed', stale: true, letGo: 'memory', error: { kind: 'exception', message: 'no' } } }), 'bracket')))
    expect(failed.note).toContain('The last build was let go to make room (memory) and this one failed: tools answer once the model builds again.')
    expect(JSON.parse(textOf(sceneTool(fake(), 'bracket'))).build).not.toHaveProperty('letGo')
  })

  it('is one text block of JSON: the build, the layouts, the parts and the camera', () => {
    const result = sceneTool(fake(), 'bracket')
    expect(result.isError).toBeUndefined()
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(JSON.parse(textOf(result))).toEqual({
      object: 'bracket',
      model: 'bracket.py',
      build: { status: 'ok', revision: 3, seconds: 0.81, stale: false },
      layout: 'assembly',
      layouts: ['assembly', 'print'],
      params: [],
      parts: [
        { name: 'base', layout: 'assembly', visible: true, size: [40, 30, 5], sizeExact: true, bbox: { min: [-20, -15, -2.5], max: [20, 15, 2.5] }, volume: 6000, volumeExact: true, faces: 6, edges: 12, valid: true },
        { name: 'post', layout: 'assembly', visible: false, size: [8, 8, 20], sizeExact: true, bbox: { min: [-4, -4, 2.5], max: [4, 4, 22.5] }, volume: 1005.31, volumeExact: true, faces: 3, edges: 3, valid: false },
        { name: 'base', layout: 'print', visible: true, size: [40, 30, 5], sizeExact: true, bbox: { min: [-20, -15, -2.5], max: [20, 15, 2.5] }, volume: 6000, volumeExact: true, faces: 6, edges: 12, valid: true },
        { name: 'post', layout: 'print', visible: false, size: [8, 20, 8], sizeExact: true, bbox: { min: [56, -10, 0], max: [64, 10, 8] }, volume: 6000, volumeExact: true, faces: 6, edges: 12, valid: true }
      ],
      camera: { position: [100.12, -80, 60], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
      section: null,
      explode: null
    })
  })

  it('counts the unresolved dimensions that pass, fail and have no value of the build, when it is given the marks', () => {
    const dim = (id: string, over: object): Mark => ({ ...MARK_BASE, id, status: 'sent', kind: 'dimension', measure: 'diameter', a: { point: [-6, 5, 0], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder', measuredRevision: 3, ...over }) as Mark
    const marks = [
      dim('M5', { expected: 8, verdict: 'pass' }),
      dim('M6', { expected: 9, verdict: 'fail' }),
      dim('M7', { expected: 9, verdict: 'fail', status: 'draft' }),
      dim('M8', { expected: 8, verdict: 'pass', measuredRevision: 2 }),
      dim('M9', { anchorState: 'orphaned' }),
      // Not counted: with nothing expected of it, and resolved.
      dim('M10', {}),
      dim('M11', { expected: 9, verdict: 'fail', status: 'resolved' })
    ]
    expect(JSON.parse(textOf(sceneTool(fake(), 'bracket', marks))).dimensions).toEqual({ pass: 1, fail: 2, notMeasured: 2 })
    // No dimension, nothing said.
    expect(JSON.parse(textOf(sceneTool(fake(), 'bracket', fake().w.list)))).not.toHaveProperty('dimensions')
    expect(TOOLS.scene.description).toContain('dimensions')
  })

  it('carries the kind, the message and the last 30 lines of the traceback of a failed build, with the parts still shown', () => {
    const traceback = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join('\n')
    const state: BuildState = { objectId: 'bracket', status: 'failed', revision: 3, seconds: 0.1, stale: true, error: { kind: 'exception', message: 'ValueError: no', traceback, output: 'printed' } }
    const scene = JSON.parse(textOf(sceneTool(fake({ state }), 'bracket')))
    expect(scene.build).toEqual({
      status: 'failed',
      revision: 3,
      seconds: 0.1,
      stale: true,
      error: { kind: 'exception', message: 'ValueError: no', traceback: Array.from({ length: 30 }, (_, i) => `line ${i + 16}`).join('\n') }
    })
    expect(scene.parts).toHaveLength(4)
  })

  it('for an object that is not the one open: its build and parts, no camera, no visibility, and a note saying so', () => {
    const scene = JSON.parse(textOf(sceneTool(fake({ openObjectId: () => 'helmet-stand' }), 'bracket')))
    expect(scene.camera).toBeNull()
    expect(scene.layout).toBeNull()
    expect(scene.note).toBe('bracket is not the object open in the torno window (open: helmet-stand), so what is visible, the camera and the section are not known.')
    expect(scene.parts.map((p: { name: string }) => p.name)).toEqual(['base', 'post', 'base', 'post'])
    for (const p of scene.parts) expect(p).not.toHaveProperty('visible')
    expect(scene.build.revision).toBe(3)
  })

  it('says which parts of the print layout were spread along X, and by how much', () => {
    const spread: Scene = {
      ...SCENE,
      parts: [...SCENE.parts.slice(0, 3), part('print', 'post', [30, -10, 0], [38, 10, 8], { arranged: [34.004, 0, 0] })]
    }
    const scene = JSON.parse(textOf(sceneTool(fake({ scene: () => ({ revision: 3, scene: spread }) }), 'bracket')))
    expect(scene.parts.map((p: { arranged?: number[] }) => p.arranged)).toEqual([undefined, undefined, undefined, [34, 0, 0]])
    expect(scene.note).toBe('The parts of the print layout overlapped as the model placed them, so they were spread along X for display; arranged is how far each was moved.')

    // Said together with the other note, when there is one.
    const elsewhere = JSON.parse(textOf(sceneTool(fake({ scene: () => ({ revision: 3, scene: spread }), openObjectId: () => 'helmet-stand' }), 'bracket')))
    expect(elsewhere.note).toBe(
      'bracket is not the object open in the torno window (open: helmet-stand), so what is visible, the camera and the section are not known. The parts of the print layout overlapped as the model placed them, so they were spread along X for display; arranged is how far each was moved.'
    )
  })

  it('is an error for an object the workspace does not have', () => {
    const result = sceneTool(fake(), 'nothing')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('unknown object: nothing')
  })

  it('is an error before the first successful build, saying where the build is', () => {
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 0, stale: false, error: { kind: 'exception', message: "NameError: name 'Boxx' is not defined", traceback: 'a\nb' } }
    const result = sceneTool(fake({ state: failed, noScene: true }), 'bracket')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe("no build yet: failed: NameError: name 'Boxx' is not defined\na\nb")

    const building: BuildState = { objectId: 'bracket', status: 'building', revision: 0, startedAt: 1, stale: false }
    expect(textOf(sceneTool(fake({ state: building, noScene: true }), 'bracket'))).toBe('no build yet: building')

    const never = sceneTool(fake({ state: null, noScene: true }), 'bracket')
    expect(never.isError).toBe(true)
    expect(textOf(never)).toBe('no build yet: bracket has not been opened in the torno window')
  })
})

describe('look', () => {
  it('returns the picture as a PNG image block, and says what it shows and where it was saved', async () => {
    const deps = fake()
    const result = await lookTool(deps, 'bracket', { view: 'iso' })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]).toEqual({ type: 'image', data: Buffer.from(PICTURE.png).toString('base64'), mimeType: 'image/png' })
    expect(textOf(result)).toBe(`${PICTURE.caption}\nrevision r3\nsaved as /ws/bracket/.torno/views/1.png`)
    expect(deps.saved).toEqual([{ objectId: 'bracket', png: PICTURE.png }])
  })

  it('passes the request through, with the default size', async () => {
    const deps = fake()
    await lookTool(deps, 'bracket', {})
    await lookTool(deps, 'bracket', { view: 'top', layout: 'print', parts: ['post'], size: 800 })
    expect(deps.looks).toEqual([
      { objectId: 'bracket', req: { view: 'current', size: 1280, explode: 'current' } },
      { objectId: 'bracket', req: { view: 'top', layout: 'print', parts: ['post'], size: 800, explode: 'current' } }
    ])
  })

  it('draws the marks unless told not to: the choice is passed on, and left out when it was not made', async () => {
    const deps = fake()
    await lookTool(deps, 'bracket', { marks: false })
    await lookTool(deps, 'bracket', { marks: true })
    expect(deps.looks.map((l) => l.req)).toEqual([
      { view: 'current', size: 1280, marks: false, explode: 'current' },
      { view: 'current', size: 1280, marks: true, explode: 'current' }
    ])
    expect(TOOLS.look.inputSchema.marks.description).toBe("Draw the user's and your marks with their numbers. Default true.")
    expect(TOOLS.look.inputSchema.marks.safeParse(undefined).success).toBe(true)
    expect(TOOLS.look.inputSchema.marks.safeParse('yes').success).toBe(false)
  })

  it('clamps the size to 256–2000', async () => {
    const deps = fake()
    for (const size of [10, 5000, 640.6, Number.NaN]) await lookTool(deps, 'bracket', { size })
    expect(deps.looks.map((l) => l.req.size)).toEqual([256, 2000, 641, 1280])
  })

  it('makes a whole camera of a position and a target', async () => {
    const deps = fake()
    await lookTool(deps, 'bracket', { view: { position: [100, 0, 50], target: [0, 0, 10] } })
    await lookTool(deps, 'bracket', { view: { position: [0, 0, 200], target: [0, 0, 0], ortho: true } })
    await lookTool(deps, 'bracket', { view: { position: [0, 50, 0], target: [0, 0, 0], up: [1, 0, 0] } })
    expect(deps.looks.map((l) => l.req.view)).toEqual([
      { position: [100, 0, 50], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
      // Straight down the Z axis, Z cannot be up.
      { position: [0, 0, 200], target: [0, 0, 0], up: [0, 1, 0], ortho: true, fov: 35, zoom: 1 },
      { position: [0, 50, 0], target: [0, 0, 0], up: [1, 0, 0], ortho: false, fov: 35, zoom: 1 }
    ])
  })

  it('refuses a camera whose position is its target', async () => {
    const deps = fake()
    const result = await lookTool(deps, 'bracket', { view: { position: [10, 20, 30], target: [10, 20, 30] } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('position and target are the same')
    expect(deps.looks).toEqual([])
  })

  it('says the parts are stale when the window drew them stale, and why', async () => {
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 3, stale: true, error: { kind: 'exception', message: 'no' } }
    expect(textOf(await lookTool(fake({ state: failed }), 'bracket', {}))).toContain('\nrevision r3, stale: the latest build failed, so these are still the parts of r3\n')
    const building: BuildState = { objectId: 'bracket', status: 'building', revision: 3, startedAt: 1, stale: true }
    expect(textOf(await lookTool(fake({ state: building }), 'bracket', {}))).toContain('\nrevision r3, stale: a build is running, so these are still the parts of r3\n')
  })

  it('captions the picture with the revision the window drew, not the one built while the picture was made', async () => {
    // The build of r4 lands between the request and the reply: the picture is still of r3.
    let state: BuildState = { objectId: 'bracket', status: 'building', revision: 3, startedAt: 1, stale: true }
    const deps = fake({
      build: () => state,
      scene: () => ({ revision: state.revision, scene: SCENE }),
      look: async () => {
        const drawn = { ...PICTURE, revision: 3, stale: true }
        state = { objectId: 'bracket', status: 'ok', revision: 4, seconds: 1, stale: false }
        return drawn
      }
    })
    const result = await lookTool(deps, 'bracket', {})
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toBe(`${PICTURE.caption}\nrevision r3, stale: r4 was built while this picture was made; look again to see it\nsaved as /ws/bracket/.torno/views/1.png`)
  })

  it('says so when a picture drawn fresh has been overtaken by a newer build', async () => {
    let revision = 3
    const deps = fake({
      scene: () => ({ revision, scene: SCENE }),
      look: async () => {
        revision = 4
        return PICTURE
      }
    })
    expect(textOf(await lookTool(deps, 'bracket', {}))).toContain('\nrevision r3, stale: r4 was built while this picture was made; look again to see it\n')
  })

  it('still returns the picture when it cannot be saved', async () => {
    const result = await lookTool(fake({ saveImage: () => Promise.reject(new Error('EACCES: permission denied')) }), 'bracket', {})
    expect(result.isError).toBeUndefined()
    expect(result.content[0].type).toBe('image')
    expect(textOf(result)).toBe(`${PICTURE.caption}\nrevision r3\nnot saved: EACCES: permission denied`)
  })

  it('is an error for an object the workspace does not have', async () => {
    const deps = fake()
    const result = await lookTool(deps, 'nothing', {})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('unknown object: nothing')
    expect(deps.looks).toEqual([])
  })

  it('is an error before the first successful build', async () => {
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 0, stale: false, error: { kind: 'no_model', message: 'no model file in /ws/bracket' } }
    const deps = fake({ state: failed, noScene: true })
    const result = await lookTool(deps, 'bracket', {})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('no build yet: failed: no model file in /ws/bracket')
    expect(deps.looks).toEqual([])
  })

  it('is an error for an object that is not the one open in the window, which is not asked', async () => {
    const deps = fake({ openObjectId: () => 'helmet-stand' })
    const result = await lookTool(deps, 'bracket', { view: 'iso' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('bracket is not the object open in the torno window (open: helmet-stand). Ask the user to open it.')
    expect(deps.looks).toEqual([])

    expect(textOf(await lookTool(fake({ openObjectId: () => null }), 'bracket', {}))).toBe(
      'bracket is not the object open in the torno window (open: none). Ask the user to open it.'
    )
  })

  it('is an error when the picture the window made is of another object', async () => {
    // Main still takes bracket for the open object; the window had already moved on.
    const deps = fake({ look: async () => ({ ...PICTURE, objectId: 'helmet-stand' }) })
    const result = await lookTool(deps, 'bracket', {})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('bracket is not the object open in the torno window (open: helmet-stand). Ask the user to open it.')
    expect(deps.saved).toEqual([])
  })

  it('passes on what the window says of an unknown part, and of not answering', async () => {
    const unknown = "unknown part 'lid'; parts in layout assembly: base, post"
    const result = await lookTool(fake({ look: () => Promise.reject(new Error(unknown)) }), 'bracket', { parts: ['lid'] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(unknown)

    const late = await lookTool(fake({ look: () => Promise.reject(new Error('the torno window did not answer within 10 s')) }), 'bracket', {})
    expect(late.isError).toBe(true)
    expect(textOf(late)).toBe('the torno window did not answer within 10 s')
  })
})

/** What a tool that places a mark says, without the line that says which build it was placed on. */
const said = (result: { content: Array<{ type: string; text?: string }> }): string => textOf(result).replace(/\nrevision r\d+.*$/, '')

const jsonOf = (result: { content: Array<{ type: string; text?: string }> }): any => JSON.parse(textOf(result))

describe('marks', () => {
  it('tells in a mark\'s line what is nothing within its part as 0, as the prompt does (re-review m10)', async () => {
    const deps = fake()
    deps.w.list[0] = { ...deps.w.list[0], anchor: { point: [-0.000004772, 2, 2.5], part: 'base', ref: 'base/F5' } } as Mark
    const [first] = jsonOf(await marksTool(deps, 'bracket', {})).marks
    expect(first.line).toContain('at (0, 2, 2.5)')
    expect(jsonOf(await describeTool(deps, 'bracket', { ref: 'M1' })).mark.line).toContain('at (0, 2, 2.5)')
    expect(textOf(await resolveMarkTool(deps, 'bracket', { id: 'M1' }))).toContain('at (0, 2, 2.5)')
  })

  it('is JSON of every mark with all its fields, a stroke with its points', async () => {
    const deps = fake()
    const result = await marksTool(deps, 'bracket', {})
    expect(result.isError).toBeUndefined()
    const { marks } = jsonOf(result)
    expect(marks.map((m: Mark) => m.id)).toEqual(['M1', 'M2', 'M3', 'M4'])
    // What modelling leaves in the last digits is not passed on.
    expect(marks[0]).toEqual({
      ...deps.w.list[0],
      anchor: { ...(deps.w.list[0] as { anchor: object }).anchor, point: [1, 2, 2.5] },
      camera: { ...CAMERA, position: [100.1235, -80, 60] },
      line: 'M1 pin on base/F5 (plane, normal +Z, z = 2.5, 1200 mm²) at (1, 2, 2.5): "here"'
    })
    expect(marks[1]).toMatchObject({ kind: 'stroke', plane: { label: 'XZ at y = 40.0' }, points2d: [[0, 0], [10, 5]] })
  })

  it('gives each mark its line, which says of one that moved only where it was placed', async () => {
    const deps = fake()
    deps.w.list[0] = { ...deps.w.list[0], anchorState: 'drifted' } as Mark
    const [moved] = jsonOf(await marksTool(deps, 'bracket', {})).marks
    // The ref and the descriptor are there side by side, and may be of two things: the line does not pair them.
    expect(moved).toMatchObject({ anchorState: 'drifted', anchor: { ref: 'base/F5', descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' } })
    expect(moved.line).toBe('M1 pin placed on base/F5 at (1, 2, 2.5): "here" [moved since it was placed: check it]')
    expect(jsonOf(await describeTool(deps, 'bracket', { ref: 'M1' })).mark.line).toBe(moved.line)
    expect(TOOLS.marks.description).toContain('anchorState')
  })

  it('gives a dimension a value in its data only where its line gives one: measured on that build, and measurable', async () => {
    const dim = (n: number, over: object = {}): Mark =>
      ({ ...MARK_BASE, id: `M${n}`, status: 'sent', note: '', kind: 'dimension', measure: 'diameter', a: { point: [-6, 5, 0], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder', points: [[-14, 5, 0], [-6, 5, 0]], measuredRevision: 3, checkedRevision: 3, expected: 8, verdict: 'pass', ...over }) as Mark
    const deps = fake()
    deps.w.list = [dim(1), dim(2, { measuredRevision: 2 }), dim(3, { anchorState: 'orphaned' }), dim(4, { anchorState: 'drifted' }), dim(5, { value: undefined, how: undefined, points: undefined, verdict: undefined, refused: 'base/F9 is a plane face: it has no diameter' })]
    const { marks } = jsonOf(await marksTool(deps, 'bracket', {}))
    // Measured on r3, the build the answer is of.
    expect(marks[0]).toMatchObject({ value: 8, how: 'cylinder', verdict: 'pass', points: [[-14, 5, 0], [-6, 5, 0]], line: 'M1 diameter 8 mm, base/F9 (expected 8 ± 0.05: pass)' })
    // Measured on r2: nothing in the data says 8 is its value, or that it passes.
    for (const key of ['value', 'how', 'points', 'verdict']) expect(marks[1]).not.toHaveProperty(key)
    expect(marks[1]).toMatchObject({ expected: 8, wasValue: 8, wasRevision: 2, line: 'M2 diameter: not measured on r3 (was 8 mm on r2), base/F9 (expected 8 ± 0.05)' })
    // Its part gone.
    for (const key of ['value', 'how', 'points', 'verdict', 'wasValue']) expect(marks[2]).not.toHaveProperty(key)
    expect(marks[2].line).toBe('M3 diameter: not measurable, [its part is gone]')
    // Moved, and measured from what is under it now: the value stands, and the line says to check it.
    expect(marks[3]).toMatchObject({ value: 8, verdict: 'pass', anchorState: 'drifted', line: 'M4 diameter 8 mm, base/F9 (expected 8 ± 0.05: pass) [moved since it was placed: check it]' })
    expect(marks[4]).toMatchObject({ refused: 'base/F9 is a plane face: it has no diameter' })
    expect(marks[4]).not.toHaveProperty('value')
    // `describe M<n>` says the same.
    const described = jsonOf(await describeTool(deps, 'bracket', { ref: 'M2' })).mark
    expect(described).toEqual(marks[1])
    // While another build runs, r3 is still what the values are of.
    expect(jsonOf(await marksTool({ ...deps, build: () => ({ objectId: 'bracket', status: 'building', revision: 3, startedAt: 0, stale: true }) }, 'bracket', {})).marks[0]).toMatchObject({ value: 8 })
  })

  it('before any build of the run, gives no dimension a value', async () => {
    const deps = fake({ state: null, noScene: true })
    deps.w.list = [{ ...MARK_BASE, id: 'M1', status: 'sent', note: '', kind: 'dimension', measure: 'diameter', a: { point: [-6, 5, 0], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder', expected: 8, verdict: 'pass' } as Mark]
    const [mark] = jsonOf(await marksTool(deps, 'bracket', {})).marks
    // What its file holds is of no build of this run: it is not given as what the dimension was, either.
    for (const key of ['value', 'verdict', 'wasRevision', 'wasValue']) expect(mark).not.toHaveProperty(key)
    expect(mark).toMatchObject({ line: 'M1 diameter: not measured yet, base/F9 (expected 8 ± 0.05)' })
  })

  it('keeps to one status when asked, and open is all that are not resolved', async () => {
    const ids = async (status: 'draft' | 'sent' | 'resolved' | 'open') => jsonOf(await marksTool(fake(), 'bracket', { status })).marks.map((m: Mark) => m.id)
    expect(await ids('draft')).toEqual(['M1'])
    expect(await ids('sent')).toEqual(['M2', 'M4'])
    expect(await ids('resolved')).toEqual(['M3'])
    expect(await ids('open')).toEqual(['M1', 'M2', 'M4'])
  })

  it('needs no build, and says when the object is unknown or its marks cannot be read', async () => {
    const unbuilt = jsonOf(await marksTool(fake({ state: null, noScene: true }), 'bracket', {}))
    expect(unbuilt.marks).toHaveLength(4)
    expect(unbuilt.revision).toBeNull()
    expect(await marksTool(fake(), 'nothing', {})).toEqual({ isError: true, content: [{ type: 'text', text: 'unknown object: nothing' }] })
    const unreadable = fake({ marks: async () => Promise.reject(new Error('EACCES: permission denied')) })
    expect(await marksTool(unreadable, 'bracket', {})).toMatchObject({ isError: true, content: [{ text: 'EACCES: permission denied' }] })
  })
})

describe('which build a reply is of', () => {
  const BUILDING: BuildState = { objectId: 'bracket', status: 'building', revision: 3, startedAt: 0, stale: true }
  const FAILED: BuildState = { objectId: 'bracket', status: 'failed', revision: 3, stale: true, error: { kind: 'exception', message: 'no' } }

  it('marks says the revision, and that it is the last that worked while another is built or has failed', async () => {
    expect(jsonOf(await marksTool(fake(), 'bracket', {}))).toMatchObject({ revision: 3 })
    expect(jsonOf(await marksTool(fake(), 'bracket', {}))).not.toHaveProperty('stale')
    expect(jsonOf(await marksTool(fake({ state: BUILDING }), 'bracket', {})).stale).toBe('a build is running, so this is still what is known of r3: refs and descriptors may not hold for the model as it now is')
    expect(jsonOf(await marksTool(fake({ state: FAILED }), 'bracket', {})).stale).toBe('the latest build failed, so this is still what is known of r3: refs and descriptors may not hold for the model as it now is')
  })

  it('marks says in the line of a mark that nothing has checked it against that build', async () => {
    const deps = fake()
    deps.w.list[0] = { ...deps.w.list[0], checkedRevision: 2 } as Mark
    const reply = jsonOf(await marksTool(deps, 'bracket', {}))
    expect(reply.marks[0]).toMatchObject({ checkedRevision: 2, line: 'M1 pin on base/F5 (plane, normal +Z, z = 2.5, 1200 mm²) at (1, 2, 2.5): "here" [not checked against r3]' })
    expect(jsonOf(await describeTool(deps, 'bracket', { ref: 'M1' }))).toMatchObject({ revision: 3, mark: { line: reply.marks[0].line } })
    expect(TOOLS.marks.description).toContain('checkedRevision')
  })

  it('describe says the same of a ref, and of a mark', async () => {
    expect(jsonOf(await describeTool(fake(), 'bracket', { ref: 'base/F5' }))).not.toHaveProperty('stale')
    const building = jsonOf(await describeTool(fake({ state: BUILDING }), 'bracket', { ref: 'base/F5' }))
    expect(building).toMatchObject({ revision: 3, stale: expect.stringContaining('a build is running, so this is still what is known of r3') })
    expect(jsonOf(await describeTool(fake({ state: FAILED }), 'bracket', { ref: 'M1' }))).toMatchObject({ revision: 3, stale: expect.stringContaining('the latest build failed'), mark: { id: 'M1' } })
  })

  it('add_mark says it after the mark it placed', async () => {
    const fresh = textOf(await addMarkTool(fake(), 'bracket', { kind: 'pin', note: 'here', ref: 'base/F5' }))
    expect(fresh.split('\n').at(-1)).toBe('revision r3')
    const building = textOf(await addMarkTool(fake({ state: BUILDING }), 'bracket', { kind: 'pin', note: 'here', ref: 'base/F5' }))
    expect(building.split('\n').at(-1)).toBe('revision r3, stale: a build is running, so the mark was placed on the parts of r3; it is checked against the next build that works')
    const failed = textOf(await addMarkTool(fake({ state: FAILED }), 'bracket', { kind: 'pin', note: 'here', ref: 'base/F5' }))
    expect(failed.split('\n').at(-1)).toBe('revision r3, stale: the latest build failed, so the mark was placed on the parts of r3; it is checked against the next build that works')
  })
})

describe('describe', () => {
  it("is the kernel's reply as JSON, for the layout on screen", async () => {
    const deps = fake()
    const result = await describeTool(deps, 'bracket', { ref: 'base/F5' })
    expect(result.isError).toBeUndefined()
    expect(jsonOf(result)).toEqual({ layout: 'assembly', revision: 3, ...FACE, area: 1200 })
    expect(deps.w.described).toEqual([{ layout: 'assembly', ref: 'base/F5' }])
  })

  it('gives the box of a part without the noise of measuring it: a loft’s z min of -1e-07 is 0, never -0, and an approximate area stays as the kernel says it', async () => {
    const loft = { ...WHOLE, bbox: { min: [-20, -15, -1e-7], max: [20, 15.00000004, 2.5] }, area: 3100.1234567, areaExact: false, descriptor: 'part, 40 × 30 × 2.5 mm, 6000 mm³, 6 faces' }
    const text = textOf(await describeTool(fake({ describe: async () => loft as unknown as Described }), 'bracket', { ref: 'base' }))
    expect(JSON.parse(text)).toMatchObject({ bbox: { min: [-20, -15, 0], max: [20, 15, 2.5] }, area: 3100.1235, areaExact: false })
    expect(text).not.toMatch(/-0[,\]]|e-0/)
    // An area with no digit count is told like any other: nothing here reads the kernel's words for it.
    expect(TOOLS.measure.description).toContain('with no digit count')
    expect(TOOLS.describe.description).toContain('areaExact false is approximate')
  })

  it('asks in the layout named, and of a whole part or an edge alike', async () => {
    const deps = fake()
    expect(jsonOf(await describeTool(deps, 'bracket', { ref: 'post', layout: 'print' }))).toMatchObject({ layout: 'print', kind: 'part', key: 'print:post' })
    expect(jsonOf(await describeTool(deps, 'bracket', { ref: 'base/E11' }))).toMatchObject({ kind: 'edge', descriptor: 'line, 40 mm' })
    expect(deps.w.described).toEqual([
      { layout: 'print', ref: 'post' },
      { layout: 'assembly', ref: 'base/E11' }
    ])
  })

  it('uses the first layout for an object the window does not show', async () => {
    const deps = fake({ openObjectId: () => 'helmet-stand' })
    expect(jsonOf(await describeTool(deps, 'bracket', { ref: 'base' })).layout).toBe('assembly')
  })

  it('returns a mark for its number, built or not', async () => {
    const result = await describeTool(fake({ state: null, noScene: true }), 'bracket', { ref: 'M2' })
    expect(jsonOf(result)).toMatchObject({ revision: null, mark: { id: 'M2', kind: 'stroke', points2d: [[0, 0], [10, 5]] } })
    expect(await describeTool(fake(), 'bracket', { ref: 'M9' })).toEqual({ isError: true, content: [{ type: 'text', text: 'no mark M9; marks: M1, M2, M3, M4' }] })
  })

  it.each([
    [{ ref: 'lid' }, "no part 'lid' in layout assembly (parts: base, post)"],
    [{ ref: 'lid/F2' }, "no part 'lid' in layout assembly (parts: base, post)"],
    [{ ref: 'base/F6' }, 'base has 6 faces, F0 to F5: there is no F6'],
    [{ ref: 'post/E3' }, 'post has 3 edges, E0 to E2: there is no E3'],
    [{ ref: 'base/top' }, "no part 'base/top' in layout assembly (parts: base, post); a ref is a part, part/F<n> or part/E<n>"],
    [{ ref: 'base', layout: 'exploded' }, "no layout 'exploded'; layouts: assembly, print"]
  ])('says what there is when %o names nothing', async (args, text) => {
    const deps = fake()
    expect(await describeTool(deps, 'bracket', args)).toEqual({ isError: true, content: [{ type: 'text', text }] })
    expect(deps.w.described).toEqual([])
  })

  it('passes on what the kernel says when it cannot answer, and that there is no build', async () => {
    const failing = fake({ describe: async () => Promise.reject(new Error('the kernel did not answer within 30 s')) })
    expect(await describeTool(failing, 'bracket', { ref: 'base' })).toMatchObject({ isError: true, content: [{ text: 'the kernel did not answer within 30 s' }] })
    expect(textOf(await describeTool(fake({ state: null, noScene: true }), 'bracket', { ref: 'base' }))).toBe('no build yet: bracket has not been opened in the torno window')
    expect(textOf(await describeTool(fake(), 'nothing', { ref: 'base' }))).toBe('unknown object: nothing')
  })
})

describe('highlight', () => {
  it('has the window tint the refs, with the note, and says what was highlighted', async () => {
    const deps = fake()
    const result = await highlightTool(deps, 'bracket', { refs: ['base/F5', 'post', 'base/E0'], note: ' this one? ' })
    expect(result.isError).toBeUndefined()
    expect(deps.w.highlights).toEqual([{ layout: 'assembly', refs: ['base/F5', 'post', 'base/E0'], note: 'this one?' }])
    expect(textOf(result)).toBe('highlighted base/F5, post, base/E0 in layout assembly for the user, with the note "this one?", until they click in the viewport or 60 s pass.')
  })

  it('takes a mark number for what the mark is on, once', async () => {
    const deps = fake()
    const result = await highlightTool(deps, 'bracket', { refs: ['M1', 'base/F5'] })
    expect(deps.w.highlights).toEqual([{ layout: 'assembly', refs: ['base/F5'] }])
    expect(textOf(result)).toBe('highlighted base/F5 in layout assembly for the user, until they click in the viewport or 60 s pass.')
  })

  it('highlights nothing when a ref does not exist, and names each with what there is', async () => {
    const deps = fake()
    const result = await highlightTool(deps, 'bracket', { refs: ['base/F5', 'lid/F1', 'post/F3', 'M9', 'M3', 'M4'] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      "nothing was highlighted: no part 'lid' in layout assembly (parts: base, post); post has 3 faces, F0 to F2: there is no F3; no mark M9 (marks: M1, M2, M3, M4); M3 is in layout print, not assembly; M4 is not on a part, a face or an edge"
    )
    expect(deps.w.highlights).toEqual([])
  })

  it('says so when a mark is on a face the build no longer has', async () => {
    const deps = fake()
    deps.w.list[0] = { ...deps.w.list[0], anchor: { point: [0, 0, 0], part: 'base', ref: 'base/F40' } } as Mark
    expect(textOf(await highlightTool(deps, 'bracket', { refs: ['M1'] }))).toBe('nothing was highlighted: M1 is on base/F40, but base has 6 faces, F0 to F5: there is no F40')
  })

  it('does not point at where a mark was, once the mark has moved or lost its part', async () => {
    const deps = fake()
    deps.w.list[0] = { ...deps.w.list[0], anchorState: 'drifted' } as Mark
    deps.w.list[1] = { ...MARK_BASE, id: 'M2', kind: 'pick', target: 'edge', anchorState: 'orphaned', anchor: { point: [0, 0, 0], part: 'base', ref: 'base/E7' } }
    const result = await highlightTool(deps, 'bracket', { refs: ['base/F1', 'M1', 'M2'] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'nothing was highlighted: M1 was placed on base/F5, which has moved since: the ref may name something else now; the part M2 was placed on is gone'
    )
    expect(deps.w.highlights).toEqual([])
  })

  it('does not point at what a mark is on when the last build has not confirmed it, as measure does not measure through it', async () => {
    const deps = fake()
    // Checked against r2; the build is r3: its ref is of the build before, where F5 may have been another face.
    deps.w.list[0] = { ...deps.w.list[0], checkedRevision: 2 } as Mark
    const result = await highlightTool(deps, 'bracket', { refs: ['M1'] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('nothing was highlighted: M1 has not been checked against r3 yet, so what it is on is not known: give a ref, or ask again in a moment')
    expect(deps.w.highlights).toEqual([])
  })

  it('cuts the note at 2000 characters', async () => {
    const deps = fake()
    await highlightTool(deps, 'bracket', { refs: ['base'], note: 'n'.repeat(5000) })
    expect(deps.w.highlights[0].note).toHaveLength(2000)
  })

  it('refuses an object that is not the one open in the window, an unknown layout, and no build', async () => {
    const elsewhere = fake({ openObjectId: () => 'helmet-stand' })
    expect(textOf(await highlightTool(elsewhere, 'bracket', { refs: ['base'] }))).toBe('bracket is not the object open in the torno window (open: helmet-stand). Ask the user to open it.')
    expect(elsewhere.w.highlights).toEqual([])
    expect(textOf(await highlightTool(fake(), 'bracket', { refs: ['base'], layout: 'exploded' }))).toBe("no layout 'exploded'; layouts: assembly, print")
    expect((await highlightTool(fake({ state: null, noScene: true }), 'bracket', { refs: ['base'] })).isError).toBe(true)
  })

  it("answers with the window's own words when it cannot, and says when the window had moved on", async () => {
    const refusing = fake({ highlight: async () => Promise.reject(new Error('layout print is not the one on screen (assembly): call show with that layout first')) })
    expect(await highlightTool(refusing, 'bracket', { refs: ['base'], layout: 'print' })).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'layout print is not the one on screen (assembly): call show with that layout first' }]
    })
    const hidden = fake({ highlight: async () => Promise.reject(new Error('nothing was highlighted: post is hidden, so the user would see nothing of it. Call show with parts ["base","post"] first, which changes what the user sees')) })
    expect(await highlightTool(hidden, 'bracket', { refs: ['post'] })).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'nothing was highlighted: post is hidden, so the user would see nothing of it. Call show with parts ["base","post"] first, which changes what the user sees' }]
    })
    const moved = fake({ highlight: async (_id, layout, refs) => ({ objectId: 'helmet-stand', layout, refs, revision: 1 }) })
    expect(textOf(await highlightTool(moved, 'bracket', { refs: ['base'] }))).toBe('bracket is not the object open in the torno window (open: helmet-stand). Ask the user to open it.')
    const newer = fake({ highlight: async (objectId, layout, refs) => ({ objectId, layout, refs, revision: 4 }) })
    expect(textOf(await highlightTool(newer, 'bracket', { refs: ['base'] }))).toContain('The window shows r4, not r3: check the refs with describe.')
  })
})

describe('show', () => {
  it("changes the user's view and answers with the caption a look would have", async () => {
    const deps = fake()
    const result = await showTool(deps, 'bracket', { view: 'top', layout: 'print', parts: ['post'] })
    expect(result.isError).toBeUndefined()
    expect(deps.w.shows).toEqual([{ objectId: 'bracket', view: 'top', layout: 'print', parts: ['post'] }])
    expect(textOf(result)).toBe("view top · layout assembly · parts base, post · orthographic\nrevision r3\nThe user's viewport now shows this.")
  })

  it('makes a camera of a position and a target', async () => {
    const deps = fake()
    await showTool(deps, 'bracket', { view: { position: [0, 0, 100], target: [0, 0, 0] } })
    expect(deps.w.shows).toEqual([{ objectId: 'bracket', view: { position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0], ortho: false, fov: 35, zoom: 1 } }])
  })

  it.each([
    [{}, 'nothing to show: give a view, a layout, parts, a section, an explode or scans'],
    [{ layout: 'exploded' }, "no layout 'exploded'; layouts: assembly, print"],
    [{ parts: [] }, 'parts is empty: name the parts to leave switched on'],
    [{ view: { position: [1, 1, 1], target: [1, 1, 1] } }, 'position and target are the same']
  ] as const)('changes nothing for %o', async (args, text) => {
    const deps = fake()
    expect(await showTool(deps, 'bracket', args as never)).toEqual({ isError: true, content: [{ type: 'text', text }] })
    expect(deps.w.shows).toEqual([])
  })

  it('refuses an object that is not the one open in the window', async () => {
    const deps = fake({ openObjectId: () => null })
    expect(textOf(await showTool(deps, 'bracket', { view: 'top' }))).toBe('bracket is not the object open in the torno window (open: none). Ask the user to open it.')
    expect(deps.w.shows).toEqual([])
  })

  it("answers with the window's own words when it cannot, and says when what it shows is stale", async () => {
    const refusing = fake({ show: async () => Promise.reject(new Error("unknown part 'lid'; parts in layout assembly: base, post")) })
    expect(await showTool(refusing, 'bracket', { parts: ['lid'] })).toEqual({ isError: true, content: [{ type: 'text', text: "unknown part 'lid'; parts in layout assembly: base, post" }] })
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 3, stale: true, error: { kind: 'exception', message: 'no' } }
    const stale = fake({ state: failed, show: async (objectId) => ({ caption: 'view top', objectId, revision: 3, stale: true }) })
    expect(textOf(await showTool(stale, 'bracket', { view: 'top' }))).toBe("view top\nrevision r3, stale: the latest build failed, so these are still the parts of r3\nThe user's viewport now shows this.")
  })
})

describe('add_mark', () => {
  it("places a pin at the centre of a face named by ref, as the agent's, on the build it saw", async () => {
    const deps = fake()
    const result = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'this face?', ref: 'base/F5' })
    expect(result.isError).toBeUndefined()
    expect(deps.w.described).toEqual([{ layout: 'assembly', ref: 'base/F5' }])
    expect(deps.w.added).toHaveLength(1)
    expect(deps.w.added[0]).toMatchObject({
      kind: 'pin',
      author: 'agent',
      note: 'this face?',
      layout: 'assembly',
      revision: 3,
      anchor: { point: [0, 0, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F5', descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' }
    })
    // A view of the mark from the side its face looks to.
    expect(deps.w.added[0].camera.target).toEqual([0, 0, 2.5])
    expect(deps.w.added[0].camera.position[2]).toBeGreaterThan(2.5)
    expect(said(result)).toBe('placed in layout assembly: (yours) M5 pin on base/F5 (plane, normal +Z, z = 2.5, 1200 mm²) at (0, 0, 2.5): "this face?"')
  })

  it('ties a pin given only a point to the part whose surface it is on', async () => {
    const deps = fake()
    deps.w.distance = (part) => (part === 'post' ? 0.1 : 12)
    const result = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'here', point: [3, 1, 20] })
    expect(deps.w.asked).toEqual([{ layout: 'assembly', anchors: [{ part: 'base', point: [3, 1, 20] }, { part: 'post', point: [3, 1, 20] }] }])
    expect(deps.w.added[0]).toMatchObject({ kind: 'pin', anchor: { point: [3, 1, 20], part: 'post', ref: 'post/F5', normal: [0, 0, 1], descriptor: 'nearest of post' } })
    expect(said(result)).toBe('placed in layout assembly: (yours) M5 pin on post/F5 (nearest of post) at (3, 1, 20): "here"')
  })

  it('leaves a pin that is on no part in space, and says so', async () => {
    const deps = fake()
    deps.w.distance = () => 30
    const result = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'up here', point: [0, 0, 80] })
    expect((deps.w.added[0] as { anchor: object }).anchor).toEqual({ point: [0, 0, 80] })
    expect(said(result)).toBe('placed in layout assembly: (yours) M5 pin at (0, 0, 80): "up here"\nThe point is on no part of this layout, so the mark is tied to none.')
  })

  it('by a point the kernel could say nothing of on some part, fails with what the kernel said: the point may be on that part', async () => {
    const answers = (post: object): ToolDeps['nearest'] => async (_objectId, _layout, anchors) =>
      anchors.map(({ part, point }) => (part === 'base' ? { part, found: true, error: 'the point of assembly:base nearest to the anchor is on none of its faces' } : { part, found: true, point, normal: [0, 0, 1], ref: 'post/F5', distance: 30, descriptor: 'nearest of post', ...post })) as NearestAnchor[]
    const deps = fake({ nearest: answers({}) })
    const result = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'up here', point: [0, 0, 80] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('the kernel could not say whether (0, 0, 80) is on base: the point of assembly:base nearest to the anchor is on none of its faces. No mark was placed: give a ref.')
    expect(deps.w.added).toEqual([])

    // On a part it could answer for, the point is on that part whatever was not said of the others.
    const onPost = fake({ nearest: answers({ distance: 0.1 }) })
    expect((await addMarkTool(onPost, 'bracket', { kind: 'pin', note: 'here', point: [0, 0, 80] })).isError).toBeUndefined()
    expect(onPost.w.added[0]).toMatchObject({ anchor: { part: 'post', ref: 'post/F5' } })
  })

  it('picks an edge or a whole part by its ref', async () => {
    const deps = fake()
    await addMarkTool(deps, 'bracket', { kind: 'pick', note: 'round this', ref: 'base/E7' })
    await addMarkTool(deps, 'bracket', { kind: 'pick', note: 'too heavy', ref: 'post', layout: 'print' })
    expect(deps.w.added[0]).toMatchObject({ kind: 'pick', target: 'edge', anchor: { point: [0, 15, 2.5], part: 'base', ref: 'base/E7', descriptor: 'line, 40 mm' } })
    expect(deps.w.added[1]).toMatchObject({ kind: 'pick', target: 'part', layout: 'print', anchor: { point: [0, 0, 2.5], part: 'post', ref: 'post', descriptor: 'part, 40 × 30 × 5 mm, 6000 mm³, 6 faces' } })
  })

  it('puts a mark by ref on the surface: at the point of it nearest the centre of the face or the part', async () => {
    const deps = fake()
    // As for a cylinder, whose centre is on its axis: 4 mm from the face itself.
    deps.w.distance = () => 4
    deps.describe = async () => ({ ...FACE, center: [3, 4, 9] })
    const result = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'here', ref: 'base/F5' })
    expect(deps.w.asked).toEqual([{ layout: 'assembly', anchors: [{ part: 'base', point: [3, 4, 9] }] }])
    expect(deps.w.added[0]).toMatchObject({ anchor: { point: [3, 4, 2.5], ref: 'base/F5', normal: [0, 0, 1] } })
    expect(said(result)).toBe('placed in layout assembly: (yours) M5 pin on base/F5 (plane, normal +Z, z = 2.5, 1200 mm²) at (3, 4, 2.5): "here"')
  })

  it('refuses a pick of a face whose centre is not on it, as in the hole of a ring: the mark kept would be of another face', async () => {
    // The fake kernel finds every point on base/F5: the centre of base/F2 is not on base/F2. Far or near, it is refused.
    for (const distance of [4, 0.01]) {
      const deps = fake()
      deps.w.distance = () => distance
      expect(await addMarkTool(deps, 'bracket', { kind: 'pick', note: 'this rim', ref: 'base/F2' })).toEqual({
        isError: true,
        content: [{ type: 'text', text: 'the centre of base/F2 is not on it (a face with a hole, a ring or a short cylinder): give a point on base/F2' }]
      })
      expect(deps.w.added).toEqual([])
    }
    const deps = fake()
    expect(said(await addMarkTool(deps, 'bracket', { kind: 'pick', note: 'this rim', ref: 'base/F2', point: [5, 5, 2.5] }))).toBe('the point (5, 5, 2.5) is on base/F5, not base/F2: give a point on base/F2')
    expect(deps.w.added).toEqual([])
  })

  it('puts a pin or the start of an arrow on the face that is under its point, and says which when it is not the one named', async () => {
    for (const distance of [4, 0.01]) {
      const deps = fake()
      deps.w.distance = () => distance
      const result = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'here', ref: 'base/F2' })
      // What is kept is what the check that follows the adding would make of it: nothing is left to rewrite.
      expect((deps.w.added[0] as { anchor: Anchor }).anchor).toEqual({ point: [0, 0, 2.5], part: 'base', ref: 'base/F5', normal: [0, 0, 1], descriptor: 'nearest of base' })
      expect(said(result)).toBe(
        'placed in layout assembly: (yours) M5 pin on base/F5 (nearest of base) at (0, 0, 2.5): "here"\nThe centre of base/F2 is not on it: the mark is placed on base/F5, the face under that point. Give a point on base/F2 to put it there.'
      )
    }
    const deps = fake()
    const arrow = await addMarkTool(deps, 'bracket', { kind: 'arrow', note: '', ref: 'base/F2', point: [5, 5, 2.5], by: [0, 0, 5] })
    expect(deps.w.added[0]).toMatchObject({ from: { point: [5, 5, 2.5], ref: 'base/F5', descriptor: 'nearest of base' } })
    expect(said(arrow)).toContain('M5 arrow from base/F5 (nearest of base) at (5, 5, 2.5)')
    expect(said(arrow)).toContain('\nThe point is on base/F5, not base/F2: the mark is placed on base/F5, the face under that point.')
  })

  it('puts a pin named by a part or an edge on the face under it, as it would be found to be', async () => {
    const deps = fake()
    const byPart = await addMarkTool(deps, 'bracket', { kind: 'pin', note: '', ref: 'base' })
    expect((deps.w.added[0] as { anchor: Anchor }).anchor).toEqual({ point: [0, 0, 2.5], part: 'base', ref: 'base/F5', normal: [0, 0, 1], descriptor: 'nearest of base' })
    expect(said(byPart)).toBe('placed in layout assembly: (yours) M5 pin on base/F5 (nearest of base) at (0, 0, 2.5)')
  })

  it('puts a pin named by an edge on that edge: at its middle, or at a point on it, with the faces it is between', async () => {
    const deps = fake()
    const byEdge = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'this edge is ugly', ref: 'base/E7' })
    expect(deps.w.asked).toEqual([{ layout: 'assembly', anchors: [{ part: 'base', point: [0, 15, 2.5], edge: 'base/E7' }] }])
    expect((deps.w.added[0] as { anchor: Anchor }).anchor).toEqual({ point: [0, 15, 2.5], part: 'base', ref: 'base/E7', edge: 'base/E7', between: ['base/F2', 'base/F5'], descriptor: 'line, 40 mm' })
    expect(said(byEdge)).toBe('placed in layout assembly: (yours) M5 pin on the edge base/E7 between base/F2 and base/F5 (line, 40 mm) at (0, 15, 2.5): "this edge is ugly"')
    await addMarkTool(deps, 'bracket', { kind: 'pin', note: '', ref: 'base/E7', point: [10, 15, 2.5] })
    expect(deps.w.added[1]).toMatchObject({ anchor: { point: [10, 15, 2.5], ref: 'base/E7', edge: 'base/E7' } })
    // Beside the edge, it is not a pin on the edge.
    deps.w.edgeDistance = 3.21
    expect(said(await addMarkTool(deps, 'bracket', { kind: 'pin', note: '', ref: 'base/E7', point: [10, 12, 2.5] }))).toBe(
      'the point (10, 12, 2.5) is 3.21 mm from base/E7: give a point on the edge, or leave the point out to use its middle'
    )
    expect(deps.w.added).toHaveLength(2)
  })

  it('says so when a pin named by an edge and a point lands on another edge than the one named', async () => {
    const deps = fake()
    deps.w.near = { support: 'edge', edgeUnder: 'base/E7', edgeUnderDescriptor: 'line, 40 mm', between: ['base/F2', 'base/F5'] }
    const result = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'here', ref: 'base/E5', point: [20, 15, 2.5] })
    expect(deps.w.added[0]).toMatchObject({ anchor: { ref: 'base/E7', edge: 'base/E7' } })
    expect(said(result)).toBe(
      'placed in layout assembly: (yours) M5 pin on the edge base/E7 between base/F2 and base/F5 (line, 40 mm) at (20, 15, 2.5): "here"\nThe pin is placed on base/E7, the edge under that point, not base/E5.'
    )
    // On the edge named, nothing more is said.
    const same = await addMarkTool(deps, 'bracket', { kind: 'pin', note: '', ref: 'base/E7', point: [10, 15, 2.5] })
    expect(said(same)).not.toContain('not base/')
  })

  it('says a pin is on an edge when the kernel finds its point on one, whatever named the point', async () => {
    const deps = fake()
    deps.w.near = { support: 'edge', edgeUnder: 'base/E3', edgeUnderDescriptor: 'line, 30 mm', between: ['base/F1', 'base/F5'] }
    const result = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'here', point: [20, 1, 2.5] })
    expect((deps.w.added[0] as { anchor: Anchor }).anchor).toEqual({ point: [20, 1, 2.5], part: 'base', ref: 'base/E3', edge: 'base/E3', between: ['base/F1', 'base/F5'], descriptor: 'line, 30 mm' })
    expect(said(result)).toBe('placed in layout assembly: (yours) M5 pin on the edge base/E3 between base/F1 and base/F5 (line, 30 mm) at (20, 1, 2.5): "here"')
    // An arrow starts on the face, as before.
    await addMarkTool(deps, 'bracket', { kind: 'arrow', note: '', point: [20, 1, 2.5], by: [0, 0, 5] })
    expect(deps.w.added[1]).toMatchObject({ from: { ref: 'base/F5' } })
    expect(deps.w.added[1]).not.toHaveProperty('from.edge')
  })

  it('passes on that the kernel could say nothing of the point', async () => {
    const deps = fake({ nearest: async (_id, _layout, anchors) => anchors.map(({ part }) => ({ part, found: true, error: 'the point of assembly:base nearest to the anchor is on none of its faces' })) })
    expect(said(await addMarkTool(deps, 'bracket', { kind: 'pin', note: '', ref: 'base/F5', point: [1, 1, 2.5] }))).toBe(
      'the kernel could not say where (1, 1, 2.5) is on base: the point of assembly:base nearest to the anchor is on none of its faces'
    )
    expect(deps.w.added).toEqual([])
  })

  it('refuses an arrow given both where it ends and by how much: one of them would be ignored', async () => {
    const deps = fake()
    expect(await addMarkTool(deps, 'bracket', { kind: 'arrow', note: '', ref: 'base/F5', to: [0, 0, 10], by: [0, 0, 5] })).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'an arrow takes to (where it ends) or by (the vector from its start), not both' }]
    })
    expect(deps.w.added).toEqual([])
  })

  it('says of an arrow that it starts on the face, and of a shape that it is tied to it', async () => {
    const deps = fake()
    const arrow = await addMarkTool(deps, 'bracket', { kind: 'arrow', note: '', ref: 'base/E7', by: [0, 0, 5] })
    expect(said(arrow)).toContain('\nAn arrow starts on a face: it starts on base/F5, the face under the middle of base/E7. Use a pick to mark the edge itself.')
    const shape = await addMarkTool(deps, 'bracket', { kind: 'shape', note: '', ref: 'base/E7', shape: 'box', intent: 'add', size: [5, 5, 5], position: [0, 15, 5] })
    expect(said(shape)).toContain('\nA shape is tied to a face: it is tied to base/F5, the face under the middle of base/E7. Use a pick to mark the edge itself.')
  })

  it('keeps and says what the kernel finds at the rounded point it keeps, not at the one it rounded', async () => {
    const deps = fake()
    // The middle of a curved edge, as measured; the point of the surface nearest to it rounds to another, which is on the next face.
    const nearest = deps.nearest
    deps.nearest = async (objectId, layout, anchors) => {
      const found = await nearest(objectId, layout, anchors)
      return found.map((one, i) => {
        if (!one.found) return one
        const exact = anchors[i].point[0] === 0
        return { ...one, point: exact ? [0.00016, 15, 2.5] : anchors[i].point, ref: exact ? 'base/F5' : 'base/F6', descriptor: exact ? 'the face before rounding' : 'the face at the rounded point' } as NearestAnchor
      })
    }
    // An arrow from an edge starts on the face there (a pin would be on the edge itself).
    const result = await addMarkTool(deps, 'bracket', { kind: 'arrow', note: '', ref: 'base/E7', by: [0, 0, 5] })
    expect(deps.w.asked.map((a) => a.anchors[0].point)).toEqual([[0, 15, 2.5], [0.0002, 15, 2.5]])
    expect((deps.w.added[0] as { from: Anchor }).from).toEqual({ point: [0.0002, 15, 2.5], part: 'base', ref: 'base/F6', normal: [0, 0, 1], descriptor: 'the face at the rounded point' })
    expect(said(result)).toContain('M5 arrow from base/F6 (the face at the rounded point) at (0.0002, 15, 2.5)')
    expect(said(result)).toContain('it starts on base/F6, the face under the middle of base/E7')
  })

  it('leaves a mark on an edge at the middle of the edge, which needs no asking', async () => {
    const deps = fake()
    const result = await addMarkTool(deps, 'bracket', { kind: 'pick', note: 'this hole', ref: 'base/E7' })
    expect(deps.w.added[0]).toMatchObject({ target: 'edge', anchor: { point: [0, 15, 2.5], ref: 'base/E7', descriptor: 'line, 40 mm' } })
    expect(deps.w.added[0]).not.toHaveProperty('anchor.normal')
    expect(deps.w.asked).toEqual([])
    expect(said(result)).not.toContain('\n')
  })

  it('takes a point with an edge only when the point is on that edge, within half a millimetre', async () => {
    const deps = fake()
    deps.w.edgeDistance = 0.5
    await addMarkTool(deps, 'bracket', { kind: 'pick', note: 'round this', ref: 'base/E7', point: [10, 15, 2.5] })
    expect(deps.w.asked).toEqual([{ layout: 'assembly', anchors: [{ part: 'base', point: [10, 15, 2.5], edge: 'base/E7' }] }])
    expect(deps.w.added[0]).toMatchObject({ kind: 'pick', target: 'edge', anchor: { point: [10, 15, 2.5], part: 'base', ref: 'base/E7', descriptor: 'line, 40 mm' } })
    // An edge has no one normal.
    expect(deps.w.added[0]).not.toHaveProperty('anchor.normal')

    // On the surface, but beside the edge: kept, it would be said to have drifted at once.
    deps.w.edgeDistance = 3.21
    expect(await addMarkTool(deps, 'bracket', { kind: 'pick', note: 'round this', ref: 'base/E7', point: [10, 12, 2.5] })).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'the point (10, 12, 2.5) is 3.21 mm from base/E7: give a point on the edge, or leave the point out to use its middle' }]
    })
    deps.w.edgeDistance = undefined
    expect(said(await addMarkTool(deps, 'bracket', { kind: 'pick', note: '', ref: 'base/E7', point: [10, 12, 2.5] }))).toBe(
      'the kernel did not say how far the point (10, 12, 2.5) is from base/E7: leave the point out to use the middle of the edge'
    )
    expect(deps.w.added).toHaveLength(1)
  })

  it('takes a point with the ref of the face it is on', async () => {
    const deps = fake()
    const onIt = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'here', ref: 'base/F5', point: [5, 5, 2.5] })
    expect(deps.w.added[0]).toMatchObject({ anchor: { point: [5, 5, 2.5], ref: 'base/F5', normal: [0, 0, 1], descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' } })
    expect(said(onIt)).not.toContain('\n')
    await addMarkTool(deps, 'bracket', { kind: 'pick', note: 'here', ref: 'base/F5', point: [5, 5, 2.5] })
    expect(deps.w.added[1]).toMatchObject({ kind: 'pick', target: 'face', anchor: { point: [5, 5, 2.5], ref: 'base/F5' } })
  })

  it('refuses a point that is not on the part of its ref', async () => {
    const deps = fake()
    deps.w.distance = () => 12.3456
    const result = await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'here', ref: 'base/F5', point: [5, 5, 30] })
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'the point (5, 5, 30) is 12.35 mm from the surface of base: give a point on it, or leave the point out to use the centre of base/F5' }]
    })
    expect(deps.w.added).toEqual([])
  })

  it('draws an arrow from a ref or a point, to a point or by a vector', async () => {
    const deps = fake()
    const result = await addMarkTool(deps, 'bracket', { kind: 'arrow', note: 'move this out', ref: 'base/F5', by: [0, 0, 14.2] })
    await addMarkTool(deps, 'bracket', { kind: 'arrow', note: '', point: [1, 2, 2.5], to: [1, 2, 10] })
    expect(deps.w.added[0]).toMatchObject({ kind: 'arrow', from: { point: [0, 0, 2.5], ref: 'base/F5' }, to: [0, 0, 16.7] })
    expect(deps.w.added[1]).toMatchObject({ kind: 'arrow', from: { point: [1, 2, 2.5], part: 'base' }, to: [1, 2, 10] })
    expect(said(result)).toBe('placed in layout assembly: (yours) M5 arrow from base/F5 (plane, normal +Z, z = 2.5, 1200 mm²) at (0, 0, 2.5) by (0, 0, 14.2), 14.2 mm: "move this out"')
  })

  it('places a shape in space, not turned unless told, with the sizes its kind has', async () => {
    const deps = fake()
    const result = await addMarkTool(deps, 'bracket', { kind: 'shape', note: 'pocket here', shape: 'box', size: [10, 10, 4], position: [5, 5, 4.5], intent: 'remove' })
    await addMarkTool(deps, 'bracket', { kind: 'shape', note: '', shape: 'cylinder', size: [8, 99, 20], position: [0, 0, 0], intent: 'add', rotation: [0, 0, 2, 2] })
    await addMarkTool(deps, 'bracket', { kind: 'shape', note: '', shape: 'plane', size: [30, 20, 7], position: [0, 0, 0], intent: 'reference' })
    expect(deps.w.added[0]).toMatchObject({ kind: 'shape', author: 'agent', shape: 'box', intent: 'remove', size: [10, 10, 4], position: [5, 5, 4.5], rotation: [0, 0, 0, 1] })
    expect(deps.w.added[0]).not.toHaveProperty('anchor')
    expect(deps.w.added[1]).toMatchObject({ shape: 'cylinder', size: [8, 8, 20] })
    expect((deps.w.added[1] as { rotation: number[] }).rotation[3]).toBeCloseTo(Math.SQRT1_2)
    expect(deps.w.added[2]).toMatchObject({ shape: 'plane', size: [30, 20, 0] })
    expect(said(result)).toBe('placed in layout assembly: (yours) M5 box 10 × 10 × 4 mm centred at (5, 5, 4.5), intent remove: "pocket here"')
    // The kernel is not asked about a shape that is tied to nothing.
    expect(deps.w.described).toEqual([])
    expect(deps.w.asked).toEqual([])
  })

  it.each([
    [{ kind: 'pick', note: '' }, 'a pick needs a ref: the part, face or edge it is of. For a point, place a pin'],
    [{ kind: 'pin', note: '' }, 'a pin needs a ref or a point'],
    [{ kind: 'arrow', note: '', to: [0, 0, 1] }, 'an arrow needs a ref or a point to start from'],
    [{ kind: 'arrow', note: '', ref: 'base/F5' }, 'an arrow needs to (where it ends) or by (the vector from its start), in mm'],
    [{ kind: 'arrow', note: '', ref: 'base/F5', by: [0, 0, 0] }, 'the arrow would end where it starts, at (0, 0, 2.5)'],
    [{ kind: 'shape', note: '', shape: 'box', size: [1, 1, 1] }, 'a shape needs position, intent: shape is one of box, cylinder, sphere, plane; intent one of add, remove, keep-out, reference; size and position are [x, y, z] in mm'],
    [{ kind: 'shape', note: '', shape: 'box', size: [1, 0, 1], position: [0, 0, 0], intent: 'add' }, 'the size of a box must be positive: (1, 0, 1)'],
    [{ kind: 'shape', note: '', shape: 'box', size: [1, 1, 1], position: [0, 0, 0], intent: 'add', rotation: [0, 0, 0, 0] }, 'rotation is a quaternion [x, y, z, w]: it cannot be all zeros'],
    [{ kind: 'pin', note: '', ref: 'lid/F1' }, "no part 'lid' in layout assembly (parts: base, post)"],
    [{ kind: 'pin', note: '', ref: 'base/F6' }, 'base has 6 faces, F0 to F5: there is no F6'],
    [{ kind: 'pin', note: '', ref: 'base', layout: 'exploded' }, "no layout 'exploded'; layouts: assembly, print"]
  ] as const)('places nothing for %o', async (args, text) => {
    const deps = fake()
    expect(await addMarkTool(deps, 'bracket', args as never)).toEqual({ isError: true, content: [{ type: 'text', text }] })
    expect(deps.w.added).toEqual([])
  })

  it('cuts the note at 2000 characters, and passes on why a mark was not kept or the kernel did not answer', async () => {
    const deps = fake()
    await addMarkTool(deps, 'bracket', { kind: 'pin', note: 'n'.repeat(5000), ref: 'base' })
    expect(deps.w.added[0].note).toHaveLength(2000)
    const full = fake({ addMark: async () => Promise.reject(new Error('ENOSPC: no space left on device')) })
    expect(said(await addMarkTool(full, 'bracket', { kind: 'pin', note: '', ref: 'base' }))).toBe('ENOSPC: no space left on device')
    const silent = fake({ nearest: async () => Promise.reject(new Error('the kernel did not answer within 30 s')) })
    expect(await addMarkTool(silent, 'bracket', { kind: 'pin', note: '', point: [0, 0, 0] })).toMatchObject({ isError: true, content: [{ text: 'the kernel did not answer within 30 s' }] })
    expect(said(await addMarkTool(fake({ state: null, noScene: true }), 'bracket', { kind: 'pin', note: '', ref: 'base' }))).toContain('no build yet')
  })
})

describe('resolve_mark', () => {
  it('resolves the mark with the note, and says which it was', async () => {
    const deps = fake()
    const result = await resolveMarkTool(deps, 'bracket', { id: 'M1', note: ' filleted at 2 mm ' })
    expect(result.isError).toBeUndefined()
    expect(deps.w.updates).toEqual([{ id: 'M1', patch: { status: 'resolved', resolvedNote: 'filleted at 2 mm' } }])
    expect(textOf(result)).toBe('resolved: M1 pin on base/F5 (plane, normal +Z, z = 2.5, 1200 mm²) at (1, 2, 2.5): "here"\nnote: filleted at 2 mm')
  })

  it('needs no note, and cuts one at 2000 characters', async () => {
    const deps = fake()
    expect(textOf(await resolveMarkTool(deps, 'bracket', { id: 'M4' }))).toBe('resolved: (yours) M4 pin at (9, 9, 9)')
    await resolveMarkTool(deps, 'bracket', { id: 'M1', note: 'n'.repeat(5000) })
    expect(deps.w.updates.map((u) => u.patch.resolvedNote?.length)).toEqual([undefined, 2000])
  })

  it('echoes a dimension with the value it has on the build there is', async () => {
    const deps = fake()
    // A dimension is echoed with the value it has on the build there is: one measured on another says of which.
    const dimension = { ...MARK_BASE, id: 'M7', status: 'sent', note: '', kind: 'dimension', measure: 'diameter', a: { point: [-6, 5, 0], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder' } as Mark
    deps.w.list.push({ ...dimension, measuredRevision: 3 } as Mark, { ...dimension, id: 'M8', measuredRevision: 2 } as Mark)
    expect(textOf(await resolveMarkTool(deps, 'bracket', { id: 'M7' }))).toBe('resolved: M7 diameter 8 mm, base/F9\nM7 is no longer measured.')
    expect(textOf(await resolveMarkTool(deps, 'bracket', { id: 'M8' }))).toBe('resolved: M8 diameter 8 mm, base/F9 [as measured on r2]\nM8 is no longer measured.')
  })

  it('does not resolve a dimension of the person’s that has an expected value: it is their check of the part, and says how it stands', async () => {
    const deps = fake()
    const check = { ...MARK_BASE, status: 'sent', note: '', kind: 'dimension', measure: 'distance', a: { point: [0, 0, 2.5], part: 'base', ref: 'base/F5' }, b: { point: [0, 0, -2.5], part: 'base', ref: 'base/F0' }, how: 'between planes', expected: 8, measuredRevision: 3 } as const
    deps.w.list.push(
      { ...check, id: 'M5', value: 8, verdict: 'pass' } as Mark,
      { ...check, id: 'M6', value: 6, verdict: 'fail' } as Mark,
      { ...check, id: 'M7', value: 6, verdict: 'fail', measuredRevision: 2 } as Mark,
      { ...check, id: 'M8', value: undefined, refused: 'no' } as Mark,
      // The agent's own, with an expectation, is its to resolve; so is one of the person's already resolved (nothing changes).
      { ...check, id: 'M9', author: 'agent', value: 8, verdict: 'pass' } as Mark
    )
    const theirs = (id: string): string => `${id} is the person's check of the part: it stays measured on every build and only they resolve it.`
    expect(await resolveMarkTool(deps, 'bracket', { id: 'M5', note: 'done' })).toEqual({ isError: true, content: [{ type: 'text', text: `${theirs('M5')} It passes on r3.` }] })
    expect(textOf(await resolveMarkTool(deps, 'bracket', { id: 'M6' }))).toBe(`${theirs('M6')} It fails on r3: 6 mm, expected 8 ± 0.05 (2 under).`)
    expect(textOf(await resolveMarkTool(deps, 'bracket', { id: 'M7' }))).toBe(`${theirs('M7')} It is not measured on r3.`)
    expect(textOf(await resolveMarkTool(deps, 'bracket', { id: 'M8' }))).toBe(`${theirs('M8')} It is not measurable on r3.`)
    expect(deps.w.updates).toEqual([])
    const own = await resolveMarkTool(deps, 'bracket', { id: 'M9' })
    expect(own.isError).toBeUndefined()
    expect(textOf(own)).toBe('resolved: (yours) M9 distance 8 mm between planes, base/F5 to base/F0 (expected 8 ± 0.05: pass)\nM9 is no longer measured.')
    // Before any build there is nothing it stands on.
    const unbuilt = fake({ state: null, noScene: true })
    unbuilt.w.list.push({ ...check, id: 'M5', value: 8, verdict: 'pass' } as Mark)
    expect(textOf(await resolveMarkTool(unbuilt, 'bracket', { id: 'M5' }))).toBe(`${theirs('M5')} It is not measured: nothing is built yet.`)
  })

  it('the description and the system prompt say so', () => {
    expect(TOOLS.resolve_mark.description).toContain('A dimension of the user’s with an expected value is not yours to resolve')
    expect(TOOLS.resolve_mark.description).toContain('no longer measured')
  })

  it('names the marks there are when the id is of none', async () => {
    const deps = fake()
    for (const id of ['M9', 'three']) {
      expect(await resolveMarkTool(deps, 'bracket', { id })).toEqual({ isError: true, content: [{ type: 'text', text: `no mark ${id}; marks: M1, M2, M3, M4` }] })
    }
    expect(deps.w.updates).toEqual([])
    expect(textOf(await resolveMarkTool(deps, 'nothing', { id: 'M1' }))).toBe('unknown object: nothing')
  })
})

describe('scans in scene, look and show', () => {
  const TYPED: ScanAlignment = { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['typed'], frame: {}, at: '' }
  const scan = (id: string, alignments: Record<string, ScanAlignment> = {}): ScanInfo =>
    ({ id, name: `${id}.glb`, source: { path: `/dl/${id}.glb`, bytes: 1, mtimeMs: 1, sha256: '' }, imported: { unit: 'm', up: 'y', assumed: { unit: true, up: true }, vertices: 9, triangles: 722, colours: 'none', bbox: { min: [0, 0, 0], max: [1, 1, 1] }, area: 1, at: '' }, alignments, sourceState: 'present', meshState: 'ok', checks: {} }) as ScanInfo
  const SCANS = [scan('S1', { assembly: TYPED }), scan('S2', { print: TYPED })]
  const scanned = (over: Partial<ToolDeps> = {}): Fake => fake({ scans: async () => SCANS, ...over })
  const said = async (result: Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>): Promise<string> => {
    const answered = await result
    expect(answered.isError).toBe(true)
    return textOf(answered)
  }

  it('tells a region of a scan through marks, describe and resolve_mark where the scan stands, and never in the scan’s own frame', async () => {
    const region = { id: 'M5', kind: 'region', scan: 'S1', author: 'user', note: 'loom', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 3, camera: CAMERA, createdAt: '', triangles: 4812, area: 31000, local: { centroid: [-15, -15, 0], bbox: { min: [-20, -20, -0.5], max: [-10, -10, 0.5] }, plane: { origin: [-15, -15, 0], normal: [0, 0, 1], rms: 0.42 }, box: { centre: [-15, -15, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [5, 5, 0.5] } } } as unknown as Mark
    const moved: ScanAlignment = { ...TYPED, transform: { t: [100, 0, 5], q: [0, 0, 0, 1], s: 1 } }
    const deps = scanned({ scans: async () => [scan('S1', { assembly: moved })] })
    deps.w.list.push(region)
    const LINE = /^M5 region on scan S1: 4,812 triangles, ≈ 31000 mm², centre ≈ \(85, -15, 5\), ≈ 10 × 10 × 1 mm, within a box of ≈ 10 × 10 × 1 mm, flat about a plane with normal ≈ \(0, 0, 1\): "loom" \[S1's alignment was not checked against r3/
    const listed = jsonOf(await marksTool(deps, 'bracket', {})).marks.find((m: Mark) => m.id === 'M5')
    expect(listed).toMatchObject({ kind: 'region', scan: 'S1', triangles: 4812, area: 31000, toldIn: 'assembly', aligned: true, centroid: [85, -15, 5], size: [10, 10, 1], bbox: { min: [80, -20, 4.5], max: [90, -10, 5.5] }, flat: true })
    expect(listed.local).toBeUndefined()
    expect(listed.line).toMatch(LINE)
    const one = jsonOf(await describeTool(deps, 'bracket', { ref: 'M5' })).mark
    expect(one.line).toMatch(LINE)
    expect(one.local).toBeUndefined()
    expect(textOf(await resolveMarkTool(deps, 'bracket', { id: 'M5' }))).toMatch(/^resolved: M5 region on scan S1: 4,812 triangles, ≈ 31000 mm², centre ≈ \(85, -15, 5\)/)
    // I3: it is told in the layout asked, whichever it was painted in. Painted in print, the scan aligned in assembly only:
    const painted = scanned({ scans: async () => [scan('S1', { assembly: moved })] })
    painted.w.list.push({ ...region, layout: 'print' } as Mark)
    const inAssembly = jsonOf(await marksTool(painted, 'bracket', {})).marks.find((m: Mark) => m.id === 'M5')
    expect(inAssembly).toMatchObject({ layout: 'print', toldIn: 'assembly', aligned: true, centroid: [85, -15, 5] })
    expect(inAssembly.line).toMatch(LINE)
    const inPrint = jsonOf(await marksTool(painted, 'bracket', { layout: 'print' })).marks.find((m: Mark) => m.id === 'M5')
    expect(inPrint.line).toBe('M5 region on scan S1 (not aligned in print, so it has no place in the model’s frame): 4,812 triangles, ≈ 31000 mm², ≈ 10 × 10 × 1 mm, flat: "loom"')
    expect(inPrint).toMatchObject({ toldIn: 'print', aligned: false })
    expect(inPrint).not.toHaveProperty('centroid')
    expect(jsonOf(await describeTool(painted, 'bracket', { ref: 'M5', layout: 'print' })).mark.line).toBe(inPrint.line)
    // M7: the scans could not be read. An orphaned region is not then said to have lost its scan.
    const unread = scanned({ scans: async () => Promise.reject(new Error('EACCES')) })
    unread.w.list.push({ ...region, anchorState: 'orphaned' } as Mark)
    expect(jsonOf(await marksTool(unread, 'bracket', {})).marks.find((m: Mark) => m.id === 'M5').line).toBe('M5 region on scan S1 [its scan is gone, or is no longer the mesh it was painted on]: "loom"')
    expect(TOOLS.marks.description).toContain('a region is a part of a scan the user painted')
  })

  // Final fix wave (F6, F8, F15).
  it('look takes what a named view is fitted to, and says after the caption that spread parts are not where a scan drawn has them, and which scans have no mesh to draw', async () => {
    const deps = scanned()
    await lookTool(deps, 'bracket', { view: 'iso', frame: 'all' })
    await lookTool(deps, 'bracket', { view: 'iso' })
    expect(deps.looks.map((l) => l.req.frame)).toEqual(['all', undefined])
    expect(await said(lookTool(deps, 'bracket', { frame: 'everything' as never }))).toBe('frame is "parts" (the default: a named view is fitted to the parts drawn) or "all" (to the scans drawn with them)')
    expect(TOOLS.look.inputSchema.frame.description).toContain('the caption says when a scan drawn reaches beyond the picture')
    // A print layout torno spread, with a scan in the picture.
    const spread: Scene = { ...SCENE, parts: [...SCENE.parts.slice(0, 2), part('print', 'base', [-20, -15, -2.5], [20, 15, 2.5]), part('print', 'post', [56, -10, 0], [64, 10, 8], { arranged: [60, 0, 0] }), part('print', 'cap', [80, -10, 0], [90, 10, 8], { arranged: [85, 0, 0] })] }
    const drew = (layout: string, scans: string[]) => scanned({ scene: () => ({ revision: 3, scene: spread }), look: async () => ({ ...PICTURE, layout, scans }), show: async (objectId) => ({ caption: 'view iso · layout print', objectId, revision: 3, stale: false, layout, scans }) })
    const note = '\nThe parts of layout print were spread for display: post, cap are not where S2 has them (base is where the model places it).\n'
    expect(textOf(await lookTool(drew('print', ['S2']), 'bracket', { layout: 'print' }))).toContain(`${PICTURE.caption}${note}revision r3`)
    expect(textOf(await showTool(drew('print', ['S2']), 'bracket', { layout: 'print' }))).toContain(`view iso · layout print${note}revision r3`)
    // Said only where it is so: no scan drawn, or a layout that was not spread.
    expect(textOf(await lookTool(drew('print', []), 'bracket', { layout: 'print' }))).not.toContain('spread for display')
    expect(textOf(await lookTool(drew('assembly', ['S1']), 'bracket', {}))).not.toContain('spread for display')
    // A scan whose mesh is gone is in no picture, and that is said.
    const gone = scanned({ scans: async () => [{ ...SCANS[0], meshState: 'missing' }, SCANS[1]] })
    expect(textOf(await lookTool(gone, 'bracket', {}))).toContain(`${PICTURE.caption}\nS1 is not drawn: its mesh is gone from the disk (the user imports it again from the Scans panel).\nrevision r3`)
    expect(textOf(await lookTool(gone, 'bracket', { scans: false }))).not.toContain('not drawn')
    expect(textOf(await lookTool(gone, 'bracket', { scans: ['S2'] }))).not.toContain('not drawn')
  })

  it('scene names the scans, each with whether it is aligned in the layout it answers for, and where to ask how', async () => {
    const scene = JSON.parse(textOf(sceneTool(scanned(), 'bracket', [], SCANS)))
    // Final fix wave (T2): how the alignment stands, in a word, not a bare yes: one placed by hand and never checked is not "aligned: true".
    expect(scene.scans).toEqual([{ id: 'S1', name: 'S1.glb', triangles: 722, alignment: 'not checked', basis: 'hand' }, { id: 'S2', name: 'S2.glb', triangles: 722, alignment: 'not aligned' }])
    expect(scene.note).toBe('How each scan is aligned is said for layout assembly, in a word (aligned, rough, in doubt, not checked, not aligned): call scans for the whole of it.')
    // Final fix wave (T5): a layout the build has not is refused, not answered in another.
    expect(await said(marksTool(scanned(), 'bracket', { layout: 'asembly' }))).toBe("no layout 'asembly'; layouts: assembly, print")
    expect(await said(describeTool(scanned(), 'bracket', { ref: 'M1', layout: 'asembly' }))).toBe("no layout 'asembly'; layouts: assembly, print")
    const none = JSON.parse(textOf(sceneTool(scanned(), 'bracket', [], [])))
    expect(none.scans).toBeUndefined()
    expect(none.note).toBeUndefined()
  })

  it('look hands on which scans to draw, and refuses a number that is none or what is no list of them', async () => {
    const deps = scanned()
    await lookTool(deps, 'bracket', { scans: false })
    await lookTool(deps, 'bracket', { scans: true })
    await lookTool(deps, 'bracket', { scans: ['S1', 'S1'] })
    expect(deps.looks.map((look) => look.req)).toEqual([{ view: 'current', size: 1280, scans: false, explode: 'current' }, { view: 'current', size: 1280, explode: 'current' }, { view: 'current', size: 1280, scans: ['S1'], explode: 'current' }])
    expect(await said(lookTool(deps, 'bracket', { scans: ['S9'] }))).toBe('no scan S9; scans: S1, S2')
    expect(await said(lookTool(deps, 'bracket', { scans: 'S1' as never }))).toBe('scans is true for the scans on the user\'s screen, false for none, or a list of their numbers: {"scans": ["S1"]}')
    expect(await said(lookTool(fake(), 'bracket', { scans: ['S1'] }))).toBe('this object has no scans: the user imports one in the Scans panel of the torno window')
    expect(deps.looks).toHaveLength(3)
  })

  it('look hands on a scan to colour by its distance to a part, 20 mm unless told, and refuses what cannot be coloured truly', async () => {
    const deps = scanned()
    await lookTool(deps, 'bracket', { scanColour: { scan: 'S1', part: 'base' } })
    await lookTool(deps, 'bracket', { layout: 'print', scanColour: { scan: 'S2', part: 'post', range: 5 } })
    expect(deps.looks.map((look) => look.req.scanColour)).toEqual([{ scan: 'S1', part: 'base', range: 20 }, { scan: 'S2', part: 'post', range: 5 }])
    expect(await said(lookTool(deps, 'bracket', { scanColour: { scan: 'S1', part: 'cap' } }))).toBe("no part 'cap' in layout assembly (parts: base, post)")
    expect(await said(lookTool(deps, 'bracket', { scanColour: { scan: 'S1', part: 'base/F1' } }))).toBe('a scan is coloured by its distance to a whole part, and base/F1 is a face: give base')
    expect(await said(lookTool(deps, 'bracket', { scanColour: { part: 'base' } }))).toBe('name the scan: S1 (S1.glb), S2 (S2.glb)')
    expect(await said(lookTool(deps, 'bracket', { scanColour: { scan: 'S2', part: 'base' } }))).toBe('S2 is not aligned in layout assembly (it is aligned in: print), so nothing is checked against it there: the user aligns it in assembly with the Align tool (an alignment is of one layout), or ask in print')
    const HELP = 'scanColour is {"part": "tub"}, the part a scan is coloured by its distance to, with "scan": "S1" when there are several and "range" in mm, 0.1 to 1000 (default 20)'
    expect(await said(lookTool(deps, 'bracket', { scanColour: 'base' as never }))).toBe(HELP)
    expect(await said(lookTool(deps, 'bracket', { scanColour: { scan: 'S1', part: 'base', range: 0 } }))).toBe(HELP)
    expect(await said(lookTool(deps, 'bracket', { scanColour: { scan: 'S1' } as never }))).toBe(HELP)
    expect(deps.looks).toHaveLength(2)
  })

  it('show hands on the scans to leave on and how thin, and refuses a number that is none and an opacity no scan is drawn at', async () => {
    const deps = scanned()
    expect((await showTool(deps, 'bracket', { scans: ['S2'], scanOpacity: 0.4 })).isError).toBeUndefined()
    expect((await showTool(deps, 'bracket', { scans: [] })).isError).toBeUndefined()
    expect((await showTool(deps, 'bracket', { scanOpacity: 1 })).isError).toBeUndefined()
    expect(deps.w.shows).toEqual([{ objectId: 'bracket', scans: ['S2'], scanOpacity: 0.4 }, { objectId: 'bracket', scans: [] }, { objectId: 'bracket', scanOpacity: 1 }])
    const OPACITY = 'scanOpacity is a number from 0.05 to 1, how see-through the scans left on are drawn: {"scans": ["S1"], "scanOpacity": 0.5}'
    expect(await said(showTool(deps, 'bracket', { scans: ['S1'], scanOpacity: 0 }))).toBe(OPACITY)
    expect(await said(showTool(deps, 'bracket', { scanOpacity: 1.5 }))).toBe(OPACITY)
    expect(await said(showTool(deps, 'bracket', { scanOpacity: '0.5' as never }))).toBe(OPACITY)
    expect(await said(showTool(deps, 'bracket', { scans: ['S7'] }))).toBe('no scan S7; scans: S1, S2')
    expect(await said(showTool(deps, 'bracket', { scans: 'S1' as never }))).toBe('scans is a list of the numbers of the scans to leave switched on, [] to hide them all: {"scans": ["S1"]}')
    expect(await said(showTool(deps, 'bracket', {}))).toBe('nothing to show: give a view, a layout, parts, a section, an explode or scans')
    expect(deps.w.shows).toHaveLength(3)
  })
})

describe('explode', () => {
  const NOT_BOTH = 'a section is not drawn exploded: give explode or section, not both (explode: null draws the parts together, section: null draws them whole)'
  const exploded = (over: Partial<ViewState> = {}): Fake => fake({ view: () => ({ ...VIEW, ...over }) })

  it('asks for an exploded picture, refuses one with a section, and tells positions as before', async () => {
    const d = fake()
    await lookTool(d, 'bracket', { explode: 0.5 })
    expect(d.looks.at(-1)!.req).toMatchObject({ explode: { amount: 0.5, scale: 1, axis: 'centre' } })
    await lookTool(d, 'bracket', {})
    expect(d.looks.at(-1)!.req.explode).toBe('current')
    await lookTool(d, 'bracket', { explode: 0 })
    expect(d.looks.at(-1)!.req.explode).toBeNull()
    await lookTool(d, 'bracket', { explode: null })
    expect(d.looks.at(-1)!.req.explode).toBeNull()
    await lookTool(d, 'bracket', { explode: { amount: 1, axis: 'z', scale: 2 } })
    expect(d.looks.at(-1)!.req.explode).toEqual({ amount: 1, scale: 2, axis: 'z' })
    const asked = d.looks.length
    const both = await lookTool(d, 'bracket', { explode: 0.5, section: { axis: 'z', at: 3 } })
    expect(both.isError).toBe(true)
    expect(textOf(both)).toBe(NOT_BOTH)
    expect(textOf(await lookTool(d, 'bracket', { explode: 'half' as never }))).toContain('explode is a number from 0 to 1')
    expect(d.looks).toHaveLength(asked)
  })

  it('refuses an exploded picture while the user has a section, unless the picture is asked whole', async () => {
    const cut = exploded({ section: { origin: [0, 0, 3], normal: [0, 0, 1] } })
    expect(textOf(await lookTool(cut, 'bracket', { explode: 0.5 }))).toBe(NOT_BOTH)
    expect(textOf(await lookTool(cut, 'bracket', { explode: 0.5, section: 'current' }))).toBe(NOT_BOTH)
    expect(cut.looks).toEqual([])
    expect((await lookTool(cut, 'bracket', { explode: 0.5, section: null })).isError).toBeUndefined()
    // Drawn together, a section is drawn as ever.
    expect((await lookTool(cut, 'bracket', { explode: 0 })).isError).toBeUndefined()
    expect((await lookTool(cut, 'bracket', { explode: null, section: { axis: 'z', at: 3 } })).isError).toBeUndefined()
    expect(cut.looks).toHaveLength(3)
  })

  it('reports an exploded view in scene, with the note, and every part where it is built', () => {
    const explodedScene = JSON.parse(textOf(sceneTool(exploded({ explode: { amount: 0.4, scale: 1, axis: 'z' } }), 'bracket')))
    const assembled = JSON.parse(textOf(sceneTool(fake(), 'bracket')))
    expect(explodedScene.explode).toEqual({ amount: 0.4, scale: 1, axis: 'z' })
    expect(explodedScene.note).toBe("The user's view is exploded 40 % along z: the parts are drawn apart for display: every position, ref and number told is of the parts as assembled.")
    expect(explodedScene.parts).toEqual(assembled.parts)
    expect(explodedScene.camera).toEqual(assembled.camera)
    expect(assembled.explode).toBeNull()
    expect(assembled.note).toBeUndefined()
    // An explode of nothing is none.
    expect(JSON.parse(textOf(sceneTool(exploded({ explode: { amount: 0, scale: 2, axis: 'z' } }), 'bracket'))).explode).toBeNull()
  })

  it('show sets an explode for now, puts the parts together for null and 0, and refuses one with a section', async () => {
    const d = fake()
    expect((await showTool(d, 'bracket', { explode: 0.5 })).isError).toBeUndefined()
    expect((await showTool(d, 'bracket', { explode: { amount: 1, axis: 'x' } })).isError).toBeUndefined()
    expect((await showTool(d, 'bracket', { explode: null })).isError).toBeUndefined()
    expect((await showTool(d, 'bracket', { explode: 0 })).isError).toBeUndefined()
    expect((await showTool(d, 'bracket', { explode: 0.5, section: null })).isError).toBeUndefined()
    expect(d.w.shows).toEqual([
      { objectId: 'bracket', explode: { amount: 0.5, scale: 1, axis: 'centre' } },
      { objectId: 'bracket', explode: { amount: 1, scale: 1, axis: 'x' } },
      { objectId: 'bracket', explode: null },
      { objectId: 'bracket', explode: null },
      { objectId: 'bracket', section: null, explode: { amount: 0.5, scale: 1, axis: 'centre' } }
    ])
    expect(textOf(await showTool(d, 'bracket', { explode: 0.5, section: { axis: 'z', at: 3 } }))).toBe(NOT_BOTH)
    expect(textOf(await showTool(d, 'bracket', { explode: [1] as never }))).toContain('explode is a number from 0 to 1')
    expect(textOf(await showTool(d, 'bracket', {}))).toBe('nothing to show: give a view, a layout, parts, a section, an explode or scans')
    const cut = exploded({ section: { origin: [0, 0, 3], normal: [0, 0, 1] } })
    expect(textOf(await showTool(cut, 'bracket', { explode: 0.5 }))).toBe(NOT_BOTH)
    expect((await showTool(cut, 'bracket', { explode: 0.5, section: null })).isError).toBeUndefined()
    expect((await showTool(cut, 'bracket', { explode: 0 })).isError).toBeUndefined()
    expect(d.w.shows).toHaveLength(5)
  })

  it('refuses what is no explode with what one is, and never makes one of it in silence (I4)', async () => {
    const d = fake()
    for (const given of [50, -0.2, 1.01, Number.NaN, { amount: 0.5, axis: 'up' }, { amount: 0.5, scale: 100 }, { amount: 0.5, scale: 0.1 }, { amount: 7 }, { axis: 'z' }, { amount: '0.5' }, 'half', [0.5], true]) {
      for (const tool of [lookTool, showTool]) {
        const said = textOf(await tool(d, 'bracket', { explode: given as never }))
        expect(said, JSON.stringify(given)).toMatch(/^explode is a number from 0 to 1 \(how far apart the parts are drawn, away from the centre of the layout\), or \{"amount": 0.5, "axis": "z", "scale": 2\}/)
        expect(said).toContain('scale from 0.25 to 4')
      }
    }
    // A key it does not take is named, with the one that was meant.
    expect(textOf(await lookTool(d, 'bracket', { explode: { amount: 0.5, axix: 'z' } as never }))).toBe('explode takes no "axix": did you mean axis? An unknown key is not ignored: nothing was done. It takes: amount, scale, axis.')
    expect([d.looks, d.w.shows]).toEqual([[], []])
    // The ends of the ranges are in them.
    expect((await lookTool(d, 'bracket', { explode: { amount: 1, scale: 0.25, axis: 'centre' } })).isError).toBeUndefined()
    expect((await lookTool(d, 'bracket', { explode: { amount: 1, scale: 4 } })).isError).toBeUndefined()
    expect(explodeAsked(1)).toEqual({ amount: 1, scale: 1, axis: 'centre' })
    expect([explodeAsked(undefined), explodeAsked(null), explodeAsked(0), explodeAsked({ amount: 0, axis: 'z' })]).toEqual([undefined, null, null, null])
  })

  it('says that nothing can be drawn apart where a layout has one part, or parts that share the centre they would go from (M2)', async () => {
    const scene: Scene = {
      ...SCENE,
      layouts: ['assembly', 'solo', 'nested'],
      parts: [...SCENE.parts.filter((p) => p.layout === 'assembly'), part('solo', 'base', [0, 0, 0], [1, 1, 1]), part('nested', 'ring', [-20, -20, 0], [20, 20, 10]), part('nested', 'shaft', [-3, -3, -15], [3, 3, 25])]
    }
    const d = fake({ scene: () => ({ revision: 3, scene }) })
    const ONE = 'nothing can be drawn apart in layout solo: it has fewer than two parts (explode: null draws it as it is)'
    const SHARED = 'nothing is drawn apart from the centre in layout nested: its parts share a centre; give an axis, {"amount": 0.5, "axis": "z"}'
    expect(textOf(await lookTool(d, 'bracket', { explode: 0.5, layout: 'solo' }))).toBe(ONE)
    expect(textOf(await showTool(d, 'bracket', { explode: 0.5, layout: 'solo' }))).toBe(ONE)
    expect(textOf(await lookTool(d, 'bracket', { explode: 1, layout: 'nested' }))).toBe(SHARED)
    expect(textOf(await showTool(d, 'bracket', { explode: 1, layout: 'nested' }))).toBe(SHARED)
    expect([d.looks, d.w.shows]).toEqual([[], []])
    // Along an axis they part; and the layout on screen is the one meant when none is named.
    expect((await lookTool(d, 'bracket', { explode: { amount: 1, axis: 'z' }, layout: 'nested' })).isError).toBeUndefined()
    expect((await showTool(d, 'bracket', { explode: 0.5 })).isError).toBeUndefined()
    // Together is never refused, wherever.
    expect((await showTool(d, 'bracket', { explode: null, layout: 'solo' })).isError).toBeUndefined()
  })

  it('names explode in the schemas of look and show, so that the wrapper lets it through', () => {
    for (const tool of [TOOLS.look, TOOLS.show]) {
      expect(Object.keys(tool.inputSchema)).toContain('explode')
      expect(tool.inputSchema.explode.description).toContain('For display only: positions, refs and measurements are always of the parts as assembled.')
    }
  })
})

describe('saved views', () => {
  const HINGE = { name: 'Hinge side', author: 'user', layout: 'assembly', camera: CAMERA, hidden: ['post'], explode: { amount: 0.4, scale: 1, axis: 'z' }, at: '' } as SavedView
  const CUT = { name: 'Wall', author: 'agent', proposed: true, note: 'thin', layout: 'print', camera: CAMERA, hidden: [], section: { origin: [0, 0, 3], normal: [0, 0, 1] }, at: '' } as SavedView
  const withViews = (views: SavedView[], over: Parameters<typeof fake>[0] = {}): Fake => fake({ views: async () => views, ...over })
  const scan = (id: string): ScanInfo => ({ id, name: id, meshState: 'ok', alignments: {}, imported: { triangles: 12 } }) as unknown as ScanInfo

  it('draws and shows a saved view by its name, and lets what is given beside it win', async () => {
    const d = withViews([HINGE])
    const drawn = await lookTool(d, 'bracket', { view: 'hinge side' })
    expect(drawn.isError).toBeUndefined()
    // All of it is the view's: nothing is left to be as on screen.
    expect(d.looks.at(-1)!.req).toEqual({ view: CAMERA, viewName: 'Hinge side', layout: 'assembly', parts: ['base'], section: null, explode: HINGE.explode, size: 1280 })
    await lookTool(d, 'bracket', { view: 'Hinge side', parts: ['base', 'post'], explode: null })
    expect(d.looks.at(-1)!.req).toMatchObject({ parts: ['base', 'post'], explode: null })
    await showTool(d, 'bracket', { view: 'Hinge side' })
    expect(d.w.shows.at(-1)).toEqual({ objectId: 'bracket', view: CAMERA, viewName: 'Hinge side', layout: 'assembly', parts: ['base'], section: null, explode: HINGE.explode })
    // The standard views and the user's own camera are what they were.
    await lookTool(d, 'bracket', { view: 'top' })
    await lookTool(d, 'bracket', { view: 'current' })
    expect(d.looks.slice(-2).map((look) => look.req)).toEqual([{ view: 'top', size: 1280, explode: 'current' }, { view: 'current', size: 1280, explode: 'current' }])
  })

  it('refuses a name that is no view with the names there are, and a view whose layout is gone', async () => {
    const d = withViews([HINGE, CUT])
    expect(textOf(await lookTool(d, 'bracket', { view: 'hinge' }))).toBe('no view "hinge": the saved views are "Hinge side", "Wall"; or current, iso, front, back, left, right, top, bottom, or a camera')
    expect(textOf(await showTool(d, 'bracket', { view: 'hinge' }))).toBe('no view "hinge": the saved views are "Hinge side", "Wall"; or iso, front, back, left, right, top, bottom, or a camera')
    expect(textOf(await lookTool(fake(), 'bracket', { view: 'hinge' }))).toBe('no view "hinge": there are no saved views; give current, iso, front, back, left, right, top, bottom, or a camera')
    const gone = withViews([{ ...HINGE, layout: 'bed' }])
    expect(textOf(await lookTool(gone, 'bracket', { view: 'Hinge side' }))).toBe('the view "Hinge side" is of layout bed, which the model no longer has (layouts: assembly, print)')
    expect(textOf(await showTool(gone, 'bracket', { view: 'Hinge side' }))).toBe('the view "Hinge side" is of layout bed, which the model no longer has (layouts: assembly, print)')
    // Asked in a layout the model has, it is drawn there.
    expect((await lookTool(gone, 'bracket', { view: 'Hinge side', layout: 'print' })).isError).toBeUndefined()
    expect(gone.looks.at(-1)!.req).toMatchObject({ layout: 'print', parts: ['base'] })
    expect([d.looks, d.w.shows]).toEqual([[], []])
    // A scene file that cannot be read has no views.
    expect(textOf(await lookTool(fake({ views: () => Promise.reject(new Error('EACCES')) }), 'bracket', { view: 'hinge' }))).toContain('there are no saved views')
  })

  it('passes over what a view names that is gone, and says which', async () => {
    const view = { ...HINGE, hidden: ['post', 'clip'], scans: { S1: { visible: true, opacity: 0.5 }, S2: { visible: false }, S9: { visible: true } } } as SavedView
    const d = withViews([view], { scans: async () => [scan('S1'), scan('S2'), scan('S3')], view: () => ({ ...VIEW, scans: [{ id: 'S1', visible: false, opacity: 1, loaded: true }, { id: 'S2', visible: true, opacity: 1, loaded: true }, { id: 'S3', visible: true, opacity: 1, loaded: true }] }) })
    const SAID = ' · passed over, of the view "Hinge side": the part clip, which layout assembly no longer has; the scan S9, which is gone'
    const drawn = await lookTool(d, 'bracket', { view: 'Hinge side' })
    // The scans the view switches on, and those it says nothing of as they are on screen.
    expect(d.looks.at(-1)!.req).toMatchObject({ parts: ['base'], scans: ['S1', 'S3'] })
    expect(textOf(drawn).split('\n')[0]).toBe(`${PICTURE.caption}${SAID}; how thin it has S1 (50 %), which is drawn as thin as the user's screen has it`)
    const shown = await showTool(d, 'bracket', { view: 'Hinge side' })
    expect(d.w.shows.at(-1)).toMatchObject({ parts: ['base'], scanViews: { S1: { visible: true, opacity: 0.5 }, S2: { visible: false } } })
    expect(d.w.shows.at(-1)!.scans).toBeUndefined()
    expect(textOf(shown).split('\n')[0]).toBe(`view top · layout assembly · parts base, post · orthographic${SAID}`)
    // Scans named beside the view win, and nothing is then said of the view's.
    await lookTool(d, 'bracket', { view: 'Hinge side', scans: false })
    expect(d.looks.at(-1)!.req.scans).toBe(false)
    // The layout has lost all but one part since: nothing can be drawn apart, which is said, not refused.
    const scene: Scene = { ...SCENE, parts: SCENE.parts.filter((p) => p.name === 'base') }
    const alone = withViews([{ ...HINGE, hidden: [] }], { scene: () => ({ revision: 3, scene }) })
    expect(textOf(await lookTool(alone, 'bracket', { view: 'Hinge side' })).split('\n')[0]).toBe(`${PICTURE.caption} · passed over, of the view "Hinge side": its explode, as layout assembly has fewer than two parts now`)
    expect(alone.looks.at(-1)!.req.explode).toBeNull()
  })

  it('holds a section or an explode: whichever is given beside a view takes the place of the other', async () => {
    const d = withViews([HINGE, CUT])
    await lookTool(d, 'bracket', { view: 'Hinge side', section: { axis: 'z', at: 3 } })
    expect(d.looks.at(-1)!.req).toMatchObject({ section: { origin: [0, 0, 3], normal: [0, 0, 1] }, explode: null })
    await lookTool(d, 'bracket', { view: 'Wall', explode: 0.5 })
    expect(d.looks.at(-1)!.req).toMatchObject({ layout: 'print', section: null, explode: { amount: 0.5, scale: 1, axis: 'centre' } })
    await showTool(d, 'bracket', { view: 'Wall', explode: 0.5 })
    expect(d.w.shows.at(-1)).toMatchObject({ section: null, explode: { amount: 0.5, scale: 1, axis: 'centre' } })
    // Together is no explode: the view's cut stays.
    await lookTool(d, 'bracket', { view: 'Wall', explode: null })
    expect(d.looks.at(-1)!.req).toMatchObject({ section: CUT.section, explode: null })
    // Both given: refused, as without a view.
    expect(textOf(await lookTool(d, 'bracket', { view: 'Wall', explode: 0.5, section: { axis: 'z', at: 3 } }))).toContain('a section is not drawn exploded')
  })

  it('lists the views in scene, each with whose it is and what it holds', () => {
    const d = fake()
    expect(JSON.parse(textOf(sceneTool(d, 'bracket', undefined, undefined, [HINGE, CUT]))).views).toEqual([
      { name: 'Hinge side', by: 'user', layout: 'assembly', exploded: true, hidden: 1 },
      { name: 'Wall', by: 'agent', proposed: true, layout: 'print', section: true, note: 'thin' }
    ])
    expect('views' in JSON.parse(textOf(sceneTool(d, 'bracket', undefined, undefined, [])))).toBe(false)
    expect('views' in JSON.parse(textOf(sceneTool(d, 'bracket')))).toBe(false)
  })

  it('proposes a view only under a name that is free, and of what the model has', async () => {
    const d = withViews([HINGE, { ...CUT, proposed: undefined } as SavedView])
    const taken = await saveViewTool(d, 'bracket', { name: 'hinge side' })
    expect(taken.isError).toBe(true)
    expect(textOf(taken)).toBe('the user has a view named "Hinge side": choose another name (their views: "Hinge side", "Wall")')
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'WALL' }))).toBe('the user kept the view "Wall": choose another name (their views: "Hinge side", "Wall")')
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'top' }))).toBe('"top" is a standard view: choose another name')
    expect(textOf(await saveViewTool(d, 'bracket', { name: 7 as never }))).toBe('name is what the view is called, 1 to 40 characters: {"name": "Wall at the latch"}')
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'Both', section: { axis: 'z', at: 3 }, explode: 0.5 }))).toBe('a view holds a section or an explode, not both: a section is not drawn exploded. Leave out explode to keep the cut, or section to keep the parts apart')
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'x', parts: ['nope'] }))).toBe("unknown part 'nope'; parts in layout assembly: base, post")
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'x', layout: 'bed' }))).toBe("no layout 'bed'; layouts: assembly, print")
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'x', section: { z: 3 } as never }))).toContain('that is not a plane')
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'x', explode: 50 }))).toContain('explode is a number from 0 to 1')
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'x', view: { position: [0, 0, 0], target: [0, 0, 0] } }))).toBe('position and target are the same')
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'x', view: 'hinge side' as never }))).toBe('view is iso, front, back, left, right, top or bottom, or a camera as scene gives one; left out, it is the camera on the user\'s screen')
    expect(d.savedViews).toHaveLength(0)

    const kept = await saveViewTool(d, 'bracket', { name: ' Wall at the latch ', view: 'front', parts: ['base'], note: 'the 1.2 mm wall M7 is about' })
    expect(d.savedViews[0]).toEqual({ objectId: 'bracket', name: 'Wall at the latch', view: 'front', parts: ['base'], note: 'the 1.2 mm wall M7 is about' })
    expect(textOf(kept)).toBe('saved "Wall at the latch" as a view you propose: layout assembly, parts base, orthographic. The user sees it in their views, marked proposed, until they keep or discard it.\nrevision r3')
    // A cut, or the parts apart, is said with it; and what it took the place of, and what it pushed out.
    const cut = await saveViewTool(d, 'bracket', { name: 'Cut', section: { axis: 'z', at: 3 } })
    expect(d.savedViews[1]).toEqual({ objectId: 'bracket', name: 'Cut', section: { origin: [0, 0, 3], normal: [0, 0, 1] } })
    expect(textOf(cut)).toContain('layout assembly, parts base, post, section plane normal +Z at z = 3, perspective.')
    const full = fake({ saveView: async (objectId, req) => ({ objectId, revision: 3, replaced: true, dropped: 'Oldest', view: { name: req.name, author: 'agent', proposed: true, layout: 'assembly', camera: CAMERA, hidden: [], explode: { amount: 0.5, scale: 1, axis: 'centre' }, at: '' } }) })
    expect(textOf(await saveViewTool(full, 'bracket', { name: 'Apart', explode: 0.5 }))).toBe('saved "Apart" as a view you propose, in place of your earlier proposal of that name: layout assembly, parts base, post, exploded 50 % from the centre, perspective. The user sees it in their views, marked proposed, until they keep or discard it. Your oldest proposal, "Oldest", was dropped to make room: an object holds 12 proposals at most.\nrevision r3')
    // The window may refuse what main let through: its words are the answer.
    const refusing = fake({ saveView: () => Promise.reject(new Error('the user has a view named "X": choose another name')) })
    expect(textOf(await saveViewTool(refusing, 'bracket', { name: 'X' }))).toBe('the user has a view named "X": choose another name')
    // Not for an object the window does not show.
    expect(textOf(await saveViewTool(fake({ openObjectId: () => 'helmet-stand' }), 'bracket', { name: 'X' }))).toBe('bracket is not the object open in the torno window (open: helmet-stand). Ask the user to open it.')
  })

  it('refuses a key save_view does not take, and takes those it names', () => {
    expect(textOf(refusedKeys('save_view', { name: 'a', camera: {} })!)).toContain('save_view takes no "camera"')
    expect(textOf(refusedKeys('save_view', { name: 'a', author: 'user' })!)).toContain('save_view takes no "author"')
    expect(textOf(refusedKeys('save_view', { name: 'a', proposed: false })!)).toContain('save_view takes no "proposed"')
    expect(refusedKeys('save_view', { name: 'a', note: 'b', view: 'iso', layout: 'print', parts: [], section: null, explode: 0 })).toBeNull()
    expect(TOOLS.look.inputSchema.view.description).toContain('the name of a saved view')
    expect(TOOLS.show.inputSchema.view.description).toContain('the name of a saved view')
  })

  it('says of a scan it draws as thin as the screen has it that the view has it otherwise (review I3)', async () => {
    const view = { ...HINGE, hidden: [], explode: undefined, scans: { S1: { visible: true, opacity: 0.5 }, S2: { visible: true }, S3: { visible: true, opacity: 0.25 } } } as SavedView
    const d = withViews([view], { scans: async () => [scan('S1'), scan('S2'), scan('S3')], view: () => ({ ...VIEW, scans: [{ id: 'S1', visible: true, opacity: 1, loaded: true }, { id: 'S2', visible: true, opacity: 0.3, loaded: true }, { id: 'S3', visible: false, opacity: 0.25, loaded: true }] }) })
    const drawn = await lookTool(d, 'bracket', { view: 'Hinge side' })
    expect(textOf(drawn).split('\n')[0]).toBe(`${PICTURE.caption} · passed over, of the view "Hinge side": how thin it has S1 (50 %) and S2 (solid), which are drawn as thin as the user's screen has them`)
    // show puts each scan on screen as the view has it: nothing is passed over.
    expect(textOf(await showTool(d, 'bracket', { view: 'Hinge side' })).split('\n')[0]).not.toContain('passed over')
    // Scans named beside the view are the call's own.
    expect(textOf(await lookTool(d, 'bracket', { view: 'Hinge side', scans: ['S1'] })).split('\n')[0]).toBe(PICTURE.caption)
  })

  it('draws an exploded view apart when asked with the user\'s section and they have none, and says so when they have one (review M7)', async () => {
    const d = withViews([HINGE])
    await lookTool(d, 'bracket', { view: 'Hinge side', section: 'current' })
    expect(d.looks.at(-1)!.req).toMatchObject({ section: 'current', explode: HINGE.explode })
    const cut = withViews([HINGE], { view: () => ({ ...VIEW, section: { origin: [0, 0, 3], normal: [0, 0, 1] } }) })
    const drawn = await lookTool(cut, 'bracket', { view: 'Hinge side', section: 'current' })
    expect(cut.looks.at(-1)!.req).toMatchObject({ section: 'current', explode: null })
    expect(textOf(drawn).split('\n')[0]).toBe(`${PICTURE.caption} · passed over, of the view "Hinge side": its explode, as the picture is cut by the user's section`)
  })

  it('takes a name without what does not show in it, and none of nothing that shows (review M4)', async () => {
    const d = withViews([HINGE])
    expect(textOf(await saveViewTool(d, 'bracket', { name: '\u200b' }))).toBe('A view needs a name')
    await saveViewTool(d, 'bracket', { name: ' Wall\u202e at the latch ' })
    expect(d.savedViews[0].name).toBe('Wall at the latch')
    expect(textOf(await saveViewTool(d, 'bracket', { name: 'Hinge\u200b side' }))).toContain('the user has a view named "Hinge side"')
  })

  it('never tells the agent to remove a view (review M3)', async () => {
    const full = withViews(Array.from({ length: 24 }, (_, n) => ({ ...HINGE, name: `v${n}` })))
    expect((await saveViewTool(full, 'bracket', { name: 'one more' })).isError).toBeUndefined()
  })
})

describe('groups of parts', () => {
  // The fixture `grouped`: two groups and a part in none.
  const GROUPED: Scene = {
    model: 'grouped.py',
    layouts: ['assembly', 'print'],
    parts: [
      part('assembly', 'flat-a', [-5, -5, -1], [5, 5, 1]),
      part('assembly', 'flat-b', [15, -5, -1], [25, 5, 1]),
      part('assembly', 'tall-a', [-5, -25, -4], [5, -15, 4]),
      part('assembly', 'key', [-2, 28, -2], [2, 32, 2]),
      part('print', 'flat-a', [-5, -5, -1], [5, 5, 1]),
      part('print', 'key', [38, -2, -2], [42, 2, 2])
    ],
    seconds: 0.5,
    output: '',
    groups: [{ name: 'flat', parts: ['flat-a', 'flat-b'] }, { name: 'tall', parts: ['tall-a'] }]
  }
  const grouped = (over: Partial<ToolDeps> = {}) => fake({ scene: (id) => (id === 'bracket' ? { revision: 3, scene: GROUPED } : undefined), ...over })

  it('show takes a group for its parts in the layout', async () => {
    const deps = grouped()
    expect((await showTool(deps, 'bracket', { parts: ['flat'] })).isError).toBeUndefined()
    await showTool(deps, 'bracket', { layout: 'print', parts: ['flat', 'key'] })
    expect(deps.w.shows.map((req) => req.parts)).toEqual([['flat-a', 'flat-b'], ['flat-a', 'key']])
  })

  it('look takes a group for its parts', async () => {
    const deps = grouped()
    await lookTool(deps, 'bracket', { parts: ['tall'] })
    expect(deps.looks.map((l) => l.req.parts)).toEqual([['tall-a']])
  })

  it('save_view keeps the part names a group stands for', async () => {
    const deps = grouped()
    expect((await saveViewTool(deps, 'bracket', { name: 'Flat', parts: ['flat', 'key'] })).isError).toBeUndefined()
    expect(deps.savedViews.map((req) => req.parts)).toEqual([['flat-a', 'flat-b', 'key']])
  })

  it('names the groups beside the parts when a name is neither', async () => {
    const deps = grouped()
    const text = "unknown part 'nope'; parts in layout assembly: flat-a, flat-b, tall-a, key; groups: flat, tall"
    expect(textOf(await showTool(deps, 'bracket', { parts: ['nope'] }))).toBe(text)
    expect(textOf(await lookTool(deps, 'bracket', { parts: ['nope'] }))).toBe(text)
    expect(textOf(await saveViewTool(deps, 'bracket', { name: 'No', parts: ['nope'] }))).toBe(text)
    // A group none of whose parts the layout has is no name there.
    expect(textOf(await showTool(deps, 'bracket', { layout: 'print', parts: ['tall'] }))).toBe("unknown part 'tall'; parts in layout print: flat-a, key; groups: flat")
    expect(deps.w.shows).toEqual([])
    expect(deps.looks).toEqual([])
    expect(deps.savedViews).toEqual([])
  })

  it('highlight takes a bare group name for all of its parts', async () => {
    const both = grouped()
    const result = await highlightTool(both, 'bracket', { refs: ['flat', 'key', 'flat-a'] })
    expect(result.isError).toBeUndefined()
    expect(both.w.highlights).toEqual([{ layout: 'assembly', refs: ['flat-a', 'flat-b', 'key'] }])
    expect(textOf(result)).toBe('highlighted flat-a, flat-b, key in layout assembly for the user, until they click in the viewport or 60 s pass.')
  })

  it('highlight says a group has no faces of its own', async () => {
    const deps = grouped()
    const result = await highlightTool(deps, 'bracket', { refs: ['flat/F1'] })
    expect(textOf(result)).toBe("nothing was highlighted: no part 'flat' in layout assembly (parts: flat-a, flat-b, tall-a, key); flat is a group: its parts are flat-a, flat-b")
    expect(deps.w.highlights).toEqual([])
  })
})
