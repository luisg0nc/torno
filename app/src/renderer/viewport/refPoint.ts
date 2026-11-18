import * as THREE from 'three'
import type { BuiltPart } from './partMesh'
import { parseRef } from './picking'
import { selectionBox } from './selectionBox'

type Vec3 = [number, number, number]

/**
 * A point of the object frame on what one ref names (`lid/F12`, `lid/E3`, `lid`), as it is drawn: for a face, the middle of the
 * triangle nearest the middle of its box (a ring's middle is empty, so the box's own would end in the air); for an edge, the middle
 * of its segment nearest that; for a part, the middle of its box. It is where a borrowed leader ends. Null when nothing is drawn for it.
 */
export function refPoint(partNamed: (name: string) => BuiltPart | undefined, ref: string): Vec3 | null {
  const box = selectionBox(partNamed, [ref])
  if (!box) return null
  const centre = new THREE.Vector3(...box.min).add(new THREE.Vector3(...box.max)).multiplyScalar(0.5)
  const { part, kind, index } = parseRef(ref)
  const built = partNamed(part)
  if (kind === 'part' || !built) return centre.toArray() as Vec3
  built.group.updateWorldMatrix(true, false)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const here = new THREE.Vector3()
  let best: THREE.Vector3 | null = null
  let nearest = Infinity
  const consider = (p: THREE.Vector3): void => {
    const d = p.distanceToSquared(centre)
    if (d < nearest) {
      nearest = d
      best = p.clone()
    }
  }
  if (kind === 'edge') {
    const positions = built.edges.geometry.getAttribute('position')
    for (let i = built.edgeStarts[index]; i < built.edgeStarts[index + 1]; i++) {
      a.fromBufferAttribute(positions, i * 2).applyMatrix4(built.group.matrixWorld)
      b.fromBufferAttribute(positions, i * 2 + 1).applyMatrix4(built.group.matrixWorld)
      consider(here.copy(a).add(b).multiplyScalar(0.5))
    }
  } else {
    const positions = built.mesh.geometry.getAttribute('position')
    const indices = built.mesh.geometry.getIndex()
    const at = (i: number): number => (indices ? indices.getX(i) : i)
    for (let i = built.faceStarts[index]; i + 2 < built.faceStarts[index + 1]; i += 3) {
      a.fromBufferAttribute(positions, at(i)).applyMatrix4(built.group.matrixWorld)
      b.fromBufferAttribute(positions, at(i + 1)).applyMatrix4(built.group.matrixWorld)
      c.fromBufferAttribute(positions, at(i + 2)).applyMatrix4(built.group.matrixWorld)
      consider(here.copy(a).add(b).add(c).multiplyScalar(1 / 3))
    }
  }
  return best ? ((best as THREE.Vector3).toArray() as Vec3) : (centre.toArray() as Vec3)
}
