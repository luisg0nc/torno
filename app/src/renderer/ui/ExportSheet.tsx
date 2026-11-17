import { hint, pressed } from '../../shared/keys'
import { useEffect, useRef, useState } from 'react'
import { type ExportChecked, type ExportFormat, type ExportPlan, type ExportRequest, type ExportSaved, type ShareKind, FORMAT_NAMES, PICTURE_SIZES, MESH_ANGLE, MESH_ANGLES, MESH_TOLERANCE, MESH_TOLERANCES, type ModelFormat, NOT_BUILT, SCAN_WARNING, defaultLayout, megabytes } from '../../shared/exportdata'
import { count, number } from '../../shared/format'
import { typed } from './typed'
import { setExporting } from '../closing'
import { actions, sceneFileOf, store, useStore } from '../state/store'
import { pictureForPerson } from '../state/agent'
import { type Tracing, tracingName } from '../../shared/tracings'

/** `2 parts`, the number in the face of numbers. */
function Count({ n, one, many = `${one}s` }: { n: number; one: string; many?: string }) {
  return (
    <>
      <span className="num">{count(n)}</span> {n === 1 ? one : many}
    </>
  )
}

/** What can take the focus in the sheet, in order. */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex="0"]'

/** What each format is, said on its button and above what it holds. */
const FORMATS: Record<ExportFormat, { label: string; title: string; heading: string; lead: string }> = {
  html: { label: 'HTML page', title: 'One page that opens by itself in a browser', heading: 'Export to one HTML file', lead: 'A page that opens by itself in a browser, for someone who has no torno: the parts of the last build, to turn, take apart and cut. It asks nothing of the network. What is ticked here is what is in it.' },
  step: { label: 'STEP', title: 'The exact shape, for a CAD program', heading: 'Export a STEP file', lead: 'The exact shape of the last build, for a CAD program: each part a named body in its colour, where the layout has it, in millimetres.' },
  stl: { label: 'STL', title: 'One part as triangles, for a slicer', heading: 'Export an STL file', lead: 'One part of the last build as triangles, for a slicer, in millimetres: STL has no unit of its own. A plate of several parts is a 3MF.' },
  '3mf': { label: '3MF', title: 'A plate for a slicer: each part a named object', heading: 'Export a 3MF file', lead: 'A plate for a slicer: each part of the last build a named object in its colour, in millimetres, where the layout has it.' }
}

/** What each file of the view is, said on its button and above what it holds. */
const SHARED: Record<ShareKind, { label: string; title: string; heading: string; lead: string }> = {
  png: { label: 'PNG', title: 'The view as it is, as a picture', heading: 'Save a picture of the view', lead: 'The view as it is on screen (the camera, the layout, the parts that are on, the section or the explode, the scans) as one PNG, for a forum, a chat or a document. It is not for the agent: it may be larger than the pictures the agent is given.' },
  svg: { label: 'SVG', title: 'A section or a tracing, at true scale', heading: 'Save a tracing', lead: "The outlines of the section on screen or of one of the project's tracings, laid flat in the plane's own axes at true scale in millimetres, with a scale bar, a title block and the dimensions that lie in the plane. For someone who will make the part." },
  pdf: { label: 'PDF', title: 'The same drawing, on a page of its size', heading: 'Save a tracing as a PDF', lead: 'The same drawing (the SVG), printed on a page of its own size in millimetres: print it at 100 % and it is at true scale.' }
}

/** The readers a file can be for, and what is offered each: the sheet is grouped by who will open the file. The view's own files need the open project's view. */
const READERS: Array<{ name: string; kinds: Array<ExportFormat | ShareKind>; ofView?: true }> = [
  { name: 'A page to look at', kinds: ['html'] },
  { name: 'The CAD file', kinds: ['step', 'stl', '3mf'] },
  { name: 'A picture', kinds: ['png'], ofView: true },
  { name: 'A tracing', kinds: ['svg', 'pdf'], ofView: true }
]

type LayoutParts = NonNullable<ExportPlan['objects'][number]['layoutParts']>[number]['parts']

/** The parts a file of the model holds unless the person ticks others: those switched on, of solids alone for a mesh, one for an STL. A bought part (a reference) is in none unless ticked, and in a mesh never. */
function partsByDefault(format: ModelFormat, parts: LayoutParts): string[] {
  const going = parts.filter((part) => !part.off && !part.reference && (format === 'step' || part.solid)).map((part) => part.name)
  return format === 'stl' ? going.slice(0, 1) : going
}

/** A tolerance or an angle as typed, or null for one that is no number within its range. */
function within(text: string, [least, most]: readonly [number, number]): number | null {
  const n = typed(text)
  return Number.isFinite(n) && n >= least && n <= most ? n : null
}

/** What the read-back of a file of the model found, in a line: checked, not printed. */
function Checked({ checked }: { checked: ExportChecked }) {
  const n = checked.parts.length
  if (checked.format === 'step') {
    return (
      <p className="export-checked">
        Checked: STEP read back, <Count n={n} one="part" /> by name, <Count n={checked.solids ?? 0} one="solid" />, each volume and box as the model's.
      </p>
    )
  }
  return (
    <p className="export-checked">
      Checked: {FORMAT_NAMES[checked.format]}, <Count n={n} one={checked.format === '3mf' ? 'object' : 'part'} />, <Count n={checked.triangles ?? 0} one="triangle" />, closed
      {checked.volumeDeviation !== null && (
        <>
          , volume within <span className="num">{number(checked.volumeDeviation)} %</span> of the model
        </>
      )}
      . Checked, not printed.
    </p>
  )
}

/**
 * What goes into an export, said before anything is written: the objects, whether their marks and notes go with
 * them, each scan by its own tick, what the file would weigh and what would be cut to keep it small. Marks and
 * scans are off until ticked: a note may be private, and a scan may show the real world. "Export" asks main,
 * which asks where to save; the window never names a path.
 */
export function ExportSheet({ onOpen }: { onOpen: (id: string, ticked: string[]) => void }) {
  const of = useStore((s) => s.exportOf)
  if (of === null) return null
  return <Sheet key={of === 'all' ? 'all' : of.join('\n')} of={of} onOpen={onOpen} />
}

function Sheet({ of, onOpen }: { of: string[] | 'all'; onOpen: (id: string, ticked: string[]) => void }) {
  const names = useStore((s) => s.workspace?.objects ?? NONE)
  const [objects, setObjects] = useState<string[] | null>(of === 'all' ? null : of)
  const [marks, setMarks] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [scans, setScans] = useState<string[]>([])
  const [plan, setPlan] = useState<ExportPlan | null>(null)
  const [busy, setBusy] = useState<'planning' | 'saving' | null>('planning')
  const [said, setSaid] = useState<{ saved?: ExportSaved; kept?: ShareKind; nothing?: true; error?: string } | null>(null)
  // A file of the model: its format, layout and parts (null until the person picks: the format's defaults), the tolerance and angle of a mesh as typed, and whether a 3MF is opened once saved.
  const [format, setFormat] = useState<ExportFormat>('html')
  const [layout, setLayout] = useState<string | null>(null)
  const [parts, setParts] = useState<string[] | null>(null)
  const [tolerance, setTolerance] = useState(String(MESH_TOLERANCE))
  const [angle, setAngle] = useState(String(MESH_ANGLE))
  const [openAfter, setOpenAfter] = useState(false)
  // A file of the open project's view (a picture, a drawing of its section) instead of one of the project: null for the others.
  const [shared, setShared] = useState<ShareKind | null>(null)
  const [pictureSize, setPictureSize] = useState(PICTURE_SIZES[0])
  const [pictureMarks, setPictureMarks] = useState(true)
  const [pictureCues, setPictureCues] = useState(true)
  // Of a tracing (`A tracing`): the section on screen, or one of the project's tracings by its `T<n>`; null until the person picks, and what is in it.
  const [drawing, setDrawing] = useState<string | null>(null)
  const [tracings, setTracings] = useState<Tracing[]>([])
  const [drawLayers, setDrawLayers] = useState(true)
  const [drawMarks, setDrawMarks] = useState(false)
  const openId = useStore((s) => s.objectId)
  const onObject = useStore((s) => s.page === 'object')
  const cut = useStore((s) => s.section !== null)
  const ofView = openId !== null && onObject
  // The project's tracings, to choose among, read when the sheet is of its view.
  useEffect(() => {
    if (!ofView || openId === null) return setTracings([])
    let live = true
    window.torno.tracings.list(openId).then(
      (file) => live && setTracings(file.tracings),
      () => live && setTracings([])
    )
    return () => {
      live = false
    }
  }, [ofView, openId])
  /** What the drawing is of: the person's pick if it is still there, else the section on screen, or the first tracing when there is none. */
  const source = drawing !== null && (drawing === 'section' || tracings.some((one) => one.id === drawing)) ? drawing : cut || tracings.length === 0 ? 'section' : tracings[0].id
  const sheet = useRef<HTMLElement>(null)
  const asked = useRef(0)
  const saving = useRef(false)
  saving.current = busy === 'saving'
  // Closing the window while the file is written would leave none: the window asks first (`closing.ts`).
  useEffect(() => {
    setExporting(busy === 'saving')
    return () => setExporting(false)
  }, [busy])

  // The export is of what is on screen: what the open object's scene file should hold is given to main now, not when the next save is due.
  useEffect(() => {
    const s = store.getState()
    if (s.objectId !== null) window.torno.object.saveSceneFile(s.objectId, sceneFileOf(s))
  }, [])

  // What the file would hold and weigh, asked again whenever a tick changes. With nothing chosen yet, every object that can be exported is.
  useEffect(() => {
    const mine = ++asked.current
    setBusy((was) => (was === 'saving' ? was : 'planning'))
    window.torno.export.plan({ objects: objects ?? [], marks, scans, hidden, resolved, ...(format === 'html' ? {} : { format }) }).then(
      (found) => {
        if (mine !== asked.current) return
        if (objects === null) return setObjects(found.objects.filter((object) => object.exportable).map((object) => object.id))
        setPlan(found)
        setBusy((was) => (was === 'saving' ? was : null))
      },
      (e) => {
        if (mine !== asked.current) return
        setSaid({ error: e instanceof Error ? e.message : String(e) })
        setBusy((was) => (was === 'saving' ? was : null))
      }
    )
  }, [objects, marks, scans, hidden, resolved, format])

  // The keys are the sheet's while it is up, and the focus comes back to where it was when it goes.
  useEffect(() => {
    const before = document.activeElement
    sheet.current?.focus()
    // Escape puts it away from wherever the focus is; from within, the sheet hears it first.
    const onKey = (e: KeyboardEvent): void => {
      if (pressed(e, 'sheet.close') && !e.defaultPrevented && !saving.current) actions.exportSheet(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      // What main kept ready for this sheet (scans reduced) is let go.
      window.torno.export.done()
      window.removeEventListener('keydown', onKey)
      const now = document.activeElement
      if (before instanceof HTMLElement && before.isConnected && (now === null || now === document.body || !now.isConnected)) before.focus()
    }
  }, [])

  const ticked = objects ?? []
  const model = shared !== null || format === 'html' ? null : format
  const html = shared === null && model === null
  // Of a file of the model: the one object, its layouts, the layout and the parts that go, and the mesh's tolerances.
  const modelEntry = model ? plan?.objects.find((object) => object.exportable && object.id === ticked[0]) : undefined
  const layouts = modelEntry?.layoutParts ?? []
  const layoutNow = model ? (layout !== null && layouts.some((one) => one.layout === layout) ? layout : defaultLayout(model, layouts.map((one) => one.layout))) : undefined
  const layoutParts = layouts.find((one) => one.layout === layoutNow)?.parts ?? []
  const partsNow = model ? (parts ?? partsByDefault(model, layoutParts)).filter((name) => layoutParts.some((part) => part.name === name)) : []
  const toleranceNow = within(tolerance, MESH_TOLERANCES)
  const angleNow = within(angle, MESH_ANGLES)
  const meshOk = model === 'step' || (toleranceNow !== null && angleNow !== null)
  const request = (): ExportRequest =>
    model
      ? { objects: ticked.slice(0, 1), marks: false, scans: [], format: model, layout: layoutNow, parts: partsNow, ...(model === 'step' ? {} : { tolerance: toleranceNow!, angle: angleNow! }), ...(model === '3mf' && openAfter ? { open: true } : {}) }
      : { objects: ticked, marks, scans: scans.filter((key) => ticked.some((id) => key.startsWith(`${id}/`))), hidden, resolved }
  const choose = (next: ExportFormat | ShareKind): void => {
    changed()
    if (next === 'png' || next === 'svg' || next === 'pdf') return setShared(next)
    setShared(null)
    chooseFormat(next)
  }
  const chooseFormat = (next: ExportFormat): void => {
    changed()
    setFormat(next)
    setLayout(null)
    setParts(null)
    // A file of the model is of one object.
    if (next !== 'html' && ticked.length > 1) setObjects(ticked.slice(0, 1))
  }
  const tick = (list: string[], key: string, on: boolean): string[] => (on ? [...new Set([...list, key])] : list.filter((one) => one !== key))
  const changed = (): void => setSaid(null)

  /** A picture of the view, or a drawing of its section: made of the open project as it is on screen, saved where main's dialog says. */
  async function keep(kind: ShareKind) {
    if (openId === null) return
    setBusy('saving')
    setSaid(null)
    try {
      const saved =
        kind === 'png'
          ? await window.torno.export.savePicture(openId, (await pictureForPerson(pictureSize, pictureMarks, pictureCues)).png)
          : source === 'section'
            ? await window.torno.export.saveSection(openId, kind)
            : await window.torno.export.saveTracing(openId, source, kind, { layers: drawLayers, marks: drawMarks, photo: false })
      setSaid(saved ? { saved, kept: kind } : { nothing: true })
    } catch (e) {
      setSaid({ error: e instanceof Error ? e.message : String(e) })
    }
    setBusy(null)
  }

  async function save() {
    if (shared !== null) return keep(shared)
    setBusy('saving')
    setSaid(null)
    // Whatever was changed in the view behind the sheet since it came up is in the file too.
    const s = store.getState()
    if (s.objectId !== null) window.torno.object.saveSceneFile(s.objectId, sceneFileOf(s))
    try {
      const saved = await window.torno.export.save(request())
      setSaid(saved ? { saved } : { nothing: true })
    } catch (e) {
      setSaid({ error: e instanceof Error ? e.message : String(e) })
    }
    setBusy(null)
  }

  /** "Show in folder" or "Open in browser" of the file just saved: main knows which; a refusal is told like any error. */
  async function after(done: Promise<void>): Promise<void> {
    try {
      await done
    } catch (e) {
      setSaid((was) => ({ ...was, error: e instanceof Error ? e.message : String(e) }))
    }
  }

  const can = (plan?.objects ?? []).filter((object) => object.exportable)
  const cannot = (plan?.objects ?? []).filter((object) => !object.exportable)
  const chosen = can.filter((object) => ticked.includes(object.id))
  const sum = (of: (object: ExportPlan['objects'][number]) => number | undefined): number => chosen.reduce((total, object) => total + (of(object) ?? 0), 0)
  const notes = sum((object) => object.marks)
  const dimensions = sum((object) => object.dimensions)
  const drafts = sum((object) => object.drafts)
  const settled = sum((object) => object.resolved)
  const off = sum((object) => object.off)
  const withScans = chosen.filter((object) => object.scans.length > 0)
  const nameOf = (id: string): string => names.find((object) => object.id === id)?.name ?? id

  return (
    // Over the whole window while it is up: nothing behind it takes a click or the focus until it is answered.
    <div className="export-layer">
      <section
        ref={sheet}
        className="export-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        tabIndex={-1}
        onKeyDown={(e) => {
          // No tool of the view under it is handed a key: what is exported is what was on screen when the sheet came up.
          e.stopPropagation()
          if (pressed(e, 'sheet.close') && busy !== 'saving') actions.exportSheet(null)
          if (!pressed(e, 'sheet.round')) return
          // Tab goes round within the sheet.
          const stops = [...sheet.current!.querySelectorAll<HTMLElement>(FOCUSABLE)]
          if (stops.length === 0) return e.preventDefault()
          const at = stops.indexOf(document.activeElement as HTMLElement)
          if (e.shiftKey ? at <= 0 : at === stops.length - 1) {
            e.preventDefault()
            stops[e.shiftKey ? stops.length - 1 : 0].focus()
          }
        }}
      >
        <header className="export-head">
          <h2>{shared ? SHARED[shared].heading : FORMATS[format].heading}</h2>
          <button type="button" className="icon-button" aria-label="Close" title={`Close (${hint('sheet.close')})`} disabled={busy === 'saving'} onClick={() => actions.exportSheet(null)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>
        <div className="export-body">
          {/* Grouped by who will open the file. The picture and the drawing are of the open project's view, so only where that is what the sheet is of. */}
          <div className="export-readers" role="group" aria-label="Format">
            {READERS.filter((reader) => !reader.ofView || ofView).map((reader) => (
              <div key={reader.name} className="export-reader" role="group" aria-label={reader.name}>
                <span className="export-reader-name">{reader.name}</span>
                <div className="segmented export-formats">
                  {reader.kinds.map((one) => {
                    const kept = one === 'png' || one === 'svg' || one === 'pdf'
                    return (
                      <button key={one} type="button" title={kept ? SHARED[one].title : FORMATS[one].title} aria-pressed={kept ? shared === one : shared === null && one === format} disabled={busy === 'saving'} onClick={() => choose(one)}>
                        {kept ? SHARED[one].label : FORMATS[one].label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="export-lead">{shared ? SHARED[shared].lead : FORMATS[format].lead}</p>

          {shared !== null && (
            <ViewChoices
              kind={shared}
              project={openId === null ? '' : nameOf(openId)}
              cut={cut}
              tracings={tracings}
              source={source}
              layers={drawLayers}
              drawMarks={drawMarks}
              size={pictureSize}
              marks={pictureMarks}
              cues={pictureCues}
              disabled={busy === 'saving'}
              setSource={(next) => {
                changed()
                setDrawing(next)
              }}
              setLayers={(next) => {
                changed()
                setDrawLayers(next)
              }}
              setDrawMarks={(next) => {
                changed()
                setDrawMarks(next)
              }}
              setSize={(next) => {
                changed()
                setPictureSize(next)
              }}
              setMarks={(next) => {
                changed()
                setPictureMarks(next)
              }}
              setCues={(next) => {
                changed()
                setPictureCues(next)
              }}
            />
          )}
          {shared === null && (
          <>

          <h3 className="section-title">{model ? 'Project' : 'Projects'}</h3>
          <ul className="export-list">
            {can.map((object) => (
              <li key={object.id}>
                <label className="export-row">
                  <input
                    type={model ? 'radio' : 'checkbox'}
                    name={model ? 'export-object' : undefined}
                    checked={ticked.includes(object.id)}
                    disabled={busy === 'saving'}
                    onChange={(e) => {
                      changed()
                      setLayout(null)
                      setParts(null)
                      setObjects(model ? [object.id] : tick(ticked, object.id, e.target.checked))
                    }}
                  />
                  <span className="export-name">{nameOf(object.id)}</span>
                  <span className="export-what">
                    <span className="num">r{object.revision}</span> · <Count n={object.parts ?? 0} one="part" />
                    {(object.layouts?.length ?? 0) > 1 && (
                      <>
                        {' '}
                        in <Count n={object.layouts!.length} one="layout" /> ({object.layouts!.join(', ')})
                      </>
                    )}
                    {(object.views?.length ?? 0) > 0 && (
                      <>
                        {' '}
                        · <Count n={object.views!.length} one="saved view" />
                      </>
                    )}
                    {/* The triangles the page would hold: a file of the model is meshed for itself. */}
                    {!model && (
                      <>
                        {' '}
                        · <Count n={object.triangles ?? 0} one="triangle" />
                      </>
                    )}
                  </span>
                  {object.failed && (
                    <span className="export-what" data-tone="warn">
                      The model has failed since: this is its last good build
                    </span>
                  )}
                </label>
              </li>
            ))}
            {plan === null && <li className="export-what">Looking at what there is…</li>}
          </ul>
          {/* What cannot be exported, in a line for each reason: an object with no build of this run is not built for an export. */}
          {[...new Set(cannot.map((object) => object.why))].map((why) => {
            const left = cannot.filter((object) => object.why === why)
            const unbuilt = why === NOT_BUILT
            return (
              <p key={why} className="export-cannot">
                {why}:{' '}
                {left.map((object, n) => (
                  <span key={object.id}>
                    {n > 0 && ', '}
                    {unbuilt ? (
                      <button type="button" className="link-button" disabled={busy === 'saving'} title={`Open ${nameOf(object.id)}, wait for its build, and come back here`} onClick={() => onOpen(object.id, objects ?? can.map((one) => one.id))}>
                        {nameOf(object.id)}
                      </button>
                    ) : (
                      nameOf(object.id)
                    )}
                  </span>
                ))}
                {unbuilt && (
                  <>
                    . <span className="num">{count(left.length)}</span> not built in this run.
                  </>
                )}
              </p>
            )
          })}

          </>
          )}

          {shared === null && model && modelEntry && (
            <ModelChoices
              format={model}
              layouts={layouts.map((one) => one.layout)}
              layout={layoutNow}
              parts={layoutParts}
              chosen={partsNow}
              tolerance={tolerance}
              angle={angle}
              toleranceOk={toleranceNow !== null}
              angleOk={angleNow !== null}
              openAfter={openAfter}
              disabled={busy === 'saving'}
              setLayout={(next) => {
                changed()
                setLayout(next)
                setParts(null)
              }}
              setParts={(next) => {
                changed()
                setParts(next)
              }}
              setTolerance={(next) => {
                changed()
                setTolerance(next)
              }}
              setAngle={(next) => {
                changed()
                setAngle(next)
              }}
              setOpenAfter={(next) => {
                changed()
                setOpenAfter(next)
              }}
            />
          )}

          {html && off > 0 && (
            <>
              <h3 className="section-title">Parts</h3>
              <label className="export-row">
                <input
                  type="checkbox"
                  checked={hidden}
                  disabled={busy === 'saving'}
                  onChange={(e) => {
                    changed()
                    setHidden(e.target.checked)
                  }}
                />
                <span className="export-name">Include parts that are switched off</span>
                <span className="export-what">
                  <Count n={off} one="part is" many="parts are" /> switched off here: {hidden ? 'in the file, switched off, for whoever opens it to switch on' : 'left out of the file, with the marks on ' + (off === 1 ? 'it' : 'them')}
                </span>
              </label>
            </>
          )}

          {html && (
          <>
          <h3 className="section-title">Marks</h3>
          <label className="export-row">
            <input
              type="checkbox"
              checked={marks}
              disabled={busy === 'saving'}
              onChange={(e) => {
                changed()
                setMarks(e.target.checked)
              }}
            />
            <span className="export-name">Include marks and their notes</span>
            <span className="export-what">
              {notes + dimensions === 0 ? (
                'None on what is ticked'
              ) : (
                <>
                  <Count n={notes} one="mark" /> and <Count n={dimensions} one="dimension" />
                  {drafts > 0 && (
                    <>
                      , <Count n={drafts} one="of them a draft" many="of them drafts" /> the agent has not been sent
                    </>
                  )}
                  : every note as it is written, each dimension as it was measured on the build exported
                </>
              )}
            </span>
          </label>
          {settled > 0 && (
            <label className="export-row">
              <input
                type="checkbox"
                checked={resolved}
                disabled={!marks || busy === 'saving'}
                onChange={(e) => {
                  changed()
                  setResolved(e.target.checked)
                }}
              />
              <span className="export-name">Include resolved marks</span>
              <span className="export-what">
                <Count n={settled} one="resolved mark" />, with {settled === 1 ? 'its note' : 'their notes'}: {resolved && marks ? 'in the file' : 'left out'}
              </span>
            </label>
          )}

          </>
          )}

          {html && withScans.length > 0 && (
            <>
              <h3 className="section-title">Scans</h3>
              <p className="export-warning">{SCAN_WARNING} What was painted on a scan is never in the file.</p>
              <ul className="export-list">
                {withScans.flatMap((object) =>
                  object.scans.map((scan) => {
                    const key = `${object.id}/${scan.id}`
                    return (
                      <li key={key}>
                        <label className="export-row">
                          <input
                            type="checkbox"
                            checked={scans.includes(key)}
                            disabled={busy === 'saving'}
                            onChange={(e) => {
                              changed()
                              setScans(tick(scans, key, e.target.checked))
                            }}
                          />
                          <span className="export-name">
                            <span className="num">{scan.id}</span> {scan.name}
                          </span>
                          <span className="export-what">
                            of {nameOf(object.id)} · <span className="num">{count(scan.triangles)}</span> triangles
                          </span>
                        </label>
                      </li>
                    )
                  })
                )}
              </ul>
            </>
          )}

          <p className="export-never">
            {shared
              ? 'Nothing about this computer is in the file. It goes where you say, and only there.'
              : model
              ? 'Never in the file: where anything is on this computer, the marks, the scans, the views, the session with the agent. It is read back and checked before it takes the name you give it: a file that fails is not saved.'
              : 'Never in the file: where anything is on this computer, the session with the agent, what a model printed, a view the agent proposed and you did not keep.'}
          </p>
        </div>
        <footer className="export-foot">
          <div className="export-size" aria-live="polite" data-bytes={plan && !plan.refusal ? plan.bytes : undefined}>
            {shared ? (
              !said?.saved && <p>{busy === 'saving' ? 'Making the file…' : shared === 'png' ? 'Drawn from the view as it is now' : source !== 'section' ? 'Made from the kernel’s outlines of the tracing’s plane, on the last good build' : cut ? 'Made from the kernel’s outlines of the section on screen' : 'There is no section on screen: close this, cut the project (the Section tool, X), and come back'}</p>
            ) : plan?.refusal ? (
              <p data-tone={plan.bytes > 0 ? 'fail' : undefined}>{plan.refusal}</p>
            ) : model ? (
              !said?.saved && <p>{busy === 'saving' ? 'Making the file and reading it back…' : 'Made by the kernel when you export, then read back and checked'}</p>
            ) : plan ? (
              <p>
                {busy === 'planning' ? 'Weighing… ' : ''}about <span className="num">{megabytes(plan.bytes)}</span>
              </p>
            ) : null}
            {shared === null && plan?.dropped.map((sentence) => (
              <p key={sentence} data-tone="warn">
                To keep it small: {sentence}
              </p>
            ))}
            {shared === null && plan?.over && !plan.refusal && (
              <p data-tone="warn">
                The parts alone are over the <span className="num">{megabytes(plan.budget)}</span> torno keeps a file to. Export fewer projects, or go ahead.
              </p>
            )}
            {said?.saved && (
              <p className="export-saved">
                Saved to <span className="export-path">{said.saved.path}</span>{' '}
                <span className="export-after">
                  <button type="button" className="link-button" onClick={() => void after(window.torno.export.reveal())}>
                    Show in folder
                  </button>
                  {!said.kept && (said.saved.checked?.format ?? 'html') === 'html' && (
                    <button type="button" className="link-button" onClick={() => void after(window.torno.export.openSaved())}>
                      Open in browser
                    </button>
                  )}
                </span>
                {said.saved.checked && (
                  <>
                    {' '}
                    · <span className="num">{megabytes(said.saved.bytes)}</span>
                    {said.saved.revision !== undefined && (
                      <>
                        {' '}
                        of <span className="num">r{said.saved.revision}</span>
                      </>
                    )}
                  </>
                )}
              </p>
            )}
            {said?.saved?.checked && <Checked checked={said.saved.checked} />}
            {said?.saved?.notOpened && <p data-tone="warn">It could not be opened: {said.saved.notOpened}</p>}
            {said?.nothing && <p>Nothing was saved</p>}
            {said?.error && <p data-tone="fail">{said.error}</p>}
          </div>
          <div className="export-actions">
            <button type="button" className="button" disabled={busy === 'saving'} onClick={() => actions.exportSheet(null)}>
              {said?.saved ? 'Done' : 'Cancel'}
            </button>
            <button type="button" className="button button-primary" disabled={shared !== null ? busy !== null || openId === null || (shared !== 'png' && source === 'section' && !cut) : busy !== null || plan === null || plan.refusal !== undefined || (model !== null && (partsNow.length === 0 || !meshOk))} onClick={() => void save()}>
              {busy === 'saving' ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

const NONE: never[] = []

/** Of a picture of the view or a drawing of its section: of the open project as it is on screen, so no list of projects; the size of a picture and what is in it. */
function ViewChoices(props: { kind: ShareKind; project: string; cut: boolean; tracings: Tracing[]; source: string; layers: boolean; drawMarks: boolean; size: number; marks: boolean; cues: boolean; disabled: boolean; setSource(source: string): void; setLayers(on: boolean): void; setDrawMarks(on: boolean): void; setSize(size: number): void; setMarks(on: boolean): void; setCues(on: boolean): void }) {
  const { kind, disabled } = props
  return (
    <>
      <h3 className="section-title">Project</h3>
      <p className="export-what">
        {props.project}, as it is on screen
      </p>
      {kind === 'png' ? (
        <>
          <h3 className="section-title">Size</h3>
          <div className="segmented export-sizes" role="group" aria-label="Long edge, in pixels">
            {PICTURE_SIZES.map((one) => (
              <button key={one} type="button" className="num" aria-pressed={props.size === one} disabled={disabled} onClick={() => props.setSize(one)}>
                {one}
              </button>
            ))}
          </div>
          <p className="export-what">The long edge, in pixels: up to 4000, which the pictures the agent is given may not be.</p>
          <h3 className="section-title">In the picture</h3>
          <label className="export-row">
            <input type="checkbox" checked={props.marks} disabled={disabled} onChange={(e) => props.setMarks(e.target.checked)} />
            <span className="export-name">Marks</span>
            <span className="export-what">With their numbers, as on screen</span>
          </label>
          <label className="export-row">
            <input type="checkbox" checked={props.cues} disabled={disabled} onChange={(e) => props.setCues(e.target.checked)} />
            <span className="export-name">Axes and scale bar</span>
            <span className="export-what">Bottom left and bottom right</span>
          </label>
        </>
      ) : (
        <>
          <h3 className="section-title">Drawing of</h3>
          <ul className="export-list">
            <li>
              <label className="export-row">
                <input type="radio" name="export-drawing" checked={props.source === 'section'} disabled={disabled} onChange={() => props.setSource('section')} />
                <span className="export-name">The section on screen</span>
                <span className="export-what">{props.cut ? 'As it is cut now' : 'There is none: cut the project first (the Section tool, X)'}</span>
              </label>
            </li>
            {props.tracings.map((one) => (
              <li key={one.id}>
                <label className="export-row">
                  <input type="radio" name="export-drawing" checked={props.source === one.id} disabled={disabled} onChange={() => props.setSource(one.id)} />
                  <span className="export-name">
                    <span className="num">{one.id}</span> {tracingName(one)}
                  </span>
                  <span className="export-what">{one.plane.label}</span>
                </label>
              </li>
            ))}
          </ul>
          {props.source === 'section' ? (
            <p className="export-what" data-tone={props.cut ? undefined : 'warn'}>
              {props.cut
                ? 'Within 0.01 mm of the true outlines, in millimetres. Each dimension that lies in the plane, not resolved and measured on the last build, is drawn with the value torno measured and what was expected of it.'
                : 'There is no section on screen: close this, cut the project (the Section tool, X), and come back, or choose a tracing.'}
            </p>
          ) : (
            <>
              <h3 className="section-title">In the drawing</h3>
              <label className="export-row">
                <input type="checkbox" checked={props.layers} disabled={disabled} onChange={(e) => props.setLayers(e.target.checked)} />
                <span className="export-name">Layers</span>
                <span className="export-what">Those that are shown, in their colours, with a legend</span>
              </label>
              <label className="export-row">
                <input type="checkbox" checked={props.drawMarks} disabled={disabled} onChange={(e) => props.setDrawMarks(e.target.checked)} />
                <span className="export-name">Marks on it</span>
                <span className="export-what">With their numbers</span>
              </label>
              <p className="export-what">Within 0.01 mm of the true outlines of the tracing’s plane, in millimetres, from the last good build.</p>
            </>
          )}
        </>
      )}
    </>
  )
}

/** Of a file of the model: the layout, its parts, and of a mesh the tolerance and angle it is made at. */
function ModelChoices(props: {
  format: ModelFormat
  layouts: string[]
  layout: string | undefined
  parts: LayoutParts
  chosen: string[]
  tolerance: string
  angle: string
  toleranceOk: boolean
  angleOk: boolean
  openAfter: boolean
  disabled: boolean
  setLayout(layout: string): void
  setParts(parts: string[]): void
  setTolerance(text: string): void
  setAngle(text: string): void
  setOpenAfter(on: boolean): void
}) {
  const { format, layouts, layout, parts, chosen, disabled } = props
  const one = format === 'stl'
  const spread = parts.some((part) => part.arranged)
  return (
    <>
      {layouts.length > 1 && (
        <>
          <h3 className="section-title">Layout</h3>
          <div className="segmented export-layouts" role="group" aria-label="Layout">
            {layouts.map((name) => (
              <button key={name} type="button" aria-pressed={name === layout} disabled={disabled} onClick={() => props.setLayout(name)}>
                {name}
              </button>
            ))}
          </div>
        </>
      )}
      <h3 className="section-title">{one ? 'Part' : 'Parts'}</h3>
      <ul className="export-list">
        {parts.map((part) => {
          const cannot = format !== 'step' && (!part.solid || part.reference === true)
          return (
            <li key={part.name}>
              <label className="export-row">
                <input
                  type={one ? 'radio' : 'checkbox'}
                  name={one ? 'export-part' : undefined}
                  checked={chosen.includes(part.name)}
                  disabled={disabled || cannot}
                  onChange={(e) => props.setParts(one ? [part.name] : e.target.checked ? [...chosen, part.name] : chosen.filter((name) => name !== part.name))}
                />
                <span className="export-name">{part.name}</span>
                {(cannot || part.off || part.reference) && <span className="export-what">{cannot ? (part.reference ? 'A bought part: not in a mesh' : 'No solid: a mesh is of solids alone') : part.off ? 'Switched off here' : 'A bought part: in the STEP only if ticked'}</span>}
              </label>
            </li>
          )
        })}
      </ul>
      {spread && <p className="export-what">Parts torno set apart so that they do not overlap are where it put them, as on screen.</p>}
      {format !== 'step' && (
        <>
          <h3 className="section-title">Triangles</h3>
          <div className="export-mesh">
            <label className="export-number">
              Tolerance
              <input className="num" type="text" inputMode="decimal" spellCheck={false} autoComplete="off" aria-label="Tolerance" value={props.tolerance} disabled={disabled} aria-invalid={!props.toleranceOk} onChange={(e) => props.setTolerance(e.target.value)} />
              <span className="num">mm</span>
            </label>
            <label className="export-number">
              Angle
              <input className="num" type="text" inputMode="decimal" spellCheck={false} autoComplete="off" aria-label="Angle" value={props.angle} disabled={disabled} aria-invalid={!props.angleOk} onChange={(e) => props.setAngle(e.target.value)} />
              <span className="num">°</span>
            </label>
          </div>
          <p className="export-what" data-tone={props.toleranceOk && props.angleOk ? undefined : 'warn'}>
            No triangle further than the tolerance from the faces it stands for (
            <span className="num">
              {number(MESH_TOLERANCES[0])} to {number(MESH_TOLERANCES[1])} mm
            </span>
            ), nor turning more than the angle (
            <span className="num">
              {number(MESH_ANGLES[0])} to {number(MESH_ANGLES[1])}°
            </span>
            ). Made for the file, not taken from the screen.
          </p>
        </>
      )}
      {format === '3mf' && (
        <label className="export-row export-open">
          <input type="checkbox" checked={props.openAfter} disabled={disabled} onChange={(e) => props.setOpenAfter(e.target.checked)} />
          <span className="export-name">Open it once saved</span>
          <span className="export-what">In the program your system opens 3MF files with: your slicer</span>
        </label>
      )}
    </>
  )
}
