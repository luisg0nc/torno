import { layerOf } from './store'
import { explodeShown, nothingApart, sameExplode } from '../../shared/explode'
import type { Camera, SectionPlane } from '../../shared/view'
import { type SavedView, cleanViewName } from '../../shared/views'
import type { TornoState } from './store'

// What a saved view is made of, read off the window's state, and whether the screen still shows one. Pure: the
// store's actions keep, apply and remove the views (`actions.saveView` and its neighbours).

type Shown = Pick<TornoState, 'scene' | 'layout' | 'layers' | 'section' | 'explode' | 'scans' | 'scanViews'>

/** The names of the parts of a layout that are switched off. */
export function hiddenIn(s: Pick<TornoState, 'scene' | 'layers'>, layout: string): string[] {
  return (s.scene?.parts ?? []).filter((part) => part.layout === layout && layerOf(s.layers, part.name)?.visible === false).map((part) => part.name)
}

/** How every scan of the object is shown now, as a view keeps it: whether it is on, and how thin when it is not solid. Undefined with no scans. */
export function scansShown(s: Pick<TornoState, 'scans' | 'scanViews'>): SavedView['scans'] {
  if (s.scans.length === 0) return undefined
  return Object.fromEntries(
    s.scans.map(({ id }) => {
      const opacity = s.scanViews[id]?.opacity
      return [id, { visible: s.scanViews[id]?.visible !== false, ...(opacity !== undefined && opacity < 1 ? { opacity } : {}) }]
    })
  )
}

/**
 * The view on screen, as the person saves it under a name: the camera given, the layout shown, the parts of it
 * that are switched off, the section, or else how its parts are drawn apart when they are, and how each scan is
 * shown. What is on screen is what is saved, also where the agent's `show` has it otherwise than the person
 * chose: they save what they see.
 */
export function viewOnScreen(s: Shown, name: string, camera: Camera, at: string): SavedView {
  const explode = explodeShown(s.explode[s.layout], s.section, (s.scene?.parts ?? []).filter((part) => part.layout === s.layout))
  const scans = scansShown(s)
  return { name: cleanViewName(name), author: 'user', layout: s.layout, camera, hidden: hiddenIn(s, s.layout), ...(s.section ? { section: s.section } : explode ? { explode } : {}), ...(scans ? { scans } : {}), at }
}

/**
 * Whether the screen shows what a view holds, the camera aside: its layout, its hidden parts (of those the layout
 * still has), its section or none, its parts apart as it has them or together, and each of its scans that is
 * still there as it has it. An explode it holds that would draw nothing apart of the parts there are now counts as none.
 */
export function viewMatches(s: Shown, view: SavedView): boolean {
  if (s.layout !== view.layout) return false
  const parts = (s.scene?.parts ?? []).filter((part) => part.layout === view.layout)
  const hidden = new Set(hiddenIn(s, view.layout))
  const wanted = view.hidden.filter((name) => parts.some((part) => part.name === name))
  if (wanted.length !== hidden.size || wanted.some((name) => !hidden.has(name))) return false
  if (!samePlaneAs(s.section, view.section ?? null)) return false
  // An explode the view holds that can no longer be drawn is passed over when it is applied: its parts are together then.
  const apart = view.explode && nothingApart(view.explode, parts) === null ? view.explode : null
  if (!sameExplode(explodeShown(s.explode[s.layout], s.section, parts), apart)) return false
  return Object.entries(view.scans ?? {}).every(([id, has]) => {
    if (!s.scans.some((scan) => scan.id === id)) return true
    const shown = s.scanViews[id]
    return (shown?.visible !== false) === (has.visible !== false) && (shown?.opacity ?? 1) === (has.opacity ?? 1)
  })
}

function samePlaneAs(a: SectionPlane | null, b: SectionPlane | null): boolean {
  if (a === null || b === null) return a === b
  return a.origin.every((c, i) => c === b.origin[i]) && a.normal.every((c, i) => c === b.normal[i])
}

/**
 * Whether a camera is where a view has it, to within what a camera read back from the viewport is good for. A
 * camera may be given with any up that is not along its line of sight, and the viewport reads back the one square
 * to it: the two are the same camera when they have the same right-hand side.
 */
export function sameCamera(a: Camera, b: Camera): boolean {
  if (a.ortho !== b.ortho || Math.abs(a.fov - b.fov) > 1e-3) return false
  const reach = Math.max(1, Math.hypot(...a.position.map((c, i) => c - a.target[i])))
  const near = (p: readonly number[], q: readonly number[], within: number): boolean => p.every((c, i) => Math.abs(c - q[i]) <= within)
  return near(a.position, b.position, reach * 1e-4) && near(a.target, b.target, reach * 1e-4) && near(rightOf(a), rightOf(b), 1e-4) && Math.abs(a.zoom - b.zoom) <= Math.max(a.zoom, b.zoom) * 1e-4
}

/** The unit vector to the right of a camera: across its line of sight and its up. Zeros for a camera that has none. */
function rightOf(camera: Camera): [number, number, number] {
  const d = camera.target.map((c, i) => c - camera.position[i])
  const u = camera.up
  const r: [number, number, number] = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
  const length = Math.hypot(...r)
  return length > 0 ? [r[0] / length, r[1] / length, r[2] / length] : [0, 0, 0]
}
