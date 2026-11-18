import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'

// What the view says of an export that is being made (spec 2026-11-18, "The view is the preview"): what the band at its top left names,
// and whether the parts switched off are left out of the file (they are tagged in the view then). The dock's sheet sets it; null with none.

export interface ExportPreview {
  /** After "Exporting": `a page`, `a STEP file`, `a picture`. */
  what: string
  /** The parts that are switched off stay out of the file: the view tags each at its place. */
  leavesOut: boolean
  /** The file is being made: nothing puts the sheet away until it is. */
  saving: boolean
}

export const previewStore = createStore<{ preview: ExportPreview | null }>(() => ({ preview: null }))

export function usePreview<T>(select: (s: { preview: ExportPreview | null }) => T): T {
  return useZustand(previewStore, select)
}
