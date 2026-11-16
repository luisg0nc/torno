import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { type BuildReason, type BuildState, errorLine } from '../shared/build'
import { EXPORT_FORMATS, EXTENSIONS, FORMAT_NAMES, type FileFormat, type ExportPlan, type ExportRequest, type ExportSaved, type ModelFormat } from '../shared/exportdata'
import type { Described, MeasureProbe, MeasuredOnce } from '../shared/geometry'
import type { BuildIdentity } from '../shared/git'
import type { MarkPatch, NewMark, NewRegion, Replacement } from '../shared/marks'
import { PDF_FORMATS, STEP_FORMATS } from '../shared/objectName'
import { type AlignMade, type NewAlignment, type ScanInfo, type ScanUnit, type ScanUp, SCAN_FORMATS, alignmentOf, standingOf } from '../shared/scans'
import type { Scene } from '../shared/scene'
import type { SceneFile } from '../shared/scenefile'
import type { ObjectCard, ThumbnailOf } from '../shared/show'
import type { ViewState } from '../shared/view'
import type { ObjectInfo, RecentFolder, WorkspaceInfo } from '../shared/workspace'
import { Builds, buildTimeout, watchFolder } from './builds'
import { rebuildKept } from './oldbuild'
import { BuildLog, sourcesHash } from './buildlog'
import { RecentMeshes } from './meshes'
import { type GoBackPlan, type GoBackResult, applyGoBack, entryBefore, planGoBack } from './goback'
import { History, type KeptCause, keptCause, readHistory, readHistoryDrawnGone, readHistoryScene, readHistorySource, readHistoryThumb } from './history'
import { type HistoryEntry, type HistoryGhost, type HistoryList, drawable } from '../shared/history'
import type { Verdict } from '../shared/sanity'
import { gitStateRecently } from './git'
import { keepExample } from './example'
import { type ExportDeps, exportFile, exportPlan, forgetExportScans } from './export/build'
import { loadAssets } from './export/html'
import { type ModelDeps, checkModelFile, makeModelFile } from './export/model'
import { defaultExportPath, exportPath, prepareExports, writeExport } from './export/save'
import { checkedPicture } from './export/picture'
import { makeSectionDrawing } from './export/section'
import { pdfOfSvg } from './export/pdf'
import { type InstructionList } from './instructions'
import { KernelError, type KernelClient, type TrialResult, startKernel } from './kernel/client'
import { toArrayBuffer } from './kernel/frames'
import { forgetViews, latestView, reportView, resolveRequest } from './look'
import { type AskedAnchor, type Retrying, asPlaced, asReplaced, checkMarks, followMarks, nearestReply, retrying } from './marks/reanchor'
import { addDimension, dueAfterEdit, measureOnce, remeasure } from './marks/measure'
import { type RegionDeps, addRegion, convertScan, removeMark, repaintRegion, restoreMark, tendRegions } from './marks/regions'
import type { MarkStore } from './marks/store'
import { boardAttachOf, boardHandlers } from './board/ipc'
import { noteHandlers } from './notes/ipc'
import { pinBuild } from './board/pinbuild'
import type { BoardStore } from './board/store'
import { kernelDir, kernelRun } from './paths'
import { Refusal, refusable } from './refusal'
import { type AlignCheckDeps, checkingAlignments, heldNow, keepChecking, tiedToMoved, uncheckedOn } from './scans/alignCheck'
import { frameOf } from './scans/alignments'
import type { ScanStore } from './scans/store'
import { forgetParamFiles, overrideValues, reconcile, resetOverrides, setOverride } from './paramsfile'
import { forgetSceneFiles, loadSceneFile, saveSceneFile, sceneFileNow } from './scenefile'
import { EFFORTS, isEffort, isMode, MODES, MODEL_ALIASES, MODEL_NAME, type ChatAnswer } from '../shared/chat'
import type { BoardOpen, PersonChange, PinWhat } from '../shared/board'
import type { SavedView } from '../shared/views'
import type { AgentView, CreateRequest, NoteDraft, NoteEdit, OnboardDraft, PromptPreviewDraft } from '../shared/bridge'
import { readChoice, writeChoice } from './sessions/choice'
import type { Asks } from './asks'
import type { Sessions } from './sessions/manager'
import type { KnownModels } from './sessions/models'
import { type UserProfiles, projectProfile, setProjectProfile } from './profile'
import { type Profile, profileOf } from '../shared/profile'
import { lastConversation, readLog } from './sessions/chatlog'
import { listPrompts } from './sessions/prompts'
import { readReference } from './sessions/reference'
import { storedConversation } from './sessions/resume'
import { sessionOfWorkspace } from './sessions/status'
import { type KeepDeps, cardsOf, keepThumbnail, newestPython, thumbnailOnFile } from './show/cards'
import { onboardObject, previewPrompt, sessionRunning } from './onboard'
import { createObject, readPhoto, sweepStaleNew } from './objects/create'
import { Offered } from './objects/offered'
import { scanOrder, scanWorkspace } from './workspace'
import type { ReadyKeeper } from './readiness'

/**
 * Every channel the window invokes is registered here: a `Refusal` (what the
 * person asked cannot be done, and the window says why) resolves as a tagged
 * value, which the preload throws again, so that Electron prints nothing for
 * it. Anything else is thrown, and Electron logs it.
 */
function handle(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, refusable(fn))
}

// Channel names, repeated in src/preload/index.ts.
//   invoke: workspace:current, workspace:pick, workspace:open, workspace:versions, ready:check, ready:make,
//           history:list, history:thumbnail, history:source, history:ghost, history:star, history:goBackPlan, history:goBack,
//           board:read, board:change, board:picture, board:brief, board:reference, board:addPicture, board:pin, board:open, board:openLink,
//           board:problem, board:dismissProblem,
//           workspace:recent, workspace:forget, workspace:hasExample, workspace:openExample, workspace:keepExample,
//           object:open, object:rebuild, object:sceneFile,
//           session:current, session:start, session:trust, session:instructions, session:revealInstruction, session:stop, session:chooseView,
//           chat:history, chat:lastConversation, chat:prompts, chat:conversation, chat:reference, chat:changes, chat:undo, chat:send, chat:interrupt, chat:setModel, chat:setEffort, chat:models, profile:choices, profile:savePrinter, profile:saveMaterial, profile:get, profile:set,
//           marks:list, marks:add, marks:update, marks:acknowledge, marks:remove, marks:restore, marks:replace, marks:problem (also sent to the renderer),
//           marks:dismissProblem, notes:make, notes:edit, notes:picture, geometry:describe, geometry:measure,
//           asks:list, scans:list, scans:pick, scans:import, scans:convert, scans:rename, scans:remove, scans:align, scans:mesh,
//           scans:problem (also sent to the renderer), scans:dismissProblem, scans:reimport, scans:undoAlign, scans:alignHolds,
//           objects:pickPhotos, objects:pickStep, objects:pickPdf, objects:readPhoto, objects:create, objects:onboard, objects:previewPrompt, objects:taken, show:cards, show:thumbnail, export:plan, export:save, export:savePicture, export:saveSection
//   from the renderer: export:done, show:saveThumbnail, object:saveSceneFile, view:report, view:lookReply, view:showReply, view:highlightReply,
//           view:drawSectionReply, view:saveViewReply, session:write, session:resize, session:insert,
//           chat:answer, asks:answer
//   to the renderer: object:build, object:scene, view:look, view:show, view:highlight, view:drawSection, view:saveView (sent by src/main/look.ts),
//           session:data, session:status, chat:item, chat:meta, chat:capabilities, workspace:requested and window:closeAsked (sent by src/main/index.ts,
//           which hears the answer, window:closeAnswer),
//           board:changed, board:problem, ready:changed, marks:changed, marks:problem, scans:changed, scans:progress, scans:problem, show:changed, asks:changed (sent by src/main/index.ts), history:changed

/** The longest prompt the window may send. */
const MAX_PROMPT_CHARS = 200_000

interface OpenWorkspace {
  info: WorkspaceInfo // as of the newest scan that has ended
  /** Scans overlap (a burst of changes in two folders, an object opened meanwhile): an older one never replaces a newer. */
  scan: () => () => boolean
  /** Has the marks of an object checked against its last build (see `openWorkspace`). */
  reanchor?: Retrying
  /** Has the alignments of an object's scans checked against its last build. */
  alignChecks?: Retrying
  /** How the model is asked where the points of an alignment are. */
  nearest?: AlignCheckDeps['nearest']
  /** Stops the asking again, every 30 s, for alignments that were not checked. */
  stopChecking?: () => void
  kernel: KernelClient
  builds: Builds
  opened: Set<string> // ids of the objects being watched and built
  shown: string | null // the object the window shows: the last one it opened
  /** By object: when the build that is running, or was last run, was started (ms epoch), and which build its last good scene came of. */
  started: Map<string, number>
  builtFrom: Map<string, { revision: number; startedMs: number | undefined }>
  /** What each successful build of this run was made from, and `.torno/builds.jsonl` (`main/buildlog.ts`). */
  buildLog: BuildLog
  history: History
  /** The meshes of the builds of this run, for the ghost of a kept build (`main/meshes.ts`). */
  meshes: RecentMeshes
}

let current: OpenWorkspace | null = null
/** The photos main's own dialog handed the window: the only files `objects:readPhoto` serves. Forgotten with the workspace. */
const offered = new Offered()

/** The agent sessions, once `registerIpc` has been given them. They belong to the objects of the open workspace. */
let sessions: Sessions | null = null
let asks: Asks | null = null

/** The marks of the objects of the open workspace, once `registerIpc` has been given them. */
let marks: MarkStore | null = null

/** What torno needs and whether it is there, once `registerIpc` has been given it: told the kernel of each workspace as it starts. */
let readiness: ReadyKeeper | null = null

/** The scans of the objects of the open workspace, once `registerIpc` has been given them. */
let scans: ScanStore | null = null

/** By object: how many checks of its marks against a build were started, and how many have ended. */
const checks = new Map<string, { started: number; finished: number }>()

/** How many checks of an object's marks against its build were started and have ended: equal when none is under way. For tests. */
export function marksChecks(objectId: string): { started: number; finished: number } {
  return { ...(checks.get(objectId) ?? { started: 0, finished: 0 }) }
}

/** For tests: has the status of an object say that the kernel let its build go (`Builds.letGoForTest`). */
export function letGoForTest(objectId: string): void {
  current?.builds.letGoForTest(objectId)
}

/**
 * The scans of an object were asked for (a tool, the prompt's line): when an alignment among them was not
 * checked against the last build, it is asked for again. A check that gave up is not given up for good.
 */
export function recheckAlignments(objectId: string, listed: ScanInfo[]): void {
  const last = current?.builds.scene(objectId)
  if (last && uncheckedOn(listed, last.scene.layouts, last.revision)) current?.alignChecks?.(objectId)
}

/** Told where the build of an object stands, each time that changes, once `registerIpc` has been given it. */
let onBuild: ((state: BuildState) => void) | null = null

/** Told that a check of an object's marks against a build ended, and which build that was, once `registerIpc` has been given it. */
let onMarksChecked: ((objectId: string, revision: number | undefined) => void) | null = null

/** Told that the window gave the scene file of an object to save: its saved views may be others. */
let onSceneFile: ((objectId: string) => void) | null = null

/** Told that the window opened a project of the workspace, once `registerIpc` has been given it. */
let onObjectOpened: ((objectId: string) => void) | null = null

/** Told that the workspace was left, with what was known of its objects. */
let onWorkspaceClosed: (() => void) | null = null

function broadcast(channel: string, message: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, message)
  }
}

/** At most this often is the window told that the cards of the objects may say something else. */
const CARDS_TOLD_EVERY_MS = 200
let cardsTold: ReturnType<typeof setTimeout> | null = null

/** Something a card of the page of objects says may have changed: the window is told, once for a burst of changes. */
function cardsChanged(): void {
  cardsTold ??= setTimeout(() => {
    cardsTold = null
    broadcast('show:changed', undefined)
  }, CARDS_TOLD_EVERY_MS)
}

/** The objects opened in this run: those that are watched and built. For tests. */
export function openedObjects(): string[] {
  return [...(current?.opened ?? [])]
}

/** The cards of the open workspace (`cardsOf`): read from what is known of the objects opened in this run and from the files of the others. */
function cards(): Promise<ObjectCard[]> {
  const ws = current
  if (!ws) return Promise.resolve([])
  return cardsOf({
    objects: () => ws.info.objects,
    opened: (id) => ws.opened.has(id),
    build: (id) => ws.builds.state(id),
    marks: (id) => (marks ? marks.list(id) : Promise.reject(new Error('marks are not available'))),
    session: (id) => {
      const session = sessions?.current(id)
      return session ? session.status : null
    },
    readFile: (path) => readFile(path, 'utf8'),
    sourcesMtimeMs: newestPython,
    uses: (id) => ws.builds.scene(id)?.scene.uses ?? [],
    size: (path) => stat(path).then((s) => s.size, () => null),
    git: (dir) => gitStateRecently(dir)
  })
}

/** What keeping a picture of an object's build asks of the open workspace (`keepThumbnail`). */
const keeping: KeepDeps = {
  object: findObject,
  opened: (id) => current?.opened.has(id) === true,
  lastBuild(id) {
    const revision = current?.builds.scene(id)?.revision
    if (revision === undefined) return undefined
    const built = current?.builtFrom.get(id)
    const uses = current?.builds.scene(id)?.scene.uses
    return { revision, ...(built?.revision === revision && built.startedMs !== undefined ? { startedMs: built.startedMs } : {}), ...(uses ? { uses } : {}) }
  }
}

/** Open a workspace: scan it and start a kernel for it. Replaces the one open. */
export async function openWorkspace(root: string, opts: { example?: boolean } = {}): Promise<WorkspaceInfo> {
  // What a create that never ended left (a hidden folder of torno's own, from before this run) is removed first.
  sweepStaleNew(resolve(root), Date.now())
  // What it is (the example's copy) is said with it for as long as it is open, whatever is scanned anew.
  const info: WorkspaceInfo = { ...(await scanWorkspace(resolve(root))), ...(opts.example ? { example: true as const } : {}) }
  // Until none is open: another call may have opened one while this one waited.
  while (current) await closeWorkspace()

  const kernel = startKernel({ workspaceRoot: info.root, hasProject: info.hasProject, kernelDir: kernelDir(), ...kernelRun(info.hasProject) })
  readiness?.opened({ root: info.root, hasProject: info.hasProject }, kernel)
  const builds: Builds = new Builds({
    kernel,
    timeout: buildTimeout(process.env),
    overrides: { values: overrideValues, reconcile },
    // Which file is an object's model can change with its folder's contents (a
    // first candidate added, the model renamed), so a change there is a reason
    // to choose again before building. The choice is `builds.choice`: an open
    // object keeps its model while that file exists.
    watch: (dir, onChange) =>
      watchFolder(dir, (paths) => {
        void rescan(ws).then(() => {
          if (current !== ws) return
          const obj = ws.info.objects.find((o) => o.dir === dir)
          if (!obj || !builds.update(obj)) onChange(paths)
        })
      })
  })
  const ws: OpenWorkspace = { info, scan: scanOrder(), kernel, builds, opened: new Set(), shown: null, started: new Map(), builtFrom: new Map(), buildLog: new BuildLog(), history: new History(), meshes: new RecentMeshes() }
  // The window is told when an object's history changed (a build kept, a picture or a star added).
  ws.history.onChange((dir) => {
    const obj = ws.info.objects.find((o) => o.dir === dir)
    if (obj) broadcast('history:changed', obj.id)
  })
  builds.on('build', (state) => {
    if (state.status === 'building' && state.startedAt !== undefined) ws.started.set(state.objectId, state.startedAt)
    // A build that failed is kept in the history too, as a line of it.
    if (state.status === 'failed') keepFailedBuild(ws, state)
    broadcast('object:build', state)
    onBuild?.(state)
    cardsChanged()
  })
  builds.on('scene', ({ objectId, revision, scene, blob, reason, wentBackTo }) => {
    ws.meshes.keep(objectId, revision, { scene, blob })
    // Which build this scene came of: the one started last. A picture of it is no newer than the model was then.
    ws.builtFrom.set(objectId, { revision, startedMs: ws.started.get(objectId) })
    // What it was made from is found and kept (the sources hashed, git read), and a line is added to `builds.jsonl`.
    const obj = ws.info.objects.find((o) => o.id === objectId)
    if (obj) {
      const made = ws.buildLog.record(obj, revision, scene)
      void made.catch(() => {})
      // And the build is kept in the object's history (`.torno/history/`), in the order the builds landed.
      void ws.history.keep(obj, made, scene, causeOfBuild(objectId, ws.started.get(objectId), reason, wentBackTo))
    }
    broadcast('object:scene', { objectId, revision, scene, blob: toArrayBuffer(blob) })
  })
  // Every successful build may have renumbered the faces, moved the surfaces or dropped the parts that
  // marks are on: each mark is checked against it, and every dimension is then measured on it. One
  // check at a time per object; a build that succeeds during one is checked after it, and what was
  // found for the build before is dropped. A check that could not say of every mark, or measure
  // every dimension, is tried again after a while (`retrying`).
  // Only a check someone asked for (a mark placed or reopened) may have the object built again to be answered.
  const reanchor = retrying((objectId, restore) => {
    const store = marks
    if (!store) return Promise.resolve(true)
    const counted = checks.get(objectId) ?? { started: 0, finished: 0 }
    checks.set(objectId, counted)
    counted.started += 1
    // The build it is a check against: the last when it begins. One that succeeds meanwhile is checked after it.
    const revision = builds.scene(objectId)?.revision
    return checkMarks(
      {
        marks: store,
        query: (id, name, args) => builds.query(id, name, args, { restore }),
        // None once the workspace is left: nothing is asked or written for it any more.
        scene: (id) => (current === ws ? builds.scene(id) : undefined)
      },
      objectId
    ).finally(() => {
      counted.finished += 1
      if (current === ws) onMarksChecked?.(objectId, revision)
    })
  })
  builds.on('scene', ({ objectId }) => reanchor(objectId))
  ws.reanchor = reanchor
  // And every alignment of its scans: whether the model is still under the points it was tied to, and whether
  // torno spreads the layout's parts as it did then. Found and said, never moved or fitted again.
  // A check that could not say is tried again after a while, three times (`retrying`), without ever having the
  // object built again; what it leaves unsaid is
  // not silence: an alignment with no check of the last build says "not checked against rN" wherever it is
  // reported (`standingOf`), and is checked again at the next build, or when the scans are next asked for.
  const nearest: AlignCheckDeps['nearest'] = async (id, layout, anchors: AskedAnchor[]) => nearestReply(await builds.query(id, 'nearest', { layout, anchors }), anchors)
  ws.nearest = nearest
  // A check by itself (after a build, every 30 s, when the scans are listed) never has the object built again:
  // a kernel that let the build go says so, that is said of the alignment, and the next build is waited for.
  // The scans' store is looked up at each run, as the marks' is above: a workspace opened before `registerIpc`
  // was given the scans has its alignments checked once it has been.
  let checking: { of: ScanStore; ask: Retrying } | null = null
  let ended = false
  const alignChecks: Retrying = Object.assign(
    (objectId: string, restore?: boolean): void => {
      const store = scans
      if (!store || ended) return
      if (checking?.of !== store) {
        checking?.ask.cancel()
        checking = { of: store, ask: checkingAlignments({ scans: store, scene: (id) => (current === ws ? builds.scene(id) : undefined), query: (id, name, args, opts) => builds.query(id, name, args, opts) }) }
      }
      checking.ask(objectId, restore)
    },
    {
      cancel(): void {
        ended = true
        checking?.ask.cancel()
      }
    }
  )
  builds.on('scene', ({ objectId }) => alignChecks(objectId))
  ws.alignChecks = alignChecks
  // Three quick retries are not the end of it: for as long as an alignment of an open object was not checked
  // against its last build, the check is asked for again every 30 s, and whenever its scans are listed.
  ws.stopChecking = keepChecking(
    () => [...ws.opened],
    async (objectId) => {
      if (current === ws && scans) recheckAlignments(objectId, await scans.list(objectId))
    }
  )
  current = ws
  offered.clear()
  return info
}

/**
 * Scan an open workspace again. Objects that are open keep the model they are
 * built from (`Builds.choice`), so the list says what is on screen. A scan
 * that fails leaves what was known.
 */
/**
 * What made a build, kept with it: the reason `Builds` started it for when that says (the person's `Params`, a Go
 * back), else what the session of the object says of the moment the build began (`Sessions.causeOf`: the agent after
 * its turn's first edit, the person otherwise).
 */
function causeOfBuild(objectId: string, startedMs: number | undefined, reason: BuildReason | undefined, wentBackTo: string | undefined): KeptCause {
  return keptCause(reason, wentBackTo, () => sessions?.causeOf(objectId, startedMs ?? 0) ?? { cause: 'person' })
}

/**
 * The build of an object failed: it is kept in the history as a line (`History.keepFailed`), with the sources as
 * `BuildLog` hashes them (those of the last good build's `uses`). Not one the kernel's stopping or a cancel made: no
 * sources failed there.
 */
function keepFailedBuild(ws: OpenWorkspace, state: BuildState): void {
  const { error } = state
  if (!error || error.kernelStderr || error.kind === 'cancelled' || error.kind === 'no_model') return
  const obj = ws.info.objects.find((o) => o.id === state.objectId)
  if (!obj) return
  const startedMs = ws.started.get(state.objectId)
  void sourcesHash(obj.dir, ws.builds.scene(obj.id)?.scene.uses).then(
    (sources) => ws.history.keepFailed(obj, { run: ws.buildLog.run, revision: state.revision, sources, ...(state.seconds !== undefined ? { seconds: state.seconds } : {}) }, errorLine(error), causeOfBuild(obj.id, startedMs, state.reason, state.wentBackTo)),
    () => null
  )
}

async function rescan(ws: OpenWorkspace): Promise<void> {
  const newest = ws.scan()
  const scanned = await scanWorkspace(ws.info.root).catch(() => null)
  if (scanned && current === ws && newest()) {
    ws.info = { ...scanned, objects: scanned.objects.map((o) => ws.builds.choice(o)), ...(ws.info.example ? { example: true as const } : {}) }
    cardsChanged()
  }
}

export async function closeWorkspace(): Promise<void> {
  const ws = current
  if (!ws) return
  current = null
  readiness?.closed()
  offered.clear()
  forgetViews()
  forgetSceneFiles()
  forgetParamFiles()
  forgetExportScans()
  // A check of its marks that failed is not tried again: its timers would outlive it.
  ws.reanchor?.cancel()
  ws.alignChecks?.cancel()
  ws.stopChecking?.()
  checks.clear()
  // The next workspace may have an object of the same name, or this folder may change while it is closed.
  marks?.forget()
  // And its scans: an import that is still running is stopped by whoever runs it, who is told next.
  scans?.forget()
  onWorkspaceClosed?.()
  // Not waited for: an agent that ignores the hangup is killed two seconds later.
  // And the conversations of those that have ended are let go of.
  void sessions?.stopAll().then(() => sessions?.forgetEnded())
  for (const id of ws.opened) ws.builds.close(id)
  await ws.kernel.dispose()
}

function requireWorkspace(): OpenWorkspace {
  if (!current) throw new Error('no workspace is open')
  return current
}

/** The open workspace as of the last scan of it, or null when none is open. */
export function openWorkspaceInfo(): WorkspaceInfo | null {
  return current?.info ?? null
}

/** An object of the open workspace as of the last scan. The renderer and the agent name objects, never folders. */
export function findObject(id: string): ObjectInfo | undefined {
  return current?.info.objects.find((o) => o.id === id)
}

/** The object the window shows, which is the one its pictures are of. */
export function openObjectId(): string | null {
  return current?.shown ?? null
}

/** Where the build of an object stands, once the object has been opened. */
export function buildState(id: string): BuildState | undefined {
  return current?.builds.state(id)
}

/** The build "before this prompt" of an object, for Go back: the object and the id of the entry, or why there is none. */
async function goBackTarget(objectId: string, prompt: string): Promise<{ obj: ObjectInfo; to: string } | { refused: string }> {
  const obj = findObject(objectId)
  if (!obj || !current) return { refused: 'That project is not open.' }
  const revision = sessions?.startedFrom(prompt)
  const found = entryBefore(await readHistory(obj.dir), prompt, revision === undefined ? undefined : { run: current.buildLog.run, revision }, await readHistoryDrawnGone(obj.dir))
  return 'refused' in found ? found : { obj, to: found.id }
}

/** How long a tool waits for the builds that just landed to be written into the history. */
const HISTORY_WAIT_MS = 2000

/** The builds kept of an object (`.torno/history/`), oldest first, once the ones that just landed are written, with the run of this torno. */
export async function historyOf(id: string): Promise<{ run: string; entries: HistoryEntry[] } | null> {
  const ws = current
  const obj = findObject(id)
  if (!ws || !obj) return null
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, HISTORY_WAIT_MS)
  })
  await Promise.race([ws.history.settled(), late])
  clearTimeout(timer)
  return { run: ws.buildLog.run, entries: await readHistory(obj.dir) }
}

/** The scene a kept build left (without its mesh). */
export async function historySceneOf(id: string, historyId: string): Promise<Scene | null> {
  const obj = findObject(id)
  return obj ? readHistoryScene(obj.dir, historyId) : null
}

/** What the person's dimensions said of build `revision` of an object when it was last checked: kept with its entry in the history. */
export function keepDimensions(id: string, revision: number | undefined, verdicts: ReadonlyMap<string, Verdict> | undefined): void {
  const obj = findObject(id)
  if (!current || !obj || revision === undefined || !verdicts) return
  const counts = { pass: 0, fail: 0, none: 0 }
  for (const v of verdicts.values()) counts[v] += 1
  void current.history.dimensions(obj, current.buildLog.run, revision, counts)
}

/** The last successful build of an object. */
/** The last two successful builds of an object, the older first (`diff`). */
export function keptScenes(id: string): Array<{ revision: number; scene: Scene }> {
  return current?.builds.scenes(id) ?? []
}

/** What the build with this revision, made in this run, was made from: its sources' hash, the commit, whether files differed from it. */
export function buildIdentity(id: string, revision: number): BuildIdentity | undefined {
  return current?.buildLog.identity(id, revision)
}

export function lastScene(id: string): { revision: number; scene: Scene } | undefined {
  return current?.builds.scene(id)
}

/**
 * A mark as it is kept when it is placed (`asPlaced`): a mark that is no mark
 * is handed on as it came, for the store to refuse.
 */
export function placedMark<M extends NewMark>(mark: M, objectId: string): M {
  const whole = typeof mark === 'object' && mark !== null && typeof mark.layout === 'string'
  try {
    return whole ? asPlaced(mark, lastScene(objectId)) : mark
  } catch {
    return mark
  }
}

/**
 * Ask the kernel about the last successful build of an open object (`Builds.query`): the object is
 * built again when the kernel no longer holds it. Rejects with a KernelError, also when no workspace is open.
 */
export function queryObject<T = unknown>(id: string, name: string, args: object): Promise<T> {
  if (!current) return Promise.reject(new KernelError('no_build', 'no workspace is open'))
  return current.builds.query<T>(id, name, args)
}

/** The open workspace's trial of an object: its model built with other values of its `Params` in a worker the kernel throws away. */
export function trialObject(id: string, set: Record<string, number | boolean | string>, queries: Array<{ name: string; args: object }>): Promise<TrialResult> {
  if (!current) return Promise.reject(new KernelError('no_build', 'no workspace is open'))
  return current.builds.trial(id, set, queries)
}

/**
 * `onWorkspaceChosen` is told the root of every workspace the person opens
 * from the window, so that it can be opened again at the next start.
 * `sessions` backs the session pane; without it there are no sessions.
 * `marks` backs the marks of the objects; without it there are none.
 * `onBuild` is told where the build of an object stands, each time that changes.
 * `onMarksChecked` is told that a check of an object's marks against a build, and the measuring of its dimensions on
 * it, ended (as far as it could go), and of which build.
 * `pickFolder` answers "Open folder" in place of the dialog, which tests must
 * never open; `pickFile` answers "Import scan" likewise, and `pickPhotos` "Add photos".
 * `scans` backs the scans of the objects; without it there are none.
 * `pickSave` answers the save dialog of an export likewise: it is given the path the dialog would have
 * opened on, and answers with the path to write, or null.
 */
export function registerIpc(
  opts: {
    onWorkspaceChosen?: (root: string) => void
    sessions?: Sessions
    /** The questions of the agents that wait for the person. */
    asks?: Asks
    /** The models the last chat's CLI offered, for a session not started yet. Absent: Claude Code's aliases. */
    knownModels?: KnownModels
    /** The person's printers and materials (`profiles.json` beside the config file). */
    userProfiles?: UserProfiles
    /** The profile of an object changed: its state file is written anew. */
    onProfile?: (objectId: string) => void
    marks?: MarkStore
    /** The boards of the projects: the window reads and changes them through here, and is told when one changes. */
    board?: BoardStore
    /** The views saved of a project (its scene file's): only one of them is pinned to the board. */
    views?: (objectId: string) => Promise<SavedView[]>
    onBuild?: (state: BuildState) => void
    onMarksChecked?: (objectId: string, revision: number | undefined) => void
    /** The window gave the scene file of an object to save. */
    onSceneFile?: (objectId: string) => void
    /** The open workspace was left: object ids mean nothing any more. */
    onWorkspaceClosed?: () => void
    /** The window opened a project: the cards of what it has are brought up to date. */
    onObjectOpened?: (objectId: string) => void
    /** What torno needs and whether it is there: Claude Code, uv, the kernel's Python environment. */
    ready?: ReadyKeeper
    /** The folders opened lately, each with whether it is still there. */
    recent?: () => Promise<RecentFolder[]>
    /** Takes a folder off that list, and answers with the list. */
    forget?: (root: string) => Promise<RecentFolder[]>
    /** Makes the copy of the example and answers with its folder; absent where there is no example. */
    example?: () => Promise<string | null>
    /** Stands in for the folder dialog: the folder to open, or null for none. */
    pickFolder?: () => Promise<string | null>
    scans?: ScanStore
    /** Stands in for the file dialog: the file to import, or null for none. */
    pickFile?: () => Promise<string | null>
    /** Stands in for the photo dialog of a new object: the files to add, or [] for none. */
    pickPhotos?: () => Promise<string[]>
    pickStep?: () => Promise<string | null>
    pickPdf?: () => Promise<string | null>
    /** Stands in for the save dialog of an export: given the path it would open on, the path to write, or null for none. */
    pickSave?: (defaultPath: string) => Promise<string | null>
    /** Stands in for the question asked before an export replaces a file the save dialog did not ask about: yes or no. */
    confirmReplace?: (path: string) => Promise<boolean>
    /** Stands in for having the system open a file an export wrote (a 3MF, in the person's slicer). */
    openFile?: (path: string) => Promise<void>
    /** The instruction files Claude Code reads for an object, as the session pane lists them. */
    instructions?: InstructionList
    /** Stands in for showing a file in its folder (`shell.showItemInFolder`), which tests must never do. */
    revealFile?: (path: string) => void
    /** Stands in for opening a link of a card in the person's browser (`shell.openExternal`), which tests must never do. */
    openExternal?: (url: string) => void | Promise<void>
  } = {}
): void {
  sessions = opts.sessions ?? null
  sessions?.on('data', (m) => broadcast('session:data', m))
  sessions?.on('status', (m) => broadcast('session:status', m))
  sessions?.on('status', () => cardsChanged())
  sessions?.on('item', (m) => broadcast('chat:item', { sessionId: m.sessionId, item: m.item, seq: m.seq }))
  sessions?.on('meta', (m) => broadcast('chat:meta', { sessionId: m.sessionId, meta: m.meta, seq: m.seq }))
  sessions?.on('capabilities', (m) => {
    broadcast('chat:capabilities', { sessionId: m.sessionId, commands: m.commands, models: m.models, seq: m.seq })
    // What a session can be started on next, before it says its own.
    void opts.knownModels?.heard(m.models)
  })
  const requireSessions = (): Sessions => {
    if (!sessions) throw new Error('sessions are not available')
    return sessions
  }

  asks = opts.asks ?? null
  onBuild = opts.onBuild ?? null
  onMarksChecked = opts.onMarksChecked ?? null
  onSceneFile = opts.onSceneFile ?? null
  onWorkspaceClosed = opts.onWorkspaceClosed ?? null
  onObjectOpened = opts.onObjectOpened ?? null
  readiness = opts.ready ?? null
  readiness?.on('changed', (m) => broadcast('ready:changed', m))
  marks = opts.marks ?? null
  marks?.on('changed', (m) => broadcast('marks:changed', { ...m, marks: requireMarks().shown(m.objectId, m.marks) }))
  marks?.on('problem', (m) => broadcast('marks:problem', m))
  marks?.on('changed', () => cardsChanged())
  // A mark added, or reopened, has not been checked against the build there is: no build is on its way to do it.
  if (marks) followMarks(marks, (objectId, restore) => current?.reanchor?.(objectId, restore))
  const requireMarks = (): MarkStore => {
    if (!marks) throw new Error('marks are not available')
    return marks
  }

  // The board of a project: what the person does to it in the window, and the window told of every change, whoever made it.
  const boardStore = opts.board
  boardStore?.on('changed', (m) => broadcast('board:changed', m))
  boardStore?.on('problem', (m) => broadcast('board:problem', m))
  const boards = boardStore
    ? boardHandlers({
        board: boardStore,
        object: findObject,
        views: async (objectId) => (await opts.views?.(objectId)) ?? [],
        // The brief in the person's own program, a photo in its folder: tests stand in for both, as for an export.
        show: async (how, path) => {
          if (how === 'reveal') return void (opts.revealFile ? opts.revealFile(path) : shell.showItemInFolder(path))
          if (opts.openFile) return void (await opts.openFile(path))
          const failed = await shell.openPath(path)
          if (failed) throw new Refusal(`It could not be opened: ${failed}`)
        },
        openExternal: async (url) => (opts.openExternal ? opts.openExternal(url) : shell.openExternal(url)),
        pinBuild: (objectId, historyId) => pinBuild({ board: boardStore, object: findObject, history: requireWorkspace().history }, objectId, historyId) })
    : undefined
  const requireBoards = (): NonNullable<typeof boards> => {
    if (!boards) throw new Error('boards are not available')
    return boards
  }

  const chosen = (info: WorkspaceInfo): WorkspaceInfo => {
    opts.onWorkspaceChosen?.(info.root)
    return info
  }

  handle('workspace:current', () => current?.info ?? null)

  handle('workspace:pick', async (event) => {
    if (opts.pickFolder) {
      const folder = await opts.pickFolder()
      return folder === null ? null : chosen(await openWorkspace(folder))
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: 'Open folder', properties: ['openDirectory', 'createDirectory'] }
    // Where objects usually live, suggested until a workspace has been chosen.
    const usual = join(homedir(), 'objects')
    if (current) options.defaultPath = current.info.root
    else if (existsSync(usual)) options.defaultPath = usual
    const picked = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    if (picked.canceled || picked.filePaths.length === 0) return null
    return chosen(await openWorkspace(picked.filePaths[0]))
  })

  handle('workspace:open', async (_event, root: string) => chosen(await openWorkspace(root)))

  handle('workspace:recent', async () => (await opts.recent?.()) ?? [])
  handle('workspace:forget', async (_event, root: string) => (await opts.forget?.(String(root))) ?? [])
  handle('workspace:hasExample', () => opts.example !== undefined)
  // Not `chosen`: a copy in the temporary folder is not what to open at the next start, nor a folder opened lately.
  handle('workspace:openExample', async () => {
    const folder = await opts.example?.()
    if (!folder) throw new Error('this torno has no example beside it')
    return openWorkspace(folder, { example: true })
  })
  // "Keep this as a folder": the open example copied, whole, to a new folder at a path the person chooses in the save dialog
  // (under test `pickSave`), which is then opened and remembered like any folder they chose. Null when they chose none.
  handle('workspace:keepExample', async (event): Promise<WorkspaceInfo | null> => {
    const ws = requireWorkspace()
    // The copy to keep is the open one, which main made: never a path from the window.
    if (!ws.info.example) throw new Refusal('Only the example can be kept this way.')
    const usual = join(homedir(), 'objects')
    const defaultPath = join(existsSync(usual) ? usual : homedir(), 'torno-example')
    let picked: string | null
    if (opts.pickSave) picked = await opts.pickSave(defaultPath)
    else {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.SaveDialogOptions = { title: 'Keep this as a folder', buttonLabel: 'Keep', defaultPath, properties: ['createDirectory'] }
      const answer = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options))
      picked = answer.canceled || !answer.filePath ? null : answer.filePath
    }
    if (picked === null) return null
    try {
      await keepExample(ws.info.root, picked)
    } catch (e) {
      throw new Refusal(e instanceof Error ? e.message : String(e))
    }
    return chosen(await openWorkspace(picked))
  })

  handle('ready:check', async (_event, fresh: unknown) => {
    if (!readiness) throw new Error('readiness is not available')
    return readiness.get(fresh === true)
  })
  handle('ready:make', async () => {
    if (!readiness) throw new Error('readiness is not available')
    await readiness.makeNow()
  })

  handle('workspace:versions', async () => {
    const ws = requireWorkspace()
    return (await ws.kernel.ready).versions
  })

  handle('object:open', async (event, id: string): Promise<BuildState> => {
    const ws = requireWorkspace()
    // From here on the window shows this object, whatever comes of building it.
    ws.shown = id
    ws.builds.show(id)
    // Scanned afresh: the agent may have created the folder a moment ago.
    const newest = ws.scan()
    const scanned = await scanWorkspace(ws.info.root)
    // The workspace may have been closed or replaced during the scan; its kernel is then gone.
    if (current !== ws) throw new Error(`the workspace ${ws.info.root} was closed`)
    if (newest()) ws.info = { ...scanned, objects: scanned.objects.map((o) => ws.builds.choice(o)), ...(ws.info.example ? { example: true as const } : {}) }
    cardsChanged()
    const obj = ws.info.objects.find((o) => o.id === id)
    if (!obj) throw new Error(`no project named ${id} in ${ws.info.root}`)
    const state = ws.builds.open(obj)
    ws.opened.add(id)
    onObjectOpened?.(id)
    // A renderer that subscribes after a build has missed its scene event.
    const last = ws.builds.scene(id)
    if (last) event.sender.send('object:scene', { objectId: id, ...last, blob: toArrayBuffer(last.blob) })
    return state
  })

  handle('object:rebuild', (_event, id: string) => {
    requireWorkspace().builds.rebuild(id)
  })

  handle('object:setParam', async (_event, id: string, name: string, value: unknown) => {
    const ws = requireWorkspace()
    const obj = ws.info.objects.find((o) => o.id === id)
    if (!obj) throw new Refusal(`no project named ${id}`)
    const field = ws.builds.scene(id)?.scene.params?.find((p) => p.name === name)
    if (!field) throw new Refusal(`${name} is not a field of the model's Params in the last build`)
    if (!field.editable) throw new Refusal(`${name} cannot be tried here: only a number, a flag or a choice with a literal default can`)
    await setOverride(obj.dir, name, value, field.default)
    ws.builds.changed(id, [], 'params')
  })

  handle('object:resetParams', async (_event, id: string, name?: string) => {
    const ws = requireWorkspace()
    const obj = ws.info.objects.find((o) => o.id === id)
    if (!obj) throw new Refusal(`no project named ${id}`)
    await resetOverrides(obj.dir, name)
    ws.builds.changed(id, [], 'params')
  })

  handle('object:sceneFile', (_event, id: string): Promise<SceneFile> => {
    const obj = findObject(id)
    return obj ? loadSceneFile(obj.dir) : Promise.resolve({ layers: {} })
  })

  ipcMain.on('object:saveSceneFile', (_event, id: string, file: SceneFile) => {
    const obj = findObject(id)
    if (!obj) return
    saveSceneFile(obj.dir, file).catch((e) => console.error(`cannot save the scene file of ${id}: ${e.message}`))
    // Known to main from now (`sceneFileNow`), written or not: what is told of the saved views follows.
    onSceneFile?.(id)
  })

  handle('session:current', async (_event, objectId: string) => {
    const obj = findObject(objectId)
    const running = sessions?.current(objectId) ?? null
    // The view its next session starts in: the one chosen for it, whatever the session there now is in.
    const choice: { view: AgentView; note?: string } = obj ? await readChoice(obj.dir) : { view: 'chat' }
    return {
      running: running && { sessionId: running.sessionId, status: running.status, view: running.view },
      ...(!running && sessions?.endedChat(objectId) ? { ended: { sessionId: sessions.endedChat(objectId)! } } : {}),
      resumable: obj !== undefined && sessions !== null && sessions.resumable(obj),
      view: choice.view,
      ...(choice.note ? { note: choice.note } : {})
    }
  })

  handle('session:start', async (_event, objectId: string, opts?: { resume?: boolean; cols?: number; rows?: number; skills?: false }) => {
    const obj = findObject(objectId)
    if (!obj) throw new Error(`no project named ${objectId} in the open workspace`)
    return requireSessions().start(obj, { resume: opts?.resume === true, cols: opts?.cols, rows: opts?.rows, ...(opts?.skills === false ? { skills: false as const } : {}) })
  })

  // The person said to start the chat in a folder that has Claude Code settings of its own (the question `session:start` refused with).
  handle('session:trust', async (_event, objectId: string) => {
    const obj = findObject(objectId)
    if (!obj) throw new Error(`no project named ${objectId} in the open workspace`)
    await requireSessions().trust(obj)
  })

  // The instruction files Claude Code reads for an object (`main/instructions.ts`): paths and sizes, never their text. The list is kept, so that a row is named by its place in it.
  handle('session:instructions', async (_event, objectId: string) => {
    const obj = findObject(String(objectId))
    if (!obj || !opts.instructions) return []
    return opts.instructions.find(obj.id, obj.dir)
  })

  // A row of that list shown in its folder: never opened, never run, and never a path from the window.
  handle('session:revealInstruction', async (_event, objectId: string, index: number) => {
    // An object of the open workspace only, and a row of the list main kept for it.
    const obj = findObject(String(objectId))
    const file = obj ? opts.instructions?.at(obj.id, index) : null
    if (!file) throw new Refusal('That file is no longer in the list')
    if (opts.revealFile) opts.revealFile(file.path)
    else shell.showItemInFolder(file.path)
  })

  // The view is of the sessions to come: the one that runs is of the view it was started in, and is ended first.
  handle('session:chooseView', async (_event, objectId: string, view: AgentView) => {
    const obj = findObject(String(objectId))
    if (!obj) throw new Error(`no project named ${objectId} in the open workspace`)
    if (view !== 'chat' && view !== 'terminal') throw new Refusal(`no view named ${String(view).slice(0, 40)}`)
    if (sessions?.current(obj.id) || sessions?.isStarting(obj.id)) throw new Refusal('End the session first')
    await writeChoice(obj.dir, view)
  })

  handle('session:stop', (_event, sessionId: string) => sessions?.stop(String(sessionId)))

  // What a window types or inserts goes only to a session the manager has in a folder of the open
  // workspace: the window names a session, and is not taken at its word.
  const ofThisWorkspace = (sessionId: string): boolean => sessions !== null && sessionOfWorkspace(sessions.objectOf(sessionId), current?.info.root)

  ipcMain.on('session:write', (_event, sessionId: string, data: string) => {
    if (typeof data === 'string' && ofThisWorkspace(String(sessionId))) sessions?.write(String(sessionId), data)
  })

  ipcMain.on('session:insert', (_event, sessionId: string, text: string) => {
    if (typeof text === 'string' && ofThisWorkspace(String(sessionId))) sessions?.insert(String(sessionId), text)
  })

  ipcMain.on('session:resize', (_event, sessionId: string, cols: number, rows: number) => {
    sessions?.resize(String(sessionId), cols, rows)
  })

  // The conversation of a chat session. The window names a session and is not taken at its word: it must be one of
  // the open workspace. A transcript is readable after its session has ended; nothing else is allowed then.
  handle('chat:history', (_event, sessionId: string) => {
    const history = sessions && sessionOfWorkspace(sessions.chatOf(String(sessionId)), current?.info.root) ? sessions.history(String(sessionId)) : undefined
    if (!history) throw new Error('There is no such conversation')
    return history
  })

  // What the pane with no session shows of the conversation it would go on with: read from `.torno/chat/`, nothing made.
  handle('chat:lastConversation', async (_event, objectId: string) => {
    const obj = findObject(String(objectId))
    const stored = obj ? storedConversation(obj.dir) : null
    return obj && stored !== null ? lastConversation(obj.dir, stored) : null
  })

  // The prompts of every conversation of an object, numbered across them (`main/sessions/prompts.ts`), and one earlier conversation to read: from `.torno/chat/`, read only.
  handle('chat:prompts', async (_event, objectId: string) => {
    const obj = findObject(String(objectId))
    return obj ? listPrompts(obj.dir) : []
  })
  handle('chat:conversation', async (_event, objectId: string, conversationId: string) => {
    const obj = findObject(String(objectId))
    return obj ? readLog(obj.dir, String(conversationId)) : []
  })

  handle('chat:reference', async (_event, sessionId: string, file: string) => {
    const chat = sessions?.chatOf(String(sessionId))
    if (!chat || !sessionOfWorkspace(chat, current?.info.root)) return null
    return readReference(chat.dir, String(file))
  })

  handle('chat:changes', async (_event, sessionId: string, turnId: string) => {
    const chat = sessions?.chatOf(String(sessionId))
    if (!chat || !sessionOfWorkspace(chat, current?.info.root) || typeof turnId !== 'string') return null
    return (await sessions?.changesOf(String(sessionId), turnId)) ?? null
  })

  handle('chat:undo', async (_event, sessionId: string, turnId: string) => {
    if (!ofThisWorkspace(String(sessionId))) throw new Refusal('This session has ended')
    if (typeof turnId !== 'string') throw new Refusal('Nothing to undo')
    await requireSessions().undoTurn(String(sessionId), turnId)
  })

  handle('chat:send', async (_event, sessionId: string, prompt: { text?: unknown; attachView?: unknown; attachedView?: unknown; board?: unknown }) => {
    if (!ofThisWorkspace(String(sessionId))) throw new Refusal('This session has ended')
    if (typeof prompt?.text !== 'string' || prompt.text.length > MAX_PROMPT_CHARS) throw new Refusal('Nothing to send')
    // The picture the window showed for "Attach view": the sessions check it as any picture for the agent.
    if (prompt.attachedView !== undefined && !(prompt.attachedView instanceof Uint8Array)) throw new Refusal('The picture of the view is not one')
    // The part of the board to go with it: ids, or all. What each says is read when it is sent, not taken from the window.
    const board = prompt.board === undefined ? undefined : boardAttachOf(prompt.board)
    if (typeof board === 'string') throw new Refusal(board)
    await requireSessions().send(String(sessionId), { text: prompt.text, attachView: prompt.attachView === true, ...(prompt.attachedView ? { attachedView: prompt.attachedView } : {}), ...(board ? { board } : {}) })
  })

  // The questions the agent put to the person (`ask`): the list for a window that has just begun, and the answer.
  handle('asks:list', () => asks?.open() ?? [])
  ipcMain.on('asks:answer', (_event, id: number, answer: unknown) => {
    if (typeof id === 'number') asks?.answer(id, answer)
  })

  ipcMain.on('chat:answer', (_event, sessionId: string, requestId: string, answer: ChatAnswer) => {
    if (typeof requestId === 'string' && ofThisWorkspace(String(sessionId))) sessions?.respond(String(sessionId), requestId, answer)
  })

  handle('chat:interrupt', async (_event, sessionId: string) => {
    if (!ofThisWorkspace(String(sessionId))) throw new Refusal('This session has ended')
    await requireSessions().control(String(sessionId), { subtype: 'interrupt' })
  })

  // For the session alone: the CLI is told, and the person's own settings are not touched.
  handle('chat:setModel', async (_event, sessionId: string, model: string) => {
    if (!ofThisWorkspace(String(sessionId))) throw new Refusal('This session has ended')
    if (typeof model !== 'string' || !MODEL_NAME.test(model)) throw new Refusal('Not a model name')
    await requireSessions().control(String(sessionId), { subtype: 'set_model', model })
  })
  handle('chat:setEffort', async (_event, sessionId: string, effort: string) => {
    if (!ofThisWorkspace(String(sessionId))) throw new Refusal('This session has ended')
    if (!isEffort(effort)) throw new Refusal(`Not an effort: Claude Code takes ${EFFORTS.join(', ')}`)
    await requireSessions().setEffort(String(sessionId), effort)
  })
  handle('chat:setMode', async (_event, sessionId: string, mode: string) => {
    if (!ofThisWorkspace(String(sessionId))) throw new Refusal('This session has ended')
    if (!isMode(mode)) throw new Refusal(`Not a mode: torno offers ${MODES.join(', ')}`)
    await requireSessions().setMode(String(sessionId), mode)
  })
  handle('chat:models', () => opts.knownModels?.list() ?? [...MODEL_ALIASES])

  // The printer and material of a project (`.torno/profile.json`), and the person's own to choose from.
  const requireProfiles = (): UserProfiles => {
    if (!opts.userProfiles) throw new Refusal('Printers and materials are not kept here')
    return opts.userProfiles
  }
  handle('profile:choices', () => opts.userProfiles?.list() ?? { printers: [], materials: [] })
  handle('profile:savePrinter', (_event, printer: unknown) => requireProfiles().savePrinter(printer).catch((e: Error) => Promise.reject(new Refusal(e.message))))
  handle('profile:saveMaterial', (_event, material: unknown) => requireProfiles().saveMaterial(material).catch((e: Error) => Promise.reject(new Refusal(e.message))))
  handle('profile:get', (_event, objectId: string): Profile | null => {
    const obj = findObject(String(objectId))
    return (obj ? projectProfile(obj.dir) : undefined) ?? null
  })
  handle('profile:set', async (_event, objectId: string, profile: unknown): Promise<Profile | null> => {
    const obj = findObject(String(objectId))
    if (!obj) throw new Refusal('That project is not open')
    const kept = await setProjectProfile(obj.dir, profileOf(profile))
    opts.onProfile?.(obj.id)
    return kept ?? null
  })

  // The renderer names the object; the store finds its folder, and rejects an object the workspace does not have.
  handle('marks:list', async (_event, objectId: string) => requireMarks().shown(String(objectId), await requireMarks().list(String(objectId))))
  // A mark made in the window is the person's. The agent's come through its tools, which call the store themselves.
  // What only main says of a mark is said here: how far its part is spread on the build it was placed on.
  // A dimension is measured as it is kept (`addDimension`): its value is the kernel's, never the window's.
  const measuring = (store: MarkStore) => ({ marks: store, query: queryObject, scene: lastScene })
  handle('marks:add', (_event, objectId: string, mark: NewMark) => {
    const placed = placedMark({ ...mark, author: 'user' }, String(objectId))
    return placed.kind === 'dimension' ? addDimension(measuring(requireMarks()), String(objectId), placed) : requireMarks().add(String(objectId), placed)
  })
  // Whoever resolves a mark from the window is the person.
  handle('marks:update', async (_event, objectId: string, id: string, patch: MarkPatch) => {
    const store = requireMarks()
    const changed = await store.update(String(objectId), String(id), patch, 'user')
    // What a dimension should measure was changed: its verdict is already judged anew from the value it has.
    // One with no value of the last build is measured again, where that can be done now (`dueAfterEdit`).
    if (dueAfterEdit(patch, changed, lastScene(String(objectId))?.revision)) void remeasure(measuring(store), String(objectId), changed)
    return changed
  })
  // Only the person acknowledges ("OK all"): all of them in one write, or none.
  handle('marks:acknowledge', (_event, objectId: string, ids: string[]) => requireMarks().acknowledge(String(objectId), Array.isArray(ids) ? ids.map(String) : []))
  // With a region goes the mask that held its triangles.
  const regions = (): RegionDeps => ({ marks: requireMarks(), scans: requireScans() })
  handle('marks:remove', (_event, objectId: string, id: string) => (scans ? removeMark(regions(), String(objectId), String(id)) : requireMarks().remove(String(objectId), String(id))))
  // The last mark deleted, whole and with its number; once.
  handle('marks:restore', (_event, objectId: string, id: string) => restoreMark(regions(), String(objectId), String(id)))
  // What the person painted on a scan: main works out what it is from the mesh, and writes its triangles beside it.
  handle('marks:addRegion', (_event, objectId: string, region: NewRegion) => addRegion(regions(), String(objectId), region))
  // A region painted again: the same mark, of the triangles sent; main writes them as a new mask and says the numbers anew.
  handle('marks:repaintRegion', (_event, objectId: string, id: string, bits: Uint8Array) => repaintRegion(regions(), String(objectId), String(id), bits))
  handle('marks:replace', async (_event, objectId: string, id: string, placed: Replacement) => {
    const store = requireMarks()
    const layout = (await store.list(String(objectId))).find((m) => m.id === String(id))?.layout
    return store.replace(String(objectId), String(id), layout === undefined ? placed : asReplaced(placed, layout, lastScene(String(objectId))))
  })
  handle('board:read', (_event, objectId: string) => requireBoards().read(objectId))
  handle('board:change', (_event, objectId: string, change: PersonChange) => requireBoards().change(objectId, change))
  handle('board:picture', (_event, objectId: string, name: string) => requireBoards().picture(objectId, name))
  handle('board:brief', (_event, objectId: string) => requireBoards().brief(objectId))
  handle('board:reference', (_event, objectId: string, file: string) => requireBoards().reference(objectId, file))
  handle('board:addPicture', (_event, objectId: string, bytes: Uint8Array) => requireBoards().addPicture(objectId, bytes))
  handle('board:pin', (_event, objectId: string, what: PinWhat) => requireBoards().pin(objectId, what))
  handle('board:open', (_event, objectId: string, what: BoardOpen) => requireBoards().open(objectId, what))
  handle('board:openLink', (_event, objectId: string, cardId: string) => requireBoards().openLink(objectId, cardId))
  handle('board:problem', (_event, objectId: string) => requireBoards().problem(objectId))
  handle('board:dismissProblem', (_event, objectId: string) => requireBoards().dismissProblem(objectId))

  // A view note: main checks what the window sends, names and writes its pictures, and says the rest of the mark (its anchor placed, as a mark's).
  const notes = () => noteHandlers({ marks: requireMarks(), object: findObject, placed: placedMark })
  handle('notes:make', (_event, draft: NoteDraft) => notes().make(draft))
  handle('notes:edit', (_event, objectId: string, id: string, patch: NoteEdit) => notes().edit(objectId, id, patch))
  handle('notes:picture', (_event, objectId: string, id: string, which: 'ink' | 'plain' | number) => notes().picture(objectId, id, which))
  handle('marks:problem', (_event, objectId: string) => requireMarks().problem(String(objectId)))
  handle('marks:dismissProblem', (_event, objectId: string) => requireMarks().dismissProblem(String(objectId)))

  scans = opts.scans ?? null
  scans?.on('changed', (m) => broadcast('scans:changed', m))
  scans?.on('progress', (m) => broadcast('scans:progress', m))
  scans?.on('problem', (m) => broadcast('scans:problem', m))
  const requireScans = (): ScanStore => {
    if (!scans) throw new Error('scans are not available')
    return scans
  }

  /** Has the alignments of an object's scans checked against its last build once something was done to them. */
  const checked = <T>(objectId: string, kept: Promise<T>): Promise<T> =>
    kept.then((info) => {
      // The person did this: the object may be built again for the check.
      current?.alignChecks?.(objectId, true)
      return info
    })
  // As for the marks: the renderer names the object, and the store finds its folder.
  handle('scans:list', async (_event, objectId: string) => {
    const listed = await requireScans().list(String(objectId))
    // The window asks: an alignment that was not checked against the last build is asked about again.
    recheckAlignments(String(objectId), listed)
    // And a region whose scan or whose mask was lost while torno was not looking says so.
    if (marks) void tendRegions(regions(), String(objectId)).catch((e) => console.error(`cannot check the regions of ${String(objectId)} against its scans: ${e instanceof Error ? e.message : String(e)}`))
    return listed
  })
  handle('scans:pick', async (event): Promise<string | null> => {
    if (opts.pickFile) return opts.pickFile()
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: 'Import scan', properties: ['openFile'], filters: [{ name: 'Scans', extensions: SCAN_FORMATS.map((format) => format.slice(1)) }] }
    const picked = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]
  })
  handle('objects:pickStep', async (event): Promise<string | null> => {
    if (opts.pickStep) return opts.pickStep()
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: 'Add a bought part', properties: ['openFile'], filters: [{ name: 'STEP files', extensions: STEP_FORMATS.map((format) => format.slice(1)) }] }
    const picked = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]
  })
  handle('objects:pickPdf', async (event): Promise<string | null> => {
    const path = await (async (): Promise<string | null> => {
      if (opts.pickPdf) return opts.pickPdf()
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = { title: 'Add a PDF', properties: ['openFile'], filters: [{ name: 'PDF files', extensions: PDF_FORMATS.map((format) => format.slice(1)) }] }
      const picked = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
      return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]
    })()
    if (path !== null) offered.add([path])
    return path
  })
  handle('objects:pickPhotos', async (event): Promise<string[]> => {
    const paths = await (async (): Promise<string[]> => {
      if (opts.pickPhotos) return opts.pickPhotos()
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = { title: 'Add photos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }
      const picked = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
      return picked.canceled ? [] : picked.filePaths
    })()
    offered.add(paths)
    return paths
  })
  handle('objects:readPhoto', (_event, path: string) => {
    // Only what the dialog gave: a file dropped on the window is read by the window itself.
    if (!offered.has(path)) throw new Refusal('That file was not chosen in this window.')
    return readPhoto(path)
  })
  // The one place torno makes a folder in a workspace (`createObject`). It answers once the listing has the object,
  // as a change in the folder would have it listed.
  handle('objects:create', async (_event, req: CreateRequest) => {
    const ws = current
    if (!ws) throw new Error('No workspace is open.')
    const made = await createObject(req, { root: ws.info.root, objects: ws.info.objects.map((o) => o.id) })
    await rescan(ws)
    if (current !== ws) throw new Error(`${made.objectId} was made, but the workspace was left before it could be opened.`)
    if (!ws.info.objects.some((o) => o.id === made.objectId)) throw new Error(`${made.objectId} was made, but the workspace does not list it.`)
    return made
  })
  // The names in the root, which a new object's name is checked against as `createObject` checks it.
  handle('objects:taken', async () => {
    const ws = current
    if (!ws) throw new Error('No workspace is open.')
    return readdir(ws.info.root)
  })
  // The first half of a new object's life after `objects:create`: its scans imported, its chat started, the prompt sent.
  handle('objects:onboard', (_event, objectId: string, draft: OnboardDraft) => {
    const ws = current
    if (!ws) throw new Error('No workspace is open.')
    return onboardObject(
      {
        object: (id) => ws.info.objects.find((o) => o.id === id),
        running: (id) => sessionRunning(sessions, id),
        importScan: (id, path) => requireScans().import(id, path),
        start: (obj, choice) => requireSessions().start(obj, choice),
        prompt: (sessionId, blocks) => requireSessions().prompt(sessionId, blocks),
        began: (sessionId) => requireSessions().began(sessionId),
        // The first prompt says what is on the board in its own words: its board line counts the cards as told.
        boardTold: (id) => (boardStore ? boardStore.markAllTold(id) : Promise.resolve()),
        scene: (id) => ws.builds.scene(id)?.scene
      },
      String(objectId),
      draft
    )
  })
  // The first prompt of a draft as `objects:onboard` would send it. Nothing is written, imported or started.
  handle('objects:previewPrompt', (_event, name: string, draft: PromptPreviewDraft) => {
    const ws = current
    if (!ws) throw new Error('No workspace is open.')
    return previewPrompt({ object: (id) => ws.info.objects.find((o) => o.id === id), scene: (id) => ws.builds.scene(id)?.scene }, name, draft)
  })
  handle('scans:import', (_event, objectId: string, path: string) => requireScans().import(String(objectId), path))
  // Read again, a scan may be another mesh: what the last build makes of its alignments is asked anew.
  // What was painted on it was painted on the mesh it had: of another mesh, or of the same count from another file, its regions are of nothing.
  handle('scans:reimport', async (_event, objectId: string, id: string) => {
    const read = await checked(String(objectId), requireScans().reimport(String(objectId), String(id)))
    if (read.meshChanged || read.sourceChanged) await marks?.orphanRegions(String(objectId), read.scan.id)
    return read
  })
  // Its triangles are the same and are elsewhere: what its regions say of themselves is worked out again from the mesh it has now.
  handle('scans:convert', (_event, objectId: string, id: string, as: { unit: ScanUnit; up: ScanUp }) =>
    marks ? convertScan(regions(), String(objectId), String(id), as) : requireScans().convert(String(objectId), String(id), as)
  )
  handle('scans:rename', (_event, objectId: string, id: string, name: string) => requireScans().rename(String(objectId), String(id), name))
  // Its regions go on as marks, with their notes, and say that their scan is gone.
  handle('scans:remove', async (_event, objectId: string, id: string) => {
    await requireScans().remove(String(objectId), String(id))
    await marks?.orphanRegions(String(objectId), String(id))
  })
  handle('scans:problem', (_event, objectId: string) => requireScans().problem(String(objectId)))
  handle('scans:dismissProblem', (_event, objectId: string) => requireScans().dismissProblem(String(objectId)))
  // What only main says of an alignment is said here: how the parts of that layout are spread on the last build,
  // when, and which build that is. An alignment is of the build it was fitted on: one made on another than the
  // last is refused, as a dimension placed on another is. Then it is checked against that build, like every other.
  handle('scans:align', (_event, objectId: string, id: string, layout: string, alignment: NewAlignment | null, made?: AlignMade) => {
    if (alignment === null || alignment === undefined) return requireScans().align(String(objectId), String(id), layout, null)
    const last = lastScene(String(objectId))
    const frame = frameOf(last?.scene, layout)
    if (!last || !frame) throw new Refusal(`no build of this project has a layout named ${String(layout)}: there is nothing to align the scan to`)
    const revision = Object(made).revision
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) throw new Refusal('an alignment says which build it was made on')
    if (revision !== last.revision) throw new Refusal(`that alignment was made on r${revision}, the build is r${last.revision}: align again`)
    const moved = tiedToMoved(Object(alignment), frame)
    if (moved.length > 0) throw new Refusal(`torno moved ${moved.join(', ')} for display in ${layout}: align to a part it did not move, or in a layout that places the parts as assembled`)
    const accepted = { rough: Object(made).rough === true, scaled: Object(made).scaled === true }
    return checked(String(objectId), requireScans().align(String(objectId), String(id), layout, { ...Object(alignment), frame, at: new Date().toISOString(), revision }, accepted))
  })
  handle('scans:undoAlign', (_event, objectId: string, id: string, layout: string) => checked(String(objectId), requireScans().undoAlign(String(objectId), String(id), layout)))
  // "Still right": the model as it stands now is what the alignment is held against from here on, and that is asked of the kernel first.
  handle('scans:alignHolds', async (_event, objectId: string, id: string, layout: string) => {
    const ws = requireWorkspace()
    const scan = (await requireScans().list(String(objectId))).find((one) => one.id === String(id))
    const alignment = scan ? alignmentOf(scan, String(layout)) : null
    if (!scan || !alignment) throw new Error(`${String(id)} is not aligned in ${String(layout)}`)
    // The only doubt is that the scan was read again, and the last build's check found the model where it was:
    // there is nothing of the model to hold it against anew, and nothing to ask the kernel, which may be busy.
    const standing = standingOf(scan, String(layout), lastScene(String(objectId))?.revision)
    const check = scan.checks[String(layout)]
    if (alignment.sourceChanged && !standing.unchecked && check && check.off === 0 && check.moved.length === 0) return requireScans().alignmentHolds(String(objectId), String(id), String(layout), null)
    const holds = await heldNow({ scene: (o) => lastScene(o), nearest: ws.nearest! }, String(objectId), String(layout), alignment)
    return checked(String(objectId), requireScans().alignmentHolds(String(objectId), String(id), String(layout), holds))
  })
  // A copy with a buffer of its own, as the blob of a scene is sent.
  handle('scans:mesh', async (_event, objectId: string, id: string) => toArrayBuffer(await requireScans().mesh(String(objectId), String(id))))
  handle('scans:mask', async (_event, objectId: string, id: string, markId: string) => toArrayBuffer(await requireScans().mask(String(objectId), String(id), String(markId))))

  // What the kernel says of a part, a face or an edge of an object's last good build, for what the pointer rests
  // on (`Builds.describe`): never a reason to have the object built again.
  handle('geometry:describe', async (_event, objectId: string, layout: string, ref: string): Promise<Described> => {
    if (typeof layout !== 'string' || typeof ref !== 'string' || !layout || !ref) throw new Error('describe needs a layout and a ref')
    try {
      return await requireWorkspace().builds.describe<Described>(String(objectId), layout, ref)
    } catch (e) {
      // A plain message: the renderer shows it, and a KernelError would cross with its class name in front.
      throw new Error(e instanceof Error ? e.message : String(e))
    }
  })
  // A measurement the person takes and does not keep: the kernel's value on the last build, with a dimension's
  // refusals, and nothing written. It is told to no one: keeping it is `marks:add`, which measures it again.
  handle('geometry:measure', async (_event, objectId: string, probe: MeasureProbe): Promise<MeasuredOnce> => {
    try {
      return await measureOnce(measuring(requireMarks()), String(objectId), probe)
    } catch (e) {
      if (e instanceof Refusal) throw e
      throw new Error(e instanceof Error ? e.message : String(e))
    }
  })


  // The page of objects. Asking for the cards, or for a picture on file, reads and does nothing else: no
  // object is opened or built for it. The window hands over the pictures it drew of the builds it was sent.
  handle('show:cards', () => cards())
  // What git says of an object's sources, for the status line and the Marks panel. Read only (`main/git.ts`).
  handle('git:status', (_event, objectId: string) => {
    const obj = findObject(String(objectId))
    return obj && obj.model !== null ? gitStateRecently(obj.dir) : Promise.resolve(null)
  })
  // The builds kept of an object (`main/history.ts`): read, and starred; nothing is ever restored from them.
  // Every field of an entry goes with it (`cause`, `turn`, `failed`, `error`...); a build that failed has no folder,
  // scene, picture or copies, so no reader of those answers for one.
  handle('history:list', async (_event, objectId: string): Promise<HistoryList | null> => {
    const obj = findObject(String(objectId))
    const kept = obj ? await historyOf(obj.id) : null
    const held = current && obj ? current.meshes.revisions(obj.id) : []
    const ghosts = kept ? kept.entries.filter((e) => drawable(e) && e.run === kept.run && held.includes(e.revision)).map((e) => e.id) : []
    return obj && kept ? { run: kept.run, base: join(obj.dir, '.torno', 'history'), entries: kept.entries, ghosts } : null
  })
  handle('history:thumbnail', async (_event, objectId: string, id: string) => {
    const obj = findObject(String(objectId))
    const entry = obj ? (await readHistory(obj.dir)).find((e) => e.id === String(id)) : undefined
    const png = obj && entry && drawable(entry) ? await readHistoryThumb(obj.dir, entry.id) : null
    return png && toArrayBuffer(png)
  })
  handle('history:source', async (_event, objectId: string, id: string, file: string) => {
    const obj = findObject(String(objectId))
    if (!obj) return null
    const entry = (await readHistory(obj.dir)).find((e) => e.id === String(id))
    return entry && drawable(entry) ? readHistorySource(obj.dir, entry, String(file)) : null
  })
  handle('history:ghost', async (_event, objectId: string, id: string): Promise<HistoryGhost | null> => {
    const obj = findObject(String(objectId))
    const ws = current
    if (!obj || !ws) return null
    const entry = (await readHistory(obj.dir)).find((e) => e.id === String(id))
    if (!entry) return { refused: `Build ${String(id)} is not in the history of this project.` }
    const held = drawable(entry) && entry.run === ws.buildLog.run ? ws.meshes.get(obj.id, entry.revision) : undefined
    if (held) return { scene: held.scene, blob: toArrayBuffer(held.blob) }
    // Not in memory (an earlier run, or let go): built again from the copy of its files, in a worker thrown away. Its sentence when it cannot be: the view says it.
    const rebuilt = await rebuildKept(obj, entry, { kernel: ws.kernel, userData: app.getPath('userData'), timeout: buildTimeout(process.env) })
    return 'refused' in rebuilt ? { refused: rebuilt.refused } : { scene: rebuilt.scene, blob: toArrayBuffer(rebuilt.blob) }
  })
  handle('history:star', (_event, objectId: string, id: string, starred: boolean) => {
    const obj = findObject(String(objectId))
    return obj && current ? current.history.star(obj, String(id), starred === true) : false
  })
  // Go back to before a prompt (`main/goback.ts`): the plan to show, and the go-ahead. The one place the model's files are written.
  handle('history:goBackPlan', async (_event, objectId: string, prompt: string): Promise<GoBackPlan | { refused: string }> => {
    const target = await goBackTarget(String(objectId), String(prompt))
    return 'refused' in target ? target : planGoBack(target.obj, target.to)
  })
  handle('history:goBack', async (_event, objectId: string, prompt: string, confirmed: Pick<GoBackPlan, 'to' | 'write' | 'remove'>): Promise<GoBackResult> => {
    const ws = current
    const target = await goBackTarget(String(objectId), String(prompt))
    if (!ws || 'refused' in target) return { done: [], refused: 'refused' in target ? target.refused : 'No project is open.' }
    const plan = await planGoBack(target.obj, target.to)
    if ('refused' in plan) return { done: [], refused: plan.refused }
    // What the person confirmed is what main would do; anything else is looked at again.
    const asked = confirmed && typeof confirmed === 'object' ? confirmed : null
    const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
    if (!asked || asked.to !== plan.to || !strings(asked.write) || !strings(asked.remove) || asked.write.join('\0') !== plan.write.join('\0') || asked.remove.join('\0') !== plan.remove.join('\0')) {
      return { done: [], refused: 'The files are not as they were when you were asked. Look again before going back.' }
    }
    const result = await applyGoBack(target.obj, plan, { history: ws.history, builds: ws.builds, busy: () => sessions?.busyWith(target.obj.id) ?? null })
    if (!result.refused && !result.failed) sessions?.noteGoBack(target.obj.id, `Went back to build ${plan.to}: the model files are put back as they were then. Claude is told with your next prompt which prompts are undone.`)
    return result
  })
  handle('show:thumbnail', async (_event, objectId: string) => {
    const obj = findObject(String(objectId))
    const png = obj ? await thumbnailOnFile(obj.dir) : null
    return png && toArrayBuffer(png)
  })
  ipcMain.on('show:saveThumbnail', (_event, objectId: string, revision: number, png: Uint8Array, of: ThumbnailOf) => {
    keepThumbnail(keeping, String(objectId), revision, png, of).then(
      (kept) => {
        if (!kept) return
        cardsChanged()
        // The picture of a build the window drew is kept with that build's entry in the history, when it has one.
        const ws = current
        const obj = findObject(String(objectId))
        if (ws && obj) void ws.history.thumbnail(obj, ws.buildLog.run, revision, png)
      },
      (e) => console.error(`cannot keep the picture of ${String(objectId)}: ${e instanceof Error ? e.message : String(e)}`)
    )
  })

  /** The path `export:save` wrote last, for the sheet that is up: what "Show in folder" and "Open" act on. */
  let savedHere: string | null = null
  // An export: one HTML file of the last build of this run of each object named, made in main from what it
  // holds, or a STEP, STL or 3MF file of one object, made by the kernel's worker of that build. Nothing is built
  // for it. A plan writes nothing. A save writes one file, to the path the save dialog answered with and no other:
  // the window names objects, never a path, and no agent has a tool for this.
  const exportDeps = (): ExportDeps => {
    const ws = requireWorkspace()
    return {
      object: (id) => ws.info.objects.find((o) => o.id === id),
      last: (id) => ws.builds.scene(id),
      sceneFile: (id) => {
        const obj = ws.info.objects.find((o) => o.id === id)
        return obj ? sceneFileNow(obj.dir) : Promise.resolve({ layers: {} })
      },
      marks: (id) => (marks ? marks.list(id) : Promise.resolve([])),
      scans: (id) => (scans ? scans.list(id) : Promise.resolve([])),
      scanMesh: (id, scanId) => requireScans().mesh(id, scanId),
      now: () => new Date(),
      failing: (id) => ws.builds.state(id)?.status === 'failed'
    }
  }
  /**
   * A request out of whatever the window sent: names of objects, four times yes or no, keys of scans, a format, and
   * of a file of the model a layout, names of parts and two numbers; nothing else, and never a path.
   */
  const exportAsked = (given: unknown): ExportRequest => {
    const said = Object(given) as { objects?: unknown; marks?: unknown; scans?: unknown; hidden?: unknown; resolved?: unknown; format?: unknown; layout?: unknown; parts?: unknown; tolerance?: unknown; angle?: unknown; open?: unknown }
    const names = (list: unknown): string[] => (Array.isArray(list) ? [...new Set(list.filter((one): one is string => typeof one === 'string' && one !== ''))].slice(0, 1000) : [])
    const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
    const format = EXPORT_FORMATS.find((one) => one === said.format) ?? 'html'
    const req: ExportRequest = { objects: names(said.objects), marks: said.marks === true, scans: names(said.scans), hidden: said.hidden === true, resolved: said.resolved === true }
    if (format === 'html') return req
    const tolerance = finite(said.tolerance)
    const angle = finite(said.angle)
    return { ...req, format, ...(typeof said.layout === 'string' ? { layout: said.layout } : {}), ...(Array.isArray(said.parts) ? { parts: names(said.parts) } : {}), ...(tolerance === undefined ? {} : { tolerance }), ...(angle === undefined ? {} : { angle }), ...(format === '3mf' && said.open === true ? { open: true } : {}) }
  }
  const modelDeps = (): ModelDeps => {
    const ws = requireWorkspace()
    const deps = exportDeps()
    return { object: deps.object, last: deps.last, sceneFile: deps.sceneFile, query: (id, name, args, opts) => ws.builds.query(id, name, args, opts) }
  }
  /** Where the person says the file goes: the save dialog (under test `pickSave`), then torno's question when the name it ends in is of a file the dialog never asked about. Null for none. */
  const askWhere = async (event: Electron.IpcMainInvokeEvent, defaultPath: string, format: FileFormat): Promise<string | null> => {
    let picked: string | null
    if (opts.pickSave) picked = await opts.pickSave(defaultPath)
    else {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.SaveDialogOptions = { title: format === 'png' || format === 'svg' || format === 'pdf' ? 'Save' : 'Export', defaultPath, filters: [{ name: FORMAT_NAMES[format], extensions: [...EXTENSIONS[format]] }] }
      const answer = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options))
      picked = answer.canceled || !answer.filePath ? null : answer.filePath
    }
    if (picked === null) return null
    const path = exportPath(picked, format)
    // The dialog asked about the name it was given: a file of the name torno made of it was never asked about, so it is now.
    if (path !== picked && existsSync(path)) {
      let replace: boolean
      if (opts.confirmReplace) replace = await opts.confirmReplace(path)
      else {
        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.MessageBoxOptions = { type: 'question', message: `Replace ${basename(path)}?`, detail: `${path} is there already. The export was named without .${EXTENSIONS[format][0]}, so this is the file it would replace.`, buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0, noLink: true }
        replace = (await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))).response === 1
      }
      if (!replace) return null
    }
    return path
  }
  const plainly = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e))
    }
  }
  handle('export:plan', (_event, given: unknown): Promise<ExportPlan> =>
    plainly(async () => {
      const deps = exportDeps()
      return exportPlan(deps, exportAsked(given), await loadAssets(), requireWorkspace().info.objects.map((o) => o.id))
    })
  )
  handle('export:save', (event, given: unknown) =>
    plainly(async (): Promise<ExportSaved | null> => {
      const ws = requireWorkspace()
      const deps = exportDeps()
      const req = exportAsked(given)
      if (req.format !== undefined && req.format !== 'html') return saveModelFile(event, { ...req, format: req.format })
      // Made before the dialog is up: it is of the builds there were when "Export" was pressed.
      const made = await exportFile(deps, req, await loadAssets())
      const first = deps.object(req.objects[0])!
      await prepareExports(first.dir)
      const defaultPath = req.objects.length > 1 ? defaultExportPath(first.dir, basename(ws.info.root)) : defaultExportPath(first.dir, first.name, deps.last(first.id)?.revision)
      const path = await askWhere(event, defaultPath, 'html')
      if (path === null) return null
      await writeExport(path, made.html)
      savedHere = path
      return { path, bytes: made.bytes, dropped: made.dropped }
    })
  )
  // A file of the model: made by the kernel of the last good build before the dialog is up, written beside the
  // path chosen, read back by the same worker and checked, and only then given the name.
  const saveModelFile = async (event: Electron.IpcMainInvokeEvent, req: ExportRequest & { format: ModelFormat }): Promise<ExportSaved | null> => {
    const deps = modelDeps()
    const file = await makeModelFile(deps, req)
    const obj = deps.object(file.objectId)!
    await prepareExports(obj.dir)
    const one = req.format === 'stl' ? file.made.parts[0]?.name : undefined
    const defaultPath = defaultExportPath(obj.dir, one === undefined ? obj.name : `${obj.name}-${one}`, file.revision, req.format)
    const path = await askWhere(event, defaultPath, req.format)
    if (path === null) return null
    let checked: ExportSaved['checked']
    await writeExport(path, file.bytes, async (beside) => void (checked = await checkModelFile(deps, file, beside)))
    // A plate handed to the person's slicer, when they ticked it: the file that passed, at the path they chose.
    savedHere = path
    let opened: string | undefined
    if (req.open === true && req.format === '3mf') {
      if (opts.openFile) await opts.openFile(path)
      else opened = (await shell.openPath(path)) || undefined
    }
    return { path, bytes: file.bytes.length, dropped: [], checked, revision: file.revision, ...(opened ? { notOpened: opened } : {}) }
  }

  // A picture of the view the person keeps: the window drew it (as large as 4000 px on its long edge, which the
  // agent's pictures may not be), main checks that it is a PNG, asks where to save and writes it like any export.
  // The path is the dialog's alone; no agent has a tool for it.
  handle('export:savePicture', (event, objectId: unknown, png: unknown) =>
    plainly(async (): Promise<ExportSaved | null> => {
      const deps = exportDeps()
      const obj = typeof objectId === 'string' ? deps.object(objectId) : undefined
      if (!obj) throw new Error('That project is not in this folder.')
      if (!checkedPicture(png)) throw new Error('That is not a picture torno can save: a PNG of at most 4000 px.')
      await prepareExports(obj.dir)
      const path = await askWhere(event, defaultExportPath(obj.dir, obj.name, deps.last(obj.id)?.revision, 'png'), 'png')
      if (path === null) return null
      await writeExport(path, png as Uint8Array)
      savedHere = path
      return { path, bytes: (png as Uint8Array).length, dropped: [] }
    })
  )

  // A drawing of the section on screen, for someone who will make the part: an SVG at true scale from the kernel's
  // outlines of the plane the window reports (`export/section.ts`), written like any export. The window names the
  // object and nothing else.
  handle('export:saveSection', (event, objectId: unknown, as: unknown) =>
    plainly(async (): Promise<ExportSaved | null> => {
      const ws = requireWorkspace()
      const deps = exportDeps()
      const drawing = await makeSectionDrawing(
        { object: deps.object, last: deps.last, view: latestView, marks: deps.marks, query: <T>(id: string, name: string, args: Record<string, unknown>) => ws.builds.query<T>(id, name, args), now: deps.now, identity: buildIdentity },
        String(objectId)
      )
      const obj = deps.object(drawing.objectId)!
      await prepareExports(obj.dir)
      const format = as === 'pdf' ? 'pdf' : 'svg'
      // The PDF is the SVG printed by a window nobody sees, before the dialog is up: it is of the build there was.
      const bytes = format === 'pdf' ? await pdfOfSvg(drawing.svg, drawing.width, drawing.height) : Buffer.from(drawing.svg, 'utf8')
      const path = await askWhere(event, defaultExportPath(obj.dir, `${drawing.name}-section`, drawing.revision, format), format)
      if (path === null) return null
      await writeExport(path, bytes)
      savedHere = path
      return { path, bytes: bytes.length, dropped: [], revision: drawing.revision }
    })
  )

  // The sheet was put away: what was reduced for it is let go, and the file it wrote is no longer its to show.
  ipcMain.on('export:done', () => {
    savedHere = null
    forgetExportScans()
  })
  // The file the sheet wrote last, shown in its folder or handed to the system (a browser, for a page). The path is
  // the one `export:save` wrote and main kept: the window names none, and no agent has a tool for it.
  const savedFile = (): string => {
    if (savedHere === null || !existsSync(savedHere)) throw new Refusal('That file is no longer there')
    return savedHere
  }
  handle('export:reveal', () =>
    plainly(async () => {
      const path = savedFile()
      if (opts.revealFile) opts.revealFile(path)
      else shell.showItemInFolder(path)
    })
  )
  handle('export:openSaved', () =>
    plainly(async () => {
      const path = savedFile()
      if (opts.openFile) return void (await opts.openFile(path))
      const failed = await shell.openPath(path)
      if (failed) throw new Refusal(`It could not be opened: ${failed}`)
    })
  )

  ipcMain.on('view:report', (_event, view: ViewState) => {
    if (findObject(view?.objectId)) reportView(view)
  })

  // What the renderer says it did for a request of main's (src/main/look.ts), each on the channel of its kind.
  for (const channel of ['view:lookReply', 'view:showReply', 'view:highlightReply', 'view:drawSectionReply', 'view:saveViewReply']) {
    ipcMain.on(channel, (_event, id: number, result: object | { error: string }) => resolveRequest(id, result))
  }
}
