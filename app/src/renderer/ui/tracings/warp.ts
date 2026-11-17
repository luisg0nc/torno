import type { UvRect } from '../../../shared/lineup'
import { planWarp, type WarpPlan, warpHere } from './warpCore'

export { MAX_WARP_BYTES, MAX_WARP_EDGE, type Pixels, planWarp, type WarpPlan, warpHere, warpPixels } from './warpCore'

// The photo straightened in a worker (`warp.worker.ts`), where one can be made, so that a 12 megapixel photo does not stop the window.

/** What the worker is asked, and answers with. */
export interface WarpAsk {
  bitmap: ImageBitmap
  transform: number[]
  plan: WarpPlan
}
export type WarpAnswer = { blob: Blob } | { error: string }

/**
 * The same work as `warpPixels` on a bitmap, made into a PNG, in a worker where one can be made and here where none can (and when the
 * worker fails). A copy over `MAX_WARP_BYTES` is made again smaller. The bitmap is handed to the worker: it is let go of here.
 */
export async function warp(bitmap: ImageBitmap, transform: readonly number[], rect: UvRect, pxPerMm: number): Promise<Blob> {
  const plan = planWarp(rect, pxPerMm)
  if (!plan) throw new Error('the photo has no place on the tracing to be straightened into')
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise<Blob>((resolve, reject) => {
        const worker = new Worker(new URL('./warp.worker.ts', import.meta.url), { type: 'module' })
        const done = (finish: () => void): void => {
          worker.terminate()
          finish()
        }
        worker.onerror = () => done(() => reject(new Error('worker')))
        worker.onmessageerror = () => done(() => reject(new Error('worker')))
        worker.onmessage = ({ data }: MessageEvent<WarpAnswer>) => done(() => ('blob' in data ? resolve(data.blob) : reject(new Error(data.error))))
        worker.postMessage({ bitmap, transform: [...transform], plan } satisfies WarpAsk, [bitmap])
      })
    } catch (e) {
      // A worker that could not start is no reason for a photo that is not straightened; one that said why it could not is.
      if (!(e instanceof Error) || e.message !== 'worker') throw e
    }
  }
  return warpHere(bitmap, transform, plan)
}

