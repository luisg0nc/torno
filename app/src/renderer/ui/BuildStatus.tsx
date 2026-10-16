import { useEffect, useState } from 'react'
import { letGoText } from '../../shared/build'
import { hint } from '../../shared/keys'
import { unmetDimensions } from '../../shared/dimension'
import { actions, partsInLayout, useStore } from '../state/store'
import { BuildErrorSheet } from './BuildErrorSheet'
import { UNCHECKED_AFTER_MS, useLasting } from './MarkRow'

/** `2 dimensions fail`, `1 dimension not measured`. */
export function dimensionCount(count: number, what: 'fail' | 'not measured'): string {
  return `${count === 1 ? 'dimension' : 'dimensions'} ${what === 'fail' && count === 1 ? 'fails' : what}`
}

/**
 * Goes to a mark as its row does (`focusMark`: its layout is shown when it is
 * of another, and it is the active one), and brings its row into view in the
 * marks panel. One of a layout the build no longer has is only made active.
 */
export function goToRow(id: string): void {
  actions.focusMark(id)
  actions.setActiveMark(id)
  // Its row is there already, whichever layout is shown: an open mark is never folded away.
  document.querySelector(`.mark-row[data-mark="${id}"]`)?.scrollIntoView({ block: 'nearest' })
}

/** Whole seconds since `startedAt`, counted once a second while a build runs. */
function useElapsed(startedAt: number | undefined): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startedAt === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
}

/** A duration to a tenth of a second, to whole seconds from ten up; never shown as nothing. */
function seconds(s: number): string {
  return s < 10 ? Math.max(s, 0.1).toFixed(1) : String(Math.round(s))
}

/**
 * The status line: which object, how its last build went, which revision is on
 * screen, and the kernel at the far right. A failed build is a button that
 * opens the error sheet. Beside the build it says how many dimensions the
 * build on show fails, and how many have no value of it; either goes to the
 * first such in the marks panel.
 */
export function BuildStatus({ errorOpen, onErrorOpen }: { errorOpen: boolean; onErrorOpen: (open: boolean) => void }) {
  const name = useStore((s) => s.workspace?.objects.find((o) => o.id === s.objectId)?.name ?? s.objectId)
  const build = useStore((s) => s.build)
  const hasScene = useStore((s) => s.scene !== null)
  const partCount = useStore((s) => partsInLayout(s).length)
  const build123d = useStore((s) => s.versions.build123d)
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

  // The sheet shows the failure of the build it was opened for, no longer.
  useEffect(() => {
    if (errorOpen && !error) onErrorOpen(false)
  }, [errorOpen, error, onErrorOpen])

  return (
    <footer className="status" data-region="status">
      {creating ? (
        <span className="status-name">New object</span>
      ) : name === null || !build ? (
        <span>{name === null ? 'No object open' : name}</span>
      ) : (
        <>
          <span className="status-name">{name}</span>
          <span className="status-build" data-status={build.status}>
            {/* While a build runs its dot beats with the count of its seconds: once a second, by this render, and by no animation that runs on. */}
            <span className="status-dot" data-beat={building && elapsed % 2 === 1 ? 'off' : undefined} aria-hidden="true" />
            {build.status === 'building' && (
              <span>
                Building <span className="num">{elapsed}</span> s
              </span>
            )}
            {build.status === 'ok' && (
              <span>Built{build.seconds !== undefined && <> in <span className="num">{seconds(build.seconds)}</span> s</>}</span>
            )}
            {build.status === 'failed' && (
              <button type="button" className="status-fail" aria-expanded={errorOpen} onClick={() => onErrorOpen(!errorOpen)}>
                Build failed
              </button>
            )}
            {build.status === 'idle' && <span>Not built yet</span>}
          </span>
          {/* Always there: the one way to build again by hand. The thing to press when the last build failed or was let go. */}
          <button
            type="button"
            className="status-rebuild"
            data-primary={build.status === 'failed' || letGoText(build) ? '' : undefined}
            title={building ? 'A build is running: it is of the sources as they are' : `Build ${name} again from its sources as they are (${hint('rebuild')})`}
            // While a build runs there is nothing to start over: it says so, and takes no press.
            disabled={building}
            onClick={() => objectId !== null && void window.torno.object.rebuild(objectId).catch(() => {})}
          >
            {building ? 'Building…' : 'Rebuild'}
          </button>
          {letGoText(build) && <span className="status-letgo" data-part="let-go">{letGoText(build)}</span>}
          {build.revision > 0 && (
            <span data-part="revision">
              {build.stale && 'showing '}
              <span className="num">r{build.revision}</span>
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
        </>
      )}
      <span className="spacer" />
      {/* The open object, as one HTML file. With the page of objects up, the page has the button for them all. */}
      {objectId !== null && !paged && !creating && (
        <button type="button" className="status-export" title="Export this object to one HTML file that opens by itself" onClick={() => actions.exportSheet([objectId])}>
          Export…
        </button>
      )}
      {build123d && <span className="num">build123d {build123d}</span>}
      {errorOpen && error && name !== null && (
        <BuildErrorSheet objectName={name} error={error} onClose={() => onErrorOpen(false)} />
      )}
    </footer>
  )
}
