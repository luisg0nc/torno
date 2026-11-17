import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { HATCH, hatch, hatched } from './hatch'

describe('hatch', () => {
  it('is a see-through material in the colour it is given, and no other', () => {
    const material = hatch('#cf3f2c', 0.4)
    expect(`#${material.color.getHexString()}`).toBe('#cf3f2c')
    expect(material.opacity).toBe(0.4)
    expect(material.transparent).toBe(true)
    expect(material.userData.hatched).toBe(true)
  })

  it('keeps every other pixel of a stripe out of the fragment shader, by where it is on the screen', () => {
    const shader = { fragmentShader: 'void main() {\n  gl_FragColor = vec4(1.0);\n}' } as unknown as THREE.WebGLProgramParametersWithUniforms
    hatch('#cf3f2c').onBeforeCompile(shader, null as never)
    expect(shader.fragmentShader).toContain('gl_FragCoord')
    expect(shader.fragmentShader).toContain('discard')
    expect(shader.fragmentShader).toContain(`mod(gl_FragCoord.x + gl_FragCoord.y, ${HATCH.period}.0) > ${HATCH.line}.0`)
    expect(shader.fragmentShader.indexOf('discard')).toBeLessThan(shader.fragmentShader.indexOf('gl_FragColor'))
  })

  it('can make a material hatched in place, and a clone of it is made so again by whoever clones it', () => {
    const plain = new THREE.MeshBasicMaterial({ color: '#288156' })
    expect(plain.userData.hatched).toBeUndefined()
    expect(hatched(plain)).toBe(plain)
    expect(plain.userData.hatched).toBe(true)
    const twin = hatched(plain.clone())
    expect(typeof twin.onBeforeCompile).toBe('function')
    expect(twin.customProgramCacheKey()).toBe(plain.customProgramCacheKey())
  })
})
