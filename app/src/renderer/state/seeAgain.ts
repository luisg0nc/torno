import { NOT_EXPLODED_AND_CUT, type ExplodeState, explodeArg, explodeShown, isExploded, nothingApart, nothingApartText } from '../../shared/explode'
import { partsNamed } from '../../shared/groups'
import { MIN_SCAN_OPACITY } from '../../shared/scans'
import { type Camera, type SectionPlane, type ViewName, NOT_A_PLANE, planeOf } from '../../shared/view'
import { type SavedView, findView } from '../../shared/views'
import { DEFAULT_FOV } from '../viewport/views'
import { hiddenIn, viewOnScreen } from './savedViews'
import type { TornoState } from './store'

// What the person goes to when they press "See in view" on a card of the agent's `look`, `section` or `show`: the
// card's input, read once more against the window as it is now, as the tools read it. Pure: it changes nothing and
// answers the saved view to apply (`actions.applyLook`) and where the camera goes, or why not, in the words of the
// tools where they have them.

/** The tools of the agent that put a view on a screen or in a picture. */
export type SeeTool = 'look' | 'section' | 'show'

/** What "See in view" does for a tool of the agent's, or null for one that has none. */
export function seeToolOf(name: string): SeeTool | null {
  return name === 'mcp__torno__look' ? 'look' : name === 'mcp__torno__section' ? 'section' : name === 'mcp__torno__show' ? 'show' : null
}

/** The view to apply, and where the camera goes once it is applied: a standard view (fitted to what is drawn), a camera, or nowhere (it stays). */
export interface Replay {
  view: SavedView
  camera: ViewName | Camera | null
}

const STANDARD: readonly string[] = ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom']
/** Said when a card was framed on a focus: that is worked out against the kernel, in main. */
export const NO_FOCUS_AGAIN = 'That look was framed on a place, which the window cannot frame again. Ask the agent to show it.'
/** Said when a card's picture was tiled of several views: there is no one view to put on screen. */
export const MANY_VIEWS = 'That look drew several views in one picture, so there is no one view to go to. Ask the agent to show one.'
const NO_EXPLODE = 'explode is a number from 0 to 1, or {"amount": 0.5, "axis": "z", "scale": 2}'

const isVec = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every((c) => typeof c === 'number' && Number.isFinite(c))

/** A camera as the agent gave one, made as `cameraOf` makes it in main; null for one that looks nowhere or is none. */
function cameraOfArg(value: unknown): Camera | null {
  const said = value as { position?: unknown; target?: unknown; up?: unknown; ortho?: unknown; fov?: unknown; zoom?: unknown } | null
  if (typeof said !== 'object' || said === null || !isVec(said.position) || !isVec(said.target)) return null
  const position = said.position
  const along = said.target.map((c, i) => c - position[i])
  if (along.every((d) => d === 0)) return null
  const vertical = along[0] === 0 && along[1] === 0
  return {
    position,
    target: said.target,
    up: isVec(said.up) ? said.up : vertical ? [0, 1, 0] : [0, 0, 1],
    ortho: said.ortho === true,
    fov: typeof said.fov === 'number' ? said.fov : DEFAULT_FOV,
    zoom: typeof said.zoom === 'number' ? said.zoom : 1
  }
}

/**
 * The input of a tool's card as a view of the window as it is now. What the input leaves out is as on screen
 * (`look`'s `current`); a saved view it names is that view, but for what is given beside it; a cut given leaves the
 * parts together, and parts asked apart are refused under a cut.
 */
export function replayOf(tool: SeeTool, input: unknown, s: TornoState, current: Camera, at = new Date().toISOString()): Replay | string {
  const scene = s.scene
  if (!scene) return 'There is no build yet'
  const given = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  if (given.views !== undefined) return MANY_VIEWS
  if (given.focus !== undefined) return NO_FOCUS_AGAIN

  // The view: the camera it names, and the saved view it is of, if it is one.
  const named = tool === 'section' ? undefined : given.view
  let saved: SavedView | undefined
  let camera: Replay['camera'] = null
  if (typeof named === 'string' && named !== 'current') {
    if (STANDARD.includes(named)) camera = named as ViewName
    else {
      saved = findView(s.views, named)
      if (!saved) return `no view "${named}": ${s.views.length > 0 ? `the saved views are ${s.views.map((one) => `"${one.name}"`).join(', ')}` : 'there are no saved views'}`
      camera = saved.camera
    }
  } else if (named !== undefined && named !== 'current') {
    camera = cameraOfArg(named)
    if (!camera) return 'position and target are the same, or are not as [x, y, z]'
  }

  const layout = typeof given.layout === 'string' ? given.layout : (saved?.layout ?? s.layout)
  if (!scene.layouts.includes(layout)) return `no layout '${layout}'; layouts: ${scene.layouts.join(', ')}`
  const parts = scene.parts.filter((part) => part.layout === layout)

  let hidden = saved ? saved.hidden : hiddenIn(s, layout)
  if (given.parts !== undefined) {
    if (!Array.isArray(given.parts) || given.parts.length === 0 || !given.parts.every((name) => typeof name === 'string')) return 'parts is empty: name the parts to leave switched on'
    const shown = partsNamed(scene, layout, given.parts as string[])
    if (!Array.isArray(shown)) return shown.text
    hidden = parts.map((part) => part.name).filter((name) => !shown.includes(name))
  }

  // The cut: the plane given, none for null, else the one the base has.
  const base = saved ?? viewOnScreen(s, '', current, at)
  let section: SectionPlane | null = base.section ?? null
  const cut = tool === 'section' ? given.plane : given.section
  const cutGiven = cut !== undefined && cut !== 'current'
  if (cut === null) section = null
  else if (cutGiven) {
    section = planeOf(cut)
    if (!section) return NOT_A_PLANE
  }

  // How far apart: as given, else as the base has it for this layout. Never with a cut.
  const kept = saved ? (saved.explode ?? null) : explodeShown(s.explode[layout], section, parts)
  let explode: ExplodeState | null = kept
  const apart = tool === 'section' ? undefined : given.explode
  if (apart === null) explode = null
  else if (apart !== undefined && apart !== 'current') {
    const asked = explodeArg(apart)
    if (!asked) return NO_EXPLODE
    explode = isExploded(asked) ? asked : null
    if (explode) {
      if (section) return NOT_EXPLODED_AND_CUT
      const nothing = nothingApart(explode, parts)
      if (nothing !== null) return nothingApartText(nothing, layout)
    }
  } else if (section) explode = null
  if (cutGiven) explode = apart !== undefined && apart !== null && apart !== 'current' ? explode : null

  // The scans: those named are on and the others off; none for false; opacity of those left on (`show`).
  let scans = base.scans
  const wanted = tool === 'section' ? undefined : given.scans
  const thin = tool === 'show' ? given.scanOpacity : undefined
  if (thin !== undefined && !(typeof thin === 'number' && thin >= MIN_SCAN_OPACITY && thin <= 1)) return `scanOpacity is a number from ${MIN_SCAN_OPACITY} to 1`
  if (wanted === false || Array.isArray(wanted) || thin !== undefined) {
    const ids = Array.isArray(wanted) ? wanted.filter((id): id is string => typeof id === 'string') : undefined
    for (const id of ids ?? []) if (!s.scans.some((scan) => scan.id === id)) return `no scan ${id}; scans: ${s.scans.map((scan) => scan.id).join(', ') || 'none'}`
    scans = {}
    for (const { id } of s.scans) {
      const was = base.scans?.[id]
      const on = ids ? ids.includes(id) : wanted === false ? false : was?.visible !== false
      const opacity = typeof thin === 'number' && on ? thin : was?.opacity
      scans[id] = { visible: on, ...(opacity !== undefined && opacity < 1 ? { opacity } : {}) }
    }
  }

  const view: SavedView = {
    name: '',
    author: 'user',
    layout,
    camera: typeof camera === 'object' && camera !== null ? camera : current,
    hidden,
    ...(section ? { section } : explode ? { explode } : {}),
    ...(scans ? { scans } : {}),
    at
  }
  return { view, camera }
}
