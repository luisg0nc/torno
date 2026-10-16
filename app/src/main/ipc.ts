import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { BuildState } from '../shared/build'
import type { ExportPlan, ExportRequest } from '../shared/exportdata'
import type { Described } from '../shared/geometry'
import type { MarkPatch, NewMark, NewRegion, Replacement } from '../shared/marks'
import { type AlignMade, type NewAlignment, type ScanInfo, type ScanUnit, type ScanUp, SCAN_FORMATS, alignmentOf, standingOf } from '../shared/scans'
import type { Scene } from '../shared/scene'
import type { SceneFile } from '../shared/scenefile'
import type { ObjectCard, ThumbnailOf } from '../shared/show'
import type { ViewState } from '../shared/view'
import type { ObjectInfo, RecentFolder, WorkspaceInfo } from '../shared/workspace'
import { Builds, buildTimeout, watchFolder } from './builds'
import { type ExportDeps, exportFile, exportPlan, forgetExportScans } from './export/build'
import { loadAssets } from './export/html'
import { defaultExportPath, htmlPath, prepareExports, writeExport } from './export/save'
import { KernelError, type KernelClient, startKernel } from './kernel/client'
import { toArrayBuffer } from './kernel/frames'
import { forgetViews, reportView, resolveRequest } from './look'
import { type AskedAnchor, type Retrying, asPlaced, asReplaced, checkMarks, followMarks, nearestReply, retrying } from './marks/reanchor'
import { addDimension, dueAfterEdit, remeasure } from './marks/measure'
import { type RegionDeps, addRegion, convertScan, removeMark, repaintRegion, tendRegions } from './marks/regions'
import type { MarkStore } from './marks/store'
import { kernelDir } from './paths'
import { Refusal, refusable } from './refusal'
import { type AlignCheckDeps, checkingAlignments, heldNow, keepChecking, tiedToMoved, uncheckedOn } from './scans/alignCheck'
import { frameOf } from './scans/alignments'
import type { ScanStore } from './scans/store'
import { forgetSceneFiles, loadSceneFile, saveSceneFile, sceneFileNow } from './scenefile'
import type { ChatAnswer } from '../shared/chat'
import type { AgentView, CreateRequest, OnboardDraft } from '../shared/bridge'
import { readChoice, writeChoice } from './sessions/choice'
import { drawingOf } from './sessions/drawing'
import type { Sessions } from './sessions/manager'
import { readReference } from './sessions/reference'
import { sessionOfWorkspace } from './sessions/status'
import { type KeepDeps, cardsOf, keepThumbnail, newestPython, thumbnailOnFile } from './show/cards'
import { onboardObject, sessionRunning } from './onboard'
import { createObject, readPhoto, sweepStaleNew } from './objects/create'
import { Offered } from './objects/offered'
import { scanOrder, scanWorkspace } from './workspace'

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
//   invoke: workspace:current, workspace:pick, workspace:open, workspace:versions,
//           workspace:recent, workspace:forget, workspace:hasExample, workspace:openExample,
//           object:open, object:rebuild, object:sceneFile,
//           session:current, session:start, session:trust, session:stop, session:chooseView,
//           chat:history, chat:reference, chat:send, chat:interrupt, chat:setModel,
//           marks:list, marks:add, marks:update, marks:acknowledge, marks:remove, marks:replace, marks:problem (also sent to the renderer),
//           marks:dismissProblem, geometry:describe,
//           scans:list, scans:pick, scans:import, scans:convert, scans:rename, scans:remove, scans:align, scans:mesh,
//           scans:problem (also sent to the renderer), scans:dismissProblem, scans:reimport, scans:undoAlign, scans:alignHolds,
//           objects:pickPhotos, objects:readPhoto, objects:create, objects:onboard, objects:taken, show:cards, show:thumbnail, export:plan, export:save
//   from the renderer: export:done, show:saveThumbnail, object:saveSceneFile, view:report, view:lookReply, view:showReply, view:highlightReply,
//           view:drawSectionReply, view:saveViewReply, session:write, session:resize, session:insert,
//           chat:answer
//   to the renderer: object:build, object:scene, view:look, view:show, view:highlight, view:drawSection, view:saveView (sent by src/main/look.ts),
//           session:data, session:status, chat:item, chat:meta, chat:capabilities, workspace:requested and window:closeAsked (sent by src/main/index.ts,
//           which hears the answer, window:closeAnswer),
//           marks:changed, marks:problem, scans:changed, scans:progress, scans:problem, show:changed

/** The longest prompt the window may send. */
const MAX_PROMPT_CHARS = 200_000
/** A model as the CLI names one: an alias (`sonnet`) or an id, possibly with a context suffix (`claude-opus-4-5[1m]`). */
const MODEL_NAME = /^[A-Za-z0-9._:[\]-]{1,100}$/

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
}

let current: OpenWorkspace | null = null
/** The photos main's own dialog handed the window: the only files `objects:readPhoto` serves. Forgotten with the workspace. */
const offered = new Offered()

/** The agent sessions, once `registerIpc` has been given them. They belong to the objects of the open workspace. */
let sessions: Sessions | null = null

/** The marks of the objects of the open workspace, once `registerIpc` has been given them. */
let marks: MarkStore | null = null

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

/** Told that the window gave the scene file of an object to save: its saved views may be others. */
let onSceneFile: ((objectId: string) => void) | null = null

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
    size: (path) => stat(path).then((s) => s.size, () => null)
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
    return { revision, ...(built?.revision === revision && built.startedMs !== undefined ? { startedMs: built.startedMs } : {}) }
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

  const kernel = startKernel({ workspaceRoot: info.root, hasProject: info.hasProject, kernelDir: kernelDir() })
  const builds: Builds = new Builds({
    kernel,
    timeout: buildTimeout(process.env),
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
  const ws: OpenWorkspace = { info, scan: scanOrder(), kernel, builds, opened: new Set(), shown: null, started: new Map(), builtFrom: new Map() }
  builds.on('build', (state) => {
    if (state.status === 'building' && state.startedAt !== undefined) ws.started.set(state.objectId, state.startedAt)
    broadcast('object:build', state)
    onBuild?.(state)
    cardsChanged()
  })
  builds.on('scene', ({ objectId, revision, scene, blob }) => {
    // Which build this scene came of: the one started last. A picture of it is no newer than the model was then.
    ws.builtFrom.set(objectId, { revision, startedMs: ws.started.get(objectId) })
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
    return checkMarks(
      {
        marks: store,
        query: (id, name, args) => builds.query(id, name, args, { restore }),
        // None once the workspace is left: nothing is asked or written for it any more.
        scene: (id) => (current === ws ? builds.scene(id) : undefined)
      },
      objectId
    ).finally(() => (counted.finished += 1))
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
  offered.clear()
  forgetViews()
  forgetSceneFiles()
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

/** The last successful build of an object. */
/** The last two successful builds of an object, the older first (`diff`). */
export function keptScenes(id: string): Array<{ revision: number; scene: Scene }> {
  return current?.builds.scenes(id) ?? []
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

/**
 * `onWorkspaceChosen` is told the root of every workspace the person opens
 * from the window, so that it can be opened again at the next start.
 * `sessions` backs the session pane; without it there are no sessions.
 * `marks` backs the marks of the objects; without it there are none.
 * `onBuild` is told where the build of an object stands, each time that changes.
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
    marks?: MarkStore
    onBuild?: (state: BuildState) => void
    /** The window gave the scene file of an object to save. */
    onSceneFile?: (objectId: string) => void
    /** The open workspace was left: object ids mean nothing any more. */
    onWorkspaceClosed?: () => void
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
    /** Stands in for the save dialog of an export: given the path it would open on, the path to write, or null for none. */
    pickSave?: (defaultPath: string) => Promise<string | null>
    /** Stands in for the question asked before an export replaces a file the save dialog did not ask about: yes or no. */
    confirmReplace?: (path: string) => Promise<boolean>
  } = {}
): void {
  sessions = opts.sessions ?? null
  sessions?.on('data', (m) => broadcast('session:data', m))
  sessions?.on('status', (m) => broadcast('session:status', m))
  sessions?.on('status', () => cardsChanged())
  sessions?.on('item', (m) => broadcast('chat:item', { sessionId: m.sessionId, item: m.item, seq: m.seq }))
  sessions?.on('meta', (m) => broadcast('chat:meta', { sessionId: m.sessionId, meta: m.meta, seq: m.seq }))
  sessions?.on('capabilities', (m) => broadcast('chat:capabilities', { sessionId: m.sessionId, commands: m.commands, models: m.models, seq: m.seq }))
  const requireSessions = (): Sessions => {
    if (!sessions) throw new Error('sessions are not available')
    return sessions
  }

  onBuild = opts.onBuild ?? null
  onSceneFile = opts.onSceneFile ?? null
  onWorkspaceClosed = opts.onWorkspaceClosed ?? null
  marks = opts.marks ?? null
  marks?.on('changed', (m) => broadcast('marks:changed', m))
  marks?.on('problem', (m) => broadcast('marks:problem', m))
  marks?.on('changed', () => cardsChanged())
  // A mark added, or reopened, has not been checked against the build there is: no build is on its way to do it.
  if (marks) followMarks(marks, (objectId, restore) => current?.reanchor?.(objectId, restore))
  const requireMarks = (): MarkStore => {
    if (!marks) throw new Error('marks are not available')
    return marks
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
    if (!obj) throw new Error(`no object named ${id} in ${ws.info.root}`)
    const state = ws.builds.open(obj)
    ws.opened.add(id)
    // A renderer that subscribes after a build has missed its scene event.
    const last = ws.builds.scene(id)
    if (last) event.sender.send('object:scene', { objectId: id, ...last, blob: toArrayBuffer(last.blob) })
    return state
  })

  handle('object:rebuild', (_event, id: string) => {
    requireWorkspace().builds.rebuild(id)
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

  handle('session:start', async (_event, objectId: string, opts?: { resume?: boolean; cols?: number; rows?: number }) => {
    const obj = findObject(objectId)
    if (!obj) throw new Error(`no object named ${objectId} in the open workspace`)
    return requireSessions().start(obj, { resume: opts?.resume === true, cols: opts?.cols, rows: opts?.rows })
  })

  // The person said to start the chat in a folder that has Claude Code settings of its own (the question `session:start` refused with).
  handle('session:trust', async (_event, objectId: string) => {
    const obj = findObject(objectId)
    if (!obj) throw new Error(`no object named ${objectId} in the open workspace`)
    await requireSessions().trust(obj)
  })

  // The view is of the sessions to come: the one that runs is of the view it was started in, and is ended first.
  handle('session:chooseView', async (_event, objectId: string, view: AgentView) => {
    const obj = findObject(String(objectId))
    if (!obj) throw new Error(`no object named ${objectId} in the open workspace`)
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

  handle('chat:reference', async (_event, sessionId: string, file: string) => {
    const chat = sessions?.chatOf(String(sessionId))
    if (!chat || !sessionOfWorkspace(chat, current?.info.root)) return null
    return readReference(chat.dir, String(file))
  })

  handle('chat:send', async (_event, sessionId: string, prompt: { text?: unknown; attachView?: unknown; drawing?: unknown }) => {
    if (!ofThisWorkspace(String(sessionId))) throw new Refusal('This session has ended')
    if (typeof prompt?.text !== 'string' || prompt.text.length > MAX_PROMPT_CHARS) throw new Refusal('Nothing to send')
    // The window's drawing is taken only once it is what one is: main words what the agent reads of it.
    const drawing = prompt.drawing === undefined ? undefined : drawingOf(prompt.drawing)
    if (typeof drawing === 'string') throw new Refusal(drawing)
    await requireSessions().send(String(sessionId), { text: prompt.text, attachView: prompt.attachView === true, ...(drawing ? { drawing } : {}) })
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

  // The renderer names the object; the store finds its folder, and rejects an object the workspace does not have.
  handle('marks:list', (_event, objectId: string) => requireMarks().list(String(objectId)))
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
  // What the person painted on a scan: main works out what it is from the mesh, and writes its triangles beside it.
  handle('marks:addRegion', (_event, objectId: string, region: NewRegion) => addRegion(regions(), String(objectId), region))
  // A region painted again: the same mark, of the triangles sent; main writes them as a new mask and says the numbers anew.
  handle('marks:repaintRegion', (_event, objectId: string, id: string, bits: Uint8Array) => repaintRegion(regions(), String(objectId), String(id), bits))
  handle('marks:replace', async (_event, objectId: string, id: string, placed: Replacement) => {
    const store = requireMarks()
    const layout = (await store.list(String(objectId))).find((m) => m.id === String(id))?.layout
    return store.replace(String(objectId), String(id), layout === undefined ? placed : asReplaced(placed, layout, lastScene(String(objectId))))
  })
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
        start: (obj) => requireSessions().start(obj, {}),
        prompt: (sessionId, blocks) => requireSessions().prompt(sessionId, blocks),
        began: (sessionId) => requireSessions().began(sessionId),
        scene: (id) => ws.builds.scene(id)?.scene
      },
      String(objectId),
      draft
    )
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
    if (!last || !frame) throw new Refusal(`no build of this object has a layout named ${String(layout)}: there is nothing to align the scan to`)
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


  // The page of objects. Asking for the cards, or for a picture on file, reads and does nothing else: no
  // object is opened or built for it. The window hands over the pictures it drew of the builds it was sent.
  handle('show:cards', () => cards())
  handle('show:thumbnail', async (_event, objectId: string) => {
    const obj = findObject(String(objectId))
    const png = obj ? await thumbnailOnFile(obj.dir) : null
    return png && toArrayBuffer(png)
  })
  ipcMain.on('show:saveThumbnail', (_event, objectId: string, revision: number, png: Uint8Array, of: ThumbnailOf) => {
    keepThumbnail(keeping, String(objectId), revision, png, of).then(
      (kept) => kept && cardsChanged(),
      (e) => console.error(`cannot keep the picture of ${String(objectId)}: ${e instanceof Error ? e.message : String(e)}`)
    )
  })

  // An export: one HTML file of the last build of this run of each object named, made in main from what it
  // holds. Nothing is built for it. A plan writes nothing. A save writes one file, to the path the save dialog
  // answered with and no other: the window names objects, never a path, and no agent has a tool for this.
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
  /** A request out of whatever the window sent: names of objects, four times yes or no, keys of scans, and nothing else. */
  const exportAsked = (given: unknown): ExportRequest => {
    const said = Object(given) as { objects?: unknown; marks?: unknown; scans?: unknown; hidden?: unknown; resolved?: unknown }
    const names = (list: unknown): string[] => (Array.isArray(list) ? [...new Set(list.filter((one): one is string => typeof one === 'string' && one !== ''))].slice(0, 1000) : [])
    return { objects: names(said.objects), marks: said.marks === true, scans: names(said.scans), hidden: said.hidden === true, resolved: said.resolved === true }
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
    plainly(async () => {
      const ws = requireWorkspace()
      const deps = exportDeps()
      const req = exportAsked(given)
      // Made before the dialog is up: it is of the builds there were when "Export" was pressed.
      const made = await exportFile(deps, req, await loadAssets())
      const first = deps.object(req.objects[0])!
      await prepareExports(first.dir)
      const defaultPath = req.objects.length > 1 ? defaultExportPath(first.dir, basename(ws.info.root)) : defaultExportPath(first.dir, first.name, deps.last(first.id)?.revision)
      let picked: string | null
      if (opts.pickSave) picked = await opts.pickSave(defaultPath)
      else {
        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.SaveDialogOptions = { title: 'Export', defaultPath, filters: [{ name: 'HTML', extensions: ['html'] }] }
        const answer = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options))
        picked = answer.canceled || !answer.filePath ? null : answer.filePath
      }
      if (picked === null) return null
      const path = htmlPath(picked)
      // The dialog asked about the name it was given: a file of the name torno made of it was never asked about, so it is now.
      if (path !== picked && existsSync(path)) {
        let replace: boolean
        if (opts.confirmReplace) replace = await opts.confirmReplace(path)
        else {
          const win = BrowserWindow.fromWebContents(event.sender)
          const options: Electron.MessageBoxOptions = { type: 'question', message: `Replace ${basename(path)}?`, detail: `${path} is there already. The export was named without .html, so this is the file it would replace.`, buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0, noLink: true }
          replace = (await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))).response === 1
        }
        if (!replace) return null
      }
      await writeExport(path, made.html)
      return { path, bytes: made.bytes, dropped: made.dropped }
    })
  )

  // The sheet was put away: what was reduced for it is let go.
  ipcMain.on('export:done', () => forgetExportScans())

  ipcMain.on('view:report', (_event, view: ViewState) => {
    if (findObject(view?.objectId)) reportView(view)
  })

  // What the renderer says it did for a request of main's (src/main/look.ts), each on the channel of its kind.
  for (const channel of ['view:lookReply', 'view:showReply', 'view:highlightReply', 'view:drawSectionReply', 'view:saveViewReply']) {
    ipcMain.on(channel, (_event, id: number, result: object | { error: string }) => resolveRequest(id, result))
  }
}
