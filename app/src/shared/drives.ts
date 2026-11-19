/**
 * What a value of the model's `Params` drives: the faces (and, where the topology changes, the parts) of the build on
 * show that would move or change if that value changed. Worked out in main from a nudged build in a trial worker
 * (`main/drives`), told to the window as refs of each layout; it is no preview of the result.
 */

/** What one layout has lit for a field: faces by ref (`lid/F3`), parts by name (`lid`) where a face cannot be said. */
export interface DrivenIn {
  faces: string[]
  parts: string[]
}

export type DrivesAnswer =
  | { ok: true; /** The value tried in place of the build's. */ nudged: number | boolean | string; layouts: Record<string, DrivenIn> }
  | { ok: false; message: string }

/** What the row of a field says while it is worked out, and when it could not be. */
export const DRIVES_WORKING = 'Working out what this drives…'
