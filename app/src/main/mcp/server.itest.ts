import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AskAnswer, AskEnd, AskRequest } from '../../shared/ask'
import type { Mark, NewMark } from '../../shared/marks'
import type { Part } from '../../shared/scene'
import type { LookRequest, SaveViewRequest, ShowRequest, ViewState } from '../../shared/view'
import type { SavedView } from '../../shared/views'
import { type HttpRouter, SESSION_HEADER, startHttp } from '../http'
import { INSTRUCTIONS_LIMIT, SERVER_INSTRUCTIONS } from './schemas'
import { mountMcp } from './server'
import type { ToolDeps } from './tools'

// The MCP server as an agent's CLI meets it: the SDK's client over HTTP, a real
// HttpRouter, and stand-ins for what torno knows.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7])
const BASE = { key: 'main:base', name: 'base', layout: 'main', bbox: { min: [0, 0, 0], max: [40, 30, 5] }, volume: 6000, faceCount: 6, edgeCount: 12, valid: true } as Part

const PIN: Mark = {
  id: 'M1',
  kind: 'pin',
  author: 'user',
  note: 'here',
  status: 'draft',
  anchorState: 'ok',
  layout: 'main',
  revision: 2,
  camera: { position: [100, -100, 80], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
  createdAt: '2026-10-09T12:00:00.000Z',
  anchor: { point: [1, 2, 5], part: 'base', ref: 'base/F5' }
}
let added: NewMark[] = []

/** What the kernel says of the plate, to each of the queries the read tools make. */
const KERNEL: Record<string, object> = {
  measure: { kind: 'distance', value: 5, unit: 'mm', how: 'between planes', points: [[0, 0, 0], [0, 0, 5]], exact: true },
  section: {
    plane: { origin: [0, 0, 2], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
    parts: [{ part: 'base', loops: [{ points: [[0, 0], [40, 0], [40, 30], [0, 30]], closed: true, area: 1200, areaExact: true, deflection: 0.05 }], area: 1200, areaExact: true, open: 0, how: 'cross-section of the solid' }],
    bounds: { min: [0, 0], max: [40, 30] }
  },
  check: { watertight: true, openEdges: 0, where: [], triangles: 12 }
}

let http: HttpRouter
let looks: Array<{ objectId: string; req: LookRequest }> = []
let shows: ShowRequest[] = []
let savedViews: SaveViewRequest[] = []
/** A view the person saved of the object. */
const SIDE: SavedView = { name: 'Hinge side', author: 'user', layout: 'main', camera: { position: [0, -80, 6], target: [0, 0, 6], up: [0, 0, 1], ortho: true, fov: 35, zoom: 2 }, hidden: [], at: '2026-10-09T21:14:03.000Z' }
/** What the window last reported of the object, when a test has it report something. */
let view: ViewState | undefined
let release: (() => void) | null = null
/** What answers a question of the agent's, when a test puts one. */
let answering: ((req: AskRequest, signal: AbortSignal) => Promise<AskAnswer | AskEnd>) | null = null
const clients: Client[] = []

const deps: ToolDeps = {
  object: (id) => (id === 'bracket' ? { id, name: id, dir: '/ws/bracket', model: 'bracket.py' } : undefined),
  build: (id) => (id === 'bracket' ? { objectId: id, status: 'ok', revision: 2, seconds: 0.5, stale: false } : undefined),
  scene: (id) => (id === 'bracket' ? { revision: 2, scene: { model: 'bracket.py', layouts: ['main'], parts: [BASE], seconds: 0.5, output: '' } } : undefined),
  view: () => view,
  openObjectId: () => 'bracket',
  look: async (objectId, req) => {
    looks.push({ objectId, req })
    // Held back when a test wants two requests under way at once.
    if (req.view === 'top') await new Promise<void>((resolve) => (release = resolve))
    return { png: PNG, width: 4, height: 3, caption: `view ${String(req.view)}`, objectId, revision: 2, stale: false }
  },
  saveImage: async () => '/ws/bracket/.torno/views/1.png',
  marks: async () => [PIN],
  addMark: async (_objectId, mark) => {
    added.push(mark)
    return { ...mark, id: 'M2', status: 'sent', anchorState: 'ok', createdAt: PIN.createdAt } as Mark
  },
  updateMark: async (_objectId, id, patch) => {
    if (id !== 'M1') throw new Error(`no mark ${id}; marks: M1`)
    return { ...PIN, ...patch } as Mark
  },
  describe: async (_objectId, layout, ref) => ({ kind: 'face', ref: `${layout}:${ref}`, type: 'plane', area: 1200, center: [20, 15, 5], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 5, 1200 mm²' }),
  nearest: async (_objectId, _layout, anchors) => anchors.map(({ part, point }) => ({ part, found: true, point, normal: [0, 0, 1], ref: `${part}/F5`, distance: 0, descriptor: null })),
  show: async (objectId, req) => (shows.push(req), { caption: `view ${String(req.view)} · layout main`, objectId, revision: 2, stale: false }),
  highlight: async (objectId, layout, refs) => ({ objectId, layout, refs, revision: 2 }),
  ask: (_objectId, req, signal) => (answering ? answering(req, signal) : Promise.reject(new Error('no question was expected'))),
  askLimits: { limitMs: 5000, progressMs: 30 },
  query: async <T,>(_objectId: string, name: string): Promise<T> => KERNEL[name] as T,
  sectionDrawing: async () => ({ png: PNG, width: 4, height: 3, colours: 'window', vDown: false }),
  scans: async () => [],
  scansBusy: () => [],
  scanPaths: () => undefined,
  addDimension: async (_objectId, mark) => ({ mark: { ...mark, id: 'M3', status: 'sent', anchorState: 'ok', createdAt: PIN.createdAt } as Mark }),
  views: async () => [SIDE],
  saveView: async (objectId, req) => (savedViews.push(req), { objectId, revision: 2, replaced: false, view: { ...SIDE, name: req.name, author: 'agent', proposed: true } })
}

/** The header of a request for an object's tools: a token for that object, as the session of an agent working on it has. */
const tokenFor = (objectId: string): Record<string, string> => ({ [SESSION_HEADER]: http.grant([`/mcp/${encodeURIComponent(objectId)}`]) })

async function connect(objectId: string): Promise<Client> {
  const client = new Client({ name: 'torno-test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(http.url(`/mcp/${encodeURIComponent(objectId)}`)), { requestInit: { headers: tokenFor(objectId) } }))
  clients.push(client)
  return client
}

type Content = Array<{ type: string; text?: string; data?: string; mimeType?: string }>

beforeAll(async () => {
  http = await startHttp()
  mountMcp(http, deps)
})

afterEach(async () => {
  looks = []
  shows = []
  savedViews = []
  view = undefined
  added = []
  release = null
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

afterAll(() => http.close())

const ALL = ['add_card', 'add_layer', 'add_mark', 'add_set', 'add_sketch', 'add_tracing', 'ask', 'board', 'check', 'describe', 'diff', 'expect', 'features', 'highlight', 'history', 'look', 'marks', 'measure', 'resolve_mark', 'save_view', 'scan_clash', 'scan_deviation', 'scans', 'scene', 'section', 'show', 'tracings', 'try_fillet', 'try_params', 'wait_build']
/** The least each tool can be called with. */
const MINIMAL: Record<string, Record<string, unknown>> = {
  scene: {},
  look: {},
  marks: {},
  describe: { ref: 'base' },
  highlight: { refs: ['base'] },
  ask: { question: 'Which?', options: [{ label: 'This one', refs: ['base'] }] },
  show: { view: 'top' },
  save_view: { name: 'Wall at the latch' },
  add_mark: { kind: 'pin', note: '', ref: 'base' },
  resolve_mark: { id: 'M1' },
  measure: { kind: 'distance', a: 'base/F5', b: 'base/F0' },
  section: { plane: { axis: 'z', at: 2 } },
  check: { kind: 'mesh', a: 'base' },
  scans: {},
  scan_clash: { part: 'base' },
  scan_deviation: { part: 'base' },
  features: { part: 'base' },
  history: {},
  board: {},
  add_card: { text: 'A plan' },
  tracings: {},
  add_tracing: { on: { main: 'XY' } }
}

describe('the MCP server', () => {
  it('lists the prompts it offers as commands, each with a description', async () => {
    const client = await connect('bracket')
    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name).sort()).toEqual(['explain', 'printable', 'review'])
    for (const p of prompts) expect(p.description?.length ?? 0).toBeGreaterThan(20)
    expect(prompts.find((p) => p.name === 'printable')?.arguments).toEqual([expect.objectContaining({ name: 'bed', required: false })])
  })

  it('gives each prompt as a message from the user naming the tools as the agent knows them', async () => {
    const client = await connect('bracket')
    const text = async (name: string, args?: Record<string, string>): Promise<string> => {
      const { messages } = await client.getPrompt({ name, arguments: args })
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('user')
      return (messages[0].content as { type: string; text: string }).text
    }
    const review = await text('review')
    for (const tool of ['marks', 'measure', 'look', 'resolve_mark']) expect(review).toContain(`mcp__torno__${tool}`)
    const printable = await text('printable', { bed: '256x256x256' })
    expect(printable).toContain('print')
    expect(printable).toContain('"kind": "bed"')
    expect(printable).toContain('[256, 256, 256]')
    for (const kind of ['thin', 'overhang', 'mesh']) expect(printable).toContain(`{"kind": "${kind}", "a": <part>`)
    expect(printable).not.toContain('"part"')
    expect(await text('printable')).not.toContain('"kind": "bed"')
    const explain = await text('explain')
    expect(explain).toContain('mcp__torno__scene')
    expect(explain).toContain('params')
  })

  it('lists the tools, each with a description', async () => {
    const client = await connect('bracket')
    expect(client.getServerVersion()?.name).toBe('torno')
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(ALL)
    const inputs = (name: string) => tools.find((t) => t.name === name)!.inputSchema
    expect(Object.keys(inputs('add_mark').properties ?? {}).sort()).toEqual(['a', 'b', 'by', 'expected', 'intent', 'kind', 'layout', 'measure', 'note', 'point', 'position', 'ref', 'rotation', 'shape', 'size', 'to', 'tolerance'])
    expect(inputs('add_mark').required).toEqual(['kind', 'note'])
    expect(inputs('resolve_mark').required).toEqual(['id'])
    expect(inputs('highlight').required).toEqual(['refs'])
    expect(inputs('describe').required).toEqual(['ref'])
    expect(inputs('show').required ?? []).toEqual([])
    expect(inputs('marks').required ?? []).toEqual([])
    for (const tool of tools) expect(tool.description).toMatch(/^Returns /)
    const look = tools.find((t) => t.name === 'look')!
    expect(Object.keys(look.inputSchema.properties ?? {}).sort()).toEqual(['explode', 'focus', 'frame', 'layout', 'margin', 'marks', 'parts', 'scanColour', 'scans', 'section', 'size', 'view', 'views'])
    expect(look.inputSchema.required ?? []).toEqual([])
  })

  it('tells a client at initialize what the server is for, with a line for every tool', async () => {
    const client = await connect('bracket')
    const instructions = client.getInstructions()
    expect(instructions).toBe(SERVER_INSTRUCTIONS)
    expect(instructions!.length).toBeLessThan(INSTRUCTIONS_LIMIT)
    for (const name of ALL) expect(instructions, name).toMatch(new RegExp(`^- (?:[a-z_]+, )*${name}(?:, [a-z_]+)*: `, 'm'))
  })

  it('lists each tool with a title, annotations that say what only reads, and the eight that load upfront', async () => {
    const client = await connect('bracket')
    const { tools } = await client.listTools()
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name).sort()
    expect(readOnly).toEqual(['board', 'check', 'describe', 'diff', 'features', 'history', 'look', 'marks', 'measure', 'scan_clash', 'scan_deviation', 'scans', 'scene', 'section', 'tracings', 'try_fillet', 'try_params', 'wait_build'])
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy()
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false)
      if (!readOnly.includes(tool.name)) expect(tool.annotations, tool.name).toEqual(expect.objectContaining({ readOnlyHint: false, destructiveHint: false }))
    }
    expect(tools.filter((t) => t._meta?.['anthropic/alwaysLoad'] === true).map((t) => t.name).sort()).toEqual(['check', 'describe', 'features', 'look', 'marks', 'measure', 'resolve_mark', 'scene', 'show'])
  })

  it('lists the tools that ask about a scan, each with a description and a schema that requires nothing and names every argument', async () => {
    const client = await connect('bracket')
    const { tools } = await client.listTools()
    const of = (name: string) => tools.find((t) => t.name === name)!
    expect(Object.keys(of('scans').inputSchema.properties ?? {})).toEqual(['layout'])
    expect(Object.keys(of('scan_clash').inputSchema.properties ?? {}).sort()).toEqual(['ignore', 'layout', 'margin', 'part', 'scan'])
    expect(Object.keys(of('scan_deviation').inputSchema.properties ?? {}).sort()).toEqual(['faces', 'from', 'layout', 'part', 'region', 'samples', 'scan', 'within'])
    for (const name of ['scans', 'scan_clash', 'scan_deviation']) {
      expect(of(name).inputSchema.required ?? [], name).toEqual([])
      expect(of(name).description, name).toMatch(/^Returns JSON and a reading /)
      for (const [arg, schema] of Object.entries(of(name).inputSchema.properties ?? {})) expect((schema as { description?: string }).description, `${name}.${arg}`).toBeTruthy()
    }
    expect(Object.keys(of('show').inputSchema.properties ?? {}).sort()).toEqual(['explode', 'focus', 'layout', 'margin', 'parts', 'scanOpacity', 'scans', 'section', 'view'])
    expect(Object.keys(of('save_view').inputSchema.properties ?? {}).sort()).toEqual(['explode', 'layout', 'name', 'note', 'parts', 'section', 'view'])
    expect(of('save_view').inputSchema.required ?? []).toEqual([])
    for (const [arg, schema] of Object.entries(of('save_view').inputSchema.properties ?? {})) expect((schema as { description?: string }).description, `save_view.${arg}`).toBeTruthy()
    // Explode is told as what it is, in both: for display only.
    for (const name of ['look', 'show']) expect((of(name).inputSchema.properties!.explode as { description: string }).description, name).toContain('For display only: positions, refs and measurements are always of the parts as assembled.')
    expect(Object.keys(of('section').inputSchema.properties ?? {}).sort()).toEqual(['deflection', 'layout', 'parts', 'plane', 'scan', 'size'])
  })

  it('answers what is no argument of a scan tool with what one looks like, not with the schema\u2019s "Invalid input"', async () => {
    const client = await connect('bracket')
    const said = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const result = await client.callTool({ name, arguments: args }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }))
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
      return (result.content as Content)[0].text!
    }
    expect(await said('scan_clash', {})).toBe('part is the name of a part, as listed by scene: {"part": "tub"}')
    expect(await said('scan_clash', { part: 'base', margin: 'wide' })).toBe('margin is a number of mm from 0 to 50 (default 5), how far round the part scan points are looked at: {"part": "tub", "margin": 5}')
    expect(await said('scan_clash', { part: 'base', ignore: 'M7' })).toBe('ignore is a list of the numbers of region marks to leave out: {"part": "tub", "ignore": ["M7"]}')
    expect(await said('scan_deviation', { part: 'base', samples: 1e6 })).toBe('samples is a whole number from 100 to 20,000 (default 10,000), how many points are measured: {"part": "tub", "samples": 10000}')
    expect(await said('scan_deviation', { part: 'base', within: '50' })).toBe('within is a number of mm from 0.1 to 200 (default 50), how far from each point the other is looked for: {"part": "tub", "within": 50}')
    expect(await said('scan_deviation', { part: 'base', from: 'both' })).toBe('from is "part" (points of the part, each to the scan; the default) or "scan" (points of the scan, each to the part): {"part": "tub", "from": "scan"}')
    expect(await said('scan_deviation', { part: 'base', faces: 'base/F5' })).toBe('faces is a list of refs of faces of the part: {"part": "tub", "faces": ["tub/F5"]}')
    expect(await said('measure', { kind: 'distance', a: { scan: 'S1' }, b: 'base/F5' })).toBe('a names nothing: a point of a scan is {"scan": "S1", "point": [x, y, z]}, in mm in the frame of the layout')
    // A point of a scan reaches the tool as one: it is not taken for a bare point of the layout, which would be measured as exact.
    expect(await said('measure', { kind: 'distance', a: { scan: 'S1', point: [1, 2, 3] }, b: 'base/F5' })).toBe('this project has no scans: the user imports one in the Scans section of the torno window')
    expect(await said('look', { scans: 'S1' })).toBe('scans is true for the scans on the user\'s screen, false for none, or a list of their numbers: {"scans": ["S1"]}')
    expect(await said('look', { scanColour: 'base' })).toMatch(/^scanColour is \{"part": "tub"\}/)
    expect(await said('show', { scans: 'S1' })).toBe('scans is a list of the numbers of the scans to leave switched on, [] to hide them all: {"scans": ["S1"]}')
    expect(await said('show', { scanOpacity: 'half' })).toMatch(/^scanOpacity is a number from 0.05 to 1/)
    // Through the real schema: what is no explode reaches the tool, which says what one is; and null is taken, not refused.
    expect(await said('look', { explode: 'half' })).toMatch(/^explode is a number from 0 to 1 \(how far apart the parts are drawn/)
    expect(await said('show', { explode: [0.5] })).toMatch(/^explode is a number from 0 to 1/)
    // What is nearly one is not made into one: a percentage, a scale out of range, an axis that is none, a slip in a key.
    for (const given of [50, { amount: 0.5, scale: 100 }, { amount: 0.5, axis: 'up' }]) expect(await said('look', { explode: given }), JSON.stringify(given)).toMatch(/^explode is a number from 0 to 1 .*scale from 0.25 to 4/)
    expect(await said('show', { explode: { amount: 0.5, axix: 'z' } })).toBe('explode takes no "axix": did you mean axis? An unknown key is not ignored: nothing was done. It takes: amount, scale, axis.')
    expect(await said('look', { explode: 0.5, section: { axis: 'z', at: 2 } })).toBe('a section is not drawn exploded: give explode or section, not both (explode: null draws the parts together, section: null draws them whole)')
    expect((await client.callTool({ name: 'look', arguments: { explode: null } })).isError).toBeFalsy()
    expect((await client.callTool({ name: 'look', arguments: { explode: { amount: 1, axis: 'z', scale: 2 } } })).isError).toBeFalsy()
    expect(looks.slice(-2).map((look) => look.req.explode)).toEqual([null, { amount: 1, scale: 2, axis: 'z' }])
    // The name of a saved view passes the schema as any text does, and is the tool's to find or to refuse.
    expect((await client.callTool({ name: 'look', arguments: { view: 'hinge SIDE' } })).isError).toBeFalsy()
    expect(looks.at(-1)!.req).toMatchObject({ view: SIDE.camera, viewName: 'Hinge side', layout: 'main', parts: ['base'], section: null, explode: null })
    expect((await client.callTool({ name: 'show', arguments: { view: 'Hinge side' } })).isError).toBeFalsy()
    expect(shows.at(-1)).toMatchObject({ view: SIDE.camera, viewName: 'Hinge side', layout: 'main', parts: ['base'] })
    expect(await said('look', { view: 'hinge' })).toBe('no view "hinge": the saved views are "Hinge side"; or current, iso, front, back, left, right, top, bottom, or a camera')
    expect(JSON.parse(((await client.callTool({ name: 'scene', arguments: {} })).content as Content)[0].text!).views).toEqual([{ name: 'Hinge side', by: 'user', layout: 'main' }])
    // save_view: what is no name is said, whose a view is cannot be given, and a call that is one reaches the window.
    expect(await said('save_view', {})).toBe('name is what the view is called, 1 to 40 characters: {"name": "Wall at the latch"}')
    expect(await said('save_view', { name: 'Mine', author: 'user' })).toBe('save_view takes no "author". An unknown key is not ignored: nothing was done. It takes: name, note, view, layout, parts, section, explode.')
    expect(await said('save_view', { name: 'Mine', kept: true })).toMatch(/^save_view takes no "kept"/)
    expect(await said('save_view', { name: 'hinge side' })).toBe('the user has a view named "Hinge side": choose another name (their views: "Hinge side")')
    expect(await said('save_view', { name: 'Both', section: { axis: 'z', at: 2 }, explode: 0.5 })).toMatch(/^a view holds a section or an explode, not both/)
    expect(savedViews).toEqual([])
    const kept = await client.callTool({ name: 'save_view', arguments: { name: 'Wall at the latch', view: 'front', section: { axis: 'z', at: 2 }, note: 'thin here' } })
    expect(kept.isError).toBeFalsy()
    expect((kept.content as Content)[0].text).toMatch(/^saved "Wall at the latch" as a view you propose: layout main, parts base, /)
    expect(savedViews).toEqual([{ objectId: 'bracket', name: 'Wall at the latch', note: 'thin here', view: 'front', section: { origin: [0, 0, 2], normal: [0, 0, 1] } }])
    expect(await said('section', { plane: { axis: 'z', at: 2 }, scan: 1 })).toBe('scan is the number of a scan, as listed by scans: {"scan": "S1"}')
    // A well-formed call of an object with no scans is answered in words too.
    expect(await said('scan_clash', { part: 'base' })).toBe('this project has no scans: the user imports one in the Scans section of the torno window')
  })

  it('answers scene with JSON of the object named in the address', async () => {
    const client = await connect('bracket')
    const result = await client.callTool({ name: 'scene', arguments: {} })
    expect(result.isError).toBeFalsy()
    const scene = JSON.parse((result.content as Content)[0].text!)
    expect(scene).toMatchObject({ object: 'bracket', build: { status: 'ok', revision: 2 }, parts: [{ name: 'base', size: [40, 30, 5] }] })
  })

  it('answers look with an image block holding the very bytes of the picture', async () => {
    const client = await connect('bracket')
    const result = await client.callTool({ name: 'look', arguments: { view: 'iso', size: 5000 } })
    expect(result.isError).toBeFalsy()
    const [image, text] = result.content as Content
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(new Uint8Array(Buffer.from(image.data!, 'base64'))).toEqual(PNG)
    expect(text.text).toBe('view iso\nrevision r2\nsaved as /ws/bracket/.torno/views/1.png')
    expect(looks).toEqual([{ objectId: 'bracket', req: { view: 'iso', size: 2000, explode: null } }])
  })

  it("answers the tools that read and write marks, point things out and change the user's view", async () => {
    const client = await connect('bracket')
    const text = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, `${name}: ${(result.content as Content)[0].text}`).toBeFalsy()
      return (result.content as Content)[0].text!
    }
    const line = 'M1 pin on base/F5 at (1, 2, 5): "here" [not checked against r2]'
    // The pin was never checked against a build, and both answers say so beside the revision they are of.
    expect(JSON.parse(await text('marks', { status: 'draft' }))).toEqual({ revision: 2, marks: [{ ...PIN, line }] })
    expect(JSON.parse(await text('describe', { ref: 'base/F5' }))).toMatchObject({ layout: 'main', kind: 'face', ref: 'main:base/F5', descriptor: 'plane, normal +Z, z = 5, 1200 mm²' })
    expect(JSON.parse(await text('describe', { ref: 'M1' }))).toEqual({ revision: 2, mark: { ...PIN, line } })
    expect(await text('highlight', { refs: ['base/F5'], note: 'this one?' })).toBe('highlighted base/F5 in layout main for the user, with the note "this one?", until they click in the viewport or 60 s pass.')
    // Not through a mark the last build's check did not confirm (final review M9): what it is on is not known.
    expect(await client.callTool({ name: 'highlight', arguments: { refs: ['M1'] } })).toMatchObject({ isError: true, content: [{ text: 'nothing was highlighted: M1 has not been checked against r2 yet, so what it is on is not known: give a ref, or ask again in a moment' }] })
    expect(await text('show', { view: 'top' })).toBe("view top · layout main\nrevision r2\nThe user's viewport now shows this.")
    expect(await text('add_mark', { kind: 'pin', note: 'this face?', ref: 'base/F5' })).toBe('placed in layout main: (yours) M2 pin on base/F5 (plane, normal +Z, z = 5, 1200 mm²) at (20, 15, 5): "this face?"\nrevision r2')
    expect(added).toMatchObject([{ kind: 'pin', author: 'agent', anchor: { ref: 'base/F5' } }])
    expect(await text('resolve_mark', { id: 'M1', note: 'done' })).toBe('resolved: M1 pin on base/F5 at (1, 2, 5): "here"\nnote: done')
    const missing = await client.callTool({ name: 'resolve_mark', arguments: { id: 'M7' } })
    expect(missing).toMatchObject({ isError: true, content: [{ text: 'no mark M7; marks: M1' }] })
  })

  it('refuses arguments that are not what the new tools take', async () => {
    const client = await connect('bracket')
    const bad: Array<[string, Record<string, unknown>]> = [
      ['add_mark', { kind: 'dimension', note: '' }],
      ['add_mark', { kind: 'pin', note: '', point: [1, 2] }],
      ['highlight', { refs: [] }],
      ['show', { view: 'current' }],
      ['marks', { status: 'done' }]
    ]
    for (const [name, args] of bad) {
      const result = await client.callTool({ name, arguments: args }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }))
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
    }
    expect(added).toEqual([])
  })

  it('answers a malformed plane or end with what one looks like, not with the schema’s "Invalid input"', async () => {
    const client = await connect('bracket')
    const said = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const result = await client.callTool({ name, arguments: args }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }))
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
      return (result.content as Content)[0].text!
    }
    const NO_PLANE = 'that is not a plane: give {"axis": "z", "at": 3} for the plane across x, y or z at that coordinate in mm, or {"origin": [x, y, z], "normal": [x, y, z]} with a normal that is not all zeros'
    for (const plane of ['z=3', { z: 3 }, { axis: 'z' }, [0, 0, 1], { origin: [0, 0, 0] }]) expect(await said('section', { plane })).toBe(NO_PLANE)
    expect(await said('section', {})).toBe(NO_PLANE)
    expect(await said('look', { section: { at: 3 } })).toBe(NO_PLANE)
    expect(await said('show', { section: 'z' })).toBe(NO_PLANE)
    // A camera with no target, or with something that is no point: what a camera is, not "view: Invalid input".
    const NO_CAMERA = 'view, as a camera, takes position and target as [x, y, z] in mm, as scene gives them: {"position": [120, -90, 60], "target": [0, 0, 6]}; or give a name: current, iso, front, back, left, right, top, bottom, or a saved view'
    expect(await said('look', { view: { position: [100, 0, 0] } })).toBe(NO_CAMERA)
    expect(await said('show', { view: { position: [100, 0, 0], target: 'origin' } })).toBe(NO_CAMERA)
    expect(await said('save_view', { name: 'A', view: { target: [0, 0, 0] } })).toBe(NO_CAMERA)
    expect(await said('look', { view: 12 })).toBe(NO_CAMERA)
    const noEnd = (name: string): string => `${name} names nothing: give a ref ("lid/F12"), the number of a mark ("M3"), {"point": [x, y, z]} in mm, or {"ref": "lid/F12", "point": [x, y, z]}`
    expect(await said('measure', { kind: 'radius' })).toBe(noEnd('a'))
    expect(await said('measure', { kind: 'radius', a: { face: 'base/F5' } })).toBe(noEnd('a'))
    expect(await said('measure', { kind: 'distance', a: 'base/F5', b: [1, 2] })).toBe(noEnd('b'))
    expect(await said('add_mark', { kind: 'dimension', note: '', measure: 'diameter', a: 12 })).toBe(noEnd('a'))
  })

  it('refuses a key no tool takes, of every tool, naming it, the nearest it does take and all of them: none is dropped in silence', async () => {
    const client = await connect('bracket')
    const said = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const result = await client.callTool({ name, arguments: args }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: `THROWN ${e.message}` }] }))
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
      return (result.content as Content)[0].text!
    }
    for (const [name, args] of Object.entries(MINIMAL)) expect(await said(name, { ...args, colour: 'red' }), name).toMatch(new RegExp(`^${name} takes no "colour"\\. An unknown key is not ignored: nothing was done\\. It takes`))
    expect(await said('scene', { layouts: 'main' })).toBe('scene takes no "layouts": did you mean layout? An unknown key is not ignored: nothing was done. It takes: layout, detail.')
    // What a slip would have changed without a word: the region counted after all, the whole part measured, no scan cut, the scans drawn.
    expect(await said('scan_clash', { part: 'base', ignored: ['M7'] })).toBe('scan_clash takes no "ignored": did you mean ignore? An unknown key is not ignored: nothing was done. It takes: part, scan, ignore, margin, layout.')
    expect(await said('scan_deviation', { part: 'base', face: ['base/F5'] })).toContain('takes no "face": did you mean faces?')
    expect(await said('scan_deviation', { part: 'base', regions: 'M7' })).toContain('takes no "regions": did you mean region?')
    expect(await said('section', { plane: { axis: 'z', at: 2 }, scans: 'S1' })).toContain('section takes no "scans": did you mean scan?')
    expect(await said('look', { scan: false })).toContain('look takes no "scan": did you mean scans?')
    expect(await said('measure', { kind: 'distance', a: 'base/F5', B: 'base/F0' })).toContain('measure takes no "B": did you mean b?')
    expect(await said('add_mark', { kind: 'pin', note: '', ref: 'base', notes: 'x' })).toContain('add_mark takes no "notes": did you mean note?')
    expect(added).toEqual([])
    expect(looks).toEqual([])
  })

  it('refuses a key that an end, a plane, a camera or a scan to colour does not take, where it would have been read as something else', async () => {
    const client = await connect('bracket')
    const said = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const result = await client.callTool({ name, arguments: args }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: `THROWN ${e.message}` }] }))
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
      return (result.content as Content)[0].text!
    }
    // A point of a scan under a misspelt key is no bare point of the layout, which would be measured as exact.
    expect(await said('measure', { kind: 'distance', a: { point: [1, 2, 3], scann: 'S1' }, b: 'base/F5' })).toBe('the end a takes no "scann": did you mean scan? An unknown key is not ignored: nothing was done. It takes: ref, point, scan.')
    expect(await said('measure', { kind: 'distance', a: 'base/F5', b: { ref: 'base/F0', at: [1, 2, 3] } })).toBe('the end b takes no "at". An unknown key is not ignored: nothing was done. It takes: ref, point, scan.')
    expect(await said('measure', { kind: 'distance', a: { scan: 'S1', point: [1, 2, 3], ref: 'base/F5' }, b: 'base/F0' })).toBe('a names nothing: a point of a scan is {"scan": "S1", "point": [x, y, z]}, in mm in the frame of the layout')
    expect(await said('add_mark', { kind: 'dimension', note: '', measure: 'radius', a: { ref: 'base/F5', pt: [1, 2, 3] } })).toContain('the end a takes no "pt"')
    expect(await said('section', { plane: { axis: 'z', at: 2, offset: 1 } })).toBe('the plane takes no "offset". An unknown key is not ignored: nothing was done. It takes: axis, at, origin, normal.')
    expect(await said('look', { section: { origin: [0, 0, 1], normal: [0, 0, 1], flip: true } })).toContain('the plane takes no "flip"')
    expect(await said('show', { section: { axis: 'z', att: 3 } })).toContain('the plane takes no "att": did you mean at?')
    expect(await said('look', { view: { position: [0, 0, 100], target: [0, 0, 0], orthographic: true } })).toBe('view, as a camera, takes no "orthographic". An unknown key is not ignored: nothing was done. It takes: position, target, up, ortho, fov, zoom.')
    expect(await said('show', { view: { position: [0, 0, 100], target: [0, 0, 0], fieldOfView: 20 } })).toContain('view, as a camera, takes no "fieldOfView"')
    expect(await said('look', { scanColour: { part: 'base', within: 5 } })).toBe('scanColour takes no "within". An unknown key is not ignored: nothing was done. It takes: part, scan, range.')
    expect(looks).toEqual([])
  })

  // Final fix wave (I6): what one tool says, another takes. The agent reads the view, shows something, and puts the view back.
  it('takes back everything scene and marks return, in the tool that takes it: the camera whole, the section, the layout, the parts', async () => {
    view = { objectId: 'bracket', layout: 'main', camera: { position: [120.5, -80, 60], target: [0, 0, 2.5], up: [0, 0, 1], ortho: true, fov: 28, zoom: 2.5 }, visible: ['main:base'], section: { origin: [0, 0, 2], normal: [0, 0, 1] } }
    const client = await connect('bracket')
    const call = async (name: string, args: object) => {
      const result = await client.callTool({ name, arguments: args as Record<string, unknown> })
      expect(result.isError, `${name}: ${(result.content as Content).find((block) => block.type === 'text')?.text}`).toBeFalsy()
      return (result.content as Content).find((block) => block.type === 'text')!.text!
    }
    const scene = JSON.parse(await call('scene', {}))
    expect(scene.camera).toMatchObject({ ortho: true, fov: 28, zoom: 2.5 })
    const given = { view: scene.camera, layout: scene.layout, parts: scene.parts.map((part: { name: string }) => part.name), section: scene.section }
    await call('look', given)
    await call('show', given)
    const whole = { position: [120.5, -80, 60], target: [0, 0, 2.5], up: [0, 0, 1], ortho: true, fov: 28, zoom: 2.5 }
    expect(looks[0].req).toMatchObject({ view: whole, layout: 'main', parts: ['base'], section: { origin: [0, 0, 2], normal: [0, 0, 1] } })
    expect(shows[0]).toMatchObject({ view: whole, layout: 'main', parts: ['base'], section: { origin: [0, 0, 2], normal: [0, 0, 1] } })
    await call('section', { plane: scene.section, layout: scene.layout, parts: given.parts })
    // And the view a mark was placed from.
    const marks = JSON.parse(await call('marks', {}))
    await call('look', { view: marks.marks[0].camera, layout: marks.marks[0].layout })
    await call('show', { view: marks.marks[0].camera })
    expect(looks[1].req.view).toEqual(PIN.camera)
    expect(shows[1].view).toEqual(PIN.camera)
    // A camera with neither is as before: the usual lens, not zoomed. One that makes no sense is refused.
    await call('look', { view: { position: [0, 0, 100], target: [0, 0, 0] } })
    expect(looks[2].req.view).toMatchObject({ fov: 35, zoom: 1 })
    for (const bad of [{ zoom: 0 }, { zoom: -1 }, { fov: 0 }, { fov: 180 }]) {
      const refused = await client.callTool({ name: 'look', arguments: { view: { position: [0, 0, 100], target: [0, 0, 0], ...bad } } })
      expect(refused.isError, JSON.stringify(bad)).toBe(true)
      expect((refused.content as Content)[0].text).toMatch(/^view, as a camera, takes (a zoom above 0|a fov between 1 and 120 degrees)/)
    }
  })

  it('refuses arguments that are not what look takes', async () => {
    const client = await connect('bracket')
    const result = await client.callTool({ name: 'look', arguments: { view: 'sideways' } }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }))
    expect(result.isError).toBe(true)
    expect((result.content as Content)[0].text).toMatch(/view/)
    expect(looks).toEqual([])
  })

  it('serves a second client while the first is waiting', async () => {
    const first = await connect('bracket')
    const second = await connect('bracket')
    const slow = first.callTool({ name: 'look', arguments: { view: 'top' } })
    await vi.waitFor(() => expect(release).not.toBeNull())
    const quick = await second.callTool({ name: 'look', arguments: { view: 'front' } })
    expect((quick.content as Content)[1].text).toContain('view front')
    expect((await second.listTools()).tools).toHaveLength(ALL.length)
    release!()
    expect(((await slow).content as Content)[1].text).toContain('view top')
  })

  it('answers GET and DELETE with 405', async () => {
    for (const method of ['GET', 'DELETE']) {
      const reply = await fetch(http.url('/mcp/bracket'), { method, headers: { accept: 'text/event-stream', ...tokenFor('bracket') } })
      expect(reply.status).toBe(405)
      expect(reply.headers.get('allow')).toBe('POST')
      expect(await reply.json()).toMatchObject({ jsonrpc: '2.0', error: { message: expect.stringContaining('POST only') } })
    }
  })

  it('answers a body that is not JSON with 400, and an address that is not of one object with 404', async () => {
    const bad = await fetch(http.url('/mcp/bracket'), { method: 'POST', headers: { 'content-type': 'application/json', ...tokenFor('bracket') }, body: '{' })
    expect(bad.status).toBe(400)
    const below = await fetch(http.url('/mcp/bracket/more'), { method: 'POST', headers: { 'content-type': 'application/json', ...tokenFor('bracket') }, body: '{}' })
    expect(below.status).toBe(404)
    expect(await below.json()).toMatchObject({ jsonrpc: '2.0', error: { message: expect.stringContaining('ends in the id of a project') } })
    // No token opens `/mcp` itself: it is nothing.
    const nowhere = await fetch(http.url('/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', ...tokenFor('bracket') }, body: '{}' })
    expect(nowhere.status).toBe(404)
  })

  // #113: the tools are for whoever has a token of that object, which only its session's agent has, in its environment.
  it("answers 404 to a request without a token of the object it names, and no tool is called", async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    const token = tokenFor('bracket')[SESSION_HEADER]
    for (const sent of [{}, { [SESSION_HEADER]: '' }, { [SESSION_HEADER]: '${TORNO_SESSION}' }, { [SESSION_HEADER]: token.split('').reverse().join('') }, tokenFor('lid'), { authorization: `Bearer ${token}` }]) {
      const reply = await fetch(http.url('/mcp/bracket'), { method: 'POST', headers: { ...headers, ...sent }, body: JSON.stringify(init) })
      expect([sent, reply.status, await reply.text()]).toEqual([sent, 404, '{"error":"not found"}'])
    }
    const fine = await fetch(http.url('/mcp/bracket'), { method: 'POST', headers: { ...headers, [SESSION_HEADER]: token }, body: JSON.stringify(init) })
    expect(fine.status).toBe(200)
    http.revoke(token)
    expect((await fetch(http.url('/mcp/bracket'), { method: 'POST', headers: { ...headers, [SESSION_HEADER]: token }, body: JSON.stringify(init) })).status).toBe(404)
  })

  // #132: the call stays open while the person decides, and tells its client it is alive meanwhile.
  it('waits for the answer to ask, sending progress notices, and gives the option chosen', async () => {
    const client = await connect('bracket')
    let asked: AskRequest | undefined
    answering = (req) => {
      asked = req
      return new Promise((resolve) => setTimeout(() => resolve({ kind: 'option', index: 0 }), 200))
    }
    const progress: Array<{ progress: number; message?: string }> = []
    const result = await client.callTool({ name: 'ask', arguments: MINIMAL.ask }, undefined, { onprogress: (p) => progress.push(p) })
    answering = null
    expect(asked).toMatchObject({ question: 'Which?', pick: false, layout: 'main', options: [{ label: 'This one', refs: ['base'] }] })
    expect(JSON.parse((result.content as Content)[0].text!)).toMatchObject({ answered: true, kind: 'option', index: 0, label: 'This one', refs: ['base'] })
    expect(progress.length).toBeGreaterThanOrEqual(2)
    expect(progress[0]).toMatchObject({ progress: 1, message: 'waiting for the user to answer' })
  })

  it('ends the question when the client hangs up', async () => {
    const client = await connect('bracket')
    let signal: AbortSignal | undefined
    answering = (_req, given) => {
      signal = given
      return new Promise((resolve) => given.addEventListener('abort', () => resolve({ kind: 'ended', why: 'aborted' })))
    }
    // A client that cancels one call only tells another request of a server without sessions; hanging up it does see.
    const call = client.callTool({ name: 'ask', arguments: MINIMAL.ask }).catch((e: Error) => e)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await client.close()
    expect(await call).toBeInstanceOf(Error)
    await expect.poll(() => signal?.aborted).toBe(true)
    answering = null
  })

  it('serves an object id the workspace does not have, whose tools say so', async () => {
    const client = await connect('no such')
    expect((await client.listTools()).tools).toHaveLength(ALL.length)
    for (const [name, args] of Object.entries(MINIMAL)) {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError).toBe(true)
      expect((result.content as Content)[0].text).toBe('unknown project: no such')
    }
  })
})
