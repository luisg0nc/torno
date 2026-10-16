import { beforeEach, describe, expect, it } from 'vitest'
import type { Reimported, ScanInfo } from '../../shared/scans'
import { actions, store } from '../state/store'
import { importScan, reimportScan, scanDropped } from './scanDrop'

// Fix round 1 (I3): what comes of a drop is worked out in one place, and what is refused is for the panel to say.
describe('what comes of a drop on the view', () => {
  const at = (paths: Record<string, string>) => (file: { name: string }) => paths[file.name] ?? ''

  it('is the first scan among the files, by its place on the disk, and a word about the scans left', () => {
    expect(scanDropped([{ name: 'notes.txt' }, { name: 'Micra.GLB' }], at({ 'Micra.GLB': '/d/Micra.GLB' }), null)).toEqual({ path: '/d/Micra.GLB', said: null })
    expect(scanDropped([{ name: 'a.stl' }, { name: 'b.ply' }, { name: 'c.obj' }], at({ 'a.stl': '/d/a.stl' }), null)).toEqual({ path: '/d/a.stl', said: 'One scan at a time: a.stl is being read; b.ply and c.obj were left' })
  })

  it('is a sentence for what is no scan, has no place on the disk, or comes while another is read', () => {
    expect(scanDropped([{ name: 'notes.txt' }], at({}), null)).toEqual({ path: null, said: 'notes.txt is not a scan: torno reads .glb, .gltf, .obj, .ply and .stl scans' })
    expect(scanDropped([{ name: 'a.txt' }, { name: 'b.txt' }], at({}), null)).toEqual({ path: null, said: 'None of the 2 files is a scan: torno reads .glb, .gltf, .obj, .ply and .stl scans' })
    expect(scanDropped([{ name: 'a.stl' }], at({}), null)).toEqual({ path: null, said: 'a.stl: That file has no place on the disk' })
    expect(scanDropped([{ name: 'a.stl' }], at({ 'a.stl': '/d/a.stl' }), 'Micra.glb')).toEqual({ path: null, said: 'Micra.glb is still being read: import a.stl once it is in' })
  })
})

describe('reading a file as a scan', () => {
  let ended: Array<{ resolve(value: unknown): void; reject(e: Error): void }>
  const asked: string[] = []
  const pending = (what: string): Promise<never> => {
    asked.push(what)
    return new Promise((resolve, reject) => ended.push({ resolve: resolve as (value: unknown) => void, reject }))
  }
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    ended = []
    asked.length = 0
    actions.setWorkspace(null)
    actions.openObject('bracket', { layers: {} })
    ;(globalThis as unknown as { window: unknown }).window = { torno: { scans: { import: (_o: string, path: string) => pending(`import ${path}`), reimport: (_o: string, id: string) => pending(`reimport ${id}`) } } }
  })

  it('is said from the moment it is asked, one file at a time, and a refusal is kept for the panel', async () => {
    importScan('bracket', '/d/Micra.glb')
    expect(store.getState()).toMatchObject({ importing: { name: 'Micra.glb', stage: null }, scansRefused: null })
    importScan('bracket', '/d/other.stl')
    reimportScan('bracket', 'S1', 'plate.stl')
    expect(asked).toEqual(['import /d/Micra.glb'])
    expect(store.getState().scansRefused).toBe('Micra.glb is still being read: import plate.stl once it is in')
    ended[0].reject(new Error('Micra.glb holds no faces'))
    await settled()
    expect(store.getState()).toMatchObject({ importing: null, scansRefused: 'Micra.glb holds no faces' })
    importScan('bracket', '/d/other.stl')
    expect(asked).toEqual(['import /d/Micra.glb', 'import /d/other.stl'])
    expect(store.getState().scansRefused).toBeNull()
  })

  it('again, into the scan it is, says when the source is no longer the file that was aligned', async () => {
    const scan = (alignments: object) => ({ id: 'S1', alignments }) as ScanInfo
    reimportScan('bracket', 'S1', 'plate.stl')
    ended[0].resolve({ scan: scan({ print: {} }), sourceChanged: true, meshChanged: false } satisfies Reimported)
    await settled()
    expect(store.getState()).toMatchObject({ importing: null, scansRefused: 'S1: the source changed since it was aligned: check the alignment' })
    // A scan that was aligned nowhere, or whose source is the same, has nothing to look at again.
    for (const done of [{ scan: scan({}), sourceChanged: true, meshChanged: true }, { scan: scan({ print: {} }), sourceChanged: false, meshChanged: false }] satisfies Reimported[]) {
      reimportScan('bracket', 'S1', 'plate.stl')
      ended.at(-1)!.resolve(done)
      await settled()
      expect(store.getState().scansRefused).toBeNull()
    }
  })

  it('asks once how a scan just imported is read, when its unit or up axis was guessed and the object is still open', async () => {
    const imported = (id: string, unit: boolean, up: boolean) => ({ id, imported: { assumed: { unit, up } } }) as ScanInfo
    importScan('bracket', '/d/a.stl')
    ended[0].resolve(imported('S1', true, false))
    await settled()
    expect(store.getState().scanAsking).toBe('S1')
    actions.askScanRead(null)
    importScan('bracket', '/d/b.stl')
    ended[1].resolve(imported('S2', false, false))
    await settled()
    expect(store.getState().scanAsking).toBeNull()
    importScan('bracket', '/d/c.stl')
    actions.openObject('other', { layers: {} })
    ended[2].resolve(imported('S3', true, true))
    await settled()
    expect(store.getState().scanAsking).toBeNull()
  })
})
