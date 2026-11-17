import * as THREE from 'three'
import { type ExplodePart, type ExplodeState, EXPLODED_NOTE, NOT_EXPLODED_AND_CUT, SCANS_STAY, explodeShown, explodeText, isExploded, nothingApart, nothingApartText } from '../../shared/explode'
import type { Part } from '../../shared/scene'
import { number } from '../../shared/format'
import type { Camera, ScanColouring, SectionPlane, ViewName } from '../../shared/view'
import type { FocusBox } from '../../shared/focus'
import { hiddenBehind } from './focus'
import { MARK_LAYERS, type Highlights } from './highlight'
import type { MarkLayer } from './marks/MarkLayer'
import { PERSPECTIVE_NOTE, chipSize, drawDeviationLegend, drawLabels, drawOverlay, overlayFonts, overlayUnit, type LabelStyle } from './overlay'
import type { BuiltPart } from './partMesh'
import { deviationColours, storedColour, type Rgb } from './scanDeviation'
import { reaching, type ScanLayer, type ShownScan } from './scans'
import { describeSection } from './section'
import { focusCamera, visibleHeight } from './views'

/** What to draw for a picture: a view, a layout and the keys of the parts to show. `size` is the long edge in pixels. */
export interface ImageRequest {
  view: 'current' | ViewName | Camera
  layout: string
  visibleKeys: string[]
  size?: number
  /** Whether the marks of the layout are drawn, with their numbers. True when left out. */
  marks?: boolean
  /** What the parts are cut by: `'current'`, and when left out, the section on screen; null for none; or a plane of the picture's own. */
  section?: SectionPlane | 'current' | null
  /** The scans drawn with the parts: `'current'`, and when left out, those switched on on screen; false for none; or those of these ids. */
  scans?: 'current' | false | string[]
  /** One scan drawn in colours that say how far it is from a part of the layout, for this picture. It is drawn whether or not it is among `scans`. */
  scanColour?: ScanColouring
  /** What a named view is fitted to: the parts drawn (and when left out), or the scans drawn with them. */
  frame?: 'parts' | 'all'
  /** How far apart the parts are drawn: `'current'`, and when left out, as on screen when the layout is the one on screen (together otherwise); null together; or an explode of the picture's own. Never with a section. */
  explode?: ExplodeState | 'current' | null
  /** The saved view the picture is of, by its name: what its caption calls the view. */
  viewName?: string
  /** A place to frame the picture on: the camera looks the way `view` does and stands where it takes in the box and its margin. The parts are drawn together unless the picture says how far apart: the box is where they are built. */
  focus?: FocusBox
  /** The picture is for the person to keep, not for the agent: it may be as large as `MAX_PERSON_IMAGE`, and `cues` false leaves out the axis triad and the scale bar. Never set from a request of the agent's. */
  person?: { cues: boolean }
}

/** The view as a caption names it: a saved view by its name in quotes, a standard view by its own, `current` for the camera on screen, `custom` for a camera given. */
export function viewSaid(view: 'current' | ViewName | Camera | undefined, name?: string): string {
  if (name !== undefined) return `"${name}"`
  return view === undefined ? 'current' : typeof view === 'string' ? view : 'custom'
}

export interface Picture {
  png: Uint8Array
  width: number
  height: number
  caption: string
  /** The layout drawn, and the scans drawn in it, by id. */
  layout: string
  scans: string[]
  /** The parts are drawn apart in it, and its caption says so: nothing in it is where it is. */
  exploded: boolean
  /** Of a picture framed on a focus: the parts drawn that stand between the camera and the middle of the focus, nearest first. */
  hiddenBy?: string[]
}

/** Long edge of a picture for the agent, in pixels. */
const MAX_IMAGE = 2000
/** Long edge of a picture the person saves for themselves, in pixels: it is not for the agent, so the agent's cap does not hold. */
export const MAX_PERSON_IMAGE = 4000
const DEFAULT_IMAGE = 1280
const MIN_IMAGE = 64
/** Width to height of a picture of a named view, and of the viewport until its canvas has a size. */
export const NAMED_ASPECT = 4 / 3
/** How much larger the number of a mark is in a picture than on screen: a picture is read at a glance, and often scaled down first. */
const PICTURE_CHIP = 1.3

/** A part as a picture needs it: what it is, and whether it is drawn. */
export interface PicturePart {
  readonly part: Part
  readonly built: { readonly group: { visible: boolean } }
}

/** What a picture needs of the viewport it is of. */
export interface PictureHost {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly marks: Pick<MarkLayer, 'activeId' | 'setActive' | 'setLights' | 'show' | 'showDraft' | 'extend' | 'update' | 'labels' | 'split'>
  readonly highlights: Pick<Highlights, 'setVisible'>
  readonly scans: Pick<ScanLayer, 'showOnly' | 'shown' | 'box' | 'boxIn' | 'built' | 'colourFor'>
  /** The viewport has been disposed of. */
  closed(): boolean
  /** The layouts of the scene on show, and the one on screen. */
  layouts(): readonly string[]
  layout(): string
  /** Width to height of the canvas. */
  aspect(): number
  /** Every part built, of every layout. */
  parts(): Iterable<PicturePart>
  /** The camera as the person has it. */
  currentView(): Camera
  /** A standard view, orthographic, fitted to some parts (to a stand-in box for none), and to `also` with them when that is given. */
  namedView(name: ViewName, parts: Part[], aspect: number, also?: THREE.Box3 | null): Camera
  /** A camera of its own for a picture, with its frustum around `extent` and the key light aimed along it. */
  cameraFor(view: Camera, aspect: number, extent: THREE.Sphere): THREE.Camera
  /** The names of the parts of a layout that are not among those drawn. */
  hiddenParts(layout: string, drawn: ReadonlySet<string>): Set<string>
  /** Takes the gizmo out of what is drawn; returns what puts it back. */
  hideGizmo(): () => void
  /** The section on screen, or null. */
  section(): SectionPlane | null
  /** Cuts the parts by a plane laid across a layout's parts, or by none; `decor` says whether the plane itself is drawn. */
  cutBy(plane: SectionPlane | null, layout: string, decor: boolean): void
  /** Lays the grid under a layout's parts and returns a sphere around the parts and the grid. */
  layGround(layout: string): THREE.Sphere
  /** That sphere for the layout on screen, as last laid. */
  groundExtent(): THREE.Sphere
  /** Tints what a layout's pick marks are on. */
  tintPicks(layout: string): void
  /** Shows the marks as the screen has them. */
  showMarks(): void
  /** The colours of the labels, and a quieter ink for notes. */
  colours(): LabelStyle & { muted: string; axes?: readonly [string, string, string] }
  /** How the parts of the layout on screen are drawn apart, or null. */
  explode(): ExplodeState | null
  /** Draws that layout's parts apart so (together for null), at once; returns what puts the screen back. */
  explodeFor(explode: ExplodeState | null, layout: string): () => void
}

/** Said in the caption of a picture that would have been drawn exploded, but colours a scan by its distance to a part. */
export const COLOURED_TOGETHER = ' · the parts are drawn together: the scan is coloured by its distance to the part where it is'

/**
 * How far apart a picture draws its parts (null for together), and what its caption says of having drawn them
 * together all the same. As on screen unless it says how: of the layout on screen by the explode there
 * (`current`), of another layout together. What is drawn apart is `explodeShown`'s to say. A section is never
 * drawn exploded (the plane cuts the parts where they are): asked for both, the picture is refused; apart only
 * because the screen is, a cut the picture was asked for is drawn of the parts together. Asked to draw apart
 * what cannot be (one part, parts that share the centre they would go from), it is refused with why. And no
 * picture that colours a scan by its distance to a part is drawn apart: the part would not be where the
 * distances are of.
 */
export function pictureExplode(
  asked: ImageRequest['explode'],
  of: { layout: string; onScreen: string; current: ExplodeState | null; section: SectionPlane | null; /** The parts of the layout, drawn or not. */ parts: readonly ExplodePart[]; coloured: boolean }
): { explode: ExplodeState | null; said: string } {
  const own = asked !== undefined && asked !== 'current'
  const explode = own ? asked : of.layout === of.onScreen ? of.current : null
  if (!isExploded(explode)) return { explode: null, said: '' }
  if (own) {
    if (of.section) throw new Error(NOT_EXPLODED_AND_CUT)
    const why = nothingApart(explode, of.parts)
    if (why !== null) throw new Error(nothingApartText(why, of.layout))
  }
  const shown = explodeShown(explode, of.section, of.parts)
  return shown && of.coloured ? { explode: null, said: COLOURED_TOGETHER } : { explode: shown, said: '' }
}

/**
 * What a caption says of a picture, or of a screen, whose parts are drawn apart: how, and that nothing in it is
 * where it is (`EXPLODED_NOTE`); that the scans drawn with them have not moved; and which marks span parts drawn
 * apart from each other, whose dashed lines are as long as the parts are apart. '' when the parts are together.
 */
export function explodedNote(explode: ExplodeState | null, scans: boolean, split: readonly string[] = []): string {
  if (!isExploded(explode)) return ''
  const one = split.length === 1
  const spans = split.length === 0 ? '' : ` · ${split.join(', ')} ${one ? 'spans' : 'span'} parts drawn apart: ${one ? 'it is' : 'they are'} drawn dashed between them, as long as they are apart, which measures nothing`
  return ` · ${explodeText(explode)} (${EXPLODED_NOTE})${scans ? ` · ${SCANS_STAY}` : ''}${spans}`
}

/** The pixels of a picture whose long edge was asked to be `size`: within 64 and 2000, 1280 when not said; for the person to keep (`forPerson`), up to 4000. */
export function pictureSize(size: number | undefined, aspect: number, forPerson = false): { width: number; height: number } {
  const asked = typeof size === 'number' && Number.isFinite(size) ? size : DEFAULT_IMAGE
  const long = Math.round(Math.min(Math.max(asked, MIN_IMAGE), forPerson ? MAX_PERSON_IMAGE : MAX_IMAGE))
  const width = aspect >= 1 ? long : Math.max(1, Math.round(long * aspect))
  const height = aspect >= 1 ? Math.max(1, Math.round(long / aspect)) : long
  return { width, height }
}

/** What a picture draws: a layout, those of its parts to show, and whether its marks are in it. */
export interface PictureState {
  layout: string
  shown: readonly PicturePart[]
  withMarks: boolean
  /** The ids of the scans drawn with the parts, each where this layout puts it; null for none. */
  scans: string[] | null
  /** What the parts and the scans are cut by, or null. The plane itself is not drawn. */
  section: SectionPlane | null
  /** The names of the layout's parts the picture leaves out: a mark on one is left out with it. */
  notDrawn: ReadonlySet<string>
  width: number
  height: number
  /** A scan drawn in colours of the picture's own, worked out once the scan stands where the picture's layout puts it. */
  colour?: { scan: string; colours(): Uint16Array; of: { far: readonly number[]; inside: readonly number[] | null } }
}

/**
 * Has the scene be what a picture is of while `draw` runs, and what the screen
 * shows again after it, whether or not `draw` throws. `draw` is given a sphere
 * around all that is drawn, and leaves the renderer on any target it likes.
 * Nothing in here waits: no frame on screen sees the scene in between.
 *
 * A picture is of the parts, the scans and the marks: not of what the person points at,
 * of what they hold a shape by, of which mark they are working on, of what
 * is not a mark yet, or of the plane they cut by (the cut itself is in it).
 */
export function asPictured<T>(host: PictureHost, state: PictureState, draw: (extent: THREE.Sphere) => T): T {
  const otherLayout = state.layout !== host.layout()
  const parts = [...host.parts()]
  const before = new Map(parts.map((p) => [p, p.built.group.visible]))
  host.highlights.setVisible(false)
  const showGizmo = host.hideGizmo()
  const active = host.marks.activeId
  const cut = host.section()
  // Fat lines take their width in pixels from the renderer's viewport, which is the
  // canvas's whatever is being drawn to: for the picture it is the picture's size.
  const onScreen = host.renderer.getViewport(new THREE.Vector4())
  let scansBack = (): void => {}
  try {
    host.renderer.setViewport(0, 0, state.width, state.height)
    for (const p of parts) p.built.group.visible = false
    for (const p of state.shown) p.built.group.visible = true
    scansBack = host.scans.showOnly(state.scans, state.layout, state.withMarks)
    host.cutBy(state.section, state.layout, false)
    // Once the scan stands and is cut as the picture has it: its colours are of where it stands.
    if (state.colour) host.scans.colourFor(state.colour.scan, state.colour.colours(), state.colour.of)
    let extent = otherLayout ? host.layGround(state.layout) : host.groundExtent()
    // A scan may stand far from the parts: the camera reaches what is drawn of it.
    const around = host.scans.box()
    if (around) extent = reaching(extent.clone(), around, extent)
    host.marks.setActive(null)
    host.marks.setLights(false)
    host.marks.show(state.withMarks ? state.layout : null, state.notDrawn)
    host.marks.showDraft(false)
    if (state.withMarks) {
      extent = host.marks.extend(extent.clone(), state.layout)
      host.highlights.setVisible(true, MARK_LAYERS)
      // Of the marks the picture draws: other parts may be switched on in it than on screen.
      host.tintPicks(state.layout)
    }
    return draw(extent)
  } finally {
    host.renderer.setViewport(onScreen)
    host.renderer.setRenderTarget(null)
    for (const [p, visible] of before) p.built.group.visible = visible
    if (state.colour) host.scans.colourFor(state.colour.scan, null)
    scansBack()
    host.cutBy(cut, host.layout(), true)
    showGizmo()
    host.highlights.setVisible(true)
    host.marks.setActive(active)
    host.marks.setLights(true)
    host.showMarks() // sized for the screen again by the next frame drawn
    host.marks.showDraft(true)
    if (otherLayout) host.layGround(host.layout())
    if (state.withMarks) host.tintPicks(host.layout())
  }
}

/**
 * The scans a picture has, as its caption says them: ` · scans S1 at 60 %, S2`, how thin only of one that is; nothing
 * for none. A scan that is not aligned in the picture's layout is not where the model is, and one whose alignment the
 * last build put in doubt may not be, nor one that is only rough, and one laid on its floor alone or placed by hand
 * is no fit: whoever reads the picture is told what each alignment rests on and what is in doubt of it, with the scan's name.
 * So is a scan the far plane cuts (`clipped`).
 */
export function scansNote(drawn: ReadonlyArray<Pick<ShownScan, 'id' | 'opacity' | 'aligned' | 'stale'> & Partial<Pick<ShownScan, 'rough' | 'basis' | 'note' | 'waiting' | 'clipped'>>>, layout: string): string {
  if (drawn.length === 0) return ''
  const said = drawn.map((scan) => {
    const thin = scan.opacity < 1 ? ` at ${Math.round(scan.opacity * 100)} %` : ''
    // The far plane cuts it (`beyondReach`): what the picture shows of it is not all there is.
    const cut = scan.clipped ? ['reaches beyond the view: not all of it is drawn'] : []
    if (!scan.aligned) return `${scan.id}${thin} (${[`not aligned in ${layout}: drawn where it was imported`, ...cut].join('; ')})`
    // What it rests on first; then what puts it in doubt, what is doubtful of its fit, and what else is to be known.
    const told = [
      ...(scan.basis ? [scan.basis] : []),
      ...(scan.stale ? [scan.waiting ? scan.stale : `its alignment in ${layout} may no longer hold: ${scan.stale}`] : []),
      ...(scan.rough ? [scan.stale ? `it is rough: ${scan.rough}` : `aligned roughly in ${layout}: ${scan.rough}`] : []),
      ...(scan.note ? [scan.note] : []),
      ...cut
    ]
    return `${scan.id}${thin}${told.length > 0 ? ` (${told.join('; ')})` : ''}`
  })
  return ` · scans ${said.join(', ')}`
}

/** Whether some of a box is outside what a camera draws: a corner of it is past an edge of the picture. */
export function reachesBeyond(camera: THREE.Camera, box: THREE.Box3): boolean {
  camera.updateMatrixWorld()
  const corner = new THREE.Vector3()
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corner.set(x, y, z).project(camera)
        if (!(Math.abs(corner.x) <= 1 + 1e-6 && Math.abs(corner.y) <= 1 + 1e-6) || corner.z > 1) return true
      }
    }
  }
  return false
}

/** What a caption says of the scans drawn that reach beyond the picture, and, of a named view fitted to the parts, what takes them in. '' for none. */
export function beyondNote(ids: readonly string[], fitted: boolean): string {
  if (ids.length === 0) return ''
  return ` · ${ids.join(', ')} ${ids.length === 1 ? 'reaches' : 'reach'} beyond the picture${fitted ? ', which is fitted to the parts: frame "all" takes the scans in' : ''}`
}

/** The colours a scan is drawn in by its distance to a part, as the stylesheet says them: `--deviation-near`, `--deviation-far`, `--deviation-inside`. */
export interface DeviationColours { near: string; far: string; inside: string }
/** Those of the light theme (styles/tokens.css), for where there is no stylesheet to read. */
const DEVIATION_LIGHT: DeviationColours = { near: '#8A4594', far: '#D3D8DF', inside: '#22252A' }

function deviationTokens(): DeviationColours {
  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const read = (name: string, fallback: string): string => `#${new THREE.Color(css?.getPropertyValue(name).trim() || fallback).getHexString().toUpperCase()}`
  return { near: read('--deviation-near', DEVIATION_LIGHT.near), far: read('--deviation-far', DEVIATION_LIGHT.far), inside: read('--deviation-inside', DEVIATION_LIGHT.inside) }
}

/** `#8A4594` as three shares of sRGB. */
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as Rgb

/**
 * What a picture's caption says of the scan it drew by distance: which, to which part, over what range, and the
 * very colours: whoever reads the picture reads distances off them, about. The colours are of the scan's own
 * points and are shaded like the rest of it, so a pixel is darker than its swatch where the surface turns from
 * the light, and between two points it is a blend. Beyond the range the scan is drawn seen through, so that the
 * part stays in sight; what is inside the part is drawn over it. Of a part that is no solid nothing is inside.
 */
export function colouringNote(colouring: ScanColouring, colours: DeviationColours, solid: boolean): string {
  const range = number(colouring.range)
  const key = `0 mm ${colours.near}, ${range} mm and beyond ${colours.far}`
  const how = `the colours are of the scan's points, shaded, and approximate; beyond ${range} mm the scan is seen through`
  return ` · scan ${colouring.scan} coloured by the distance of its points to ${colouring.part}: 0 to ${range} mm${solid ? `, inside the part marked and drawn over it (${key}, inside the part ${colours.inside}; ${how})` : ` (${key}; ${how}; ${colouring.part} is no solid, so nothing is marked as inside it)`}`
}

/**
 * Still pictures of a viewport for the agent, each with an axis triad and a
 * scale bar. One is drawn off screen in one go: the person's camera, the layout
 * and the frame on screen are left alone, and it works while the window is hidden.
 */
export class PictureMaker {
  private targets: { width: number; height: number; drawn: THREE.WebGLRenderTarget; encoded: THREE.WebGLRenderTarget } | null = null
  private readonly encoder = new Encoder()

  constructor(private readonly host: PictureHost) {}

  /** See `Viewport.renderImage`. */
  async render(request: ImageRequest | (() => ImageRequest)): Promise<Picture> {
    const host = this.host
    // Before anything is drawn: nothing below may wait between hiding parts and restoring them.
    await overlayFonts()
    if (host.closed()) throw new Error('The viewport is closed')
    if (host.renderer.getContext().isContextLost()) throw new Error('The 3D view has lost its graphics context; try again in a moment')
    const req = typeof request === 'function' ? request() : request
    const layouts = host.layouts()
    if (!layouts.includes(req.layout)) {
      const known = layouts.length > 0 ? `the layouts are ${layouts.join(', ')}` : 'nothing has been built yet'
      throw new Error(`No layout "${req.layout}": ${known}`)
    }
    const aspect = req.view === 'current' ? host.aspect() : NAMED_ASPECT
    const { width, height } = pictureSize(req.size, aspect, req.person !== undefined)

    const wanted = new Set(req.visibleKeys)
    const shown = [...host.parts()].filter((p) => p.part.layout === req.layout && wanted.has(p.part.key))

    // Those switched on on screen, unless the picture names its own or wants none.
    const chosen = req.scans === false ? null : Array.isArray(req.scans) ? req.scans : host.scans.shown().filter((scan) => scan.visible).map((scan) => scan.id)
    // A scan coloured by its distance to a part is drawn, whatever else is: it is what the picture was asked for.
    const colouring = req.scanColour
    const scans = colouring ? [...new Set([...(chosen ?? []), colouring.scan])] : chosen
    // Where the scans drawn stand in the picture's layout: what a view is fitted to when it is asked to take them in, and what is said to reach beyond the picture.
    const scanBoxes = (scans ?? []).map((id) => ({ id, box: host.scans.boxIn([id], req.layout) })).filter((one): one is { id: string; box: THREE.Box3 } => one.box !== null)
    const everything = req.frame === 'all' && scanBoxes.length > 0 ? scanBoxes.reduce((all, one) => all.union(one.box), new THREE.Box3()) : null

    const section = req.section === undefined || req.section === 'current' ? host.section() : req.section
    // A focus is a place of the parts as built: drawn apart, they would not be there. Together unless the picture says otherwise.
    const apart = req.focus && (req.explode === undefined || req.explode === 'current') ? null : req.explode
    const { explode, said: together } = pictureExplode(apart, { layout: req.layout, onScreen: host.layout(), current: host.explode(), section, parts: [...host.parts()].filter((p) => p.part.layout === req.layout).map((p) => p.part), coloured: colouring !== undefined })
    // From here on the parts are where the picture draws them, until `together` puts the screen back: nothing
    // in between waits, so no frame on screen sees it.
    const back = host.explodeFor(explode, req.layout)
    try {
      return this.drawn(req, { aspect, width, height, shown, scans, scanBoxes, everything, section, explode, together })
    } finally {
      back()
    }
  }

  /** The picture itself, with the parts already drawn apart as it has them. Everything up to the encoding of the PNG is synchronous. */
  private drawn(
    req: ImageRequest,
    of: { aspect: number; width: number; height: number; shown: PicturePart[]; scans: string[] | null; scanBoxes: Array<{ id: string; box: THREE.Box3 }>; everything: THREE.Box3 | null; section: SectionPlane | null; explode: ExplodeState | null; /** What the caption says of having drawn the parts together all the same. */ together: string }
  ): Promise<Picture> {
    const host = this.host
    const { aspect, width, height, shown, scans, scanBoxes, everything, section, explode, together } = of
    const wanted = new Set(req.visibleKeys)
    const colouring = req.scanColour
    let view: Camera
    if (req.focus) view = focusCamera(req.focus, req.view, host.currentView(), aspect)
    else if (req.view === 'current') view = host.currentView()
    else if (typeof req.view === 'string') view = host.namedView(req.view, shown.map((p) => p.part), aspect, everything)
    else view = req.view
    const viewName = viewSaid(req.view, req.viewName)

    const withMarks = req.marks !== false
    const tokens = deviationTokens()
    let colour: PictureState['colour']
    let solid = false
    if (colouring) {
      // The part it is measured to need not be among those drawn: it is of the layout.
      const against = [...host.parts()].find((p) => p.part.layout === req.layout && p.part.name === colouring.part)?.built as Pick<BuiltPart, 'group' | 'mesh' | 'solid'> | undefined
      if (!against?.mesh) throw new Error(`unknown part '${colouring.part}' in layout ${req.layout}`)
      solid = against.solid
      const { scan, range } = colouring
      colour = {
        scan,
        of: { far: storedColour(rgbOf(tokens.far)), inside: solid ? storedColour(rgbOf(tokens.inside)) : null },
        colours: () => {
          const built = host.scans.built(scan)
          if (!built) throw new Error(`${scan}'s mesh has not come to the window yet: look again in a moment`)
          return deviationColours(built, against, range, { near: rgbOf(tokens.near), far: rgbOf(tokens.far), inside: rgbOf(tokens.inside) })
        }
      }
    }
    // A mark on a part the picture leaves out is left out with it.
    const notDrawn = host.hiddenParts(req.layout, wanted)
    const unit = overlayUnit(width, height)

    // Everything from here to the end of `asPictured` is synchronous, so no frame on screen sees it.
    const { camera, pixels, drawn } = asPictured(host, { layout: req.layout, shown, withMarks, scans, section, notDrawn, width, height, ...(colour ? { colour } : {}) }, (extent) => {
      const camera = host.cameraFor(view, aspect, extent)
      // In the picture's own pixels: a dot is as large a share of a big picture as of a small one.
      host.marks.update(camera, { width, height }, unit)

      const targets = this.targetsFor(width, height)
      host.renderer.setRenderTarget(targets.drawn)
      host.renderer.render(host.scene, camera)
      const pixels = pixelsOf(host.renderer, this.encoder, targets.drawn, targets.encoded)
      // What was drawn of the scans: one whose mesh has not come is not in the picture, and is not said to be.
      // The scan drawn by its distance is drawn solid, in colours that are read: not as thin as it is on screen.
      return { camera, pixels, drawn: host.scans.shown(extent).filter((scan) => scan.visible).map((scan) => (scan.id === colouring?.scan ? { ...scan, opacity: 1 } : scan)) }
    })

    const picture = pictureCanvas(width, height)
    const ctx = picture.getContext('2d')
    if (!ctx) throw new Error('Could not get a 2D canvas to compose the picture')
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0)
    camera.updateMatrixWorld()
    const m = camera.matrixWorld.elements
    const colours = host.colours()
    if (req.person?.cues !== false) drawOverlay(ctx, {
      width,
      height,
      right: [m[0], m[1], m[2]],
      up: [m[4], m[5], m[6]],
      mmPerPx: view.ortho ? visibleHeight(view) / height : null,
      ink: colours.ink,
      muted: colours.muted,
      surface: colours.surface,
      ...(colours.axes ? { axes: colours.axes } : {})
    })
    if (colouring) drawDeviationLegend(ctx, { width, height, ink: colours.ink, surface: colours.surface }, { ...tokens, inside: solid ? tokens.inside : null, range: colouring.range, title: `${colouring.scan} to ${colouring.part}` })
    if (withMarks) {
      // With the camera of the picture, which for a named view is not the one on screen.
      // A region's number goes with its scan: not in a picture that does not draw that scan.
      const left = new Set([...notDrawn, ...host.scans.shown().filter((scan) => !drawn.some((one) => one.id === scan.id)).map((scan) => `scan:${scan.id}`)])
      const labels = host.marks.labels(req.layout, camera, { width, height }, unit, chipSize(ctx, unit * PICTURE_CHIP), left)
      drawLabels(ctx, labels, colours, unit * PICTURE_CHIP)
    }
    // Read now, while the parts are as the picture has them: the marks that span parts it draws apart.
    const split = withMarks ? host.marks.split(req.layout, notDrawn) : []

    // Whatever the picture was framed on, and what stands in front of it: read with the parts where the picture has them.
    const hiddenBy = req.focus ? hiddenBehind(shown.map((p) => ({ name: p.part.name, mesh: (p.built as Partial<Pick<BuiltPart, 'mesh'>>).mesh })), view, req.focus, section) : undefined
    const names = shown.map((p) => p.part.name).join(', ') || 'none'
    const projection = view.ortho ? 'orthographic' : PERSPECTIVE_NOTE
    const cutNote = section ? ` · ${describeSection(section)}` : ''
    // A scan is the surroundings: a view fitted to the parts shows a corner of it. That is said, with what takes all of it in.
    const beyond = scanBoxes.filter((one) => drawn.some((scan) => scan.id === one.id) && reachesBeyond(camera, one.box)).map((one) => one.id)
    const caption = `view ${viewName} · layout ${req.layout} · parts ${names}${scansNote(drawn, req.layout)}${beyondNote(beyond, !req.focus && typeof req.view === 'string' && req.view !== 'current' && req.frame !== 'all')}${colouring ? colouringNote(colouring, tokens, solid) : ''}${cutNote}${explodedNote(explode, drawn.length > 0, split)}${together}${req.focus ? ' · framed on the focus' : ''} · ${projection} · ${width}×${height}`
    const layout = req.layout
    const encoded = async (): Promise<Picture> => {
      return { png: pngBytes(picture), width, height, caption, layout, scans: drawn.map((scan) => scan.id), exploded: explode !== null, ...(hiddenBy ? { hiddenBy } : {}) }
    }
    return encoded()
  }

  dispose(): void {
    this.targets?.drawn.dispose()
    this.targets?.encoded.dispose()
    this.encoder.dispose()
  }

  private targetsFor(width: number, height: number): NonNullable<PictureMaker['targets']> {
    const have = this.targets
    if (have && have.width === width && have.height === height) return have
    have?.drawn.dispose()
    have?.encoded.dispose()
    this.targets = {
      width,
      height,
      // Linear light, so half floats: eight bits would band in the shadows.
      // With a stencil: the cut faces of a section are counted in it.
      drawn: new THREE.WebGLRenderTarget(width, height, { samples: 4, type: THREE.HalfFloatType, stencilBuffer: true }),
      encoded: new THREE.WebGLRenderTarget(width, height, { depthBuffer: false })
    }
    return this.targets
  }
}

/**
 * Turns a render target's picture into what the screen would show. three.js
 * writes linear light into a render target and applies the output colour space
 * only when drawing to the canvas; read back as it is, the picture comes out
 * dark. This pass applies the sRGB curve (the renderer uses sRGB output and no
 * tone mapping) and flips the rows, since a read-back starts at the bottom row.
 */
export class Encoder {
  private readonly material = new THREE.ShaderMaterial({
    uniforms: { map: { value: null as THREE.Texture | null }, clear: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = vec2(uv.x, 1.0 - uv.y);
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float clear;
      varying vec2 vUv;
      void main() {
        vec4 drawn = texture2D(map, vUv);
        // On a clear ground a pixel holds its colour times how much of it is covered: the colour itself is encoded, and the cover kept beside it.
        vec3 colour = clear > 0.5 && drawn.a > 0.0 ? drawn.rgb / drawn.a : drawn.rgb;
        gl_FragColor = vec4(sRGBTransferOETF(vec4(colour, 1.0)).rgb, clear > 0.5 ? drawn.a : 1.0);
      }`,
    depthTest: false,
    depthWrite: false
  })
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
  private readonly camera = new THREE.Camera()

  constructor() {
    this.quad.frustumCulled = false
  }

  /** Leaves `to` as the renderer's current target. `alpha` keeps how much of each pixel was drawn on, for a picture on a clear ground; without it every pixel is opaque. */
  render(renderer: THREE.WebGLRenderer, from: THREE.Texture, to: THREE.WebGLRenderTarget, alpha = false): void {
    this.material.uniforms.clear.value = alpha ? 1 : 0
    this.material.uniforms.map.value = from
    renderer.setRenderTarget(to)
    renderer.render(this.quad, this.camera)
    this.material.uniforms.map.value = null
  }

  dispose(): void {
    this.quad.geometry.dispose()
    this.material.dispose()
  }
}

/**
 * A drawn target as the pixels of a picture, top row first: through the encoder (sRGB, rows the right way up)
 * and read back. With `alpha`, each pixel keeps how much of it was drawn on, and its colour is not multiplied
 * by that. Leaves `encoded` as the renderer's current target.
 */
export function pixelsOf(renderer: THREE.WebGLRenderer, encoder: Encoder, drawn: THREE.WebGLRenderTarget, encoded: THREE.WebGLRenderTarget, opts: { alpha?: boolean } = {}): Uint8ClampedArray<ArrayBuffer> {
  encoder.render(renderer, drawn.texture, encoded, opts.alpha === true)
  const pixels = new Uint8ClampedArray(encoded.width * encoded.height * 4)
  renderer.readRenderTargetPixels(encoded, 0, 0, encoded.width, encoded.height, pixels)
  return pixels
}

/** A canvas to compose a picture on, off the page: one whose PNG can be written at once (`pngBytes`). */
export function pictureCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * A canvas as PNG bytes, encoded now. Not `convertToBlob`: that has the PNG written in the window's idle
 * time, and a window that has a frame pending which it is not given (one nobody is looking at) has no idle
 * time, so every picture waited a second for Chromium to give up waiting for it.
 */
export function pngBytes(canvas: HTMLCanvasElement): Uint8Array {
  const url = canvas.toDataURL('image/png')
  const text = atob(url.slice(url.indexOf(',') + 1))
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

/** A drawn target as PNG bytes: `pixelsOf`, written through a canvas. `alpha` keeps the alpha the target has. */
export async function pngOf(renderer: THREE.WebGLRenderer, encoder: Encoder, drawn: THREE.WebGLRenderTarget, encoded: THREE.WebGLRenderTarget, opts: { alpha?: boolean } = {}): Promise<Uint8Array> {
  const pixels = pixelsOf(renderer, encoder, drawn, encoded, opts)
  const picture = pictureCanvas(encoded.width, encoded.height)
  const ctx = picture.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D canvas to compose the picture')
  ctx.putImageData(new ImageData(pixels, encoded.width, encoded.height), 0, 0)
  return pngBytes(picture)
}
