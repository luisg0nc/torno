import type { ReactNode, RefObject } from 'react'
import type { RailPanel } from '../state/column'
import { Layers } from './Layers'
import { LeftEdge } from './LeftEdge'
import { MarksPanel } from './MarksPanel'
import { ParamsPanel } from './ParamsPanel'
import { ScansPanel } from './ScansPanel'

/**
 * The panel docked beside the rail: the one that is open, and only that one, with the edge that makes it wider.
 * Projects is the caller's (`projects`: the folder's name and menu, then the list, which belong to the window's
 * workspace, not to a project); the others are the sections the left column had, each shown on its own now. Nothing
 * when none is open.
 */
export function PanelHost({ shown, shell, projects }: { shown: RailPanel | null; shell: RefObject<HTMLDivElement | null>; projects: ReactNode }) {
  if (shown === null) return null
  return (
    <div className="panel-host" data-panel={shown}>
      <div className="panel-body">
        {shown === 'projects' && projects}
        {shown === 'layers' && <Layers />}
        {shown === 'params' && <ParamsPanel />}
        {shown === 'scans' && <ScansPanel />}
        {shown === 'marks' && <MarksPanel />}
      </div>
      <LeftEdge shell={shell} />
    </div>
  )
}
