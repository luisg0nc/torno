import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '../shared/history'
import type { Part, Scene } from '../shared/scene'
import type { ObjectInfo } from '../shared/workspace'
import { type BuildRecord, sourcesHash } from './buildlog'
import { type GoBackPlan, applyGoBack, entryBefore, planGoBack, takeGoBackNotice } from './goback'
import { History, readHistory } from './history'
import { forgetParamFiles, overrideValues, setOverride } from './paramsfile'

let root: string
let box: ObjectInfo
let history: History
let revision = 0

const part = (name: string, volume: number): Part => ({ key: `assembly:${name}`, name, layout: 'assembly', loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, 0], max: [10, 10, volume / 100] }, volume, faceCount: 6, edgeCount: 12, triangleCount: 12, valid: true, hash: `${name}${volume}`, mesh: {} as Part['mesh'] }) as Part

const put = (path: string, text: string): void => {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text)
}
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

/** A build lands: the files are written as given (the others stay), hashed as torno does, and kept. */
async function build(files: Record<string, string>, turn?: { prompt: string; text?: string }, extra: Partial<Scene> = {}): Promise<HistoryEntry> {
  for (const [path, text] of Object.entries(files)) put(path, text)
  const scene: Scene = { model: 'model.py', layouts: ['assembly'], parts: [part('tub', 100 + revision)], seconds: 0.5, output: '', ...extra }
  const record: BuildRecord = { revision: ++revision, at: new Date(Date.UTC(2026, 10, 14, 10, revision)).toISOString(), run: 'run1', sources: await sourcesHash(box.dir, scene.uses) }
  const entry = await history.keep(box, Promise.resolve(record), scene, turn ? { cause: 'agent', turn: { conversation: 'c1', ...turn } } : { cause: 'person' })
  return entry!
}

const builds = (running = false) => ({ rebuild: vi.fn(() => true), expect: vi.fn(), state: () => (running ? { status: 'building' } : { status: 'ok' }) })
const asBuilds = (b: ReturnType<typeof builds>) => b as unknown as Parameters<typeof applyGoBack>[2]['builds']

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-goback-'))
  mkdirSync(join(root, 'box'), { recursive: true })
  box = { id: 'box', name: 'box', dir: join(root, 'box'), model: 'model.py' }
  history = new History()
  revision = 0
})
afterEach(() => {
  forgetParamFiles()
  try {
    chmodSync(join(root, 'box', 'sub'), 0o755)
  } catch {
    // not made
  }
  rmSync(root, { recursive: true, force: true })
})

/** h1 (the target), h2 and h3 by two prompts; the person then edits model.py and common/x.py. */
async function twoPrompts(): Promise<void> {
  await build({ 'box/model.py': 'v1', 'common/x.py': 'x1' })
  await build({ 'box/model.py': 'v2', 'box/new.py': 'n' }, { prompt: 'u1', text: 'make it taller' })
  await build({ 'box/model.py': 'v3' }, { prompt: 'u2', text: 'add a lip' })
}

const planned = async (to: string): Promise<GoBackPlan> => {
  const plan = await planGoBack(box, to)
  if ('refused' in plan) throw new Error(plan.refused)
  return plan
}

describe('planGoBack', () => {
  it('lists the files to write, the files of others left alone, the ones to remove and the ones the person changed since', async () => {
    await twoPrompts()
    put('common/x.py', 'x-edited')
    put('box/model.py', 'v3-edited')
    const plan = await planned('h1')
    expect(plan).toMatchObject({
      to: 'h1',
      write: ['box/model.py'],
      remove: ['box/new.py'],
      leftAlone: ['common/x.py'],
      changedSince: ['box/model.py'],
      params: false,
      undone: ['h2', 'h3']
    })
    expect(plan.fallback).toBeUndefined()
    expect(plan.prompts).toEqual([{ conversation: 'c1', prompt: 'u1', text: 'make it taller' }, { conversation: 'c1', prompt: 'u2', text: 'add a lip' }])
  })

  it('does not list a file that already holds the copy, and does not count the edit of an undone build as the person\'s', async () => {
    await twoPrompts()
    const plan = await planned('h2')
    expect(plan.write).toEqual(['box/model.py'])
    expect(plan.remove).toEqual([])
    expect(plan.changedSince).toEqual([])
    expect(plan.undone).toEqual(['h3'])
  })

  it('flags what a save of the person\'s that already built changed, and lists the saves it undoes (RF1)', async () => {
    await build({ 'box/model.py': 'v1' })
    await build({ 'box/model.py': 'v2' }, { prompt: 'u1', text: 'make it taller' })
    // The person edits model.py and adds helper.py: a build of their own, which the newest build's copies agree with.
    await build({ 'box/model.py': 'v3', 'box/helper.py': 'h' })
    const plan = await planned('h1')
    expect(plan.write).toEqual(['box/model.py'])
    expect(plan.remove).toEqual(['box/helper.py'])
    expect(plan.changedSince).toEqual(['box/helper.py', 'box/model.py'])
    expect(plan.undone).toEqual(['h2', 'h3'])
    expect(plan.undoneSaves).toEqual(['h3'])
  })

  it('flags a file the person saved even when a later prompt changed it again, and not one a save left as it was', async () => {
    await build({ 'box/model.py': 'v1', 'box/other.py': 'o1' })
    await build({ 'box/model.py': 'v2', 'box/other.py': 'o2' }, { prompt: 'u1' })
    // The person saves model.py anew and leaves other.py as the prompt made it.
    await build({ 'box/model.py': 'v3' })
    await build({ 'box/model.py': 'v4' }, { prompt: 'u2' })
    const plan = await planned('h1')
    expect(plan.write).toEqual(['box/model.py', 'box/other.py'])
    expect(plan.changedSince).toEqual(['box/model.py'])
    expect(plan.undoneSaves).toEqual(['h3'])
  })

  it('counts a Go back\'s own build and a prompt\'s as nobody\'s save', async () => {
    await build({ 'box/model.py': 'v1' })
    await build({ 'box/model.py': 'v2' }, { prompt: 'u1' })
    const entry = await history.keep(box, Promise.resolve({ revision: ++revision, at: new Date().toISOString(), run: 'run1', sources: await sourcesHash(box.dir, undefined) }), { model: 'model.py', layouts: ['assembly'], parts: [part('tub', 1)], seconds: 0.5, output: '' }, { cause: 'goback', wentBackTo: 'h1' })
    expect(entry).not.toBeNull()
    const plan = await planned('h1')
    expect(plan.undoneSaves).toEqual([])
    expect(plan.changedSince).toEqual([])
  })

  it('removes only a file first seen after the target, and one that is there', async () => {
    await twoPrompts()
    put('box/mine.py', 'never in a build')
    const plan = await planned('h1')
    expect(plan.remove).toEqual(['box/new.py'])
    rmSync(join(root, 'box', 'new.py'))
    expect((await planned('h1')).remove).toEqual([])
  })

  it('falls back to Undo when the target holds no copy', async () => {
    await twoPrompts()
    // An entry with no copies, as one over the size caps is.
    const index = JSON.parse(readFileSync(join(box.dir, '.torno', 'history', 'index.json'), 'utf8'))
    index.entries[0].files = []
    writeFileSync(join(box.dir, '.torno', 'history', 'index.json'), JSON.stringify(index))
    const plan = await planned('h1')
    expect(plan).toMatchObject({ to: 'h1', write: [], remove: [], fallback: 'undo', undone: ['h2', 'h3'] })
  })

  it('falls back to Undo when a copy it needs is gone from the history folder', async () => {
    await twoPrompts()
    rmSync(join(box.dir, '.torno', 'history', 'h1', 'source', 'box', 'model.py'))
    expect((await planned('h1')).fallback).toBe('undo')
  })

  it('refuses a build that is not kept and a build that failed', async () => {
    await twoPrompts()
    expect(await planGoBack(box, 'h99')).toMatchObject({ refused: expect.stringContaining('no longer kept') })
    await history.keepFailed(box, { run: 'run1', revision: 3, sources: 'abc' }, 'boom', { cause: 'person' })
    expect(await planGoBack(box, 'h4')).toMatchObject({ refused: expect.stringContaining('failed') })
    expect(await planGoBack(box, '../x')).toMatchObject({ refused: expect.any(String) })
  })

  it('says the Params differ when what the person tries is not what the build was made with', async () => {
    const p = { name: 'w', type: 'float', default: 10, literal: true, doc: null, editable: 'float' as const }
    await build({ 'box/model.py': 'v1' }, undefined, { params: [p], overrides: { applied: { w: 12 }, dropped: [] } })
    await build({ 'box/model.py': 'v2' }, { prompt: 'u1' }, { params: [p], overrides: { applied: {}, dropped: [] } })
    expect((await planned('h1')).params).toBe(true)
    await setOverride(box.dir, 'w', 12, 10)
    expect((await planned('h1')).params).toBe(false)
    expect((await planned('h2')).params).toBe(true)
  })
})

describe('entryBefore', () => {
  const e = (id: string, prompt?: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, at: '', run: 'run1', revision: Number(id.slice(1)), sources: 's', model: 'm.py', files: [], parts: 1, seconds: 1, line: '', ...(prompt ? { cause: 'agent' as const, turn: { prompt } } : {}), ...extra })
  it('is the newest build that can be drawn before the prompt\'s first one', () => {
    const entries = [e('h1'), e('h2', undefined, { failed: true }), e('h3', 'u1'), e('h4', 'u1'), e('h5', 'u2')]
    expect(entryBefore(entries, 'u1')).toMatchObject({ id: 'h1' })
    expect(entryBefore(entries, 'u2')).toMatchObject({ id: 'h4' })
  })
  it('is the build current when the prompt was sent when none is kept before it', () => {
    const entries = [e('h3', 'u1', { revision: 7 })]
    expect(entryBefore(entries, 'u1')).toMatchObject({ refused: expect.any(String) })
    expect(entryBefore([e('h2', undefined, { run: 'r9', revision: 4 }), ...entries], 'u1', { run: 'r9', revision: 4 })).toMatchObject({ id: 'h2' })
    expect(entryBefore(entries, 'u1', { run: 'run1', revision: 7 })).toMatchObject({ refused: expect.any(String) })
  })
  it('does not pick an old kept build when the ones between it and the prompt were let go (RF5)', () => {
    // h2 and h3 were pruned: the prompt's first remaining build is h4 and the only older one is a starred h1.
    const gap = [e('h1'), e('h4', 'u1')]
    expect(entryBefore(gap, 'u1')).toMatchObject({ refused: expect.any(String) })
    // Contiguous ids (a failed build between them is an entry too) are no gap.
    expect(entryBefore([e('h1'), e('h2', undefined, { failed: true }), e('h3', 'u1')], 'u1')).toMatchObject({ id: 'h1' })
    // The build current when the prompt was sent is still an answer when it is kept.
    expect(entryBefore([e('h1', undefined, { run: 'r9', revision: 4 }), e('h4', 'u1')], 'u1', { run: 'r9', revision: 4 })).toMatchObject({ id: 'h1' })
  })
  it('is no gap when only failed builds between them were let go, past the 100 kept', () => {
    // h50 failed and was pruned; no build that drew was let go above h49.
    const entries = [e('h49'), e('h51', 'u1')]
    expect(entryBefore(entries, 'u1', undefined, 0)).toMatchObject({ id: 'h49' })
    expect(entryBefore(entries, 'u1', undefined, 48)).toMatchObject({ id: 'h49' })
    // A build that drew was let go above h49: h50 was one of those.
    expect(entryBefore(entries, 'u1', undefined, 50)).toMatchObject({ refused: expect.any(String) })
    // An index that does not say treats every gap as real.
    expect(entryBefore(entries, 'u1')).toMatchObject({ refused: expect.any(String) })
  })
  it('refuses a prompt that made no build', () => {
    expect(entryBefore([e('h1')], 'u9')).toMatchObject({ refused: expect.any(String) })
  })
})

describe('applyGoBack', () => {
  it('writes the copy, removes what the undone prompts made, leaves other folders alone, marks the builds undone and leaves the notice', async () => {
    await twoPrompts()
    put('common/x.py', 'x-edited')
    const b = builds()
    const plan = await planned('h1')
    const result = await applyGoBack(box, plan, { history, builds: asBuilds(b) })
    expect(result).toEqual({ done: ['box/model.py', 'box/new.py'] })
    expect(read('box/model.py')).toBe('v1')
    expect(existsSync(join(root, 'box', 'new.py'))).toBe(false)
    expect(read('common/x.py')).toBe('x-edited')
    expect((await readHistory(box.dir)).map((x) => [x.id, x.undone === true])).toEqual([['h1', false], ['h2', true], ['h3', true]])
    expect(b.rebuild).toHaveBeenCalledWith('box', 'goback', 'h1')
    const kept = JSON.parse(readFileSync(join(box.dir, '.torno', 'goback.json'), 'utf8'))
    expect(kept).toMatchObject({ to: 'h1', undone: ['h2', 'h3'], prompts: [{ prompt: 'u1' }, { prompt: 'u2' }] })
    expect(typeof kept.at).toBe('string')
    expect(readFileSync(join(box.dir, '.torno', '.gitignore'), 'utf8')).toContain('goback.json')
  })

  it('tells the builds a Go back is coming before the first file is written, and takes it back when it stops short', async () => {
    await twoPrompts()
    const b = builds()
    const order: string[] = []
    b.expect.mockImplementation((_id: string, reason?: string, to?: string) => order.push(`expect ${reason ?? 'none'} ${to ?? ''}`.trim()))
    const result = await applyGoBack(box, await planned('h1'), { history, builds: asBuilds(b) })
    expect(result.failed).toBeUndefined()
    expect(order[0]).toBe('expect goback h1')
    expect(b.expect.mock.calls[0]).toEqual(['box', 'goback', 'h1'])
    // Rebuilding is what ends the wait: nothing is left expected.
    expect(b.rebuild).toHaveBeenCalled()
  })

  it('does not leave a Go back expected when a file could not be written', async () => {
    await build({ 'box/a.py': 'a1', 'box/sub/b.py': 'b1' }, undefined, { uses: ['box/sub/b.py'] })
    await build({ 'box/a.py': 'a2', 'box/sub/b.py': 'b2' }, { prompt: 'u1' }, { uses: ['box/sub/b.py'] })
    const plan = await planned('h1')
    chmodSync(join(root, 'box', 'sub'), 0o555)
    const b = builds()
    const result = await applyGoBack(box, plan, { history, builds: asBuilds(b) })
    expect(result.failed).toBeDefined()
    expect(b.expect.mock.calls.at(-1)).toEqual(['box'])
  })

  it('puts the Params the person tried back as they were for that build', async () => {
    const p = { name: 'w', type: 'float', default: 10, literal: true, doc: null, editable: 'float' as const }
    await build({ 'box/model.py': 'v1' }, undefined, { params: [p], overrides: { applied: { w: 12 }, dropped: [] } })
    await build({ 'box/model.py': 'v2' }, { prompt: 'u1' }, { params: [p], overrides: { applied: {}, dropped: [] } })
    await setOverride(box.dir, 'w', 30, 10)
    const result = await applyGoBack(box, await planned('h1'), { history, builds: asBuilds(builds()) })
    expect(result.failed).toBeUndefined()
    expect(result.done).toContain('.torno/params.json')
    expect(overrideValues(box.dir)).toEqual({ w: 12 })
    // And when the build was made with none, none are tried.
    forgetParamFiles()
    await applyGoBack(box, await planned('h1'), { history, builds: asBuilds(builds()) })
    expect(overrideValues(box.dir)).toEqual({ w: 12 })
  })

  it('stops at a file it cannot write: what was written is told, the other is failed, and no temp file is left (RF2)', async () => {
    await build({ 'box/a.py': 'a1', 'box/sub/b.py': 'b1' }, undefined, { uses: ['box/sub/b.py'] })
    await build({ 'box/a.py': 'a2', 'box/sub/b.py': 'b2' }, { prompt: 'u1' }, { uses: ['box/sub/b.py'] })
    const plan = await planned('h1')
    expect(plan.write).toEqual(['box/a.py', 'box/sub/b.py'])
    chmodSync(join(root, 'box', 'sub'), 0o555)
    const b = builds()
    const result = await applyGoBack(box, plan, { history, builds: asBuilds(b) })
    expect(result.done).toEqual(['box/a.py'])
    expect(result.failed).toMatchObject({ file: 'box/sub/b.py', why: expect.any(String) })
    expect(read('box/a.py')).toBe('a1')
    expect(read('box/sub/b.py')).toBe('b2')
    expect(readdirSync(join(root, 'box')).filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(readdirSync(join(root, 'box', 'sub')).filter((n) => n.endsWith('.tmp'))).toEqual([])
    // Nothing was undone and nobody was told: the person decides what next.
    expect((await readHistory(box.dir)).some((x) => x.undone)).toBe(false)
    expect(existsSync(join(box.dir, '.torno', 'goback.json'))).toBe(false)
    expect(b.rebuild).not.toHaveBeenCalled()
  })

  it('writes nothing when a file it would write is a link', async () => {
    await twoPrompts()
    writeFileSync(join(root, 'elsewhere.py'), 'other')
    rmSync(join(root, 'box', 'model.py'))
    symlinkSync(join(root, 'elsewhere.py'), join(root, 'box', 'model.py'))
    const plan = await planned('h1')
    const result = await applyGoBack(box, plan, { history, builds: asBuilds(builds()) })
    expect(result.failed?.file).toBe('box/model.py')
    expect(result.done).toEqual([])
    expect(read('elsewhere.py')).toBe('other')
    expect(existsSync(join(root, 'box', 'new.py'))).toBe(true)
  })

  it('refuses a plan that names a file that is not this project\'s, whatever the window sent', async () => {
    await twoPrompts()
    const plan = await planned('h1')
    for (const bad of [{ write: ['common/x.py'] }, { write: ['../outside.py'] }, { write: ['box/../common/x.py'] }, { write: ['box/model.txt'] }, { remove: ['common/x.py'] }, { remove: ['box/mine.py'] }, { remove: ['box/model.py'] }, { write: ['box/never.py'] }]) {
      const result = await applyGoBack(box, { ...plan, ...bad }, { history, builds: asBuilds(builds()) })
      expect(result.refused, JSON.stringify(bad)).toEqual(expect.any(String))
      expect(result.done).toEqual([])
    }
    expect(read('box/model.py')).toBe('v3')
    expect(read('common/x.py')).toBe('x1')
  })

  it('is refused while a session works or a build runs, and with no copy to restore', async () => {
    await twoPrompts()
    const plan = await planned('h1')
    expect((await applyGoBack(box, plan, { history, builds: asBuilds(builds(true)) })).refused).toMatch(/build/)
    expect((await applyGoBack(box, plan, { history, builds: asBuilds(builds()), busy: () => 'Wait for Claude to finish.' })).refused).toBe('Wait for Claude to finish.')
    expect((await applyGoBack(box, { ...plan, fallback: 'undo' }, { history, builds: asBuilds(builds()) })).refused).toEqual(expect.any(String))
    expect(read('box/model.py')).toBe('v3')
  })
})

describe('takeGoBackNotice', () => {
  it('returns the text, keeps the file until it is told the answer was handed over, then nothing (RF6)', async () => {
    await twoPrompts()
    await applyGoBack(box, await planned('h1'), { history, builds: asBuilds(builds()) })
    const taken = await takeGoBackNotice(box.dir)
    expect(taken?.text).toBe('The person went back to build h1: the model files are as they were then, and prompts "make it taller", "add a lip" are undone. You keep what you learnt from them; do not try them again unless asked.')
    // The answer has not left: the notice is still there for the next one to ask.
    expect(existsSync(join(box.dir, '.torno', 'goback.json'))).toBe(true)
    expect((await takeGoBackNotice(box.dir))?.text).toBe(taken!.text)
    await taken!.done()
    expect(existsSync(join(box.dir, '.torno', 'goback.json'))).toBe(false)
    expect(await takeGoBackNotice(box.dir)).toBeNull()
  })

  it('does not drop a second Go back\'s notice written while the first answer was on its way', async () => {
    await twoPrompts()
    await applyGoBack(box, await planned('h1'), { history, builds: asBuilds(builds()) })
    const taken = await takeGoBackNotice(box.dir)
    await build({ 'box/model.py': 'v4' }, { prompt: 'u3', text: 'round it' })
    await applyGoBack(box, await planned('h1'), { history, builds: asBuilds(builds()) })
    await taken!.done()
    expect((await takeGoBackNotice(box.dir))?.text).toContain('"round it"')
  })

  it('tells of both when a second Go back comes before a prompt took the first', async () => {
    await twoPrompts()
    await build({ 'box/model.py': 'v4' }, { prompt: 'u3', text: 'round it' })
    await applyGoBack(box, await planned('h3'), { history, builds: asBuilds(builds()) })
    await applyGoBack(box, await planned('h1'), { history, builds: asBuilds(builds()) })
    const text = (await takeGoBackNotice(box.dir))!.text
    expect(text).toContain('went back to build h1')
    expect(text).toContain('"round it"')
    expect(text).toContain('"make it taller"')
    expect(text).toContain('"add a lip"')
  })

  it('is null when there is no file or it is not one of main\'s', async () => {
    expect(await takeGoBackNotice(box.dir)).toBeNull()
    mkdirSync(join(box.dir, '.torno'), { recursive: true })
    writeFileSync(join(box.dir, '.torno', 'goback.json'), 'not json')
    expect(await takeGoBackNotice(box.dir)).toBeNull()
    writeFileSync(join(box.dir, '.torno', 'goback.json'), JSON.stringify({ to: '../x', undone: [], prompts: [], at: 'now' }))
    expect(await takeGoBackNotice(box.dir)).toBeNull()
  })

  it('shortens a long list of prompts and a long prompt', async () => {
    await build({ 'box/model.py': 'v1' })
    for (let i = 0; i < 9; i++) await build({ 'box/model.py': `v${i + 2}` }, { prompt: `u${i}`, text: `${i} ${'x'.repeat(200)}` })
    await applyGoBack(box, await planned('h1'), { history, builds: asBuilds(builds()) })
    const text = (await takeGoBackNotice(box.dir))!.text
    expect(text.length).toBeLessThan(900)
    expect(text).toMatch(/and 3 more/)
  })
})
