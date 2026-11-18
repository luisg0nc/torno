import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Mark } from '../../shared/marks'
import type { Part, Scene } from '../../shared/scene'
import { type CardDeps, type KeepDeps, THUMB_MAX_BYTES, cardsOf, keepThumbnail, newestPython, peekMarks, saveThumbnail, thumbOf, thumbnailOnFile, thumbnailRefusal } from './cards'

const pin = (id: string, status: Mark['status']): Mark => ({ id, kind: 'pin', author: 'user', note: '', status, anchorState: 'ok', layout: 'assembly', revision: 1, camera: { position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0], ortho: true, fov: 35, zoom: 1 }, createdAt: '', anchor: { point: [0, 0, 0] } })
// As the store hands a dimension on: with the verdict its sanitiser worked out of the value.
const dimension = (id: string, value: number, measuredRevision?: number): Mark => ({ ...pin(id, 'sent'), kind: 'dimension', measure: 'distance', a: { point: [0, 0, 0] }, b: { point: [0, 0, 6] }, value, expected: 8, verdict: value === 8 ? 'pass' : 'fail', ...(measuredRevision ? { measuredRevision } : {}) }) as Mark
const png = (width: number, height: number, bytes = 200): Uint8Array => {
  const made = new Uint8Array(bytes)
  made.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(made.buffer).setUint32(16, width)
  new DataView(made.buffer).setUint32(20, height)
  return made
}
const missing = (): Promise<never> => Promise.reject(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }))

function deps(over: Partial<CardDeps> = {}): CardDeps {
  const files: Record<string, string> = {
    '/ws/b/.torno/marks.json': JSON.stringify({ next: 3, marks: [pin('M1', 'draft'), pin('M2', 'resolved'), dimension('M3', 6)] }),
    '/ws/b/.torno/thumb.json': JSON.stringify({ at: '2026-10-08T21:14:03.000Z', layout: 'assembly', parts: 2, model: 'b.py', sourcesMtimeMs: 1000, bytes: 200, hash: 'x' }),
    '/ws/c/.torno/marks.json': '{ not json'
  }
  return {
    objects: () => [
      { id: 'a', name: 'a', dir: '/ws/a', model: 'a.py' },
      { id: 'b', name: 'b', dir: '/ws/b', model: 'b.py' },
      { id: 'c', name: 'c', dir: '/ws/c', model: null, problem: 'no model file in /ws/c' }
    ],
    opened: (id) => id === 'a',
    build: (id) => (id === 'a' ? { objectId: 'a', status: 'failed', revision: 4, stale: true, error: { kind: 'exception', message: 'NameError: name x is not defined\n  File …' } } : undefined),
    marks: async () => [pin('M1', 'sent'), dimension('M2', 6, 4), dimension('M3', 8, 4), dimension('M4', 8, 3)],
    session: (id) => (id === 'a' ? 'working' : null),
    readFile: async (path) => files[path] ?? missing(),
    sourcesMtimeMs: async (dir) => (dir === '/ws/b' ? 2000 : null),
    size: async (path) => (path === '/ws/b/.torno/thumb.png' ? 200 : null),
    ...over
  }
}

describe('cardsOf', () => {
  it('says of an object opened here how its build, its marks and its dimensions stand', async () => {
    const [a] = await cardsOf(deps())
    expect(a).toEqual({
      id: 'a', name: 'a', opened: true,
      build: { status: 'failed', revision: 4, stale: true, error: 'NameError: name x is not defined' },
      thumb: null,
      marks: { open: 4, drafts: 0 },
      dimensions: { failing: 1, unmeasured: 1, passing: 1 },
      session: 'working'
    })
  })

  it('says of one not opened only what its files say, and no verdict of a build it has not seen', async () => {
    const [, b] = await cardsOf(deps())
    // What its one dimension said when it was last measured is of a run before: told as that, never as a verdict.
    expect(b).toEqual({ id: 'b', name: 'b', opened: false, thumb: { at: '2026-10-08T21:14:03.000Z', layout: 'assembly', behind: true }, marks: { open: 2, drafts: 1 }, dimensions: null, lastRun: { dimensions: 1, failed: 1 }, session: null, sourcesMtimeMs: 2000 })
  })

  it('reads the size on file into box, and gives none for a picture with none', async () => {
    const meta = { at: '2026-10-08T21:14:03.000Z', layout: 'assembly', parts: 2, model: 'b.py', sourcesMtimeMs: 1000, bytes: 200, hash: 'x' }
    const withBox = { ...meta, box: { x: 150, y: 80, z: 92, exact: true }, bench: true }
    const read = (text: string) => (path: string) => (path === '/ws/b/.torno/thumb.json' ? Promise.resolve(text) : missing())
    const [, b] = await cardsOf(deps({ readFile: read(JSON.stringify(withBox)) }))
    expect(b.box).toEqual({ x: 150, y: 80, z: 92, exact: true })
    expect(b.thumb).toMatchObject({ bench: true })
    const [, plain] = await cardsOf(deps({ readFile: read(JSON.stringify(meta)) }))
    expect(plain.box).toBeUndefined()
    expect(plain.thumb).not.toHaveProperty('bench')
    // A box that is not three lengths and a flag is no box: nothing is claimed of the size.
    for (const bad of [{ x: 1, y: 2, z: -3, exact: true }, { x: 1, y: 2, exact: true }, { x: 1, y: 2, z: 3 }, { x: 'a', y: 2, z: 3, exact: false }, { x: 1, y: 2, z: Infinity, exact: true }, 'big', null]) {
      const [, none] = await cardsOf(deps({ readFile: read(JSON.stringify({ ...meta, box: bad })) }))
      expect(none.box).toBeUndefined()
    }
    // The size of no picture is told of none: a picture that is not the one its facts are of takes it along.
    const [, dropped] = await cardsOf(deps({ readFile: read(JSON.stringify(withBox)), size: async () => 7 }))
    expect(dropped).toMatchObject({ thumb: null })
    expect(dropped.box).toBeUndefined()
  })

  it('says what a session waits on: the question, cut to 140 characters, and since when', async () => {
    const long = `${'Which radius should the fillet have? '.repeat(8)}`
    const waiting = (id: string) => (id === 'a' ? { question: long, since: 1234 } : id === 'b' ? { question: 'Short?', since: 99 } : null)
    const [a, b, c] = await cardsOf(deps({ waiting }))
    expect(a.waiting).toEqual({ question: long.slice(0, 140), since: 1234 })
    expect(a.waiting!.question).toHaveLength(140)
    expect(b.waiting).toEqual({ question: 'Short?', since: 99 })
    expect('waiting' in c).toBe(false)
    const [none] = await cardsOf(deps())
    expect('waiting' in none).toBe(false)
  })

  it('carries what git says of an object that has a model, and nothing where it says nothing', async () => {
    const state = { head: 'a1b2c3d', branch: 'main', files: ['a/a.py'], changed: 1 }
    const asked: string[] = []
    const [a, b, c] = await cardsOf(deps({ git: async (dir) => (asked.push(dir), dir === '/ws/a' ? state : null) }))
    expect(a.git).toEqual(state)
    expect('git' in b).toBe(false)
    // An object with no model is not asked about.
    expect('git' in c).toBe(false)
    expect(asked).toEqual(['/ws/a', '/ws/b'])
    const [failed] = await cardsOf(deps({ git: () => Promise.reject(new Error('boom')) }))
    expect('git' in failed).toBe(false)
  })

  it('says a marks file could not be read, and carries a problem', async () => {
    const [, , c] = await cardsOf(deps())
    // The folder by its name: where it is on this machine is for whoever asks (`problemAt`, a tooltip).
    expect(c).toMatchObject({ id: 'c', problem: 'no model file in c', problemAt: 'no model file in /ws/c', marks: null, thumb: null })
    expect(c.lastRun).toBeUndefined()
  })

  it('takes an object with no marks file as one with no marks, and one whose file cannot be opened as unread', async () => {
    const [, b] = await cardsOf(deps({ readFile: missing }))
    expect(b).toMatchObject({ marks: { open: 0, drafts: 0 }, thumb: null, dimensions: null })
    const [, denied] = await cardsOf(deps({ readFile: () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })) }))
    expect(denied.marks).toBeNull()
  })

  it('has no verdicts for an object opened here that has not built yet, and none when its marks cannot be listed', async () => {
    const [a] = await cardsOf(deps({ build: () => ({ objectId: 'a', status: 'building', revision: 0, stale: false }) }))
    expect(a).toMatchObject({ opened: true, build: { status: 'building', revision: 0, stale: false }, dimensions: null, lastRun: { dimensions: 3, failed: 1 } })
    const [unlisted] = await cardsOf(deps({ marks: () => Promise.reject(new Error('no folder')) }))
    expect(unlisted).toMatchObject({ marks: null, dimensions: null })
  })

  it('says the kernel let a build go, and that a picture is of another model file', async () => {
    const [a, b] = await cardsOf(deps({ build: () => ({ objectId: 'a', status: 'ok', revision: 2, stale: false, letGo: 'memory' }), sourcesMtimeMs: async (dir) => (dir === '/ws/common' ? null : 1000), objects: () => [{ id: 'a', name: 'a', dir: '/ws/a', model: 'a.py' }, { id: 'b', name: 'b', dir: '/ws/b', model: 'other.py' }] }))
    expect(a.build).toEqual({ status: 'ok', revision: 2, stale: false, letGo: 'memory' })
    expect(b.thumb).toEqual({ at: '2026-10-08T21:14:03.000Z', layout: 'assembly', behind: true })
  })
})

it('reads marks without keeping anything of a file that is not one', () => {
  expect(peekMarks('{ not json')).toBeNull()
  expect(peekMarks(JSON.stringify({ marks: 'none' }))).toBeNull()
  expect(peekMarks(JSON.stringify({ next: 2, marks: [pin('M1', 'draft')] }))).toHaveLength(1)
})

it('says a picture is at the bench scale only when its facts say so', () => {
  const meta = { at: '2026-10-08T21:14:03.000Z', layout: 'assembly' }
  expect(thumbOf({ ...meta, bench: true }, 1000)).toMatchObject({ bench: true })
  expect(thumbOf({ ...meta, bench: 'yes' }, 1000)).not.toHaveProperty('bench')
})

it('takes a picture as behind when a source is newer than it, or nothing says how new they were', () => {
  const meta = { at: '2026-10-08T21:14:03.000Z', layout: 'print', parts: 1, model: 'a.py', sourcesMtimeMs: 1000 }
  expect(thumbOf(meta, 1000)).toEqual({ at: meta.at, layout: 'print', behind: false })
  expect(thumbOf(meta, 1000.5)).toEqual({ at: meta.at, layout: 'print', behind: true })
  expect(thumbOf(meta, null)).toEqual({ at: meta.at, layout: 'print', behind: true })
  for (const none of [null, 'x', {}, { ...meta, at: 7 }, { ...meta, layout: '' }]) expect(thumbOf(none, 1000)).toBeNull()
})

it('says of a picture what it leaves out or draws otherwise than the parts are', () => {
  const meta = { at: '2026-10-08T21:14:03.000Z', layout: 'assembly', parts: 1, model: 'a.py', sourcesMtimeMs: 1000 }
  expect(thumbOf({ ...meta, cut: true, hidden: 2 }, 1000)).toEqual({ at: meta.at, layout: 'assembly', behind: false, cut: true, hidden: 2 })
  expect(thumbOf({ ...meta, apart: true, hidden: 0, cut: 'yes' }, 1000)).toEqual({ at: meta.at, layout: 'assembly', behind: false, apart: true })
})

it('keeps as a picture only a PNG of the size of one, and not a large one', () => {
  expect(thumbnailRefusal(png(480, 360))).toBeNull()
  expect(thumbnailRefusal(png(4000, 3000))).toBe('not a 480 × 360 picture')
  expect(thumbnailRefusal(new Uint8Array(200))).toBe('not a PNG')
  expect(thumbnailRefusal(png(480, 360, THUMB_MAX_BYTES + 1))).toBe('a picture of more than 512 KB')
  expect(thumbnailRefusal('PNG' as unknown as Uint8Array)).toBe('not a PNG')
})

describe('a picture is behind when anything its object is built from is newer', () => {
  it('is behind by a helper beside the model, and by a file of the common folder', async () => {
    const helper = async (dir: string): Promise<number | null> => (dir === '/ws/b' ? 1000 : dir === '/ws/common' ? 3000 : null)
    expect((await cardsOf(deps({ sourcesMtimeMs: helper })))[1].thumb).toMatchObject({ behind: true })
    const level = async (dir: string): Promise<number | null> => (dir === '/ws/b' ? 1000 : dir === '/ws/common' ? 900 : null)
    expect((await cardsOf(deps({ sourcesMtimeMs: level })))[1].thumb).toMatchObject({ behind: false })
  })

  it('is behind by a file the last build imported from another project, and the card names it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'torno-uses-'))
    try {
      mkdirSync(join(root, 'box'))
      writeFileSync(join(root, 'box', 'box.py'), 'x = 1\n')
      utimesSync(join(root, 'box', 'box.py'), 3, 3) // 3000 ms
      const dir = join(root, 'lid')
      const files: Record<string, string> = {
        [join(dir, '.torno', 'thumb.json')]: JSON.stringify({ at: '2026-10-08T21:14:03.000Z', layout: 'assembly', parts: 1, model: 'lid.py', sourcesMtimeMs: 1000, bytes: 200, hash: 'x' }),
        [join(dir, '.torno', 'marks.json')]: JSON.stringify({ next: 1, marks: [] })
      }
      const over = (uses: string[]): Partial<CardDeps> => ({
        objects: () => [{ id: 'lid', name: 'lid', dir, model: 'lid.py' }],
        opened: () => true,
        build: () => ({ objectId: 'lid', status: 'ok', revision: 1, stale: false }),
        marks: async () => [],
        readFile: async (path) => files[path] ?? missing(),
        sourcesMtimeMs: async (d) => (d === dir ? 1000 : null),
        size: async () => 200,
        uses: () => uses
      })
      const [card] = await cardsOf(deps(over(['box/box.py'])))
      expect(card.thumb).toMatchObject({ behind: true })
      expect(card.uses).toEqual(['box/box.py'])
      const [plain] = await cardsOf(deps(over([])))
      expect(plain.thumb).toMatchObject({ behind: false })
      expect(plain.uses).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('looks at the common folder once for all the cards', async () => {
    const asked: string[] = []
    await cardsOf(deps({ sourcesMtimeMs: async (dir) => (asked.push(dir), 1000) }))
    expect(asked.filter((dir) => dir === '/ws/common')).toHaveLength(1)
  })

  it('finds the newest of the Python files directly in a folder, and none where there is none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-sources-'))
    try {
      mkdirSync(join(dir, 'deep'))
      for (const [name, at] of [['model.py', 1000], ['helper.py', 3000], ['notes.txt', 9000], ['deep/far.py', 8000]] as const) {
        writeFileSync(join(dir, name), '')
        utimesSync(join(dir, name), at, at)
      }
      expect(await newestPython(dir)).toBe(3_000_000)
      expect(await newestPython(join(dir, 'deep', 'none'))).toBeNull()
      rmSync(join(dir, 'model.py'))
      rmSync(join(dir, 'helper.py'))
      expect(await newestPython(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

it('shows no picture when the one on file is not the one its facts are of', async () => {
  // By its size, which costs one stat a card; by its bytes when the picture itself is asked for.
  const [, other] = await cardsOf(deps({ size: async () => 201 }))
  expect(other.thumb).toBeNull()
  const [, gone] = await cardsOf(deps({ size: async () => null }))
  expect(gone.thumb).toBeNull()
})

describe('the picture on file', () => {
  const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
  const of = { layout: 'assembly', parts: 2, model: 'a.py', sourcesMtimeMs: 1000 }

  it('is written with what it is of under .torno, and git is told to pass over the two', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-thumb-'))
    try {
      const picture = png(480, 360)
      await saveThumbnail(dir, picture, { ...of, cut: true }, new Date('2026-10-09T21:14:03.000Z'))
      expect(readdirSync(dir)).toEqual(['.torno'])
      expect(readdirSync(join(dir, '.torno')).sort()).toEqual(['.gitignore', 'thumb.json', 'thumb.png'])
      expect(JSON.parse(readFileSync(join(dir, '.torno', 'thumb.json'), 'utf8'))).toEqual({ at: '2026-10-09T21:14:03.000Z', ...of, bytes: 200, hash: sha(picture), cut: true })
      expect(readFileSync(join(dir, '.torno', '.gitignore'), 'utf8')).toBe('thumb.png\nthumb.json\n')
      expect(new Uint8Array((await thumbnailOnFile(dir))!)).toEqual(picture)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is no picture when it and its facts are of two builds, or it is none at all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-thumb-'))
    try {
      expect(await thumbnailOnFile(dir)).toBeNull()
      const first = png(480, 360)
      await saveThumbnail(dir, first, of, new Date())
      // Another build's picture beside these facts: the same size, other bytes.
      const second = png(480, 360)
      second[100] = 7
      writeFileSync(join(dir, '.torno', 'thumb.png'), second)
      expect(await thumbnailOnFile(dir)).toBeNull()
      writeFileSync(join(dir, '.torno', 'thumb.png'), first)
      expect(await thumbnailOnFile(dir)).not.toBeNull()
      writeFileSync(join(dir, '.torno', 'thumb.json'), '{ not json')
      expect(await thumbnailOnFile(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is kept whole when two builds land close together: the last one asked for is what is there, picture and facts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-thumb-'))
    try {
      const pictures = Array.from({ length: 6 }, (_, i) => {
        const one = png(480, 360, 300 + i)
        one[50] = i
        return one
      })
      await Promise.all(pictures.map((one, i) => saveThumbnail(dir, one, { ...of, layout: `l${i}` }, new Date())))
      const facts = JSON.parse(readFileSync(join(dir, '.torno', 'thumb.json'), 'utf8'))
      expect(facts).toMatchObject({ layout: 'l5', bytes: 305, hash: sha(pictures[5]) })
      expect(new Uint8Array((await thumbnailOnFile(dir))!)).toEqual(pictures[5])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('keeping a picture the window drew', () => {
  function keeping(dir: string, over: Partial<KeepDeps> = {}): KeepDeps {
    return { object: (id) => (id === 'a' ? { id: 'a', name: 'a', dir, model: 'a.py' } : undefined), opened: (id) => id === 'a', lastBuild: () => ({ revision: 3, startedMs: 5_000_000 }), ...over }
  }
  const facts = (dir: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(join(dir, '.torno', 'thumb.json'), 'utf8'))
    } catch {
      return null
    }
  }

  it('keeps one of the last build of an object opened here, and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-keep-'))
    try {
      writeFileSync(join(dir, 'a.py'), '')
      utimesSync(join(dir, 'a.py'), 1000, 1000)
      const of = { layout: 'assembly', parts: 2 }
      expect(await keepThumbnail(keeping(dir), 'b', 3, png(480, 360), of)).toBe(false)
      expect(await keepThumbnail(keeping(dir, { opened: () => false }), 'a', 3, png(480, 360), of)).toBe(false)
      expect(await keepThumbnail(keeping(dir), 'a', 2, png(480, 360), of)).toBe(false)
      expect(await keepThumbnail(keeping(dir), 'a', 3, png(4000, 3000), of)).toBe(false)
      expect(await keepThumbnail(keeping(dir), 'a', 3, new Uint8Array(300), of)).toBe(false)
      expect(await keepThumbnail(keeping(dir), 'a', 3, png(480, 360), { layout: '', parts: 2 })).toBe(false)
      expect(await keepThumbnail(keeping(dir), 'a', 3, png(480, 360), { layout: 'assembly', parts: 1.5 })).toBe(false)
      expect(await keepThumbnail(keeping(dir, { object: () => ({ id: 'a', name: 'a', dir, model: null }) }), 'a', 3, png(480, 360), of)).toBe(false)
      expect(facts(dir)).toBeNull()
      expect(await keepThumbnail(keeping(dir), 'a', 3, png(480, 360), { ...of, hidden: 1, cut: true, apart: 'yes' as never })).toBe(true)
      expect(facts(dir)).toMatchObject({ layout: 'assembly', parts: 2, model: 'a.py', sourcesMtimeMs: 1_000_000, hidden: 1, cut: true })
      expect(facts(dir)).not.toHaveProperty('apart')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the size main works out of the build, and the bench scale only with a size', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-keep-'))
    try {
      writeFileSync(join(dir, 'a.py'), '')
      const part = (name: string, min: number[], max: number[], exact?: boolean): Part => ({ key: `assembly:${name}`, name, layout: 'assembly', loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min, max } as Part['bbox'], ...(exact === undefined ? {} : { bboxExact: exact }), volume: 1, faceCount: 1, edgeCount: 1, triangleCount: 1, valid: true, hash: name, mesh: {} as Part['mesh'] })
      const scene: Scene = { model: 'a.py', layouts: ['assembly'], parts: [part('tub', [0, 0, 0], [150, 80, 60], true), part('lid', [0, 0, 60], [150, 80, 92], true)], seconds: 0, output: '' }
      const build = { revision: 3, startedMs: 5_000_000, scene }
      expect(await keepThumbnail(keeping(dir, { lastBuild: () => build }), 'a', 3, png(480, 360), { layout: 'assembly', parts: 2, bench: true })).toBe(true)
      expect(facts(dir)).toMatchObject({ box: { x: 150, y: 80, z: 92, exact: true }, bench: true })
      // The window cannot say a size: only the build's own scene does. And with no build to measure there is no bench claim.
      expect(await keepThumbnail(keeping(dir, { lastBuild: () => ({ revision: 3 }) }), 'a', 3, png(480, 360), { layout: 'assembly', parts: 2, bench: true, box: { x: 1, y: 1, z: 1, exact: true } } as never)).toBe(true)
      expect(facts(dir)).not.toHaveProperty('box')
      expect(facts(dir)).not.toHaveProperty('bench')
      // A layout the scene does not have has no size either.
      await keepThumbnail(keeping(dir, { lastBuild: () => build }), 'a', 3, png(480, 360), { layout: 'bed', parts: 1, bench: true })
      expect(facts(dir)).not.toHaveProperty('box')
      // A picture not in the bench's mode keeps the size and no claim of scale.
      await keepThumbnail(keeping(dir, { lastBuild: () => build }), 'a', 3, png(480, 360), { layout: 'assembly', parts: 2 })
      expect(facts(dir)).toMatchObject({ box: { x: 150, y: 80, z: 92, exact: true } })
      expect(facts(dir)).not.toHaveProperty('bench')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('says the sources were no newer than when the build was started: one saved during the build is newer than the picture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-keep-'))
    try {
      writeFileSync(join(dir, 'a.py'), '')
      writeFileSync(join(dir, 'helper.py'), '')
      utimesSync(join(dir, 'a.py'), 1000, 1000)
      utimesSync(join(dir, 'helper.py'), 9000, 9000)
      await keepThumbnail(keeping(dir), 'a', 3, png(480, 360), { layout: 'assembly', parts: 2 })
      expect(facts(dir)).toMatchObject({ sourcesMtimeMs: 5_000_000 })
      // And a card then says so.
      expect(thumbOf(facts(dir), 9_000_000)).toMatchObject({ behind: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
