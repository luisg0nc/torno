import { useEffect, useMemo, useRef, useState } from 'react'
import { number } from '../../shared/format'
import type { Pt } from '../../shared/leader'
import { pressed } from '../../shared/keys'
import { type ScanInfo, type ScanUnit, type ScanUp, UNIT_MM, boxSize, sizeAgainst, sizeAs } from '../../shared/scans'
import { tagSubject } from '../../shared/tagPlace'
import { actions, store, useStore } from '../state/store'
import { onPaneDrawn, paneRect, projectToPane } from '../viewport/overlay'
import type { Viewport } from '../viewport/Viewport'
import { Confirm } from './Confirm'
import { alignScan } from './scanDrop'
import { numbered } from './numbered'
import { askedBox, dialSizes } from './scanDial'
import { UNIT_WORD } from './scanState'
import { convertScan, numberedList } from './ScansPanel'
import { publishTag, withdrawTag } from './view/useTagAt'

/** `About 1,000 times`, or `About 1/1,000 of`: to two figures. */
function timesText(ratio: number): string {
  const two = (n: number): string => Number(n.toPrecision(2)).toLocaleString('en-US')
  return ratio >= 1 ? `About ${two(ratio)} times` : `About 1/${two(1 / ratio)} of`
}

/** The units a scan can be read in: the dial has a cell for each (a foot is on `dialSizes`, which torno does not read a scan in). */
const UNITS = Object.keys(UNIT_MM) as ScanUnit[]

/** The id of the leader that ties the card to its scan. */
const LEADER = 'scan-ask'

/**
 * How a scan this window just imported is read, asked once, in the view, by the scan (spec 2026-11-18, section 2): a
 * card under the switch at the top left, tied by a leader to the scan's corner. torno guessed its unit or its up axis
 * from the format and the size, and a wrong unit is a thousandfold. The scan is drawn as it was read; pointing at a
 * unit draws its box at the size that unit would give it, dashed. Not modal: "Later" (or Escape) puts it away, and the
 * question stays in the scan's detail.
 */
export function ScanReadSheet({ viewport }: { viewport: Viewport }) {
  const objectId = useStore((s) => s.objectId)
  const asking = useStore((s) => s.scanAsking)
  const scan = useStore((s) => (s.scanAsking === null ? undefined : s.scans.find((one) => one.id === s.scanAsking)))
  if (!objectId || asking === null || !scan) return null
  return <ScanQuestion key={scan.id} viewport={viewport} objectId={objectId} scan={scan} />
}

function ScanQuestion({ viewport, objectId, scan }: { viewport: Viewport; objectId: string; scan: ScanInfo }) {
  const { id, imported } = scan
  const card = useRef<HTMLDivElement>(null)
  const [unit, setUnit] = useState<ScanUnit>(imported.unit)
  const [up, setUp] = useState<ScanUp>(imported.up)
  /** The unit the pointer is on, or the focus: it is shown before it is chosen. */
  const [pointed, setPointed] = useState<ScanUnit | null>(null)
  const [confirming, setConfirming] = useState(false)
  const changed = unit !== imported.unit || up !== imported.up
  const layouts = Object.keys(scan.alignments)
  const shown = pointed ?? unit
  const size = sizeAs(imported, { unit, up })
    .map((c) => number(c))
    .join(' × ')
  const scene = useStore((s) => s.scene)
  const layout = useStore((s) => s.layout)
  const parts = useMemo(() => scene?.parts.filter((part) => part.layout === layout) ?? [], [scene, layout])
  const partsSize = boxSize(parts.map((part) => part.bbox))
  const against = partsSize ? sizeAgainst(sizeAs(imported, { unit, up }), partsSize, unit) : null
  const exact = parts.length > 0 && parts.every((part) => part.bboxExact === true)
  // The scan's box as the file has it, in the file's own units: what each cell of the dial is the longest side of.
  const asRead = useMemo(() => {
    const { min, max } = imported.bbox
    const k = UNIT_MM[imported.unit]
    return [(max[0] - min[0]) / k, (max[1] - min[1]) / k, (max[2] - min[2]) / k] as [number, number, number]
  }, [imported])
  const dial = dialSizes(asRead).filter((cell): cell is { unit: ScanUnit; size: string } => UNITS.includes(cell.unit as ScanUnit))

  const done = (as: { unit: ScanUnit; up: ScanUp }, next = false): void => {
    actions.askScanRead(null)
    // A scan read another way has another size: it is brought into view again once main has it so.
    void convertScan(objectId, id, as).then(() => {
      if (as.unit !== imported.unit || as.up !== imported.up) actions.frameScan(id)
      // Answered: the next step is to align it, on the Floor.
      const now = store.getState().scans.find((one) => one.id === id)
      if (next && now) alignScan(now, 'floor')
    })
  }

  // The dashed box at the size of the unit pointed at, and the leader from the card to the scan's corner: after every frame of the view.
  useEffect(() => {
    const k = UNIT_MM[shown] / UNIT_MM[imported.unit]
    const label = `${sizeAs(imported, { unit: shown, up })
      .map((c) => number(c))
      .join(' × ')} mm`
    let drawn = ''
    const follow = (): void => {
      const element = card.current
      const canvas = paneRect()
      const pane = element?.offsetParent?.getBoundingClientRect()
      const scanBox = viewport.scanBox(id)
      // The scan is drawn as read: another unit has its own box, from the same corner.
      const next = k !== 1 && scanBox ? { ...askedBox(scanBox, k), label } : null
      const key = next ? `${next.min} ${next.max} ${label}` : ''
      if (key !== drawn) {
        drawn = key
        viewport.showAskedBox(next)
      }
      if (!element || !canvas || !pane || !scanBox) return withdrawTag(LEADER)
      const view = { x: 0, y: 0, w: pane.width, h: pane.height }
      const at = element.getBoundingClientRect()
      const box = { x: at.left - pane.left, y: at.top - pane.top, w: at.width, h: at.height }
      // The corner of the scan that is in view and nearest the card.
      let corner: Pt | null = null
      let least = Infinity
      for (const x of [scanBox.min[0], scanBox.max[0]]) {
        for (const y of [scanBox.min[1], scanBox.max[1]]) {
          for (const z of [scanBox.min[2], scanBox.max[2]]) {
            const p = projectToPane([x, y, z])
            const here = tagSubject(p && { x: p.x + canvas.left - pane.left, y: p.y + canvas.top - pane.top }, view)
            if (!here) continue
            const far = Math.hypot(here.x - (box.x + box.w / 2), here.y - (box.y + box.h / 2))
            if (far < least) [corner, least] = [here, far]
          }
        }
      }
      if (!corner) return withdrawTag(LEADER)
      publishTag(LEADER, { box, side: 'right', subject: corner }, { x: pane.left, y: pane.top })
    }
    follow()
    const off = onPaneDrawn(follow)
    const sized = new ResizeObserver(follow)
    if (card.current) sized.observe(card.current)
    return () => {
      off()
      sized.disconnect()
      withdrawTag(LEADER)
      viewport.showAskedBox(null)
    }
  }, [viewport, id, imported, shown, up])

  return (
    <div
      ref={card}
      className="scan-sheet"
      role="dialog"
      aria-label={`How is ${id} read?`}
      data-tag-avoid
      onKeyDown={(e) => {
        if (!confirming && pressed(e, 'sheet.close')) {
          e.stopPropagation()
          actions.askScanRead(null)
        }
      }}
    >
      <h2 className="scan-sheet-title">
        How is <span className="num">{id}</span> read?
      </h2>
      <p className="scan-sheet-text">
        <span className="num">{id}</span> was read as {UNIT_WORD[imported.unit]}, {imported.up.toUpperCase()} up: torno guessed from the format and the size.
      </p>
      <p className="scan-sheet-size" data-part="size">
        {numbered(`Its size would be ${size} mm`)}
      </p>
      {partsSize && (
        <p className="scan-sheet-size" data-part="parts">
          {numbered(`${parts.length === 1 ? 'The part' : 'The parts'} of ${layout}: about ${partsSize.map((c) => number(c)).join(' × ')} mm${exact ? '' : ', as drawn'}`)}
        </p>
      )}
      {against?.suggest && (
        <p className="scan-sheet-warn" data-part="doubt">
          {numbered(`${timesText(against.ratio)} the parts: is it in ${UNIT_WORD[against.suggest]}?`)}
        </p>
      )}
      {/* The dial: a cell for each unit with the longest side the scan would have in it. The one read is on the surface, the one pointed at on the accent wash. */}
      <div className="scan-dial" role="radiogroup" aria-label={`Unit of ${id}`} onMouseLeave={() => setPointed(null)}>
        {dial.map((cell) => (
          <button
            key={cell.unit}
            type="button"
            role="radio"
            aria-checked={cell.unit === unit}
            aria-label={cell.unit}
            className="scan-dial-cell"
            data-read={cell.unit === imported.unit ? '' : undefined}
            data-pointed={cell.unit === shown ? '' : undefined}
            title={`Read as ${UNIT_WORD[cell.unit]}: its longest side would be ${cell.size} mm`}
            onClick={() => setUnit(cell.unit)}
            onMouseEnter={() => setPointed(cell.unit)}
            onFocus={() => setPointed(cell.unit)}
            onBlur={() => setPointed(null)}
          >
            <span className="scan-dial-unit">{cell.unit}</span>
            <span className="scan-dial-size num">{cell.size}</span>
          </button>
        ))}
      </div>
      <div className="scan-sheet-up">
        <span className="scan-label">Up axis</span>
        <div className="segmented" role="radiogroup" aria-label={`Up axis of ${id}`}>
          {(['y', 'z'] as const).map((axis) => (
            <button key={axis} type="button" role="radio" aria-checked={axis === up} aria-pressed={axis === up} onClick={() => setUp(axis)}>
              {axis.toUpperCase()} up
            </button>
          ))}
        </div>
      </div>
      <div className="scan-sheet-actions">
        <button
          type="button"
          className="procedure-button"
          data-primary=""
          title={changed ? 'Reads the scan as chosen, and no longer asks' : 'Choose another unit or up axis first'}
          disabled={!changed}
          onClick={() => (layouts.length > 0 ? setConfirming(true) : done({ unit, up }))}
        >
          Read it in {UNIT_WORD[unit]}
        </button>
        <button type="button" className="procedure-button" title="Keeps the scan as it was read, and no longer asks" onClick={() => done({ unit: imported.unit, up: imported.up })}>
          Keep {imported.unit}
        </button>
        <button
          type="button"
          className="procedure-button"
          title={changed && layouts.length > 0 ? 'Read it the other way first: that drops the alignment' : 'Answers as chosen, then takes up the Align tool on Floor'}
          disabled={changed && layouts.length > 0}
          onClick={() => done(changed ? { unit, up } : { unit: imported.unit, up: imported.up }, true)}
        >
          Next: align {id}
        </button>
        <button type="button" className="procedure-button" title="Asks again in the scan's detail" onClick={() => actions.askScanRead(null)}>
          Later
        </button>
      </div>
      {confirming && (
        <Confirm label={`Drop the alignment of ${id}?`} accept="Change" cancel="Keep as it is" onCancel={() => setConfirming(false)} onAccept={() => done({ unit, up })}>
          Changing the unit or the up axis of <span className="num">{id}</span> drops its alignment in {numberedList(layouts)}.
        </Confirm>
      )}
    </div>
  )
}

