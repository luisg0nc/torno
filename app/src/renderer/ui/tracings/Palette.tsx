import type { ReactNode } from 'react'
import { hint } from '../../../shared/keys'
import { actions, useStore } from '../../state/store'
import { tracingActions, useTracings, type TracingTool } from '../../state/tracings'
import { ICONS } from '../ToolPalette'

// The tools of a tracing, at the left edge of its sheet, as the tools of the model are at the edge of the 3D view. Select, Trace, Pin, Ink,
// Measure and Should be here are tools, each with a key of the `tracing` scope. Measure and Should be here are no review of the model: the
// intent bar of an open review does not apply to them. Show in 3D below them is no tool: a switch that puts the tracing in the model view
// (or takes it out), and that takes nothing from the hand. It has no key (a builder's call: it is pressed rarely, and a letter is dear).

type Tool = TracingTool

interface Entry {
  id: string
  label: string
  /** The row of the table of keys, for a tool that has one. */
  row?: 'tracing.select' | 'tracing.trace' | 'tracing.pin' | 'tracing.ink' | 'tracing.measure' | 'tracing.offset'
  does: string
  icon: ReactNode
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** A line drawn point to point, its corners marked. */
const TRACE_ICON = (
  <Icon>
    <path d="M2.750 12.500 6 5.500l3.500 4 3.750-6" />
    <circle cx="2.750" cy="12.500" r="1" />
    <circle cx="6" cy="5.500" r="1" />
    <circle cx="9.500" cy="9.500" r="1" />
    <circle cx="13.250" cy="3.500" r="1" />
  </Icon>
)

const TOOLS: readonly Entry[] = [
  { id: 'select', label: 'Select', row: 'tracing.select', does: 'Click a mark or a shape to select it, Delete removes your mark; drag to move around the sheet', icon: ICONS.select },
  { id: 'trace', label: 'Trace', row: 'tracing.trace', does: 'Click points, a circle or a label into your layer, snapping to the corners and hole centres of the cut', icon: TRACE_ICON },
  { id: 'pin', label: 'Pin', row: 'tracing.pin', does: 'Leave a note on a point of the sheet', icon: ICONS.pin },
  { id: 'ink', label: 'Ink', row: 'tracing.ink', does: 'Draw in the plane, freehand, a line or point to point', icon: ICONS.draw },
  { id: 'measure', label: 'Measure', row: 'tracing.measure', does: 'Click two points; on the cut\'s own points the number is exact, else it is ≈ and says how it was found', icon: ICONS.measure },
  { id: 'offset', label: 'Should be here', row: 'tracing.offset', does: 'Drag a shape of a layer to where it should be; Shift keeps one axis, the arrow keys nudge 0.1 mm', icon: ICONS.arrow }
]

/** A cube: the model view the tracing is shown in. */
const CUBE_ICON = (
  <Icon>
    <path d="M8 1.750 13.500 4.750v6.500L8 14.250 2.500 11.250v-6.500Z" />
    <path d="M2.500 4.750 8 7.750l5.500-3M8 7.750v6.500" />
  </Icon>
)

/** The palette as it is drawn from the tool in hand: pure, so that it is drawn the same from any state. */
export function PaletteView({ tool, onTool, shownIn3D, onShowIn3D }: { tool: Tool; onTool?: (tool: Tool) => void; shownIn3D?: boolean; onShowIn3D?: (on: boolean) => void }) {
  return (
    <div className="toolbox tr-palette" role="toolbar" aria-label="Tracing tools" aria-orientation="vertical">
      <div className="toolbox-group" role="group" aria-label="Tools">
        {TOOLS.map((t) => {
          const live = t.row !== undefined
          const cap = t.row === undefined ? undefined : hint(t.row)
          return (
            <button
              key={t.id}
              type="button"
              className="tool-button"
              data-tool={t.id}
              aria-label={t.label}
              aria-pressed={live ? t.id === tool : undefined}
              aria-keyshortcuts={cap}
              disabled={!live}
              title={live ? `${t.label} (${cap}): ${t.does}` : `${t.label}: ${t.does}. Not available yet`}
              onClick={() => live && onTool?.(t.id as Tool)}
            >
              {t.icon}
              {cap !== undefined && (
                <span className="tool-key num" aria-hidden="true">
                  {cap}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="toolbox-group" role="group" aria-label="View">
        <button
          type="button"
          className="tool-button"
          data-tool="show3d"
          aria-label="Show in 3D"
          aria-pressed={shownIn3D === true}
          title={shownIn3D === true ? 'Show in 3D: on. Take the tracing out of the 3D view' : 'Show in 3D: put the tracing, its layers and its photo in the 3D view, in their plane'}
          onClick={() => onShowIn3D?.(shownIn3D !== true)}
        >
          {CUBE_ICON}
        </button>
      </div>
    </div>
  )
}

export function Palette() {
  const tool = useTracings((s) => s.tool)
  const id = useTracings((s) => s.open)
  const shown = useStore((s) => id !== null && s.tracingsShown.includes(id))
  return <PaletteView tool={tool} onTool={tracingActions.setTool} shownIn3D={shown} onShowIn3D={(on) => id !== null && actions.setTracingShown(id, on)} />
}
