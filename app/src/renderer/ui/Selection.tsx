import { pressed } from '../../shared/keys'
import { tagLabel } from '../../shared/tags'
import { useEffect, useState } from 'react'
import { EXPLODED_TOOLS } from '../../shared/explode'
import { describe, descriptorOf } from '../state/descriptors'
import { isStrokeRef } from '../state/sets'
import { actions, explodeNow, runningSession, store, useStore } from '../state/store'
import { useTool } from '../state/tools'
import { noteSelection } from '../tools/pickMarks'
import { staleMessage } from '../tools/Tool'
import type { Viewport } from '../viewport/Viewport'
import { insertIntoSession } from './insertIntoSession'
import { TYPING } from './typing'

/**
 * What is selected, floating at the bottom of the viewport: each ref with what
 * the kernel says of it, and what can be done with them.
 */
export function Selection({ viewport }: { viewport: Viewport }) {
  const selection = useStore((s) => s.selection)
  const objectId = useStore((s) => s.objectId)
  const revision = useStore((s) => s.revision)
  const layout = useStore((s) => s.layout)
  const parts = useStore((s) => s.scene?.parts)
  const canInsert = useStore((s) => runningSession(s) !== undefined)
  const selecting = useTool() === 'select'
  // Why no note can be left: the parts on screen are older than the model, and the refs would name other geometry.
  const stale = useStore((s) => (s.build?.stale ? staleMessage(s.build.status) : null))
  // Why no note can be left: the parts are drawn apart, and no mark is placed in a view whose parts are not where they are.
  const exploded = useStore((s) => (explodeNow(s) ? EXPLODED_TOOLS : null))
  // While the marks of a selection are being made, so that they are made once.
  const [noting, setNoting] = useState(false)
  // The descriptors live in a cache outside React; this counts the ones that arrived, to draw them.
  const [, setArrived] = useState(0)

  useEffect(() => {
    if (!objectId) return
    let live = true
    for (const ref of selection) {
      // A stroke of a sketch is no face of the build: the kernel has nothing to say of it.
      if (isStrokeRef(ref) || descriptorOf(objectId, revision, layout, ref) !== undefined) continue
      void describe(objectId, revision, layout, ref).then((text) => {
        if (live && text !== null) setArrived((n) => n + 1)
      })
    }
    return () => {
      live = false
    }
  }, [selection, objectId, revision, layout])

  useEffect(() => {
    if (!selecting || selection.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (!pressed(e, 'escape') || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      actions.setSelection([])
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting, selection.length])

  if (!objectId || selection.length === 0) return null
  const inLayout = parts?.filter((p) => p.layout === layout) ?? []

  return (
    <div className="selection" role="group" aria-label="Selection">
      <ul className="selection-chips">
        {selection.map((ref) => (
          <li key={ref} className="selection-chip" data-ref={ref}>
            <span className="selection-ref num">{[ref, tagLabel(inLayout, ref)].filter(Boolean).join(' · ')}</span>
            <span className="selection-descriptor num">{descriptorOf(objectId, revision, layout, ref) ?? ''}</span>
          </li>
        ))}
      </ul>
      {selection.length === 1 && <span className="selection-hint">Shift-click to add</span>}
      <span className="viewbar-rule" aria-hidden="true" />
      <button
        type="button"
        className="bar-button"
        // Not on a stale build either: the refs would name other geometry in the build the agent then asks about.
        disabled={!canInsert || stale !== null}
        title={stale ?? (canInsert ? "Put the selection in the session's prompt" : 'Start a session to put the selection in its prompt')}
        onClick={() => {
          // The dock may be away: the box takes no focus in a hidden one, so it is given the keys a frame after it is shown.
          const hidden = !store.getState().dockOpen
          actions.setDockOpen(true)
          insertIntoSession(selection.join(' '), { later: hidden })
        }}
      >
        Insert
      </button>
      <button
        type="button"
        className="bar-button"
        disabled={noting || stale !== null || exploded !== null}
        title={stale ?? exploded ?? (selection.length === 1 ? 'Leave a note on it for the agent' : 'Leave a note on each for the agent')}
        onClick={() => {
          setNoting(true)
          void noteSelection(viewport.getCamera()).finally(() => setNoting(false))
        }}
      >
        Note
      </button>
    </div>
  )
}
