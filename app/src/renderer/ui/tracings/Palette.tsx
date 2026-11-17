import type { ReactNode } from 'react'
import { hint } from '../../../shared/keys'
import { tracingActions, useTracings, type TracingTool } from '../../state/tracings'
import { ICONS } from '../ToolPalette'

// The tools of a tracing, at the left edge of its sheet, as the tools of the model are at the edge of the 3D view. Select, Trace, Pin, Ink,
// Measure and Should be here are live; Show in 3D waits for its own task. Each live tool has a key of the `tracing` scope. Measure and
// Should be here are no review of the model: the intent bar of an open review does not apply to them.

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

/** The palette as it is drawn from the tool in hand: pure, so that it is drawn the same from any state. */
export function PaletteView({ tool, onTool }: { tool: Tool; onTool?: (tool: Tool) => void }) {
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
    </div>
  )
}

export function Palette() {
  const tool = useTracings((s) => s.tool)
  return <PaletteView tool={tool} onTool={tracingActions.setTool} />
}
