import type { DrivenIn } from '../../shared/drives'

/** One face as the kernel tells it for a comparison (`face_prints`): type, area, centre, normal there, box. */
export interface FacePrint {
  type: string
  area: number
  center: [number, number, number]
  normal: [number, number, number] | null
  box: [[number, number, number], [number, number, number]]
}
/** The faces of each part of a layout, in the kernel's order. */
export type LayoutPrints = Record<string, FacePrint[]>

/** A move, or a change of size, smaller than this is the same face: millimetres, mm², and the same of a normal's components. */
const SAME = 1e-6

const near = (a: readonly number[], b: readonly number[]): boolean => a.every((x, i) => Math.abs(x - b[i]) <= SAME)

/** Whether a face is another face, or the same one somewhere else or of another size. */
export function changed(a: FacePrint, b: FacePrint): boolean {
  if (a.type !== b.type) return true
  if (Math.abs(a.area - b.area) > SAME * Math.max(1, a.area)) return true
  if (!near(a.center, b.center) || !near(a.box[0], b.box[0]) || !near(a.box[1], b.box[1])) return true
  return a.normal === null || b.normal === null ? a.normal !== b.normal : !near(a.normal, b.normal)
}

/**
 * What a nudged build changed of the build on show, face by face. A face is told by its place in the kernel's order
 * (`topo.faces`), which holds for the same model with another value as long as the part has the same faces of the same
 * types; where it does not (a count, a flag or a choice that adds or takes away faces), no face can be told and the part
 * is lit whole. A part the nudged build lacks, or one only it has, is a part that changed too (a part only the nudge has
 * is no part of the build on show, so it names nothing).
 */
export function compareBuilds(shown: LayoutPrints, nudged: LayoutPrints): DrivenIn {
  const faces: string[] = []
  const parts: string[] = []
  for (const [part, before] of Object.entries(shown)) {
    const after = nudged[part]
    if (!after || after.length !== before.length || after.some((f, i) => f.type !== before[i].type)) {
      parts.push(part)
      continue
    }
    before.forEach((face, i) => {
      if (changed(face, after[i])) faces.push(`${part}/F${i}`)
    })
  }
  return { faces, parts }
}
