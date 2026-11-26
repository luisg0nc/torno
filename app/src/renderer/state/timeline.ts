/**
 * The builds timeline at the foot of the view (`ui/strip/BuildsTimeline.tsx`): whether its drawer is open, and which of its
 * groups show every build. Open or shut is the window's, like the dock's width: kept in its own storage (`localStorage`,
 * `torno.timeline`), never in the workspace, and the same for every project. A storage that is not there or refuses leaves it
 * shut, and a write that fails is let go. The groups open are the run's only.
 */
import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { windowStorage } from './column'

export const TIMELINE_KEY = 'torno.timeline'

/** Whether the window kept the drawer open; shut where nothing usable is. */
export function readTimeline(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(TIMELINE_KEY) === 'open'
  } catch {
    return false
  }
}

export function writeTimeline(storage: Pick<Storage, 'setItem'> | null, open: boolean): void {
  try {
    storage?.setItem(TIMELINE_KEY, open ? 'open' : 'shut')
  } catch {
    // A storage that refuses: the window goes on as it is.
  }
}

interface TimelineState {
  open: boolean
  /** The ids of the groups that show every build (`StripGroup.id`). */
  expanded: string[]
}

export const timeline = createStore<TimelineState>(() => ({ open: readTimeline(windowStorage()), expanded: [] }))

export const useTimeline = <T>(pick: (s: TimelineState) => T): T => useZustand(timeline, pick)

export const timelineActions = {
  setOpen(open: boolean): void {
    if (timeline.getState().open === open) return
    timeline.setState({ open })
    writeTimeline(windowStorage(), open)
  },
  toggle(): void {
    timelineActions.setOpen(!timeline.getState().open)
  },
  toggleGroup(id: string): void {
    const { expanded } = timeline.getState()
    timeline.setState({ expanded: expanded.includes(id) ? expanded.filter((k) => k !== id) : [...expanded, id] })
  },
  /** A chip of the bar: the drawer opens with its group showing every build. */
  reveal(id: string): void {
    const { expanded } = timeline.getState()
    if (!expanded.includes(id)) timeline.setState({ expanded: [...expanded, id] })
    timelineActions.setOpen(true)
  }
}
