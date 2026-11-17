import type { NamedSet } from '../../shared/sets'
import { refOfSet, selectableMembers, setActions, setsHolding, setsStore } from '../state/sets'
import { actions, store } from '../state/store'
import { toolStore } from '../state/tools'
import type { ViewportPointer } from '../viewport/Viewport'
import { REPEAT_MS, REPEAT_PX, type Tool, type ToolContext } from './Tool'
import type { Hit } from '../viewport/picking'

/** How long the pointer rests on a face or an edge before the kernel is asked what it is. */
const DESCRIBE_AFTER_MS = 150

/**
 * The select tool: what is under the pointer is marked and named beside it,
 * a click selects it, with Shift adds it or takes it out, and a click on
 * nothing clears the selection. Dragging turns the camera as ever. Where each
 * ref was clicked is remembered with it, for a note left on the selection.
 * What a click takes is the scope (`selectScope`): a face or an edge, one of the two, or the whole part; with
 * any, a double click on a face or an edge takes its part.
 */

/**
 * The ref a hit gives in a scope: null where the scope passes it over. In the set scope it is the ref of the first (oldest) set of
 * the layout shown that holds the face, edge or part under the pointer (`#deck`), and null for one that is in no set. `sets` and
 * `layout` are the window's, unless given.
 */
export function refInScope(hit: Pick<Hit, 'kind' | 'part' | 'ref'>, scope: string, sets: readonly NamedSet[] = setsStore.getState().sets, layout: string = store.getState().layout): string | null {
  if (scope === 'set') {
    const first = setsHolding(sets, layout, hit.ref)[0]
    return first ? refOfSet(first) : null
  }
  if (scope === 'part') return hit.part
  if (scope === 'face' || scope === 'edge') return hit.kind === scope ? hit.ref : null
  return hit.ref
}

export function selectTool(): Tool {
  let hovered: string | null = null
  let rest: ReturnType<typeof setTimeout> | undefined
  let last: { part: string; client: [number, number]; at: number } | null = null
  const stop = (ctx: ToolContext): void => {
    clearTimeout(rest)
    hovered = null
    ctx.viewport.setHover(null)
    ctx.readout.hide()
    setActions.hover(null)
  }
  /** In the set scope the pointer on a face of a set lights the whole set in its colour, and the readout names it. */
  const lightSet = (e: ViewportPointer, ctx: ToolContext): void => {
    clearTimeout(rest)
    ctx.viewport.setHover(null)
    const here = e.hit ? setsHolding(setsStore.getState().sets, ctx.layout, e.hit.ref) : []
    if (here.length === 0) {
      setActions.hover(null)
      return ctx.readout.hide()
    }
    hovered = refOfSet(here[0])
    setActions.hover(here[0].id)
    ctx.readout.show(e.client, hovered, here.length > 1 ? `also in ${here.slice(1).map(refOfSet).join(', ')}` : undefined)
  }
  /** A click in the set scope takes the members of the set under the pointer that the build found; Shift adds them to the selection. */
  const selectSet = (e: ViewportPointer, ctx: ToolContext): void => {
    const first = e.hit ? setsHolding(setsStore.getState().sets, ctx.layout, e.hit.ref)[0] : undefined
    // Passed over, as an edge is in Face: what is selected stays.
    if (!first) return
    const members = selectableMembers(first)
    const now = store.getState().selection
    const at = e.hit && members.includes(e.hit.ref) ? { [e.hit.ref]: { point: e.hit.point, normal: e.hit.normal } } : {}
    actions.setSelection(e.shift ? [...now, ...members.filter((m) => !now.includes(m))] : members, at)
  }
  return {
    id: 'select',
    cursor: 'default',
    cancel: stop,
    onPointer(e: ViewportPointer, ctx: ToolContext) {
      if (e.type === 'click') {
        if (!e.hit) {
          last = null
          return actions.setSelection([])
        }
        const scope = toolStore.getState().selectScope
        if (scope === 'set') return selectSet(e, ctx)
        const now = performance.now()
        const twice = scope === 'any' && !e.shift && last !== null && last.part === e.hit.part && now - last.at <= REPEAT_MS && Math.hypot(e.client[0] - last.client[0], e.client[1] - last.client[1]) <= REPEAT_PX
        last = twice || e.shift ? null : { part: e.hit.part, client: e.client, at: now }
        const ref = twice ? e.hit.part : refInScope(e.hit, scope)
        if (ref === null) return
        const at = { point: e.hit.point, normal: e.hit.normal }
        if (e.shift) actions.toggleSelection(ref, at)
        else actions.setSelection([ref], { [ref]: at })
        return
      }
      const { hit } = e
      if (e.type === 'cancel' || !hit) return stop(ctx)
      if (toolStore.getState().selectScope === 'set') return lightSet(e, ctx)
      // The scope was changed with a set lit: it is let go.
      if (hovered?.startsWith('#')) setActions.hover(null)
      const ref = refInScope(hit, toolStore.getState().selectScope)
      if (ref === null) return stop(ctx)
      const { objectId, revision } = ctx
      hovered = ref
      ctx.viewport.setHover({ ...hit, ref })
      const known = ctx.descriptor(ref)
      ctx.readout.show(e.client, ref, known)
      clearTimeout(rest)
      if (known !== undefined) return
      rest = setTimeout(() => {
        void ctx.describe(ref).then((said) => {
          const now = store.getState()
          if (said && hovered === ref && now.objectId === objectId && now.revision === revision) ctx.readout.describe(said.descriptor)
        })
      }, DESCRIBE_AFTER_MS)
    }
  }
}
