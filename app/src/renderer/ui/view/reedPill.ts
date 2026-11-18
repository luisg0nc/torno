import { TOOL_KEYS, hint } from '../../../shared/keys'
import { BETWEEN, ROUND, SELECT_SCOPES, SHAPES, type SelectScope, type ToolName } from '../../state/tools'
import { INK_PENS } from '../tracings/inkTool'
import { TRACE_MODES } from '../tracings/traceTool'

/** A choice in the pill that grows out of the tool in hand: its id, its words, and its key when it has one. */
export interface ReedChoice {
  id: string
  label: string
  key?: string
}

/** The name pill of the tool in hand: its name, its key cap and its few choices. */
export interface ReedPill {
  name: string
  key: string
  choices: ReedChoice[]
}

/** What the pill of a tool depends on besides the tool. */
export interface ReedState {
  /** What a click of Select takes. */
  scope: SelectScope
  /** Select's scope was asked for (a click on it, or its key while it is in hand): it grows out and stays. */
  scopeOpen: boolean
  /** A sketch is open: the pens of Draw are offered. */
  sketching: boolean
}

/** The pens of a sketch, with their keys: Free, Line, Points and Erase. */
const PENS: ReedChoice[] = [
  { id: 'free', label: 'Free', key: hint('sketch.free') },
  { id: 'line', label: 'Line', key: hint('sketch.line') },
  { id: 'points', label: 'Points', key: hint('sketch.points') },
  { id: 'erase', label: 'Erase', key: hint('sketch.erase') }
]

/** How Region paints: the brush, or a box dragged on the screen. */
const REGION_MODES: ReedChoice[] = [
  { id: 'brush', label: 'Brush' },
  { id: 'box', label: 'Box' }
]

/** The thickness is a key and no button: it is said with the choices of Measure, as its strip said it. */
export const WALL = 'wall'

/**
 * The name pill the tool in hand grows to the right of its button, or null for none. Select is the tool at rest: it has
 * none until its scope is asked for (`scopeOpen`) or left on something other than Any, so that a scope left on Set can be
 * seen. Draw offers its pens while a sketch is open. Pin, Arrow, Section and Align have a name and no choices (Align's
 * card holds its steps).
 */
export function pillOf(tool: ToolName, state: ReedState): ReedPill | null {
  const t = TOOL_KEYS.find((k) => k.name === tool)
  if (t === undefined) return null
  const name = tool === 'region' ? 'Region' : t.label
  const named = (choices: ReedChoice[]): ReedPill => ({ name, key: t.key, choices })
  switch (tool) {
    case 'select':
      return state.scopeOpen || state.scope !== 'any' ? named(SELECT_SCOPES.map((s) => ({ id: s.scope, label: s.label }))) : null
    case 'measure':
      return named([...BETWEEN.map((b) => ({ id: b.measure, label: b.label })), ...ROUND.map((r) => ({ id: r.measure, label: r.measure === 'diameter' ? '⌀' : 'r' })), { id: WALL, label: 'thickness', key: hint('measure.wall') }])
    case 'shape':
      return named(SHAPES.map((s) => ({ id: s.kind, label: s.label })))
    case 'draw':
      return named(state.sketching ? PENS.map((p) => ({ ...p })) : [])
    case 'region':
      return named(REGION_MODES.map((m) => ({ ...m })))
    default:
      return named([])
  }
}

/** The tools of a tracing's reed. */
export type TracingToolName = 'select' | 'trace' | 'pin' | 'ink' | 'measure' | 'offset'

/** The name pill of a tracing's tool: Trace holds Line, Circle and Label, Ink its pens; Select (the tool at rest) and the rest have none or a name only. */
export function tracingPillOf(tool: TracingToolName, name: string, key: string): ReedPill | null {
  if (tool === 'select') return null
  if (tool === 'trace') return { name, key, choices: TRACE_MODES.map((m) => ({ id: m.mode, label: m.label })) }
  if (tool === 'ink') return { name, key, choices: INK_PENS.map((p) => ({ id: p.pen, label: p.pen === 'points' ? 'Points' : p.label })) }
  return { name, key, choices: [] }
}

/** A run of choices that belong together, as the pill sets them apart (Measure's two clicks, and a double click on something round). */
export interface ReedSegment {
  label: string
  choices: ReedChoice[]
}

/** The choices of a pill in the runs they are set in. Only Measure has more than one run. */
export function segmentsOf(tool: ToolName | TracingToolName, choices: ReedChoice[]): ReedSegment[] {
  if (choices.length === 0) return []
  if (tool !== 'measure' || !choices.some((c) => c.id === 'distance')) return [{ label: '', choices }]
  const ids = (wanted: readonly string[]) => choices.filter((c) => wanted.includes(c.id))
  return [
    { label: 'Two clicks measure', choices: ids(BETWEEN.map((b) => b.measure)) },
    { label: 'A double click on something round measures', choices: ids(ROUND.map((r) => r.measure)) },
    { label: '', choices: ids([WALL]) }
  ]
}
