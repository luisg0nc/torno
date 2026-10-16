import { describe, expect, it } from 'vitest'
import type { ScanAlignment, ScanInfo } from '../../shared/scans'
import { guessOf, scanState } from './scanState'

// As main/statefile.test.ts builds a scan main tells.
const scan = (alignments: Record<string, ScanAlignment> = {}, more: Partial<ScanInfo> = {}): ScanInfo =>
  ({ id: 'S1', name: 'S1.glb', source: { path: '/dl/S1.glb', bytes: 1, mtimeMs: 1, sha256: '' }, imported: { unit: 'm', up: 'y', assumed: { unit: true, up: true }, vertices: 8, triangles: 12, colours: 'none', bbox: { min: [0, 0, 0], max: [1, 1, 1] }, area: 1, at: '' }, alignments, sourceState: 'present', meshState: 'ok', checks: {}, ...more }) as ScanInfo
const pairs = [1.8, 3.4, 0.9, 1.2].map((residual) => ({ scan: [0, 0, 0] as [number, number, number], model: [0, 0, 0] as [number, number, number], part: 'lid', residual }))
const fit: ScanAlignment = { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['pairs'], pairs, rms: 2.1, frame: {}, at: '' }
const hand: ScanAlignment = { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['nudge'], frame: {}, at: '' }
const checked = { print: { revision: 3, of: 100, off: 0, worst: 0, moved: [] } }
const fitted = scan({ print: fit }, { checks: checked })
const byHand = scan({ print: hand }, { checks: checked })

describe('scanState', () => {
  it('says missing for a scan whose mesh is gone', () => {
    expect(scanState(scan({ print: fit }, { meshState: 'missing' }), 'print', 3)).toMatchObject({ state: 'mesh-missing', word: 'missing', tip: 'Its mesh is gone from the disk: it cannot be drawn or checked' })
  })
  it('says unaligned in a layout it has no alignment in', () => {
    expect(scanState(fitted, 'assembly', 3)).toMatchObject({ state: 'unaligned', word: 'unaligned', tip: 'Not aligned in assembly: nothing is checked against it here' })
  })
  it('says pending before anything is built', () => {
    const s = scanState(fitted, 'print', 0)
    expect(s).toMatchObject({ state: 'unchecked', word: 'pending' })
    expect(s.tip).toBe('Aligned by 4 pairs, RMS 2.1 mm; not checked against a build yet')
  })
  it('says pending while a check is on its way, with why one failed', () => {
    expect(scanState(scan({ print: fit }), 'print', 3)).toMatchObject({ word: 'pending', said: null })
    const failed = scanState(scan({ print: fit }, { unchecked: { print: { revision: 3, reason: 'the kernel is busy' } } }), 'print', 3)
    expect(failed.word).toBe('pending')
    expect(failed.tip).toMatch(/^Aligned by 4 pairs, RMS 2\.1 mm; not checked against a build yet\. .*the kernel is busy.*It is tried again every 30 s$/)
  })
  it('says check when the alignment may no longer hold, with the reason as its sentence', () => {
    const s = scanState(scan({ print: fit }, { checks: { print: { ...checked.print, moved: ['lid'] } } }), 'print', 3)
    expect(s).toMatchObject({ state: 'stale', word: 'check', confirm: true, tip: 'torno has moved lid for display since it was aligned: check the alignment' })
  })
  it('says rough for a doubtful fit', () => {
    const s = scanState(scan({ print: { ...fit, rough: 'its pairs are 9 mm apart' } }, { checks: checked }), 'print', 3)
    expect(s).toMatchObject({ state: 'rough', word: 'rough', tip: 'Rough: its pairs are 9 mm apart' })
  })
  it('says placed for a scan tied to no point of the model, and does not say so twice', () => {
    const s = scanState(byHand, 'print', 3)
    expect(s).toMatchObject({ state: 'placed', word: 'placed', note: null })
    expect(s.tip).toBe('Placed by hand: tied to no point of the model, so not checked against builds')
  })
  it('says aligned and the build it was checked on', () => {
    expect(scanState(fitted, 'print', 3)).toMatchObject({ state: 'aligned', word: 'aligned', tip: 'Aligned by 4 pairs, RMS 2.1 mm; checked against r3' })
  })
  it('says aligned and who confirmed it', () => {
    const confirmed = scan({ print: { ...fit, confirmed: { revision: 2, at: '', held: [] } } }, { checks: checked })
    expect(scanState(confirmed, 'print', 3).tip).toBe('Aligned by 4 pairs, RMS 2.1 mm; confirmed by the user on r2')
  })
})

describe('guessOf', () => {
  it('says how a scan was read where that was a guess', () => {
    expect(guessOf(scan())).toBe('Read as metres, Y up')
    expect(guessOf({ imported: { ...scan().imported, assumed: { unit: false, up: true } } })).toBe('Read as Y up')
    expect(guessOf({ imported: { ...scan().imported, assumed: { unit: false, up: false } } })).toBeNull()
  })
})
