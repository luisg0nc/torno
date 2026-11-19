import { createStore } from 'zustand/vanilla'
import { useStore as useZustand } from 'zustand'
import { boardActions } from '../../state/board'
import { useStore } from '../../state/store'
import { hasTracing, useTracings } from '../../state/tracings'
import { TracingRows } from '../TracingRows'
import { NewTracing } from '../tracings/NewTracing'
import { TracingPanel } from '../tracings/TracingPanel'
import { ViewPanel } from '../view/ViewPanel'

/** Whether the form that makes a tracing is open in the panel: the button in its head opens it, and it closes itself once the tracing is made. */
const making = createStore<{ open: boolean }>(() => ({ open: false }))
const useMaking = (): boolean => useZustand(making, (s) => s.open)

/** The `+` of the view's switch: shows the Tracing view and opens the form that makes one (a project with none shows that form in the view itself). */
export function startNewTracing(): void {
  making.setState({ open: hasTracing() })
  boardActions.show('tracing')
}

/** **New tracing**, in the head of the Tracing view's panel. */
function NewTracingAction() {
  const open = useMaking()
  return (
    <button type="button" className="button button-quiet" aria-expanded={open} title="Lay one plane of the model flat, at true size" onClick={() => making.setState({ open: !open })}>
      New tracing
    </button>
  )
}

/** The body of the panel: the form that makes one while it is open, the rows, and the open tracing's panel under its row. */
export function TracingsBody() {
  const open = useMaking()
  return (
    <div className="route-tracings">
      {open && (
        <div className="route-tracings-new">
          <NewTracing onDone={() => making.setState({ open: false })} />
        </div>
      )}
      <TracingRows panel={<TracingPanel />} />
    </div>
  )
}

/**
 * The Tracing view's panel: the tracings as rows with the open one's panel under it, at the right of the sheet. A project with no
 * tracing has none: the view holds the form that makes the first.
 */
export function TracingsSide() {
  const objectId = useStore((s) => s.objectId)
  const some = useTracings((s) => (s.file?.tracings.length ?? 0) > 0)
  if (!objectId || !some) return null
  return (
    <ViewPanel name="tracings" title="Tracings" action={<NewTracingAction />}>
      <TracingsBody />
    </ViewPanel>
  )
}
