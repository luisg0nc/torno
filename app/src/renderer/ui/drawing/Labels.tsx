import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { pressed } from '../../../shared/keys'
import { MAX_LABEL, MOST_LABELS, type NoteLabel } from '../../../shared/marks'
import { CASING_PX, type InkLook } from '../ink/strokes'
import { labelFont } from './compose'
import { LABEL_FONT_PX, LABEL_LINE, LABEL_MAX_WIDTH, LABEL_PAD, arrowPath, labelBox, type LabelBox, type Measure, type Point } from './labelbox'

/** How far the pointer goes, in board pixels, before a press on a label is a drag for its arrow and not a click to write in it. */
const DRAG_PX = 6
/** The narrowest the field a label is written in is, in board pixels. */
const FIELD_MIN = 140

let probe: OffscreenCanvasRenderingContext2D | null = null
/** Measures text as the picture will set it: the canvas the picture is made on measures it too. */
function measurer(family: string): Measure {
  probe ??= new OffscreenCanvas(1, 1).getContext('2d')!
  const ctx = probe
  ctx.font = labelFont(family)
  return (text) => ctx.measureText(text).width
}

const within = (n: number, most: number): number => Math.round(Math.min(Math.max(n, 0), most) * 10) / 10

interface LabelsProps {
  /** The picture's own pixels: what the labels are placed in. */
  size: { width: number; height: number }
  labels: NoteLabel[]
  onChange: (labels: NoteLabel[]) => void
  /** Whether the label tool is in hand: only then a press places a label, writes in one or pulls an arrow from it. */
  labelling: boolean
  /** The ink and its casing, as the picture of the note has them. */
  look: InkLook
  /** The face of the window's text. */
  family: string
}

/**
 * The labels of a view note over its picture, the very size of the canvas: an SVG in the picture's pixels, so that they
 * are drawn as `paintLabels` draws them into the picture. With the label tool in hand a press on the picture places a
 * label and a field to write it in; a press on a label writes in it, and a drag from it pulls an arrow to where the
 * pointer goes. Enter or Esc ends the writing, a label with no text is taken away.
 */
export function Labels({ size, labels, onChange, labelling, look, family }: LabelsProps) {
  const [editing, setEditing] = useState<number | null>(null)
  const drag = useRef<{ index: number; pointer: number; from: Point; moved: boolean; to?: Point } | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  const measure = measurer(family)
  const boxes: LabelBox[] = labels.map((l) => labelBox(l, measure))
  // Not in hand: nothing is being written, and the labels are only drawn.
  const writing = labelling ? editing : null

  const at = (e: { clientX: number; clientY: number }): Point => {
    const box = layer.current!.getBoundingClientRect()
    return { x: within(((e.clientX - box.left) * size.width) / box.width, size.width), y: within(((e.clientY - box.top) * size.height) / box.height, size.height) }
  }
  const replace = (index: number, label: NoteLabel | null): void => onChange(labels.flatMap((l, i) => (i !== index ? [l] : label ? [label] : [])))

  /** The labels as they are once the one being written in is done with: an empty one is gone, and those after it are one place nearer. */
  const settled = (): { list: NoteLabel[]; map: (i: number) => number } => {
    if (editing === null || labels[editing]?.text.trim() !== '') return { list: labels, map: (i) => i }
    return { list: labels.filter((_, i) => i !== editing), map: (i) => (i > editing ? i - 1 : i) }
  }
  const place = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0 || !labelling) return
    const { list } = settled()
    setEditing(null)
    if (list.length >= MOST_LABELS) return onChange(list)
    const p = at(e)
    // Where the field is wholly in the picture.
    const label: NoteLabel = { x: within(Math.min(p.x, size.width - FIELD_MIN - 2 * LABEL_PAD), size.width), y: within(Math.min(p.y, size.height - LABEL_LINE - 2 * LABEL_PAD), size.height), text: '' }
    onChange([...list, label])
    setEditing(list.length)
  }
  const press = (e: ReactPointerEvent<SVGGElement>, index: number): void => {
    if (e.button !== 0 || !labelling) return
    e.stopPropagation()
    layer.current!.setPointerCapture(e.pointerId)
    // The field of the label being written in ends with the press on another.
    const { list, map } = settled()
    if (editing !== null && editing !== index) {
      if (list !== labels) onChange(list)
      setEditing(null)
    }
    drag.current = { index: editing !== null && editing !== index ? map(index) : index, pointer: e.pointerId, from: at(e), moved: false }
  }
  const move = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    const p = at(e)
    if (!d.moved && Math.hypot(p.x - d.from.x, p.y - d.from.y) < DRAG_PX) return
    d.moved = true
    d.to = p
    // The arrow follows the pointer on the SVG alone: the sheet is told once, on release (it draws again at every change).
    const label = labels[d.index]
    const paths = layer.current?.querySelectorAll(`[data-label="${d.index}"] path`)
    if (label && paths) for (const path of paths) path.setAttribute('d', arrowPath(boxes[d.index], p))
  }
  const release = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    drag.current = null
    // Not dragged: it was a click, and writes in the label.
    if (!d.moved) setEditing(d.index)
    else if (d.to && labels[d.index]) replace(d.index, { ...labels[d.index], to: d.to })
  }
  function endWriting(): void {
    if (editing === null) return
    const label = labels[editing]
    setEditing(null)
    if (label && label.text.trim() === '') replace(editing, null)
  }

  // The tool put down: the label being written is done with.
  useEffect(() => {
    if (!labelling) setEditing(null)
  }, [labelling])

  const fieldAt = writing === null ? null : boxes[writing]
  const percent = (n: number, of: number): string => `${(n / of) * 100}%`

  return (
    <div
      ref={layer}
      className="label-layer"
      data-labelling={labelling ? '' : undefined}
      // The size of one board pixel in the field's own units: the field is as large on screen as the label is in the picture.
      style={{ '--label-px': `${(LABEL_FONT_PX / size.width) * 100}cqw` } as CSSProperties}
      // The keys stay where they are (the field of the label placed takes them): a press is not a click into the sheet.
      onMouseDown={(e) => labelling && e.preventDefault()}
      onPointerDown={place}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <svg className="label-svg" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
        {labels.map((label, i) => {
          const box = boxes[i]
          // Always there, empty without an arrow: a drag fills them in as it goes (`move`).
          const d = label.to ? arrowPath(box, label.to) : ''
          return (
            <g key={i} className="label" data-label={i} data-arrow={label.to ? '' : undefined} onPointerDown={(e) => press(e, i)}>
              <path d={d} fill="none" stroke={look.casing ?? look.ink} strokeWidth={3 + 2 * CASING_PX} strokeLinecap="round" strokeLinejoin="round" />
              <path d={d} fill="none" stroke={look.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <rect x={box.x} y={box.y} width={writing === i ? Math.max(box.width, FIELD_MIN + 2 * LABEL_PAD) : box.width} height={box.height} fill={look.casing ?? '#ffffff'} stroke={look.ink} strokeWidth={2} />
              {writing !== i &&
                box.lines.map((text, n) => (
                  <text key={n} x={box.x + LABEL_PAD} y={box.y + LABEL_PAD + n * LABEL_LINE + LABEL_LINE / 2} fill={look.ink} dominantBaseline="middle" fontFamily={family} fontSize={LABEL_FONT_PX} fontWeight={500}>
                    {text}
                  </text>
                ))}
            </g>
          )
        })}
      </svg>
      {writing !== null && fieldAt && (
        <div className="label-edit" style={{ left: percent(fieldAt.x, size.width), top: percent(fieldAt.y, size.height) }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <input
            className="label-field"
            data-board-field=""
            aria-label="Label text"
            autoFocus
            maxLength={MAX_LABEL}
            value={labels[writing]?.text ?? ''}
            style={{ width: percent(Math.min(Math.max(fieldAt.width, FIELD_MIN + 2 * LABEL_PAD), LABEL_MAX_WIDTH + 2 * LABEL_PAD), size.width), height: percent(LABEL_LINE + 2 * LABEL_PAD, size.height), padding: `0 ${percent(LABEL_PAD, size.width)}` }}
            onChange={(e) => replace(writing, { ...labels[writing], text: e.target.value.replace(/[\r\n]+/g, ' ') })}
            onBlur={endWriting}
            onKeyDown={(e) => {
              if (pressed(e, 'field.keep')) {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
          />
          <span className="label-actions">
            {labels[writing]?.to && (
              <button type="button" className="button button-quiet" onPointerDown={(e) => e.preventDefault()} onClick={() => replace(writing, { x: labels[writing].x, y: labels[writing].y, text: labels[writing].text })}>
                Remove arrow
              </button>
            )}
            <button
              type="button"
              className="button button-quiet"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                const gone = writing
                setEditing(null)
                replace(gone, null)
              }}
            >
              Remove label
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
