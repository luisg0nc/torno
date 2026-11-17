import type { MarkStore } from '../marks/store'
import type { TracingStore } from './store'

/**
 * When a project is opened: the marks of its tracings that are off their plane are put back onto it, in one rewrite
 * (`MarkStore.healTracings`). A tracing's plane and its marks are two files, and a process that ended between the two writes left the
 * plane moved and its marks not; a tracing removed and put back is in a plane its marks did not follow. The same pass runs after each
 * outline recut (`Outlines.recut`). Resolves with the ids moved; a project whose files cannot be read is left as it is.
 */
export async function healMarks(deps: { tracings: Pick<TracingStore, 'list'>; marks: Pick<MarkStore, 'healTracings'> }, objectId: string): Promise<string[]> {
  try {
    const file = await deps.tracings.list(objectId)
    return file.tracings.length === 0 ? [] : await deps.marks.healTracings(objectId, file.tracings)
  } catch (e) {
    console.error(`cannot put the marks of the tracings of ${objectId} back on their planes: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}
