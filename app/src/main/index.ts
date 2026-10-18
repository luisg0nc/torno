import { existsSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron'
import type { Described } from '../shared/geometry'
import type { SavedView } from '../shared/views'
import { writeFileAtomic } from './atomic'
import { devShortcut } from './devkeys'
import { applyLoginPath } from './loginPath'
import { menuTemplate } from './menu'
import { copyExample, exampleSource, removeExample, sweepExamples } from './example'
import { type Config, configOf, listed, recentWith, recentWithout } from './recent'
import { startHttp } from './http'
import { buildContextFor, contextFor } from './context'
import { listReferences } from './sessions/reference'
import { buildState, closeWorkspace, findObject, keptScenes, lastScene, letGoForTest, marksChecks, openObjectId, openWorkspace, openWorkspaceInfo, openedObjects, placedMark, queryObject, recheckAlignments, registerIpc } from './ipc'
import { cannotStart } from './kernel/client'
import { NoAnswer, latestView, requestHighlight, requestLook, requestSaveView, requestSectionDrawing, requestShow } from './look'
import { addDimensionTold } from './marks/measure'
import type { NearestAnchor } from './marks/reanchor'
import { maskReadsOf, maskStampOf, meshesOf } from './marks/regions'
import { MarkStore } from './marks/store'
import { mountMcp } from './mcp/server'
import { DEFAULT_SIZE } from './mcp/schemas'
import { onNotOwn } from './own'
import { agentPluginDir, kernelDir, windowIcon } from './paths'
import type { ToolDeps } from './mcp/tools'
import { saveView } from './mcp/views'
import { systemPrompt } from './prompt'
import { quitGate } from './quit'
import { makeTestProfile, removeTestProfileAfterExit } from './testProfile'
import { type Importer, commandIn, processImporter } from './scans/importer'
import { ScanStore } from './scans/store'
import { proposing, sceneFileNow, sceneFilesSettled } from './scenefile'
import { readChoice } from './sessions/choice'
import { claudeAdapter } from './sessions/claude'
import { Sessions } from './sessions/manager'
import { StateFiles } from './statefile'
import { Trust } from './trust'

// Environment switches:
//   TORNO_TEST=1            the window is created hidden and never shown (tests, headless checks)
//   TORNO_WORKSPACE=<path>  workspace to open at start, instead of the one remembered
//   TORNO_CONFIG=<path>     config file to use instead of ~/.config/torno/config.json
//   TORNO_AGENT_CMD=<cmd>   command to run for a session instead of `claude`, split on spaces
//   TORNO_BUILD_TIMEOUT=<s> seconds a build may take before it is stopped (default 600; read in src/main/ipc.ts)
//   TORNO_DEBUG=1           print the workspace opened at start, where the MCP server is, and the command
//                           line and the hooks of every session
// Whose window this is, said outright: the desktop finds torno's entry and icon by it (the Wayland app id, the
// X11 class), whatever the package is called. `setDesktopName` is Linux's, and not there elsewhere.
app.setName('torno')
;(app as unknown as { setDesktopName?: (name: string) => void }).setDesktopName?.('torno.desktop')

const isTest = process.env.TORNO_TEST === '1'
const isDebug = process.env.TORNO_DEBUG === '1'

// Under test Electron keeps nothing of its own under the person's home: its profile (cache, storage, crash
// dumps) is a folder of this run in the temporary folder (`testProfile.ts`), set before the app is ready and
// removed once the process has gone. Without this every test launch wrote into ~/.config/torno.
if (isTest) {
  const profile = makeTestProfile()
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  app.setPath('crashDumps', join(profile, 'crashes'))
  app.on('quit', () => removeTestProfileAfterExit(profile))
}

// A hidden window stops getting frame callbacks from the compositor. Once a
// repaint coincides with input, Chromium then waits a second for each frame, so
// every mouse move in a test takes a second. Without the frame-rate limit it
// keeps drawing at 60 Hz. Never set for a visible window.
if (isTest) app.commandLine.appendSwitch('disable-frame-rate-limit')

// One torno at a time: two would each run an agent in the same folders and
// write the same .torno/ files. A second launch hands the first the folder it
// was given, if any, and exits. Not under test: test runs launch side by side.
const isFirst = isTest || app.requestSingleInstanceLock({ workspace: process.env.TORNO_WORKSPACE ?? null })
if (!isFirst) {
  const handed = process.env.TORNO_WORKSPACE ? `; it was asked to open ${process.env.TORNO_WORKSPACE}` : ''
  console.error(`torno is already running: its window was brought to the front${handed}`)
  app.quit()
}

// torno has no menu on Linux. With one, even hidden, a lone press of Alt shows the menu bar on Linux and the
// viewport is resized under the pointer: Alt-drag is how the camera is turned with the Draw tool in hand.
// Text fields keep copy, paste, select all and undo without a menu; the terminal has its own keys.
// On macOS the menu bar is global and a text field takes copy, paste and undo from the roles of the menu:
// `menu.ts` gives one there (and `null` anywhere else).
Menu.setApplicationMenu(
  (() => {
    const template = menuTemplate(process.platform, {
      // As closing the window is held: the window asks first; with none, the app quits.
      quit: () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win && !win.isDestroyed()) win.close()
        else app.quit()
      }
    })
    return template === null ? null : Menu.buildFromTemplate(template)
  })()
)

// The workspace last opened from the window is remembered in
// ~/.config/torno/config.json and opened again at the next start. A test run
// neither reads nor writes the person's own file: only one it names itself.
const configPath: string | null =
  process.env.TORNO_CONFIG ?? (isTest ? null : join(app.getPath('appData'), 'torno', 'config.json'))

// The same file keeps the folders opened lately (`recent`, eight at most), for the first screen. Nothing
// of that is ever written in a workspace, and none of it leaves this machine.
async function readConfig(): Promise<Config> {
  if (!configPath) return { recent: [] }
  try {
    return configOf(JSON.parse(await readFile(configPath, 'utf8')))
  } catch {
    return { recent: [] } // no file yet, or not one of ours
  }
}

/** One change of the file at a time: each reads what the one before wrote. */
let configWritten: Promise<unknown> = Promise.resolve()
function changeConfig(change: (config: Config) => Config): Promise<Config> {
  const done = configWritten.then(async () => {
    const config = change(await readConfig())
    if (!configPath) return config
    try {
      await writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`)
    } catch (e) {
      console.error(`cannot write ${configPath}: ${(e as Error).message}`)
    }
    return config
  })
  configWritten = done.catch(() => {})
  return done
}

async function rememberedWorkspace(): Promise<string | undefined> {
  return (await readConfig()).workspace
}

function rememberWorkspace(root: string): Promise<Config> {
  return changeConfig((config) => ({ workspace: root, recent: recentWith(config.recent, root) }))
}

// The example of the first screen: where torno runs from its repository, a copy of some objects of the
// repository's test workspace, made in a temporary folder when it is asked for, once in a run, and removed
// when torno quits, once nothing is being written there any more (`will-quit`). One a crash left is swept at
// the next start (`sweepExamples`). It is not remembered: at the next start it would be gone.
const exampleFrom = exampleSource(app.getAppPath(), app.isPackaged)
let exampleCopy: string | null = null
async function exampleFolder(): Promise<string | null> {
  if (exampleFrom === null) return null
  if (exampleCopy === null || !existsSync(exampleCopy)) exampleCopy = await copyExample(exampleFrom, realpathSync(tmpdir()))
  return exampleCopy
}

// The window's own background, painted before the renderer's first frame.
// Keep equal to --surface in src/renderer/styles/tokens.css.
const SURFACE = { light: '#F1EFEA', dark: '#1A1C1F' }

/** How long a window asked whether it may close has to answer, before it is closed without one. */
const CLOSE_ANSWER_MS = 1500

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    // A hidden test window keeps its size where the display is smaller (macOS clamps it otherwise).
    ...(isTest ? { enableLargerThanScreen: true } : {}),
    title: 'torno',
    icon: windowIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? SURFACE.dark : SURFACE.light,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: join(__dirname, '../preload/index.js')
    }
  })

  if (!isTest) win.once('ready-to-show', () => win.show())

  // Closing the window ends torno and every session in it, so the window is asked first (`renderer/closing.ts`):
  // with nothing under way it answers at once and the window closes; otherwise it asks the person in place, and
  // the window stays until they say. A window that does not answer (it never loaded, it crashed) is closed
  // after `CLOSE_ANSWER_MS`. A quit that did not come through the window (`before-quit`) is not held.
  let mayClose = false
  let unanswered: ReturnType<typeof setTimeout> | null = null
  const closeNow = (): void => {
    mayClose = true
    if (unanswered) clearTimeout(unanswered)
    if (!win.isDestroyed()) win.close()
  }
  const onAnswer = (event: Electron.IpcMainEvent, close: unknown): void => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    if (unanswered) clearTimeout(unanswered)
    unanswered = null
    if (close === true) closeNow()
  }
  const onQuit = (): void => void (mayClose = true)
  ipcMain.on('window:closeAnswer', onAnswer)
  app.on('before-quit', onQuit)
  win.on('close', (event) => {
    if (mayClose || win.webContents.isDestroyed() || win.webContents.isCrashed() || win.webContents.isLoading()) return
    event.preventDefault()
    if (unanswered) return // asked already, and not answered yet
    unanswered = setTimeout(closeNow, CLOSE_ANSWER_MS)
    win.webContents.send('window:closeAsked')
  })
  win.on('closed', () => {
    if (unanswered) clearTimeout(unanswered)
    ipcMain.off('window:closeAnswer', onAnswer)
    app.off('before-quit', onQuit)
  })

  // The renderer is a single local page: it opens no windows and goes nowhere
  // else. It may reload itself, which is how the dev server applies a change it
  // cannot hot-swap.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  // electron-vite serves the renderer from its dev server under `pnpm dev`.
  // `?test=1` tells the renderer to expose its test hook (window.__tornoTest).
  const devUrl = process.env.ELECTRON_RENDERER_URL
  // What the menu gave a developer: the developer tools wherever the app is not packaged, and reloading
  // under `pnpm dev` only, since in the app itself Ctrl+R is the agent's CLI's own key.
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      const action = devShortcut(input, { reload: devUrl !== undefined })
      if (!action) return
      event.preventDefault()
      if (action === 'reload') win.webContents.reload()
      else win.webContents.toggleDevTools()
    })
  }
  if (!app.isPackaged && devUrl) void win.loadURL(isTest ? `${devUrl}?test=1` : devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), isTest ? { query: { test: '1' } } : undefined)

  return win
}

let sessions: Sessions | null = null

/** The marks of the objects of the open workspace, whose folders are those of the last scan. */
// A region is held against the mesh its scan has whenever the marks are listed (`meshesOf`).
const marks: MarkStore = new MarkStore({ dirOf: (id) => findObject(id)?.dir, meshes: (objectId) => meshesOf(scans)(objectId), maskReads: (objectId, scan, stem) => maskReadsOf(scans)(objectId, scan, stem), maskStamp: (objectId, scan, stem) => maskStampOf(scans)(objectId, scan, stem) })

// A `.torno` that is a link or a file is written to by no one (`ownTorno`). The person is told once for each
// object, where what is wrong with its marks is said: nothing of that object is kept until it is a real folder.
// A folder under it that is a link (`views`, `exports`, `scans`, `agent`) is told of the same way, by itself:
// the rest of the object is kept.
onNotOwn((dir, message, inside) => {
  const obj = openWorkspaceInfo()?.objects.find((one) => one.dir === dir)
  if (obj) void marks.report(obj.id, inside === null ? `${message} Nothing of this object is kept until then: no mark, no view, no picture.` : message).catch(() => {})
})

/** What runs the import process in the open workspace, once a scan was imported there: one at a time, and stopped when it is left. */
let importer: { root: string; run: Importer } | null = null

/**
 * The scans of the objects of the open workspace. A file is read by a process
 * of its own, in the workspace's environment as the kernel is: where no
 * kernel can be started (`cannotStart`), none is, and the import says why.
 */
const scans = new ScanStore({
  dirOf: (id) => findObject(id)?.dir,
  importer: () => {
    const ws = openWorkspaceInfo()
    if (!ws) return 'no workspace is open'
    const reason = cannotStart({ workspaceRoot: ws.root, hasProject: ws.hasProject })
    if (reason !== null) return reason
    const root = ws.root
    // Whether it has a project, and so whether a process may run there, is asked again as each is started (`commandIn`):
    // a pyproject.toml may appear while an import waits. Of this workspace only: once it is left, its importer is stopped for good.
    const hasProject = (): boolean => {
      const now = openWorkspaceInfo()
      return now?.root === root ? now.hasProject : ws.hasProject
    }
    if (importer?.root !== root) importer = { root, run: processImporter(commandIn(root, hasProject, kernelDir()), root) }
    return importer.run
  }
})

/** The window, which is what the agent's tools ask for pictures and ask to show things. */
function theWindow(): Promise<BrowserWindow> {
  const win = BrowserWindow.getAllWindows()[0]
  return win ? Promise.resolve(win) : Promise.reject(new Error('the torno window is closed'))
}

/**
 * The scans of an object, for a tool or for the text attached to a prompt. Someone wants to know: an alignment
 * that was not checked against the last build is asked about again.
 */
async function listedScans(objectId: string): ReturnType<ScanStore['list']> {
  const listed = await scans.list(objectId)
  recheckAlignments(objectId, listed)
  return listed
}

/** The views saved of an object: of its scene file as main last read it or was given it by the window, which writes it. */
function savedViews(objectId: string): Promise<SavedView[]> {
  const obj = findObject(objectId)
  return obj ? sceneFileNow(obj.dir).then((file) => file.views ?? []) : Promise.resolve([])
}

/** What the text attached to a prompt is made from: the tools' deps, and the files of an object's `reference/` for a new conversation. */
const referencesOf = (id: string): string[] => {
  const obj = findObject(id)
  return obj ? listReferences(obj.dir) : []
}

/** What the MCP tools are made from: the open workspace and the window. */
const toolDeps: ToolDeps = {
  object: findObject,
  build: buildState,
  scene: lastScene,
  scenes: keptScenes,
  // A view reported for an object stays on record after the window has moved on to another.
  view: (id) => (openObjectId() === id ? latestView(id) : undefined),
  openObjectId,
  look(_objectId, req) {
    // The window draws the object it shows, and its answer says which that was.
    return theWindow().then((win) => requestLook(win, req))
  },
  saveImage(objectId, png) {
    const obj = findObject(objectId)
    return obj ? saveView(obj.dir, png) : Promise.reject(new Error(`unknown object: ${objectId}`))
  },
  marks: (objectId) => marks.list(objectId),
  // A mark made through the tools is the agent's, and it knows of it: there is nothing to send it.
  addMark: (objectId, mark) => marks.add(objectId, placedMark({ ...mark, author: 'agent' }, objectId), 'sent'),
  // A dimension is measured as it is kept, as one the person makes is (`addDimension`).
  addDimension: (objectId, mark) => addDimensionTold({ marks, query: queryObject, scene: lastScene }, objectId, placedMark({ ...mark, author: 'agent' }, objectId), 'sent'),
  // Whoever changes a mark through the tools is the agent.
  updateMark: (objectId, id, patch) => marks.update(objectId, id, patch, 'agent'),
  describe: (objectId, layout, ref) => queryObject<Described>(objectId, 'describe', { ref: `${layout}:${ref}` }),
  async nearest(objectId, layout, anchors) {
    const reply = await queryObject<{ anchors?: NearestAnchor[] }>(objectId, 'nearest', { layout, anchors })
    if (!Array.isArray(reply?.anchors) || reply.anchors.length !== anchors.length) throw new Error('the kernel did not answer for each point')
    return reply.anchors
  },
  show(_objectId, req) {
    return theWindow().then((win) => requestShow(win, req))
  },
  highlight(objectId, layout, refs, note) {
    return theWindow().then((win) => requestHighlight(win, { objectId, layout, refs, ...(note ? { note } : {}) }))
  },
  query: queryObject,
  scans: (objectId) => listedScans(objectId),
  scanPaths: (objectId, id) => scans.paths(objectId, id),
  scansBusy: (objectId) => scans.working(objectId),
  sectionDrawing(req) {
    return theWindow().then((win) => requestSectionDrawing(win, req))
  },
  views: savedViews,
  saveView(objectId, req) {
    const obj = findObject(objectId)
    if (!obj) return Promise.reject(new Error(`unknown object: ${objectId}`))
    // The name is the agent's to propose until the window has answered, and the answer waits for the file to be on the disk (`proposing`).
    return proposing(obj.dir, req.name, () => theWindow().then((win) => requestSaveView(win, req)), (e) => e instanceof NoAnswer)
  }
}
const promptDeps = { ...toolDeps, references: referencesOf }

/** `<object>/.torno/state.md` of every open object: what an agent without the tools reads instead. */
const stateFiles = new StateFiles({ object: findObject, build: buildState, scene: lastScene, marks: (objectId) => marks.list(objectId), scans: (objectId) => scans.list(objectId), views: savedViews })
marks.on('changed', ({ objectId }) => stateFiles.changed(objectId))
// Where a region is told to be follows its scan's alignment.
scans.on('changed', ({ objectId }) => stateFiles.changed(objectId))
// A mask that did not read for a region is asked for again: what the scans are has changed.
scans.on('changed', ({ objectId }) => marks.scansChanged(objectId))

/**
 * What a test needs of main that it cannot reach through the window. `pickFolder`
 * is what "Open folder" is answered with under test, where no dialog may be
 * shown; `picks` counts how often it was asked. `marks` is the store, through
 * which a test leaves the marks an agent would: the window can only make the
 * person's. `marksChecks` says whether the marks of an object have been
 * checked against its build since something was done to them. `scans` is the
 * store of the scans; `pickFile` is what "Import scan" is answered with, and
 * `filePicks` counts how often it was asked; `pickPhotos` (a list of paths) and `photoPicks` are the same for the photo dialog of a new object; `pickSave` is what the save dialog of
 * an export is answered with (the path to write, or null), `savePicks` counts
 * how often it was asked and `saveOffered` is the path it would have opened on; `replace` answers the question asked before an export replaces a file the dialog did not ask about, and `replaceAsked` counts it. `letGo` has an object's status
 * say that the kernel let its build go, which no test's kernel does. `opened`
 * are the objects opened in this run: those that are watched and built.
 */
const testHooks = { requestLook, latestView, marks, marksChecks, opened: openedObjects, letGo: letGoForTest, mcpUrlFor: (_id: string): string => '', pickFolder: null as string | null, picks: 0, scans, pickFile: null as string | null, filePicks: 0, pickPhotos: [] as string[], photoPicks: 0, pickSave: null as string | null, savePicks: 0, saveOffered: null as string | null, replace: false, replaceAsked: 0 }

/** The folder a second launch was given while there was no window to offer it to, or none that had loaded. */
let requested: string | null = null

/** Offer the window the folder that is held, once it has loaded: before that nothing there listens. */
function offerRequested(win: BrowserWindow): void {
  const send = (): void => {
    if (requested === null || win.isDestroyed()) return
    // Through the window, which asks first if a session there is in the middle of something.
    win.webContents.send('workspace:requested', requested)
    requested = null
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

/** Another torno was started: come to the front, and offer the folder it was given. */
app.on('second-instance', (_event, _argv, _cwd, data) => {
  const root = (data as { workspace?: unknown } | null)?.workspace
  if (typeof root === 'string' && root) requested = root // the last one asked for, if several
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return // still starting: `createWindow` is followed by the offer
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  offerRequested(win)
})

void app.whenReady().then(async () => {
  if (!isFirst) return
  // A start from the Finder or the Dock has launchd's PATH, without `uv` or `claude`: ask the login shell (macOS only).
  await applyLoginPath()
  // In development the Dock shows Electron's icon; a packaged app takes its own from its bundle.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(windowIcon())
  // What the agent's CLI talks to: its hooks, and the MCP server through which it sees what the window shows.
  const http = await startHttp()
  const mcpUrlFor = (id: string): string => http.url(`/mcp/${encodeURIComponent(id)}`)
  mountMcp(http, toolDeps)
  sessions = new Sessions({
    http,
    // Whether a chat may start in a folder with Claude Code settings of its own: asked once, and kept beside the recent folders.
    trust: new Trust(configPath ? join(dirname(configPath), 'trusted.json') : null),
    // Claude Code, given torno's skills. TORNO_AGENT_CMD is run in place of `claude`.
    adapter: claudeAdapter(process.env.TORNO_AGENT_CMD, agentPluginDir()),
    // How the session is shown: the object's choice, in its `.torno/agent.json` (a chat unless it says terminal).
    viewFor: async (obj) => (await readChoice(obj.dir)).view,
    // The viewport as the person has it, for a prompt that attaches the view: of the object the session is of.
    picture: async (obj) => {
      const look = await requestLook(await theWindow(), { view: 'current', size: DEFAULT_SIZE })
      if (look.objectId !== obj.id) throw new Error(`The window shows ${look.objectId}, not ${obj.id}`)
      return look.png
    },
    // The marks of an object that cannot be read are not a reason to tell the agent nothing of its build.
    // Nor are scans that cannot be read: they are then not known, which is not the same as there being none.
    contextFor: async (id, opts) => {
      const scans = await listedScans(id).catch(() => undefined)
      return contextFor(promptDeps, id, await marks.list(id).catch(() => []), { ...opts, ...(scans ? { scans } : {}) })
    },
    // An edit of the model is answered with the build it started, and a Stop held back once over a build the turn left failed or unseen.
    build: buildState,
    buildContextFor: async (id, toolName) => buildContextFor(toolDeps, id, await marks.list(id).catch(() => []), { toolName }),
    // The agent has the prompt, and with it the drafts that were listed: they are sent.
    onDelivered: (id, sentMarkIds) => void marks.markSent(id, sentMarkIds).catch((e) => console.error(`cannot mark ${sentMarkIds.join(', ')} of ${id} as sent: ${e.message}`)),
    systemPromptFor: (adapter) => systemPrompt(adapter.toolName, adapter.skills),
    mcpUrlFor,
    debug: isDebug
  })
  registerIpc({
    onWorkspaceChosen: (root) => void rememberWorkspace(root),
    // The folders opened lately, for the first screen, and the one way one leaves the list: the person removes it.
    recent: async () => listed((await readConfig()).recent),
    forget: async (root) => listed((await changeConfig((config) => ({ ...config, recent: recentWithout(config.recent, root) }))).recent),
    example: exampleFrom === null ? undefined : exampleFolder,
    sessions,
    marks,
    onBuild: (state) => {
      stateFiles.changed(state.objectId)
      sessions?.built(state)
    },
    // The saved views are named in the state file.
    onSceneFile: (objectId) => stateFiles.changed(objectId),
    // What was waiting to be written was of objects of the workspace that is left.
    onWorkspaceClosed: () => {
      stateFiles.forget()
      // An import still running there is ended, and its importer with it: its scan is not kept, and its id not given again.
      importer?.run.stop()
      importer = null
    },
    // A folder dialog is a window on the person's desktop: under test there is none.
    pickFolder: isTest
      ? async () => {
          testHooks.picks += 1
          return testHooks.pickFolder
        }
      : undefined,
    scans,
    // Nor a file dialog.
    pickFile: isTest
      ? async () => {
          testHooks.filePicks += 1
          return testHooks.pickFile
        }
      : undefined,
    // Nor the photo dialog of a new object.
    pickPhotos: isTest
      ? async () => {
          testHooks.photoPicks += 1
          return testHooks.pickPhotos
        }
      : undefined,
    // Nor a save dialog.
    pickSave: isTest
      ? async (defaultPath) => {
          testHooks.savePicks += 1
          testHooks.saveOffered = defaultPath
          return testHooks.pickSave
        }
      : undefined,
    // Nor a question in a box.
    confirmReplace: isTest
      ? async () => {
          testHooks.replaceAsked += 1
          return testHooks.replace
        }
      : undefined
  })
  testHooks.mcpUrlFor = mcpUrlFor
  if (isTest) Object.assign(globalThis, { __tornoMain: testHooks })
  // With the run's secret taken out: an address that is logged is an address anyone who reads the log can call.
  if (isDebug) console.error(http.redact(`[torno] MCP server of an object: ${mcpUrlFor('<object id>')}`))
  // What a torno that crashed left in the temporary folder: only copies of the example its own marker names.
  if (exampleFrom !== null) void sweepExamples(realpathSync(tmpdir())).catch(() => {})
  const named = process.env.TORNO_WORKSPACE
  const root = named ?? (await rememberedWorkspace())
  if (root) {
    // Before the window exists, so the renderer's first question finds it open.
    const source = named ? 'TORNO_WORKSPACE' : configPath
    await openWorkspace(root)
      .then((info) => {
        if (isDebug) console.error(`[torno] workspace ${info.root}: ${info.objects.length} objects`)
        // A folder torno was started with is one opened lately, as one chosen in the window is. What is opened
        // at the next start stays the one chosen there. (Under test there is no config but one the test names.)
        if (named) void changeConfig((config) => ({ ...config, recent: recentWith(config.recent, info.root) }))
      })
      .catch((e) => console.error(`${source}: cannot open ${root}: ${e.message}`))
  }
  offerRequested(createWindow())
})

// The kernel also exits by itself when this process, and so its stdin, goes away.
// Sessions are hung up on, and the quit waits until they have gone: one that
// ignores the hangup is killed two seconds later. With none left, the second
// quit goes through.
//
// The first quit also waits for what is still being written of the marks, of
// the scans and of the scene files: the note being typed and the layers just
// changed are handed over by the window as it closes, just before this, and
// are not on the disk yet. All together are given `WRITES_WAIT_MS`, once (`quitGate`):
// the quit that follows is not held for them again, so a write that never
// ends cannot keep the app open.
const WRITES_WAIT_MS = 2000
const writesBeforeQuit = quitGate(WRITES_WAIT_MS)

app.on('will-quit', (event) => {
  void closeWorkspace()
  const waits: Promise<unknown>[] = []
  const written = writesBeforeQuit([marks.settled(), scans.settled(), sceneFilesSettled()])
  if (written) waits.push(written)
  if (sessions?.busy) waits.push(sessions.stopAll())
  // The copy of the example was torno's own, in the temporary folder: it goes with the run, last of all, once
  // what was still being written into it is on the disk and its sessions have gone. Removed before, a late
  // write would make its folders anew and leave them.
  const copy = exampleCopy
  if (waits.length === 0 && copy === null) return
  exampleCopy = null
  event.preventDefault()
  void Promise.allSettled(waits)
    .then(() => (copy === null ? undefined : removeExample(copy)))
    .catch(() => {})
    .finally(() => app.quit())
})

// Closing the window ends the app on every platform: sessions do not outlive it.
app.on('window-all-closed', () => app.quit())
