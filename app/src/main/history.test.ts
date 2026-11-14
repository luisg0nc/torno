import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HISTORY_KEPT, causeOf, drawable } from '../shared/history'
import type { Part, Scene } from '../shared/scene'
import type { ObjectInfo } from '../shared/workspace'
import { type BuildRecord, sourcesHash } from './buildlog'
import { History, MOST_THUMB_BYTES, historySourcePath, readHistory, readHistoryScene, readHistorySource, readHistoryThumb } from './history'

let root: string
let box: ObjectInfo
let history: History

const part = (name: string, volume: number): Part => ({ key: `assembly:${name}`, name, layout: 'assembly', loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, 0], max: [10, 10, volume / 100] }, volume, faceCount: 6, edgeCount: 12, triangleCount: 12, valid: true, hash: `${name}${volume}`, mesh: {} as Part['mesh'] }) as Part
const sceneOf = (volume: number, extra: Partial<Scene> = {}): Scene => ({ model: 'model.py', layouts: ['assembly'], parts: [part('tub', volume), part('lid', 100)], seconds: 0.5, output: 'printed', ...extra })

function put(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text)
}

type Cause = Parameters<History['keep']>[3]
let revision = 0
/** A build lands: the model is saved as `source`, hashed as torno does, and kept. */
async function build(source: string, scene: Scene = sceneOf(source.length * 100), run = 'run1', cause: Cause = { cause: 'person' }) {
  put('box/model.py', source)
  const record: BuildRecord = { revision: ++revision, at: new Date(Date.UTC(2026, 10, 4, 10, revision)).toISOString(), run, sources: await sourcesHash(box.dir, scene.uses) }
  return history.keep(box, Promise.resolve(record), scene, cause)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-history-'))
  put('common/util.py', 'c = 1\n')
  box = { id: 'box', name: 'box', dir: join(root, 'box'), model: 'model.py' } as ObjectInfo
  history = new History()
  revision = 0
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const png = (bytes = 40): Uint8Array => {
  // A PNG header of the cards' size; the rest is padding.
  const out = new Uint8Array(Math.max(bytes, 33))
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0xe0, 0, 0, 1, 0x68])
  return out
}

describe('History.keep', () => {
  it('keeps an entry with copies of the sources, the scene and a line of what changed, and has git pass over the folder', async () => {
    const first = await build('a = 1\n')
    expect(first).toMatchObject({ id: 'h1', revision: 1, run: 'run1', model: 'model.py', files: ['box/model.py', 'common/util.py'], parts: 2, line: 'first build kept' })
    const second = await build('a = 22\n', sceneOf(7000))
    expect(second).toMatchObject({ id: 'h2', revision: 2 })
    expect(second!.line).toContain('tub changed')
    const entries = await readHistory(box.dir)
    expect(entries.map((e) => e.id)).toEqual(['h1', 'h2'])
    expect(await readHistorySource(box.dir, entries[0], 'box/model.py')).toBe('a = 1\n')
    expect(await readHistorySource(box.dir, entries[1], 'box/model.py')).toBe('a = 22\n')
    expect(await readHistorySource(box.dir, entries[1], '../../etc/passwd')).toBeNull()
    expect(historySourcePath(box.dir, entries[1], 'box/model.py')).toBe(join(box.dir, '.torno/history/h2/source/box/model.py'))
    const scene = await readHistoryScene(box.dir, 'h2')
    expect(scene?.parts.map((p) => p.name)).toEqual(['tub', 'lid'])
    expect(scene?.output).toBe('')
    expect(readFileSync(join(box.dir, '.torno/.gitignore'), 'utf8')).toContain('history/')
    // Nothing outside .torno/ was written beside the model.
    expect(readdirSync(box.dir).sort()).toEqual(['.torno', 'model.py'])
    expect(existsSync(join(root, 'common/.torno'))).toBe(false)
  })

  it('does not keep a build twice of the same sources, and keeps one of sources that came back', async () => {
    await build('a = 1\n')
    expect(await build('a = 1\n')).toMatchObject({ id: 'h1' })
    await build('a = 2\n')
    expect(await build('a = 1\n')).toMatchObject({ id: 'h3' })
    expect((await readHistory(box.dir)).map((e) => e.id)).toEqual(['h1', 'h2', 'h3'])
  })

  it('marks a build whose declared checks fail or that has a defect, and keeps it', async () => {
    const checks = [{ name: 'wall', kind: 'thin', status: 'fail' }, { name: 'bed', kind: 'bed', status: 'pass' }] as Scene['checks']
    const scene = sceneOf(5000, { checks })
    scene.parts[0].valid = false
    const e = await build('a = 3\n', scene)
    expect(e).toMatchObject({ failing: ['wall'], defects: ['tub: not valid'] })
  })

  it('counts on across runs and never gives a number twice, also after the index is lost', async () => {
    await build('a = 1\n')
    await build('a = 2\n')
    const later = new History()
    const e = await (async () => {
      put('box/model.py', 'a = 3\n')
      return later.keep(box, Promise.resolve({ revision: 1, at: new Date().toISOString(), run: 'run2', sources: await sourcesHash(box.dir) }), sceneOf(300), { cause: 'person' })
    })()
    expect(e).toMatchObject({ id: 'h3', revision: 1, run: 'run2' })
    rmSync(join(box.dir, '.torno/history/index.json'))
    const f = await build('a = 4\n')
    expect(f!.id).toBe('h4')
  })

  it('keeps the index whole when it is broken, and sweeps a folder no index names', async () => {
    await build('a = 1\n')
    mkdirSync(join(box.dir, '.torno/history/h9/source'), { recursive: true })
    writeFileSync(join(box.dir, '.torno/history/index.json'), '{"entries": [')
    const e = await build('a = 2\n')
    expect(e!.id).toBe('h10')
    expect(readdirSync(join(box.dir, '.torno/history')).sort()).toEqual(['h10', 'index.json'])
    expect((await readHistory(box.dir)).map((x) => x.id)).toEqual(['h10'])
  })

  it('leaves no temp file, and the index names only builds whose folder is whole', async () => {
    for (let i = 0; i < 4; i++) await build(`a = ${i}\n`)
    const names = readdirSync(join(box.dir, '.torno/history'))
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
    for (const e of await readHistory(box.dir)) expect(existsSync(join(box.dir, '.torno/history', e.id, 'scene.json'))).toBe(true)
  })

  it('does not copy sources that changed since the build was hashed, or that are too large, and keeps the entry', async () => {
    put('box/model.py', 'a = 1\n')
    const record: BuildRecord = { revision: 1, at: new Date().toISOString(), run: 'run1', sources: 'ffffffffffff' }
    expect(await history.keep(box, Promise.resolve(record), sceneOf(100), { cause: 'person' })).toMatchObject({ id: 'h1', files: [] })
    const big = 'x = 1\n'.repeat(120_000)
    const e = await build(big)
    expect(e!.files).toEqual([])
  })

  it('writes nothing through a link in place of .torno', async () => {
    mkdirSync(join(root, 'elsewhere'))
    mkdirSync(box.dir)
    symlinkSync(join(root, 'elsewhere'), join(box.dir, '.torno'))
    expect(await build('a = 1\n')).toBeNull()
    expect(readdirSync(join(root, 'elsewhere'))).toEqual([])
  })

  it('tells whoever listens that the history changed', async () => {
    const told: string[] = []
    history.onChange((dir) => told.push(dir))
    await build('a = 1\n')
    expect(told).toEqual([box.dir])
  })
})

describe('the cause of a kept build', () => {
  it('writes the cause and the turn into index.json, and reads an entry that says none as unknown', async () => {
    const turn = { conversation: 'c1', prompt: 'p-1', text: 'make it taller' }
    expect(await build('a = 1\n', undefined, 'run1', { cause: 'agent', turn })).toMatchObject({ id: 'h1', cause: 'agent', turn })
    await build('a = 2\n', undefined, 'run1', { cause: 'goback', wentBackTo: 'h1' })
    const onDisk = JSON.parse(readFileSync(join(box.dir, '.torno/history/index.json'), 'utf8')).entries
    expect(onDisk[0]).toMatchObject({ cause: 'agent', turn })
    expect(onDisk[1]).toMatchObject({ cause: 'goback', wentBackTo: 'h1' })
    expect(onDisk[1].turn).toBeUndefined()
    const [first] = await readHistory(box.dir)
    expect(causeOf(first)).toBe('agent')
    expect(causeOf({ ...first, cause: undefined })).toBe('unknown')
  })
})

const failedAt = async (source: string, error = 'NameError: x', cause: Cause = { cause: 'person' }, rev = 0) => {
  put('box/model.py', source)
  return history.keepFailed(box, { run: 'run1', revision: rev, sources: await sourcesHash(box.dir), seconds: 1.5 }, error, cause)
}

describe('a build the params made', () => {
  it('is kept though its sources are the newest entry\'s, which a build of the person\'s is not', async () => {
    await build('a = 1\n')
    expect(await build('a = 1\n', sceneOf(900), 'run1', { cause: 'params' })).toMatchObject({ id: 'h2', cause: 'params' })
    expect(await build('a = 1\n', sceneOf(900), 'run1', { cause: 'person' })).toMatchObject({ id: 'h2' })
    expect((await readHistory(box.dir)).map((e) => e.id)).toEqual(['h1', 'h2'])
  })
})

describe('History.keepFailed', () => {
  it('keeps a failed build as a light entry: its error, no folder, and the cause', async () => {
    const turn = { prompt: 'p-2', text: 'more' }
    const entry = await failedAt('a = (\n', 'SyntaxError: x', { cause: 'agent', turn })
    expect(entry).toMatchObject({ id: 'h1', failed: true, error: 'SyntaxError: x', cause: 'agent', turn, files: [], parts: 0, seconds: 1.5, line: 'SyntaxError: x', model: 'model.py', run: 'run1' })
    expect(drawable(entry!)).toBe(false)
    expect(existsSync(join(box.dir, '.torno/history/h1'))).toBe(false)
    expect((await readHistory(box.dir)).map((e) => e.id)).toEqual(['h1'])
    expect(await readHistoryScene(box.dir, 'h1')).toBeNull()
  })

  it('does not keep the same failure of the same sources twice, but a new error or new sources are kept', async () => {
    await failedAt('a = (\n')
    expect(await failedAt('a = (\n')).toMatchObject({ id: 'h1' })
    expect(await failedAt('a = (\n', 'NameError: y')).toMatchObject({ id: 'h2' })
    expect(await failedAt('a = ((\n', 'NameError: y')).toMatchObject({ id: 'h3' })
    expect((await readHistory(box.dir)).length).toBe(3)
  })

  it('keeps a build that works after a failure of the same sources, with the scene of the build before it for its line', async () => {
    await build('a = 1\n')
    await failedAt('a = 2\n', 'Timeout', { cause: 'person' }, 1)
    const worked = await build('a = 2\n', sceneOf(7000))
    expect(worked).toMatchObject({ id: 'h3' })
    expect(worked!.line).toContain('tub changed')
  })

  it('does not hand a picture or dimensions to a failed entry, which carries the revision of the build before it', async () => {
    await build('a = 1\n')
    await failedAt('a = (\n', 'SyntaxError: x', { cause: 'person' }, 1)
    expect(await history.thumbnail(box, 'run1', 1, png())).toBe(true)
    expect(await history.dimensions(box, 'run1', 1, { pass: 1, fail: 0, none: 0 })).toBe(true)
    const [good, bad] = await readHistory(box.dir)
    expect(good).toMatchObject({ thumb: true, dimensions: { pass: 1, fail: 0, none: 0 } })
    expect(bad.thumb).toBeUndefined()
    expect(bad.dimensions).toBeUndefined()
  })

  it('writes nothing through a link in place of .torno', async () => {
    mkdirSync(join(root, 'elsewhere'))
    mkdirSync(box.dir)
    symlinkSync(join(root, 'elsewhere'), join(box.dir, '.torno'))
    expect(await failedAt('a = (\n')).toBeNull()
    expect(readdirSync(join(root, 'elsewhere'))).toEqual([])
  })
})

describe('History pruning', () => {
  it('lets go of a failed build before any build that worked', async () => {
    await build('s = 0\n')
    await failedAt('s = (\n')
    for (let i = 1; i <= HISTORY_KEPT - 2; i++) await build(`s = ${i}\n`)
    // A hundred are kept, one of them the failed one: the next makes 101 and the failed one goes first.
    expect((await readHistory(box.dir)).length).toBe(HISTORY_KEPT)
    expect((await readHistory(box.dir)).some((e) => e.failed)).toBe(true)
    await build('s = next\n')
    const entries = await readHistory(box.dir)
    expect(entries.length).toBe(HISTORY_KEPT)
    expect(entries.some((e) => e.failed)).toBe(false)
    expect(entries[0].id).toBe('h1')
  }, 60_000)

  it('keeps the newest failure, and lets go of an older one first', async () => {
    for (let i = 0; i < HISTORY_KEPT; i++) await build(`s = ${i}\n`)
    await failedAt('s = (\n', 'one')
    await failedAt('s = ((\n', 'two')
    const entries = await readHistory(box.dir)
    expect(entries.filter((e) => e.failed).map((e) => e.error)).toEqual(['two'])
    expect(entries.length).toBe(HISTORY_KEPT)
  }, 60_000)

  it('keeps the newest 100 and every starred build', async () => {
    await build('s = 0\n')
    expect(await history.star(box, 'h1', true)).toBe(true)
    for (let i = 1; i <= HISTORY_KEPT + 4; i++) await build(`s = ${i}\n`)
    const entries = await readHistory(box.dir)
    expect(entries.length).toBe(HISTORY_KEPT + 1)
    expect(entries[0]).toMatchObject({ id: 'h1', starred: true })
    expect(entries.at(-1)!.id).toBe(`h${HISTORY_KEPT + 5}`)
    expect(entries.some((e) => e.id === 'h2')).toBe(false)
    expect(existsSync(join(box.dir, '.torno/history/h2'))).toBe(false)
    expect(existsSync(join(box.dir, '.torno/history/h1/scene.json'))).toBe(true)
    // A star taken away leaves the build to the next prune.
    await history.star(box, 'h1', false)
    await build('s = last\n')
    expect((await readHistory(box.dir))[0].id).not.toBe('h1')
  }, 60_000)

  it('stars only a build that is kept', async () => {
    await build('a = 1\n')
    expect(await history.star(box, 'h7', true)).toBe(false)
    expect(await history.star(box, 'h1', true)).toBe(true)
    expect(await history.star(box, 'h1', true)).toBe(false)
  })
})

describe('History.markUndone', () => {
  it('marks the builds named in one write of the index, and each once', async () => {
    await build('a = 1\n')
    await build('a = 2\n')
    await build('a = 3\n')
    const told: string[] = []
    history.onChange((dir) => told.push(dir))
    expect(await history.markUndone(box, ['h2', 'h3', 'h9'])).toEqual(['h2', 'h3'])
    expect((await readHistory(box.dir)).map((e) => e.undone === true)).toEqual([false, true, true])
    expect(told).toHaveLength(1)
    // Nothing new to say: nothing is written or told.
    expect(await history.markUndone(box, ['h2'])).toEqual([])
    expect(told).toHaveLength(1)
  })
})

describe('History.thumbnail and dimensions', () => {
  it('keeps the picture of the build of this run with that revision, once, and not a large one', async () => {
    await build('a = 1\n')
    await build('a = 2\n')
    expect(await history.thumbnail(box, 'run1', 1, png())).toBe(true)
    expect(await history.thumbnail(box, 'run1', 1, png())).toBe(false)
    expect(await history.thumbnail(box, 'run9', 2, png())).toBe(false)
    expect(await history.thumbnail(box, 'run1', 2, new Uint8Array(10))).toBe(false)
    expect(await history.thumbnail(box, 'run1', 2, png(MOST_THUMB_BYTES + 1))).toBe(false)
    const entries = await readHistory(box.dir)
    expect(entries.map((e) => e.thumb === true)).toEqual([true, false])
    expect((await readHistoryThumb(box.dir, 'h1'))?.length).toBe(40)
    expect(await readHistoryThumb(box.dir, 'h2')).toBeNull()
  })

  it('keeps what the dimensions said of a build, as of the check', async () => {
    await build('a = 1\n')
    expect(await history.dimensions(box, 'run1', 1, { pass: 0, fail: 0, none: 0 })).toBe(false)
    expect(await history.dimensions(box, 'run1', 1, { pass: 2, fail: 1, none: 0 })).toBe(true)
    expect(await history.dimensions(box, 'run1', 1, { pass: 2, fail: 1, none: 0 })).toBe(false)
    expect((await readHistory(box.dir))[0].dimensions).toEqual({ pass: 2, fail: 1, none: 0 })
  })
})
