import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIN_SCAN_OPACITY } from '../shared/scans'
import type { SavedView } from '../shared/views'
import { forgetSceneFiles, loadSceneFile, proposalAsked, proposing, saveSceneFile, sceneFileNow, sceneFilesSettled, type SceneFile } from './scenefile'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-scenefile-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  forgetSceneFiles()
})

const CAMERA = { position: [120, -90, 60], target: [0, 0, 6], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as SavedView['camera']
const view = (name: string, more: Partial<SavedView> = {}): SavedView => ({ name, author: 'user', layout: 'assembly', camera: CAMERA, hidden: [], at: '2026-10-09T21:14:03.000Z', ...more })

describe('scene file', () => {
  it('round trips, creating .torno/ on demand', async () => {
    const file: SceneFile = { layout: 'print', layers: { post: { visible: false }, base: { color: '#112233', opacity: 0.4 } } }
    await saveSceneFile(dir, file)
    expect(await loadSceneFile(dir)).toEqual(file)
    // Nothing is left behind by the atomic write, and nothing is written outside .torno/.
    expect(readdirSync(dir)).toEqual(['.torno'])
    expect(readdirSync(join(dir, '.torno'))).toEqual(['scene.json'])
  })

  it('a later save replaces an earlier one', async () => {
    await saveSceneFile(dir, { layout: 'print', layers: { post: { visible: false } } })
    await saveSceneFile(dir, { layers: {} })
    expect(await loadSceneFile(dir)).toEqual({ layers: {} })
  })

  it('says what is still being written, for whoever must not leave before it is on the disk', async () => {
    expect(sceneFilesSettled()).toBeNull()
    // Asked and not waited for, as by a window that is closing.
    void saveSceneFile(dir, { layers: { post: { visible: false } } })
    void saveSceneFile(join(dir, 'file-not-folder', '\0'), { layers: {} }).catch(() => {})
    const settled = sceneFilesSettled()
    expect(settled).not.toBeNull()
    expect(readdirSync(dir)).toEqual([])
    await settled
    expect(await loadSceneFile(dir)).toEqual({ layers: { post: { visible: false } } })
    expect(sceneFilesSettled()).toBeNull()
  })

  it('a missing file gives defaults', async () => {
    expect(await loadSceneFile(dir)).toEqual({ layers: {} })
    expect(readdirSync(dir)).toEqual([])
  })

  it('a corrupt file gives defaults and is not overwritten until the next save', async () => {
    const path = join(dir, '.torno', 'scene.json')
    mkdirSync(join(dir, '.torno'))
    writeFileSync(path, '{"layers": {"post"')
    expect(await loadSceneFile(dir)).toEqual({ layers: {} })
    expect(readFileSync(path, 'utf8')).toBe('{"layers": {"post"')
    await saveSceneFile(dir, { layers: { post: { visible: false } } })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ layers: { post: { visible: false } } })
  })

  it('drops what is not a layer setting', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(
      join(dir, '.torno', 'scene.json'),
      JSON.stringify({ layout: 7, layers: { post: { visible: 'no', opacity: 3, color: '#abc', extra: 1 }, base: null }, views: [] })
    )
    expect(await loadSceneFile(dir)).toEqual({ layers: { post: { color: '#abc', opacity: 1 } } })
  })

  it('gives defaults when the file holds something other than an object', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'scene.json'), '[1, 2]')
    expect(await loadSceneFile(dir)).toEqual({ layers: {} })
  })

  it('keeps a section that is a plane, its normal a unit vector, and drops one that is not', async () => {
    await saveSceneFile(dir, { layers: {}, section: { origin: [0, 0, 12.5], normal: [0, 0, 2] } })
    expect(await loadSceneFile(dir)).toEqual({ layers: {}, section: { origin: [0, 0, 12.5], normal: [0, 0, 1] } })
    await saveSceneFile(dir, { layers: {}, section: null })
    expect(JSON.parse(readFileSync(join(dir, '.torno', 'scene.json'), 'utf8'))).toEqual({ layers: {} })
    for (const not of [{ origin: [0, 0, 1], normal: [0, 0, 0] }, { origin: [0, 0, null], normal: [0, 0, 1] }, { origin: [0, 0], normal: [0, 0, 1] }, 'z', 4]) {
      writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layout: 'print', layers: {}, section: not }))
      expect(await loadSceneFile(dir)).toEqual({ layout: 'print', layers: {} })
    }
  })
  it('keeps how each scan is looked at, by its id, and drops what is none', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ scans: { S1: { visible: false, opacity: 7, colour: 'own' }, lid: { visible: false }, S2: { colour: 'rainbow' } } }))
    expect(await loadSceneFile(dir)).toEqual({ layers: {}, scans: { S1: { visible: false, opacity: 1, colour: 'own' } } })
    // A scan thinned to nothing could not be found again: the least is 5 %.
    await saveSceneFile(dir, { layers: {}, scans: { S3: { opacity: 0 }, S4: {} } })
    expect(await loadSceneFile(dir)).toEqual({ layers: {}, scans: { S3: { opacity: MIN_SCAN_OPACITY } } })
    expect(MIN_SCAN_OPACITY).toBe(0.05)
    for (const not of [[], 'S1', null, { S1: 4 }]) {
      writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ scans: not }))
      expect(await loadSceneFile(dir)).toEqual({ layers: {} })
    }
  })

  it('keeps how each layout is drawn apart, within its ranges, and drops what is none', async () => {
    await saveSceneFile(dir, { layers: {}, explode: { assembly: { amount: 0.4, axis: 'z' }, print: { amount: 0 }, bad: 'x', also: { amount: 9, scale: 9 } } } as unknown as SceneFile)
    expect(await loadSceneFile(dir)).toEqual({ layers: {}, explode: { assembly: { amount: 0.4, scale: 1, axis: 'z' }, also: { amount: 1, scale: 4, axis: 'centre' } } })
    // Together, but with a scale and an axis of its own: kept for when it is drawn apart again.
    await saveSceneFile(dir, { layers: {}, explode: { assembly: { amount: 0, scale: 2, axis: 'x' }, ['l'.repeat(101)]: { amount: 1, scale: 1, axis: 'x' } } })
    expect(await loadSceneFile(dir)).toEqual({ layers: {}, explode: { assembly: { amount: 0, scale: 2, axis: 'x' } } })
    for (const not of [[], 'half', null, 3, { assembly: { amount: 0 } }]) {
      writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ explode: not }))
      expect(await loadSceneFile(dir)).toEqual({ layers: {} })
    }
  })

  it('keeps the groups folded in the layers list as names, and drops what is none', async () => {
    await saveSceneFile(dir, { layers: {}, folded: ['flat', 'tall'] })
    expect(await loadSceneFile(dir)).toEqual({ layers: {}, folded: ['flat', 'tall'] })
    for (const not of ['flat', [1], [], ['a\nb'], { flat: true }]) {
      forgetSceneFiles()
      writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layers: {}, folded: not }))
      expect(await loadSceneFile(dir)).toEqual({ layers: {} })
    }
    forgetSceneFiles()
    writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layers: {}, folded: ['flat', 2, 'flat'] }))
    expect(await loadSceneFile(dir)).toEqual({ layers: {}, folded: ['flat'] })
  })

  it('keeps the saved views that are views, and loses only the one that is broken', async () => {
    const hinge = view('Hinge side', { hidden: ['lid'], explode: { amount: 0.4, scale: 1, axis: 'z' } })
    await saveSceneFile(dir, { layers: {}, views: [hinge, { name: 'broken' }, view('hinge SIDE'), view('Cut', { section: { origin: [0, 0, 3], normal: [0, 0, 2] } })] } as unknown as SceneFile)
    expect(JSON.parse(readFileSync(join(dir, '.torno', 'scene.json'), 'utf8')).views.map((v: SavedView) => v.name)).toEqual(['Hinge side', 'Cut'])
    forgetSceneFiles()
    const read = await loadSceneFile(dir)
    expect(read.views).toEqual([hinge, view('Cut', { section: { origin: [0, 0, 3], normal: [0, 0, 1] } })])
    // A file edited by hand, or by a merge: what is no list of views is none, and the rest of the file is read.
    writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layout: 'print', views: { name: 'x' } }))
    expect(await loadSceneFile(dir)).toEqual({ layout: 'print', layers: {} })
    await saveSceneFile(dir, { layers: {}, views: [] })
    expect(await loadSceneFile(dir)).toEqual({ layers: {} })
  })

  it('answers with the file as it was last read or given, at once, and reads the disk the first time', async () => {
    mkdirSync(join(dir, '.torno'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layers: {}, views: [view('On disk')] }))
    expect((await sceneFileNow(dir)).views?.map((v) => v.name)).toEqual(['On disk'])
    // Given by the window: known before it is on the disk.
    const save = saveSceneFile(dir, { layout: 'print', layers: {}, views: [view('On disk'), view('New')] })
    expect((await sceneFileNow(dir)).views?.map((v) => v.name)).toEqual(['On disk', 'New'])
    await save
    // Changed behind torno's back: not seen until the file is read again, as it is when its object is opened.
    writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layers: {} }))
    expect((await sceneFileNow(dir)).views).toHaveLength(2)
    expect((await loadSceneFile(dir)).views).toBeUndefined()
    expect((await sceneFileNow(dir)).views).toBeUndefined()
    // A folder with no file has no views; nothing is written for the asking.
    const empty = mkdtempSync(join(tmpdir(), 'torno-scenefile-'))
    expect(await sceneFileNow(empty)).toEqual({ layers: {} })
    expect(readdirSync(empty)).toEqual([])
    rmSync(empty, { recursive: true, force: true })
  })

  it('takes a view for the agent\'s, or for proposed, only when main asked for it or the file said so before', async () => {
    await saveSceneFile(dir, { layers: {}, views: [view('Mine')] })
    // The window says of its own accord that a view is the agent's proposal: it is the person's.
    await saveSceneFile(dir, { layers: {}, views: [view('Mine'), view('Wall', { author: 'agent', proposed: true, note: 'thin' })] })
    expect((await sceneFileNow(dir)).views).toEqual([view('Mine'), view('Wall', { note: 'thin' })])
    // Main asked the window to keep the agent's "Latch": that one is the agent's, and proposed.
    const done = proposalAsked(dir, ' latch ')
    await saveSceneFile(dir, { layers: {}, views: [view('Mine'), view('Latch', { author: 'agent', proposed: true })] })
    done()
    expect((await sceneFileNow(dir)).views?.[1]).toEqual(view('Latch', { author: 'agent', proposed: true }))
    // It stays so in the saves that follow, and under another name (the same view: saved at the same moment).
    await saveSceneFile(dir, { layers: {}, views: [view('Mine'), view('Latch', { author: 'agent', proposed: true })] })
    expect((await sceneFileNow(dir)).views?.[1].proposed).toBe(true)
    // Kept by the person: the agent's still, proposed no more, and never proposed again on the window's word.
    await saveSceneFile(dir, { layers: {}, views: [view('Mine'), view('The latch', { author: 'agent' })] })
    expect((await sceneFileNow(dir)).views?.[1]).toEqual(view('The latch', { author: 'agent' }))
    await saveSceneFile(dir, { layers: {}, views: [view('Mine'), view('The latch', { author: 'agent', proposed: true })] })
    expect((await sceneFileNow(dir)).views?.[1]).toEqual(view('The latch', { author: 'agent' }))
    // What the file on the disk says is what it says: read, it is taken as it is.
    forgetSceneFiles()
    writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layers: {}, views: [view('Read', { author: 'agent', proposed: true })] }))
    expect((await loadSceneFile(dir)).views?.[0].proposed).toBe(true)
  })

  describe('a view the agent proposes, kept through the window (review I1, M13)', () => {
    const proposal = view('Wall', { author: 'agent', proposed: true })
    class NoAnswer extends Error {}
    const unanswered = (e: unknown): boolean => e instanceof NoAnswer

    it('is still the agent\'s proposal when the window keeps it after main stopped waiting for its answer', async () => {
      await saveSceneFile(dir, { layers: {} })
      await expect(proposing(dir, 'Wall', () => Promise.reject(new NoAnswer('the torno window did not answer within 10 s')), unanswered)).rejects.toThrow('did not answer')
      // The window gets to it later, keeps it, and gives the file.
      await saveSceneFile(dir, { layers: {}, views: [proposal] })
      expect((await sceneFileNow(dir)).views).toEqual([proposal])
      expect(JSON.parse(readFileSync(join(dir, '.torno', 'scene.json'), 'utf8')).views[0]).toMatchObject({ name: 'Wall', author: 'agent', proposed: true })
    })

    it('lets go of the name once the window has answered, kept or refused', async () => {
      await saveSceneFile(dir, { layers: {} })
      await expect(proposing(dir, 'Wall', () => Promise.reject(new Error('the user has a view named "Wall": choose another name')), unanswered)).rejects.toThrow('choose another name')
      await saveSceneFile(dir, { layers: {}, views: [proposal] })
      expect((await sceneFileNow(dir)).views).toEqual([view('Wall')])
      expect(await proposing(dir, 'Latch', async () => (void saveSceneFile(dir, { layers: {}, views: [view('Wall'), view('Latch', { author: 'agent', proposed: true })] }), 'kept'), unanswered)).toBe('kept')
      await saveSceneFile(dir, { layers: {}, views: [view('Wall'), view('Other', { author: 'agent', proposed: true, at: 'later' })] })
      expect((await sceneFileNow(dir)).views?.[1]).toEqual(view('Other', { at: 'later' }))
    })

    it('answers once the file the window gave is on the disk, and says so when it could not be written', async () => {
      await saveSceneFile(dir, { layers: {} })
      let onDisk: string[] | undefined
      await proposing(dir, 'Wall', async () => void saveSceneFile(dir, { layers: {}, views: [proposal] }), unanswered).then(() => {
        onDisk = JSON.parse(readFileSync(join(dir, '.torno', 'scene.json'), 'utf8')).views.map((v: SavedView) => v.name)
      })
      expect(onDisk).toEqual(['Wall'])
      // The folder cannot be written: the view is in the window, and not kept.
      const blocked = mkdtempSync(join(tmpdir(), 'torno-scenefile-'))
      writeFileSync(join(blocked, '.torno'), 'a file where the folder would be')
      await expect(proposing(blocked, 'Wall', async () => void saveSceneFile(blocked, { layers: {}, views: [proposal] }).catch(() => {}), unanswered)).rejects.toThrow(/^the view is in the user's strip of views but could not be written to scene\.json \(.+\): it will be gone when torno is closed$/)
      rmSync(blocked, { recursive: true, force: true })
    })
  })

  it('does not take what it read for newer than what it was given meanwhile (review M1)', async () => {
    mkdirSync(join(dir, '.torno'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layers: {}, views: [view('On disk')] }))
    for (let n = 0; n < 20; n++) {
      forgetSceneFiles()
      const reading = sceneFileNow(dir)
      const save = saveSceneFile(dir, { layers: {}, views: [view('On disk'), view('New')] })
      await Promise.all([reading, save])
      expect((await sceneFileNow(dir)).views?.map((v) => v.name)).toEqual(['On disk', 'New'])
      writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layers: {}, views: [view('On disk')] }))
    }
  })

  it('reads the file before the first save of a folder it has not read: what the file says is the agent\'s stays so (review M2)', async () => {
    mkdirSync(join(dir, '.torno'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'scene.json'), JSON.stringify({ layers: {}, views: [view('Wall', { author: 'agent', proposed: true }), view('Kept', { author: 'agent' })] }))
    await saveSceneFile(dir, { layout: 'print', layers: {}, views: [view('Wall', { author: 'agent', proposed: true }), view('Kept', { author: 'agent' }), view('Sly', { author: 'agent', proposed: true, at: 'later' })] })
    expect((await sceneFileNow(dir)).views).toEqual([view('Wall', { author: 'agent', proposed: true }), view('Kept', { author: 'agent' }), view('Sly', { at: 'later' })])
  })
})
