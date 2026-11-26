import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isPartId, MOST_PARTS, SHELF_DIR, type KernelShelfPart, type ShelfChecked, type ShelfPart } from '../../shared/shelf'
import type { KernelClient } from '../kernel/client'

/** How long after the last change under `common/parts/` the kernel is asked again. */
const DEBOUNCE_MS = 400
/** The largest `.torno/checked.json` that is read. */
const CHECKED_BYTES = 64 * 1024
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Whether a path is `common/parts` or lies under it. */
const onShelf = (path: string): boolean => /[\\/]common[\\/]parts([\\/]|$)/.test(path)

export interface ShelfStoreDeps {
  /** Watch a folder that exists, at any depth, and call back after a burst of changes with the paths; returns the stop. */
  watch: (dir: string, onChange: (paths: string[]) => void) => () => void
  /** Watch the direct children of a folder only (a folder appearing or going), for the wait for `common/` to be made; returns the stop. */
  watchTop: (dir: string, onChange: () => void) => () => void
  debounceMs?: number
  /** Where a read that failed is told. */
  log?: (message: string) => void
}

/**
 * The parts shelf of the open workspace (`common/parts/<id>/part.py`), as the window and the agent's first prompt see it: the
 * kernel's answer to its `shelf` op, with each part's `.torno/checked.json` merged in (read here, written nowhere in this file).
 *
 * The kernel is asked when the workspace opens and again, after a quiet 400 ms, when a file under `common/parts/` changes. One
 * ask runs at a time: a change meanwhile has the answer coming in applied and then another asked, so the newest state of the
 * folder is the one that stays. An answer that fails leaves the last good list as it was. Emits `changed` with the whole list
 * each time it is not what it was.
 */
export class ShelfStore extends EventEmitter {
  private readonly watch: ShelfStoreDeps['watch']
  private readonly watchTop: ShelfStoreDeps['watchTop']
  private readonly debounceMs: number
  private readonly log: (message: string) => void
  private root: string | null = null
  private kernel: KernelClient | null = null
  private unwatch: (() => void) | null = null
  private timer: NodeJS.Timeout | undefined
  private parts: ShelfPart[] = []
  /** The kernel's last good answer, before the checks were merged: a save of `checked.json` merges again from it. */
  private read: KernelShelfPart[] = []
  private asking = false
  private dirty = false
  /** Counts workspaces opened and closed: an answer for one that is left is dropped. */
  private epoch = 0

  constructor(deps: ShelfStoreDeps) {
    super()
    this.watch = deps.watch
    this.watchTop = deps.watchTop
    this.debounceMs = deps.debounceMs ?? DEBOUNCE_MS
    this.log = deps.log ?? (() => {})
  }

  /** The parts, sorted by id, as of the last good read. Empty before the first and when the workspace has none. */
  list(): ShelfPart[] {
    return this.parts
  }

  /** A workspace opened: its shelf is read now, and again whenever `common/parts/` changes. Replaces the one before. */
  open(root: string, kernel: KernelClient): void {
    this.close()
    this.root = root
    this.kernel = kernel
    this.follow(root)
    this.ask()
  }

  /**
   * Watch `common/`, and what is under `common/parts/` of it is a change. A watch does not see a folder that is made later, so
   * while `common/` is not there the workspace's own folders are watched, one level deep, for it to be made.
   */
  private follow(root: string): void {
    const common = join(root, 'common')
    const onCommon = (): (() => void) => this.watch(common, (paths) => (paths.some(onShelf) ? this.changed() : undefined))
    if (existsSync(common)) {
      this.unwatch = onCommon()
      return
    }
    const stop = this.watchTop(root, () => {
      if (this.root !== root || !existsSync(common)) return
      stop()
      this.unwatch = onCommon()
      this.changed()
    })
    this.unwatch = stop
  }

  /** The workspace was left: the watch stops, what was read is forgotten and the window is told if it had parts. */
  close(): void {
    this.epoch++
    clearTimeout(this.timer)
    this.timer = undefined
    this.unwatch?.()
    this.unwatch = null
    this.root = null
    this.kernel = null
    this.asking = false
    this.dirty = false
    this.read = []
    this.set([])
  }

  /** Something under `common/parts/` changed: the kernel is asked again once it is quiet. */
  changed(): void {
    if (this.root === null) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.ask(), this.debounceMs)
  }

  /** A part's `.torno/checked.json` was written: the checks are merged again from what the kernel said, which has not changed. */
  async checkedChanged(): Promise<void> {
    const epoch = this.epoch
    const root = this.root
    if (root === null) return
    const merged = await merge(root, this.read)
    if (epoch === this.epoch) this.set(merged)
  }

  private ask(): void {
    const { root, kernel } = this
    if (root === null || kernel === null) return
    if (this.asking) {
      this.dirty = true
      return
    }
    if (kernel.shelf === undefined) return
    this.asking = true
    this.dirty = false
    const epoch = this.epoch
    void this.run(root, kernel, epoch)
  }

  private async run(root: string, kernel: KernelClient, epoch: number): Promise<void> {
    try {
      const answer = await kernel.shelf!(root)
      if (epoch !== this.epoch) return
      if (answer.ok) {
        this.read = answer.parts.map(plain).filter((part): part is KernelShelfPart => part !== null).slice(0, MOST_PARTS)
        const merged = await merge(root, this.read)
        if (epoch === this.epoch) this.set(merged)
      } else {
        this.log(`the parts shelf could not be read: ${answer.error.kind}: ${answer.error.message}`)
      }
    } catch (e) {
      this.log(`the parts shelf could not be read: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (epoch === this.epoch) {
        this.asking = false
        if (this.dirty) this.ask()
      }
    }
  }

  private set(parts: ShelfPart[]): void {
    if (JSON.stringify(parts) === JSON.stringify(this.parts)) return
    this.parts = parts
    this.emit('changed', parts)
  }
}

/** What the kernel gave of a part, as a part of the shelf's list needs it, or null for what has no id of a part: nothing is trusted to be there. */
function plain(part: unknown): KernelShelfPart | null {
  if (part === null || typeof part !== 'object') return null
  const p = part as Partial<KernelShelfPart>
  if (typeof p.id !== 'string' || !isPartId(p.id)) return null
  return {
    ...p,
    id: p.id,
    name: typeof p.name === 'string' && p.name !== '' ? p.name : p.id,
    what: typeof p.what === 'string' ? p.what : '',
    params: Array.isArray(p.params) ? p.params : [],
    files: Array.isArray(p.files) ? p.files.filter((f): f is string => typeof f === 'string') : []
  }
}

/** The parts with their `file` and the sizes the person checked on each, sorted by id. */
async function merge(root: string, parts: KernelShelfPart[]): Promise<ShelfPart[]> {
  const merged = await Promise.all(parts.map(async (part) => ({ ...part, file: `${SHELF_DIR}/${part.id}/part.py`, checked: await checkedOf(root, part.id) })))
  return merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * `common/parts/<id>/.torno/checked.json`, `{ <param>: { value, date } }`: read, never written here. A file that is
 * missing, too large or not that is none; a size of it that is not a number and a day is left out, the rest stands.
 */
export async function checkedOf(root: string, id: string): Promise<Record<string, ShelfChecked>> {
  let text: string
  try {
    text = await readFile(join(root, SHELF_DIR, id, '.torno', 'checked.json'), 'utf8')
  } catch {
    return {}
  }
  if (text.length > CHECKED_BYTES) return {}
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return {}
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {}
  const checked: Record<string, ShelfChecked> = {}
  for (const [name, entry] of Object.entries(data)) {
    const e = entry as Partial<ShelfChecked> | null
    if (name !== '__proto__' && e !== null && typeof e === 'object' && typeof e.value === 'number' && Number.isFinite(e.value) && typeof e.date === 'string' && DAY.test(e.date)) {
      checked[name] = { value: e.value, date: e.date }
    }
  }
  return checked
}
