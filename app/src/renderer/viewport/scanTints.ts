import * as THREE from 'three'
import { type SetWatcher, PaintedIndex, TriangleSet, tintIndex } from './scanPaint'
import { hatched } from './marks/hatch'
import type { BuiltScan } from './scanMesh'
import { LIGHT_THEME } from './theme'

/** A region that was kept, as the window draws it: its mark's number, its scan, who made it, and its triangles as the bits of its mask. It is of its scan in every layout. */
export interface KeptRegion { id: string; scan: string; author: 'user' | 'agent'; bits: Uint8Array; /** The person does not want it: it is hatched, in its author's colour. */ dont?: boolean }

/** How much of a mark's colour a region lays over its scan: the scan's own colours stay readable under it. */
export const REGION_OPACITY = 0.4
/** What is being painted is a step stronger than what was kept: it is what the hand is on. */
export const PAINT_OPACITY = 0.55

type Tint = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>

/**
 * What is laid over the scans: the regions that were kept, and the set being painted. Each is one mesh over
 * its scan's own positions, with an index of its own, in the scan's group: it stands where the scan stands, is
 * drawn only while the scan is, and is cut by the section with it. Never a second copy of a scan, and nothing
 * here goes through a scan's own materials. Tints are drawn and never picked.
 *
 * The set being painted is drawn from an index with room for every triangle, of which a stroke writes only the
 * slots of the triangles it touched (`PaintedIndex`); `touched()` sends those stretches and no more.
 */
export class ScanTints {
  private regions: KeptRegion[] = []
  /** The meshes of the kept regions that are drawn, by mark id, each with what it was made of. */
  private readonly kept = new Map<string, { of: KeptRegion; built: BuiltScan; mesh: Tint }>()
  /** The set in hand, whether or not its scan's mesh is there to draw it on. */
  private inHand: { scan: string; set: TriangleSet } | null = null
  private painting: { scan: string; set: TriangleSet; index: PaintedIndex; attribute: THREE.BufferAttribute; built: BuiltScan; mesh: Tint } | null = null
  /** The mark colours of the light tokens until the theme is told (`setColours`): a region is a mark, and has no colour of its own. */
  private colours = { user: LIGHT_THEME.user, agent: LIGHT_THEME.agent }
  private planes: THREE.Plane[] | null = null
  /** While a picture is made: whether it draws the marks. The set in hand is in no picture. */
  private pictured: { regions: boolean } | null = null

  constructor(
    private readonly redraw: () => void,
    private readonly builtOf: (scan: string) => BuiltScan | null
  ) {}

  /** The colours of the person's marks and of the agent's: a region is a mark. */
  setColours(colours: { user: string; agent: string }): void {
    this.colours = colours
    for (const { of, mesh } of this.kept.values()) mesh.material.color.set(colours[of.author])
    this.painting?.mesh.material.color.set(colours.user)
  }

  setClipping(planes: THREE.Plane[] | null): void {
    this.planes = planes
    for (const { mesh } of this.kept.values()) mesh.material.clippingPlanes = planes
    if (this.painting) this.painting.mesh.material.clippingPlanes = planes
  }

  /** While a picture is made, whether it draws the marks: the regions are tinted with them. Null on screen, where they always are. */
  show(pictured: { regions: boolean } | null = null): void {
    this.pictured = pictured
    for (const { mesh } of this.kept.values()) mesh.visible = this.shows()
    if (this.painting) this.painting.mesh.visible = pictured === null
  }

  /** The regions kept: those whose scan's mesh is there are drawn, the others once it has come (`sync`). */
  setRegions(regions: KeptRegion[]): void {
    this.regions = regions
    this.sync()
    this.redraw()
  }

  /**
   * Brings what is drawn in line with the regions there are and the meshes that have come: called when either
   * changes. A region whose bits are not of its scan's mesh as it now is (another triangle count) is not drawn.
   */
  sync(): void {
    const wanted = new Map(this.regions.map((region) => [region.id, region]))
    for (const [id, drawn] of this.kept) {
      const now = wanted.get(id)
      if (now && now.bits === drawn.of.bits && now.scan === drawn.of.scan && (now.dont === true) === (drawn.of.dont === true) && this.builtOf(now.scan) === drawn.built) {
        drawn.of = now
        drawn.mesh.material.color.set(this.colours[now.author])
        drawn.mesh.visible = this.shows()
        continue
      }
      this.drop(drawn.mesh)
      this.kept.delete(id)
    }
    for (const region of this.regions) {
      if (this.kept.has(region.id)) continue
      const built = this.builtOf(region.scan)
      if (!built || region.bits.length !== Math.ceil(built.triangles / 8)) continue
      const index = tintIndex(new TriangleSet(built.triangles, region.bits), built.mesh.geometry.index!.array)
      const mesh = this.tint(built, new THREE.BufferAttribute(index, 1), this.colours[region.author], REGION_OPACITY)
      if (region.dont) hatched(mesh.material)
      mesh.geometry.setDrawRange(0, index.length)
      mesh.visible = this.shows()
      this.kept.set(region.id, { of: region, built, mesh })
    }
    // The set in hand is drawn on the mesh its scan has: let go of, it is not drawn; come (back), it is, whenever
    // the set is of that mesh's triangles.
    if (this.painting && this.builtOf(this.painting.scan) !== this.painting.built) this.stopPainting()
    this.startPainting()
  }

  /**
   * The set being painted on a scan, drawn as a tint in the person's mark colour; null for none. Redrawn when
   * `touched()` is called after it changed: only what changed is sent to the graphics card. While its scan's
   * mesh has not come, or is let go of, or the set is not of its triangles, nothing is drawn and `touched()`
   * does nothing; it is drawn, as it then is, once that mesh is there (`sync`).
   */
  paint(id: string | null, set: TriangleSet | null): { touched(): void } | null {
    this.stopPainting()
    this.inHand = id !== null && set ? { scan: id, set } : null
    const mine = this.inHand
    this.startPainting()
    this.redraw()
    if (!mine) return null
    return {
      touched: () => {
        const painting = this.painting
        if (this.inHand !== mine || !painting) return
        for (const [start, count] of painting.index.ranges()) painting.attribute.addUpdateRange(start, count)
        if (painting.attribute.updateRanges.length > 0) painting.attribute.needsUpdate = true
        painting.mesh.geometry.setDrawRange(0, painting.index.count * 3)
        this.redraw()
      }
    }
  }

  private startPainting(): void {
    if (!this.inHand || this.painting) return
    const { scan, set } = this.inHand
    const built = this.builtOf(scan)
    if (!built || set.triangles !== built.triangles) return
    const index = new PaintedIndex(built.mesh.geometry.index!.array, built.triangles)
    const attribute = new THREE.BufferAttribute(index.array, 1)
    attribute.setUsage(THREE.DynamicDrawUsage)
    const mesh = this.tint(built, attribute, this.colours.user, PAINT_OPACITY)
    mesh.visible = this.pictured === null
    index.fill(set)
    index.ranges()
    mesh.geometry.setDrawRange(0, index.count * 3)
    set.watch = index
    this.painting = { scan, set, index, attribute, built, mesh }
  }

  /** What is drawn, for whoever asks how things stand: the regions by mark id with how many triangles each draws, and the set in hand. */
  state(): { regions: Array<{ id: string; scan: string; triangles: number; visible: boolean; colour: string }>; painting: { scan: string; triangles: number; visible: boolean } | null } {
    return {
      regions: [...this.kept.values()].map(({ of, mesh }) => ({ id: of.id, scan: of.scan, triangles: mesh.geometry.drawRange.count / 3, visible: mesh.visible, colour: `#${mesh.material.color.getHexString()}` })),
      painting: this.painting && { scan: this.painting.scan, triangles: this.painting.index.count, visible: this.painting.mesh.visible }
    }
  }

  dispose(): void {
    this.stopPainting()
    for (const { mesh } of this.kept.values()) this.drop(mesh)
    this.kept.clear()
  }

  private shows(): boolean {
    return this.pictured?.regions !== false
  }

  private stopPainting(): void {
    if (!this.painting) return
    if (this.painting.set.watch === (this.painting.index as SetWatcher)) this.painting.set.watch = null
    this.drop(this.painting.mesh)
    this.painting = null
  }

  /** One mesh over a scan's own positions, drawn a hair nearer than the scan, which is pushed back, and never into the depth buffer. */
  private tint(built: BuiltScan, index: THREE.BufferAttribute, colour: string, opacity: number): Tint {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', built.mesh.geometry.getAttribute('position'))
    geometry.setIndex(index)
    const material = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, clippingPlanes: this.planes })
    const mesh: Tint = new THREE.Mesh(geometry, material)
    mesh.name = 'region'
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    // Tints are seen, never pointed at.
    mesh.raycast = () => {}
    built.group.add(mesh)
    return mesh
  }

  private drop(mesh: Tint): void {
    mesh.removeFromParent()
    // Its positions are the scan's own, and stay.
    mesh.geometry.deleteAttribute('position')
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
}
