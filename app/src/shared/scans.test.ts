import { describe, expect, it } from 'vitest'
import { box, meshBin } from '../test/scanFixtures'
import { type ScanAlignment, type ScanImport, alignmentOf, alignmentText, basisOf, basisText, importText, standingOf, maskBits, maskFile, parseScanMesh, sizeAs, staleText } from './scans'

describe('parseScanMesh', () => {
  it('gives views of the vertices, the colours and the triangles of a mesh.bin', () => {
    const colours = Array.from({ length: 8 }, (_, n) => [n, 2 * n, 3 * n, 255]).flat()
    const mesh = parseScanMesh(meshBin(box([40, 30, 5]), colours))
    expect(mesh.vertices).toHaveLength(24)
    expect([...mesh.vertices.slice(0, 3)]).toEqual([-20, -15, -2.5])
    expect([...mesh.colours!.slice(4, 8)]).toEqual([1, 2, 3, 255])
    expect([...mesh.triangles.slice(0, 3)]).toEqual([0, 1, 3])
    expect(mesh.bbox).toEqual({ min: [-20, -15, -2.5], max: [20, 15, 2.5] })
    expect(parseScanMesh(meshBin(box())).colours).toBeNull()
  })

  it('says what is wrong with bytes that are no mesh.bin', () => {
    const good = meshBin(box())
    expect(() => parseScanMesh(good.slice(0, 40))).toThrow(/not a scan torno wrote/)
    expect(() => parseScanMesh(good.slice(0, good.byteLength - 4))).toThrow(/has 300 bytes, and its header says 304/)
    const other = good.slice(0)
    new DataView(other).setUint32(8, 2, true)
    expect(() => parseScanMesh(other)).toThrow(/version 2/)
    const wild = good.slice(0)
    new Uint32Array(wild, 64 + 96, 1)[0] = 8
    expect(() => parseScanMesh(wild)).toThrow(/a triangle names vertex 8, and there are 8/)
    // Final fix wave: the box in the header is what the scan is framed, clipped and reached by. One that is no box is not believed.
    for (const [at, value] of [[24, Number.NaN], [36, Number.POSITIVE_INFINITY], [24, 1e30]] as const) {
      const boxed = good.slice(0)
      new DataView(boxed).setFloat32(at, value, true)
      expect(() => parseScanMesh(boxed)).toThrow(/its header gives no box/)
    }
  })
})

describe('a mask', () => {
  it('is one bit a triangle behind a header that says how many', () => {
    const bits = new Uint8Array([0b00000001, 0b00000010])
    const file = maskFile(bits, 12)
    expect(new TextDecoder().decode(file.slice(0, 8))).toBe('TORNOMSK')
    expect(new DataView(file.buffer).getUint32(12, true)).toBe(12)
    expect([...maskBits(file, 12)]).toEqual([1, 2])
    expect(() => maskBits(file, 13)).toThrow(/12 triangles, not 13/)
    expect(() => maskFile(new Uint8Array(3), 12)).toThrow(/2 bytes/)
  })
})

describe('what is said of a scan', () => {
  const imported: ScanImport = { unit: 'm', up: 'y', assumed: { unit: true, up: true }, vertices: 8, triangles: 12, colours: 'none', bbox: { min: [-1258.9, -1175.3, 0], max: [1258.9, 1175.3, 1493.6] }, area: 1, at: '' }
  const aligned: ScanAlignment = { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['floor'], rms: 0.8, frame: {}, at: '' }

  it('gives its size in millimetres and what was assumed', () => {
    expect(importText(imported)).toBe('2518 × 2351 × 1494 mm, from m, Y up (assumed)')
    expect(importText({ ...imported, assumed: { unit: false, up: true } })).toBe('2518 × 2351 × 1494 mm, from m, Y up (up assumed)')
    expect(importText({ ...imported, assumed: { unit: false, up: false }, reduced: { from: 5_000_000, cell: 2.4 } })).toBe('2518 × 2351 × 1494 mm, from m, Y up, reduced from 5,000,000 triangles')
  })

  it('says how it was aligned, and when a floor is all there is', () => {
    expect(alignmentText(aligned)).toBe('by floor only (plane RMS 0.8 mm): its place in that plane is as imported')
    const pairs = [1.8, 3.4, 0.9, 1.2].map((residual) => ({ scan: [0, 0, 0] as [number, number, number], model: [0, 0, 0] as [number, number, number], residual }))
    expect(alignmentText({ ...aligned, steps: ['floor', 'pairs'], pairs, rms: 2.1 })).toBe('by floor + 4 pairs (RMS 2.1 mm, worst 3.4 mm)')
    // Changed in fix round 2 (C): how well it fitted and where its pairs are now are two numbers, each named.
    expect(alignmentText({ ...aligned, steps: ['pairs', 'nudge'], pairs, rms: 2.1, fitRms: 0.4, scaled: true })).toBe('by 4 pairs (fit RMS 0.4 mm), scaled, then moved by hand: the pairs are now 2.1 mm apart')
    expect(alignmentText({ ...aligned, steps: ['typed'], rms: undefined })).toBe('by hand (typed values)')
  })

  // Task 5: what a fit leaves is said to the thousandth of a millimetre, never with the digits of rounding error.
  it('says how well it fits no finer than a fit is known', () => {
    const pairs = [0.000005728, 0.0000024].map((residual) => ({ scan: [0, 0, 0] as [number, number, number], model: [0, 0, 0] as [number, number, number], residual }))
    expect(alignmentText({ ...aligned, steps: ['pairs'], pairs, rms: 0.000004247 })).toBe('by 2 pairs (RMS 0 mm, worst 0 mm)')
    expect(alignmentText({ ...aligned, steps: ['pairs'], pairs: [{ ...pairs[0], residual: 0.0126 }], rms: 0.0126 })).toBe('by 1 pair (RMS 0.013 mm, worst 0.013 mm)')
  })

  it('says a scan read again from a changed source with what the last build found, as one reason to look', () => {
    expect(staleText(undefined, { sourceChanged: true })).toBe('the scan was imported again from a source that had changed since it was aligned: check the alignment')
    expect(staleText({ revision: 4, of: 0, off: 0, worst: 0, moved: ['lid'] }, { sourceChanged: true })).toBe('the scan was imported again from a source that had changed since it was aligned, and torno has moved lid for display since it was aligned: check the alignment')
    expect(staleText(undefined, {})).toBeNull()
    const scan = { alignments: { print: { ...aligned, sourceChanged: true as const } }, checks: {} }
    expect(standingOf(scan, 'print').stale).toBe('the scan was imported again from a source that had changed since it was aligned: check the alignment')
    expect(standingOf(scan, 'assembly').stale).toBeNull()
  })

  it('says when the model has moved under an alignment', () => {
    expect(staleText(undefined)).toBeNull()
    expect(staleText({ revision: 4, of: 4, off: 0, worst: 0.1, moved: [] })).toBeNull()
    expect(staleText({ revision: 4, of: 4, off: 2, worst: 6.2, moved: [] })).toBe('the model is no longer under 2 of its 4 points (worst 6.2 mm off) on r4: check the alignment')
    expect(staleText({ revision: 4, of: 0, off: 0, worst: 0, moved: ['lid'] })).toBe('torno has moved lid for display since it was aligned: check the alignment')
  })
})

// Beyond the brief's tests.
describe('and besides', () => {
  const aligned: ScanAlignment = { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['floor', 'nudge'], frame: {}, at: '' }

  it('a scan is aligned only in the layouts it has a transform for, whatever they are named', () => {
    expect(alignmentOf({ alignments: { print: aligned } }, 'print')).toBe(aligned)
    expect(alignmentOf({ alignments: { print: aligned } }, 'assembly')).toBeNull()
    expect(alignmentOf({ alignments: {} }, 'toString')).toBeNull()
  })

  it('says both ways an alignment went stale, and every step of one', () => {
    expect(staleText({ revision: 7, of: 3, off: 1, worst: 12.345, moved: ['lid', 'tray'] })).toBe(
      'torno has moved lid, tray for display since it was aligned, and the model is no longer under 1 of its 3 points (worst 12.35 mm off) on r7: check the alignment'
    )
    expect(alignmentText(aligned)).toBe('by floor only, then moved by hand: its place in that plane is as it was put by hand')
    expect(alignmentText({ ...aligned, steps: ['floor'] })).toBe('by floor only: its place in that plane is as imported')
  })

  it('reads no region from bytes that are none', () => {
    expect(() => maskBits(new Uint8Array(18), 12)).toThrow(/18 bytes is not a region torno wrote/)
    const cut = maskFile(new Uint8Array(2), 12).slice(0, 17)
    expect(() => maskBits(cut, 12)).toThrow(/has 17 bytes, and its header says 18/)
    // A view into a larger buffer is read where it is.
    const within = new Uint8Array(40)
    within.set(maskFile(new Uint8Array([3, 4]), 12), 8)
    expect([...maskBits(within.subarray(8, 26), 12)]).toEqual([3, 4])
  })
})

// Fix round 1: how an alignment was made is said in plain words (R-basis), and one notion of doubt (R-check).
describe('how an alignment was made', () => {
  const T = { t: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], s: 1 }
  const pair = (residual: number) => ({ scan: [0, 0, 0] as [number, number, number], model: [0, 0, 0] as [number, number, number], residual })
  const made = (steps: ScanAlignment['steps'], more: Partial<ScanAlignment> = {}): ScanAlignment => ({ transform: T, steps, frame: {}, at: '', ...more })
  const four = [0.8, 0.5, 0.9, 0.7].map(pair)

  it('is by pairs, by a floor or by hand, and says when it was moved by hand afterwards', () => {
    expect(basisOf(made(['pairs'], { pairs: four }))).toEqual({ basis: 'pairs', movedByHand: false })
    expect(basisOf(made(['floor', 'pairs'], { pairs: four }))).toEqual({ basis: 'pairs', movedByHand: false })
    expect(basisOf(made(['pairs', 'typed'], { pairs: four }))).toEqual({ basis: 'pairs', movedByHand: true })
    // Moved by hand, then fitted anew with too few pairs: the fit is what it rests on now.
    expect(basisOf(made(['floor', 'nudge', 'pairs'], { pairs: four.slice(0, 2) }))).toEqual({ basis: 'pairs', movedByHand: false })
    expect(basisOf(made(['floor']))).toEqual({ basis: 'floor', movedByHand: false })
    expect(basisOf(made(['floor', 'nudge']))).toEqual({ basis: 'floor', movedByHand: true })
    expect(basisOf(made(['nudge', 'typed']))).toEqual({ basis: 'hand', movedByHand: false })
    // A step of pairs with no pairs kept is no fit to rest on.
    expect(basisOf(made(['pairs', 'nudge']))).toEqual({ basis: 'hand', movedByHand: false })
  })

  it('is said short, for a row and a caption', () => {
    expect(basisText(made(['floor'], { rms: 0.4 }))).toBe('floor only')
    expect(basisText(made(['typed']))).toBe('by hand')
    expect(basisText(made(['pairs'], { pairs: four, rms: 0.8 }))).toBe('4 pairs, RMS 0.8 mm')
    expect(basisText(made(['pairs', 'nudge'], { pairs: four, rms: 20, fitRms: 0.8, scaled: true }))).toBe('4 pairs (fit RMS 0.8 mm), scaled, then moved by hand: the pairs are now 20 mm apart')
    // With no fit on record (a file from before): only where they are now, said as that.
    expect(basisText(made(['pairs', 'nudge'], { pairs: four, rms: 20 }))).toBe('4 pairs, then moved by hand: the pairs are now 20 mm apart')
    expect(basisText(made(['floor', 'typed']))).toBe('floor only, then moved by hand')
    expect(basisText(made(['pairs'], { pairs: [pair(0)], rms: 0 }))).toBe('1 pair, RMS 0 mm')
  })

  it('is said at length, with what a floor leaves open said once', () => {
    expect(alignmentText(made(['nudge']))).toBe('by hand (nudge)')
    expect(alignmentText(made(['nudge', 'typed']))).toBe('by hand (nudge + typed values)')
    expect(alignmentText(made(['floor', 'pairs', 'typed'], { pairs: four, rms: 20, fitRms: 0.8 }))).toBe('by floor + 4 pairs (fit RMS 0.8 mm), then moved by hand: the pairs are now 20 mm apart')
  })
})

describe('how an alignment stands against a build', () => {
  const T = { t: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], s: 1 }
  const tied = { scan: [0, 0, 0] as [number, number, number], model: [0, 0, 0] as [number, number, number], part: 'tub', residual: 0 }
  const fitted: ScanAlignment = { transform: T, steps: ['pairs'], pairs: [tied, tied, tied], rms: 0, frame: {}, at: '' }
  const ok = { revision: 12, of: 3, off: 0, worst: 0.1, moved: [] }

  it('holds only when it was checked against the last build: without that it says so, as an unchecked mark does', () => {
    expect(standingOf({ alignments: { print: fitted }, checks: { print: ok } }, 'print', 12)).toEqual({ aligned: true, basis: '3 pairs, RMS 0 mm', rough: null, stale: null, unchecked: false, waiting: false, failed: false, note: null })
    // The check there is, is of the build before: nothing is known of this one.
    expect(standingOf({ alignments: { print: fitted }, checks: { print: ok } }, 'print', 13).stale).toBe('it was not checked against r13')
    expect(standingOf({ alignments: { print: fitted }, checks: {} }, 'print', 13).stale).toBe('it was not checked against r13')
    expect(standingOf({ alignments: { print: fitted }, checks: {} }, 'print', 13)).toMatchObject({ stale: 'it was not checked against r13', unchecked: true, waiting: true, failed: false })
    // Fix round 2 (D, m1): once a check has failed it says why, and of which build; and whether not being checked is all there is to say is a field, not the shape of a sentence.
    const failed = { alignments: { print: fitted }, checks: {}, unchecked: { print: { revision: 13, reason: 'the kernel exited' } } }
    expect(standingOf(failed, 'print', 13)).toMatchObject({ stale: 'it could not be checked against r13: the kernel exited', unchecked: true, waiting: true, failed: true })
    // Why a check of another build failed says nothing of this one.
    expect(standingOf(failed, 'print', 14)).toMatchObject({ stale: 'it was not checked against r14', failed: false })
    expect(standingOf({ alignments: { print: { ...fitted, sourceChanged: true } }, checks: {} }, 'print', 13)).toMatchObject({ unchecked: true, waiting: false })
    // With another reason beside it.
    expect(standingOf({ alignments: { print: { ...fitted, sourceChanged: true } }, checks: {} }, 'print', 13).stale).toBe('the scan was imported again from a source that had changed since it was aligned, and it was not checked against r13: check the alignment')
    // Before any build, and for whoever knows of none, nothing is said of a check.
    expect(standingOf({ alignments: { print: fitted }, checks: {} }, 'print').stale).toBeNull()
    expect(standingOf({ alignments: { print: fitted }, checks: {} }, 'print', 0).stale).toBeNull()
    expect(standingOf({ alignments: {}, checks: {} }, 'print', 12)).toEqual({ aligned: false, basis: null, rough: null, stale: null, unchecked: false, waiting: false, failed: false, note: null })
  })

  it('says of one tied to no point of the model that no build can say whether it holds: a note, not a doubt', () => {
    const loose: ScanAlignment = { transform: T, steps: ['typed'], frame: {}, at: '' }
    const said = standingOf({ alignments: { print: loose }, checks: { print: { revision: 12, of: 0, off: 0, worst: 0, moved: [] } } }, 'print', 12)
    expect(said).toMatchObject({ basis: 'by hand', stale: null, note: 'tied to no point of the model: not checked against builds' })
    // A floor on a face of a part is tied to it; typed ends are tied to nothing.
    expect(standingOf({ alignments: { print: { ...loose, steps: ['floor'], floor: { part: 'tub', point: [0, 0, 0] } } }, checks: { print: { ...ok, of: 1 } } }, 'print', 12).note).toBeNull()
    expect(standingOf({ alignments: { print: { ...fitted, pairs: fitted.pairs!.map(({ part: _none, ...rest }) => rest) } }, checks: { print: { ...ok, of: 0 } } }, 'print', 12).note).toBe('tied to no point of the model: not checked against builds')
  })

  it('says that the person confirmed it, until something puts it in doubt again', () => {
    const confirmed: ScanAlignment = { ...fitted, confirmed: { revision: 12, at: '2026-10-09T10:00:00.000Z', held: [[0, 0, 0], [0, 0, 6.2], null] } }
    expect(standingOf({ alignments: { print: confirmed }, checks: { print: ok } }, 'print', 12).note).toBe('confirmed by the user on r12')
    // From an earlier run: which build that was is not known any more.
    expect(standingOf({ alignments: { print: { ...confirmed, confirmed: { at: '2026-10-09T10:00:00.000Z', held: [] } } }, checks: { print: ok } }, 'print', 12).note).toBe('confirmed by the user')
    const doubted = standingOf({ alignments: { print: confirmed }, checks: { print: { ...ok, off: 1, worst: 9 } } }, 'print', 12)
    expect(doubted.stale).toBe('the model is no longer under 1 of its 3 points (worst 9 mm off) on r12: check the alignment')
    expect(doubted.note).toBeNull()
  })
})

describe('sizeAs', () => {
  const imported = { unit: 'mm', up: 'z', assumed: { unit: true, up: true }, bbox: { min: [0, 0, 0], max: [650, 1226, 357.7] } } as unknown as ScanImport
  const close = (got: number[], want: number[]) => got.forEach((c, n) => expect(c).toBeCloseTo(want[n], 6))
  it('is the size as read when nothing changes', () => close(sizeAs(imported, { unit: 'mm', up: 'z' }), [650, 1226, 357.7]))
  it('scales by the ratio of the units', () => close(sizeAs(imported, { unit: 'cm', up: 'z' }), [6500, 12260, 3577]))
  it('swaps Y and Z when the up axis changes', () => close(sizeAs(imported, { unit: 'mm', up: 'y' }), [650, 357.7, 1226]))
})
