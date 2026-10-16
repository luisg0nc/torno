import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { BuildState } from '../../shared/build'
import type { Described } from '../../shared/geometry'
import type { Mark, MarkPatch, NewMark } from '../../shared/marks'
import type { ScanInfo } from '../../shared/scans'
import type { Scene } from '../../shared/scene'
import {
  type HighlightResult,
  type LookRequest,
  type LookResult,
  type SaveViewRequest,
  type SaveViewResult,
  type SectionDrawingRequest,
  type SectionDrawingResult,
  type SectionPlane,
  type ShowRequest,
  type ShowResult,
  type ViewState,
  planeOf
} from '../../shared/view'
import type { SavedView } from '../../shared/views'
import type { ObjectInfo } from '../../shared/workspace'
import { describeMark, markData, sizes } from '../marks/describe'
import { number } from '../../shared/format'
import { groupsIn } from '../../shared/groups'
import type { Unmeasured } from '../marks/measure'
import { movedForDisplay } from '../marks/spread'
import type { AskedAnchor, NearestAnchor } from '../marks/reanchor'
import { onlyKeysWrong, unknownKeys } from './keys'
import { addMarkTool, checkRef, highlightTool, resolveMarkTool } from './markTools'
import { type DiffToolArgs, type MeasureToolArgs, type SectionToolArgs, checkTool, diffTool, measureTool, sectionTool } from './readTools'
import { type ScanClashArgs, type ScanDeviationArgs, type ScansArgs, scanClashTool, scanDeviationTool, scansTool } from './scanTools'
import { type AddMarkArgs, type DescribeArgs, type HighlightArgs, type LookArgs, type MarksArgs, type ResolveMarkArgs, type SaveViewArgs, type ShowArgs, DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, NO_PLANE, TOOLS, refusedKeys } from './schemas'
import { lookTool, saveViewTool, sceneTool, showTool } from './viewTools'

/** What the tools need of torno. All of it is about objects of the open workspace, by id. */
export interface ToolDeps {
  object(objectId: string): ObjectInfo | undefined
  build(objectId: string): BuildState | undefined
  /** The last successful build. */
  scene(objectId: string): { revision: number; scene: Scene } | undefined
  /** The last two successful builds, the older first (`diff`). Without it, only the last is known. */
  scenes?(objectId: string): Array<{ revision: number; scene: Scene }>
  /** The camera, layout and visible parts of an object as the window last showed it. */
  view(objectId: string): ViewState | undefined
  /** The object the window shows now: the only one it can make a picture of. */
  openObjectId(): string | null
  /**
   * A picture from the window, which says which object and revision it drew:
   * it may not be the one asked for. Rejects with a text for the agent.
   */
  look(objectId: string, req: LookRequest): Promise<LookResult>
  /** Writes `.torno/views/<n>.png`, keeps the newest 20, returns the path. */
  saveImage(objectId: string, png: Uint8Array): Promise<string>
  /** Every mark of an object, oldest first. */
  marks(objectId: string): Promise<Mark[]>
  /** Keeps a mark of the agent's and gives it its number. Rejects with a text for the agent. */
  addMark(objectId: string, mark: NewMark): Promise<Mark>
  /**
   * Keeps a dimension of the agent's, measured by the kernel as it is kept. Rejects with the kernel's reason when it
   * cannot be measured, and nothing is kept. One kept without a value of the last build says why (`unmeasured`).
   */
  addDimension(objectId: string, mark: NewMark): Promise<{ mark: Mark; unmeasured?: Unmeasured; reason?: string }>
  /** Changes a mark. Rejects with a text that names the marks there are when there is none of that id. */
  updateMark(objectId: string, id: string, patch: MarkPatch): Promise<Mark>
  /** What the kernel says of a part, a face or an edge of the last successful build, in a layout. Rejects with a text. */
  describe(objectId: string, layout: string, ref: string): Promise<Described>
  /**
   * For each anchor, the point of its part's surface nearest to it, and the face that is on; for one that
   * names an `edge` of its part, also how far its point is from that edge. Rejects with a text.
   */
  nearest(objectId: string, layout: string, anchors: AskedAnchor[]): Promise<NearestAnchor[]>
  /** Changes what the window shows of the object it has open, and says what it shows then. Rejects with a text. */
  show(objectId: string, req: ShowRequest): Promise<ShowResult>
  /** Tints refs of the layout on screen in the agent's colour, with a note beside them. Rejects with a text. */
  highlight(objectId: string, layout: string, refs: string[], note?: string): Promise<HighlightResult>
  /**
   * Asks the kernel about the last successful build of an object: an exact measurement, what a plane cuts, a check
   * of two parts or of a mesh. Refs go with the layout in front. Rejects with a `KernelError`, whose kind says why.
   */
  query<T = unknown>(objectId: string, name: 'measure' | 'section' | 'check' | 'scan_clash' | 'scan_deviation' | 'scan_section', args: object): Promise<T>
  /** The scans of an object, as main keeps them. Rejects with a text. */
  scans(objectId: string): Promise<ScanInfo[]>
  /** Where a scan's mesh and a region's mask are on the disk, for the kernel: of the scans as `scans` last read them, so it is asked at once after. */
  scanPaths(objectId: string, id: string): { mesh: string; mask(stem: string): string } | undefined
  /** The numbers of the scans whose files an import or a conversion is writing now: nothing is read of those meanwhile. */
  scansBusy(objectId: string): string[]
  /** A 2D drawing of what the kernel says a plane cuts, made by the window, whichever object it shows. Rejects with a text. */
  sectionDrawing(req: SectionDrawingRequest): Promise<SectionDrawingResult>
  /** The views saved of an object, in the order they were saved: of its scene file as main last read it or was given it. Rejects when that cannot be read. */
  views(objectId: string): Promise<SavedView[]>
  /** Has the window keep a view the agent proposes, of the object it has open: it is the agent's, and proposed, whatever the request. Rejects with a text. */
  saveView(objectId: string, req: SaveViewRequest): Promise<SaveViewResult>
}

type Block = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export interface ToolResult {
  [key: string]: unknown
  content: Block[]
  isError?: boolean
}

export const TRACEBACK_LINES = 30

export const SPREAD_NOTE =
  'The parts of the print layout overlapped as the model placed them, so they were spread along X for display; arranged is how far each was moved.'

const PLANE_KEYS = ['axis', 'at', 'origin', 'normal']

/**
 * The plane a tool was given, in either form; or the error to answer with: a key no plane takes, by name (it is
 * not dropped: `{axis, at, offset}` is not the plane at `at`), or what a plane looks like for what is none.
 */
export function planeArg(value: unknown): SectionPlane | ToolResult {
  if (onlyKeysWrong(value, PLANE_KEYS, (plane) => planeOf(plane) !== null)) return failure(unknownKeys(value, PLANE_KEYS, 'the plane')!)
  // With a key that is none of a plane's and no slip of one, it is something else altogether: what a plane looks like is said.
  return (unknownKeys(value, PLANE_KEYS, 'the plane') === null ? planeOf(value) : null) ?? failure(NO_PLANE)
}

/**
 * The tools of one object's MCP server. Each is registered with a schema that lets every key through, and is
 * run only when every key given is one it takes: the SDK would drop the others without a word, and a misspelt
 * key would change what is done (`refusedKeys`).
 */
export function registerTools(server: McpServer, deps: ToolDeps, objectId: string): void {
  const tool = <A>(name: keyof typeof TOOLS, run: (args: A) => ToolResult | Promise<ToolResult>): void => {
    const of = TOOLS[name]
    server.registerTool(name, { description: of.description, inputSchema: z.looseObject('inputSchema' in of ? of.inputSchema : {}) }, async (args: unknown) => refusedKeys(name, args) ?? run(args as A))
  }
  tool('scene', async () => sceneTool(deps, objectId, await deps.marks(objectId).catch(() => undefined), await deps.scans(objectId).catch(() => undefined), await deps.views(objectId).catch(() => undefined)))
  tool<LookArgs>('look', (args) => lookTool(deps, objectId, args))
  tool<MarksArgs>('marks', (args) => marksTool(deps, objectId, args))
  tool<DescribeArgs>('describe', (args) => describeTool(deps, objectId, args))
  tool<HighlightArgs>('highlight', (args) => highlightTool(deps, objectId, args))
  tool<ShowArgs>('show', (args) => showTool(deps, objectId, args))
  tool<SaveViewArgs>('save_view', (args) => saveViewTool(deps, objectId, args))
  tool<AddMarkArgs>('add_mark', (args) => addMarkTool(deps, objectId, args))
  tool<ResolveMarkArgs>('resolve_mark', (args) => resolveMarkTool(deps, objectId, args))
  tool<MeasureToolArgs>('measure', (args) => measureTool(deps, objectId, args))
  tool<SectionToolArgs>('section', (args) => sectionTool(deps, objectId, args))
  tool<Parameters<typeof checkTool>[2]>('check', (args) => checkTool(deps, objectId, args))
  tool<DiffToolArgs>('diff', (args) => diffTool(deps, objectId, args))
  tool<ScansArgs>('scans', (args) => scansTool(deps, objectId, args))
  tool<ScanClashArgs>('scan_clash', (args) => scanClashTool(deps, objectId, args))
  tool<ScanDeviationArgs>('scan_deviation', (args) => scanDeviationTool(deps, objectId, args))
}

export function failure(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

export const notOpen = (obj: ObjectInfo, open: string | null): string => `${obj.name} is not the object open in the torno window (open: ${open ?? 'none'})`

/**
 * The last successful build of an object, or the error to answer with: the
 * object is not in the workspace, or nothing of it has been built.
 */
export function built(deps: ToolDeps, objectId: string): { obj: ObjectInfo; build: BuildState; revision: number; scene: Scene } | ToolResult {
  const obj = deps.object(objectId)
  if (!obj) return failure(`unknown object: ${objectId}`)
  const build = deps.build(objectId)
  const last = deps.scene(objectId)
  if (build && last) return { obj, build, ...last }
  if (!build) return failure(`no build yet: ${obj.name} has not been opened in the torno window`)
  const traceback = lastLines(build.error?.traceback, TRACEBACK_LINES)
  return failure(`no build yet: ${build.status}${build.error ? `: ${build.error.message}` : ''}${traceback ? `\n${traceback}` : ''}`)
}

/** Coordinates as the agent is given them: to a tenth of a micron, which is past what any of them means. */
export function tidy<T>(value: T): T {
  if (typeof value === 'number') {
    const rounded = Math.round(value * 1e4) / 1e4
    return (rounded === 0 ? 0 : rounded) as T
  }
  if (Array.isArray(value)) return value.map(tidy) as T
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, tidy(v)])) as T
  return value
}

const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(tidy(value)) }] })
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))
export const MARK_ID = /^M\d+$/

/** The marks of an object, or the error to answer with: the object is not in the workspace, or its marks cannot be read. */
export async function marksOf(deps: ToolDeps, objectId: string): Promise<Mark[] | ToolResult> {
  if (!deps.object(objectId)) return failure(`unknown object: ${objectId}`)
  try {
    return await deps.marks(objectId)
  } catch (e) {
    return failure(messageOf(e))
  }
}

export const noMark = (id: string, marks: Mark[]): ToolResult => failure(`no mark ${id}; marks: ${marks.map((m) => m.id).join(', ') || 'none'}`)

/**
 * A mark as data, with the line that says it in words. The data of a mark
 * that moved or lost its part still holds the ref it was placed on beside what
 * the kernel says is under it now; the line pairs nothing that may not agree.
 * Given the revision of the last build, the line says when the mark was not
 * checked against it. A dimension has a value in its data only where its line
 * gives one: as measured on that build (`markData`).
 * A region of a scan is told where the scan's alignment in its layout puts
 * it, which takes the `scans` of the object (`scansFor`).
 */
const withLine = (mark: Mark, revision?: number, scans?: readonly ScanInfo[], layout?: string, scene?: Scene): object => ({ ...markData(mark, revision, scans, layout), line: describeMark(mark, { revision, ...(layout ? { layout } : {}), ...(scans ? { scans } : {}), ...(scene ? { scene } : {}) }) })

/** The layout a region is told in by a tool: the one asked for, else the one on screen, else the build's first; none before a build, or for a layout the build has not (the region is then told in its own). */
/** The refusal for a layout that was asked for and that the build has not: it is not answered in another. Null otherwise, and before anything is built. */
function noSuchLayout(deps: ToolDeps, objectId: string, asked: string | undefined): ToolResult | null {
  const scene = deps.scene(objectId)?.scene
  if (asked === undefined || !scene) return null
  const layout = layoutFor(deps, objectId, scene, asked)
  return typeof layout === 'string' ? null : layout
}

function regionLayout(deps: ToolDeps, objectId: string, asked: string | undefined): string | undefined {
  const scene = deps.scene(objectId)?.scene
  const layout = scene ? layoutFor(deps, objectId, scene, asked) : undefined
  return typeof layout === 'string' ? layout : undefined
}

/** The scans of an object, for telling its regions: asked for only when one of the marks is a region; none when they cannot be read. */
export async function scansFor(deps: ToolDeps, objectId: string, marks: readonly Mark[]): Promise<ScanInfo[] | undefined> {
  if (!marks.some((mark) => mark.kind === 'region')) return undefined
  // Not read: what a region is told from is then not known, and it is not told as if its scan were gone.
  return deps.scans(objectId).catch(() => undefined)
}

/** Why the last successful build of an object is not of its model as it now is: a build is running, or the latest failed. '' otherwise. */
export function behind(deps: ToolDeps, objectId: string): string {
  const status = deps.build(objectId)?.status
  return status === 'building' ? 'a build is running' : status === 'failed' ? 'the latest build failed' : ''
}

/**
 * Which build an answer made from what main knows is of: its revision (null
 * before the first), and, while that is not the latest attempt, a note that
 * says so. The marks, their refs and what the kernel says are all of the last
 * build that worked.
 */
export function ofBuild(deps: ToolDeps, objectId: string): { revision: number | null; stale?: string } {
  const revision = deps.scene(objectId)?.revision ?? null
  const why = revision === null ? '' : behind(deps, objectId)
  return { revision, ...(why ? { stale: `${why}, so this is still what is known of r${revision}: refs and descriptors may not hold for the model as it now is` } : {}) }
}

export async function marksTool(deps: ToolDeps, objectId: string, args: MarksArgs): Promise<ToolResult> {
  const marks = await marksOf(deps, objectId)
  if ('content' in marks) return marks
  const wanted = args.status
  const build = ofBuild(deps, objectId)
  const listed = marks.filter((m) => wanted === undefined || (wanted === 'open' ? m.status !== 'resolved' : m.status === wanted))
  const scans = await scansFor(deps, objectId, listed)
  const wrong = noSuchLayout(deps, objectId, args.layout)
  if (wrong) return wrong
  const layout = regionLayout(deps, objectId, args.layout)
  return json({ ...build, marks: listed.map((m) => withLine(m, build.revision ?? undefined, scans, layout, deps.scene(objectId)?.scene)) })
}

/**
 * The layout a tool works in: the one asked for, else the one on screen, else
 * the first. An error that names the layouts when the build has none of that name.
 */
export function layoutFor(deps: ToolDeps, objectId: string, scene: Scene, asked: string | undefined): string | ToolResult {
  const onScreen = deps.openObjectId() === objectId ? deps.view(objectId)?.layout : undefined
  const layout = asked ?? (onScreen !== undefined && scene.layouts.includes(onScreen) ? onScreen : scene.layouts[0])
  if (layout === undefined || !scene.layouts.includes(layout)) return failure(`no layout '${asked ?? ''}'; layouts: ${scene.layouts.join(', ') || 'none'}`)
  return layout
}

export async function describeTool(deps: ToolDeps, objectId: string, args: DescribeArgs): Promise<ToolResult> {
  if (MARK_ID.test(args.ref)) {
    const marks = await marksOf(deps, objectId)
    if ('content' in marks) return marks
    const mark = marks.find((m) => m.id === args.ref)
    const build = ofBuild(deps, objectId)
    const wrong = noSuchLayout(deps, objectId, args.layout)
    if (wrong) return wrong
    return mark ? json({ ...build, mark: withLine(mark, build.revision ?? undefined, await scansFor(deps, objectId, [mark]), regionLayout(deps, objectId, args.layout), deps.scene(objectId)?.scene) }) : noMark(args.ref, marks)
  }
  const found = built(deps, objectId)
  if ('content' in found) return found
  const layout = layoutFor(deps, objectId, found.scene, args.layout)
  if (typeof layout !== 'string') return layout
  // A group of parts: worked out here from what the kernel sent of each part with the scene, so nothing is asked of it.
  const group = groupsIn(found.scene, layout).find((g) => g.name === args.ref)
  if (group) return json({ layout, ...ofBuild(deps, objectId), ...groupDescribed(found.scene, layout, group.name, group.parts) })
  const checked = checkRef(found.scene, layout, args.ref)
  if (typeof checked === 'string') return failure(checked)
  try {
    const described = await deps.describe(objectId, layout, args.ref)
    // As of the answer: a build may have ended while the kernel was asked. Its centre and its box are where the part is shown.
    return json({ layout, ...ofBuild(deps, objectId), ...described, ...movedForDisplay(checked.part, layout, described) })
  } catch (e) {
    return failure(messageOf(e))
  }
}

/**
 * A group as `describe` tells it: the box round its parts' boxes and their volumes added up, each exact only where
 * every part's is (the box of a part that is not exact is widened, so the union is not exact either).
 */
function groupDescribed(scene: Scene, layout: string, name: string, names: readonly string[]): object {
  const parts = scene.parts.filter((p) => p.layout === layout && names.includes(p.name))
  const min = [0, 1, 2].map((i) => Math.min(...parts.map((p) => p.bbox.min[i])))
  const max = [0, 1, 2].map((i) => Math.max(...parts.map((p) => p.bbox.max[i])))
  const volume = parts.reduce((sum, p) => sum + p.volume, 0)
  const bboxExact = parts.every((p) => p.bboxExact === true)
  const volumeExact = parts.every((p) => p.volumeExact === true)
  const descriptor = `group of ${parts.length} part${parts.length === 1 ? '' : 's'}, ${bboxExact ? '' : '≈ '}${sizes(max.map((m, i) => m - min[i]))} mm, ${volumeExact ? '' : '≈ '}${number(volume)} mm³`
  return { type: 'group', name, parts: parts.map((p) => p.name), bbox: { min, max }, bboxExact, volume, volumeExact, descriptor }
}

/** The object a tool that touches the window works on, or the error to answer with when the window shows another. */
export function onScreen(deps: ToolDeps, objectId: string): { obj: ObjectInfo; revision: number; scene: Scene } | ToolResult {
  const found = built(deps, objectId)
  if ('content' in found) return found
  if (deps.openObjectId() !== objectId) return failure(`${notOpen(found.obj, deps.openObjectId())}. Ask the user to open it.`)
  return found
}

export function clampSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) return DEFAULT_SIZE
  return Math.round(Math.min(Math.max(size, MIN_SIZE), MAX_SIZE))
}

export function lastLines(text: string | undefined, count: number): string {
  return (text ?? '').trimEnd().split('\n').slice(-count).join('\n')
}
