import type { ReactNode } from 'react'
import { hint } from '../../../shared/keys'
import type { ToolName } from '../../state/tools'
import { ICONS } from '../ToolPalette'

/**
 * The card of a tool that is a procedure (Align, Region): at the bottom right of the view above the grid step, 300 px
 * wide (320 for Align), `--raise` with a title and its icon and "Esc put down" at its right (spec 2026-11-18, section 2).
 * The tag placement keeps clear of it (`data-tag-avoid`). What is in it is the tool's.
 */
export function ProcedureCard({ tool, title, className, children }: { tool: ToolName; title: string; className: string; children: ReactNode }) {
  return (
    <section className={`procedure ${className}`} role="group" aria-label={title} data-tool={tool} data-tag-avoid>
      <header className="procedure-head">
        <span className="procedure-icon" aria-hidden="true">
          {ICONS[tool]}
        </span>
        <h2 className="procedure-title">{title}</h2>
        <span className="procedure-esc">
          <kbd>{hint('escape')}</kbd> put down
        </span>
      </header>
      {children}
    </section>
  )
}
