import { hint } from '../../shared/keys'
import { keyGlyph } from './keyGlyph'
import { numbered } from './numbered'
import { count as counted, number } from '../../shared/format'
import { alignmentOf } from '../../shared/scans'
import { scanInHand, useAlign } from '../state/align'
import { THROUGH_NOTE, nextLine, radiusOf, regionStore, useRegion, usualRadius } from '../state/region'
import { useStore } from '../state/store'
import { useTool } from '../state/tools'
import { clearRegion, growRegion, keepRegion, undoStroke } from '../tools/regionPainting'
import { Field } from './Field'
import { ProcedureCard } from './view/ProcedureCard'

/**
 * The card of the Region tool, while it is in hand, at the bottom right of the view: how far the brush reaches (or
 * Through, for a box), whether it takes paint off, growing what is painted over what lies flat with it, taking the
 * last stroke back, and how much is painted. How it paints, Brush or Box, is the reed's pill (`ReedView`): the one
 * choice, kept in `regionStore`, not repeated here. "Keep as a mark" has main keep it as a mark and opens its note
 * (or, of a region being painted again, makes it that region); "Clear" puts it down, and Undo brings that back. One
 * line says what to do next. Nothing here changes with a pointer move: the count is told when a stroke ends.
 */
export function RegionBar() {
  const inHand = useTool() === 'region'
  const state = useRegion((s) => s)
  const scans = useStore((s) => s.scans)
  const layout = useStore((s) => s.layout)
  const aligning = useAlign((s) => s.scan)
  if (!inHand) return null
  const { mode, radius, erase, through, count, area, canUndo, sending, refused, scan, editing } = state
  // The scan the brush is sized for while none is painted on: the one being aligned, or the only one.
  const sized = scans.find((one) => one.id === scan) ?? scanInHand(aligning, scans)
  const usual = sized ? usualRadius(sized, alignmentOf(sized, layout)?.transform.s ?? 1) : null
  const painted = count > 0
  const shown = radius ?? usual

  return (
    <ProcedureCard tool="region" title="Region of a scan" className="regionbar">
      <p className="regionbar-next" role="status">
        {numbered(nextLine(state, scans.length))}
      </p>
      <div className="regionbar-row">
        {mode === 'brush' ? (
          <>
            <span className="regionbar-label" title="How far the brush reaches round the pointer. [ and ] change it by a quarter">
              Radius
            </span>
            <span className="regionbar-radius" aria-keyshortcuts={`${hint('region.brush', 0)} ${hint('region.brush', 1)}`}>
              <Field label="Brush radius" unit="mm" value={shown === null ? '' : number(shown)} commit={(value) => regionStore.setState({ radius: radiusOf(value) })} />
            </span>
            <span className="procedure-caps" aria-hidden="true">
              <kbd>{hint('region.brush', 0)}</kbd>
              <kbd>{hint('region.brush', 1)}</kbd>
            </span>
          </>
        ) : (
          <button type="button" className="procedure-button" aria-pressed={through} title={`${THROUGH_NOTE}: what faces away from you as well`} onClick={() => regionStore.setState({ through: !through })}>
            Through
          </button>
        )}
        <button type="button" className="procedure-button" aria-pressed={erase} aria-keyshortcuts={hint('region.erase')} title={`The brush, and a box, take paint off (${hint('region.erase')}). Ctrl-drag does it for one stroke`} onClick={() => regionStore.setState({ erase: !erase })}>
          Erase <kbd>{hint('region.erase')}</kbd>
        </button>
      </div>
      <div className="regionbar-row">
        <button type="button" className="procedure-button" disabled={!painted || sending} title="Spreads what is painted over what lies flat with it: within 2 mm of its plane, turned no more than 15° from it" onClick={() => void growRegion()}>
          Grow to flat
        </button>
        <button type="button" className="procedure-button" disabled={!canUndo || sending} aria-keyshortcuts={hint('region.undo')} title={`Takes back the last stroke, or brings back what Clear put down (${hint('region.undo')})`} onClick={undoStroke}>
          Undo <kbd>{hint('region.undo')}</kbd>
        </button>
      </div>
      <p className="regionbar-count" data-empty={painted ? undefined : ''} title={painted ? `On ${scan}. The area is of the scan's mesh: approximate` : undefined}>
        <span className="regionbar-total">
          <span className="num">{counted(count)}</span> {count === 1 ? 'triangle' : 'triangles'}
        </span>
        {painted && (
          <span className="regionbar-of">
            {editing && <span className="num">{editing} · </span>}
            {scan && <>on <span className="num">{scan}</span> · </>}≈ <span className="num">{number(area)}</span> mm², approximate
          </span>
        )}
      </p>
      {refused && (
        <p className="regionbar-note selectable" role="alert" data-part="refused">
          {numbered(refused)}
        </p>
      )}
      <div className="procedure-foot" data-part="foot">
        <div className="procedure-actions">
          <button type="button" className="procedure-button" disabled={(!painted && !editing) || sending} title={editing ? `Puts the painting down: ${editing} stays as it was. Undo brings the painting back` : 'Puts down what is painted, without keeping it. Undo brings it back'} onClick={clearRegion}>
            Clear
          </button>
          <button type="button" className="procedure-button regionbar-keep" data-primary="" disabled={!painted || sending} aria-keyshortcuts={hint('region.keep')} title={editing ? `Makes what is painted the triangles of ${editing} (${hint('region.keep')})` : `Keeps it as a mark and opens its note, to say what it is (${hint('region.keep')})`} onClick={() => void keepRegion()}>
            Keep as a mark <kbd>{keyGlyph(hint('region.keep'))}</kbd>
          </button>
        </div>
      </div>
    </ProcedureCard>
  )
}
