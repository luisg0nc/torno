import { NO_SCAN_YET, doesOf, hint, pressed } from '../../shared/keys'
import { useEffect, useState, type ReactNode } from 'react'
import type { ShapeKind } from '../../shared/marks'
import { BETWEEN, ROUND, SELECT_SCOPES, TOOLS, TOOL_GROUPS, setBetween, setRound, setSelectScope, setShape, setTool, toolStore, useBetween, useRound, useSelectScope, useShape, useTool, type BetweenMeasure, type RoundMeasure, type SelectScope, type PaletteTool, type ToolName } from '../state/tools'
import { count } from '../../shared/format'
import { regionStore, useRegion, type RegionMode } from '../state/region'
import { scanless } from '../state/step'
import { setPen, sketchStore, useSketching, type SketchPen } from '../state/sketching'
import { useStore } from '../state/store'
import { numbered } from './numbered'
import { TYPING } from './typing'
import { WALL, pillOf, segmentsOf, type ReedChoice, type ReedPill, type TracingToolName } from './view/reedPill'

/**
 * The tools, the reed at the left of the view: what the pointer does there. Round buttons in pills, no letter on them:
 * the key is in the tip and in the name. The tool in hand is an accent circle and its name grows out to the right with
 * its key and its few choices (`pillOf`); Select is the tool at rest and grows its scope only when asked for. Each key
 * works wherever the view keys do. Measure's last reading and its Keep button are the tag on the measured line (`MeasureTag`).
 */
export function ToolPalette() {
  const tool = useTool()
  const shape = useShape()
  const scope = useSelectScope()
  const between = useBetween()
  const round = useRound()
  const mode = useRegion((s) => s.mode)
  const pen = useSketching((s) => s.pen)
  const sketching = useSketching((s) => s.open !== null)
  // What is painted on a scan and not yet kept: it waits while another tool is in hand, and the Region tool's button says so.
  const waiting = useRegion((s) => s.count)
  // Select's scope was asked for: by a click on Select, or its key while it is in hand. It stays out until another tool is taken up.
  const [scopeOpen, setScopeOpen] = useState(false)
  // Which tip is up: the pointer on a button, or the keys' focus on one. Set on entering and leaving, never per move.
  const [tip, setTip] = useState<ToolName | null>(null)
  // How many scans the object has, once main has said: the scan's tools are offered quieter with none.
  const scans = useStore((s) => (s.scansKnown ? s.scans.length : null))

  useEffect(() => {
    if (tool !== 'select') setScopeOpen(false)
  }, [tool])

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
      // The key of Select while it is in hand asks for its scope.
      if (wanted.name === 'select' && toolStore.getState().tool === 'select') setScopeOpen(true)
      setTool(wanted.name)
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <ReedView
      state={{ tool, shape, scope, scopeOpen, sketching, pen, between, round, mode, scans, waiting, tip }}
      on={{
        tool: (name) => {
          if (name === 'select') setScopeOpen((open) => (tool === 'select' ? !open : true))
          setTool(name)
        },
        choose: (of, id) => {
          if (of === 'select') setSelectScope(id as SelectScope)
          else if (of === 'measure') (BETWEEN.some((b) => b.measure === id) ? setBetween(id as BetweenMeasure) : setRound(id as RoundMeasure))
          else if (of === 'shape') setShape(id as ShapeKind)
          else if (of === 'draw') setPen(id as SketchPen)
          else if (of === 'region') regionStore.setState({ mode: id as RegionMode })
        },
        tip: (name, up) => setTip((now) => (up ? name : now === name ? null : now))
      }}
    />
  )
}

/** What the reed is drawn from. */
export interface ReedState {
  tool: ToolName
  shape: ShapeKind
  scope: SelectScope
  scopeOpen: boolean
  sketching: boolean
  pen: SketchPen
  between: BetweenMeasure
  round: RoundMeasure
  mode: RegionMode
  /** How many scans the object has; null until main has said. */
  scans: number | null
  /** The triangles painted on a scan and not kept. */
  waiting: number
  /** The tool whose tip is up. */
  tip: ToolName | null
}

/** What a press on the reed does. */
export interface ReedOn {
  tool: (name: ToolName) => void
  choose: (tool: ToolName, id: string) => void
  tip: (name: ToolName, up: boolean) => void
}

/** The reed as it is drawn from the state: pure, so that it is drawn the same from any. */
export function ReedView({ state, on }: { state: ReedState; on: ReedOn }) {
  const { tool, shape, scans, waiting, tip } = state
  return (
    <div className="toolbox" role="toolbar" aria-label="Tools" aria-orientation="vertical" data-tag-avoid="">
      {TOOL_GROUPS.map((g) => (
        <div key={g.group} className="toolbox-group" role="group" aria-label={g.label}>
          {TOOLS.filter((t) => t.group === g.group).map((t) => {
            const quiet = scanless(t.name, scans)
            const waits = t.name === 'region' && tool !== 'region' ? waiting : 0
            const notes = noteOf(t.name, { quiet, waiting: waits, shape, ready: t.ready })
            const says = { name: t.name, label: t.label, cap: hint(`tool.${t.name}`), does: doesOf(t.name), notes }
            const about = `${says.does}${notes.map((n) => `. ${n}`).join('')}`
            const inHand = t.name === tool
            const pill = inHand ? pillOf(t.name, state) : null
            return (
              <div
                key={t.name}
                className="tool-tipped"
                onPointerEnter={() => on.tip(t.name, true)}
                onPointerLeave={() => on.tip(t.name, false)}
                onFocus={(e) => {
                  if (e.target instanceof Element && e.target.matches(':focus-visible')) on.tip(t.name, true)
                }}
                onBlur={() => on.tip(t.name, false)}
              >
                <button
                  type="button"
                  className="tool-button"
                  data-tool={t.name}
                  data-shape={t.name === 'shape' ? shape : undefined}
                  data-waiting={waits > 0 ? '' : undefined}
                  data-quiet={quiet ? '' : undefined}
                  aria-label={waits > 0 ? `${t.label}: a painting of ${count(waits)} triangles is waiting` : t.label}
                  aria-description={about}
                  aria-pressed={inHand}
                  aria-keyshortcuts={t.key}
                  disabled={!t.ready}
                  onClick={() => on.tool(t.name)}
                >
                  {t.name === 'shape' ? SHAPE_ICONS[shape] : ICONS[t.name]}
                </button>
                {tip === t.name && pill === null && <ToolTip {...says} />}
                {pill !== null && <ReedPillView of={t.name} pill={pill} chosen={(id) => chosenOf(t.name, id, state)} onChoose={(id) => on.choose(t.name, id)} />}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Whether a choice of a tool's pill is the one in hand. */
function chosenOf(tool: ToolName, id: string, s: ReedState): boolean {
  switch (tool) {
    case 'select':
      return s.scope === id
    case 'measure':
      return s.between === id || s.round === id
    case 'shape':
      return s.shape === id
    case 'draw':
      return s.pen === id
    case 'region':
      return s.mode === id
    default:
      return false
  }
}

/** The words of a choice, as its button holds them for a reader of the screen and the pointer. */
export const CHOICE_WORDS: Record<string, { title: string; label?: string }> = {
  ...Object.fromEntries(BETWEEN.map((b) => [b.measure, { title: b.title }])),
  diameter: { title: ROUND[0].title, label: 'Diameter' },
  radius: { title: ROUND[1].title, label: 'Radius' },
  [WALL]: { title: `Press ${hint('measure.wall')} with the pointer on a face to measure the wall under it. Shift-click measures from a bare point` },
  ...Object.fromEntries(SELECT_SCOPES.map((c) => [c.scope, { title: c.title }])),
  free: { title: 'Freehand: press and drag' },
  line: { title: 'Straight line: press and drag, or click twice' },
  points: { title: 'Point to point: a click for each point, Enter ends it' },
  erase: { title: 'Eraser: a click takes the stroke under the pointer' },
  brush: { title: 'Drag over the scan to paint it where the pointer sees it. Ctrl-drag takes paint off' },
  box: { title: 'Drag a box on the screen' }
}

/** What the pill of each tool is called for a reader of the screen: the group its choices are in. */
const POPS_AS: Partial<Record<string, string>> = { select: 'What a click selects', measure: 'What to measure', shape: 'Shape to place', draw: 'Pens of the sketch', region: 'How to paint', trace: 'Trace draws', ink: 'Ink draws' }

/**
 * The name that grows out to the right of the tool in hand: its name, its key cap and its few choices as an inner
 * segment. The pill is no control of its own: what it holds are the buttons of the choices, each its own, and the thickness
 * of Measure, which is a key and no button.
 */
export function ReedPillView({ of, pill, chosen, onChoose, words = CHOICE_WORDS }: { of: ToolName | TracingToolName; pill: ReedPill; chosen: (id: string) => boolean; onChoose: (id: string) => void; words?: Record<string, { title: string; label?: string }> }) {
  const segments = segmentsOf(of, pill.choices)
  const many = segments.length > 1
  return (
    <div className="reed-pill" data-pill={of} data-tag-avoid="">
      <span className="reed-name">{pill.name}</span>
      <kbd className="reed-key num">{pill.key}</kbd>
      {segments.length > 0 && (
        <div className="reed-choices" role="group" aria-label={POPS_AS[of]}>
          {segments.map((seg, i) => (
            <span key={i} className="reed-seg" role={many && seg.label !== '' ? 'group' : undefined} aria-label={many && seg.label !== '' ? seg.label : undefined}>
              {seg.choices.map((c) => (c.id === WALL ? <ThicknessKey key={c.id} choice={c} /> : <ChoiceButton key={c.id} of={of} choice={c} on={chosen(c.id)} onChoose={onChoose} words={words} />))}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Measure's thickness is a key held with the pointer on a face: said in the pill, as the strip said it. */
function ThicknessKey({ choice }: { choice: ReedChoice }) {
  return (
    <span className="reed-note" title={CHOICE_WORDS[WALL].title}>
      <kbd className="num">{choice.key}</kbd> {choice.label}
    </span>
  )
}

function ChoiceButton({ of, choice, on, onChoose, words: all }: { of: ToolName | TracingToolName; choice: ReedChoice; on: boolean; onChoose: (id: string) => void; words: Record<string, { title: string; label?: string }> }) {
  const words = all[choice.id] ?? { title: choice.label }
  const shape = of === 'shape' ? SHAPE_ICONS[choice.id as ShapeKind] : null
  const title = choice.key !== undefined ? `${words.title} (${choice.key})` : words.title
  return (
    <button type="button" className="reed-choice" data-choice={choice.id} aria-pressed={on} aria-label={words.label ?? (shape ? choice.label : undefined)} aria-keyshortcuts={choice.key} title={title} onClick={() => onChoose(choice.id)}>
      {shape ?? choice.label}
      {shape === null && choice.key !== undefined && <kbd className="reed-choice-key num">{choice.key}</kbd>}
    </button>
  )
}

/**
 * What a tool's tip says besides what it does: why it is quieter (a scan's tool with no scan), a painting that waits
 * on the scan, the shape the Shape tool places now. Each a sentence of its own, without a closing full stop.
 */
function noteOf(name: ToolName, of: { quiet: boolean; waiting: number; shape: ShapeKind; ready: boolean }): string[] {
  const notes: string[] = []
  if (of.quiet) notes.push(NO_SCAN_YET)
  if (name === 'shape') notes.push(`Places a ${of.shape} now; its name grows out when it is in hand, with the other shapes`)
  if (of.waiting > 0) notes.push(`A painting of ${count(of.waiting)} triangles is waiting: keep it or clear it`)
  if (!of.ready) notes.push('Not available yet')
  return notes
}

/**
 * A small panel beside a button of the reed, at once: the name, the key cap and what the tool does, then what
 * else is worth knowing of it now. It takes no pointer and is not read out itself: the button holds the same words
 * as its description. A tool with its name grown out shows none.
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
export const ICONS: Record<PaletteTool, ReactNode> = {
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
