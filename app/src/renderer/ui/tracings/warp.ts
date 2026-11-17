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

/** The worker could not be started or failed without saying why: the work is done here instead. A worker that says why it could not is not this. */
class WorkerFailed extends Error {}

/** The work in a worker, on a copy of the bitmap (the copy is transferred and gone; the bitmap is whole). Fails with `WorkerFailed` for any trouble of the worker's own. */
async function inWorker(bitmap: ImageBitmap, transform: readonly number[], plan: WarpPlan): Promise<Blob> {
  let copy: ImageBitmap
  try {
    copy = await createImageBitmap(bitmap)
  } catch {
    throw new WorkerFailed('no copy of the photo')
  }
  return new Promise<Blob>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./warp.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      copy.close()
      reject(new WorkerFailed('no worker'))
      return
    }
    const done = (finish: () => void): void => {
      worker.terminate()
      finish()
    }
    worker.onerror = () => done(() => reject(new WorkerFailed('worker')))
    worker.onmessageerror = () => done(() => reject(new WorkerFailed('worker')))
    worker.onmessage = ({ data }: MessageEvent<WarpAnswer>) => done(() => ('blob' in data ? resolve(data.blob) : reject(new Error(data.error))))
    try {
      worker.postMessage({ bitmap: copy, transform: [...transform], plan } satisfies WarpAsk, [copy])
    } catch {
      copy.close()
      done(() => reject(new WorkerFailed('worker')))
    }
  })
}

/**
 * The same work as `warpPixels` on a bitmap, made into a PNG, in a worker where one can be made and here where none can (and when the
 * worker fails). A copy over `MAX_WARP_BYTES` is made again smaller. The worker is handed a copy of the bitmap, so that the one given is
 * still whole to be warped here when the worker fails; it is let go of here either way.
 */
export async function warp(bitmap: ImageBitmap, transform: readonly number[], rect: UvRect, pxPerMm: number): Promise<Blob> {
  const plan = planWarp(rect, pxPerMm)
  if (!plan) throw new Error('the photo has no place on the tracing to be straightened into')
  if (typeof Worker !== 'undefined') {
    try {
      const blob = await inWorker(bitmap, transform, plan)
      bitmap.close()
      return blob
    } catch (e) {
      // A worker that could not start is no reason for a photo that is not straightened; one that said why it could not is.
      if (!(e instanceof WorkerFailed)) {
        bitmap.close()
        throw e
      }
    }
  }
  return warpHere(bitmap, transform, plan)
}
