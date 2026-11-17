import { type Mark, markIntent } from '../../shared/marks'
import { maskStem } from '../../shared/regions'
import { maskBits } from '../../shared/scans'
import { regionStore } from '../state/region'
import { store, type TornoState } from '../state/store'
import { toolStore } from '../state/tools'
import type { KeptRegion } from '../viewport/scanTints'
import { meshOf } from '../viewport/scans'
import type { Viewport } from '../viewport/Viewport'

// The regions kept, as the window draws them: each a tint on its scan, from the bits of its mask.

/** The regions to tint: those of the object on show that are open and still of their scan's mesh, each with the bits of its mask once main has given them. */
function regionsOf(s: TornoState, editing: string | null): Array<{ mark: Extract<Mark, { kind: 'region' }>; key: string; triangles: number }> {
  const wanted: ReturnType<typeof regionsOf> = []
  for (const mark of s.marks) {
    if (mark.kind !== 'region' || mark.status === 'resolved' || mark.anchorState === 'orphaned') continue
    const scan = s.scans.find((one) => one.id === mark.scan)
    // By the mesh its scan has: read again, the scan has another, and the mark says so once main has looked.
    if (scan && scan.meshState === 'ok' && mark.id !== editing) wanted.push({ mark, key: `${s.objectId} ${maskStem(mark)} ${meshOf(scan)}`, triangles: scan.imported.triangles })
  }
  return wanted
}

/**
 * Has a viewport tint the regions kept on their scans: each from the bits of its mask, asked of main once,
 * when the mark first appears (and again for another mesh of its scan). A mask that is gone, or is of another
 * mesh, tints nothing: main says of the mark that it is orphaned; it is asked for again when the scans are
 * told anew. Returns what undoes it.
 */
export function tintRegions(viewport: Pick<Viewport, 'setRegions'>): () => void {
  /** By mark and mesh: the bits main gave, or that they were asked for (null), or that they are no region of that mesh (false). */
  const bits = new Map<string, Uint8Array | null | false>()
  let told: KeptRegion[] = []
  const tell = (s: TornoState): void => {
    // One that is being painted again is drawn as that painting, not as it was kept: while the painting is
    // drawn, which is while the Region tool is in hand. Parked, the region is drawn as it is kept.
    const wanted = regionsOf(s, toolStore.getState().tool === 'region' ? regionStore.getState().editing : null)
    const now: KeptRegion[] = []
    for (const { mark, key, triangles } of wanted) {
      const have = bits.get(key)
      if (have) now.push({ id: mark.id, scan: mark.scan, author: mark.author, bits: have, ...(markIntent(mark) === 'dont' ? { dont: true } : {}) })
      if (have !== undefined || !s.objectId) continue
      bits.set(key, null)
      window.torno.scans.mask(s.objectId, mark.scan, maskStem(mark)).then(
        (file) => {
          try {
            bits.set(key, maskBits(new Uint8Array(file), triangles).slice())
          } catch {
            bits.set(key, false)
          }
          tell(store.getState())
        },
        // Gone from the disk, or not read: main says so of the mark when it next looks. Not asked again until the scans are told anew.
        () => void bits.set(key, false)
      )
    }
    for (const key of bits.keys()) if (!wanted.some((one) => one.key === key)) bits.delete(key)
    if (now.length === told.length && now.every((region, n) => region.id === told[n].id && region.bits === told[n].bits && region.author === told[n].author && region.dont === told[n].dont)) return
    told = now
    viewport.setRegions(now)
  }
  tell(store.getState())
  const off = store.subscribe((s, prev) => {
    // Main told the scans anew: a mask that failed to read may read now, and is asked for once more.
    if (s.scans !== prev.scans) for (const [key, have] of bits) if (have === false) bits.delete(key)
    if (s.marks !== prev.marks || s.scans !== prev.scans || s.objectId !== prev.objectId) tell(s)
  })
  const offEditing = regionStore.subscribe((r, prev) => {
    if (r.editing !== prev.editing) tell(store.getState())
  })
  const offTool = toolStore.subscribe((t, prev) => {
    if (t.tool !== prev.tool && regionStore.getState().editing !== null) tell(store.getState())
  })
  return () => {
    off()
    offEditing()
    offTool()
    viewport.setRegions([])
  }
}
