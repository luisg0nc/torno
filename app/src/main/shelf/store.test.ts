import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KernelShelfPart, ShelfPart } from '../../shared/shelf'
import type { KernelClient, ShelfResult } from '../kernel/client'
import { watchFolder } from '../builds'
import { watchTop } from './watch'
import { checkedOf, ShelfStore } from './store'

const part = (id: string, extra: Partial<KernelShelfPart> = {}): KernelShelfPart => ({ id, name: `Part ${id}`, what: '', params: [], files: [], ...extra })

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-shelfstore-'))
  mkdirSync(join(root, 'common'))
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

/** A kernel that answers `shelf` with what the test hands it, one answer per ask, in order. */
function kernelOf(...answers: Array<ShelfResult | Promise<ShelfResult>>): { kernel: KernelClient; shelf: ReturnType<typeof vi.fn> } {
  const shelf = vi.fn(async () => answers.shift() ?? { ok: true as const, parts: [] })
  return { kernel: { shelf } as unknown as KernelClient, shelf }
}

/** A watch the test fires by hand. */
function watching(): { watch: (dir: string, cb: (paths: string[]) => void) => () => void; watchTop: (dir: string, cb: () => void) => () => void; fire: (path?: string) => void; top: () => void; dirs: string[]; tops: string[]; stopped: () => number } {
  let callback: ((paths: string[]) => void) | undefined
  let topCallback: (() => void) | undefined
  let stops = 0
  const dirs: string[] = []
  const tops: string[] = []
  return {
    watch: (dir, cb) => {
      dirs.push(dir)
      callback = cb
      return () => void stops++
    },
    watchTop: (dir, cb) => {
      tops.push(dir)
      topCallback = cb
      return () => void stops++
    },
    fire: (path = join(root, 'common', 'parts', 'a', 'part.py')) => callback?.([path]),
    top: () => topCallback?.(),
    dirs,
    tops,
    stopped: () => stops
  }
}

// The files are read for real: after the fake clock has run what is due, the disk is given a moment.
const realSetTimeout = globalThis.setTimeout
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
  await new Promise((resolve) => realSetTimeout(resolve, 30))
  await vi.advanceTimersByTimeAsync(0)
}
const later = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
  await new Promise((resolve) => realSetTimeout(resolve, 30))
}

describe('ShelfStore', () => {
  it('asks the kernel when a workspace opens, merges the file and the checks, and tells the window', async () => {
    mkdirSync(join(root, 'common', 'parts', 'ec11', '.torno'), { recursive: true })
    writeFileSync(join(root, 'common', 'parts', 'ec11', '.torno', 'checked.json'), JSON.stringify({ body_w: { value: 12.1, date: '2026-11-26' } }))
    const { kernel, shelf } = kernelOf({ ok: true, parts: [part('z_last'), part('ec11')] })
    const watched = watching()
    const store = new ShelfStore({ watch: watched.watch, watchTop: watched.watchTop })
    const told: ShelfPart[][] = []
    store.on('changed', (parts: ShelfPart[]) => told.push(parts))
    store.open(root, kernel)
    await settle()
    expect(shelf).toHaveBeenCalledWith(root)
    expect(watched.dirs).toEqual([join(root, 'common')])
    expect(store.list().map((p) => p.id)).toEqual(['ec11', 'z_last'])
    expect(store.list()[0]).toMatchObject({ file: 'common/parts/ec11/part.py', checked: { body_w: { value: 12.1, date: '2026-11-26' } } })
    expect(store.list()[1].checked).toEqual({})
    expect(told).toHaveLength(1)
  })

  it('asks again once it is quiet after a change under common/parts, one ask for a burst', async () => {
    const { kernel, shelf } = kernelOf({ ok: true, parts: [part('a')] }, { ok: true, parts: [part('a'), part('b')] })
    const watched = watching()
    const store = new ShelfStore({ watch: watched.watch, watchTop: watched.watchTop })
    store.open(root, kernel)
    await settle()
    watched.fire()
    await later(300)
    watched.fire()
    await later(300)
    expect(shelf).toHaveBeenCalledTimes(1)
    await later(150)
    expect(shelf).toHaveBeenCalledTimes(2)
    expect(store.list().map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('runs one ask at a time: a change while one runs is asked after it, and the newest answer stays', async () => {
    let release!: (r: ShelfResult) => void
    const first = new Promise<ShelfResult>((resolve) => (release = resolve))
    const { kernel, shelf } = kernelOf(first, { ok: true, parts: [part('new')] })
    const watched = watching()
    const store = new ShelfStore({ watch: watched.watch, watchTop: watched.watchTop })
    store.open(root, kernel)
    await settle()
    watched.fire()
    await later(500)
    expect(shelf).toHaveBeenCalledTimes(1) // still the first one
    release({ ok: true, parts: [part('old')] })
    await settle()
    expect(shelf).toHaveBeenCalledTimes(2)
    await settle()
    expect(store.list().map((p) => p.id)).toEqual(['new'])
  })

  it('keeps the last good list when an ask fails or throws, and says so', async () => {
    const log = vi.fn()
    const { kernel } = kernelOf({ ok: true, parts: [part('a')] }, { ok: false, error: { kind: 'busy', message: 'another read' } })
    const watched = watching()
    const store = new ShelfStore({ watch: watched.watch, watchTop: watched.watchTop, log })
    store.open(root, kernel)
    await settle()
    watched.fire()
    await later(500)
    expect(store.list().map((p) => p.id)).toEqual(['a'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('busy: another read'))
    ;(kernel.shelf as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('gone'))
    watched.fire()
    await later(500)
    expect(store.list().map((p) => p.id)).toEqual(['a'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('gone'))
  })

  it('drops what the kernel says of a part that has no id of a part, and fills what it leaves out', async () => {
    const { kernel } = kernelOf({ ok: true, parts: [part('not-an-id'), null as never, { id: 'bare' } as never, part('with_error', { error: 'boom' })] })
    const store = new ShelfStore({ ...watching() })
    store.open(root, kernel)
    await settle()
    expect(store.list().map((p) => p.id)).toEqual(['bare', 'with_error'])
    expect(store.list()[0]).toMatchObject({ name: 'bare', what: '', params: [], files: [], checked: {} })
    expect(store.list()[1].error).toBe('boom')
  })

  it('forgets the shelf when the workspace is left, stops the watch and drops an answer that was still coming', async () => {
    let release!: (r: ShelfResult) => void
    const slow = new Promise<ShelfResult>((resolve) => (release = resolve))
    const { kernel } = kernelOf({ ok: true, parts: [part('a')] }, slow)
    const watched = watching()
    const store = new ShelfStore({ watch: watched.watch, watchTop: watched.watchTop })
    const told = vi.fn()
    store.open(root, kernel)
    await settle()
    store.on('changed', told)
    watched.fire()
    await later(500)
    store.close()
    expect(store.list()).toEqual([])
    expect(watched.stopped()).toBe(1)
    expect(told).toHaveBeenCalledWith([])
    release({ ok: true, parts: [part('late')] })
    await settle()
    expect(store.list()).toEqual([])
    watched.fire() // a watch that is stopped may still call once
    await later(500)
    expect(store.list()).toEqual([])
  })

  it('opening another workspace replaces the first, and a kernel with no shelf op leaves it empty', async () => {
    const watched = watching()
    const store = new ShelfStore({ watch: watched.watch, watchTop: watched.watchTop })
    store.open(root, kernelOf({ ok: true, parts: [part('a')] }).kernel)
    await settle()
    store.open(root, {} as KernelClient)
    await settle()
    expect(store.list()).toEqual([])
    expect(watched.stopped()).toBe(1)
  })

  it('merges the checks again when a checked.json is written, without asking the kernel', async () => {
    vi.useRealTimers()
    const { kernel, shelf } = kernelOf({ ok: true, parts: [part('ec11')] })
    const store = new ShelfStore({ ...watching() })
    store.open(root, kernel)
    await vi.waitFor(() => expect(store.list()).toHaveLength(1))
    mkdirSync(join(root, 'common', 'parts', 'ec11', '.torno'), { recursive: true })
    writeFileSync(join(root, 'common', 'parts', 'ec11', '.torno', 'checked.json'), JSON.stringify({ hole_d: { value: 7.3, date: '2026-11-27' } }))
    await store.checkedChanged()
    expect(store.list()[0].checked).toEqual({ hole_d: { value: 7.3, date: '2026-11-27' } })
    expect(shelf).toHaveBeenCalledTimes(1)
  })
})

describe('checkedOf', () => {
  function write(text: string): void {
    mkdirSync(join(root, 'common', 'parts', 'p', '.torno'), { recursive: true })
    writeFileSync(join(root, 'common', 'parts', 'p', '.torno', 'checked.json'), text)
  }

  it('reads the sizes checked, leaves out an entry that is not a number and a day, and ignores a bad file', async () => {
    vi.useRealTimers()
    expect(await checkedOf(root, 'p')).toEqual({})
    write(JSON.stringify({ a: { value: 1.5, date: '2026-01-02' }, b: { value: '2', date: '2026-01-02' }, c: { value: 3, date: 'today' }, d: 4, e: null }))
    expect(await checkedOf(root, 'p')).toEqual({ a: { value: 1.5, date: '2026-01-02' } })
    write('{"__proto__": {"value": 1, "date": "2026-01-02"}}')
    expect(await checkedOf(root, 'p')).toEqual({})
    write('{ not json')
    expect(await checkedOf(root, 'p')).toEqual({})
    write('[1]')
    expect(await checkedOf(root, 'p')).toEqual({})
    write(' '.repeat(70_000))
    expect(await checkedOf(root, 'p')).toEqual({})
  })
})

describe('what is watched', () => {
  it('asks only for a change under common/parts, not for another file of common/', async () => {
    const { kernel, shelf } = kernelOf()
    const watched = watching()
    const store = new ShelfStore(watched)
    store.open(root, kernel)
    await settle()
    watched.fire(join(root, 'common', 'fit.py'))
    await later(500)
    expect(shelf).toHaveBeenCalledTimes(1)
    watched.fire(join(root, 'common', 'parts'))
    await later(500)
    expect(shelf).toHaveBeenCalledTimes(2)
  })

  it('waits for common/ to be made when it is not there, then watches it and asks', async () => {
    rmSync(join(root, 'common'), { recursive: true })
    const { kernel, shelf } = kernelOf()
    const watched = watching()
    const store = new ShelfStore(watched)
    store.open(root, kernel)
    await settle()
    expect(watched.dirs).toEqual([])
    expect(watched.tops).toEqual([root])
    watched.top() // something of the workspace changed, but not common/
    await later(500)
    expect(watched.dirs).toEqual([])
    mkdirSync(join(root, 'common'))
    watched.top()
    await later(500)
    expect(watched.dirs).toEqual([join(root, 'common')])
    expect(watched.stopped()).toBe(1) // the wait for it ended
    expect(shelf).toHaveBeenCalledTimes(2)
  })

  it('sees, with the real watches, the first part made in a workspace that has no common/, a save of it, and not torno\'s own .torno', async () => {
    vi.useRealTimers()
    rmSync(join(root, 'common'), { recursive: true })
    const asked = vi.fn(async (): Promise<ShelfResult> => ({ ok: true, parts: [] }))
    const store = new ShelfStore({ watch: (dir, onChange) => watchFolder(dir, onChange, 30), watchTop, debounceMs: 30 })
    store.open(root, { shelf: asked } as unknown as KernelClient)
    await vi.waitFor(() => expect(asked).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 400)) // the watch is ready
    mkdirSync(join(root, 'common', 'parts', 'ec11'), { recursive: true })
    writeFileSync(join(root, 'common', 'parts', 'ec11', 'part.py'), '"""EC11"""\n')
    await vi.waitFor(() => expect(asked.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 800)) // the watch of common/ is ready
    const before = asked.mock.calls.length
    writeFileSync(join(root, 'common', 'parts', 'ec11', 'part.py'), '"""EC11 again"""\n')
    await vi.waitFor(() => expect(asked.mock.calls.length).toBeGreaterThan(before), { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 400))
    const settled = asked.mock.calls.length
    mkdirSync(join(root, 'common', 'parts', 'ec11', '.torno'))
    writeFileSync(join(root, 'common', 'parts', 'ec11', '.torno', 'checked.json'), '{}')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(asked.mock.calls.length).toBe(settled)
    store.close()
  })
})
