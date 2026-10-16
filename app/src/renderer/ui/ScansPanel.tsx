import { hint, pressed } from '../../shared/keys'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { type ScanInfo, type ScanUnit, type ScanUp, MIN_SCAN_OPACITY, UNIT_MM, importText } from '../../shared/scans'
import { setAlignScan, startedFrom } from '../state/align'
import { actions, store, useStore } from '../state/store'
import { setTool } from '../state/tools'
import { Confirm } from './Confirm'
import { EyeIcon } from './Layers'
import { capital, numbered } from './numbered'
import { ScanReadSheet } from './ScanReadSheet'
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

/** Has main read a scan with another unit or up axis; with the same, a guess is said to be right and is no longer asked about. */
function convertScan(objectId: string, id: string, as: { unit: ScanUnit; up: ScanUp }): Promise<void> {
  return asked(objectId, window.torno.scans.convert(objectId, id, as))
}

/**
 * The scans of the open object, below the layers: surroundings the parts are
 * looked at in. A row is one line, as a layer's: which scan, whether it is
 * shown, and how far where it stands can be trusted, in a word; the rest opens
 * beneath it, one scan at a time. How a scan just imported is read, when that
 * was a guess, is asked once at the top. How a scan is looked at is the
 * person's, kept with the view; what a scan is, is main's.
 */
export function ScansPanel() {
  const objectId = useStore((s) => s.objectId)
  const scans = useStore((s) => s.scans)
  const importing = useStore((s) => s.importing)
  const refused = useStore((s) => s.scansRefused)
  const problem = useStore((s) => s.scansProblem)
  const askingId = useStore((s) => s.scanAsking)
  // The one scan whose detail is open under its row; none for another object.
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => setOpen(null), [objectId])

  if (!objectId) return null
  const askingOf = askingId === null ? undefined : scans.find((scan) => scan.id === askingId)

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
      {askingOf && <ScanReadSheet key={askingOf.id} scan={askingOf} convert={(as) => void convertScan(objectId, askingOf.id, as)} layoutsOf={numberedList} />}
      {scans.length === 0 && importing === null && <p className="section-note">Drop a scan on the view, or import one.</p>}
      {scans.length > 0 && (
        <ul className="rows">
          {scans.map((scan) => (
            <ScanRow key={scan.id} objectId={objectId} scan={scan} open={open === scan.id} onToggle={() => setOpen((was) => (was === scan.id ? null : scan.id))} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * A scan's row: one line, as a layer's (its id, its name, a dot while how it was read is a guess, its state in a
 * word, the opacity on hover, the eye), and, opened beneath it, the rest: how it was read, its state in a
 * sentence and what there is to do about it, Frame, Align and Rename, and the fields.
 */
function ScanRow({ objectId, scan, open, onToggle }: { objectId: string; scan: ScanInfo; open: boolean; onToggle: () => void }) {
  const { id } = scan
  const layout = useStore((s) => s.layout)
  const view = useStore((s) => s.scanViews[id])
  const reading = useStore((s) => s.importing !== null)
  const clipped = useStore((s) => s.scansClipped.includes(id))
  // The regions painted on it, which lose their triangles with it: said before it is removed.
  const regions = useStore((s) => s.marks.filter((mark) => mark.kind === 'region' && mark.scan === id && mark.anchorState !== 'orphaned').length)
  const guess = guessOf(scan)
  const [unit, setUnit] = useState<ScanUnit>(scan.imported.unit)
  const [up, setUp] = useState<ScanUp>(scan.imported.up)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<'convert' | 'remove' | null>(null)
  const [naming, setNaming] = useState(false)
  const name = useRef<HTMLInputElement>(null)
  // As the scan is read now: after a change, and when main says otherwise.
  useEffect(() => {
    setUnit(scan.imported.unit)
    setUp(scan.imported.up)
  }, [scan.imported.unit, scan.imported.up])
  useEffect(() => {
    if (naming) name.current?.select()
  }, [naming])

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
  const detail = `scan-detail-${id}`

  const convert = (as: { unit: ScanUnit; up: ScanUp }): void => {
    setAsking(null)
    setBusy(true)
    void convertScan(objectId, id, as).finally(() => setBusy(false))
  }
  const rename = (value: string): void => {
    if (value === scan.name) return setNaming(false)
    // Main says what it will not take (`a scan needs a name`), and the name stays as it was.
    void asked(objectId, window.torno.scans.rename(objectId, id, value)).finally(() => setNaming(false))
  }

  return (
    <li className="row scan-row" data-scan={id} data-hidden={visible ? undefined : ''} data-open={open ? '' : undefined}>
      <div className="scan-head">
        <span className="scan-id num">{id}</span>
        {naming ? (
          <input
            ref={name}
            className="row-name scan-name-field"
            aria-label={`Name of ${id}`}
            defaultValue={scan.name}
            onKeyDown={(e) => {
              if (pressed(e, 'field.keep')) rename(e.currentTarget.value)
              else if (pressed(e, 'field.leave')) setNaming(false)
            }}
            onBlur={(e) => {
              if (e.currentTarget.value === scan.name) setNaming(false)
            }}
          />
        ) : (
          <span className="row-name" title={`${scan.name}, from ${scan.source.path}`} onClick={onToggle}>
            {scan.name}
          </span>
        )}
        {guess && <span className="scan-dot" role="img" aria-label="Read as assumed" title={`${guess}: assumed`} />}
        <span className="chip" data-state={state.state} title={state.tip}>
          {state.word}
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
        <button type="button" className="scan-toggle" aria-label={`Details of ${id}`} aria-expanded={open} aria-controls={detail} title={open ? 'Close the detail' : 'How it was read, how it stands, and what to do with it'} onClick={onToggle}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 4 4 4-4 4" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="scan-detail" id={detail}>
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
          {/* The state in its sentence, with what the alignment rests on; "Still right" where the person can say it holds. */}
          {/* Its mesh gone, the line below says so with what to do. */}
          {!meshGone && (
          <p className="scan-said" data-part="state" data-state={state.state}>
            {sentenceOf(capital(state.tip), state.basis)}
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
          {source && (
            <p className="scan-said" data-part="source" data-state={source === 'source missing' ? 'source-missing' : 'source-changed'}>
              {capital(source)}: {numbered(`${scan.source.path}${source === 'source missing' ? ' is no longer there' : ' is not the file that was imported'}. The scan goes on working from what torno made of it.`)}
            </p>
          )}
          {clipped && (
            <p className="scan-said" data-part="clipped">
              Not all in view: Frame brings more of it in.
            </p>
          )}
          <div className="scan-actions">
            <button type="button" className="button button-quiet" aria-label={`Frame ${id}`} title="Brings this scan into view with the parts, without turning the view. The views and Fit frame the parts" disabled={meshGone || !visible} onClick={() => actions.frameScan(id)}>
              Frame
            </button>
            <button
              type="button"
              className="button button-quiet"
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
            <button type="button" className="button button-quiet" aria-label={`Rename ${id}`} title="Its name in torno: the source file keeps its own" disabled={naming} onClick={() => setNaming(true)}>
              Rename
            </button>
          </div>
          <div className="scan-fields">
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

/** A state's sentence, with what the alignment rests on set apart in it (`.scan-basis`). */
function sentenceOf(tip: string, basis: string | null): ReactNode {
  const at = basis === null ? -1 : tip.indexOf(basis)
  if (basis === null || at < 0) return numbered(tip)
  return (
    <>
      {numbered(tip.slice(0, at))}
      <span className="scan-basis">{numbered(basis)}</span>
      {numbered(tip.slice(at + basis.length))}
    </>
  )
}

/** Layout names as a sentence has them, each in the monospace face: `print and assembly`. */
function numberedList(names: string[]): ReactNode[] {
  return names.flatMap((name, n) => [
    n === 0 ? '' : n === names.length - 1 ? ' and ' : ', ',
    <span key={name} className="num">
      {name}
    </span>
  ])
}
