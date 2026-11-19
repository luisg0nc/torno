import * as THREE from 'three'
import type { Vec3 } from '../../shared/marks'
import { edgeTint } from '../../shared/palette'
import type { Scene } from '../../shared/scene'
import type { ThumbnailOf } from '../../shared/show'
import { THUMB_HEIGHT, THUMB_WIDTH, type ThumbnailPlan, type ThumbnailView, thumbnailPlan } from '../../shared/thumbnail'
import { drawnAt } from './explode'
import { aimKeyLight, makeLights } from './lights'
import { type BuiltPart, buildPart, disposePart } from './partMesh'
import { Encoder, pngOf } from './picture'
import { SectionCut } from './section'
import { toHex } from './theme'
import { DEFAULT_FOV, benchFits, fitCamera, viewDirection } from './views'

export { THUMB_HEIGHT, THUMB_WIDTH, thumbnailLayout, thumbnailPlan, type ThumbnailPlan, type ThumbnailView } from '../../shared/thumbnail'

// The picture on an object's card: a small scene of its own, drawn off screen with the viewport's renderer from a
// build main has already broadcast. The object need not be the one on show, and nothing on screen changes for it.
// Only parts are in it: no mark, no scan (a scan may show the real world), no grid, no gizmo, and a clear ground,
// so that one picture sits on the card's own surface in either theme. The parts' colours are the same in both.
// What it draws is `shared/thumbnail.ts` `thumbnailPlan`'s to say.
// It draws at the bench's scale (orthographic, `BENCH_MM_PER_PX`) when the layout fits, else fitted to its parts in perspective.

/** How much of the picture's half width or height the parts reach, from its middle. */
const FILL = 0.86

/**
 * One pair of the materials of the last picture, kept alive. three.js drops a program when the last material that used it
 * is disposed, and each picture makes its parts' materials anew and disposes them: with none kept, every picture compiled
 * its programs again. Free on a GPU, seconds of the window's time with none (software GL), where the window waits for the compile.
 */
export class WarmMaterials {
  private held: { mesh: THREE.Material; edges: THREE.Material } | null = null

  /** Holds these, and lets go of the pair held before (after, so that the program they share is never without one). */
  keep(next: { mesh: THREE.Material; edges: THREE.Material }): void {
    const before = this.held
    this.held = next
    before?.mesh.dispose()
    before?.edges.dispose()
  }

  dispose(): void {
    this.held?.mesh.dispose()
    this.held?.edges.dispose()
    this.held = null
  }
}

export class ThumbnailMaker {
  private readonly stage = new THREE.Scene()
  private readonly lights = makeLights()
  private readonly encoder = new Encoder()
  // As a picture for the agent is drawn: linear light in half floats, with a stencil for the cut faces of a section.
  private readonly drawn = new THREE.WebGLRenderTarget(THUMB_WIDTH, THUMB_HEIGHT, { samples: 4, type: THREE.HalfFloatType, stencilBuffer: true })
  private readonly encoded = new THREE.WebGLRenderTarget(THUMB_WIDTH, THUMB_HEIGHT, { depthBuffer: false })
  private readonly warm = new WarmMaterials()

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.stage.add(this.lights.sky, this.lights.key, this.lights.key.target)
  }

  /**
   * A picture of the parts of one layout of any scene, as `thumbnailPlan` has them, seen from the standard iso
   * view, on a clear ground: parts and their edges, nothing else. Null for a scene with no part to draw.
   * Everything up to the encoding of the PNG happens at once, and the renderer is left as it was found.
   */
  async render(scene: Scene, blob: ArrayBuffer, view?: ThumbnailView): Promise<({ png: Uint8Array } & ThumbnailOf) | null> {
    const plan = thumbnailPlan(scene, view, { bench: true })
    if (!plan) return null
    // At the bench's scale when the layout, as built, is within the picture at it and the parts are where they are
    // built (apart, the picture is larger than the size it is told with); else fitted to its parts, as before.
    const [lo, hi] = [plan.layoutBox.min, plan.layoutBox.max]
    const bench = plan.bench && plan.explode === null && benchFits({ x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] }) ? plan.bench : null
    const renderer = this.renderer
    const was = { target: renderer.getRenderTarget(), colour: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), planes: renderer.clippingPlanes }
    const built: BuiltPart[] = []
    const cut = plan.section ? new SectionCut() : null
    let encoding: Promise<Uint8Array>
    try {
      for (const part of plan.parts) {
        const one = buildPart(part, blob, { tree: false })
        built.push(one)
        const look = plan.looks[part.key]
        const colour = toHex(look.color)
        const see = look.opacity < 1
        one.mesh.material.color.set(colour)
        one.edges.material.color.set(edgeTint(colour))
        for (const material of [one.mesh.material, one.edges.material]) {
          material.transparent = see
          material.opacity = look.opacity
          material.depthWrite = !see
        }
        one.group.position.fromArray(drawnAt(part, plan.offsets))
        one.group.updateMatrix()
        this.stage.add(one.group)
        cut?.add(one)
        cut?.look(one, colour, look.opacity, edgeTint(colour))
      }
      if (cut) {
        // The plane itself is not in a picture: the parts are cut, and their cut faces drawn.
        cut.showDecor(false)
        cut.set(plan.section, plan.layoutBox)
        cut.outline()
      }
      const camera = bench ? benchCameraFor(plan.layoutBox, bench) : cameraFor(plan.box)
      aimKeyLight(this.lights.key, camera, new THREE.Vector3(...centreOf(bench ? plan.layoutBox : plan.box)))
      renderer.setRenderTarget(this.drawn)
      renderer.setClearColor(0x000000, 0)
      renderer.clippingPlanes = []
      renderer.render(this.stage, camera)
      // The read is asked for here, while the target holds the picture; the pixels come when the GPU has them (nothing waits on it), and then the PNG is written.
      encoding = pngOf(renderer, this.encoder, this.drawn, this.encoded, { alpha: true })
    } finally {
      renderer.setRenderTarget(was.target)
      renderer.setClearColor(was.colour, was.alpha)
      renderer.clippingPlanes = was.planes
      cut?.dispose()
      // The first part's materials are kept for the next picture (`WarmMaterials`); the rest are let go as before.
      const [first, ...rest] = built
      for (const one of built) this.stage.remove(one.group)
      if (first) {
        first.mesh.geometry.boundsTree = undefined
        first.mesh.geometry.dispose()
        first.edges.geometry.dispose()
        this.warm.keep({ mesh: first.mesh.material, edges: first.edges.material })
      }
      for (const one of rest) disposePart(one)
    }
    const of: ThumbnailOf = { layout: plan.layout, parts: plan.parts.length }
    if (plan.section) of.cut = true
    if (plan.explode) of.apart = true
    if (plan.hidden > 0) of.hidden = plan.hidden
    if (bench) of.bench = true
    return { png: await encoding, ...of }
  }

  dispose(): void {
    this.warm.dispose()
    this.drawn.dispose()
    this.encoded.dispose()
    this.encoder.dispose()
  }
}

const centreOf = (box: { min: number[]; max: number[] }): Vec3 => [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2]

/**
 * The bench's camera: orthographic, looking as the standard view does, at a fixed millimetres to the pixel and
 * centred on the box of the layout as built, so that a picture's size in pixels is the box's, projected, over
 * the scale. The same for every project: nothing is fitted.
 */
function benchCameraFor(box: { min: number[]; max: number[] }, bench: NonNullable<ThumbnailPlan['bench']>): THREE.OrthographicCamera {
  const { dir, up } = viewDirection(bench.view)
  const halfWidth = (THUMB_WIDTH / 2) * bench.mmPerPx
  const halfHeight = (THUMB_HEIGHT / 2) * bench.mmPerPx
  const target = new THREE.Vector3(...centreOf(box))
  const radius = Math.max(Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2, 0.5)
  const reach = radius * 2
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, reach - radius * 1.05, reach + radius * 1.05)
  camera.up.fromArray(up)
  camera.position.copy(target).addScaledVector(new THREE.Vector3(...dir), -reach)
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return camera
}

/**
 * The standard iso view, in perspective, of what is in a box: fitted to the sphere round it (`fitCamera`), then
 * brought nearer until the box itself reaches `FILL` of the picture, so that a flat or a long part is not a
 * speck in the middle of its card.
 */
function cameraFor(box: { min: number[]; max: number[] }): THREE.PerspectiveCamera {
  const aspect = THUMB_WIDTH / THUMB_HEIGHT
  const { dir, up } = viewDirection('iso')
  const view = fitCamera(box, dir, up, aspect, DEFAULT_FOV, false)
  const camera = new THREE.PerspectiveCamera(view.fov, aspect)
  camera.up.fromArray(view.up)
  const target = new THREE.Vector3().fromArray(view.target)
  const from = new THREE.Vector3().fromArray(view.position).sub(target)
  const radius = Math.max(Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2, 0.5)
  const corner = new THREE.Vector3()
  const place = (): void => {
    camera.position.copy(target).add(from)
    camera.lookAt(target)
    const reach = from.length()
    camera.far = reach + radius * 1.05
    camera.near = Math.max(reach - radius * 1.05, camera.far / 5000)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }
  place()
  for (let pass = 0; pass < 3; pass++) {
    let reached = 0
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]).project(camera)
      reached = Math.max(reached, Math.abs(corner.x), Math.abs(corner.y))
    }
    // Never nearer than the sphere round the box allows, and not at all for a box with no size.
    if (!(reached > 1e-6) || !Number.isFinite(reached)) break
    from.multiplyScalar(Math.max(reached / FILL, (radius * 1.2) / from.length()))
    place()
  }
  return camera
}
