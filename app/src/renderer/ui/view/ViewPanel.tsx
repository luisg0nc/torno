import type { ReactNode } from 'react'

/**
 * The panel beside the Scans view and the Tracing view: the right of the main area, `--panel-w` wide, in a scroll of its own. What
 * the column's Scans and Tracings sections were is its body; what the section's head had to do (Import scan…, New tracing) is its
 * head's `action`. The view beside it gives up the room (`.viewport[data-panel]`, `view-panel.css`).
 */
export function ViewPanel({ name, title, action, children }: { name: 'scans' | 'tracings'; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <aside className="view-panel" data-view-panel={name} aria-label={title}>
      <div className="view-panel-head">
        <h2 className="view-panel-title">{title}</h2>
        {action}
      </div>
      <div className="view-panel-body">{children}</div>
    </aside>
  )
}
