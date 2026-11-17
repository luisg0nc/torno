import { NO_SCAN_YET, doesOf, hint, pressed } from '../../shared/keys'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ShapeKind } from '../../shared/marks'
import { BETWEEN, ROUND, SELECT_SCOPES, SHAPES, TOOLS, TOOL_GROUPS, setBetween, setRound, setSelectScope, setShape, setTool, useBetween, useRound, useSelectScope, useShape, useTool, type ToolName } from '../state/tools'
import { count } from '../../shared/format'
import { useRegion } from '../state/region'
import { componentsOf, keepHeld, useHeld } from '../state/measured'
import { scanless } from '../state/step'
import { sketchStore } from '../state/sketching'
import { useStore } from '../state/store'
import { commitMark } from '../tools/pickMarks'
import { valueText } from '../../shared/dimension'
import { showKeys } from './KeySheet'
import { numbered } from './numbered'
import { TYPING } from './typing'

/**
 * The tools, floating at the left edge of the viewport: what the pointer does
 * there. Each has a key, shown on its button, which works wherever the view
 * keys do. The Shape button also opens the choice of which shape to place;
 * the one chosen last is the one it shows, and the one its key takes.
 */
export function ToolPalette() {
  const tool = useTool()
  const shape = useShape()
  // What is painted on a scan and not yet kept: it waits while another tool is in hand, and the Region tool's button says so.
  const waiting = useRegion((s) => s.count)
  const [choosing, setChoosing] = useState(false)
  const choice = useRef<HTMLDivElement>(null)
  // Which tip is up: the pointer on a button, or the keys' focus on one. Set on entering and leaving, never per move.
  const [tip, setTip] = useState<TipOf | null>(null)
  // How many scans the object has, once main has said: the scan's tools are offered quieter with none.
  const scans = useStore((s) => (s.scansKnown ? s.scans.length : null))

  // The choice is open only while the Shape tool is in hand, and closes on a press elsewhere or Escape.
  useEffect(() => {
    if (tool !== 'shape') setChoosing(false)
  }, [tool])
  useEffect(() => {
    if (!choosing) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? !pressed(e, 'menu.close') : choice.current?.contains(e.target as Node)) return
      setChoosing(false)
      // Escape closed the choice, and that is all it did: the tool stays in hand.
      if (e instanceof KeyboardEvent) e.preventDefault()
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close, true)
    }
  }, [choosing])

  // A tip is put away by a key, as a tooltip is: it comes back when the pointer enters again.
  useEffect(() => {
    if (tip === null) return
    const away = () => setTip(null)
    window.addEventListener('keydown', away, true)
    return () => window.removeEventListener('keydown', away, true)
  }, [tip])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      const wanted = TOOLS.find((t) => pressed(e, `tool.${t.name}`))
      if (!wanted?.ready) return
      // While a sketch is open X shows or hides the cut the view has (`sketchTool`); picking Section ends the sketch.
      if (wanted.name === 'section' && sketchStore.getState().open) return
      setTool(wanted.name)
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
    {tool === 'measure' && <MeasureChoice />}
    {tool === 'select' && <SelectChoice />}
    <div className="toolbox" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOL_GROUPS.map((g, i) => (
        <Fragment key={g.group}>
          {i > 0 && <span className="toolbox-rule" aria-hidden="true" />}
          <div className="toolbox-group" role="group" aria-label={g.label}>
      {TOOLS.filter((t) => t.group === g.group).map((t) => {
        const quiet = scanless(t.name, scans)
        const notes = noteOf(t.name, { quiet, waiting: t.name === 'region' && tool !== 'region' ? waiting : 0, shape, ready: t.ready })
        const says = { name: t.name, label: t.label, cap: hint(`tool.${t.name}`), does: doesOf(t.name), notes }
        const about = `${says.does}${notes.map((n) => `. ${n}`).join('')}`
        const open = tip === t.name && !(t.name === 'shape' && choosing)
        const tipped = {
          onPointerEnter: () => setTip(t.name),
          onPointerLeave: () => setTip((now) => (now === t.name ? null : now)),
          onFocus: (e: React.FocusEvent) => {
            if (e.target instanceof Element && e.target.matches(':focus-visible')) setTip(t.name)
          },
          onBlur: () => setTip((now) => (now === t.name ? null : now))
        }
        return t.name === 'shape' ? (
          <div key={t.name} className="tool-with-choice tool-tipped" ref={choice} {...tipped}>
            <button
              type="button"
              className="tool-button"
              data-tool={t.name}
              data-shape={shape}
              aria-label={t.label}
              aria-description={about}
              aria-pressed={t.name === tool}
              aria-keyshortcuts={t.key}
              aria-haspopup="menu"
              aria-expanded={choosing}
              onClick={() => {
                setTool(t.name)
                setChoosing((open) => !open)
              }}
            >
              {SHAPE_ICONS[shape]}
              <span className="tool-key num" aria-hidden="true">
                {t.key}
              </span>
            </button>
            {open && <ToolTip {...says} />}
            {choosing && (
              <div className="tool-choice" role="menu" aria-label="Shape to place">
                {SHAPES.map((s) => (
                  <button
                    key={s.kind}
                    type="button"
                    role="menuitemradio"
                    className="tool-button"
                    aria-checked={s.kind === shape}
                    aria-label={s.label}
                    title={s.label}
                    onClick={() => {
                      setShape(s.kind)
                      setChoosing(false)
                    }}
                  >
                    {SHAPE_ICONS[s.kind]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div key={t.name} className="tool-tipped" {...tipped}>
            <button
              type="button"
              className="tool-button"
              data-tool={t.name}
              data-waiting={t.name === 'region' && waiting > 0 && tool !== 'region' ? '' : undefined}
              data-quiet={quiet ? '' : undefined}
              aria-label={t.name === 'region' && waiting > 0 && tool !== 'region' ? `${t.label}: a painting of ${count(waiting)} triangles is waiting` : t.label}
              aria-description={about}
              aria-pressed={t.name === tool}
              aria-keyshortcuts={t.key}
              disabled={!t.ready}
              onClick={() => setTool(t.name)}
            >
              {ICONS[t.name]}
              <span className="tool-key num" aria-hidden="true">
                {t.key}
              </span>
            </button>
            {open && <ToolTip {...says} />}
          </div>
        )
      })}
          </div>
        </Fragment>
      ))}
      {/* At the foot, apart from the tools: every key there is, on one sheet. */}
      <span className="toolbox-rule" aria-hidden="true" />
      <div className="tool-tipped" onPointerEnter={() => setTip('keys')} onPointerLeave={() => setTip((now) => (now === 'keys' ? null : now))} onFocus={(e) => e.target instanceof Element && e.target.matches(':focus-visible') && setTip('keys')} onBlur={() => setTip((now) => (now === 'keys' ? null : now))}>
        <button type="button" className="tool-button tool-keys num" aria-label="Keys" aria-description={KEYS_SAY} aria-keyshortcuts={hint('keys')} onClick={() => showKeys()}>
          {hint('keys')}
        </button>
        {tip === 'keys' && <ToolTip name="keys" label="Keys" cap={hint('keys')} does={KEYS_SAY} notes={[]} />}
      </div>
    </div>
    </>
  )
}

/** The button at the foot of the palette: the sheet it opens lists the pointer's gestures first. */
const KEYS_SAY = 'Every key, and how the pointer turns, pans and zooms the view'

/** Which tip is up: a tool's, or the button for the sheet of keys. */
type TipOf = ToolName | 'keys'

/**
 * What a tool's tip says besides what it does: why it is quieter (a scan's tool with no scan), a painting that waits
 * on the scan, the shape the Shape tool places now. Each a sentence of its own, without a closing full stop.
 */
function noteOf(name: ToolName, of: { quiet: boolean; waiting: number; shape: ShapeKind; ready: boolean }): string[] {
  const notes: string[] = []
  if (of.quiet) notes.push(NO_SCAN_YET)
  if (name === 'shape') notes.push(`Places a ${of.shape} now; click the button again to choose another`)
  if (of.waiting > 0) notes.push(`A painting of ${count(of.waiting)} triangles is waiting: keep it or clear it`)
  if (!of.ready) notes.push('Not available yet')
  return notes
}

/**
 * A small panel beside a button of the palette, at once: the name, the key cap and what the tool does, then what
 * else is worth knowing of it now. It takes no pointer and is not read out itself: the button holds the same words
 * as its description.
 */
function ToolTip({ name, label, cap, does, notes }: { name: string; label: string; cap: string; does: string; notes: string[] }) {
  return (
    <div className="tool-tip" data-tip={name} aria-hidden="true">
      <div className="tool-tip-head">
        <span className="tool-tip-name">{label}</span>
        <kbd className="num">{cap}</kbd>
      </div>
      <div className="tool-tip-does">{does}</div>
      {notes.map((note) => (
        <div key={note} className="tool-tip-note">
          {numbered(note)}
        </div>
      ))}
    </div>
  )
}

/**
 * In the bottom corner of the viewport while the Measure tool is in hand,
 * clear of the part: what two clicks measure, what a double click on something round
 * measures, and the key that has no button. Each choice holds for the pair
 * of clicks under way, and from then on.
 */
function MeasureChoice() {
  const between = useBetween()
  const round = useRound()
  return (
    <div className="measure-choice" role="group" aria-label="What to measure">
      <div className="segmented" role="group" aria-label="Two clicks measure">
        {BETWEEN.map((b) => (
          <button key={b.measure} type="button" title={b.title} aria-pressed={b.measure === between} onClick={() => setBetween(b.measure)}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="A double click on something round measures">
        {ROUND.map((r) => (
          <button key={r.measure} type="button" title={r.title} aria-pressed={r.measure === round} onClick={() => setRound(r.measure)}>
            {r.label}
          </button>
        ))}
      </div>
      <span className="measure-key" title={`Press ${hint('measure.wall')} with the pointer on a face to measure the wall under it. Shift-click measures from a bare point`}>
        <kbd className="num">{hint('measure.wall')}</kbd> thickness
      </span>
      <MeasureLast />
    </div>
  )
}

/** In the same corner while the Select tool is in hand: what a click takes. It holds from then on. */
function SelectChoice() {
  const scope = useSelectScope()
  return (
    <div className="measure-choice" role="group" aria-label="What a click selects">
      <div className="segmented" role="group" aria-label="A click selects">
        {SELECT_SCOPES.map((c) => (
          <button key={c.scope} type="button" title={c.title} aria-pressed={c.scope === scope} onClick={() => setSelectScope(c.scope)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The last measurement, after the choices: the kernel's value and how it was taken, and a button that keeps it as a
 * dimension (as `Enter` does). Only of the object and build on show: of any other it is not shown. It changes once
 * per measurement, never per pointer move.
 */
function MeasureLast() {
  const held = useHeld((s) => s.held)
  const keeping = useHeld((s) => s.keeping)
  const refused = useHeld((s) => s.refused)
  const objectId = useStore((s) => s.objectId)
  const revision = useStore((s) => s.revision)
  if (!held || held.objectId !== objectId || held.revision !== revision) return null
  return (
    <span className="measure-last" role="status">
      {held.kept !== undefined ? (
        <span className="measure-last-text">
          Kept as <span className="num">{held.kept}</span>
        </span>
      ) : (
        <>
          <span className="measure-last-text" title={`Measured on r${held.revision}, not kept: the agent is not told`}>
            Last: <span className="num">{valueText(held.measure, held.value)}</span> <span className="measure-how">{held.how}</span>
            {componentsOf(held)?.map(([axis, text]) => (
              <span key={axis} className="measure-delta">
                {' '}
                Δ{axis} <span className="num">{text}</span>
              </span>
            ))}
          </span>
          <button
            type="button"
            className="measure-keep"
            disabled={keeping}
            title={`Keep it as a dimension (${hint('measure.keep')}): a mark, measured again on every build, sent with the next prompt`}
            onClick={() => void keepHeld(commitMark).catch(() => {})}
          >
            Keep as a dimension
          </button>
          {refused !== null && <span className="measure-refused">{refused}</span>}
        </>
      )}
    </span>
  )
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** The picture of each shape the Shape tool places: on its button, in its choice, and on the shape's row in the marks panel. */
export const SHAPE_ICONS: Record<ShapeKind, ReactNode> = {
  // A box, seen from a corner.
  box: (
    <Icon>
      <path d="M8 1.750 13.500 4.750v6.500L8 14.250l-5.500-3v-6.500L8 1.750ZM2.500 4.750 8 7.750l5.500-3M8 7.750v6.500" />
    </Icon>
  ),
  // A cylinder, standing.
  cylinder: (
    <Icon>
      <ellipse cx="8" cy="4.250" rx="4.750" ry="2" />
      <path d="M3.250 4.250v7.500c0 1.100 2.130 2 4.750 2s4.750-.9 4.750-2v-7.500" />
    </Icon>
  ),
  // A sphere, with its equator.
  sphere: (
    <Icon>
      <circle cx="8" cy="8" r="5.750" />
      <path d="M2.250 8c0 1.100 2.570 2 5.750 2s5.750-.9 5.750-2" />
    </Icon>
  ),
  // A plane, lying flat.
  plane: (
    <Icon>
      <path d="M5 4.750h9.250L11 11.250H1.750L5 4.750Z" />
    </Icon>
  )
}

/** The picture of each tool; the marks panel shows the same ones for what the tools leave. */
export const ICONS: Record<ToolName, ReactNode> = {
  // A pointer.
  select: (
    <Icon>
      <path d="M3.5 2.5v10l2.9-2.6 1.9 4 1.6-.8-1.9-3.9 3.7-.3-8.2-6.4Z" />
    </Icon>
  ),
  // A map pin, standing on its point.
  pin: (
    <Icon>
      <path d="M8 14s4-4.2 4-7.4a4 4 0 0 0-8 0C4 9.800 8 14 8 14Z" />
      <circle cx="8" cy="6.5" r="1.4" />
    </Icon>
  ),
  // From a point, to where it should go.
  arrow: (
    <Icon>
      <path d="M3 13 12.5 3.500M7.500 3.250h5.250V8.500" />
    </Icon>
  ),
  // A pencil.
  draw: (
    <Icon>
      <path d="m2.750 13.250.7-3L10.900 2.800a1.100 1.100 0 0 1 1.550 0l.75.750a1.100 1.100 0 0 1 0 1.550L5.750 12.550l-3 .7ZM9.750 4l2.250 2.250" />
    </Icon>
  ),
  shape: SHAPE_ICONS.box,
  // A block sawn through: the half that is kept, the half that is taken away, and the plane between them.
  section: (
    <Icon>
      <path d="M3.750 8v4.750h8.500V8M1.500 8h13" />
      <path d="M3.750 6V3.250h8.500V6" strokeDasharray="1.5 2" />
    </Icon>
  ),
  // A rule, laid across: its edge and its graduations.
  measure: (
    <Icon>
      <path d="M1.750 10.250 10.250 1.750l4 4-8.500 8.500-4-4ZM4.500 7.500l1.500 1.500M6.750 5.250l1 1M9 3l1.500 1.500" />
    </Icon>
  ),
  // A scan, dashed, brought onto the part it is a scan of: two outlines and the move between them.
  align: (
    <Icon>
      <path d="M2.250 8.750h6v5h-6v-5Z" />
      <path d="M7.750 2.250h6v5h-6v-5Z" strokeDasharray="1.5 1.75" />
      <path d="M10.250 8.750v2.500H9.750M11 10l-.750 1.250L9.500 10" />
    </Icon>
  ),
  // A brush, and what it has painted on the scan: a patch, dashed like the scan it is of.
  region: (
    <Icon>
      <path d="m8.750 7.750 4.300-5.200a.9.900 0 0 1 1.400 1.150L10.250 9M8.750 7.750 10.250 9c.3 1.600-.9 3-2.750 2.750-.9-.1-1.500-.6-1.750-1 .9-.1 1.300-.6 1.500-1.500.150-.8.7-1.350 1.500-1.500Z" />
      <path d="M2 13.250c1-1.400 2.250-1.400 3.250 0s2.250 1.400 3.250 0" strokeDasharray="1.5 1.75" />
    </Icon>
  )
}
