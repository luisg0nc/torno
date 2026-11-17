import type { ReactNode } from 'react'
import { hint } from '../../../shared/keys'
import { tracingActions, useTracings } from '../../state/tracings'
import { ICONS } from '../ToolPalette'

// The tools of a tracing, at the left edge of its sheet, as the tools of the model are at the edge of the 3D view. Select and
// Trace are live; the rest are shown and wait for their own tasks. Each live tool has a key of the `tracing` scope.

type Tool = 'select' | 'trace'

interface Entry {
  id: string
  label: string
  /** The row of the table of keys, for a tool that has one. */
  row?: 'tracing.select' | 'tracing.trace'
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
  { id: 'select', label: 'Select', row: 'tracing.select', does: 'Drag to move around the sheet', icon: ICONS.select },
  { id: 'trace', label: 'Trace', row: 'tracing.trace', does: 'Click points, a circle or a label into your layer, snapping to the corners and hole centres of the cut', icon: TRACE_ICON },
  { id: 'pin', label: 'Pin', does: 'Leave a note on a point', icon: ICONS.pin },
  { id: 'ink', label: 'Ink', does: 'Draw freehand on the sheet', icon: ICONS.draw },
  { id: 'measure', label: 'Measure', does: 'Measure between two points of the sheet', icon: ICONS.measure },
  { id: 'offset', label: 'Should be here', does: 'Drag a shape to where it should be', icon: ICONS.arrow }
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
