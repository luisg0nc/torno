import { useEffect } from 'react'
import { buildingText, letGoText, rebuildHelps } from '../../shared/build'
import { landingText } from '../../shared/diff'
import { hint } from '../../shared/keys'
import { isCheck, unmetDimensions } from '../../shared/dimension'
import type { Part } from '../../shared/scene'
import { partDefects } from '../../shared/sanity'
import { makesEnvironment } from './readyLines'
import { landedOn } from '../state/landing'
import { compareStatus } from '../state/compare'
import { useSets } from '../state/sets'
import { actions, partsInLayout, store, useStore } from '../state/store'
import { BuildErrorSheet } from './BuildErrorSheet'
import { withRefs } from './CompareBar'
import { UNCHECKED_AFTER_MS, useLasting } from './MarkRow'
import { AGENT_LABEL } from '../../shared/agents'
import { focusAsk, waitingObjects } from './sessionSign'
import { gitFilesSaid } from '../../shared/git'
import { GitText } from './GitText'
import { showKeys } from './KeySheet'
import { ProfileChip } from './ProfileChip'
import { useGit } from './useGit'
import { useElapsed } from './useElapsed'
import { ticksOf } from './strip/strip'
import { useFailedAnchor } from './strip/failedAnchor'
import { useStripNodes } from './strip/useStripNodes'
import { SavedFile, letGoOnBuild } from './SavedFile'
import { useKept } from '../state/exportSaved'

/** `2 dimensions fail`, `1 dimension not measured`. */
export function dimensionCount(count: number, what: 'fail' | 'not measured'): string {
  return `${count === 1 ? 'dimension' : 'dimensions'} ${what === 'fail' && count === 1 ? 'fails' : what}`
}

/** The parts with a defect, a part each: `tub: not valid, inside out; lid: not closed`. '' when there is none. */
export function defectsSaid(parts: readonly Part[]): string {
  return parts
    .map((p) => ({ name: p.name, found: partDefects(p) }))
    .filter((p) => p.found.length > 0)
    .map((p) => `${p.name}: ${p.found.join(', ')}`)
    .join('; ')
}

/**
 * Goes to a mark as its row does (`selectMark`: its layout is shown when it is
 * of another, it is the active one, and the camera moves only when it is not in
 * view), and brings its row into view in the marks panel. One of a layout the
 * build no longer has is only made active.
 */
export function goToRow(id: string): void {
  // A list cut to one part may not hold its row.
  actions.listMarksOnPart(null)
  actions.selectMark(id)
  actions.setActiveMark(id)
  // A dimension check's row is under Checks (the one that is a mark's own opens below it once it is the active mark), any other
  // mark's under Marks.
  const mark = store.getState().marks.find((m) => m.id === id)
  const check = mark !== undefined && isCheck(mark)
  const row = check ? `.check-row[data-check-mark="${id}"]` : `.mark-row[data-mark="${id}"]`
  // Its row is there already, whichever layout is shown: an open mark is never folded away. Unless its section of the card is folded:
  // then the section is unfolded and brought into sight first, and the row once it is drawn.
  if (document.querySelector(row) !== null) return document.querySelector(row)?.scrollIntoView({ block: 'nearest' })
  actions.showSection(check ? 'checks' : 'marks')
  const scroll = (): void => document.querySelector(row)?.scrollIntoView({ block: 'nearest' })
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(scroll))
  else scroll()
}

/**
 * While a build runs: which build it makes, how long it has run, and which one is on show (`Building r13 · 1:40 · you are
 * on r12`). The tools work on the one on show, and the marks made meanwhile are of it. Before a first build has landed
 * there is no number to give.
 */
export function BuildingSaid({ shownRevision, seconds }: { shownRevision: number; seconds: number }) {
  const said = buildingText(shownRevision, seconds)
  return (
    <span data-part="building">
      Building {said.running && <span className="num">{said.running}</span>}
      {said.running && ' · '}
      <span className="num">{said.clock}</span>
      {said.shown && (
        <>
          {' · you are on '}
          <span className="num">{said.shown}</span>
        </>
      )}
    </span>
  )
}

/** A duration to a tenth of a second, to whole seconds from ten up; never shown as nothing. */
export function seconds(s: number): string {
  return s < 10 ? Math.max(s, 0.1).toFixed(1) : String(Math.round(s))
}

/**
 * The status line: which object, how its last build went, which revision is on
 * screen, and the kernel at the far right. A failed build is a button that
 * opens the error sheet. Beside the build it says how many dimensions the
 * build on show fails, and how many have no value of it; either goes to the
 * first such in the marks panel. After the count of parts, how many of the
 * layout's parts the build says are broken (`partDefects`), each in the title.
 * At the far right, before the export, the first object (in the list's order) whose
 * session waits for the person: a button that opens it, shows the dock and goes to
 * the card. It is there whichever object, page or state of the dock is shown.
 */
export function BuildStatus({ onOpen }: { onOpen: (id: string) => void }) {
  const errorOpen = useStore((s) => s.errorOpen)
  const name = useStore((s) => s.workspace?.objects.find((o) => o.id === s.objectId)?.name ?? s.objectId)
  const build = useStore((s) => s.build)
  const hasScene = useStore((s) => s.scene !== null)
  const partCount = useStore((s) => partsInLayout(s).length)
  // A string, so that the store hands the same value while nothing changed.
  const defects = useStore((s) => defectsSaid(partsInLayout(s)))
  const broken = defects === '' ? 0 : defects.split('; ').length
  const build123d = useStore((s) => s.versions.build123d)
  // What the build on show did to the parts, against the build before it of the same object ('' for a first build). Strings, so that the line is drawn again only when they change.
  const landedText = useStore((s) => {
    const told = landedOn(s)
    return told ? landingText(told) : ''
  })
  const landedLines = useStore((s) => landedOn(s)?.lines.join('\n') ?? '')
  // The kernel is starting and torno's own Python environment is not made: this build is the one that makes it, once.
  const firstTime = useStore((s) => makesEnvironment(s.ready))
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const { failing, unmeasured } = unmetDimensions(marks, revision)
  // Every build leaves every dimension unmeasured for the moment the measuring takes: said only when it lasts.
  const waiting = useLasting(unmeasured.length > 0, UNCHECKED_AFTER_MS)
  const objectId = useStore((st) => st.objectId)
  const paged = useStore((st) => st.page === 'objects')
  // The New object page: the line is of the object being made, and nothing of the one that was open is offered.
  const creating = useStore((st) => st.page === 'new')
  const building = build?.status === 'building'
  const elapsed = useElapsed(building ? build.startedAt : undefined)
  const error = build?.status === 'failed' ? build.error : undefined
  // Strings, so that the line is drawn again only when who waits changes.
  const asking = useStore((s) => waitingObjects(s.workspace?.objects ?? [], s.sessions).map((o) => o.name).join('\n'))
  const askingId = useStore((s) => waitingObjects(s.workspace?.objects ?? [], s.sessions)[0]?.id ?? null)
  const askingNames = asking === '' ? [] : asking.split('\n')
  // What git says of the sources: read by main, never written.
  const git = useGit()

  // The last builds as ticks, and the build on show for the line that says how it went.
  const strip = useStripNodes()
  const ticks = ticksOf(strip.nodes)
  const shownId = strip.nodes.find((n) => n.onShow)?.id
  // The error of the failed build stands from its node in the strip, or from this line when the strip is not drawn.
  const failedAfter = strip.nodes.findLast((n) => n.kind === 'failed')?.after
  const failedNode = useFailedAnchor()
  // The file an export wrote stands where Export… is until the next build begins, or a minute (`state/exportSaved.ts`).
  const kept = useKept((st) => st.file !== null)
  useEffect(() => {
    if (building) letGoOnBuild()
  }, [building])
  const compare = useStore((st) => st.compare)
  // Why Ctrl+G did nothing, for a moment.
  const setSaid = useSets((s) => s.said)

  // The sheet shows the failure of the build it was opened for, no longer.
  useEffect(() => {
    if (errorOpen && !error) actions.setErrorOpen(false)
  }, [errorOpen, error])

  return (
    <footer className="status" data-region="status">
      {creating ? (
        <span className="status-name">New project</span>
      ) : name === null || !build ? (
        <span>{name === null ? 'No project open' : name}</span>
      ) : (
        <>
          <span className="status-name">{name}</span>
          {ticks.length > 0 && (
            <span className="status-ticks" role="img" aria-label={`The last ${ticks.length === 1 ? 'build' : `${ticks.length} builds`}${shownId ? `, ${shownId} on show` : ''}`} data-part="ticks">
              {ticks.map((tick) => (
                <span key={tick.id} className="status-tick" data-kind={tick.kind} data-on-show={tick.onShow ? '' : undefined} data-saved={tick.saved ? '' : undefined} data-build={tick.id} />
              ))}
            </span>
          )}
          <span className="status-build" data-status={build.status}>
            {/* While a build runs its dot beats with the count of its seconds: once a second, by this render, and by no animation that runs on. */}
            <span className="status-dot" data-beat={building && elapsed % 2 === 1 ? 'off' : undefined} aria-hidden="true" />
            {build.status === 'building' && !firstTime && <BuildingSaid shownRevision={hasScene ? build.revision : 0} seconds={elapsed} />}
            {build.status === 'building' && firstTime && <span>Making torno's Python environment, first time only</span>}
            {build.status === 'ok' && (
              <span>
                {shownId ? <><span className="num">{shownId}</span> built</> : 'Built'}
                {build.seconds !== undefined && <> in <span className="num">{seconds(build.seconds)}</span> s</>}
              </span>
            )}
            {build.status === 'ok' && hasScene && landedText !== '' && (
              <span className="status-landed" data-part="landing" title={landedLines === '' ? undefined : `Since the build before:\n${landedLines}`}>
                {landedText}
              </span>
            )}
            {build.status === 'failed' && (
              <button type="button" className="status-fail" aria-expanded={errorOpen} onClick={() => actions.setErrorOpen(!errorOpen)}>
                Build failed
              </button>
            )}
            {build.status === 'idle' && <span>Not built yet</span>}
          </span>
          {/* Always there: the one way to build again by hand. The thing to press when the last build was let go, or failed outside the model (a crash, a timeout, a cancel); after an error in the model the sources are what is to change. */}
          <button
            type="button"
            className="status-rebuild"
            data-primary={rebuildHelps(build) ? '' : undefined}
            title={building ? 'A build is running: it is of the sources as they are' : `Build ${name} again from its sources as they are (${hint('rebuild')})`}
            // While a build runs there is nothing to start over: it says so, and takes no press.
            disabled={building}
            onClick={() => objectId !== null && void window.torno.object.rebuild(objectId).catch(() => {})}
          >
            {building ? 'Building…' : 'Rebuild'}
          </button>
          {letGoText(build) && <span className="status-letgo" data-part="let-go">{letGoText(build)}</span>}
          {build.revision > 0 && !building && (
            <span data-part="revision">
              {build.stale && 'showing '}
              <span className="num">r{build.revision}</span>
            </span>
          )}
          {compare !== null && (
            <span className="status-compare" role="status" title="Two builds are compared in the view, for looking only. Back to the live build ends it" data-part="compare">
              {withRefs(compareStatus(compare))}
            </span>
          )}
          {git && (
            <span className="status-git" data-part="git" title={git.changed > 0 ? gitFilesSaid(git) : undefined}>
              <GitText git={git} />
            </span>
          )}
          {hasScene && failing.length > 0 && (
            <button type="button" className="status-dimensions" data-state="fail" title={`Not what was expected on r${revision}: ${failing.map((m) => m.id).join(', ')}. Go to the first`} onClick={() => goToRow(failing[0].id)}>
              <span className="num">{failing.length}</span> {dimensionCount(failing.length, 'fail')}
            </button>
          )}
          {hasScene && waiting && unmeasured.length > 0 && (
            <button type="button" className="status-dimensions" data-state="unmeasured" title={`No value on r${revision}: ${unmeasured.map((m) => m.id).join(', ')}. Go to the first`} onClick={() => goToRow(unmeasured[0].id)}>
              <span className="num">{unmeasured.length}</span> {dimensionCount(unmeasured.length, 'not measured')}
            </button>
          )}
          {hasScene && (
            <span data-part="parts">
              <span className="num">{partCount}</span> {partCount === 1 ? 'part' : 'parts'}
            </span>
          )}
          {hasScene && broken > 0 && (
            <span className="status-defects" data-part="defects" title={`Of r${revision}: ${defects}`}>
              <span className="num">{broken}</span> {broken === 1 ? 'part has a defect' : 'parts have defects'}
            </span>
          )}
        </>
      )}
      {/* Always there, so that a screen reader is told when it fills: why Ctrl+G did nothing. */}
      <span className="status-said" role="status" data-notice="sets">
        {setSaid}
      </span>
      <span className="spacer" />
      {/* Always there, so that a screen reader is told when it fills: a session somewhere waits for the answer. */}
      <span className="status-asking" role="status">
        {askingId !== null && (
          <button
            type="button"
            className="status-needs"
            title={`${AGENT_LABEL} waits for your answer in ${askingNames.join(', ')}. Go to ${askingNames[0]}`}
            onClick={() => {
              actions.setDockOpen(true)
              // Its object is shown first, and from a page over it back to the object; the card is then there to be reached.
              onOpen(askingId)
              focusAsk(askingId)
            }}
          >
            <span className="status-dot" aria-hidden="true" />
            <span>
              <span className="status-needs-name">{askingNames[0]}</span> needs you
              {askingNames.length > 1 && <>, and <span className="num">{askingNames.length - 1}</span> more</>}
            </span>
          </button>
        )}
      </span>
      {/* The printer and the material of the open project: a chip that opens its choosers. */}
      {objectId !== null && !paged && !creating && <ProfileChip />}
      {/* The open object, as one HTML file or a file of the model. With the page of objects up, the page has the button for them all. */}
      {kept ? (
        <SavedFile />
      ) : (
        objectId !== null &&
        !paged &&
        !creating && (
          <button type="button" className="status-export" title="Export this project: one HTML file that opens by itself, or a STEP, STL or 3MF file" onClick={() => actions.exportSheet([objectId])}>
            Export…
          </button>
        )
      )}
      <button type="button" className="status-keys" data-keys-button aria-label="Keys" aria-keyshortcuts={hint('keys')} title={`Every key, and how the pointer turns, pans and zooms the view (${hint('keys')})`} onClick={() => showKeys()}>
        ?
      </button>
      {build123d && <span className="num">build123d {build123d}</span>}
      {errorOpen && error && name !== null && (
        <BuildErrorSheet objectName={name} error={error} after={failedAfter} anchor={failedNode} onClose={() => actions.setErrorOpen(false)} />
      )}
    </footer>
  )
}
