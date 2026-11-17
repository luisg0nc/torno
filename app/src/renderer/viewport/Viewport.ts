import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { type ExplodeState, cameraBack, isExploded, sameExplode } from '../../shared/explode'
import type { Mark, Quat } from '../../shared/marks'
import type { Part, Scene } from '../../shared/scene'
import type { ScanInfo, ScanTransform, ScanView } from '../../shared/scans'
import type { Camera, SectionPlane, ViewName } from '../../shared/view'
import type { AlignPoint } from './alignPoints'
import type { BrushRing } from './brushRing'
import { CameraMove, pivotOn, standingAt } from './cameraMoves'
import { PartsApart, asBuilt, drawnAt, drawnBox, reachingApart, leavesView } from './explode'
import { groundOf } from './ground'
import { Highlights, MARK_LAYERS, type HighlightLayer } from './highlight'
import { mmPerPx, needsCamera } from './marks/labels'
import { MarkLayer, type Draft } from './marks/MarkLayer'
import { overlayFonts, type LabelStyle } from './overlay'
import { OverlayPass } from './overlayPass'
import { partChanged } from '../../shared/diff'
import type { CompareMode } from '../state/compare'
import { Earlier } from './earlier'
import { Ghosts, type GhostItem } from './ghosts'
import { STALE_FADE, colorFor, colorsOfParts, edgeTint, mix } from '../../shared/palette'
import { aimKeyLight, makeLights } from './lights'
import { selectionBox } from './selectionBox'
import { buildPart, type BuiltPart, disposePart } from './partMesh'
import { type Hit, pickUnder, pointerRay } from './picking'
import { NAMED_ASPECT, PictureMaker, type ImageRequest, type Picture } from './picture'
import { ThumbnailMaker, type ThumbnailView } from './thumbnail'
import { PointerRouter, type ViewportPointer } from './pointer'
import { ScanEdit } from './scanEdit'
import { ScanLayer, rayOf, reaching, type ScanHit, type ScanLayerState } from './scans'
import { SectionCut, nearSegmentOnScreen, segmentOnScreen } from './section'
import { ShapeGizmo, type GizmoMode, type ShapeTransform } from './ShapeGizmo'
import { type Theme, LIGHT_THEME, XRAY_OPACITY, markColours, themeOf, toHex } from './theme'
import type { MainAxis } from '../../shared/planes'
import { type SketchHint, type SketchOverlay } from './sketchHint'
import { HANDLE_REACH_PX, SketchSheet } from './sketchPlane'
import { type PlaneDraft } from '../tools/sketch/planes'
import { SnapIndex, type SnapPart } from '../tools/sketch/snap'
import { faceAt } from './viewCube'
import { DEFAULT_FOV, fitBelow, fitCamera, lockedViewOf, viewDirection } from './views'

export interface LayerState {
  visible?: boolean
  color?: string
  opacity?: number
}

interface Entry {
  part: Part
  built: BuiltPart
}

export type { GizmoMode, ImageRequest, Picture, ShapeTransform, ViewportPointer }

type AnyCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera

type Vec3 = [number, number, number]

const SETTLE_MS = 150
/** How near the handle of the section's plane the pointer must be to take hold of it, in pixels. */
export const SECTION_HANDLE_REACH_PX = 12
/** How far behind the surface a point may be and still be taken as on it, when it is asked whether it can be seen, in millimetres. */
const SNAP_BEHIND_MM = 0.3
/** What `fit` and the named views frame when no part is shown. */
const EMPTY_BOX = { min: [-50, -50, 0], max: [50, 50, 50] }

/**
 * The three.js viewport: parts, ground, camera and pictures for the agent.
 * Imperative on purpose, so no per-frame state passes through React. Z is up,
 * units are millimetres. It draws only when something changed.
 */
export class Viewport {
  readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly perspective = new THREE.PerspectiveCamera(DEFAULT_FOV, NAMED_ASPECT, 0.1, 1000)
  private readonly orthographic = new THREE.OrthographicCamera()
  private camera: AnyCamera = this.perspective
  private readonly controls: OrbitControls
  /** Where the last press on the canvas was, and with which button. */
  private lastDown: { x: number; y: number; button: number } | null = null
  /** The selection `fit` last framed, until the camera is moved or something else is framed. */
  private fittedSelection: string | null = null
  /** The press of a turn that has not begun to turn yet: the target moves onto what is under it at the first move. */
  private pivotPending: { x: number; y: number } | null = null
  private readonly lights = makeLights()
  private readonly keyLight = this.lights.key
  private readonly ground = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial())

  private readonly entries = new Map<string, Entry>()
  private readonly layers = new Map<string, LayerState>()
  private colors = new Map<string, string>()
  private layouts: string[] = []
  private layout = ''
  private stale = false
  /** The old edges and the new of the parts the last build changed, for a moment (`ghosts.ts`). */
  private readonly ghosts = new Ghosts(() => this.invalidate())
  /** An earlier build drawn over the current one, for display only, until it is cleared (`earlier.ts`). */
  private readonly earlier = new Earlier()
  /** The build compared with it, standing in for the live one while it is not that build (`setLater`): drawn opaque, in its own colours, the live parts left out of the frame but kept. */
  private readonly later = new Earlier('later')
  /** How the earlier build is shown against the live one (Compare); null when none is compared. */
  private compareMode: CompareMode | null = null
  /** False until a scene with parts has been framed; after that the camera is the user's. */
  private framed = false
  /** Everything drawn in the current layout, for the clip planes: the parts and the grid (`groundExtent`), and the marks. */
  private extent = new THREE.Sphere(new THREE.Vector3(), 100)
  private groundExtent = this.extent
  /** The step of the grid on the ground, in mm: what the overlay says in perspective, where there is no scale bar. */
  private gridStepMm = 1

  private theme: Theme = LIGHT_THEME
  private readonly scheme: MediaQueryList | null
  private aspect = NAMED_ASPECT
  private fov = DEFAULT_FOV
  private frame = 0
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private readonly settledListeners: ((c: Camera) => void)[] = []
  /** Told when the person moves the camera with the pointer; true from the press that starts the orbit, pan or zoom to its end. */
  private readonly navigatedListeners: (() => void)[] = []
  private navigating = false
  private readonly drawnListeners = new Set<() => void>()
  private readonly sectionListeners = new Set<(plane: SectionPlane | null) => void>()
  /** How many pixels at the top of the canvas the bars floating over it cover: what is framed on screen is framed below them. */
  private coveredTop = 0
  /** The camera before the parts drawn apart were framed anew (`keepApartInView`), and the one they were framed by: gone back to when they come together, if the camera is still that one. */
  private framedApart: { before: Camera; after: Camera } | null = null
  private readonly move = new CameraMove()
  private disposed = false

  private readonly highlights = new Highlights()
  /** How far each part of the layout shown is drawn from where it is (explode): the one way a part is moved here, and for display only. */
  private apart = new PartsApart()
  /** The scans of the object on show, as last given, and what is drawn of them. */
  private scanInfos: ScanInfo[] = []
  private readonly scans = new ScanLayer(() => this.invalidate())
  /** The section through the parts: what is highlighted on them is cut with them, and the scans are cut open. */
  private readonly section = new SectionCut(
    (planes) => {
      this.highlights.setClipping(planes)
      this.scans.setClipping(planes)
    },
    (built, gone) => this.highlights.suppress(built, gone)
  )
  /** Whether the last `pick` ended on the cut face of a solid. */
  private onCut = false
  /** Whose cut face that is (`Picked.cutOf`). */
  private cutOf: string | null = null
  /** The scan that hid a part from the last pick. */
  private behindScan: string | null = null
  /** The scan the gizmo holds while it is moved by hand, and the points of an alignment being made. */
  private readonly scanEdit = new ScanEdit(this.scans)
  private readonly marks = new MarkLayer(markColours(LIGHT_THEME), this.scans)
  /** The marks of the object as last given, resolved ones too: `focusMark` goes to any of them. */
  private allMarks: Mark[] = []
  /** Over the canvas: the labels of the marks, and what a tool shows of itself. Drawn anew with every frame, never through React. */
  private readonly overlay: OverlayPass
  /** The sheet of the plane a sketch is drawn on, with its handle. */
  private readonly sketchSheet = new SketchSheet()
  /** What a sketch is drawn with over the view (the hint, the label of its plane, the view cube): see `setSketch`. */
  private sketchOver: SketchOverlay = { hint: null, marker: null, plane: null, cube: null }
  /** The snap targets of the parts shown, made when a sketch first asks and kept until the parts change. */
  private snaps: SnapIndex | null | undefined
  private xray = false
  /** The gizmo on the shape being edited. */
  private readonly gizmo: ShapeGizmo
  private readonly pointer: PointerRouter
  private readonly pictures: PictureMaker
  private thumbnails: ThumbnailMaker | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    // The stencil is what the cut faces of a section are counted in (section.ts).
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true })
    this.renderer.localClippingEnabled = true
    // Pictures for the agent are encoded by hand to match these two (see Encoder in picture.ts).
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping

    for (const camera of [this.perspective, this.orthographic]) camera.up.set(0, 0, 1)
    this.perspective.position.set(120, -120, 96)

    // The sky is +Z. With the key light riding on the camera, no side goes black (lights.ts).
    this.scene.add(this.lights.sky, this.keyLight, this.keyLight.target)

    // Drawn first and kept out of the depth buffer, so parts resting on the
    // ground cover it without flicker.
    this.ground.material.depthWrite = false
    this.ground.renderOrder = -1
    this.ground.frustumCulled = false
    this.scene.add(this.ground, this.scans.group, this.marks.group, this.section.decor, this.ghosts.group, this.earlier.group, this.later.group, this.sketchSheet.group)

    this.overlay = new OverlayPass({ canvas, marks: this.marks, camera: () => this.camera, layout: () => this.layout, style: () => ({ ...this.labelStyle(), accent: this.theme.accent }), frame: () => ({ muted: this.theme.muted, axes: [this.theme.axisX, this.theme.axisY, this.theme.axisZ] as const, gridStep: this.gridStepMm }), project: (p) => this.project(p), syncMatrices: () => this.syncMatrices(), exploded: () => this.apart.any })
    // A label drawn before its face has loaded is in the fallback face: draw again once it is there.
    void overlayFonts().then(() => this.invalidate())

    this.controls = new OrbitControls(this.perspective, canvas)
    this.controls.enableDamping = false
    this.controls.screenSpacePanning = true
    this.controls.zoomToCursor = true
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
    // Before the controls' own listener, so that their `start` knows where the press was.
    canvas.addEventListener('pointerdown', (e) => (this.lastDown = { x: e.clientX, y: e.clientY, button: e.button }), true)
    canvas.addEventListener('pointermove', () => this.onPivotMove(), true)
    this.controls.addEventListener('start', this.onControlStart)
    this.controls.addEventListener('end', this.onControlEnd)
    this.controls.addEventListener('change', this.onCameraChange)

    // Before this class listens to the pointer: by then the gizmo has said whether the pointer is on it.
    this.gizmo = new ShapeGizmo(this.perspective, canvas, {
      subject: (id) => {
        // Nothing is held, moved or turned by hand while the parts are drawn apart: what is on screen is not where they are.
        if (this.apart.any) return null
        const mark = this.marks.markOf(this.layout, id)
        return this.scanEdit.subject(id) ?? (mark?.kind === 'shape' ? mark : null)
      },
      preview: (id, change) => {
        if (this.scanEdit.subject(id)) this.scanEdit.preview(id, change)
        else this.marks.preview(id, change)
        this.extent = this.measured()
        this.invalidate()
      },
      dragging: (on) => this.pointer.gizmoDragging(on),
      redraw: () => this.invalidate()
    })
    this.scene.add(...this.gizmo.objects)

    // After the orbit and the gizmo, whose listeners on the canvas are to run before its own.
    this.pointer = new PointerRouter({
      canvas,
      orbit: this.controls,
      gizmo: this.gizmo,
      camera: () => this.camera,
      canvasPoint: (x, y) => this.canvasPoint(x, y),
      pick: (x, y) => this.pick(x, y),
      pickedCut: () => this.onCut,
      pickedBehindScan: () => this.behindScan,
      syncMatrices: () => this.syncMatrices(),
      view: () => this.getCamera(),
      setView: (c) => {
        this.move.drop()
        this.applyCamera(c)
      }
    })
    this.pictures = new PictureMaker({
      renderer: this.renderer,
      scene: this.scene,
      marks: this.marks,
      highlights: this.highlights,
      scans: this.scans,
      closed: () => this.disposed,
      layouts: () => this.layouts,
      layout: () => this.layout,
      aspect: () => this.aspect,
      parts: () => this.entries.values(),
      currentView: () => this.getCamera(),
      // Fitted to the parts where the picture draws them.
      namedView: (name, parts, aspect, also) => this.namedCamera(name, withBox(drawnBox(parts, this.apart.offsets()), also ?? null) ?? EMPTY_BOX, aspect, true),
      cameraFor: (view, aspect, extent) => this.pictureCamera(view, aspect, extent),
      hiddenParts: (layout, drawn) => this.hiddenParts(layout, drawn),
      // A picture is of the model: the ghosts of a build that just landed go with the gizmo.
      hideGizmo: () => {
        const gizmoBack = this.gizmo.hide()
        const ghostsBack = this.ghosts.hide()
        const earlierBack = this.earlier.hide()
        const laterBack = this.later.hide()
        const sheetBack = this.sketchSheet.hide()
        return () => {
          sheetBack()
          laterBack()
          gizmoBack()
          ghostsBack()
          earlierBack()
        }
      },
      section: () => this.section.get(),
      cutBy: (plane, layout, decor) => this.cutBy(plane, layout, decor),
      layGround: (layout) => reachingApart(this.rebuildGround(layout), this.partsOf(layout), this.apart),
      groundExtent: () => reachingApart(this.groundExtent, this.partsOf(this.layout), this.apart),
      explode: () => this.apart.get(),
      explodeFor: (explode, layout) => this.explodeFor(explode, layout),
      tintPicks: (layout) => this.tintPicks(layout),
      showMarks: () => this.showMarks(),
      colours: () => ({ ...this.labelStyle(), muted: this.theme.muted, axes: [this.theme.axisX, this.theme.axisY, this.theme.axisZ] as const })
    })

    // Without preventDefault the browser never restores a lost context.
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)

    this.scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
    this.scheme?.addEventListener('change', this.onSchemeChange)
    this.readTheme()

    this.rebuildGround(this.layout)
    this.resize()
    this.invalidate()
  }

  /** Shows a new build. The camera stays where it is, unless this is the first scene with parts. */
  setScene(scene: Scene, blob: ArrayBuffer): void {
    const seen = new Set<string>()
    // Where the parts that changed stood, for the ghosts: not with a section on, nor with the parts apart (the ghost would have to be cut, or moved, the same way).
    const stood = new Map<string, GhostItem['before']>()
    const ghostable = this.section.get() === null && !this.apart.any
    for (const part of scene.parts) {
      seen.add(part.key)
      let entry = this.entries.get(part.key)
      if (ghostable && entry && partChanged(entry.part, part)) {
        stood.set(part.key, { edges: entry.built.edges.geometry.clone(), position: entry.built.group.position.clone(), quaternion: entry.built.group.quaternion.clone() })
      }
      if (entry && entry.part.hash === part.hash) {
        entry.part = part
      } else {
        if (entry) this.discard(entry)
        entry = { part, built: buildPart(part, blob) }
        this.entries.set(part.key, entry)
        this.scene.add(entry.built.group)
        this.section.add(entry.built)
      }
      // `loc` is the tessellator's local → object transform; it can differ between builds of the same shape.
      // Where the part is drawn is `placePart`'s to say, once the layout is known (`refresh`).
      entry.built.group.quaternion.fromArray(part.loc.q)
    }
    for (const [key, entry] of this.entries) {
      if (seen.has(key)) continue
      this.discard(entry)
      this.entries.delete(key)
    }

    this.layouts = [...scene.layouts]
    if (!this.layouts.includes(this.layout)) this.layout = this.layouts[0] ?? ''
    this.snaps = undefined
    this.colors = colorsOfParts(scene.parts)
    this.refresh()
    this.showGhosts(stood)

    if (!this.framed && this.shownParts().length > 0) {
      this.framed = true
      this.setView('iso', false)
    }
    this.invalidate()
  }

  /** Draws the old edges (and the new, in the accent) of the parts that changed, for a moment; the ones of other layouts or switched off are let go. */
  private showGhosts(stood: Map<string, GhostItem['before']>): void {
    const items: GhostItem[] = []
    for (const [key, before] of stood) {
      const entry = this.entries.get(key)
      if (!entry || entry.part.layout !== this.layout || this.layers.get(key)?.visible === false) {
        before.edges.dispose()
        continue
      }
      const { group, edges } = entry.built
      items.push({ part: key, layout: entry.part.layout, before, after: { edges: edges.geometry.clone(), position: group.position.clone(), quaternion: group.quaternion.clone() } })
    }
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    this.ghosts.begin(items, { old: toHex(this.theme.muted), fresh: toHex(this.theme.accent) }, performance.now(), still)
    if (this.ghosts.on) this.invalidate()
  }

  /**
   * Draws an earlier build of the model over the current one, translucent, for display only (#56): its parts of the
   * layout shown, where that build had them. Not with a section or the parts drawn apart (it would have to be cut or moved
   * the same way): false then, and nothing is drawn. It stays until `clearEarlier`; a layout, a section or an explode put away
   * by the caller. True when it is drawn.
   */
  setEarlier(scene: Scene, blob: ArrayBuffer): boolean {
    this.earlier.clear()
    this.later.clear()
    if (this.section.get() !== null || this.apart.any) return false
    const parts = scene.parts.filter((p) => p.layout === this.layout)
    if (parts.length === 0) return false
    this.earlier.tint(toHex(this.theme.muted), toHex(this.theme.ink))
    this.earlier.show(parts, blob, toHex(this.theme.muted), colorsOfParts(scene.parts))
    this.invalidate()
    return true
  }

  /**
   * Draws a kept build in the place of the live one, for the whole of a compare in which the later build is not the live
   * one: opaque, in its own colours, where it stood. The live parts are not drawn while it is, but are kept: live builds that
   * land meanwhile update them, unseen, and `clearLater` has them back. Not with a section or the parts drawn apart, nor
   * the parts switched off; false then, and nothing is drawn. True when it is drawn.
   */
  setLater(scene: Scene, blob: ArrayBuffer): boolean {
    this.later.clear()
    if (this.section.get() !== null || this.apart.any) return false
    const parts = scene.parts.filter((part) => part.layout === this.layout && this.layers.get(part.key)?.visible !== false)
    if (parts.length === 0) return false
    this.later.solid(true)
    this.later.show(parts, blob, toHex(this.theme.muted), colorsOfParts(scene.parts))
    this.invalidate()
    return true
  }

  /** Puts the stand-in away: the live build is drawn again. */
  clearLater(): void {
    if (this.later.clear()) this.invalidate()
  }

  /** The keys of the parts of the stand-in drawn; empty when the live build is. */
  laterKeys(): string[] {
    return this.later.keys()
  }

  /** Puts the earlier build away. */
  clearEarlier(): void {
    if (this.earlier.clear()) this.invalidate()
  }

  /**
   * How the earlier build is shown against the live one: `overlay` it translucent over it, `before` it alone, `after` the live
   * one alone, `side` the earlier one in the left half and the live one in the right (the same camera, each half framed as the
   * whole view is; nothing in a half is pointed at or marked). Null for no comparing. Only while an earlier build is drawn.
   */
  setCompareMode(mode: CompareMode | null): void {
    if (this.compareMode === mode) return
    this.compareMode = mode
    this.earlier.solid(mode === 'before' || mode === 'side')
    this.invalidate()
  }

  /** Whether the view is split in two (`side`): a point of it is not one of the model. */
  private get split(): boolean {
    return this.compareMode === 'side' && this.earlier.on
  }

  /** Whether what the view draws is not the live build alone as the marks and picks have it: a pick or a chip of it would be of another build. */
  private get viewOnly(): boolean {
    return this.compareMode !== null && (this.later.on || (this.earlier.on && this.compareMode !== 'overlay' && this.compareMode !== 'after'))
  }

  /** The keys of the parts of the earlier build drawn; empty when there is none. */
  earlierKeys(): string[] {
    return this.earlier.keys()
  }

  /** Puts the ghosts of the last build away at once (a key, a click). */
  endGhosts(): void {
    this.ghosts.end()
  }

  /** Test only: the ghosts of the next builds stay until a key or a click, so that the window can be captured with them. */
  holdGhosts(held: boolean): void {
    this.ghosts.hold(held)
  }

  /** The keys of the parts the ghosts are drawn for; empty once they are gone. */
  ghostKeys(): string[] {
    return this.ghosts.keys()
  }

  /** The scans of the object on show, and the build on show (what their alignments' checks are held against): each is drawn where its alignment for the layout shown puts it, once its mesh has come (`setScanMesh`). */
  setScans(scans: ScanInfo[], revision?: number): void {
    this.scanInfos = scans
    this.scans.set(scans, this.layout, revision)
    this.extent = this.measured()
  }

  /** The mesh of a scan, as main read it from the disk. Throws for bytes that are no scan. */
  setScanMesh(id: string, blob: ArrayBuffer): void {
    this.scans.load(id, blob)
    this.extent = this.measured()
  }

  /** Whether a scan is drawn, how thin, and in its own colours or plain; what is left out keeps its value. */
  setScanView(id: string, view: ScanView): void {
    this.scans.setView(id, view)
    this.extent = this.measured()
  }

  /** The scans whose mesh is still to be asked of main. */
  wantingScans(): string[] {
    return this.scans.wanting()
  }

  scanState(): ScanLayerState[] {
    // Against the sphere the camera's near and far are set by.
    return this.scans.state(this.extent)
  }

  /** What is tinted on the scans: the regions kept and the set being painted. */
  regionState(): ReturnType<ScanLayer['tints']['state']> {
    return this.scans.tints.state()
  }

  /** A scan's bounds tree, how it was made and the mesh it is of; null until it is there. For what works on a scan's triangles (the region brush). */
  scanTree(id: string): ReturnType<ScanLayer['tree']> {
    return this.scans.tree(id)
  }

  /** Draws a scan somewhere else for now (a fit not yet applied, a drag); null draws it where main has it. */
  previewScan(id: string, transform: ScanTransform | null): void {
    this.scans.preview(id, transform)
    this.extent = this.measured()
  }

  /** The triangles of a scan within `radius` mm of a hit whose normals are within `degrees` of the hit's: their centroids in the object frame and their areas. Tints them when `tint`. Null clears the tint. */
  scanPatch(hit: ScanHit | null, radius: number, opts?: { degrees?: number; tint?: boolean }): { points: Vec3[]; weights: number[] } | null {
    return this.scans.patch(hit, radius, opts)
  }

  /** The set being painted on a scan, tinted in `--user-mark`; null for none. Redrawn when `touched()` is called after it changed. */
  paintScan(...of: Parameters<ScanLayer['tints']['paint']>): { touched(): void } | null {
    return this.scans.tints.paint(...of)
  }

  /** The regions kept, to be tinted on their scans in their authors' colours: bits by mark id. */
  setRegions(regions: Parameters<ScanLayer['tints']['setRegions']>[0]): void {
    this.scans.tints.setRegions(regions)
  }

  /** The Region tool's brush as a ring on the scan, in `--user-mark` and in no picture; null for none. */
  showBrush(ring: BrushRing | null): void {
    this.overlay.brush = ring
    this.invalidate()
  }

  /** Numbered dots for the ends of the pairs being made and the points of a floor: in `--accent`, in no picture. */
  showAlignPoints(points: AlignPoint[]): void {
    this.overlay.alignPoints = points
    this.invalidate()
  }

  /** The gizmo on a scan, at `pivot`: moving or turning it draws the scan as dragged, and on release says how far it was moved and turned about the pivot. Null takes it away, and the gizmo is the active shape's again. */
  editScan(id: string | null, mode: 'translate' | 'rotate', pivot: Vec3, onChange: (change: { move: Vec3; turn: Quat }) => void): void {
    this.scanEdit.edit(id, pivot, onChange)
    this.gizmo.edit(id, mode, (change) => (this.scanEdit.released(change), this.gizmo.place()), 'scan')
    this.gizmo.place()
    this.invalidate()
  }

  /**
   * The marks of the object on show, of every layout: those of the layout
   * shown that are not resolved are drawn, each with its number. A mark's
   * objects are made once and again only when the mark itself changes.
   * `revision` is the build on show, 0 for none: a dimension's label gives
   * its value as measured on that build, or says it has none of it.
   */
  setMarks(marks: Mark[], revision = 0): void {
    this.allMarks = marks
    this.marks.setMarks(marks, revision)
    this.showMarks()
    this.extent = this.measured()
    this.tintPicks(this.layout)
    this.gizmo.place()
    this.invalidate()
  }

  /**
   * Puts a gizmo on a shape mark of the layout shown, to move it, turn it or
   * size it by dragging; null takes the gizmo away. While it is dragged the
   * shape is drawn as the drag has it, and nothing is told; when it is let go
   * `onChange` is called once, with what of the shape the drag changed: its
   * position, its rotation or its size, by `mode`. Sizing changes the size in
   * millimetres, never a scale: no axis under 0.1 mm, a cylinder's two
   * diameters and a sphere's three kept equal, a plane kept flat. The mark is
   * the caller's to change: if it is not changed to what `onChange` was given,
   * calling this again draws it as it is.
   */
  editShape(id: string | null, mode: GizmoMode, onChange: (shape: Partial<ShapeTransform>) => void): void {
    this.gizmo.edit(id, mode, onChange)
    // As main has them: a drag that came to nothing leaves no trace.
    this.marks.setMarks(this.allMarks)
    this.extent = this.measured()
    this.gizmo.place()
    this.invalidate()
  }

  /** The mark being worked on, or null: its label is ringed, its lines are wider, and a stroke shows its plane. On screen only: a picture for the agent draws every mark alike. */
  setActiveMark(id: string | null): void {
    this.marks.setActive(id)
    this.invalidate()
  }

  /** The mark the pointer is on, in its row or on its chip, or null: its chip is ringed, more faintly than the active one's. On screen only. */
  setHoverMark(id: string | null): void {
    if (id === this.marks.hoverId) return
    this.marks.setHover(id)
    this.invalidate()
  }

  hoveredMark(): string | null {
    return this.marks.hoverId
  }

  /** Goes to the view a mark was placed from. The layout is the caller's to switch: this moves the camera only. */
  focusMark(id: string): void {
    const mark = this.allMarks.find((m) => m.id === id)
    if (mark) this.setView(mark.camera, true)
  }

  /** Brings a mark of the layout shown into view: to the view it was placed from, only when its label is not in view now (`needsCamera`). */
  revealMark(id: string): void {
    if (needsCamera(this.markLabel(id))) this.focusMark(id)
  }

  /** Where the label of a mark of the layout shown is on the canvas, in client pixels, and whether it is in view; null for a mark that is not drawn. */
  markLabel(id: string): ReturnType<OverlayPass['markLabel']> {
    return this.overlay.markLabel(id)
  }

  /** The mark whose chip is under a point of the window, in client pixels, as the last frame drew it; null for none. */
  markAt(clientX: number, clientY: number): string | null {
    return this.overlay.markAt(clientX, clientY)
  }

  /** What a mark of the layout shown covers on the canvas, in client pixels, and where it is anchored; null for a mark that is not drawn. */
  markBox(id: string): ReturnType<OverlayPass['markBox']> {
    return this.overlay.markBox(id)
  }

  /**
   * What the pointer is making, drawn until it is a mark: a pin where it was
   * clicked, an arrow being dragged, a stroke being drawn. Null for nothing. It goes straight to the
   * scene: nothing of a drag passes through React or the marks.
   */
  setDraft(draft: Draft | null): void {
    this.marks.setDraft(draft)
    const held = draft?.kind === 'dimension' && draft.to && draft.held !== undefined ? draft : null
    this.overlay.held = held && held.to ? { at: [(held.from[0] + held.to[0]) / 2, (held.from[1] + held.to[1]) / 2, (held.from[2] + held.to[2]) / 2], text: held.held! } : null
    this.extent = this.measured()
    this.invalidate()
  }

  /** The draft drawn now (a pending measurement, or the last one held), for the test hook. */
  draftState(): Draft | null {
    return this.marks.currentDraft()
  }

  /** Calls back after every frame drawn: what is laid over the view (the note of a mark) follows the camera with it. Returns what stops it. */
  onDrawn(cb: () => void): () => void {
    this.drawnListeners.add(cb)
    return () => this.drawnListeners.delete(cb)
  }

  /** Shows the parts of one layout. A layout the scene does not have is ignored. */
  setLayout(layout: string): void {
    if (layout === this.layout || !this.layouts.includes(layout)) return
    this.layout = layout
    this.snaps = undefined
    this.ghosts.end()
    this.refresh()
    this.invalidate()
  }

  // ---- sketching ----

  /** Draws the parts see-through (a sketch's x-ray), or solid again: strokes inside a part are placed and seen through it. */
  setXray(on: boolean): void {
    if (on === this.xray) return
    this.xray = on
    for (const entry of this.entries.values()) this.applyLook(entry)
    this.invalidate()
  }

  /** Whether the parts are drawn see-through. */
  xrayOn(): boolean {
    return this.xray
  }

  /**
   * What a sketch snaps to: the vertices, hole centres and edges of the parts shown, in the object frame, made once for the
   * parts as they are and made again when they change. Null when no part has snap data (a kernel that does not send it).
   */
  snapIndex(): SnapIndex | null {
    if (this.snaps !== undefined) return this.snaps
    const parts: SnapPart[] = []
    for (const { part, built } of this.entries.values()) {
      if (!built.group.visible || !built.snap || !built.edgeTypes) continue
      const q = new THREE.Quaternion().fromArray(part.loc.q)
      const t = new THREE.Vector3().fromArray(part.loc.t)
      const per = new Uint32Array(built.edgeStarts.length - 1).map((_, i) => built.edgeStarts[i + 1] - built.edgeStarts[i])
      parts.push({
        name: part.name,
        toObject: (v) => new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(q).add(t).toArray() as Vec3,
        data: built.snap,
        edges: built.edges.geometry.getAttribute('position').array as Float32Array,
        segmentsPerEdge: per,
        edgeTypes: built.edgeTypes
      })
    }
    return (this.snaps = parts.length > 0 ? new SnapIndex(parts) : null)
  }

  /**
   * Whether a point of the object frame can be seen from the camera: not behind a part, and not on what a section cuts away. A
   * point on a surface is on it to within the tessellation, so what is a little behind it counts as on it.
   */
  visibleAt(point: Vec3): boolean {
    if (this.viewOnly) return false
    this.syncMatrices()
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return true
    const keeps = this.section.keeps()
    const p = new THREE.Vector3().fromArray(point)
    if (keeps && keeps.distanceToPoint(p) < 0) return false
    const ndc = p.clone().project(this.camera)
    if (!(ndc.z >= -1 && ndc.z <= 1)) return false
    const size = { width: rect.width, height: rect.height }
    const parts = [...this.entries.values()].filter((e) => e.built.group.visible && !this.section.removed(e.built)).map((e) => ({ key: e.part.key, name: e.part.name, built: e.built }))
    const picked = pickUnder(parts, this.camera, { x: ndc.x, y: ndc.y }, size, { edges: false, cut: keeps && { keeps } })
    if (!picked.hit) return true
    const ray = pointerRay(this.camera, { x: ndc.x, y: ndc.y })
    const depth = p.sub(new THREE.Vector3().fromArray(ray.origin)).dot(new THREE.Vector3().fromArray(ray.direction))
    return picked.hit.distance >= depth - Math.max(SNAP_BEHIND_MM, 3 * mmPerPx(this.camera, p, size.height))
  }

  /** Lays the sheet of the plane a sketch is drawn on across the parts shown; null takes it away. */
  setSketchSheet(plane: PlaneDraft | null): void {
    this.sketchSheet.setColour(toHex(this.theme.accent))
    this.sketchSheet.set(plane, plane ? this.bounds() : null)
    this.invalidate()
  }

  /** Whether the pointer is on the handle of the sheet (client pixels). */
  onSketchHandle(clientX: number, clientY: number): boolean {
    const at = this.sketchSheet.handlePoint()
    if (!at) return false
    const [x, y] = this.project(at)
    return Math.hypot(x - clientX, y - clientY) <= HANDLE_REACH_PX
  }

  /**
   * What the sketch tool lays over the view, in client pixels where it has any: the hint beside the pointer, where a snap
   * would land, the plane's label, the view cube. Each of the parts is put where it is given and the others are kept.
   */
  setSketch(over: { hint?: SketchHint | null; marker?: Vec3 | null; plane?: SketchOverlay['plane']; cube?: SketchOverlay['cube'] }): void {
    const rect = this.canvas.getBoundingClientRect()
    const hint = over.hint === undefined ? this.sketchOver.hint : over.hint && over.hint.at ? { ...over.hint, at: [over.hint.at[0] - rect.left, over.hint.at[1] - rect.top] as [number, number] } : over.hint
    this.sketchOver = { hint, marker: over.marker === undefined ? this.sketchOver.marker : over.marker, plane: over.plane === undefined ? this.sketchOver.plane : over.plane, cube: over.cube === undefined ? this.sketchOver.cube : over.cube }
    this.overlay.sketch = this.sketchOver.hint || this.sketchOver.marker || this.sketchOver.plane || this.sketchOver.cube ? this.sketchOver : null
    this.invalidate()
  }

  /** The corner of the sheet the plane's label stands by, in the object frame; null with no sheet. */
  sketchCorner(): Vec3 | null {
    return this.sketchSheet.cornerPoint()
  }

  /** The main plane whose face of the view cube is at a point (client pixels); null beside the cube or with none shown. */
  cubeAt(clientX: number, clientY: number): MainAxis | null {
    const rect = this.canvas.getBoundingClientRect()
    return faceAt(this.overlay.cube, [clientX - rect.left, clientY - rect.top])
  }

  // ---- explode ----

  /**
   * Draws the parts of the layout shown apart, or together for null: each part's group is moved by what
   * `explodeOffsets` says of it, and the marks on it with it. For display only: the geometry, the marks and
   * all the kernel is asked stay of the parts as built, and `pick` answers so. Scans and grid do not move.
   * With `animate` the parts go there over a moment (a key, the agent); without, at once, as under a slider.
   * It is of the layout shown: another layout or build is drawn apart by the same explode until this is called again.
   */
  setExplode(explode: ExplodeState | null, animate = false): void {
    const to = isExploded(explode) ? explode : null
    // Asked again for what it has, or is on its way to: a move under way goes on.
    if (sameExplode(to, this.apart.get())) return
    this.ghosts.end()
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    this.apart.set(to, this.partsOf(this.layout), animate && !still ? performance.now() : undefined)
    this.placeParts()
    this.invalidate()
    if (to === null) this.backFromApart()
  }

  /**
   * The parts are together again: the camera goes back to where it was before drawing them apart framed them
   * anew, when nobody has moved it since. One rule both ways: framed on the way out only to keep every part in
   * sight, and put back on the way in.
   */
  private backFromApart(): void {
    const back = cameraBack(this.framedApart, this.cameraGoal())
    this.framedApart = null
    if (back) this.setView(back, true)
  }

  /**
   * Frames the parts again when one of them, drawn apart, would leave the view where it is going, or go under
   * the bars over its top (`leavesView`, `setCoveredTop`); leaves the camera alone otherwise. Asked whenever the
   * parts are drawn apart otherwise, by whatever path (the view bar, once it is laid out), and when a saved view is
   * applied: the camera is theirs, and is moved only so that no part goes out of sight. What it was before is
   * gone back to when the parts come together (`backFromApart`). True when it was moved.
   */
  keepApartInView(): boolean {
    if (!this.apart.any) return false
    this.syncMatrices()
    // Where the camera is going, when it is on its way; and the view is what the bars over its top leave of it.
    const goal = this.move.goal
    const camera = goal ? this.cameraFor(goal, this.aspect, this.extent) : this.camera
    const height = this.canvas.clientHeight
    const clear = height > 0 ? Math.max(height - Math.min(this.coveredTop, height / 2), 1) / height : 1
    const seen = (point: Vec3): [number, number] => {
      const v = new THREE.Vector3().fromArray(point).project(camera)
      return [v.x, (v.y + 1) / clear - 1]
    }
    if (!leavesView(this.shownParts(), this.apart.target(), seen)) return false
    // Framed anew a second time, the camera goes back to where it was before the first.
    const before = cameraBack(this.framedApart, this.cameraGoal()) ?? this.cameraGoal()
    this.fitVisible()
    this.framedApart = { before, after: this.getCamera() }
    return true
  }

  /**
   * How many pixels at the top of the canvas the bars floating over it cover. A view key, Fit, a scan's Frame
   * and `keepApartInView` frame the parts in what the bars leave; a picture for the agent has no bars.
   */
  setCoveredTop(px: number): void {
    this.coveredTop = Number.isFinite(px) ? Math.max(px, 0) : 0
  }

  /** Whether the parts are drawn apart, or are on their way there or back: what is on screen is then not where they are. */
  exploded(): boolean {
    return this.apart.any
  }

  /** Draws a layout's parts apart otherwise for a picture, at once; returns what puts the screen back as it was, a move under way included. */
  private explodeFor(explode: ExplodeState | null, layout: string): () => void {
    const onScreen = this.apart
    this.apart = new PartsApart()
    this.apart.set(explode, this.partsOf(layout))
    this.placeParts(layout)
    return () => {
      this.apart = onScreen
      this.placeParts()
    }
  }

  /** Puts every part, and the marks on the parts, where they are drawn; `layout` is the one whose parts are drawn apart. */
  private placeParts(layout = this.layout): void {
    for (const entry of this.entries.values()) this.placePart(entry, layout)
    this.marks.setOffsets(this.apart.offsets(), Object.fromEntries(this.partsOf(layout).map((part) => [part.name, part.bbox])))
    this.extent = this.measured()
    this.gizmo.place()
  }

  /** The one place a part's group is put: where the build has the part, and off it by how far the part is drawn apart. */
  private placePart({ part, built }: Entry, layout = this.layout): void {
    built.group.position.fromArray(drawnAt(part, part.layout === layout ? this.apart.offsets() : {}))
  }

  /** Sets visibility, colour or opacity of one part; what is left out keeps its value. Remembered across rebuilds. */
  setLayer(key: string, s: LayerState): void {
    const was = this.layers.get(key)
    this.layers.set(key, { ...was, ...s })
    const entry = this.entries.get(key)
    if (entry) this.applyLook(entry)
    if (entry && (was?.visible !== false) !== (this.layers.get(key)?.visible !== false)) {
      this.snaps = undefined
      // The marks on a part come and go with it.
      this.showMarks()
      this.extent = this.measured()
      this.tintPicks(this.layout)
      this.gizmo.place()
    }
    this.invalidate()
  }

  /** Shows the marks of the layout on screen, but for those on the parts switched off. */
  private showMarks(): void {
    this.marks.show(this.layout, this.hiddenParts(this.layout))
  }

  /**
   * The names of the parts of a layout that are not drawn: those switched
   * off, or, given the keys of the parts a picture draws, every other.
   */
  private hiddenParts(layout: string, drawn?: ReadonlySet<string>): Set<string> {
    const hidden = new Set<string>()
    for (const { part } of this.entries.values()) {
      if (part.layout !== layout) continue
      if (drawn ? !drawn.has(part.key) : this.layers.get(part.key)?.visible === false) hidden.add(part.name)
    }
    return hidden
  }

  /** Dims the parts, to say they are older than the latest build attempt. */
  setStale(stale: boolean): void {
    if (stale === this.stale) return
    this.stale = stale
    for (const entry of this.entries.values()) this.applyLook(entry)
    this.lookOfScans()
    this.invalidate()
  }

  /** Whether the parts are drawn faded now (`setStale`). */
  faded(): boolean {
    return this.stale
  }

  /** Goes to a standard view, fitted to the visible parts in the current projection, or to a given camera. */
  setView(v: ViewName | Camera, animate = false): void {
    // Sent somewhere: the camera is no longer the one drawing the parts apart framed.
    this.framedApart = null
    const to = typeof v === 'string' ? this.onScreen(this.visibleBox(), viewDirection(v), this.camera === this.orthographic) : v
    const from = this.getCamera()
    if (animate && from.ortho === to.ortho) {
      this.move.begin(from, to, performance.now())
      this.invalidate()
    } else {
      this.move.drop()
      this.applyCamera(to)
    }
  }

  /** Switches projection, keeping the part the same size at the camera's target: of where the camera is going, when it is on its way. */
  setOrtho(ortho: boolean): void {
    const c = this.cameraGoal()
    if (c.ortho === ortho) return
    this.framedApart = null
    this.move.drop()
    if (ortho) {
      this.applyCamera({ ...c, ortho: true })
    } else {
      // An orthographic camera magnifies by zoom; a perspective one by coming closer.
      const position = c.position.map((p, i) => c.target[i] + (p - c.target[i]) / c.zoom) as Vec3
      this.applyCamera({ ...c, ortho: false, position, zoom: 1 })
    }
  }

  /**
   * Frames the visible parts without turning the camera. Of where the camera is going when it is on its way
   * (a view key pressed just before): the turn is not left halfway.
   */
  fit(opts?: { selection?: boolean }): void {
    // Framed by the person's own asking: theirs from now, also when the parts come together.
    this.framedApart = null
    // With `selection`: what is selected, and then, pressed again, everything.
    const refs = opts?.selection ? this.highlights.refsOf('selection') : []
    const key = refs.join(' ')
    const box = refs.length > 0 && this.fittedSelection !== key ? selectionBox(this.partNamed, refs) : null
    if (box) {
      this.fittedSelection = key
      this.frameBox(box)
    } else {
      this.fittedSelection = null
      this.fitVisible()
    }
  }

  /** Frames a box from the way the camera looks. */
  private frameBox(box: { min: number[]; max: number[] }): void {
    const c = this.cameraGoal()
    const dir = c.target.map((t, i) => t - c.position[i])
    this.move.drop()
    this.applyCamera(this.onScreen(box, { dir, up: c.up }, c.ortho))
  }

  private fitVisible(): void {
    const c = this.cameraGoal()
    const dir = c.target.map((t, i) => t - c.position[i])
    this.move.drop()
    this.applyCamera(this.onScreen(this.visibleBox(), { dir, up: c.up }, c.ortho))
  }

  /**
   * Frames one part, where it is drawn, without turning the camera: a double click on its row in the layers.
   * False when it is not drawn (switched off, or not in this layout).
   */
  framePart(name: string): boolean {
    const part = this.shownParts().find((one) => one.name === name)
    const box = part ? drawnBox([part], this.apart.target()) : null
    if (!box) return false
    this.framedApart = null
    const c = this.cameraGoal()
    const dir = c.target.map((t, i) => t - c.position[i])
    this.move.drop()
    this.applyCamera(this.onScreen(box, { dir, up: c.up }, c.ortho))
    return true
  }

  /**
   * Frames a scan with the visible parts, without turning the camera: "Frame" on a scan's row. The views and
   * `fit` frame the parts, which lie somewhere inside a scan of their surroundings; this is how the scan is
   * found. False when the scan is not drawn (its mesh has not come, or it is switched off).
   */
  frameScan(id: string): boolean {
    const box = this.scans.state().find((scan) => scan.id === id)?.visible ? this.scans.boxIn([id], this.layout) : null
    if (!box) return false
    this.framedApart = null
    const c = this.cameraGoal()
    const dir = c.target.map((t, i) => t - c.position[i])
    this.move.drop()
    this.applyCamera(this.onScreen(withBox(this.visibleBox(), box)!, { dir, up: c.up }, c.ortho))
    return true
  }

  /**
   * The standard view the camera is locked on: orthographic, exactly one of
   * front, back, left, right, top and bottom, and not turned since. Panning
   * and zooming keep the lock; orbiting and perspective lose it. Null otherwise.
   */
  lockedView(): ViewName | null {
    return lockedViewOf(this.getCamera())
  }

  /** The box around the parts shown (failing that, around the layout), in the object frame: of the parts as built, however they are drawn. */
  bounds(): { min: Vec3; max: Vec3 } {
    const { min, max } = boxOf(this.shownParts()) ?? this.boxOfLayout(this.layout)
    return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] }
  }

  /** The box of each part that is drawn, in the object frame: what can be in front of anything else on the screen is inside one of them. */
  partBoxes(): Array<{ min: Vec3; max: Vec3 }> {
    return this.shownParts().map((part) => ({ min: [...part.bbox.min] as Vec3, max: [...part.bbox.max] as Vec3 }))
  }

  /** Where the camera is going when it was sent somewhere and is on its way, else where it is: what a view kept now should hold. */
  cameraGoal(): Camera {
    return this.move.goal ?? this.getCamera()
  }

  getCamera(): Camera {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      up: up.toArray(),
      ortho: this.camera === this.orthographic,
      fov: this.fov,
      zoom: this.camera.zoom
    }
  }

  // ---- pointing ----

  /**
   * What a point of the window is on: a face, or an edge within reach of it,
   * of the parts of the current layout that are switched on. A part that is
   * hidden is never hit; one that is see-through is hit like any other.
   * Coordinates are the browser's client pixels; the answer is in the object frame, and of
   * the part as built: how far a part is drawn apart (explode) is taken away from the point.
   * What is seen is what is picked: behind a scan drawn solid nothing of the parts is hit, unless the parts
   * alone are asked for (`partsOnly`); a scan that is seen through is pointed through (`ScanLayer.blocks`).
   */
  pick(clientX: number, clientY: number, opts?: { edges?: boolean; partsOnly?: boolean }): Hit | null {
    // Side by side the canvas is two views of the model, and a point of it is on neither as the one camera has it.
    if (this.viewOnly) return null
    const at = this.canvasPoint(clientX, clientY)
    if (!at) return null
    this.syncMatrices()
    // Not what is switched off, nor what the section leaves nothing of.
    const parts = [...this.entries.values()].filter((e) => e.built.group.visible && !this.section.removed(e.built)).map((e) => ({ key: e.part.key, name: e.part.name, built: e.built }))
    const keeps = this.section.keeps()
    const picked = pickUnder(parts, this.camera, at.ndc, at.size, { ...opts, cut: keeps && { keeps } })
    const ray = rayOf(pointerRay(this.camera, at.ndc))
    const reach = picked.hit?.distance ?? (picked.cut && keeps ? ray.distanceToPlane(keeps) : null)
    const blocker = reach !== null && !opts?.partsOnly ? this.scans.blocker(ray, keeps, reach, (p) => mmPerPx(this.camera, new THREE.Vector3().fromArray(p), at.size.height)) : null
    const hidden = blocker !== null
    // A part is there, and a scan drawn solid is in front of it: said at the pointer, or nothing would say why the part cannot be picked.
    this.behindScan = picked.hit ? blocker : null
    this.onCut = picked.cut && !hidden
    this.cutOf = this.onCut ? picked.cutOf ?? null : null
    // The ray met the part where it is drawn: answered where the part is.
    return hidden ? null : asBuilt(picked.hit, this.apart.offsets())
  }

  /** Whose cut face the last `pick` met, when it answered nothing because the pointer is on a section's cut face; else null. */
  pickedCutOf(): string | null {
    return this.cutOf
  }

  /** What a point of the window is on of the scans drawn, whatever part is in front: `pick`'s twin. Nothing of a scan whose tree is not there yet, nor of what a section takes away. */
  pickScan(clientX: number, clientY: number): ScanHit | null {
    const at = this.canvasPoint(clientX, clientY)
    if (!at) return null
    this.syncMatrices()
    return this.scans.pick(rayOf(pointerRay(this.camera, at.ndc)), this.section.keeps())
  }

  // ---- the section ----

  /**
   * Cuts the parts by a plane, or by none: what is on the side its normal
   * points to is not drawn, and each closed solid shows its cut face in its
   * own colour, a step darker. A part that is not a closed solid is cut open,
   * and one the plane only touches or leaves nothing of is not drawn at all.
   * The marks, the grid and the gizmo are not cut; a mark anchored in the half
   * taken away is drawn dimmed. With a section, only what is drawn can be
   * pointed at: on a cut face `pick` finds nothing.
   *
   * Cheap enough to call with every move of a drag: the frame is drawn once.
   */
  setSection(plane: SectionPlane | null): void {
    if (plane) this.ghosts.end()
    this.cutBy(plane, this.layout, true)
    this.extent = this.measured()
    this.invalidate()
    for (const cb of this.sectionListeners) cb(plane)
  }

  /**
   * Calls back with the plane each time the screen's section is set: by a drag of its handle as it moves, by the
   * bar's slider, and as the store's is drawn. What reads it out follows the plane as it is drawn, with no render.
   * Returns what stops it.
   */
  onSectionMoved(cb: (plane: SectionPlane | null) => void): () => void {
    this.sectionListeners.add(cb)
    return () => this.sectionListeners.delete(cb)
  }

  getSection(): SectionPlane | null {
    return this.section.get()
  }

  /** Whether the plane has its handle: an arrow at its middle, along its normal, while the plane is the pointer's to drag. */
  showSectionHandle(shown: boolean): void {
    this.section.showHandle(shown)
    this.invalidate()
  }

  /** Whether a point of the window is on the handle of the plane, or within `SECTION_HANDLE_REACH_PX` of it. False while there is no handle. */
  onSectionHandle(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    this.syncMatrices()
    const span = this.section.handleSpan((at) => mmPerPx(this.camera, at, rect.height))
    // Not where it would fall if it is behind the camera or out of view: there is no handle drawn there.
    return span !== null && nearSegmentOnScreen(this.camera, span[0], span[1], [clientX - rect.left, clientY - rect.top], rect, SECTION_HANDLE_REACH_PX)
  }

  /** Which way the handle's arrow points as it is drawn, from its foot to its tip in pixels, y down; null while there is no handle in view. */
  sectionHandleOnScreen(): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    this.syncMatrices()
    const span = this.section.handleSpan((at) => mmPerPx(this.camera, at, rect.height))
    const ends = span && segmentOnScreen(this.camera, span[0], span[1], rect)
    return ends ? [ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]] : null
  }

  /**
   * Whether the section leaves nothing to see: parts are drawn (switched on,
   * in the layout shown), and it leaves nothing of any of them. False with no
   * section, and when nothing is switched on.
   */
  sectionLeavesNothing(): boolean {
    const { shown, kept } = this.section.leftToSee()
    return this.section.get() !== null && shown > 0 && kept === 0
  }

  /** The box the section is laid across: around every part of the layout shown, switched on or not, in the object frame. */
  sectionBox(): { min: Vec3; max: Vec3 } {
    const { min, max } = this.boxOfLayout(this.layout)
    return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] }
  }

  private boxOfLayout(layout: string): { min: number[]; max: number[] } {
    return boxOf(this.partsOf(layout)) ?? EMPTY_BOX
  }

  /** Cuts by a plane laid across a layout's parts; `decor` says whether the plane itself is drawn. */
  private cutBy(plane: SectionPlane | null, layout: string, decor: boolean): void {
    this.section.showDecor(decor)
    this.section.set(plane, this.boxOfLayout(layout))
    this.marks.setSection(plane)
    // A picture is drawn at once, with the parts it shows already switched on; the screen's frame asks in `draw`.
    if (!decor) this.section.outline()
  }

  /** A sphere around everything drawn in the layout shown: the parts and the grid, the marks, the plane of the section, the scans. */
  private measured(): THREE.Sphere {
    const sphere = this.section.extend(this.marks.extend(reachingApart(this.groundExtent, this.partsOf(this.layout), this.apart).clone(), this.layout))
    // A scan of a room round a part the size of a hand: the camera reaches it, though it frames the parts.
    return reaching(sphere, this.scans.box(), this.groundExtent)
  }

  private lookOfScans(): void {
    this.scans.setLook({ plain: this.theme.scan, surface: this.theme.surface, accent: this.theme.accent, marks: this.theme }, this.stale)
  }

  /** Where a point of the object frame is drawn, in client pixels; with `part`, where it is drawn as a point of that part (its display offset added). */
  project(point: Vec3, part?: string): [number, number] {
    const rect = this.canvas.getBoundingClientRect()
    this.syncMatrices()
    const v = new THREE.Vector3().fromArray(part === undefined ? point : drawnAt({ name: part, loc: { t: point } }, this.apart.offsets())).project(this.camera)
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
  }

  /** Marks what the pointer is on; null for nothing. */
  setHover(hit: Hit | null): void {
    this.highlight('hover', hit ? [hit.ref] : [])
  }

  /** Marks the selection, in the accent colour. Refs are of the layout shown: `lid/F12`, `lid/E3`, `lid`. */
  setSelection(refs: string[]): void {
    this.highlight('selection', refs)
  }

  /** Marks what the agent points at, in the colour of its marks. */
  setAgentHighlight(refs: string[]): void {
    this.highlight('agent', refs)
  }

  /** Lights what the pointer is on elsewhere (a ref of the chat, a mark's row or chip), in the accent: never in a mark's colour. */
  setPointed(refs: string[]): void {
    this.highlight('point', refs)
  }

  /** The refs each layer of highlights is drawn for: for the tests, which cannot read the pixels of the hidden window. */
  highlighted(): Record<HighlightLayer, readonly string[]> {
    return { hover: this.highlights.refsOf('hover'), selection: this.highlights.refsOf('selection'), agent: this.highlights.refsOf('agent'), userMark: this.highlights.refsOf('userMark'), agentMark: this.highlights.refsOf('agentMark'), point: this.highlights.refsOf('point') }
  }

  /**
   * Has `cb` told what the pointer does over the canvas. There is one listener:
   * whoever calls this routes the events on, and a second call replaces the first.
   */
  onPointer(cb: (e: ViewportPointer) => void): void {
    this.pointer.listen(cb)
  }

  /**
   * Whether dragging turns, pans and zooms the camera. A tool that drags
   * switches it off meanwhile. Switched back on while a button is still held,
   * it stays off until the button is let go: the rest of a drag that a tool
   * gave up does not turn the camera. With `wheel`, switching it off leaves
   * the wheel zooming: a long stroke is drawn across more than one zoom.
   */
  setNavigation(enabled: boolean, opts: { wheel?: boolean } = {}): void {
    this.pointer.setNavigation(enabled, opts)
  }

  /**
   * Keeps the camera still for the press under way (it is the pointer's again when the button is let go), or, with
   * false, gives it back to a press no tool has taken since.
   */
  holdCamera(on: boolean): void {
    this.pointer.holdOrbit(on)
  }

  /**
   * Where the pointer is over the canvas, in client pixels, or null when it
   * is not over it: for a tool that acts on a key and must know what is
   * under the pointer now (`pick`), whatever the last move it was told of.
   */
  pointerAt(): [number, number] | null {
    return this.pointer.at
  }

  /**
   * Whether the person has a button down in the viewport: turning the camera,
   * dragging an arrow, a stroke or a handle of the gizmo. What would change
   * the view under them waits.
   */
  pointerBusy(): boolean {
    return this.pointer.busy
  }

  /**
   * Calls back as the person moves the camera with the pointer: a drag that turns or pans it, the wheel. Not for a
   * click that moves nothing, and not for a camera the viewport moves itself (a view key, Fit, a saved view). The
   * callback is told at every step of the move: it must be cheap and keep nothing in React.
   */
  onNavigated(cb: () => void): void {
    this.navigatedListeners.push(cb)
  }

  /** Calls back 150 ms after the camera stops moving, however it was moved. */
  onCameraSettled(cb: (c: Camera) => void): void {
    this.settledListeners.push(cb)
  }

  /**
   * A still picture for the agent, with an axis triad and a scale bar. It is
   * drawn off screen in one go: the user's camera, layout and the frame on
   * screen are left alone, and it works while the window is hidden. `size` is
   * the long edge in pixels. Named views are orthographic, 4:3 and fitted to the
   * parts shown; `current` is what the user sees.
   *
   * A request given as a function is asked for in the same turn as the drawing,
   * after every wait that comes before it: what it reads then (the scene on
   * show, its revision) is what the picture is of.
   */
  renderImage(request: ImageRequest | (() => ImageRequest)): Promise<Picture> {
    return this.pictures.render(request)
  }

  /**
   * A small picture of any scene, of the object on show or of another, drawn off screen with this viewport's
   * renderer (`ThumbnailMaker.render`): nothing on screen changes for it. Null for a scene with nothing to draw.
   */
  thumbnail(scene: Scene, blob: ArrayBuffer, view?: ThumbnailView): ReturnType<ThumbnailMaker['render']> {
    if (this.disposed || this.renderer.getContext().isContextLost()) return Promise.resolve(null)
    this.thumbnails ??= new ThumbnailMaker(this.renderer)
    return this.thumbnails.render(scene, blob, view)
  }

  /** Matches the drawing buffer to the canvas's size on the page. Call when the canvas is resized. */
  resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width === 0 || height === 0) return
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(width, height, false)
    this.overlay.resize(width, height)
    this.aspect = width / height
    // Resizing clears the canvas: draw now rather than show a blank frame.
    this.draw()
  }

  dispose(): void {
    this.disposed = true
    if (this.frame) cancelAnimationFrame(this.frame)
    clearTimeout(this.settleTimer)
    this.settledListeners.length = 0
    this.navigatedListeners.length = 0
    this.drawnListeners.clear()
    this.sectionListeners.clear()
    this.pointer.dispose()
    this.scheme?.removeEventListener('change', this.onSchemeChange)
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.controls.dispose()
    this.gizmo.dispose()
    this.section.dispose()
    this.sketchSheet.dispose()
    this.ghosts.end(false)
    this.earlier.clear()
    this.later.clear()
    this.scans.dispose()
    for (const entry of this.entries.values()) this.discard(entry)
    this.entries.clear()
    this.highlights.dispose()
    this.marks.dispose()
    this.overlay.dispose()
    this.ground.geometry.dispose()
    this.ground.material.dispose()
    this.pictures.dispose()
    this.thumbnails?.dispose()
    this.renderer.dispose()
  }

  // ---- parts ----

  private discard(entry: Entry): void {
    this.highlights.forget(entry.built)
    this.section.forget(entry.built)
    this.scene.remove(entry.built.group)
    disposePart(entry.built)
  }

  /** Brings every part's look and the ground in line with the current layout, layers and theme. */
  private refresh(): void {
    for (const entry of this.entries.values()) this.applyLook(entry)
    // Other parts, or parts built anew: drawn apart by the explode there is, until whoever knows this layout's says.
    this.apart.over(this.partsOf(this.layout))
    this.placeParts()
    this.scans.set(this.scanInfos, this.layout) // a scan stands elsewhere in another layout, or is not aligned there
    this.groundExtent = this.rebuildGround(this.layout)
    // The parts may have moved, and the plane is laid across those of this layout.
    this.cutBy(this.section.get(), this.layout, true)
    this.showMarks()
    this.extent = this.measured()
    this.highlights.apply(this.partNamed) // the refs may name other geometry now, or none
    this.tintPicks(this.layout)
    this.gizmo.place() // a shape of another layout is not there to hold
  }

  /**
   * Tints what a layout's pick marks are on, in their authors' colours. A ref
   * that names nothing in the scene as it is now (a face that is gone, a part
   * that is) tints nothing: the mark is still drawn at its point.
   */
  private tintPicks(layout: string): void {
    const refs = this.marks.pickRefs(layout)
    const partNamed = (name: string): BuiltPart | undefined => this.entries.get(`${layout}:${name}`)?.built
    this.highlights.set('userMark', refs.user)
    this.highlights.set('agentMark', refs.agent)
    for (const layer of MARK_LAYERS) this.highlights.apply(partNamed, layer)
  }

  private labelStyle(): LabelStyle {
    return { user: this.theme.user, agent: this.theme.agent, paper: this.theme.panel, surface: this.theme.surface, ink: this.theme.ink }
  }

  private highlight(layer: HighlightLayer, refs: string[]): void {
    if (!this.highlights.set(layer, refs)) return
    this.highlights.apply(this.partNamed, layer)
    this.invalidate()
  }

  /** A part of the layout shown, by name. */
  private readonly partNamed = (name: string): BuiltPart | undefined => this.entries.get(`${this.layout}:${name}`)?.built

  /** A point of the window as the camera sees it: -1 to 1 across the canvas, y up. Null while the canvas has no size. */
  private canvasPoint(clientX: number, clientY: number): { ndc: { x: number; y: number }; size: { width: number; height: number } } | null {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const ndc = { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: 1 - ((clientY - rect.top) / rect.height) * 2 }
    return { ndc, size: { width: rect.width, height: rect.height } }
  }

  /** Brings the matrices that picking reads up to date: a frame may not have been drawn since they changed. */
  private syncMatrices(): void {
    setProjection(this.camera, this.controls.target, this.fov, this.aspect, this.extent)
    this.camera.updateMatrixWorld()
    this.scene.updateMatrixWorld()
  }

  private applyLook(entry: Entry): void {
    const { part, built } = entry
    const layer = this.layers.get(part.key)
    const base = toHex(layer?.color ?? this.colors.get(part.name) ?? colorFor(part.name, -1))
    const surface = toHex(this.theme.surface)
    const fade = (hex: string) => (this.stale ? mix(hex, surface, STALE_FADE) : hex)
    built.mesh.material.color.set(fade(base))
    built.edges.material.color.set(fade(edgeTint(base)))

    const own = Math.min(Math.max(layer?.opacity ?? 1, 0), 1)
    // X-ray (a sketch's): see-through, never more opaque than the part is by its own setting.
    const opacity = this.xray ? Math.min(own, XRAY_OPACITY) : own
    for (const material of [built.mesh.material, built.edges.material]) {
      // The edges stay readable through a part that is see-through: twice as opaque.
      const shown = this.xray && material === built.edges.material ? Math.min(own, XRAY_OPACITY * 2) : opacity
      const transparent = shown < 1
      if (material.transparent !== transparent) material.needsUpdate = true
      material.transparent = transparent
      material.opacity = shown
      material.depthWrite = !transparent
    }
    this.section.look(built, fade(base), opacity, fade(edgeTint(base)))
    built.group.visible = part.layout === this.layout && layer?.visible !== false
  }

  /** Parts of the current layout that are switched on. */
  private shownParts(): Part[] {
    return [...this.entries.values()].filter((e) => e.built.group.visible).map((e) => e.part)
  }

  /** What `fit` and the named views frame: the parts shown, else the whole layout, where they are drawn (or are on their way to). */
  private visibleBox(): { min: number[]; max: number[] } {
    const going = this.apart.target()
    return drawnBox(this.shownParts(), going) ?? drawnBox(this.partsOf(this.layout), going) ?? EMPTY_BOX
  }

  private partsOf(layout: string): Part[] {
    return [...this.entries.values()].filter((e) => e.part.layout === layout).map((e) => e.part)
  }

  // ---- ground and theme ----

  /** Lays the grid under a layout's parts, on the lowest z of the layout, and returns a sphere around the parts and the grid. */
  private rebuildGround(layout: string): THREE.Sphere {
    const { points, step, extent } = groundOf(boxOf(this.partsOf(layout)) ?? EMPTY_BOX)
    this.gridStepMm = step
    this.ground.geometry.dispose()
    this.ground.geometry = new THREE.BufferGeometry()
    this.ground.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    return extent
  }

  private readTheme(): void {
    this.theme = themeOf()
    // The axes keep their usual colours, toned to the palette; the handle under the pointer is ink, like anything pressed.
    this.gizmo.setColours(toHex(this.theme.axisX), toHex(this.theme.axisY), toHex(this.theme.axisZ), toHex(this.theme.ink))
    this.highlights.setColors(this.theme)
    this.marks.setColours(markColours(this.theme))
    this.section.setColours(toHex(this.theme.muted), toHex(this.theme.accent))
    this.earlier.tint(toHex(this.theme.muted), toHex(this.theme.ink))
    this.later.tint(toHex(this.theme.muted), toHex(this.theme.ink))
    this.lookOfScans()
    this.showMarks()
    this.scene.background = new THREE.Color(this.theme.surface)
    this.ground.material.color.set(this.theme.hairline)
  }

  private readonly onSchemeChange = (): void => {
    this.readTheme()
    for (const entry of this.entries.values()) this.applyLook(entry) // stale parts fade towards the surface
    this.invalidate()
  }

  // ---- camera ----

  /** A camera on screen that looks along `dir` and frames `box` in what the bars over the canvas leave of it. */
  private onScreen(box: { min: number[]; max: number[] }, { dir, up }: { dir: number[]; up: number[] }, ortho: boolean): Camera {
    const [width, height] = [this.canvas.clientWidth, this.canvas.clientHeight]
    if (width === 0 || height === 0) return fitCamera(box, dir, up, this.aspect, this.fov, ortho)
    return fitBelow(box, dir, up, width, height, this.coveredTop, this.fov, ortho)
  }

  private namedCamera(name: ViewName, box: { min: number[]; max: number[] }, aspect: number, ortho: boolean): Camera {
    const { dir, up } = viewDirection(name)
    return fitCamera(box, dir, up, aspect, this.fov, ortho)
  }

  private applyCamera(c: Camera): void {
    const camera = c.ortho ? this.orthographic : this.perspective
    const { position, target } = standingAt(c)
    camera.position.copy(position)
    camera.zoom = c.zoom
    this.fov = c.fov
    this.camera = camera
    this.gizmo.setCamera(camera)
    this.controls.object = camera
    this.controls.target.copy(target)
    this.controls.update()
    this.onCameraChange()
  }

  /** The person takes over from a camera move: it stops where it is, and the press is answered from the camera as it is. */
  private readonly onControlStart = (): void => {
    this.navigating = true
    this.fittedSelection = null
    this.move.drop()
    // A turn is about what is under the pointer when it starts: only the target moves, along the view.
    // Not at once: a tool that takes the press holds the orbit just after it, and then nothing turns and the target stays.
    // At the first move that the orbit is still on for.
    const down = this.lastDown
    this.pivotPending = down && down.button === 0 ? down : null
  }

  private readonly onPivotMove = (): void => {
    const down = this.pivotPending
    if (!down || !this.controls.enabled) return
    this.pivotPending = null
    this.pivotAt(down.x, down.y)
  }

  private pivotAt(clientX: number, clientY: number): void {
    const hit = this.pick(clientX, clientY, { edges: false })
    const at = this.canvasPoint(clientX, clientY)
    if (!hit || !at) return
    const ray = pointerRay(this.camera, at.ndc)
    const point: Vec3 = [0, 1, 2].map((i) => ray.origin[i] + ray.direction[i] * hit.distance) as Vec3
    const forward = this.camera.getWorldDirection(new THREE.Vector3()).toArray() as Vec3
    const target = pivotOn(this.camera.position.toArray() as Vec3, forward, point)
    if (target) this.controls.target.fromArray(target)
  }

  private readonly onControlEnd = (): void => {
    this.navigating = false
    this.pivotPending = null
  }

  private readonly onCameraChange = (): void => {
    if (this.navigating) for (const cb of this.navigatedListeners) cb()
    // Keep the projection current between frames too: zooming to the cursor reads it.
    setProjection(this.camera, this.controls.target, this.fov, this.aspect, this.extent)
    this.invalidate()
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      const camera = this.getCamera()
      for (const cb of this.settledListeners) cb(camera)
    }, SETTLE_MS)
  }

  private aimKeyLight(camera: THREE.Camera, target: THREE.Vector3): void {
    aimKeyLight(this.keyLight, camera, target)
  }

  /** A camera of its own for a picture of a view, with its frustum around `extent`; the key light is aimed along it. */
  private pictureCamera(view: Camera, aspect: number, extent: THREE.Sphere): AnyCamera {
    const camera = this.cameraFor(view, aspect, extent)
    this.aimKeyLight(camera, new THREE.Vector3().fromArray(view.target))
    return camera
  }

  /** A three.js camera of a view, with its frustum around `extent` and its matrices current. */
  private cameraFor(view: Camera, aspect: number, extent: THREE.Sphere): AnyCamera {
    const camera: AnyCamera = view.ortho ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera()
    camera.up.fromArray(view.up)
    camera.position.fromArray(view.position)
    camera.zoom = view.zoom
    const target = new THREE.Vector3().fromArray(view.target)
    camera.lookAt(target)
    setProjection(camera, target, view.fov, aspect, extent)
    camera.updateMatrixWorld()
    return camera
  }

  // ---- drawing ----

  /**
   * Whether the view is covered by the board (`ViewportPane`): no frame is asked for while it is, and the one asked for
   * is let go. What changed meanwhile is drawn in the one frame that is asked for when it is shown again.
   */
  private held = false

  get paused(): boolean {
    return this.held
  }

  set paused(on: boolean) {
    if (on === this.held) return
    this.held = on
    if (on) {
      if (this.frame) cancelAnimationFrame(this.frame)
      this.frame = 0
    } else {
      this.invalidate()
    }
  }

  /** Asks for one frame. Any number of changes before it share that frame. */
  private invalidate(): void {
    if (this.frame || this.disposed || this.held) return
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0
      const next = this.move.step(now)
      if (next) this.applyCamera(next)
      // The parts on their way apart or together: a step with every frame, and nothing of it through React.
      if (this.apart.step(now)) this.placeParts()
      const ghosting = this.ghosts.step(now)
      this.draw()
      if (this.move.under || this.apart.moving || ghosting) this.invalidate()
    })
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault()
  }

  /** three.js has made its GPU state again by now; the canvas is blank until something draws. */
  private readonly onContextRestored = (): void => {
    this.invalidate()
  }

  private draw(): void {
    if (this.disposed) return
    const split = this.split
    // Side by side each half is as wide as half the view: the same camera, framed for that.
    setProjection(this.camera, this.controls.target, this.fov, split ? this.aspect / 2 : this.aspect, this.extent)
    this.aimKeyLight(this.camera, this.controls.target)
    const size = { width: this.canvas.clientWidth, height: this.canvas.clientHeight }
    this.camera.updateMatrixWorld()
    this.marks.update(this.camera, size)
    this.section.sizeHandle((at) => mmPerPx(this.camera, at, size.height))
    this.sketchSheet.size((at) => mmPerPx(this.camera, at, size.height))
    this.section.outline()
    if (split) {
      const half = size.width / 2
      this.renderer.setScissorTest(true)
      for (const [x, show] of [[0, 'before'], [half, 'after']] as const) {
        this.renderer.setViewport(x, 0, half, size.height)
        this.renderer.setScissor(x, 0, half, size.height)
        this.renderScene(show)
      }
      this.renderer.setScissorTest(false)
      this.renderer.setViewport(0, 0, size.width, size.height)
      this.overlay.split(size)
    } else {
      // Before: the earlier build alone. After: the later one (the live build unless one stands in for it), with nothing over it. Overlay: both.
      const mode = this.earlier.on ? this.compareMode : null
      this.renderScene(mode === 'before' ? 'before' : mode === 'overlay' ? 'both' : 'after')
      // The chips of the marks are of the live build: not over another.
      this.overlay.hideChips = this.later.on || mode === 'before'
      this.overlay.draw(size)
    }
    for (const cb of this.drawnListeners) cb()
  }

  /**
   * One frame of the scene: `before` the earlier build alone, `after` the later alone, `both` the earlier over the later. The later
   * one is the live build, or the build standing in for it (`setLater`): then the live parts, marks, ghosts and scans are left out
   * of the frame, never taken down.
   */
  private renderScene(show: 'before' | 'after' | 'both'): void {
    const left: THREE.Object3D[] = []
    const out = (o: THREE.Object3D): void => {
      if (!o.visible) return
      o.visible = false
      left.push(o)
    }
    if (show === 'before' || this.later.on) {
      for (const entry of this.entries.values()) out(entry.built.group)
      out(this.marks.group)
      out(this.ghosts.group)
      out(this.scans.group)
    }
    if (show === 'after') out(this.earlier.group)
    if (show === 'before') out(this.later.group)
    try {
      this.renderer.render(this.scene, this.camera)
    } finally {
      for (const o of left) o.visible = true
    }
  }
}

/**
 * Sets a camera's frustum for a view of `target`. An orthographic camera shows
 * what a perspective one at the same place would show at the target (three.js
 * then divides by `camera.zoom`), which is the rule `visibleHeight` states. The
 * clip planes hug `extent`, so depth precision follows the size of the scene.
 */
function setProjection(camera: AnyCamera, target: THREE.Vector3, fovDeg: number, aspect: number, extent: THREE.Sphere): void {
  const reach = camera.position.distanceTo(extent.center)
  const radius = extent.radius * 1.05
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = fovDeg
    camera.aspect = aspect
    camera.far = reach + radius
    camera.near = Math.max(reach - radius, camera.far / 5000)
  } else {
    const half = camera.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)
    camera.top = half
    camera.bottom = -half
    camera.right = half * aspect
    camera.left = -half * aspect
    camera.near = reach - radius // may be negative: an orthographic camera can sit inside the scene
    camera.far = reach + radius
  }
  camera.updateProjectionMatrix()
}

/** The box around some parts, in the object frame, or null for none. */
/** A box round a box and one of three.js's, either of which may be none. */
function withBox(box: { min: number[]; max: number[] } | null, also: THREE.Box3 | null): { min: number[]; max: number[] } | null {
  if (!also) return box
  if (!box) return { min: also.min.toArray(), max: also.max.toArray() }
  return { min: box.min.map((c, i) => Math.min(c, also.min.getComponent(i))), max: box.max.map((c, i) => Math.max(c, also.max.getComponent(i))) }
}

function boxOf(parts: Part[]): { min: number[]; max: number[] } | null {
  if (parts.length === 0) return null
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const part of parts) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], part.bbox.min[i])
      max[i] = Math.max(max[i], part.bbox.max[i])
    }
  }
  return { min, max }
}
