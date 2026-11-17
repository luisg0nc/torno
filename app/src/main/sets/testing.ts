import type { Scene } from '../../shared/scene'
import type { SetStoreDeps } from './store'

/** What the tests of the sets share: a last build with two parts, and a store over a folder per project. */
export const part = (name: string, layout: string, faceCount: number, edgeCount: number, arranged?: [number, number, number]) => ({
  name,
  layout,
  faceCount,
  edgeCount,
  bbox: { min: [0, 0, 0], max: [10, 10, 10] },
  ...(arranged ? { arranged } : {})
})

export function lastBuild(revision = 4): ReturnType<NonNullable<SetStoreDeps['scene']>> {
  return {
    revision,
    scene: { layouts: ['assembly', 'print'], parts: [part('block', 'assembly', 20, 40), part('lid', 'assembly', 6, 12, [5, 0, 0]), part('block', 'print', 20, 40)] } as unknown as Scene
  }
}
