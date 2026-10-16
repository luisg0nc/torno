import { pressed } from '../../shared/keys'
import { isSpreadRefusal, valueText } from '../../shared/dimension'
import { keepHeld, measuredStore } from '../state/measured'
import type { Described } from '../../shared/geometry'
import type { Anchor, MeasureKind, Vec3 } from '../../shared/marks'
import { toolStore } from '../state/tools'
import type { Hit } from '../viewport/picking'
import type { ViewportPointer } from '../viewport/Viewport'
import { DESCRIBE_WITHIN_MS, REPEAT_MS, REPEAT_PX, anchorFromHit, dot, sub, within, type Tool, type ToolContext } from './Tool'

/** How long the kernel's reason for refusing a measurement stays at the pointer. */
export const REFUSAL_MS = 4000
/** Said at the pointer when a double click was on what has no radius: nothing is kept of it, and the first end waits for the second. */
export const NOT_ROUND = 'Not round: a double click measures a hole, a cylinder or a circle'
/**
 * Said at the pointer of a distance between two parts torno set apart for
 * display, in place of an estimate and in place of main's refusal, which is
 * a paragraph (the agent is given that in full). On an object that has only
 * a print layout this is the answer to every such measurement: it stays
 * until the next click or Escape.
 */
export const SPREAD_LINE = 'Parts are spread for printing here: no distance between them. Add assembly(p) to check fit.'
/** How long the pointer rests on a face or an edge before the kernel is asked what it is. */
const DESCRIBE_AFTER_MS = 150
/** The value just measured stays at the pointer until the pointer has moved this far from where it was read out. */
const RESULT_PX = 12

/** An end of a measurement as it was clicked: on what, and whether as a bare point (Shift). */
interface End {
  hit: Hit
  bare: boolean
}

/** Whether what the kernel describes has a radius to measure: a cylindrical, spherical or toroidal face, or a circular edge. */
export function isRound(described: Described | null): boolean {
  if (described?.kind === 'face') return ['cylinder', 'sphere', 'torus'].includes(described.type)
  return described?.kind === 'edge' && described.type === 'circle'
}

/**
 * How the kernel takes an angle of a face or an edge of a type: as a plane or a line (`flat`), by its axis
 * (`axis`: a cylinder, a cone, a torus, a circle), only if it is flat or straight within its tolerance
 * (`ifFlat`: a B-spline, an extrusion and the like, which may be either), or not at all (`never`).
 */
export type AngleTaking = 'flat' | 'axis' | 'ifFlat' | 'never'

export function angleTaking(kind: 'face' | 'edge', type: string): AngleTaking {
  if (kind === 'face') {
    if (type === 'plane') return 'flat'
    if (['cylinder', 'cone', 'torus'].includes(type)) return 'axis'
    return type === 'sphere' ? 'never' : 'ifFlat'
  }
  if (type === 'line') return 'flat'
  if (type === 'circle') return 'axis'
  return ['ellipse', 'hyperbola', 'parabola'].includes(type) ? 'never' : 'ifFlat'
}

/** What is said at the pointer, in place of an estimate, of an end of an angle (`ref`) that is not flat or straight. */
export function angleHint(ref: string, kind: 'face' | 'edge', type: string): string | null {
  const taking = angleTaking(kind, type)
  const what = `${ref} is ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} ${kind}`
  const flat = kind === 'face' ? 'flat' : 'straight'
  if (taking === 'axis') return `By its axis: ${what}`
  if (taking === 'ifFlat') return `Taken only if ${flat}: ${what}`
  if (taking === 'never') return `Not ${flat}: ${what}. An angle needs a flat face, a straight edge or an axis`
  return null
}

/**
 * What the mesh says a measurement between two picks will be, to read out
 * while the second is pending: the distance between the two points clicked,
 * or the angle between the normals there. It is an estimate, shown with `≈`:
 * the kernel measures between the features themselves (two planes, two axes),
 * and its value is what the dimension gets. Null where the mesh says nothing
 * (an angle to an edge, which has no normal).
 */
export function estimate(measure: 'distance' | 'angle', a: Pick<Hit, 'point' | 'normal'>, b: Pick<Hit, 'point' | 'normal'>): string | null {
  if (measure === 'distance') return `≈ ${valueText('distance', Math.hypot(...sub(b.point, a.point)))}`
  if (!a.normal || !b.normal) return null
  const cosine = dot(a.normal, b.normal) / (Math.hypot(...a.normal) * Math.hypot(...b.normal))
  return Number.isFinite(cosine) ? `≈ ${valueText('angle', (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI)}` : null
}

/**
 * The measure tool. A click on a face or an edge is the first end of a
 * measurement, a second click the other end: what is between them is
 * measured, a distance or, when that is what is chosen, an angle. A double click
 * on something round (a hole, a cylinder, a circular edge) measures its diameter
 * at once, or its radius when that is chosen. `T` over a face measures the
 * thickness of the wall under the pointer. With Shift a click is a bare
 * point: where it was clicked, tied to no face.
 *
 * A measurement leaves no mark and is told to no one: main measures it (`ctx.measure`, `geometry.measure`) and the
 * last one is held in `state/measured.ts` for the strip, until the next first end, Escape with nothing under way, or
 * the tool is put down. It is kept as a dimension only by `measure.keep` (Enter) or the strip's button (`keepHeld`).
 *
 * While the second end is pending the line to the pointer is drawn and an
 * estimate from the mesh read out, marked `≈`. Of an angle, an end the kernel
 * takes by its axis, only if flat or straight, or not at all has no estimate:
 * that is said instead (`angleHint`), and the click is sent all the same. The value of the measurement is
 * the kernel's: main measures it, and it is read out in
 * place of the estimate. When the kernel refuses the measurement (no angle
 * between a plane and a cylinder), nothing is held and its reason is read out
 * for `REFUSAL_MS`. A distance between two parts torno spread for display is
 * no distance of the model's: `SPREAD_LINE` is read out in place of the
 * estimate, and stays after the click until the next one or Escape. Escape
 * drops the first end; the tool stays in hand.
 */
export function measureTool(): Tool {
  /** The first end, once clicked: where and when, and whether it has a radius (asked of the kernel at the click). */
  let first: (End & { client: [number, number]; at: number; round: Promise<boolean> }) | null = null
  /** What the pointer is on, for `T`. */
  let hover: { hit: Hit; client: [number, number] } | null = null
  /** Counts the dimensions committed: the one still waiting on main owns the draft drawn meanwhile. */
  let committing = 0
  /**
   * What is read out and must not be written over by the hover: the kernel's reason until its time is up, the value
   * just measured until the pointer moves on, or (`sticky`) that the parts are spread, until the next click or Escape.
   */
  let held: { until: number; timer?: ReturnType<typeof setTimeout>; client: [number, number]; within: number; sticky?: true } | null = null
  let rest: ReturnType<typeof setTimeout> | undefined
  /** What the kernel said each ref is, for an angle: its kind and type. Null when it could not say. */
  const types = new Map<string, { kind: 'face' | 'edge'; type: string } | null>()
  const asking = new Set<string>()

  const release = (): void => {
    clearTimeout(held?.timer)
    held = null
  }
  /** Whether the readout is still held, for a pointer now at `client`. */
  const holding = (client: [number, number]): boolean => {
    if (!held) return false
    if (held.sticky || performance.now() < held.until || Math.hypot(client[0] - held.client[0], client[1] - held.client[1]) <= held.within) return true
    release()
    return false
  }

  const drawFirst = (ctx: ToolContext, to: Vec3 | null = null): void => {
    if (first) ctx.viewport.setDraft({ kind: 'dimension', from: first.hit.point, to })
  }

  const end = async (of: End, ctx: ToolContext): Promise<Anchor> => (of.bare ? { point: of.hit.point } : anchorFromHit(of.hit, ctx.describe))

  const take = async (measure: MeasureKind, a: End, b: End | null, client: [number, number], ctx: ToolContext): Promise<void> => {
    // As they are now: the kernel is asked before anything is held, and the view may move meanwhile.
    const { objectId, layout, revision, camera } = ctx
    const mine = ++committing
    ctx.viewport.setDraft({ kind: 'dimension', from: a.hit.point, to: b ? b.hit.point : null })
    try {
      const [from, to] = await Promise.all([end(a, ctx), b ? end(b, ctx) : null])
      const probe = { measure, layout, revision, a: from, ...(to ? { b: to } : {}) }
      const got = await ctx.measure(probe)
      if (mine !== committing) return
      // Held for the strip, to be kept as a dimension only when the person means to. Nothing is made of it.
      measuredStore.getState().setHeld({ ...probe, objectId, camera, value: got.value, how: got.how, revision: got.revision })
      // The kernel's value, in place of the estimate: until the pointer moves on.
      release()
      held = { until: 0, client: hover?.client ?? client, within: RESULT_PX }
      ctx.readout.show(held.client, valueText(measure, got.value), got.how)
    } catch (e) {
      if (mine !== committing) return
      // Main did not keep it, and why is the kernel's to say: no angle between these two, no radius of that.
      release()
      const at = hover?.client ?? client
      const reason = e instanceof Error ? e.message : String(e)
      if (isSpreadRefusal(reason)) {
        held = { until: 0, client: at, within: 0, sticky: true }
        ctx.readout.say(at, SPREAD_LINE)
        return
      }
      held = { until: performance.now() + REFUSAL_MS, client: at, within: 0 }
      held.timer = setTimeout(() => {
        held = null
        ctx.readout.hide()
      }, REFUSAL_MS)
      ctx.readout.say(at, reason)
    } finally {
      // Its draft, unless a first end was clicked meanwhile, whose own is drawn now.
      if (mine === committing && !first) ctx.viewport.setDraft(null)
    }
  }

  const drop = (ctx: ToolContext): void => {
    first = null
    ctx.viewport.setDraft(null)
  }

  /** Whether a distance from the first end to `hit` would be between two parts of which torno moved one for display. */
  const spreadApart = (from: End, hit: Hit, ctx: ToolContext): boolean => from.hit.part !== hit.part && (ctx.moved?.(from.hit.part) === true || ctx.moved?.(hit.part) === true)

  const click = (e: ViewportPointer, hit: Hit, ctx: ToolContext): void => {
    const now = performance.now()
    // A click puts away what was said of the one before.
    if (held?.sticky) release()
    if (!first) {
      const bare = e.shift
      // A bare point has no radius. Of anything else the kernel says what it is: asked now, so a double click need not wait.
      const round = bare ? Promise.resolve(false) : within(ctx.describe(hit.ref), DESCRIBE_WITHIN_MS).then(isRound)
      first = { hit, bare, client: e.client, at: now, round }
      // A new measurement begins: the last one, not kept, is let go of.
      measuredStore.getState().clearHeld()
      // Whatever was being measured is on its own from here: the draft is this end's.
      committing += 1
      release()
      drawFirst(ctx)
      return
    }
    const begun = first
    const repeat = Math.hypot(e.client[0] - begun.client[0], e.client[1] - begun.client[1]) <= REPEAT_PX && now - begun.at <= REPEAT_MS
    if (repeat) {
      // The second half of a double click: the diameter of something round, and of anything else nothing more than the first click.
      void begun.round.then((round) => {
        if (first !== begun) return
        if (!round) {
          // Nothing is kept, and it says why: an ellipse, a flat face, a straight edge. The first end still waits.
          release()
          held = { until: performance.now() + REFUSAL_MS, client: e.client, within: 0 }
          held.timer = setTimeout(() => {
            held = null
            ctx.readout.hide()
          }, REFUSAL_MS)
          ctx.readout.say(e.client, NOT_ROUND)
          return
        }
        first = null
        return take(toolStore.getState().round, begun, null, e.client, ctx)
      })
      return
    }
    first = null
    void take(toolStore.getState().between, begun, { hit, bare: e.shift }, e.client, ctx)
  }

  /** What a ref is, as far as the kernel has said: asked once, and read out again when it answers while the pointer is still on it. */
  const typeOf = (end: Hit, ctx: ToolContext): { kind: 'face' | 'edge'; type: string } | null | undefined => {
    const { ref } = end
    // A ref names another face in another build.
    const key = `${ctx.objectId}\n${ctx.revision}\n${ctx.layout}\n${ref}`
    if (types.has(key)) return types.get(key)
    // A descriptor the kernel has already given starts with the type: "bspline, 50 mm²".
    const line = ctx.descriptor(ref)
    if (line !== undefined) return { kind: end.kind, type: line.split(',')[0].trim() }
    if (asking.has(key)) return undefined
    asking.add(key)
    void ctx.describe(ref).then((said) => {
      asking.delete(key)
      types.set(key, said && said.kind !== 'part' ? { kind: said.kind, type: said.type } : null)
      if (first && hover && (hover.hit.ref === ref || first.hit.ref === ref) && !holding(hover.client)) readOut(hover.client, hover.hit, ctx)
    })
    return undefined
  }

  /** The readout while the second end is pending: an estimate, or why there is none. */
  const readOut = (client: [number, number], hit: Hit, ctx: ToolContext): void => {
    if (!first) return
    const { between } = toolStore.getState()
    // No estimate of what is no distance of the model's: said up front, before the click that main would refuse.
    if (between === 'distance' && spreadApart(first, hit, ctx)) return ctx.readout.say(client, SPREAD_LINE)
    if (between === 'angle') {
      // What the kernel takes only by an axis, only if flat, or never has no estimate from the mesh: said
      // before the click, which still goes to main. Until the kernel has said what an end is, the estimate.
      const ends = [hit, first.bare ? null : first.hit].filter((end): end is Hit => end !== null)
      for (const end of ends) {
        const known = typeOf(end, ctx)
        const hint = known ? angleHint(end.ref, known.kind, known.type) : null
        if (hint) return ctx.readout.say(client, hint)
      }
    }
    ctx.readout.show(client, estimate(between, first.hit, hit) ?? between, hit.ref)
  }

  const hovering = (e: ViewportPointer, hit: Hit, ctx: ToolContext): void => {
    hover = { hit, client: e.client }
    ctx.viewport.setHover(hit)
    clearTimeout(rest)
    if (first) drawFirst(ctx, hit.point)
    if (holding(e.client)) return
    if (first) {
      readOut(e.client, hit, ctx)
      return
    }
    // Nothing under way: what the first end would be on, and what the kernel says it is, once the pointer rests.
    const { ref } = hit
    const known = ctx.descriptor(ref)
    ctx.readout.show(e.client, ref, known)
    if (known !== undefined) return
    rest = setTimeout(() => {
      void ctx.describe(ref).then((said) => {
        if (said && hover?.hit.ref === ref && !first && !held) ctx.readout.describe(said.descriptor)
      })
    }, DESCRIBE_AFTER_MS)
  }

  return {
    id: 'measure',
    cursor: 'crosshair',
    onPointer(e: ViewportPointer, ctx: ToolContext) {
      if (e.type === 'click') {
        if (e.hit) click(e, e.hit, ctx)
        return
      }
      if (e.type === 'down' || e.type === 'up') return
      if (e.type === 'move' && e.hit && e.buttons === 0) return hovering(e, e.hit, ctx)
      // Beside the parts, turning the camera, or gone: nothing is pointed at. The first end stays drawn.
      clearTimeout(rest)
      hover = null
      ctx.viewport.setHover(null)
      if (first) drawFirst(ctx)
      if (!holding(e.client)) ctx.readout.hide()
    },
    onKey(e: KeyboardEvent, ctx: ToolContext) {
      if (ctx.stale !== null) return false
      if (pressed(e, 'escape')) {
        const said = held?.sticky === true
        if (said) {
          release()
          ctx.readout.hide()
        }
        if (!first) {
          // With nothing under way, Escape lets go of the last measurement.
          if (measuredStore.getState().held === null) return said
          measuredStore.getState().clearHeld()
          return true
        }
        drop(ctx)
        return true
      }
      if (pressed(e, 'measure.keep')) {
        // The last measurement, kept as a dimension: as the strip's button keeps it. Only one of the object shown.
        const last = measuredStore.getState().held
        if (!last || last.objectId !== ctx.objectId) return false
        if (e.repeat) return true
        void keepHeld((_objectId, mark) => ctx.commit(mark)).catch((err: unknown) => {
          const at = hover?.client ?? ctx.viewport.pointerAt?.() ?? null
          if (!at) return
          release()
          held = { until: performance.now() + REFUSAL_MS, client: at, within: 0 }
          held.timer = setTimeout(() => {
            held = null
            ctx.readout.hide()
          }, REFUSAL_MS)
          ctx.readout.say(at, err instanceof Error ? err.message : String(err))
        })
        return true
      }
      if (!pressed(e, 'measure.wall')) return false
      // The wall under the pointer as of now. What the last move was on may not be there any more (the wheel
      // zooms without a move), and a tool just taken has been told of no move at all: the viewport knows where
      // the pointer is, and is asked what is under it.
      const at = ctx.viewport.pointerAt ? ctx.viewport.pointerAt() : (hover?.client ?? null)
      // The faces alone are asked for: a wall is of a face, and a pointer within a few pixels of an edge is still over one.
      const hit = at && ctx.viewport.pick(at[0], at[1], { edges: false })
      if (!at || !hit || hit.kind !== 'face') return false
      // A key held down repeats: one wall, one dimension.
      if (e.repeat) return true
      // Whatever end was pending is dropped for it.
      first = null
      hover = { hit, client: at }
      void take('thickness', { hit, bare: false }, null, at, ctx)
      return true
    },
    cancel(ctx: ToolContext) {
      committing += 1
      clearTimeout(rest)
      release()
      measuredStore.getState().clearHeld()
      first = null
      hover = null
      ctx.viewport.setHover(null)
      ctx.viewport.setDraft(null)
      ctx.readout.hide()
    }
  }
}
