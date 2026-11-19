import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { DRIVES_WORKING, type DrivenIn } from '../../shared/drives'
import { store } from './store'

// What the field of the Params the pointer rests on drives. The window asks main (`object.drives`), which builds the model once
// more with that value nudged in a worker thrown away and keeps the answer until the next build; nothing here is kept longer
// than the build it is of, and nothing here changes the model, the overrides or the build on show.

/** How long the pointer rests on a row before the nudged build is asked for. */
export const REST_MS = 500

export interface DrivesState {
  /** The field the pointer rests on, or null. */
  name: string | null
  /** `working` while the nudged build runs; `lit` when the faces are known; `failed` with `message`. */
  status: 'idle' | 'working' | 'lit' | 'failed'
  layouts: Record<string, DrivenIn>
  message: string | null
}

const IDLE: DrivesState = { name: null, status: 'idle', layouts: {}, message: null }
export const drivesStore = createStore<DrivesState>(() => IDLE)
export const useDrives = <T,>(select: (s: DrivesState) => T): T => useZustand(drivesStore, select)

let timer: ReturnType<typeof setTimeout> | null = null
/** Which hover an answer is for: one that comes after the pointer moved on, or after a build, is dropped. */
let turn = 0

/** What to light in the layout shown: the faces, then the parts that changed whole. */
export const drivenRefs = (s: Pick<DrivesState, 'status' | 'layouts'>, layout: string): string[] => (s.status === 'lit' ? [...(s.layouts[layout]?.faces ?? []), ...(s.layouts[layout]?.parts ?? [])] : [])

/** The words of a row's note while its field is worked out, or when it could not be: null otherwise. */
export const driveNote = (s: DrivesState, name: string): string | null => (s.name !== name ? null : s.status === 'working' ? DRIVES_WORKING : s.status === 'failed' ? s.message : null)

/** The pointer (or the keys' focus) came to the row of `name` of the project `objectId`: after `REST_MS` at rest, its faces are asked for. */
export function restOn(objectId: string, name: string, ask: (id: string, name: string) => ReturnType<Window['torno']['object']['drives']> = (id, n) => window.torno.object.drives(id, n)): void {
  if (drivesStore.getState().name === name) return
  leave()
  const mine = ++turn
  drivesStore.setState({ name, status: 'idle', layouts: {}, message: null })
  timer = setTimeout(() => {
    timer = null
    // The row says it is working: the answer is instant when main has it already.
    drivesStore.setState({ status: 'working' })
    ask(objectId, name).then(
      (answer) => {
        if (mine !== turn) return
        drivesStore.setState(answer.ok ? { status: 'lit', layouts: answer.layouts, message: null } : { status: 'failed', layouts: {}, message: answer.message })
      },
      (e: unknown) => {
        if (mine === turn) drivesStore.setState({ status: 'failed', layouts: {}, message: e instanceof Error ? e.message : String(e) })
      }
    )
  }, REST_MS)
}

/** The pointer left the row: what was lit goes out, and an answer still on its way is dropped. */
export function leave(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  turn += 1
  if (drivesStore.getState().name !== null) drivesStore.setState(IDLE)
}

// A new build: what was said of the one before is of nothing now.
store.subscribe((s, prev) => {
  if (s.scene !== prev.scene || s.objectId !== prev.objectId) leave()
})
