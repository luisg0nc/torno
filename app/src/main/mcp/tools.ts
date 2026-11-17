import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LOOK_OFF } from '../ablations'
import { z } from 'zod'
import type { BuildState } from '../../shared/build'
import { diagnosisText } from '../../shared/diagnosis'
import type { Described } from '../../shared/geometry'
import type { BuildIdentity } from '../../shared/git'
import type { SketchDraft } from '../../shared/bridge'
import type { Mark, MarkPatch, NewMark, NoteMark } from '../../shared/marks'
import type { Round } from '../../shared/reviews'
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
import type { HistoryEntry } from '../../shared/history'
import type { TrialResult } from '../kernel/client'
import type { ObjectInfo } from '../../shared/workspace'
import { describeMark, markData, sizes } from '../marks/describe'
import { sketchData } from '../sketches/text'
import { noteFilesExist } from '../notes/files'
import { MOST_NOTE_PICTURES, notePictures } from '../notes/pictures'
import { noteData } from '../notes/text'
import { Refusal } from '../refusal'
import { reviewData } from '../reviews/text'
import { number } from '../../shared/format'
import { groupsIn } from '../../shared/groups'
import type { Unmeasured } from '../marks/measure'
import { movedForDisplay } from '../marks/spread'
import type { AskedAnchor, NearestAnchor } from '../marks/reanchor'
import { type ExpectArgs, type Expectations, expectTool } from './expectTools'
import { onlyKeysWrong, unknownKeys } from './keys'
import { askTool } from './askTool'
import type { AskAnswer, AskEnd, AskRequest } from '../../shared/ask'
import { addMarkTool, checkRef, highlightTool, resolveMarkTool } from './markTools'
import { addSketchTool } from './sketchTools'
import { type FeaturesToolArgs, featuresTool } from './featureTools'
import { type DiffToolArgs, type HistoryToolArgs, type MeasureToolArgs, type SectionToolArgs, type TryFilletToolArgs, type TryParamsToolArgs, checkTool, diffTool, historyTool, measureTool, sectionTool, tryFilletTool, tryParamsTool } from './readTools'
import { type ScanClashArgs, type ScanDeviationArgs, type ScansArgs, scanClashTool, scanDeviationTool, scansTool } from './scanTools'
import { type AddCardArgs, type AddMarkArgs, type AddSketchArgs, type AskArgs, type BoardArgs, type DescribeArgs, type HighlightArgs, type LookArgs, type MarksArgs, type ResolveMarkArgs, type SaveViewArgs, type ShowArgs, DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, NO_PLANE, TOOLS, refusedKeys } from './schemas'
import { addCardTool, boardTool } from './boardTools'
import { type SceneArgs, lookTool, saveViewTool, sceneTool, showTool } from './viewTools'
import type { Profile } from '../../shared/profile'
import type { AgentChange, BoardFile } from '../../shared/board'
import type { AgentResult } from '../board/store'
import type { LiveFacts } from '../board/text'

/** What the tools need of torno. All of it is about objects of the open workspace, by id. */
export interface ToolDeps {
  /** The tools an eval run takes away (`main/ablations.ts`): each answers that it is off. Absent in every other run. */
  off?: ReadonlySet<string>
  /** The size of a `look` that names none, from an eval run (`evalTuning`); DEFAULT_SIZE otherwise. */
  lookSize?: number
  /** Takes out of what the model printed what must not be told (the tokens of the sessions). */
  redact?(text: string): string
  object(objectId: string): ObjectInfo | undefined
  /** The printer and material the project is made for (`.torno/profile.json`): the person's numbers, which `check` and `measure` take as defaults. None when it has none. */
  profile?(objectId: string): Profile | undefined
  build(objectId: string): BuildState | undefined
  /** The last successful build. */
  scene(objectId: string): { revision: number; scene: Scene } | undefined
  /** The last two successful builds, the older first (`diff`). Without it, only the last is known. */
  scenes?(objectId: string): Array<{ revision: number; scene: Scene }>
  /** What the build of this run with this revision was made from (`main/buildlog.ts`); undefined when it is not known. `diff` tells it. */
  identity?(objectId: string, revision: number): BuildIdentity | undefined
  /** The builds kept in the project's history (`.torno/history/`, oldest first) and the run of this torno; null when there is no history. `diff` and `history` read it. */
  history?(objectId: string): Promise<{ run: string; entries: HistoryEntry[] } | null>
  /** The scene a kept build left, without its meshes (`diff` compares it); null when it is gone. */
  historyScene?(objectId: string, historyId: string): Promise<Scene | null>
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
  /** The rounds of the person's reviews of an object, oldest first (`marks` with `review`). Without it, there are none. */
  rounds?(objectId: string): Promise<Round[]>
  /** Keeps a mark of the agent's and gives it its number. Rejects with a text for the agent. */
  addMark(objectId: string, mark: NewMark): Promise<Mark>
  /**
   * Keeps a dimension of the agent's, measured by the kernel as it is kept. Rejects with the kernel's reason when it
   * cannot be measured, and nothing is kept. One kept without a value of the last build says why (`unmeasured`).
   */
  addDimension(objectId: string, mark: NewMark): Promise<{ mark: Mark; unmeasured?: Unmeasured; reason?: string }>
  /**
   * Keeps a sketch of the agent's that main has checked: new, or (with the draft's `id`) in place of one of its own, with
   * what each stroke touches. Rejects with a text for the agent; a sketch of the person's is refused.
   */
  saveSketch?(objectId: string, draft: SketchDraft, touches: ReadonlyArray<readonly string[]>): Promise<Mark>
  /** Takes a mark away, as the window's delete does: the last one removed can be undone there. Rejects with a text. */
  removeMark?(objectId: string, id: string): Promise<void>
  /** Changes a mark. Rejects with a text that names the marks there are when there is none of that id. */
  updateMark(objectId: string, id: string, patch: MarkPatch): Promise<Mark>
  /** What the kernel says of a part, a face or an edge of the last successful build, in a layout. Rejects with a text. */
  describe(objectId: string, layout: string, ref: string, options?: { selector?: boolean }): Promise<Described>
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
   * Puts a question to the person in the window and waits for what ends it: their answer, or the signal (which the
   * tool fires at its time limit and when the client gives the call up). Main shows the session as `needs_input`
   * meanwhile.
   */
  ask?(objectId: string, req: AskRequest, signal: AbortSignal): Promise<AskAnswer | AskEnd>
  /** Whether a question of an object waits for an answer now: there is one at a time. */
  asking?(objectId: string): boolean
  /** The time `ask` waits and how often it tells its client it is alive; the tests shorten them. */
  askLimits?: { limitMs: number; progressMs: number }
  /**
   * Asks the kernel about the last successful build of an object: an exact measurement, what a plane cuts, a check
   * of two parts or of a mesh. Refs go with the layout in front. Rejects with a `KernelError`, whose kind says why.
   */
  query<T = unknown>(objectId: string, name: 'measure' | 'section' | 'check' | 'scan_clash' | 'scan_deviation' | 'scan_section' | 'try_fillet' | 'features', args: object): Promise<T>
  /**
   * Builds the model of an object with other values of its `Params` (over the person's own) in a worker the kernel
   * throws away, and answers `queries` there (`name` and `args` as `query` takes them). Nothing is kept or changed.
   * Absent where the kernel cannot (a fake); the tool then says so. Rejects with a `KernelError`.
   */
  trial?(objectId: string, set: Record<string, number | boolean | string>, queries: Array<{ name: string; args: object }>): Promise<TrialResult>
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
  /** What the agent expects of its next edit (`expect`), held in memory. Without it the tool says it is not available. */
  expectations?: Expectations
  /** The board of a project (`main/board/store.ts`): what `board` reads and `add_card` changes, and what the cards that show something of the project say. Without it those tools say they are not available. */
  board?: {
    read(objectId: string): Promise<BoardFile>
    /** Rejects with a `Refusal` whose message is for the agent: nothing was changed. */
    agent(objectId: string, change: AgentChange): Promise<AgentResult>
    live(objectId: string): Promise<LiveFacts>
  }
  /** A picture scaled down to a long edge of at most `edge` px, as a PNG: the pictures of the board are sent at 1280. Without it they are sent as they are kept. */
  scale?(bytes: Uint8Array, edge: number): Promise<Uint8Array>
}

type Block = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
/** What a tool that waits needs of the call it is run for: its cancellation, and a way to tell the client it is alive. */
export interface ToolExtra {
  signal?: AbortSignal
  progress?(progress: number, message: string): Promise<void>
}

export interface ToolResult {
  [key: string]: unknown
  content: Block[]
  isError?: boolean
}

export const TRACEBACK_LINES = 30

export const SPREAD_NOTE =
  'The parts of the print layout overlapped as the model placed them, so they were spread along X for display; arranged is how far each was moved.'

/** Said by `scene` of a build that has references: what they are for, and what they are left out of. */
export const REFERENCE_NOTE =
  'Parts with role reference are bought parts (a bearing, a screw, a vendor STEP): drawn and measured, and a clearance, overlap or interference check may name them, but they are not printed, not counted by bed, have no mass and are not in a mesh export.'

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
  const tool = <A>(name: keyof typeof TOOLS, run: (args: A, extra: ToolExtra) => ToolResult | Promise<ToolResult>): void => {
    const of = TOOLS[name]
    server.registerTool(
      name,
      { title: of.title, description: of.description, annotations: of.annotations, ...('meta' in of ? { _meta: of.meta } : {}), inputSchema: z.looseObject('inputSchema' in of ? of.inputSchema : {}) },
      async (args: unknown, extra) =>
        deps.off?.has(name)
          ? failure(name === 'look' ? LOOK_OFF : `${name} is turned off in this eval run.`)
          : (refusedKeys(name, args) ??
            run(args as A, {
              signal: extra.signal,
              // Only a client that sent a progress token is told: without one there is nothing to tie the notice to.
              progress: async (progress, message) => {
                const token = extra._meta?.progressToken
                if (token !== undefined) await extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, message } })
              }
            }))
    )
  }
  tool<SceneArgs>('scene', async (args) => sceneTool(deps, objectId, await deps.marks(objectId).catch(() => undefined), await deps.scans(objectId).catch(() => undefined), await deps.views(objectId).catch(() => undefined), args))
  tool<LookArgs>('look', (args) => lookTool(deps, objectId, args))
  tool<MarksArgs>('marks', (args) => marksTool(deps, objectId, args))
  tool<DescribeArgs>('describe', (args) => describeTool(deps, objectId, args))
  tool<HighlightArgs>('highlight', (args) => highlightTool(deps, objectId, args))
  tool<AskArgs>('ask', (args, extra) => askTool(deps, objectId, args, extra))
  tool<ShowArgs>('show', (args) => showTool(deps, objectId, args))
  tool<SaveViewArgs>('save_view', (args) => saveViewTool(deps, objectId, args))
  tool<AddMarkArgs>('add_mark', (args) => addMarkTool(deps, objectId, args))
  tool<AddSketchArgs>('add_sketch', (args) => addSketchTool(deps, objectId, args))
  tool<ResolveMarkArgs>('resolve_mark', (args) => resolveMarkTool(deps, objectId, args))
  tool<MeasureToolArgs>('measure', (args) => measureTool(deps, objectId, args))
  tool<SectionToolArgs>('section', (args) => sectionTool(deps, objectId, args))
  tool<Parameters<typeof checkTool>[2]>('check', (args) => checkTool(deps, objectId, args))
  tool<DiffToolArgs>('diff', (args) => diffTool(deps, objectId, args))
  tool<HistoryToolArgs>('history', (args) => historyTool(deps, objectId, args))
  tool<ExpectArgs>('expect', (args) => expectTool(deps, objectId, args))
  tool<TryFilletToolArgs>('try_fillet', (args) => tryFilletTool(deps, objectId, args))
  tool<FeaturesToolArgs>('features', (args) => featuresTool(deps, objectId, args))
  tool<TryParamsToolArgs>('try_params', (args) => tryParamsTool(deps, objectId, args))
  tool<BoardArgs>('board', (args) => boardTool(deps, objectId, args))
  tool<AddCardArgs>('add_card', (args) => addCardTool(deps, objectId, args))
  tool<ScansArgs>('scans', (args) => scansTool(deps, objectId, args))
  tool<ScanClashArgs>('scan_clash', (args) => scanClashTool(deps, objectId, args))
  tool<ScanDeviationArgs>('scan_deviation', (args) => scanDeviationTool(deps, objectId, args))
}

export function failure(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

export const notOpen = (obj: ObjectInfo, open: string | null): string => `${obj.name} is not the project open in the torno window (open: ${open ?? 'none'})`

/**
 * The last successful build of an object, or the error to answer with: the
 * object is not in the workspace, or nothing of it has been built.
 */
export function built(deps: ToolDeps, objectId: string): { obj: ObjectInfo; build: BuildState; revision: number; scene: Scene } | ToolResult {
  const obj = deps.object(objectId)
  if (!obj) return failure(`unknown project: ${objectId}`)
  const build = deps.build(objectId)
  const last = deps.scene(objectId)
  if (build && last) return { obj, build, ...last }
  if (!build) return failure(`no build yet: ${obj.name} has not been opened in the torno window`)
  const traceback = lastLines(build.error?.traceback, TRACEBACK_LINES)
  const why = build.error?.diagnosis ? `\n${diagnosisText(build.error.diagnosis)}` : ''
  return failure(`no build yet: ${build.status}${build.error ? `: ${build.error.message}` : ''}${why}${traceback ? `\n${traceback}` : ''}`)
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
  if (!deps.object(objectId)) return failure(`unknown project: ${objectId}`)
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
const withLine = (mark: Mark, revision?: number, scans?: readonly ScanInfo[], layout?: string, scene?: Scene, dir?: string): object => ({
  // A note is told in words, without its strokes and the names of its files: where its files are on this computer is told with it.
  // A sketch likewise: its strokes are in its `text`, in full, and its picture is a file of main's.
  ...(mark.kind === 'note' ? noteData(mark, revision, dir === undefined ? undefined : noteFilesExist(dir, mark)) : mark.kind === 'sketch' ? sketchData(mark, revision) : markData(mark, revision, scans, layout)),
  line: describeMark(mark, { revision, ...(layout ? { layout } : {}), ...(scans ? { scans } : {}), ...(scene ? { scene } : {}) })
})

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

const MARKS_LIMIT = 50
const MARKS_MAX = 200
const markNumber = (id: string): number => Number(id.slice(1))

/** A stroke without its points, which run to 400 and some 10 KB: how many, the first, the last and the box they lie in, all in full. */
function strokeSummarised(data: object): object {
  const { points, points2d, ...rest } = data as { kind?: string; points?: number[][]; points2d?: number[][] }
  const all = points ?? points2d
  if ((rest as { kind?: string }).kind !== 'stroke' || !all || all.length === 0) return data
  const min = all[0].map((_, i) => Math.min(...all.map((p) => p[i])))
  const max = all[0].map((_, i) => Math.max(...all.map((p) => p[i])))
  return { ...rest, pointsSummary: { space: points ? 'surface' : 'plane', count: all.length, first: all[0], last: all[all.length - 1], bbox: { min, max } } }
}

export async function marksTool(deps: ToolDeps, objectId: string, args: MarksArgs): Promise<ToolResult> {
  const marks = await marksOf(deps, objectId)
  if ('content' in marks) return marks
  if (args.review !== undefined) {
    if (typeof args.review !== 'string') return failure('review is a round, R1, or all')
    let rounds: Round[]
    try {
      rounds = (await deps.rounds?.(objectId)) ?? []
    } catch (e) {
      return failure(messageOf(e))
    }
    const told = reviewData(rounds, marks, args.review)
    return told instanceof Refusal ? failure(told.message) : json({ ...ofBuild(deps, objectId), ...told })
  }
  const wanted = args.status ?? (args.ids ? undefined : 'open')
  const build = ofBuild(deps, objectId)
  const named = args.ids && new Set(args.ids)
  const matching = marks.filter((m) => (named ? named.has(m.id) : wanted === undefined || (wanted === 'open' ? m.status !== 'resolved' : m.status === wanted)))
  const missing = args.ids?.filter((id) => !marks.some((m) => m.id === id))
  const from = args.next === undefined ? 0 : matching.findIndex((m) => markNumber(m.id) >= markNumber(args.next!))
  const limit = Math.min(Math.max(Number.isFinite(args.limit) ? Math.floor(args.limit!) : MARKS_LIMIT, 1), MARKS_MAX)
  const rest = from < 0 ? [] : matching.slice(from)
  const listed = rest.slice(0, limit)
  const omitted = matching.length - listed.length - (from < 0 ? matching.length : from)
  const scans = await scansFor(deps, objectId, listed)
  const wrong = noSuchLayout(deps, objectId, args.layout)
  if (wrong) return wrong
  const layout = regionLayout(deps, objectId, args.layout)
  const strokes = !named && listed.some((m) => m.kind === 'stroke')
  const dir = deps.object(objectId)?.dir
  const notes = listed.filter((m): m is NoteMark => m.kind === 'note')
  const sent = notes.length > 0 && dir !== undefined && args.pictures === true ? await notePictures(dir, notes, deps.scale) : undefined
  const result = json({
    ...build,
    marks: listed.map((m) => {
      const told = withLine(m, build.revision ?? undefined, scans, layout, deps.scene(objectId)?.scene, dir)
      return named ? told : strokeSummarised(told)
    }),
    ...(wanted === 'open' && !named ? { listed: 'open marks; resolved ones with status resolved, or by ids' } : {}),
    ...(missing && missing.length > 0 ? { missing } : {}),
    ...(omitted > 0 ? { truncated: true, omitted, next: rest[listed.length].id } : {}),
    ...(strokes ? { strokesSummarised: 'a stroke holds a summary of its points; name it in ids for all of them' } : {}),
    ...(notes.length > 0 ? { pictures: notePicturesTold(notes, sent) } : {})
  })
  return { content: [...result.content, ...(sent?.sent ?? []).map((one): ToolResult['content'][number] => ({ type: 'image', data: Buffer.from(one.bytes).toString('base64'), mimeType: one.mediaType }))] }
}

/** What `marks` says of the pictures of the notes it lists: which are sent, which are only named (and how to have them), which could not be sent. */
function notePicturesTold(notes: readonly NoteMark[], sent: Awaited<ReturnType<typeof notePictures>> | undefined): object {
  if (!sent) return { named: notes.flatMap((n) => [n.id, ...n.references.map((_, i) => `${n.id} reference ${i + 1}`)]), note: 'Pictures are named here, not sent: ask for them with pictures: true.' }
  return {
    attached: sent.sent.map((one) => one.what),
    ...(sent.left.length > 0 ? { notAttached: sent.left, note: `Not attached, past the most one answer sends (${MOST_NOTE_PICTURES}): ask for fewer notes with ids to read the rest.` } : {}),
    ...(sent.failed.length > 0 ? { notSent: sent.failed } : {})
  }
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
    return mark ? json({ ...build, mark: withLine(mark, build.revision ?? undefined, await scansFor(deps, objectId, [mark]), regionLayout(deps, objectId, args.layout), deps.scene(objectId)?.scene, deps.object(objectId)?.dir) }) : noMark(args.ref, marks)
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
    // A face or an edge also gets a selector that picks it now; a part has none.
    const described = await deps.describe(objectId, layout, args.ref, checked.target === 'part' ? undefined : { selector: true })
    // As of the answer: a build may have ended while the kernel was asked. Its centre and its box are where the part is shown.
    return json({ layout, ...ofBuild(deps, objectId), ...described, ...movedForDisplay(checked.part, layout, described), ...selectorFrame(found.scene, layout, checked.part, described) })
  } catch (e) {
    return failure(messageOf(e))
  }
}

/** Whether a part stands where its own function builds it: not moved, not turned. */
const asBuilt = (part: Scene['parts'][number]): boolean => !part.loc || (part.loc.t.every((c) => Math.abs(c) < 1e-9) && Math.abs(Math.abs(part.loc.q[3]) - 1) < 1e-9)

/**
 * The frame a selector is in, said with it (`selectorFrame`): a selector is of the part as it stands in the layout
 * asked, so a direction or an extreme in it is in that layout's frame. Where the layout moves or turns the part from
 * where its own function builds it, the layouts that leave it as built are named, for the selector of the part as built.
 */
export function selectorFrame(scene: Scene, layout: string, part: Scene['parts'][number], described: Described): { selectorFrame?: string } {
  if (described.kind === 'part' || !described.selector) return {}
  if (asBuilt(part)) return { selectorFrame: `In the frame of layout ${layout}, where ${part.name} stands as its own function builds it.` }
  const as = scene.parts.filter((p) => p.name === part.name && p.layout !== layout && asBuilt(p)).map((p) => p.layout)
  const where = as.length > 0 ? ` Layouts that leave it as built: ${as.join(', ')}; describe the face or edge there for a selector in the frame its function builds in (its number may differ).` : ' No layout leaves it as built.'
  return { selectorFrame: `In the frame of layout ${layout}, where ${part.name} is moved or turned from where its own function builds it: the directions and extremes of the selector (Axis.Z, sort_by(Axis.X)) hold there, not in the model's own frame.${where}` }
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
  // A member with a solid inside out makes the volume a size only, as of a part (`reversed` in the scene).
  const turned = parts.filter((p) => p.reversed && p.reversed.length > 0)
  const said = turned.map((p) => `, ${p.name} solid${p.reversed!.length === 1 ? '' : 's'} ${p.reversed!.join(', ')} reversed`).join('')
  const descriptor = `group of ${parts.length} part${parts.length === 1 ? '' : 's'}, ${bboxExact ? '' : '≈ '}${sizes(max.map((m, i) => m - min[i]))} mm, ${volumeExact ? '' : '≈ '}${number(volume)} mm³${said}`
  return { type: 'group', name, parts: parts.map((p) => p.name), bbox: { min, max }, bboxExact, volume, volumeExact, ...(turned.length > 0 ? { reversed: Object.fromEntries(turned.map((p) => [p.name, p.reversed])) } : {}), descriptor }
}

/** The object a tool that touches the window works on, or the error to answer with when the window shows another. */
export function onScreen(deps: ToolDeps, objectId: string): { obj: ObjectInfo; revision: number; scene: Scene } | ToolResult {
  const found = built(deps, objectId)
  if ('content' in found) return found
  if (deps.openObjectId() !== objectId) return failure(`${notOpen(found.obj, deps.openObjectId())}. Ask the user to open it.`)
  return found
}

export function clampSize(size: number | undefined, fallback: number = DEFAULT_SIZE): number {
  if (size === undefined || !Number.isFinite(size)) return fallback
  return Math.round(Math.min(Math.max(size, MIN_SIZE), MAX_SIZE))
}

export function lastLines(text: string | undefined, count: number): string {
  return (text ?? '').trimEnd().split('\n').slice(-count).join('\n')
}
