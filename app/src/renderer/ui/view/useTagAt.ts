import { useEffect, useRef } from 'react'
import type { Box, Pt } from '../../../shared/leader'
import type { Side } from '../../../shared/tagPlace'
import { setToolLeaders } from '../../state/leaders'

/** Where a tag stands, in pixels from the top left of the view's pane. */
export interface TagAt {
  box: Box
  side: Side
  /** What it is tied to, in the same pixels: none where it is docked or has no subject. */
  subject: Pt | null
}

// The tags on screen. Each `Tag` publishes its place here after every frame; the tool's code watches it (`useTagAt`) and
// the leaders follow from it. The tool in hand owns all the leaders at once (`setToolLeaders`), so this is the one place
// that sets them: one entry for each tag that stands beside a subject.
const placed = new Map<string, TagAt>()
const leaders = new Map<string, { id: string; subject: Pt; tag: Box }>()
const watchers = new Map<string, Set<(at: TagAt | null) => void>>()

const sameAt = (a: TagAt | undefined, b: TagAt): boolean =>
  !!a && a.side === b.side && a.box.x === b.box.x && a.box.y === b.box.y && a.box.w === b.box.w && a.box.h === b.box.h && a.subject?.x === b.subject?.x && a.subject?.y === b.subject?.y

function tell(id: string, at: TagAt | null): void {
  for (const fn of [...(watchers.get(id) ?? [])]) fn(at)
}

/**
 * A tag's place now. `origin` is the pane's top left in window pixels, which the leader layer draws in. The leader is
 * set when the tag stands beside a subject, and not when it is docked.
 */
export function publishTag(id: string, at: TagAt, origin: Pt): void {
  const before = placed.get(id)
  placed.set(id, at)
  if (at.side !== 'docked' && at.subject) {
    leaders.set(id, {
      id,
      subject: { x: at.subject.x + origin.x, y: at.subject.y + origin.y },
      tag: { x: at.box.x + origin.x, y: at.box.y + origin.y, w: at.box.w, h: at.box.h }
    })
  } else leaders.delete(id)
  setToolLeaders([...leaders.values()])
  if (!sameAt(before, at)) tell(id, at)
}

// A flat sheet (a tracing) is no 3D view: the camera's frames do not tell its tags it has moved. Whatever moves the sheet or its subject says so here.
const moved = new Set<() => void>()

/** The sheet or a tag's subject on it has moved: the tags that stand by a point of a sheet (`Tag`'s `subjectClient`) are placed again. */
export function tagsMoved(): void {
  for (const fn of [...moved]) fn()
}

/** Calls back each time `tagsMoved` is said; returns what stops it. */
export function onTagsMoved(fn: () => void): () => void {
  moved.add(fn)
  return () => {
    moved.delete(fn)
  }
}

/** A tag is gone (unmounted): its place and its leader with it. */
export function withdrawTag(id: string): void {
  const was = placed.delete(id)
  const had = leaders.delete(id)
  if (had) setToolLeaders([...leaders.values()])
  if (was) tell(id, null)
}

/** Where the tag `id` stands now, or null where there is none. */
export function tagAt(id: string): TagAt | null {
  return placed.get(id) ?? null
}

/** Calls back when the tag `id` moves, and with null when it goes. Returns what stops it. */
export function watchTag(id: string, on: (at: TagAt | null) => void): () => void {
  let set = watchers.get(id)
  if (!set) watchers.set(id, (set = new Set()))
  set.add(on)
  return () => {
    set!.delete(on)
  }
}

/**
 * The per-frame hook for a tool's code: `on` is called each time the tag `id` has moved (where it stands, which side,
 * and its subject, in the pane's pixels) and with null when it is gone, and once at the start with where it stands now.
 * It never goes through React state: a tool draws what hangs on its tag (a rule, a track) straight from here.
 */
export function useTagAt(id: string, on: (at: TagAt | null) => void): void {
  const latest = useRef(on)
  latest.current = on
  useEffect(() => {
    const now = tagAt(id)
    if (now) latest.current(now)
    return watchTag(id, (at) => latest.current(at))
  }, [id])
}
