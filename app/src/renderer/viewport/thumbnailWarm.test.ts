import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { WarmMaterials } from './thumbnail'

const pair = () => ({ mesh: new THREE.MeshStandardMaterial(), edges: new THREE.LineBasicMaterial() })
/** Counts the `dispose` events three.js hears, which is what has it let go of the program a material used. */
const watched = (p: ReturnType<typeof pair>) => {
  const gone: string[] = []
  p.mesh.addEventListener('dispose', () => gone.push('mesh'))
  p.edges.addEventListener('dispose', () => gone.push('edges'))
  return gone
}

describe('WarmMaterials', () => {
  it('keeps one pair of materials alive between pictures, so that their programs are not compiled again for the next', () => {
    const warm = new WarmMaterials()
    const first = pair()
    const firstGone = watched(first)
    warm.keep(first)
    expect(firstGone).toEqual([])
    const second = pair()
    const secondGone = watched(second)
    warm.keep(second)
    // The one before is let go only once the next is held, and the next stays.
    expect(firstGone.sort()).toEqual(['edges', 'mesh'])
    expect(secondGone).toEqual([])
    warm.dispose()
    expect(secondGone.sort()).toEqual(['edges', 'mesh'])
  })

  it('lets go of nothing twice', () => {
    const warm = new WarmMaterials()
    const one = pair()
    const gone = watched(one)
    warm.keep(one)
    warm.dispose()
    warm.dispose()
    expect(gone).toHaveLength(2)
  })
})
