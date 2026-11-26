import { hint, pressed } from '../../shared/keys'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { type ExportFormat, type ExportItem, type ExportPlan, type ExportRequest, type ExportSaved, type ShareKind, PICTURE_SIZES, MESH_ANGLE, MESH_ANGLES, MESH_TOLERANCE, MESH_TOLERANCES, type ModelFormat, NOT_BUILT, PHOTO_WARNING, SCAN_WARNING, defaultLayout, megabytes } from '../../shared/exportdata'
import { count, number } from '../../shared/format'
import { typed } from './typed'
import { setExporting } from '../closing'
import { actions, sceneFileOf, store, useStore } from '../state/store'
import { pictureForPerson } from '../state/agent'
import { keepFile, letGo } from '../state/exportSaved'
import { previewStore } from '../state/exportPreview'
import { type Tracing, tracingName } from '../../shared/tracings'
import { Count } from './export/Checked'
import { type Tile, actionWords, bandWords, tilesOf, weightSaid } from './export/exportWords'
import { weighRule, weighed } from './export/weighRule'

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

/** The 32 × 26 line drawing of each tile. */
const DRAWINGS: Record<Tile['name'], ReactNode> = {
  'A page': (
    <>
      <rect x="3" y="3" width="32" height="24" rx="2" />
      <path d="M3 9h32M24 9v18" />
      <path d="M8 20l5-5 4 3 4-4" />
    </>
  ),
  CAD: <path d="M19 4 33 11 19 18 5 11Z M5 11v9l14 7 14-7v-9 M19 18v9" />,
  Slicer: (
    <>
      <path d="M4 22 19 27 34 22 19 17Z" />
      <path d="M12 19l3-8 6 2 2 7M14 13l7-3" />
    </>
  ),
  Picture: (
    <>
      <rect x="4" y="5" width="30" height="20" rx="2" />
      <circle cx="13" cy="12" r="2.5" />
      <path d="M4 22l9-6 6 4 6-5 9 7" />
    </>
  ),
  Tracing: (
    <>
      <rect x="4" y="4" width="30" height="22" rx="1" />
      <path d="M10 20V10h12l4 5v5Z M4 22h8" />
    </>
  )
}

/** Why a tile is dimmed: a picture and a tracing are of the project on show. */
const NOT_ON_SHOW = 'Open the project first: this is made of its view, and the export is not of the project on show'

/**
 * What goes into an export, said before anything is written, in the session dock under its header (spec 2026-11-18, "Export, on
 * the bench"): five tiles for what is made, a line for each thing that can go with what it weighs, the weight against the budget on a
 * rule, and the action. The view behind it is the preview. Marks and scans are off until ticked: a note may be private, and a scan may
 * show the real world. "Export" asks main, which asks where to save; the window never names a path. A file that was written closes
 * the sheet and lands in the status line (`state/exportSaved.ts`).
 */
export function ExportSheet({ onOpen }: { onOpen: (id: string, ticked: string[]) => void }) {
  const of = useStore((s) => s.exportOf)
  const tracing = useStore((s) => s.exportTracing)
  if (of === null) return null
  return <Sheet key={`${of === 'all' ? 'all' : of.join('\n')}\0${tracing ?? ''}`} of={of} tracing={tracing} onOpen={onOpen} />
}

function Sheet({ of, tracing, onOpen }: { of: string[] | 'all'; tracing: string | null; onOpen: (id: string, ticked: string[]) => void }) {
  const names = useStore((s) => s.workspace?.objects ?? NONE)
  const [objects, setObjects] = useState<string[] | null>(of === 'all' ? null : of)
  const [marks, setMarks] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [scans, setScans] = useState<string[]>([])
  const [plan, setPlan] = useState<ExportPlan | null>(null)
  const [busy, setBusy] = useState<'planning' | 'saving' | null>('planning')
  const [said, setSaid] = useState<{ nothing?: true; error?: string } | null>(null)
  // A file of the model: its format, layout and parts (null until the person picks: the format's defaults), the tolerance and angle of a mesh as typed, and whether a 3MF is opened once saved.
  const [format, setFormat] = useState<ExportFormat>('html')
  const [layout, setLayout] = useState<string | null>(null)
  const [parts, setParts] = useState<string[] | null>(null)
  const [tolerance, setTolerance] = useState(String(MESH_TOLERANCE))
  const [angle, setAngle] = useState(String(MESH_ANGLE))
  const [openAfter, setOpenAfter] = useState(false)
  // A file of the open project's view (a picture, a drawing of its section) instead of one of the project: null for the others.
  // Opened from a tracing, the sheet is on that tracing's drawing (an SVG, as the first of its kinds), and the person may choose another.
  const [shared, setShared] = useState<ShareKind | null>(tracing === null ? null : 'svg')
  const [pictureSize, setPictureSize] = useState(PICTURE_SIZES[0])
  const [pictureMarks, setPictureMarks] = useState(true)
  const [pictureCues, setPictureCues] = useState(true)
  // Of a tracing (`Tracing`): the section on screen, or one of the project's tracings by its `T<n>`; null until the person picks, and what is in it.
  const [drawing, setDrawing] = useState<string | null>(tracing)
  const [tracings, setTracings] = useState<Tracing[]>([])
  const [drawLayers, setDrawLayers] = useState(true)
  const [drawMarks, setDrawMarks] = useState(false)
  /** The tracing's photo is off until ticked: it may show the real world. */
  const [drawPhoto, setDrawPhoto] = useState(false)
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
  /** A file was written and handed to the status line: main keeps its path until that lets go of it, not when this goes. */
  const handed = useRef(false)
  // Closing the window while the file is written would leave none: the window asks first (`closing.ts`).
  useEffect(() => {
    setExporting(busy === 'saving')
    return () => setExporting(false)
  }, [busy])

  // The dock is where it is: shown. The file of an export before this one is let go of, and the export is of what is on screen: what the
  // open object's scene file should hold is given to main now, not when the next save is due.
  useEffect(() => {
    letGo()
    actions.setDockOpen(true)
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

  // Escape puts it away from wherever the focus is; the focus comes back to where it was when it goes.
  useEffect(() => {
    const before = document.activeElement
    sheet.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (pressed(e, 'sheet.close') && !e.defaultPrevented && !saving.current) actions.exportSheet(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      // What main kept ready for this sheet (scans reduced) is let go, unless a file it wrote is held for the status line, which lets go of both.
      if (!handed.current) window.torno.export.done()
      window.removeEventListener('keydown', onKey)
      const now = document.activeElement
      if (before instanceof HTMLElement && before.isConnected && (now === null || now === document.body || !now.isConnected)) before.focus()
    }
  }, [])

  const ticked = objects ?? []
  const model = shared !== null || format === 'html' ? null : format
  const html = shared === null && model === null
  // What the view says of what is made: the band names it, and the parts switched off are tagged where they stand while they stay out.
  useEffect(() => {
    previewStore.setState({ preview: { what: bandWords(format, shared), leavesOut: html && !hidden, saving: busy === 'saving' } })
    return () => previewStore.setState({ preview: null })
  }, [format, shared, html, hidden, busy === 'saving'])
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

  /** The file was written: the sheet is put away and the status line has it, with what was checked. */
  function finish(saved: ExportSaved, kept?: ShareKind): void {
    handed.current = true
    keepFile(openId, saved, kept)
    actions.exportSheet(null)
  }

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
            : await window.torno.export.saveTracing(openId, source, kind, { layers: drawLayers, marks: drawMarks, photo: drawPhoto && tracings.find((one) => one.id === source)?.photo?.straightened !== undefined })
      if (saved) return finish(saved, kind)
      setSaid({ nothing: true })
    } catch (e) {
      setSaid({ error: e instanceof Error ? e.message : String(e) })
    }
    setBusy(null)
  }

  async function save() {
    if (shared !== null) return keep(shared)
    setBusy('saving')
    setSaid(null)
    // Whatever was changed in the view since the sheet came up is in the file too.
    const s = store.getState()
    if (s.objectId !== null) window.torno.object.saveSceneFile(s.objectId, sceneFileOf(s))
    try {
      const saved = await window.torno.export.save(request())
      if (saved) return finish(saved)
      setSaid({ nothing: true })
    } catch (e) {
      setSaid({ error: e instanceof Error ? e.message : String(e) })
    }
    setBusy(null)
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

  // What each line weighs (`plan.items`), and the colour its share has on the rule: those that go and weigh something, in order.
  const items = plan?.items ?? []
  const going = weighed(items)
  const colourOf = (id: string): string | undefined => {
    const at = going.findIndex((one) => one.id === id)
    return at < 0 ? undefined : `var(--part-${(at % 8) + 1})`
  }
  /** A line that stands for the lines of one kind (marks of every project ticked): what they weigh together, and whether they go. */
  const kindLine = (kind: ExportItem['kind']): WeightOf | undefined => {
    const mine = items.filter((one) => one.kind === kind)
    if (mine.length === 0) return undefined
    return { bytes: mine.reduce((total, one) => total + one.bytes, 0), on: mine.some((one) => one.on), colour: colourOf(mine.find((one) => one.on)?.id ?? '') }
  }
  const lineOf = (id: string): WeightOf | undefined => {
    const one = items.find((item) => item.id === id)
    return one && { bytes: one.bytes, on: one.on, colour: colourOf(id) }
  }

  const project = of === 'all' ? null : of.length === 1 ? nameOf(of[0]) : null
  const ofViewTiles = ofView
  const tile = shared === 'png' ? 'Picture' : shared !== null ? 'Tracing' : format === 'html' ? 'A page' : format === 'step' ? 'CAD' : 'Slicer'
  const pick = (one: Tile): void => {
    if (one.name === 'A page') return choose('html')
    if (one.name === 'CAD') return choose('step')
    if (one.name === 'Slicer') return choose(format === 'stl' ? 'stl' : '3mf')
    if (!ofViewTiles) return
    if (one.name === 'Picture') return choose('png')
    choose(shared === 'pdf' ? 'pdf' : 'svg')
  }
  const refused = plan?.refusal !== undefined
  const exportOff = shared !== null ? busy !== null || openId === null || (shared !== 'png' && source === 'section' && !cut) : busy !== null || plan === null || refused || (model !== null && (partsNow.length === 0 || !meshOk))

  return (
    <section
      ref={sheet}
      className="export-dock"
      role="dialog"
      aria-label="Export"
      tabIndex={-1}
      onKeyDown={(e) => {
        // No tool of the view is handed a key from here: what is exported is what was on screen when the sheet came up.
        e.stopPropagation()
        if (pressed(e, 'sheet.close') && busy !== 'saving') actions.exportSheet(null)
      }}
    >
      <header className="export-head">
        <h2>{project !== null ? `Export ${project}` : 'Export projects'}</h2>
        <button type="button" className="button button-quiet export-close" title={`Close (${hint('sheet.close')})`} disabled={busy === 'saving'} onClick={() => actions.exportSheet(null)}>
          Close <kbd>{hint('sheet.close')}</kbd>
        </button>
      </header>
      <div className="export-tiles" role="group" aria-label="Format">
        {tilesOf().map((one) => {
          const on = tile === one.name
          const dim = (one.name === 'Picture' || one.name === 'Tracing') && !ofViewTiles
          const choice = on && one.formats.length > 1
          return (
            <div key={one.name} className="export-tile" data-on={on ? '' : undefined} data-dim={dim ? '' : undefined}>
              <button type="button" aria-label={one.name} aria-pressed={on} aria-disabled={dim ? true : undefined} title={dim ? NOT_ON_SHOW : one.title} disabled={busy === 'saving'} onClick={() => pick(one)}>
                <svg width="32" height="26" viewBox="0 0 38 30" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
                  {DRAWINGS[one.name]}
                </svg>
                <b>{one.name}</b>
                {!choice && <span className="num">{one.formats.join(' ')}</span>}
              </button>
              {choice && (
                <span className="segmented export-mini" role="group" aria-label={`${one.name} file`}>
                  {one.formats.map((name) => {
                    const kind = name.toLowerCase() as ExportFormat | ShareKind
                    const now = shared === null ? format === kind : shared === kind
                    return (
                      <button key={name} type="button" className="num" aria-pressed={now} disabled={busy === 'saving'} onClick={() => choose(kind)}>
                        {name}
                      </button>
                    )
                  })}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="export-body">
          {shared !== null && (
            <ViewChoices
              kind={shared}
              project={openId === null ? '' : nameOf(openId)}
              cut={cut}
              tracings={tracings}
              source={source}
              layers={drawLayers}
              drawMarks={drawMarks}
              photo={drawPhoto}
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
              setPhoto={(next) => {
                changed()
                setDrawPhoto(next)
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
              {html && items.some((one) => one.kind === 'page') && (
                <>
                  <h3 className="section-title">The page</h3>
                  <div className="export-line" data-fixed="">
                    <span className="export-name">The page itself</span>
                    <Weight line={lineOf('page')} />
                    <span className="export-what">The viewer and what no line below owns</span>
                  </div>
                </>
              )}
              <h3 className="section-title">{model ? 'Project' : 'Projects'}</h3>
              <ul className="export-list">
                {can.map((object) => (
                  <li key={object.id}>
                    <label className="export-line">
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
                      <span className="export-name">
                        {nameOf(object.id)} <span className="num">r{object.revision}</span>
                      </span>
                      {html && <Weight line={lineOf(object.id)} />}
                      <span className="export-what">
                        <span className="num">{count(object.parts ?? 0)}</span> {object.parts === 1 ? 'part' : 'parts'}
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
              <label className="export-line">
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
                <Weight line={kindLine('off')} />
                <span className="export-what">
                  <Count n={off} one="part is" many="parts are" /> switched off here: {hidden ? 'in the file, switched off, for whoever opens it to switch on' : 'left out of the file, with the marks on ' + (off === 1 ? 'it' : 'them')}
                </span>
              </label>
            </>
          )}

          {html && (
            <>
              <h3 className="section-title">Marks</h3>
              <label className="export-line">
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
                <Weight line={kindLine('marks')} />
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
                <label className="export-line">
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
                  <Weight line={kindLine('resolved')} />
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
                        <label className="export-line">
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
                          <Weight line={lineOf(key)} scan />
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

          {model && <p className="export-what export-then">The kernel reads the file back, each part by name, each volume and box, before it takes the name you give it. A file that fails is not saved.</p>}
      </div>
      <div className="export-weigh">
        {shared !== null || model ? (
          <div className="export-size" aria-live="polite">
            <span className="export-big num">{shared === 'png' ? pictureSize : shared !== null ? '' : partsNow.length}</span>
            <span className="export-of">{shared === 'png' ? 'px, the long edge' : shared !== null ? weighWords(shared, source, cut) : `${partsNow.length === 1 ? 'part' : 'parts'}, in mm, read back and checked`}</span>
          </div>
        ) : plan?.refusal ? (
          <p className="export-refusal" data-tone={plan.bytes > 0 ? 'fail' : undefined} aria-live="polite">
            {plan.refusal}
          </p>
        ) : plan ? (
          <WeightRule plan={plan} planning={busy === 'planning'} colourOf={colourOf} />
        ) : null}
        {shared === null && !model && plan && !plan.refusal && plan.dropped.map((sentence) => (
          <p key={sentence} className="export-note" data-tone="warn">
            To keep it small: {sentence}
          </p>
        ))}
        {shared === null && !model && plan?.over && !plan.refusal && (
          <p className="export-note" data-tone="warn">
            The parts alone are over the <span className="num">{megabytes(plan.budget)}</span> torno keeps a file to. Export fewer projects, or go ahead.
          </p>
        )}
        {said?.nothing && <p className="export-note">Nothing was saved</p>}
        {said?.error && (
          <p className="export-note" data-tone="fail">
            {said.error}
          </p>
        )}
      </div>
      <footer className="export-foot">
        {busy === 'saving' ? (
          <p className="export-never" aria-live="polite">
            {model ? 'Making the file and reading it back…' : 'Making the file…'}
          </p>
        ) : (
          <p className="export-never">Nothing about this computer goes in the file.</p>
        )}
        <div className="export-actions">
          <button type="button" className="button" disabled={busy === 'saving'} onClick={() => actions.exportSheet(null)}>
            Cancel
          </button>
          <button type="button" className="button button-primary" disabled={exportOff} onClick={() => void save()}>
            {busy === 'saving' ? 'Exporting…' : actionWords(format, shared)}
          </button>
        </div>
      </footer>
    </section>
  )
}

const NONE: never[] = []

/** What a file of the view says under its number: the drawing needs a section on screen, and says so. */
function weighWords(kind: ShareKind, source: string, cut: boolean): string {
  if (kind === 'png') return ''
  if (source !== 'section') return 'Made from the kernel’s outlines of the tracing’s plane, on the last good build'
  return cut ? 'Made from the kernel’s outlines of the section on screen' : 'There is no section on screen: close this, cut the project (the Section tool, X), and come back'
}

/** What a line weighs: its bytes, whether it goes, and the colour of its share of the rule. */
interface WeightOf {
  bytes: number
  on: boolean
  colour?: string
}

/** The weight at the right of a line, in mono, with a square of the line's colour; struck through and muted when the line is off. A scan the budget left out says so. */
function Weight({ line, scan = false }: { line: WeightOf | undefined; scan?: boolean }) {
  if (!line) return null
  const left = scan && line.on && line.bytes === 0
  return (
    <span className="export-weight num" data-off={line.on ? undefined : ''} data-left={left ? '' : undefined}>
      <i style={{ background: line.on && !left ? line.colour : undefined } as CSSProperties} aria-hidden="true" />
      {left ? 'left out for size' : weightSaid(line.bytes)}
    </span>
  )
}

/** The total in 30 px mono, "of 12 MB", and the rule from 0 to the budget, filled with the lines that go; the overflow past the budget in `--fail`. */
function WeightRule({ plan, planning, colourOf }: { plan: ExportPlan; planning: boolean; colourOf(id: string): string | undefined }) {
  const lines = weighed(plan.items)
  const rule = weighRule(plan.items, plan.budget)
  const label = (bytes: number): string => (bytes === 0 ? '0' : megabytes(bytes).replace(' MB', ''))
  return (
    <>
      <div className="export-size" aria-live="polite" data-bytes={plan.bytes} data-planning={planning ? '' : undefined}>
        <span className="export-big num">{megabytes(plan.bytes)}</span>
        <span className="export-of">
          of <span className="num">{megabytes(plan.budget)}</span>
        </span>
      </div>
      <div className="export-rule" data-over={rule.over > 0 ? '' : undefined} style={{ '--over': Math.min(rule.over, 0.25) } as CSSProperties}>
        <div className="export-track">
          <div className="export-fill">
            {rule.segments.map((segment, at) => (
              <i key={lines[at].id} data-line={lines[at].id} title={lines[at].id} style={{ width: `${segment.share * 100}%`, background: colourOf(lines[at].id) }} />
            ))}
          </div>
          {rule.over > 0 && <i className="export-over" data-over="" />}
          {rule.ticks.map((tick, at) => (
            <b key={at} className="export-tick num" data-at={at} style={{ left: `${(tick / plan.budget) * 100}%` }}>
              {at === 2 ? megabytes(tick) : label(tick)}
            </b>
          ))}
        </div>
      </div>
    </>
  )
}

/** Of a picture of the view or a drawing of its section: of the open project as it is on screen, so no list of projects; the size of a picture and what is in it. */
function ViewChoices(props: { kind: ShareKind; project: string; cut: boolean; tracings: Tracing[]; source: string; layers: boolean; drawMarks: boolean; photo: boolean; size: number; marks: boolean; cues: boolean; disabled: boolean; setSource(source: string): void; setLayers(on: boolean): void; setDrawMarks(on: boolean): void; setPhoto(on: boolean): void; setSize(size: number): void; setMarks(on: boolean): void; setCues(on: boolean): void }) {
  /** The tracing's photo can be drawn once it is lined up and has its straightened copy. */
  const photoReady = props.tracings.find((one) => one.id === props.source)?.photo?.straightened !== undefined
  const { kind, disabled } = props
  return (
    <>
      {kind === 'png' ? (
        <>
          <h3 className="section-title">Project</h3>
          <p className="export-what">
            {props.project}, as it is on screen
          </p>
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
          <label className="export-line">
            <input type="checkbox" checked={props.marks} disabled={disabled} onChange={(e) => props.setMarks(e.target.checked)} />
            <span className="export-name">Marks</span>
            <span className="export-what">With their numbers, as on screen</span>
          </label>
          <label className="export-line">
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
              <label className="export-line">
                <input type="radio" name="export-drawing" checked={props.source === 'section'} disabled={disabled} onChange={() => props.setSource('section')} />
                <span className="export-name">The section on screen</span>
                <span className="export-what">{props.cut ? 'As it is cut now' : 'There is none: cut the project first (the Section tool, X)'}</span>
              </label>
            </li>
            {props.tracings.map((one) => (
              <li key={one.id}>
                <label className="export-line">
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
              <label className="export-line">
                <input type="checkbox" checked={props.layers} disabled={disabled} onChange={(e) => props.setLayers(e.target.checked)} />
                <span className="export-name">Layers</span>
                <span className="export-what">Those that are shown, in their colours, with a legend</span>
              </label>
              <label className="export-line">
                <input type="checkbox" checked={props.drawMarks} disabled={disabled} onChange={(e) => props.setDrawMarks(e.target.checked)} />
                <span className="export-name">Marks on it</span>
                <span className="export-what">With their numbers</span>
              </label>
              <label className="export-line" data-row="photo">
                <input type="checkbox" checked={props.photo && photoReady} disabled={disabled || !photoReady} onChange={(e) => props.setPhoto(e.target.checked)} />
                <span className="export-name">The photo</span>
                <span className="export-what">{photoReady ? 'Straightened, under the outline, at its fade, with its line-up in the title block (never exact)' : props.tracings.find((one) => one.id === props.source)?.photo === undefined ? 'This tracing has no photo' : 'Not lined up yet: line it up in the tracing first'}</span>
              </label>
              {props.photo && photoReady && <p className="export-warning">{PHOTO_WARNING}</p>}
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
              <label className="export-line">
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
        <label className="export-line export-open">
          <input type="checkbox" checked={props.openAfter} disabled={disabled} onChange={(e) => props.setOpenAfter(e.target.checked)} />
          <span className="export-name">Open it once saved</span>
          <span className="export-what">In the program your system opens 3MF files with: your slicer</span>
        </label>
      )}
    </>
  )
}
