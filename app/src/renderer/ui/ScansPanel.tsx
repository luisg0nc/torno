import { hint } from '../../shared/keys'
import { useEffect, useState, type ReactNode } from 'react'
import { type ScanInfo, type ScanUnit, type ScanUp, MIN_SCAN_OPACITY, UNIT_MM, importText } from '../../shared/scans'
import { setAlignScan, startedFrom } from '../state/align'
import { actions, store, useStore } from '../state/store'
import { setTool } from '../state/tools'
import { Confirm } from './Confirm'
import { EyeIcon } from './Layers'
import { capital, numbered } from './numbered'
import { importScan, reimportScan } from './scanDrop'
import { guessOf, scanState } from './scanState'
import { chosen, pointerChoice } from './typing'

/** What the import process says it is doing, in the panel's words; a stage with no entry is said as it is. */
const STAGE: Record<string, string> = { hashing: 'checking the file' }
const UNITS = Object.keys(UNIT_MM) as ScanUnit[]

/** Has main told why something asked of the scans came to nothing, while their object is still the open one. */
function asked(objectId: string, call: Promise<unknown>): Promise<void> {
  actions.setScansRefused(null)
  return call.then(
    () => {},
    (e: unknown) => {
      if (store.getState().objectId === objectId) actions.setScansRefused(e instanceof Error ? e.message : String(e))
    }
  )
}

/**
 * The scans of the open object, below the layers: surroundings the parts are
 * looked at in. A row says what a scan is, how it was read and whether it is
 * aligned in the layout shown, and switches and thins it like a layer. How a
 * scan is looked at is the person's, kept with the view; what a scan is, is
 * main's.
 */
export function ScansPanel() {
  const objectId = useStore((s) => s.objectId)
  const scans = useStore((s) => s.scans)
  const importing = useStore((s) => s.importing)
  const refused = useStore((s) => s.scansRefused)
  const problem = useStore((s) => s.scansProblem)

  if (!objectId) return null

  const pick = async (): Promise<void> => {
    const path = await window.torno.scans.pick().catch(() => null)
    if (path !== null) importScan(objectId, path)
  }

  return (
    <section className="section scans" aria-label="Scans">
      <div className="section-head">
        <h2 className="section-title">Scans</h2>
        <button type="button" className="button button-quiet" title={importing ? `${importing.name} is still being read` : 'Import a scan: GLB, glTF, OBJ, PLY or STL'} disabled={importing !== null} onClick={() => void pick()}>
          Import scan…
        </button>
      </div>
      {/* What main found wrong with the scans file of this object. */}
      {problem !== null && (
        <p className="scans-line selectable" role="status" data-part="problem">
          {numbered(problem)}{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              actions.dismissScansProblem()
              // Main answers the same to every window that asks, until it is told that it was read.
              void window.torno.scans.dismissProblem(objectId).catch(() => {})
            }}
          >
            Dismiss
          </button>
        </p>
      )}
      {importing !== null && (
        <p className="scans-line" role="status" data-part="importing">
          Reading <span className="num">{importing.name}</span>
          {importing.stage ? `: ${STAGE[importing.stage] ?? importing.stage}` : ''}
        </p>
      )}
      {refused !== null && (
        <p className="scans-line selectable" role="alert" data-part="refused">
          {numbered(refused)}{' '}
          <button type="button" className="link-button" onClick={() => actions.setScansRefused(null)}>
            Dismiss
          </button>
        </p>
      )}
      {scans.length === 0 && importing === null && <p className="section-note">Drop a scan on the view, or import one.</p>}
      {scans.length > 0 && (
        <ul className="rows">
          {scans.map((scan) => (
            <ScanRow key={scan.id} objectId={objectId} scan={scan} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ScanRow({ objectId, scan }: { objectId: string; scan: ScanInfo }) {
  const { id } = scan
  const layout = useStore((s) => s.layout)
  const view = useStore((s) => s.scanViews[id])
  const reading = useStore((s) => s.importing !== null)
  const clipped = useStore((s) => s.scansClipped.includes(id))
  // The regions painted on it, which lose their triangles with it: said before it is removed.
  const regions = useStore((s) => s.marks.filter((mark) => mark.kind === 'region' && mark.scan === id && mark.anchorState !== 'orphaned').length)
  const guess = guessOf(scan)
  // What changes how a scan was read is at hand while that is a guess: a wrong one is to be seen and put right at once.
  const [more, setMore] = useState(guess !== null)
  const [unit, setUnit] = useState<ScanUnit>(scan.imported.unit)
  const [up, setUp] = useState<ScanUp>(scan.imported.up)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<'convert' | 'remove' | null>(null)
  // As the scan is read now: after a change, and when main says otherwise.
  useEffect(() => {
    setUnit(scan.imported.unit)
    setUp(scan.imported.up)
  }, [scan.imported.unit, scan.imported.up])

  const visible = view?.visible !== false
  const opacity = view?.opacity ?? 1
  const coloured = scan.imported.colours !== 'none'
  const plain = !coloured || view?.colour === 'plain'
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const state = scanState(scan, layout, revision)
  const meshGone = scan.meshState === 'missing'
  const source = scan.sourceState === 'missing' ? 'source missing' : scan.sourceState === 'changed' ? 'source changed' : null
  const layouts = Object.keys(scan.alignments)
  // A layout of the build on show in which it is aligned, when it is not in the one shown.
  const built = useStore((s) => s.scene?.layouts ?? NO_LAYOUTS)
  const elsewhere = layouts.find((one) => one !== layout && built.includes(one))
  const changed = unit !== scan.imported.unit || up !== scan.imported.up
  const fields = `scan-fields-${id}`

  const convert = (as: { unit: ScanUnit; up: ScanUp }): void => {
    setAsking(null)
    setBusy(true)
    void asked(objectId, window.torno.scans.convert(objectId, id, as)).finally(() => setBusy(false))
  }

  return (
    <li className="row scan-row" data-scan={id} data-hidden={visible ? undefined : ''}>
      <div className="scan-head">
        <span className="scan-id num">{id}</span>
        <span className="row-name" title={scan.source.path}>
          {scan.name}
        </span>
        <input
          type="range"
          className="layer-opacity"
          data-set={opacity < 1 ? '' : undefined}
          min={MIN_SCAN_OPACITY}
          max={1}
          step={0.05}
          value={opacity}
          aria-label={`Opacity of ${id}`}
          title={`Opacity ${Math.round(opacity * 100)} %`}
          onChange={(e) => actions.setScanView(id, { opacity: Number(e.target.value) })}
        />
        <button type="button" className="icon-button" aria-pressed={visible} aria-label={`Show ${id}`} title={visible ? 'Hide' : 'Show'} onClick={() => actions.setScanView(id, { visible: !visible })}>
          <EyeIcon open={visible} />
        </button>
      </div>
      <p className="scan-read" data-guessed={guess ? '' : undefined}>
        {numbered(importText(scan.imported))}
      </p>
      {guess && (
        <p className="scan-guess">
          {guess}: right?{' '}
          <button
            type="button"
            className="link-button"
            aria-label={`Yes, ${id} was read rightly`}
            title="Keeps the scan as it is, and no longer asks"
            disabled={busy || meshGone}
            onClick={() => convert({ unit: scan.imported.unit, up: scan.imported.up })}
          >
            Yes
          </button>
        </p>
      )}
      <div className="scan-state">
        <span className="chip" data-state={state.state} title={state.tip}>
          {state.word}
        </span>
        {/* What the alignment rests on, in plain words: a floor alone, a hand, so many pairs and how well they fit. */}
        {state.basis && <span className="scan-basis">· {numbered(state.basis)}</span>}
        {source && (
          <span className="chip" data-state={source === 'source missing' ? 'source-missing' : 'source-changed'} title={`${scan.source.path}${source === 'source missing' ? ' is no longer there' : ' is not the file that was imported'}. The scan goes on working from what torno made of it`}>
            {source}
          </span>
        )}
        {clipped && (
          <span className="chip" data-state="clipped" title="This scan reaches further than the view is drawn: Frame brings more of it in">
            not all in view
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="link-button" aria-label={`Frame ${id}`} title="Brings this scan into view with the parts, without turning the view. The views and Fit frame the parts" disabled={meshGone || !visible} onClick={() => actions.frameScan(id)}>
          Frame
        </button>
        <button
          type="button"
          className="link-button"
          aria-label={`Align ${id}`}
          title={`Stand this scan where the model is, in the layout shown (${hint('tool.align')})`}
          disabled={meshGone}
          onClick={() => {
            // The tool first: taking it up puts down whatever was in hand.
            setTool('align')
            setAlignScan(id)
          }}
        >
          Align
        </button>
        <button type="button" className="scan-more" aria-label={`More of ${id}`} aria-expanded={more} aria-controls={fields} onClick={() => setMore((open) => !open)}>
          More
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 4 4 4-4 4" />
          </svg>
        </button>
      </div>
      {/* Why the state above needs a look, in words: the one sentence it is there for. */}
      {state.said && (
        <p className="scan-said" data-state={state.state}>
          {numbered(capital(state.said))}
          {state.confirm && (
            <>
              {' '}
              <button type="button" className="link-button" aria-label={`The alignment of ${id} is still right`} title="You looked, and the scan is where it should be: later builds are held against the model as it is now" onClick={() => void asked(objectId, window.torno.scans.alignHolds(objectId, id, layout))}>
                Still right
              </button>
            </>
          )}
        </p>
      )}
      {/* Aligned in another layout and not in this one: where it stands there is offered as a start, by hand, never as a fit of this layout. */}
      {state.state === 'unaligned' && elsewhere && revision > 0 && !meshGone && (
        <p className="scan-said" data-part="start">
          Aligned in <span className="num">{elsewhere}</span>.{' '}
          <button
            type="button"
            className="link-button"
            aria-label={`Use the alignment of ${id} in ${elsewhere} here`}
            title={`Puts the scan here where it stands in ${elsewhere}, as a start: kept as placed by hand, checked against nothing. The two layouts need not place the parts alike: look, and move it with Align`}
            onClick={() => {
              const { alignment, scaled } = startedFrom(scan.alignments[elsewhere])
              void asked(objectId, window.torno.scans.align(objectId, id, layout, alignment, { revision, ...(scaled ? { scaled: true } : {}) }))
            }}
          >
            Use this alignment in <span className="num">{layout}</span>
          </button>{' '}
          as a start, by hand
        </p>
      )}
      {/* A doubtful fit is said whatever else is: it does not wait for the check to come, or for the doubt to go. */}
      {state.rough && <p className="scan-said" data-part="rough">{numbered(`Rough: ${state.rough}`)}.</p>}
      {state.note && <p className="scan-said" data-part="note">{numbered(capital(state.note))}.</p>}
      {meshGone && (
        <p className="scan-said">
          Its mesh is gone from the disk: it cannot be drawn or checked.{' '}
          {scan.sourceState === 'missing' ? (
            'Its source is gone too: put the file back, or remove the scan.'
          ) : (
            <button type="button" className="link-button" aria-label={`Import again, into ${id}`} title={`Reads ${scan.source.path} again into ${id}: its alignments stay`} disabled={reading} onClick={() => reimportScan(objectId, id, scan.name)}>
              Import again
            </button>
          )}
        </p>
      )}
      {busy && (
        <p className="scan-said" role="status">
          Converting…
        </p>
      )}
      {more && (
        <div className="scan-fields" id={fields}>
          <div className="scan-field">
            <span className="scan-label">Read as</span>
            <select
              className="scan-select num"
              aria-label={`Unit of ${id}`}
              value={unit}
              disabled={busy}
              {...pointerChoice}
              onChange={(e) => {
                setUnit(e.target.value as ScanUnit)
                chosen(e.currentTarget)
              }}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <select
              className="scan-select"
              aria-label={`Up axis of ${id}`}
              value={up}
              disabled={busy}
              {...pointerChoice}
              onChange={(e) => {
                setUp(e.target.value as ScanUp)
                chosen(e.currentTarget)
              }}
            >
              <option value="y">Y up</option>
              <option value="z">Z up</option>
            </select>
            <button
              type="button"
              className="button"
              aria-label={`Apply to ${id}`}
              title={changed ? undefined : 'Choose another unit or up axis first'}
              disabled={busy || meshGone || !changed}
              onClick={() => (layouts.length > 0 ? setAsking('convert') : convert({ unit, up }))}
            >
              Apply
            </button>
          </div>
          <div className="scan-field">
            <span className="scan-label">Colour</span>
            <div className="scan-choice" role="group" aria-label={`Colour of ${id}`}>
              <button type="button" aria-label={`Own colours of ${id}`} aria-pressed={!plain} disabled={!coloured} title={coloured ? 'Its own colours, toned down' : 'This scan has no colours of its own'} onClick={() => actions.setScanView(id, { colour: 'own' })}>
                Own colours
              </button>
              <button type="button" aria-label={`Plain colour for ${id}`} aria-pressed={plain} onClick={() => actions.setScanView(id, { colour: 'plain' })}>
                Plain
              </button>
            </div>
          </div>
          <div className="scan-field">
            <button type="button" className="button" aria-label={`Remove ${id}`} onClick={() => setAsking('remove')}>
              Remove
            </button>
          </div>
        </div>
      )}
      {asking === 'convert' && (
        <Confirm label={`Drop the alignment of ${id}?`} accept="Change" cancel="Keep as it is" onCancel={() => setAsking(null)} onAccept={() => convert({ unit, up })}>
          Changing the unit or the up axis of <span className="num">{id}</span> drops its alignment in {numberedList(layouts)}.
        </Confirm>
      )}
      {asking === 'remove' && (
        <Confirm
          label={`Remove ${id}?`}
          accept="Remove"
          cancel="Keep it"
          onCancel={() => setAsking(null)}
          onAccept={() => {
            setAsking(null)
            void asked(objectId, window.torno.scans.remove(objectId, id))
          }}
        >
          Remove <span className="num">{id}</span> from this object? Its source file is not touched.
          {regions > 0 && (
            <>
              {' '}
              It has <span className="num">{regions}</span> {regions === 1 ? 'region' : 'regions'} painted on it: {regions === 1 ? 'that goes' : 'those go'} on as {regions === 1 ? 'a mark' : 'marks'} with {regions === 1 ? 'its note' : 'their notes'}, and {regions === 1 ? 'has' : 'have'} no triangles any more.
            </>
          )}
        </Confirm>
      )}
    </li>
  )
}

const NO_LAYOUTS: string[] = []

/** Layout names as a sentence has them, each in the monospace face: `print and assembly`. */
function numberedList(names: string[]): ReactNode[] {
  return names.flatMap((name, n) => [
    n === 0 ? '' : n === names.length - 1 ? ' and ' : ', ',
    <span key={name} className="num">
      {name}
    </span>
  ])
}
