import * as THREE from 'three'
import type { Part } from '../../shared/scene'
import { edgeTint } from '../../shared/palette'
import { buildPart, disposePart, type BuiltPart } from './partMesh'

/** How much of an earlier build shows through: the surfaces, and its edges. Enough to see where it stood, little enough to see the current build through it. */
export const EARLIER_SURFACE_OPACITY = 0.28
export const EARLIER_EDGE_OPACITY = 0.8

/**
 * An earlier build of the model, drawn over the current one for display only (#56): its parts where that build had
 * them, translucent and tinted, with their edges, in `--muted`: the colour of the old edges the ghosts of a build that
 * just landed show, and no mark's. Nothing here is pointed at (no bounds tree, no ray hits it), nothing measured from, nothing
 * a picture for the agent shows (`hide`), and nothing is written. It stays until it is cleared. The geometries it is given
 * are made here from the bytes of that build's meshes and disposed of at `clear`.
 */
export class Earlier {
  readonly group = new THREE.Group()
  private parts: Array<{ part: string; name: string; built: BuiltPart }> = []
  /** The colour of each part by name, as the build it is of had them: what it is drawn in when it stands in for the live build. */
  private colors: ReadonlyMap<string, string> | undefined
  /** Drawn alone, opaque, with edges in ink (Before, Side by side) rather than as a ghost over the live build. */
  private opaque = false
  private surfaceTint = ''
  private inkTint = ''

  constructor(name = 'earlier') {
    this.group.name = name
  }

  /** True while an earlier build is drawn. */
  get on(): boolean {
    return this.parts.length > 0
  }

  /** The keys of the parts drawn, in the order of the build. */
  keys(): string[] {
    return this.parts.map((p) => p.part)
  }

  /** Draws these parts of an earlier build (the ones of the layout shown), from the bytes of its meshes. Whatever was drawn before is put away first. */
  show(parts: readonly Part[], blob: ArrayBuffer, tint: string, colors?: ReadonlyMap<string, string>): void {
    this.clear()
    this.colors = colors
    this.surfaceTint = tint
    if (this.inkTint === '') this.inkTint = tint
    for (const part of parts) {
      const built = buildPart(part, blob, { tree: false })
      built.mesh.material.color.set(tint)
      built.mesh.renderOrder = 1
      built.mesh.raycast = () => {}
      built.edges.material.transparent = true
      built.edges.renderOrder = 2
      built.edges.raycast = () => {}
      this.group.add(built.group)
      this.parts.push({ part: part.key, name: part.name, built })
    }
    this.look()
  }

  /** The colour of what is drawn follows the theme: the surfaces' and, drawn alone, the edges' (`ink`, the surfaces' when not given). */
  tint(colour: string, ink: string = colour): void {
    this.surfaceTint = colour
    this.inkTint = ink
    this.look()
  }

  /** Drawn alone and opaque, as the live build is (`true`), or as a ghost over it. */
  solid(on: boolean): void {
    this.opaque = on
    this.look()
  }

  private look(): void {
    for (const { name, built } of this.parts) {
      // Opaque, a part is in its own colour when it has one (it stands in for the live build), else in the tint; a ghost is the tint, whatever the colours.
      const own = this.opaque ? this.colors?.get(name) : undefined
      built.mesh.material.color.set(own ?? this.surfaceTint)
      built.mesh.material.transparent = !this.opaque
      built.mesh.material.opacity = this.opaque ? 1 : EARLIER_SURFACE_OPACITY
      built.mesh.material.depthWrite = this.opaque
      built.mesh.material.needsUpdate = true
      built.edges.material.color.set(this.opaque ? (own ? edgeTint(own) : this.inkTint) : this.surfaceTint)
      built.edges.material.opacity = this.opaque ? 1 : EARLIER_EDGE_OPACITY
    }
  }

  /** Takes it out of what is drawn, and returns what puts it back (a picture is of the model alone). */
  hide(): () => void {
    const was = this.group.visible
    this.group.visible = false
    return () => {
      this.group.visible = was
    }
  }

  /** Puts it away and frees what it made. True when something was drawn. */
  clear(): boolean {
    const had = this.on
    for (const { built } of this.parts) {
      this.group.remove(built.group)
      disposePart(built)
    }
    this.parts = []
    return had
  }
}
