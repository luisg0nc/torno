import { hint } from '../../../shared/keys'
import { pointerLine } from '../../../shared/pointer'
import { sketchLine } from '../../state/step'
import { useSketching } from '../../state/sketching'
import { AgentLine } from '../AgentLine'
import { useHintLine } from '../ToolHint'

/**
 * The hint at the foot of the view, in the middle: how the pointer moves the view (once per install, until the camera is
 * moved), the agent's line (`AgentLine`), and a sketch's standing line (how it snaps, and where x-ray is). A pill on the
 * panel, quiet. What the tool in hand waits for is the caption's, at the pointer (`ToolHint`). The region is always
 * there, so that what comes into it is read out; it takes no pointer but for the agent's line.
 */
export function Hint() {
  const line = useHintLine()
  const sketching = useSketching((s) => s.open !== null)
  const snapping = useSketching((s) => s.snapping)
  const xray = useSketching((s) => s.xray)
  const sketch = sketchLine({ snapping, xray })
  return (
    <div className="view-hints" aria-live="polite">
      <AgentLine />
      {sketching && (
        <p className="view-hint" data-kind="sketch">
          <span className="view-hint-text">{sketch.snap}</span>
          <span className="view-hint-key">
            {sketch.xray} <kbd className="num">{sketch.cap}</kbd>
          </span>
        </p>
      )}
      {line?.kind === 'pointer' && (
        <p className="view-hint" data-kind="pointer">
          <span className="view-hint-text">{pointerLine()}</span>
          <span className="view-hint-key">
            <kbd className="num">{hint('keys')}</kbd> for every key
          </span>
        </p>
      )}
    </div>
  )
}
