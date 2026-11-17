import type { WarpAnswer, WarpAsk } from './warp'
import { warpHere } from './warpCore'

// Straightens one photo off the window's thread: it is given the bitmap, the line-up's matrix and the plan of the copy, and answers with the PNG.
self.onmessage = ({ data }: MessageEvent<WarpAsk>) => {
  const reply = (answer: WarpAnswer): void => (self as unknown as { postMessage(message: unknown): void }).postMessage(answer)
  warpHere(data.bitmap, data.transform, data.plan).then(
    (blob) => reply({ blob }),
    (e: unknown) => reply({ error: e instanceof Error ? e.message : String(e) })
  )
}
