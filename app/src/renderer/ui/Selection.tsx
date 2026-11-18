import { pressed } from '../../shared/keys'
import { tagLabel } from '../../shared/tags'
import { useEffect, useState } from 'react'
import { EXPLODED_TOOLS } from '../../shared/explode'
import { describe, descriptorOf } from '../state/descriptors'
import { viewHost } from '../state/drawing'
import { isStrokeRef } from '../state/sets'
import { actions, explodeNow, runningSession, store, useStore } from '../state/store'
import { useTool } from '../state/tools'
import { noteSelection } from '../tools/pickMarks'
import { staleMessage } from '../tools/Tool'
import { insertIntoSession } from './insertIntoSession'
import { TYPING } from './typing'

/** One ref in hand: the ref (and the name the model gives it), and what the kernel says of it once it has. */
export interface HandRef {
  ref: string
  label: string
  descriptor: string
}

/**
 * What is selected, for the head of the route card (`card/InHand.tsx`): each ref with what the kernel says of it, why a note or an
 * insert cannot be made now, and what can be done with them. The Escape that clears it while Select is the tool is heard here.
 */
export function useSelection() {
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

  const inLayout = parts?.filter((p) => p.layout === layout) ?? []
  const refs: HandRef[] = objectId ? selection.map((ref) => ({ ref, label: tagLabel(inLayout, ref) ?? '', descriptor: descriptorOf(objectId, revision, layout, ref) ?? '' })) : []

  return {
    refs,
    canInsert,
    stale,
    exploded,
    noting,
    /** Put the refs in the session's prompt, without sending them. */
    insert(): void {
      // The dock may be away: the box takes no focus in a hidden one, so it is given the keys a frame after it is shown.
      const hidden = !store.getState().dockOpen
      actions.setDockOpen(true)
      insertIntoSession(selection.join(' '), { later: hidden })
    },
    /** Leave a mark on each ref. Needs the view's camera: without the view there is nothing to say. */
    note(): void {
      const camera = viewHost()?.camera()
      if (!camera) return
      setNoting(true)
      void noteSelection(camera).finally(() => setNoting(false))
    },
    clear(): void {
      actions.setSelection([])
    }
  }
}
