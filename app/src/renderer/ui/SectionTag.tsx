import { pressed } from '../../shared/keys'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { newCut } from '../../shared/cut'
import { number } from '../../shared/format'
import { actions, useStore } from '../state/store'
import { tracingActions } from '../state/tracings'
import { setTool, useTool } from '../state/tools'
import { sectionNudge, setFromFace, useFromFace } from '../tools/sectionTool'
import { onPaneDrawn, paneRect, projectToPane } from '../viewport/overlay'
import { atOffset, atPlace, axisOf, flipped, placeOf, sectionExtent, sectionOffset, typedOffset, type Axis } from '../viewport/section'
import { ruleSubject } from '../viewport/sectionRule'
import { giveKeysBack } from './typing'
import { PopMenu, useDismiss } from './view/PopMenu'
import { Tag } from './view/Tag'
import type { Viewport } from '../viewport/Viewport'

const AXES: Axis[] = ['x', 'y', 'z']

/** What the handle of the rule is, in px: its element stands over the square drawn on the overlay canvas (`RULE_HANDLE`). */
const HANDLE_PX = 16

/**
 * The section, a tag on the top edge of the plane while the parts are cut or the Section tool is in hand (spec 2026-11-18,
 * "Tags"): a plane across an axis or on a face (X, Y, Z, From a face), the plane's place (`y 44.0 mm`, the coordinate across
 * an axis, else how far along its normal it is from the middle of the parts), which side it takes away (Flip), off, and a
 * menu with Middle and Make a tracing. A plane that leaves nothing of the parts that are switched on (one kept from another
 * layout, or from before a part shrank) says so in a problem block under the controls, in `--fail`, with a way back in the
 * menu.
 *
 * The slider is the rule's handle: the rule on the ground along the plane's normal is drawn on the overlay canvas
 * (`drawSectionRule`) and the handle on it is dragged by the Section tool, as the plane is. The element here is the
 * handle's name for a keyboard and a screen reader (`role="slider"`): it stands over the square, takes no pointer, and the
 * arrow keys nudge the plane as they do with the tool, a millimetre, with Shift a tenth. The number follows the plane as
 * it is drawn, never through React.
 */
export function SectionTag({ viewport }: { viewport: Viewport }) {
  const section = useStore((s) => s.section)
  const scene = useStore((s) => s.scene)
  const layout = useStore((s) => s.layout)
  // Which parts are switched on decides whether the plane leaves anything to see.
  const layers = useStore((s) => s.layers)
  const inHand = useTool() === 'section'
  const fromFace = useFromFace()
  const handle = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const menuBox = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  useDismiss(menu, menuBox, () => setMenu(false))

  // The box the plane is laid across is the viewport's, which has the scene and the layout by the time this is drawn.
  const box = useMemo(() => viewport.sectionBox(), [viewport, scene, layout])
  const extent = section ? sectionExtent(box, section.normal) : { min: 0, max: 0 }
  const offset = section ? sectionOffset(section, box) : 0
  // What the number says: the plane's place in the object frame across an axis, else how far along its normal.
  const place = section ? placeOf(section, box) : { axis: null, value: 0 }
  const subject = useMemo(() => (section ? ruleSubject(section, box) : null), [section, box])

  // The number is the DOM's own while the plane is dragged: nothing of a drag is React's.
  useEffect(() => {
    if (field.current && document.activeElement !== field.current) field.current.value = section ? number(place.value) : ''
  }, [place.value, section])

  // The plane as the screen draws it, also while its handle is dragged in the viewport: the number follows it there, and is the
  // kept plane's again when the drag is let go or put back. The field is left alone while it is typed in.
  useEffect(
    () =>
      viewport.onSectionMoved((plane) => {
        if (!plane) return
        if (field.current && document.activeElement !== field.current) field.current.value = number(placeOf(plane, box).value)
        handle.current?.setAttribute('aria-valuenow', String(sectionOffset(plane, box)))
      }),
    [viewport, box]
  )

  // The handle's element stands over the square the overlay draws, after every frame: the camera moves, and so does a drag.
  const stand = (): void => {
    const el = handle.current
    if (!el) return
    const within = el.offsetParent instanceof HTMLElement ? el.offsetParent : null
    const canvas = paneRect()
    const at = viewport.sectionRuleAt()
    const p = at ? projectToPane(at) : null
    if (!within || !canvas || !p) {
      el.style.visibility = 'hidden'
      return
    }
    const pane = within.getBoundingClientRect()
    el.style.transform = `translate(${Math.round(p.x + canvas.left - pane.left - HANDLE_PX / 2)}px, ${Math.round(p.y + canvas.top - pane.top - HANDLE_PX / 2)}px)`
    el.style.visibility = ''
  }
  const standing = useRef(stand)
  standing.current = stand
  useEffect(() => onPaneDrawn(() => standing.current()), [])
  useLayoutEffect(() => {
    standing.current()
  })

  useEffect(() => {
    const el = handle.current
    if (!el || !section) return
    // A slider that is no input has no step for a key: a millimetre is what an arrow is everywhere else.
    const nudge = (e: KeyboardEvent): void => {
      const by = sectionNudge(e)
      if (by === 0) return
      e.preventDefault()
      actions.setSection(atOffset(section, box, sectionOffset(section, box) + by))
    }
    el.addEventListener('keydown', nudge)
    return () => el.removeEventListener('keydown', nudge)
  }, [section, box])

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
  // The tag follows the plane as it is dragged: its subject is asked of the viewport's plane after every frame.
  const subjectAt = () => {
    const plane = viewport.getSection()
    return plane ? ruleSubject(plane, box) : null
  }
  const shut = (): void => {
    setMenu(false)
    requestAnimationFrame(() => menuBox.current?.querySelector<HTMLElement>('.tag-more')?.focus({ preventScroll: true }))
  }

  return (
    <>
      <Tag id="section" subject={subject} subjectAt={subjectAt} prefer="above" sticky={false}>
        <div className="tag-stack" role="toolbar" aria-label="Section">
          <div className="tag-row">
            <div className="tag-row" role="group" aria-label="Plane across an axis">
              {AXES.map((axis) => (
                <button
                  key={axis}
                  type="button"
                  className="tag-control tag-axis num"
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
            <label className="tag-value tag-place" data-along={place.axis ?? undefined} data-disabled={section ? undefined : ''}>
              {place.axis && (
                <span className="tag-axis-letter" data-axis={place.axis} aria-hidden="true">
                  {place.axis}
                </span>
              )}
              <input
                ref={field}
                className="tag-field"
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
              <span className="tag-unit" aria-hidden="true">
                mm{place.axis ? '' : ' along the normal'}
              </span>
            </label>
          </div>
          <div className="tag-row">
            <button
              type="button"
              className="tag-control"
              aria-pressed={fromFace}
              title="Put the plane on a flat face: click the face"
              onClick={() => {
                // The tool first: taking it up puts down whatever was waited for.
                const wait = !fromFace
                setTool('section')
                setFromFace(wait)
              }}
            >
              From a face
            </button>
            <span className="tag-sep" aria-hidden="true" />
            <button type="button" className="tag-control" disabled={!section} title="Take away the other side" onClick={() => section && actions.setSection(flipped(section))}>
              Flip
            </button>
            <button
              type="button"
              className="tag-control"
              disabled={!section}
              title="Show the parts whole again"
              onClick={() => {
                setFromFace(false)
                actions.setSection(null)
              }}
            >
              Off
            </button>
            <div className="tag-menu-box" ref={menuBox}>
              <button type="button" className="tag-control tag-more" aria-label="More about the section" aria-haspopup="menu" aria-expanded={menu} disabled={!section} title="Middle of the parts, make a tracing" onClick={() => setMenu((was) => !was)}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
                <circle cx="2.5" cy="7" r="1.25" />
                <circle cx="7" cy="7" r="1.25" />
                <circle cx="11.5" cy="7" r="1.25" />
              </svg>
              </button>
              {menu && section && (
                <PopMenu label="Section" className="tag-menu" close={shut}>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    aria-disabled={offset === 0 ? 'true' : undefined}
                    title="Put the plane through the middle of the parts"
                    onClick={() => {
                      if (offset === 0) return
                      actions.setSection(atOffset(section, box, 0))
                      shut()
                    }}
                  >
                    Middle
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    aria-disabled={nothingLeft ? 'true' : undefined}
                    title="Make a tracing of this cut: lay it flat at true size, to draw on and export"
                    onClick={() => {
                      if (nothingLeft) return
                      shut()
                      void tracingActions.make({ section: true })
                    }}
                  >
                    Make a tracing
                  </button>
                </PopMenu>
              )}
            </div>
          </div>
        </div>
        {section && nothingLeft && (
          <p className="tag-problem" role="status">
            Everything is on the cut side
          </p>
        )}
      </Tag>
      {section && (
        <div
          ref={handle}
          className="section-rule-handle"
          role="slider"
          tabIndex={0}
          aria-label="Offset along the normal"
          aria-orientation="horizontal"
          aria-valuemin={extent.min}
          aria-valuemax={extent.max}
          aria-valuenow={offset}
          style={{ visibility: 'hidden' }}
        />
      )}
    </>
  )
}
