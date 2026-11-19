import { pressed, which } from '../shared/keys'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { EXAMPLE_NOTE, type WorkspaceInfo } from '../shared/workspace'
import { connectLook } from './state/agent'
import { connectAsks } from './state/asks'
import { connectBoard, useBoard } from './state/board'
import { connectTracings } from './state/tracings'
import { connectReview } from './state/review'
import { connectSets, setActions } from './state/sets'
import { actions, sceneFileOf, store, useStore } from './state/store'
import { BuildStatus } from './ui/BuildStatus'
import { closingWhy, isExporting, leavingWhy, unkept, type Reason } from './closing'
import { unsentSessions } from './ui/chat/Composer'
import { paintings } from './tools/regionPainting'
import { WorkspaceQuestion } from './ui/WorkspaceQuestion'
import { openProblem } from './ui/openFolder'
import { InHand } from './ui/card/InHand'
import { RouteCard } from './ui/card/RouteCard'
import { SessionPane } from './ui/SessionPane'
import { ViewBoard } from './ui/drawing/ViewBoard'
import { BareControls, TitleBar } from './ui/TitleBar'
import { ShowPage, usePageKey } from './ui/ShowPage'
import { NewObject, openNewObject } from './ui/onboard/NewObject'
import { draftHas, onboard, onboarding } from './state/onboard'
import { ViewportPane } from './ui/ViewportPane'
import { BoardSwitch, useBoardSwapKey } from './ui/brief/BoardSwitch'
import { BriefPage } from './ui/brief/BriefPage'
import { FacePickBar } from './ui/tracings/NewTracing'
import { TracingView } from './ui/tracings/TracingView'
import { KeySheet, useKeysKey } from './ui/KeySheet'
import { LeaderLayer } from './ui/LeaderLayer'
import { ReadinessSheet, useReadyFeed } from './ui/Readiness'
import { Welcome } from './ui/Welcome'
import { giveKeysBack } from './ui/typing'
import { CARD_DEFAULT, sectionsFor, windowStorage } from './state/column'
import { clampDock, DOCK_MIN, dockDefault, readDock, writeDock } from './state/dock'

const KEY_STEP = 16

const SAVE_DELAY_MS = 500

function showWorkspace(info: WorkspaceInfo | null): void {
  actions.setWorkspace(info)
  if (!info) return
  // The kernel may still be starting: its versions arrive when it is ready.
  window.torno.workspace.versions().then(
    (versions) => {
      if (store.getState().workspace?.root === info.root) actions.setVersions(versions)
    },
    () => {} // a kernel that never started is reported by the first build
  )
}

async function pickWorkspace(): Promise<void> {
  const info = await window.torno.workspace.pick()
  if (info) showWorkspace(info) // null: the dialog was cancelled
}

/** Stand for the folder the person has yet to choose in the dialog, and for the copy of the example main makes. */
const PICK = 'pick'
const EXAMPLE = 'example'
/** Stands for the new folder the open example is kept in, at a path the person chooses in the dialog. */
const KEEP = 'keep'

/**
 * Leave the workspace for a folder, or for the one chosen in the dialog. A folder that cannot be opened leaves the
 * workspace as it is, and what could not be opened and why is the answer, to be said where the folder is named; null
 * when nothing went wrong (also when the dialog was cancelled).
 */
async function goTo(to: string): Promise<string | null> {
  const what = to === PICK ? 'The folder' : to === EXAMPLE ? 'The example' : to === KEEP ? 'The example' : basename(to)
  try {
    const info =
      to === PICK
        ? await window.torno.workspace.pick()
        : to === EXAMPLE
          ? await window.torno.workspace.openExample()
          : to === KEEP
            ? await window.torno.workspace.keepExample()
            : store.getState().workspace?.root === to
              ? null
              : await window.torno.workspace.open(to)
    if (info) showWorkspace(info) // null: the dialog was cancelled
    return null
  } catch (e) {
    return openProblem(what, e)
  }
}

/** The sessions of this workspace and the new object that opening another folder would end or throw away, as the question names them. */
function leavingReasons(): Reason[] {
  const s = store.getState()
  return leavingWhy({ sessions: Object.entries(s.sessions).map(([objectId, x]) => ({ objectId, status: x.status })), draft: draftHas(onboard.getState().draft) })
}

let opening = 0

/** Show an object as its scene file left it, and have main watch and build it. */
/**
 * From the export sheet: a project left out because it has no build of this run is opened as any opening does, and
 * when its build lands the sheet comes back with it ticked beside the rest. A build that fails, or the person going
 * elsewhere, brings nothing back.
 */
async function openThenExport(id: string, ticked: string[]): Promise<void> {
  actions.exportSheet(null)
  await openObject(id)
  const landed = (s: ReturnType<typeof store.getState>): boolean => s.objectId === id && s.scene !== null && s.revision > 0
  if (!landed(store.getState())) {
    const done = await new Promise<boolean>((resolve) => {
      const stop = (ok: boolean): void => {
        off()
        clearTimeout(timer)
        resolve(ok)
      }
      const off = store.subscribe((s) => {
        if (landed(s)) stop(true)
        else if (s.objectId !== id || s.build?.status === 'failed') stop(false)
      })
      const timer = setTimeout(() => stop(false), 120_000)
    })
    if (!done) return
  }
  actions.exportSheet(ticked.includes(id) ? ticked : [...ticked, id])
}

async function openObject(id: string): Promise<void> {
  const turn = ++opening
  // The one already open stays as it is: its selection, its camera, the note being written. From the page of objects it is gone back to.
  if (store.getState().objectId === id) return actions.showPage('object')
  const file = await window.torno.object.loadSceneFile(id).catch(() => ({ layers: {} }))
  if (turn !== opening) return // another object was chosen meanwhile
  actions.openObject(id, file)
  try {
    const state = await window.torno.object.open(id)
    // Its build events may have overtaken this answer; they are the newer.
    if (!store.getState().build) actions.applyBuild(state)
    // After the open: that is when main learns the folder of an object made a moment ago.
    await window.torno.marks.list(id).then(
      (marks) => actions.setMarks({ objectId: id, marks }),
      (e: unknown) => actions.setMarksProblem({ objectId: id, message: e instanceof Error ? e.message : String(e) })
    )
    // What main found wrong with the marks file is told once, and this window may not have been listening.
    const problem = await window.torno.marks.problem(id).catch(() => null)
    if (problem !== null) actions.setMarksProblem({ objectId: id, message: problem })
    // Their meshes are asked for by the viewport, one by one, once it knows which there are.
    await window.torno.scans.list(id).then(
      (scans) => actions.setScans({ objectId: id, scans }),
      () => {} // an object with no folder yet has no scans
    )
    // As for the marks: what main found wrong with the scans file is told once, and this window may not have been listening.
    const scansProblem = await window.torno.scans.problem(id).catch(() => null)
    if (scansProblem !== null) actions.setScansProblem({ objectId: id, message: scansProblem })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    actions.applyBuild({ objectId: id, status: 'failed', revision: 0, stale: false, error: { kind: 'open', message } })
  }
  // Opening scans the folder again: an object made a moment ago is in the list now.
  const info = await window.torno.workspace.current().catch(() => null)
  if (info) actions.refreshWorkspace(info)
}

/** Join the store to main: the workspace at start, build states, and saving the scene file. */
function useMain(): void {
  useEffect(() => {
    let live = true
    void window.torno.workspace.current().then((info) => {
      if (live && !store.getState().workspaceKnown) showWorkspace(info)
    })
    const offBuild = window.torno.object.onBuild(actions.applyBuild)
    const offMarks = window.torno.marks.onChanged(actions.setMarks)
    const offMarksProblem = window.torno.marks.onProblem(actions.setMarksProblem)
    const offScans = window.torno.scans.onChanged(actions.setScans)
    const offImporting = window.torno.scans.onProgress(actions.setImporting)
    const offScansProblem = window.torno.scans.onProblem(actions.setScansProblem)
    // Whatever the window shows, even nothing: a picture asked for is answered, or said at once to be none.
    const offLook = connectLook()
    // What the agent asked the person to choose (`ask`).
    const offAsks = connectAsks()
    // The board of the open project, read from main and followed.
    const offBoard = connectBoard()
    // The tracings of the open project, read from main and followed; main is told which is shown.
    const offTracings = connectTracings()
    // The rounds of the open project's review, read from main and followed.
    const offReview = connectReview()
    // What main found wrong with a project's sets file, as for the marks; listened for before the sets are read, which says it.
    const offSetsProblem = window.torno.sets.onProblem(setActions.problemTold)
    // The named sets of the open project, read from main and followed.
    const offSets = connectSets()

    // Layer and layout changes are written to <object>/.torno/scene.json, once they stop coming.
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsaved: (() => void) | null = null
    const flush = () => {
      clearTimeout(timer)
      unsaved?.()
      unsaved = null
    }
    const offStore = store.subscribe((s, prev) => {
      if (s.workspace?.root !== prev.workspace?.root) {
        // Main has left that workspace: the object the save was for is no longer there.
        clearTimeout(timer)
        unsaved = null
      } else if (s.objectId !== prev.objectId) {
        flush()
      } else if (s.edits !== prev.edits && s.objectId) {
        const id = s.objectId
        const file = sceneFileOf(s)
        unsaved = () => window.torno.object.saveSceneFile(id, file)
        clearTimeout(timer)
        // A saved view that was kept, renamed or removed is given to main at once: the agent asks main for the views by name.
        if (s.views !== prev.views) flush()
        else timer = setTimeout(flush, SAVE_DELAY_MS)
      }
    })
    window.addEventListener('pagehide', flush)

    return () => {
      live = false
      offBuild()
      offAsks()
      offBoard()
      offTracings()
      offReview()
      offSets()
      offSetsProblem()
      offMarks()
      offMarksProblem()
      offScans()
      offImporting()
      offScansProblem()
      offLook()
      offStore()
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
}

/**
 * The key that brings up the sheet of what goes into an export: of the open object, or from the page of
 * objects of any of them. It is heard everywhere, also in a field and in the terminal, which it never
 * reaches: before anything else hears of it. Not while a sheet of the export is already up.
 */
function useExportKey(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (!pressed(e, 'export')) return
      e.preventDefault()
      e.stopPropagation()
      const s = store.getState()
      // Not over the page of a new object: what is on show under it is not what would be exported.
      if (e.repeat || !s.workspace || s.exportOf !== null || s.page === 'new') return
      if (s.page === 'objects') actions.exportSheet('all')
      else if (s.objectId !== null) actions.exportSheet([s.objectId])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** The key that builds the open object again, as the button in the status line does: heard everywhere, like the export's. */
function useRebuildKey(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (!pressed(e, 'rebuild')) return
      e.preventDefault()
      e.stopPropagation()
      const { objectId, workspace } = store.getState()
      // Not while a build runs: there is nothing to start over (main would start none either).
      if (e.repeat || !workspace || objectId === null || store.getState().page === 'new' || store.getState().build?.status === 'building') return
      void window.torno.object.rebuild(objectId).catch(() => {})
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** The parts of the window F6 goes round, in reading order (the order of the DOM). */
const REGIONS = ['left', 'viewport', 'session', 'status'] as const
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex="0"], [data-chat-composer]:not([disabled])'

/** F6 and Shift+F6 go round the parts of the window, as a person with no pointer needs; the dock when it is hidden is passed over. */
function useRegionKeys(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const step = pressed(e, 'region.next') ? 1 : pressed(e, 'region.previous') ? -1 : 0
      if (step === 0) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      const regions = REGIONS.map((name) => document.querySelector<HTMLElement>(`[data-region="${name}"]`)).filter((el): el is HTMLElement => el !== null && !el.hidden)
      if (regions.length === 0) return
      const at = regions.findIndex((el) => el.contains(document.activeElement))
      for (let i = 1; i <= regions.length; i++) {
        const target = regions[(((at < 0 ? (step > 0 ? -1 : 0) : at) + step * i) % regions.length + regions.length) % regions.length]
        const first = target.querySelector<HTMLElement>(FOCUSABLE)
        if (first) {
          first.focus()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** The key that shows or hides the session pane, as the button at the edge does: heard everywhere. */
function useDockKey(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (!pressed(e, 'dock.toggle')) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat || store.getState().page === 'new') return
      actions.setDockOpen(!store.getState().dockOpen)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

export function App() {
  useMain()
  useReadyFeed()
  useRebuildKey()
  useRegionKeys()
  useDockKey()
  usePageKey()
  useKeysKey()
  useExportKey()
  useBoardSwapKey()
  const workspace = useStore((s) => s.workspace)
  const page = useStore((s) => s.page)
  const workspaceKnown = useStore((s) => s.workspaceKnown)
  const shell = useRef<HTMLDivElement>(null)
  // The route card stands at the left while a project is open, and is away on the pages (`sectionsFor`).
  const objectId = useStore((s) => s.objectId)
  const cardOpen = sectionsFor({ page, objectId }).length > 0
  // The width the person gave the dock, kept by the window; none until they do, and then the CSS default (`--dock-w`) stands.
  const [kept, setKept] = useState<number | null>(() => readDock(windowStorage()))
  const dockWidth = kept ?? dockDefault(window.innerWidth)
  // The page of a new project is the preview of the prompt itself: the dock is hidden while it is up, and comes back as it was.
  const dockOpen = useStore((s) => s.dockOpen && s.page !== 'new')
  // The brief takes the main area's place from the model, on the project's own page.
  const briefOf = useBoard((s) => (s.shown === 'brief' ? s.objectId : null))
  // So does a tracing, on the same page.
  const tracingOf = useBoard((s) => (s.shown === 'tracing' ? s.objectId : null))
  // While the edge is dragged the width goes straight to the CSS variable, so
  // React renders once at the end rather than on every pointer move.
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null)

  const leftNow = (): number => document.querySelector('.left')?.getBoundingClientRect().width ?? CARD_DEFAULT

  function onEdgeDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const startWidth = document.querySelector('.dock')?.getBoundingClientRect().width ?? dockWidth
    drag.current = { startX: e.clientX, startWidth, width: startWidth }
    shell.current!.toggleAttribute('data-resizing', true)
  }

  function onEdgeMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    d.width = clampDock(d.startWidth + d.startX - e.clientX, window.innerWidth, leftNow())
    shell.current!.style.setProperty('--dock-w', `${d.width}px`)
  }

  function onEdgeUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    drag.current = null
    shell.current!.toggleAttribute('data-resizing', false)
    // A press that moved nothing keeps what there was (the default stays the default of the window).
    if (d.width !== d.startWidth) keepDock(d.width)
    // Dragged with the pointer, the edge is done with: the next letter is the view's, not the session pane's.
    giveKeysBack(e.currentTarget)
  }

  function onEdgeKey(e: KeyboardEvent<HTMLDivElement>) {
    const way = which(e, 'dock.resize')
    if (way < 0) return
    e.preventDefault()
    const now = document.querySelector('.dock')?.getBoundingClientRect().width ?? dockWidth
    keepDock(clampDock(now + (way === 0 ? KEY_STEP : -KEY_STEP), window.innerWidth, leftNow()))
  }

  function keepDock(width: number): void {
    setKept(width)
    writeDock(windowStorage(), width)
  }

  // A window made smaller than the dock the person kept leaves the view its room: the width shown follows, what is kept does not.
  useEffect(() => {
    if (kept === null) return
    const fit = (): void => {
      const el = shell.current
      if (!el || el.hasAttribute('data-resizing')) return
      el.style.setProperty('--dock-w', `${clampDock(kept, window.innerWidth, leftNow())}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [kept])

  // Leaving a workspace ends its sessions. `leaving` is where to, while that is
  // being asked about: a folder, or 'pick' for the one still to be chosen.
  const [leaving, setLeaving] = useState<{ to: string; reasons: Reason[] } | null>(null)
  // What went wrong with the last folder asked for, said on the page of projects until the next action.
  const [openFailed, setOpenFailed] = useState<string | null>(null)
  // The sheet that says what torno needs, from the folder menu.
  const [checking, setChecking] = useState(false)
  const go = useCallback((to: string) => {
    setOpenFailed(null)
    void goTo(to).then((problem) => {
      setOpenFailed(problem)
      // It is said on the page of projects: the person is taken there to read it.
      if (problem !== null) actions.showPage('objects')
    })
  }, [])
  const leave = useCallback(
    (to: string) => {
      setOpenFailed(null)
      const reasons = leavingReasons()
      if (reasons.length === 0) return go(to)
      setLeaving({ to, reasons })
    },
    [go]
  )
  // Another launch of torno was given a folder: it is opened here.
  useEffect(() => window.torno.workspace.onRequested((root) => leave(root)), [leave])
  useEffect(() => {
    setLeaving(null)
    setOpenFailed(null)
  }, [workspace?.root])

  // Closing the window ends torno: asked first when that would cut something short, and at once otherwise.
  // Heard on every screen, the first one too: the window is held until this answers.
  const [closing, setClosing] = useState<Reason[] | null>(null)
  useEffect(
    () =>
      window.torno.workspace.onCloseAsked(() => {
        const s = store.getState()
        const sessions = Object.entries(s.sessions).map(([objectId, x]) => ({ objectId, ...x }))
        const chats = sessions.filter((x) => x.view === 'chat' && x.status !== 'exited')
        const unsent = new Set(unsentSessions(chats.map((x) => x.sessionId)))
        const why = closingWhy({
          sessions,
          paintings: unkept(paintings.values()),
          importing: s.importing !== null ? s.objectId : null,
          exporting: isExporting(),
          draft: draftHas(onboard.getState().draft),
          heldPrompts: onboarding.heldObjects(),
          unsent: chats.filter((x) => unsent.has(x.sessionId)).map((x) => x.objectId)
        })
        window.torno.workspace.answerClose(why.length === 0)
        setClosing(why.length === 0 ? null : why)
      }),
    []
  )
  useEffect(() => setClosing(null), [workspace?.root])
  // A name in either question: the question is put away, and the object (or the page of the new one) is shown.
  const showReason = useCallback((reason: Reason) => {
    setClosing(null)
    setLeaving(null)
    if (reason.objectId !== null) void openObject(reason.objectId)
    else if (reason.page === 'new') openNewObject()
  }, [])

  const revealDock = useCallback(() => actions.setDockOpen(true), [])

  // The page of projects says what is to be said of the folder: that the example is a temporary copy, and a folder that would not open.
  const projectNotes = (
    <>
      {/* For as long as the example is open: what is made here does not outlive torno, and it says so where the projects are. */}
      {workspace?.example && (
        <p className="workspace-example" role="note">
          {EXAMPLE_NOTE}{' '}
          <button type="button" className="link-button" disabled={leaving !== null} title="Copies this folder, with whatever was made in it, to a new folder you choose, and opens that one" onClick={() => leave(KEEP)}>
            Keep this as a folder…
          </button>
        </p>
      )}
      {openFailed !== null && (
        <p className="workspace-problem" role="alert">
          {openFailed}
        </p>
      )}
    </>
  )

  if (!workspaceKnown) return <div className="shell" />
  if (!workspace) {
    return (
      <div className="shell">
        <main className="viewport welcome" data-region="viewport">
          <Welcome onPick={() => void pickWorkspace()} onOpened={showWorkspace} />
        </main>
        <BareControls />
        <KeySheet />
      </div>
    )
  }

  return (
    <div
      ref={shell}
      className="shell"
      data-dock={dockOpen ? 'open' : 'collapsed'}
      data-left={cardOpen ? 'open' : 'away'}
      style={kept === null ? undefined : ({ '--dock-w': `${kept}px` } as CSSProperties)}
    >
      <TitleBar folder={workspace.root} disabled={leaving !== null} onChoose={(choice) => (choice === 'ready' ? setChecking(true) : leave(choice === 'pick' ? PICK : choice === 'example' ? EXAMPLE : choice.root))} onOpen={(id) => void openObject(id)} />
      <aside className="left" data-region="left" aria-label="Panels">
        {cardOpen && <RouteCard head={<InHand />} shell={shell} />}
      </aside>

      <main className="viewport" data-region="viewport">
        {/* First in the region, so that the focus a region key gives lands on it. */}
        <BoardSwitch />
        <ViewportPane />
        {page === 'object' && briefOf !== null && <BriefPage key={briefOf} />}
        {page === 'object' && tracingOf !== null && <TracingView key={tracingOf} />}
        {/* Over the model: a tracing on a face waits for the face. */}
        <FacePickBar />
        {page === 'objects' && <ShowPage onOpen={openObject} onExample={() => leave(EXAMPLE)} notes={projectNotes} />}
        {page === 'new' && <NewObject onOpen={openObject} />}
        {/* Over the view: a drawing on it for the chat, while its board is open. */}
        <ViewBoard />
      </main>

      <aside className="dock" data-region="session" aria-label="Session" hidden={!dockOpen}>
        <div
          className="dock-edge"
          role="separator"
          aria-label="Resize session"
          aria-orientation="vertical"
          aria-valuenow={dockWidth}
          aria-valuemin={DOCK_MIN}
          tabIndex={0}
          onPointerDown={onEdgeDown}
          onPointerMove={onEdgeMove}
          onPointerUp={onEdgeUp}
          onPointerCancel={onEdgeUp}
          onKeyDown={onEdgeKey}
        />
        <SessionPane onReveal={revealDock} onExport={openThenExport} />
      </aside>

      {/* Over everything but the keys: the window's own questions, closing torno and leaving the folder. */}
      {closing !== null && (
        <WorkspaceQuestion
          label="Close torno?"
          lead="Closing torno ends every session in it and cuts these short:"
          reasons={closing}
          accept="Close torno"
          cancel="Keep it open"
          onCancel={() => setClosing(null)}
          onAccept={() => {
            setClosing(null)
            window.torno.workspace.answerClose(true)
          }}
          onGo={showReason}
        />
      )}
      {leaving !== null && (
        <WorkspaceQuestion
          label={leaving.reasons.some((r) => r.objectId !== null && r.page === undefined) ? 'End the sessions of this folder?' : 'Leave this folder?'}
          lead="Opening another folder ends the sessions of this one and cuts these short:"
          reasons={leaving.reasons}
          accept="Open another folder"
          cancel="Stay here"
          onCancel={() => setLeaving(null)}
          onAccept={() => {
            const to = leaving.to
            setLeaving(null)
            go(to)
          }}
          onGo={showReason}
        />
      )}
      <BuildStatus onOpen={(id) => void openObject(id)} />
      {checking && <ReadinessSheet onClose={() => setChecking(false)} />}
      {/* The leaders of the view: over the panes, under the popovers. Empty until a tool or a pointer gives it one. */}
      <LeaderLayer />
      {/* Over everything: the keys, asked for with ? or at the foot of the tools. */}
      <KeySheet />
    </div>
  )
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}
