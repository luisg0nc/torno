import * as THREE from 'three'

/**
 * What the person does not want is hatched in the colour of whoever made it: diagonal stripes of that colour with the
 * surface showing between, drawn by the fragment shader from where the pixel is on the screen. No colour of its own, no
 * texture, nothing for a stylesheet to say: `hatch` takes the colour a mark already has (`viewport/theme.ts`).
 */
export const HATCH = { /** Pixels from one stripe to the next. */ period: 8, /** Pixels of that period that are drawn. */ line: 3 }

const KEY = 'torno-hatch'

/** Makes a material hatched, in place: the stripes are cut out of what it draws. Returns it. A clone of it is hatched again the same way. */
export function hatched<M extends THREE.MeshBasicMaterial>(material: M): M {
  material.userData.hatched = true
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `void main() {\n\tif (mod(gl_FragCoord.x + gl_FragCoord.y, ${HATCH.period}.0) > ${HATCH.line}.0) discard;`)
  }
  material.customProgramCacheKey = () => KEY
  return material
}

/** A see-through material in `colour`, hatched. */
export function hatch(colour: string, opacity = 1): THREE.MeshBasicMaterial {
  return hatched(new THREE.MeshBasicMaterial({ color: colour, opacity, transparent: true, depthWrite: false }))
}
