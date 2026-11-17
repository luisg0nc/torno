import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { transformKey } from '../../shared/lineup'
import { mainPlaneFrame } from '../../shared/planes'
import { droppedNames } from '../dropped'
import { jpeg, png } from '../notes/testing'
import { PHOTOS_FOLDER, dropPhotos, isPhotoName } from './dropped'
import { TracingStore } from './store'
import { PhotoSweep, namedAside, sweepPhotos } from './sweep'

let dir: string
let store: TracingStore
const folder = (): string => join(dir, '.torno', 'tracings', 'photos')
const names = (): string[] => readdirSync(folder()).sort()
const listed = (): Promise<string[]> => droppedNames(dir, PHOTOS_FOLDER, isPhotoName).then((n) => n.sort())
const put = (...files: string[]): void => {
  mkdirSync(folder(), { recursive: true })
  for (const file of files) writeFileSync(join(folder(), file), 'x')
}
/** Made long ago: past the time a new file is left alone. */
const aged = (...files: string[]): void => {
  const long = new Date(Date.now() - 3_600_000)
  for (const file of files) utimesSync(join(folder(), file), long, long)
}
const agedAll = (): void => aged(...names().filter((n) => !n.startsWith('.')))
const newStore = (): TracingStore => new TracingStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
const pic = (seed: number): Uint8Array => {
  const bytes = png(1000, 800)
  bytes[30] = seed
  return bytes
}
const SQUARE = [
  { photo: [100, 100], uv: [0, 80] },
  { photo: [600, 100], uv: [100, 80] },
  { photo: [600, 500], uv: [100, 0] },
  { photo: [100, 500], uv: [0, 0] }
]
const make = (): Promise<unknown> => store.make('bracket', { name: 'front', layout: 'assembly', plane: { ...mainPlaneFrame('XZ', 0), from: { kind: 'main', axis: 'XZ', offset: 0 } } }, 'person')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-photos-sweep-'))
  store = newStore()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const none = { live: new Set<string>(), kept: new Set<string>() }
const A = 'p-aaaaaaaaaaaa.jpg'
const B = 'p-bbbbbbbbbbbb.png'
const S = 's-cccccccccccc.jpg'

describe('sweepPhotos', () => {
  it('removes the photos and copies torno dropped that no tracing holds, and nothing else', async () => {
    put('.gitignore', A, B, S, 'mine.jpg', 'notes.txt')
    aged(A, B, S)
    await dropPhotos(dir, [B, S, 'mine.jpg'])
    await sweepPhotos(dir, none, 60_000)
    expect(names()).toEqual(['.gitignore', 'mine.jpg', 'notes.txt', A])
    expect(await listed()).toEqual([])
  })

  it('never removes a file that is not on the list, whatever no tracing names: another branch has other tracings', async () => {
    put(A, B)
    aged(A, B)
    await sweepPhotos(dir, none, 60_000)
    expect(names()).toEqual([A, B])
    await dropPhotos(dir, [B])
    await sweepPhotos(dir, none, 60_000)
    expect(names()).toEqual([A])
  })

  it('leaves a listed file changed in the last minute, and keeps it listed for the next run', async () => {
    put(A, B)
    aged(A)
    await dropPhotos(dir, [A, B])
    await sweepPhotos(dir, none, 60_000)
    expect(names()).toEqual(['dropped.json', B])
    expect(await listed()).toEqual([B])
  })

  it('leaves a link, even a listed one, and what it leads to', async () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(join(dir, 'else.jpg'), 'x')
    symlinkSync(join(dir, 'else.jpg'), join(folder(), A))
    await dropPhotos(dir, [A])
    await sweepPhotos(dir, none, 0)
    expect(names()).toContain(A)
    expect(existsSync(join(dir, 'else.jpg'))).toBe(true)
  })

  it('refuses where a link stands in the place of the folder, and deletes nothing through it', async () => {
    mkdirSync(join(dir, '.torno', 'tracings'), { recursive: true })
    mkdirSync(join(dir, 'elsewhere'))
    writeFileSync(join(dir, 'elsewhere', A), 'x')
    writeFileSync(join(dir, 'elsewhere', 'dropped.json'), `{"dropped":["${A}"]}`)
    symlinkSync(join(dir, 'elsewhere'), folder())
    await expect(sweepPhotos(dir, none, 0)).rejects.toThrow(/link/)
    expect(existsSync(join(dir, 'elsewhere', A))).toBe(true)
  })

  it('does nothing when there is no folder', async () => {
    await expect(sweepPhotos(dir, none, 0)).resolves.toBeUndefined()
  })
})

describe('namedAside', () => {
  it('finds the photos a tracings file kept aside names, and none a file in use names', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'tracings.json.corrupt-2026'), `{ "file": "${A}", "straightened": "${S}"`)
    writeFileSync(join(dir, '.torno', 'tracings.json.dropped-2026'), `"${B}"`)
    writeFileSync(join(dir, '.torno', 'tracings.json'), '"p-dddddddddddd.png"')
    expect([...(await namedAside(dir))].sort()).toEqual([A, B, S])
  })

  it('finds nothing without a folder', async () => {
    expect([...(await namedAside(dir))]).toEqual([])
  })
})

describe('PhotoSweep', () => {
  it('sweeps, after a swap, the old photo and its straightened copy a minute later, in the next run', async () => {
    await make()
    await store.setPhoto('bracket', 'T1', pic(1))
    const lined = (await store.lineUp('bracket', 'T1', SQUARE, 'straight')).photo
    const before = (await store.setStraightened('bracket', 'T1', jpeg(500, 400), { sha256: lined?.sha256 as string, transform: transformKey(lined?.transform as number[]) })).photo
    const now = (await store.setPhoto('bracket', 'T1', pic(2))).photo
    expect(await listed()).toEqual([before?.file, before?.straightened].sort())
    // Young: left alone.
    await new PhotoSweep(newStore()).once('bracket', dir)
    expect(names()).toContain(before?.file)
    // A minute later, in a run of its own.
    agedAll()
    await new PhotoSweep(newStore()).once('bracket', dir)
    expect(names().filter((n) => !n.startsWith('.'))).toEqual([now?.file])
    expect(await listed()).toEqual([])
  })

  it('keeps a photo named by a tracing removed in this run: an undo can bring it back; the next run takes it', async () => {
    await make()
    const file = (await store.setPhoto('bracket', 'T1', pic(1))).photo?.file as string
    await store.remove('bracket', 'T1', 'person')
    agedAll()
    await new PhotoSweep(store).once('bracket', dir)
    expect(names()).toContain(file)
    expect(await listed()).toEqual([file])
    await new PhotoSweep(newStore()).once('bracket', dir)
    expect(names()).not.toContain(file)
  })

  it('never takes the photo of a tracing that was removed and put back in this run, nor in the next', async () => {
    await make()
    const file = (await store.setPhoto('bracket', 'T1', pic(1))).photo?.file as string
    await store.remove('bracket', 'T1', 'person')
    await store.restore('bracket', 'T1')
    agedAll()
    await new PhotoSweep(store).once('bracket', dir)
    expect(names()).toContain(file)
    await new PhotoSweep(newStore()).once('bracket', dir)
    expect(names()).toContain(file)
    // It is on the list no more: the tracing holds it.
    expect(await listed()).toEqual([])
  })

  it('keeps a photo that a tracings.json of another branch names and nothing lists, whatever this branch holds', async () => {
    await make()
    put('p-eeeeeeeeeeee.jpg')
    agedAll()
    await new PhotoSweep(newStore()).once('bracket', dir)
    expect(names()).toContain('p-eeeeeeeeeeee.jpg')
  })

  it('keeps a listed photo that a tracings file kept aside names', async () => {
    await make()
    put(A)
    aged(A)
    await dropPhotos(dir, [A])
    writeFileSync(join(dir, '.torno', 'tracings.json.dropped-2026'), `{ "file": "${A}" }`)
    await new PhotoSweep(newStore()).once('bracket', dir)
    expect(names()).toContain(A)
    expect(await listed()).toEqual([A])
  })

  it('sweeps nothing in a run where the tracings file could not be read, so that its photos are not taken before anyone knows what names them', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'tracings.json'), 'not json')
    put(A)
    aged(A)
    await dropPhotos(dir, [A])
    await new PhotoSweep(newStore()).once('bracket', dir)
    expect(names()).toContain(A)
  })

  it('sweeps once for each project in a run, until it is forgotten, and never rejects', async () => {
    await make()
    const sweep = new PhotoSweep(newStore())
    await sweep.once('bracket', dir)
    put(A)
    aged(A)
    await dropPhotos(dir, [A])
    await sweep.once('bracket', dir)
    expect(names()).toContain(A)
    sweep.forget()
    await sweep.once('bracket', dir)
    expect(names()).not.toContain(A)
    await expect(new PhotoSweep(newStore()).once('nope', join(dir, 'gone'))).resolves.toBeUndefined()
  })
})
