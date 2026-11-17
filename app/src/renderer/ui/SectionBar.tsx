import { pressed } from '../../shared/keys'
import { useEffect, useMemo, useRef } from 'react'
import { newCut } from '../../shared/cut'
import { number } from '../../shared/format'
import { useAgentHighlight } from '../state/agent'
import { actions, useStore } from '../state/store'
import { tracingActions } from '../state/tracings'
import { setTool, useTool } from '../state/tools'
import { sectionNudge, setFromFace, useFromFace } from '../tools/sectionTool'
import { atOffset, atPlace, axisOf, flipped, placeOf, sectionExtent, sectionOffset, typedOffset, type Axis } from '../viewport/section'
import { giveKeysBack } from './typing'
import type { Viewport } from '../viewport/Viewport'

const AXES: Axis[] = ['x', 'y', 'z']

/**
 * The section, floating at the bottom of the viewport while the parts are cut
 * or the Section tool is in hand: a plane across an axis or on a face, how far
 * along its normal it is from the middle of the parts, which side it takes
 * away, and off.
 *
 * The slider moves the plane in the viewport as it is dragged and the plane
 * is kept when it is let go; the number beside it follows without a render.
 * With the slider in focus the arrow keys nudge the plane as they do with the
 * tool: a millimetre, with Shift a tenth.
 *
 * A plane that leaves nothing of the parts that are switched on (one kept
 * from another layout, or from before a part shrank) says so, with a way back
 * to the middle (the Middle button).
 */
export function SectionBar({ viewport }: { viewport: Viewport }) {
  const section = useStore((s) => s.section)
  const scene = useStore((s) => s.scene)
  const layout = useStore((s) => s.layout)
  // Which parts are switched on decides whether the plane leaves anything to see.
  const layers = useStore((s) => s.layers)
  const selected = useStore((s) => s.selection.length > 0)
  const pointedOut = useAgentHighlight() !== null
  const inHand = useTool() === 'section'
  const fromFace = useFromFace()
  const slider = useRef<HTMLInputElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const previewing = useRef(false)

  // The box the plane is laid across is the viewport's, which has the scene and the layout by the time this is drawn.
  const box = useMemo(() => viewport.sectionBox(), [viewport, scene, layout])
  const extent = section ? sectionExtent(box, section.normal) : { min: 0, max: 0 }
  const offset = section ? sectionOffset(section, box) : 0
  // What the number says: the plane's place in the object frame across an axis, else how far along its normal.
  const place = section ? placeOf(section, box) : { axis: null, value: 0 }

  // The slider and the number are the DOM's own while they are being changed: nothing of a drag is React's.
  useEffect(() => {
    if (slider.current) slider.current.value = String(offset)
    if (field.current && document.activeElement !== field.current) field.current.value = section ? number(place.value) : ''
  }, [offset, place.value, section, extent.min, extent.max])

  // The plane as the screen draws it, also while its handle is dragged in the viewport: the number and the slider
  // follow it there, and are the kept plane's again when the drag is let go or put back. The slider is left alone
  // while it is the one moving it, and the field while it is typed in.
  useEffect(
    () =>
      viewport.onSectionMoved((plane) => {
        if (!plane) return
        if (slider.current && !previewing.current) slider.current.value = String(sectionOffset(plane, box))
        if (field.current && document.activeElement !== field.current) field.current.value = number(placeOf(plane, box).value)
      }),
    [viewport, box]
  )

  useEffect(() => {
    const range = slider.current
    if (!range || !section) return
    const at = (): typeof section => atOffset(section, box, Number(range.value))
    const preview = (): void => {
      previewing.current = true
      try {
        viewport.setSection(at())
      } finally {
        previewing.current = false
      }
    }
    const keep = (): void => actions.setSection(at())
    // The browser's own step for a key is a share of the range: a millimetre is what an arrow is everywhere else.
    const nudge = (e: KeyboardEvent): void => {
      const by = sectionNudge(e)
      if (by === 0) return
      e.preventDefault()
      actions.setSection(atOffset(section, box, sectionOffset(section, box) + by))
    }
    range.addEventListener('input', preview)
    range.addEventListener('change', keep)
    range.addEventListener('keydown', nudge)
    return () => {
      range.removeEventListener('input', preview)
      range.removeEventListener('change', keep)
      range.removeEventListener('keydown', nudge)
    }
  }, [viewport, section, box])

  // Asked of the viewport, which has the scene, the layers and the plane by the time this is drawn: of the parts it draws.
  const nothingLeft = useMemo(() => viewport.sectionLeavesNothing(), [viewport, section, scene, layout, layers])

  if (!section && !inHand) return null

  const along = section ? axisOf(section.normal) : null
  const typed = (): void => {
    const input = field.current
    if (!input || !section) return
    // Left as it was written: the field shows four digits of an offset that may have more, and that is no request.
    if (input.value.trim() === number(place.value)) return
    const mm = typedOffset(input.value, place.value)
    if (mm !== null) actions.setSection(atPlace(section, box, mm))
    else input.value = number(place.value)
  }
  // Above the selection and what the agent points at, which have the bottom edge.
  const raised = (selected ? 1 : 0) + (pointedOut ? 1 : 0)

  return (
    <div className="sectionbar" role="toolbar" aria-label="Section" data-raised={raised || undefined}>
      <div className="viewbar-group" role="group" aria-label="Plane across an axis">
        {AXES.map((axis) => (
          <button
            key={axis}
            type="button"
            className="bar-button section-axis num"
            data-axis={axis}
            aria-label={`Cut across ${axis.toUpperCase()}`}
            aria-pressed={along?.axis === axis}
            title={`Cut across ${axis.toUpperCase()}, through the middle of the parts`}
            onClick={() => {
              setFromFace(false)
              // Open towards whoever looks (`newCut`): the half taken away is the one on the camera's side.
              actions.setSection(newCut(box, viewport.getCamera(), axis))
            }}
          >
            {axis.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="bar-button"
        aria-pressed={fromFace}
        title="Put the plane on a flat face: click the face"
        onClick={() => {
          // The tool first: taking it up puts down whatever was waited for.
          const wait = !fromFace
          setTool('section')
          setFromFace(wait)
        }}
      >
        From face
      </button>
      <span className="viewbar-rule" aria-hidden="true" />
      <input
        ref={slider}
        className="section-slider"
        type="range"
        aria-label="Offset along the normal"
        title="Where the plane is along its normal. The tick is the middle of the parts"
        min={extent.min}
        max={extent.max}
        step="any"
        defaultValue={offset}
        disabled={!section}
      />
      {section && offset !== 0 && (
      <button
        type="button"
        className="bar-button"
        title="Put the plane through the middle of the parts"
        onClick={() => section && actions.setSection(atOffset(section, box, 0))}
      >
        Middle
      </button>
      )}
      <label className="section-offset" data-along={place.axis ?? undefined} data-disabled={section ? undefined : ''}>
        {place.axis && (
          <span className="num section-axis-letter" data-axis={place.axis} aria-hidden="true">
            {place.axis} =
          </span>
        )}
        <input
          ref={field}
          className="num"
          type="text"
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          aria-label="Plane position in millimetres"
          defaultValue={section ? number(offset) : ''}
          disabled={!section}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={typed}
          onKeyDown={(e) => {
            if (pressed(e, 'field.keep')) typed()
            else if (pressed(e, 'field.leave')) e.currentTarget.value = number(place.value)
            else return
            e.preventDefault()
            e.stopPropagation()
            giveKeysBack(e.currentTarget)
          }}
        />
        <span className="num" aria-hidden="true">
          mm{place.axis ? '' : ' along the normal'}
        </span>
      </label>
      <span className="viewbar-rule" aria-hidden="true" />
      <button type="button" className="bar-button" disabled={!section} title="Take away the other side" onClick={() => section && actions.setSection(flipped(section))}>
        Flip
      </button>
      <button
        type="button"
        className="bar-button"
        disabled={!section}
        title="Show the parts whole again"
        onClick={() => {
          setFromFace(false)
          actions.setSection(null)
        }}
      >
        Off
      </button>
      {section && (
        <>
          <span className="viewbar-rule" aria-hidden="true" />
          <button
            type="button"
            className="bar-button"
            disabled={nothingLeft}
            title="Lay this cut flat at true size, as a tracing you can draw on and export"
            onClick={() => void tracingActions.make({ section: true })}
          >
            Make a tracing of this cut
          </button>
        </>
      )}
      {section && nothingLeft && (
        <>
          <span className="viewbar-rule" aria-hidden="true" />
          <span className="sectionbar-note" role="status">
            Everything is on the cut side
          </span>
        </>
      )}
    </div>
  )
}
