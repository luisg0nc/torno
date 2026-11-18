import { useEffect, useRef } from 'react'
import { createStore } from 'zustand/vanilla'
import { useStore as useZustand } from 'zustand'
import { actions, useStore } from '../../state/store'
import { useBoard } from '../../state/board'
import { useTracings } from '../../state/tracings'
import { TracingRows } from '../TracingRows'
import { NewTracing } from '../tracings/NewTracing'
import { TracingPanel } from '../tracings/TracingPanel'

/** Whether the form that makes a tracing is open in the section: the button in the head's line opens it, and it closes itself once the tracing is made. */
const making = createStore<{ open: boolean }>(() => ({ open: false }))
const useMaking = (): boolean => useZustand(making, (s) => s.open)

/**
 * **New tracing**, in the head's line of the Tracings section (`CardSection`'s `action`), and what has the section in sight: it is always
 * drawn, folded or not, so while the Tracing view shows a tracing it unfolds the section and scrolls the card to it once, for the panel
 * of that tracing is in it. The person may fold it after.
 */
export function NewTracingAction() {
  const objectId = useStore((s) => s.objectId)
  const open = useMaking()
  const inView = useBoard((s) => s.shown === 'tracing')
  const opened = useTracings((s) => s.open !== null && (s.file?.tracings.some((t) => t.id === s.open) ?? false))
  const showing = inView && opened
  const was = useRef(false)
  useEffect(() => {
    if (showing && !was.current) actions.showSection('tracings')
    was.current = showing
  }, [showing])
  if (!objectId) return null
  return (
    <button
      type="button"
      className="button button-quiet route-head-action"
      aria-expanded={open}
      title="Lay one plane of the model flat, at true size"
      onClick={() => {
        making.setState({ open: !open })
        if (!open) actions.showSection('tracings')
      }}
    >
      New tracing
    </button>
  )
}

/** The body of the Tracings section: the form that makes one while it is open, the rows, and the open tracing's panel under its row while the Tracing view shows. */
export function TracingsBody() {
  const open = useMaking()
  const none = useTracings((s) => (s.file?.tracings.length ?? 0) === 0)
  return (
    <div className="route-tracings">
      {open && (
        <div className="route-tracings-new">
          <NewTracing onDone={() => making.setState({ open: false })} />
        </div>
      )}
      {none && !open && <p className="route-tracings-none">A tracing lays one plane of the model flat at true size, on a millimetre grid, to draw on and measure.</p>}
      <TracingRows panel={<TracingPanel />} />
    </div>
  )
}
