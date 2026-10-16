import { pressed, which } from '../shared/keys'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { busyWith } from '../shared/agents'
import { EXAMPLE_NOTE, type WorkspaceInfo } from '../shared/workspace'
import { connectLook } from './state/agent'
import { actions, sceneFileOf, store, useStore } from './state/store'
import { BuildStatus } from './ui/BuildStatus'
import { closingWhy, isExporting, unkept } from './closing'
import { unsentPrompts } from './ui/chat/Composer'
import { paintings } from './tools/regionPainting'
import { Confirm } from './ui/Confirm'
import { Layers } from './ui/Layers'
import { MarksPanel } from './ui/MarksPanel'
import { ObjectList } from './ui/ObjectList'
import { ScansPanel } from './ui/ScansPanel'
import { SessionPane } from './ui/SessionPane'
import { ExportSheet } from './ui/ExportSheet'
import { ViewBoard } from './ui/drawing/ViewBoard'
import { FolderMenu } from './ui/FolderMenu'
import { ShowPage, usePageKey } from './ui/ShowPage'
import { NewObject } from './ui/onboard/NewObject'
import { draftHas, onboard, onboarding } from './state/onboard'
import { ViewportPane } from './ui/ViewportPane'
import { KeySheet, useKeysKey } from './ui/KeySheet'
import { Welcome } from './ui/Welcome'
import { giveKeysBack } from './ui/typing'

const LEFT_WIDTH = 248
const DOCK_DEFAULT = 520
const DOCK_MIN = 320
const VIEWPORT_MIN = 240 // free viewport width the dock always leaves beside the left column
const KEY_STEP = 16

function clampDock(width: number): number {
  const max = Math.max(DOCK_MIN, window.innerWidth - LEFT_WIDTH - VIEWPORT_MIN)
  return Math.round(Math.min(Math.max(width, DOCK_MIN), max))
}

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

/** Leave the workspace for a folder, or for the one chosen in the dialog. */
async function goTo(to: string): Promise<void> {
  if (to === PICK) return pickWorkspace()
  if (to === EXAMPLE) {
    const info = await window.torno.workspace.openExample().catch(() => null)
    if (info) showWorkspace(info)
    return
  }
  if (store.getState().workspace?.root === to) return
  // A folder that cannot be opened leaves the workspace as it is; main has said why on stderr.
  const info = await window.torno.workspace.open(to).catch(() => null)
  if (info) showWorkspace(info)
}

/**
 * What a session of this workspace is in the middle of that leaving the workspace would end, as a sentence; null
 * when none is.
 */
function sessionsBusy(): string | null {
  const busy = Object.values(store.getState().sessions).some((s) => busyWith(s.status) !== undefined)
  return busy ? 'A session here is in the middle of its work.' : null
}

/** What leaving the workspace would throw away besides the sessions: a new object set up on its page and not made. */
function draftLeft(): string | null {
  return draftHas(onboard.getState().draft) ? 'A new object is set up here and not made yet.' : null
}

let opening = 0

/** Show an object as its scene file left it, and have main watch and build it. */
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

export function App() {
  useMain()
  useRebuildKey()
  usePageKey()
  useKeysKey()
  useExportKey()
  const workspace = useStore((s) => s.workspace)
  const page = useStore((s) => s.page)
  const workspaceKnown = useStore((s) => s.workspaceKnown)
  const [errorOpen, setErrorOpen] = useState(false)
  const shell = useRef<HTMLDivElement>(null)
  const [dockWidth, setDockWidth] = useState(DOCK_DEFAULT)
  const [dockOpen, setDockOpen] = useState(true)
  // While the edge is dragged the width goes straight to the CSS variable, so
  // React renders once at the end rather than on every pointer move.
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null)

  function onEdgeDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: dockWidth, width: dockWidth }
    shell.current!.toggleAttribute('data-resizing', true)
  }

  function onEdgeMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    d.width = clampDock(d.startWidth + d.startX - e.clientX)
    shell.current!.style.setProperty('--dock-w', `${d.width}px`)
  }

  function onEdgeUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    drag.current = null
    shell.current!.toggleAttribute('data-resizing', false)
    setDockWidth(d.width)
    // Dragged with the pointer, the edge is done with: the next letter is the view's, not the session pane's.
    giveKeysBack(e.currentTarget)
  }

  function onEdgeKey(e: KeyboardEvent<HTMLDivElement>) {
    const way = which(e, 'dock.resize')
    if (way < 0) return
    e.preventDefault()
    setDockWidth((w) => clampDock(w + (way === 0 ? KEY_STEP : -KEY_STEP)))
  }

  // Leaving a workspace ends its sessions. `leaving` is where to, while that is
  // being asked about: a folder, or 'pick' for the one still to be chosen.
  const [leaving, setLeaving] = useState<string | null>(null)
  const [leavingWhat, setLeavingWhat] = useState('')
  const [leavingLabel, setLeavingLabel] = useState('')
  const leave = useCallback((to: string) => {
    const busy = sessionsBusy()
    const draft = draftLeft()
    if (busy === null && draft === null) return void goTo(to)
    setLeavingWhat([busy === null ? null : `${busy} Opening another folder ends it.`, draft === null ? null : `${draft} Opening another folder throws it away.`].filter((x) => x !== null).join(' '))
    setLeavingLabel(busy === null ? 'Leave this folder?' : 'End the sessions of this folder?')
    setLeaving(to)
  }, [])
  // Another launch of torno was given a folder: it is opened here.
  useEffect(() => window.torno.workspace.onRequested((root) => leave(root)), [leave])
  useEffect(() => setLeaving(null), [workspace?.root])

  // Closing the window ends torno: asked first when that would cut something short, and at once otherwise.
  // Heard on every screen, the first one too: the window is held until this answers.
  const [closing, setClosing] = useState<string | null>(null)
  useEffect(
    () =>
      window.torno.workspace.onCloseAsked(() => {
        const s = store.getState()
        const why = closingWhy({ sessions: Object.values(s.sessions), paintings: unkept(paintings.values()), importing: s.importing !== null, exporting: isExporting(), draft: draftHas(onboard.getState().draft), heldPrompt: onboarding.heldUnsent() > 0, unsent: unsentPrompts(Object.values(s.sessions).filter((x) => x.view === 'chat' && x.status !== 'exited').map((x) => x.sessionId)) })
        window.torno.workspace.answerClose(why === null)
        setClosing(why)
      }),
    []
  )
  useEffect(() => setClosing(null), [workspace?.root])

  const errorOpened = useCallback((open: boolean) => setErrorOpen(open), [])
  const revealDock = useCallback(() => setDockOpen(true), [])

  if (!workspaceKnown) return <div className="shell" />
  if (!workspace) {
    return (
      <div className="shell">
        <main className="viewport welcome" data-region="viewport">
          <Welcome onPick={() => void pickWorkspace()} onOpened={showWorkspace} />
        </main>
        <KeySheet />
      </div>
    )
  }

  return (
    <div
      ref={shell}
      className="shell"
      data-dock={dockOpen ? 'open' : 'collapsed'}
      style={{ '--dock-w': `${dockWidth}px` } as CSSProperties}
    >
      <main className="viewport" data-region="viewport">
        <ViewportPane onShowError={() => setErrorOpen(true)} />
        {page === 'objects' && <ShowPage onOpen={(id) => void openObject(id)} />}
        {page === 'new' && <NewObject onOpen={openObject} />}
        {/* Over either: what goes into an export, asked before anything is written. */}
        <ExportSheet />
        {/* Over the view: a drawing on it for the chat, while its board is open. */}
        <ViewBoard />
      </main>

      <aside className="left" data-region="left" aria-label="Objects, layers, scans and marks">
        <header className="panel-head">
          <h1 className="workspace-name" title={workspace.root}>
            {basename(workspace.root)}
          </h1>
          {/* The way to another folder: those opened lately, the dialog, the example. */}
          <FolderMenu open={workspace.root} disabled={leaving !== null} onChoose={(choice) => leave(choice === 'pick' ? PICK : choice === 'example' ? EXAMPLE : choice.root)} />
        </header>
        {/* For as long as the example is open: what is made here does not outlive torno, and it says so where the folder is named. */}
        {workspace.example && (
          <p className="workspace-example" role="note">
            {EXAMPLE_NOTE}
          </p>
        )}
        {closing !== null && (
          <Confirm
            label="Close torno?"
            accept="Close torno"
            cancel="Keep it open"
            onCancel={() => setClosing(null)}
            onAccept={() => {
              setClosing(null)
              window.torno.workspace.answerClose(true)
            }}
          >
            {closing} Closing torno ends it.
          </Confirm>
        )}
        {leaving !== null && (
          <Confirm
            label={leavingLabel}
            accept="Open another folder"
            cancel="Stay here"
            onCancel={() => setLeaving(null)}
            onAccept={() => {
              setLeaving(null)
              void goTo(leaving)
            }}
          >
            {leavingWhat}
          </Confirm>
        )}
        <ObjectList onOpen={(id) => void openObject(id)} />
        {/* While the page of objects is up, the layers and the scans act on a view that is not on screen: they give way. The marks stay: they say why a card has a failing chip. On the New object page the marks give way too: no tool works there. */}
        {page === 'object' && <Layers />}
        {page === 'object' && <ScansPanel />}
        {page !== 'new' && <MarksPanel />}
      </aside>

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
        <SessionPane onReveal={revealDock} />
      </aside>

      <button
        type="button"
        className="dock-toggle"
        aria-label={dockOpen ? 'Hide session' : 'Show session'}
        aria-expanded={dockOpen}
        title={dockOpen ? 'Hide session' : 'Show session'}
        onClick={() => setDockOpen((open) => !open)}
      >
        <DockIcon />
      </button>

      <BuildStatus errorOpen={errorOpen} onErrorOpen={errorOpened} />
      {/* Over everything: the keys, asked for with ? or at the foot of the tools. */}
      <KeySheet />
    </div>
  )
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

function DockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" />
      <path d="M10 2.75v10.5" />
    </svg>
  )
}
