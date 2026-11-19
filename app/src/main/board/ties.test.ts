import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DimensionMark, NewMark } from '../../shared/marks'
import { MarkStore } from '../marks/store'
import { BoardStore } from './store'
import { Ties } from './ties'

let root: string
let board: BoardStore
let marks: MarkStore
let ties: Ties

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const TOP = { point: [5, 3, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5' }
const BOTTOM = { point: [5, 3, -3], normal: [0, 0, -1], part: 'plate', ref: 'plate/F0' }
const dimension = (more: object = {}): NewMark => ({ author: 'user', note: '', layout: 'assembly', revision: 1, camera: CAMERA, kind: 'dimension', measure: 'distance', a: TOP, b: BOTTOM, ...more }) as NewMark
const MEASURED = { value: 96.1, how: 'between planes', points: [[0, 0, 0], [96.1, 0, 0]] as [[number, number, number], [number, number, number]], measuredRevision: 2 }

const addSize = (size: object = { what: 'tray length', value: '96.5', unit: 'mm', source: 'measured' }): Promise<string> =>
  board.person('bracket', { op: 'add', card: { kind: 'size', x: 0, y: 0, w: 240, h: 120, size } as never }).then((b) => b.cards.at(-1)!.id)
const mark = async (id = 'M1'): Promise<DimensionMark> => (await marks.list('bracket')).find((m) => m.id === id) as DimensionMark
const sizeOf = async (id: string) => (await board.read('bracket')).cards.find((c) => c.id === id)?.size

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'torno-ties-'))
  mkdirSync(join(root, 'bracket'))
  board = new BoardStore({ dirOf: () => join(root, 'bracket') })
  marks = new MarkStore({ dirOf: () => join(root, 'bracket') })
  ties = new Ties({ board, marks })
  await marks.add('bracket', dimension(), 'draft', MEASURED)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('tying a size to a dimension', () => {
  it("sets the dimension's expected value from the size and its tolerance from the size's source, and says whose it is", async () => {
    const id = await addSize()
    await ties.tie('bracket', id, 'M1', 'person')
    expect(await mark()).toMatchObject({ expected: 96.5, tolerance: 0.5, expectedFrom: id, verdict: 'pass' })
    expect(await sizeOf(id)).toMatchObject({ tie: { mark: 'M1', tolerance: 0.5 } })
    for (const [source, tolerance] of [['from a manual or datasheet', 0.2], ['a guess', 2]] as const) {
      const other = await addSize({ what: 'other', value: '10', unit: 'mm', source })
      await marks.add('bracket', dimension(), 'draft', MEASURED)
      await ties.tie('bracket', other, `M${source === 'a guess' ? 3 : 2}`, 'person')
      expect((await sizeOf(other))?.tie?.tolerance).toBe(tolerance)
    }
  })

  it('takes a tolerance chosen while tying, and a new one later', async () => {
    const id = await addSize()
    await ties.tie('bracket', id, 'M1', 'person', 0.3)
    expect(await mark()).toMatchObject({ tolerance: 0.3, verdict: 'fail' })
    await ties.tie('bracket', id, 'M1', 'person', 1)
    expect(await mark()).toMatchObject({ tolerance: 1, verdict: 'pass', expectedFrom: id })
  })

  it('follows the size when it is changed, keeping the tie', async () => {
    const id = await addSize()
    await ties.tie('bracket', id, 'M1', 'person')
    await board.person('bracket', { op: 'edit', id, size: { what: 'tray length', value: '100', unit: 'mm', source: 'measured' } })
    await ties.reconcile('bracket')
    expect(await sizeOf(id)).toMatchObject({ value: '100', tie: { mark: 'M1', tolerance: 0.5 } })
    expect(await mark()).toMatchObject({ expected: 100, verdict: 'fail' })
  })

  it('lets a size go when it is removed, and takes it up again when the removal is undone', async () => {
    const id = await addSize()
    await ties.tie('bracket', id, 'M1', 'person')
    await board.person('bracket', { op: 'remove', ids: [id] })
    await ties.reconcile('bracket')
    const free = await mark()
    for (const key of ['expected', 'tolerance', 'expectedFrom', 'verdict']) expect(free).not.toHaveProperty(key)
    await board.person('bracket', { op: 'restore', ids: [id] })
    await ties.reconcile('bracket')
    expect(await mark()).toMatchObject({ expected: 96.5, tolerance: 0.5, expectedFrom: id })
  })

  it('is untied by the person, and the dimension keeps no expectation', async () => {
    const id = await addSize()
    await ties.tie('bracket', id, 'M1', 'person')
    await ties.untie('bracket', id)
    expect(await sizeOf(id)).not.toHaveProperty('tie')
    expect(await mark()).not.toHaveProperty('expected')
    await expect(ties.untie('bracket', id)).rejects.toThrow('is not tied')
  })

  it('moves from one dimension to another, freeing the first', async () => {
    const id = await addSize()
    await marks.add('bracket', dimension(), 'draft', MEASURED)
    await ties.tie('bracket', id, 'M1', 'person')
    await ties.tie('bracket', id, 'M2', 'person')
    expect(await mark('M1')).not.toHaveProperty('expectedFrom')
    expect(await mark('M2')).toMatchObject({ expectedFrom: id, expected: 96.5 })
  })

  it('is refused with the reason: no number, two numbers, another unit, a resolved or missing dimension, a dimension already checking another size', async () => {
    const words = await addSize({ what: 'a', value: 'about 60', unit: 'mm', source: 'a guess' })
    const two = await addSize({ what: 'b', value: '186 × 128', unit: 'mm', source: 'measured' })
    const angle = await addSize({ what: 'c', value: '45', unit: '°', source: 'measured' })
    await expect(ties.tie('bracket', words, 'M1', 'person')).rejects.toThrow('not a number')
    await expect(ties.tie('bracket', two, 'M1', 'person')).rejects.toThrow('2 numbers')
    await expect(ties.tie('bracket', angle, 'M1', 'person')).rejects.toThrow('measures in mm and this size is in °')
    const fine = await addSize()
    await expect(ties.tie('bracket', fine, 'M9', 'person')).rejects.toThrow('not a dimension')
    await expect(ties.tie('bracket', 'C99', 'M1', 'person')).rejects.toThrow('There is no card')
    await marks.update('bracket', 'M1', { status: 'resolved' })
    await expect(ties.tie('bracket', fine, 'M1', 'person')).rejects.toThrow('resolved')
    await marks.update('bracket', 'M1', { status: 'draft' })
    await ties.tie('bracket', fine, 'M1', 'person')
    const next = await addSize({ what: 'd', value: '5', unit: 'mm', source: 'measured' })
    await expect(ties.tie('bracket', next, 'M1', 'person')).rejects.toThrow(`M1 already checks ${fine}`)
    const text = (await board.person('bracket', { op: 'add', card: { kind: 'text', x: 0, y: 0, w: 1, h: 1, text: 'x' } })).cards.at(-1)!.id
    await expect(ties.tie('bracket', text, 'M1', 'person')).rejects.toThrow('is not a size')
  })

  it('is refused for a round size and a dimension of another kind', async () => {
    await marks.add('bracket', dimension({ measure: 'diameter', b: undefined, a: TOP }), 'draft', { ...MEASURED, value: 6.6 })
    const bore = await addSize({ what: 'bore', value: 'Ø6.6', unit: 'mm', source: 'from a manual or datasheet' })
    await expect(ties.tie('bracket', bore, 'M1', 'person')).rejects.toThrow('is a diameter and M1 is a distance')
    await ties.tie('bracket', bore, 'M2', 'person')
    expect(await mark('M2')).toMatchObject({ expected: 6.6, tolerance: 0.2, verdict: 'pass' })
  })

  it('unties a size edited so that no dimension can hold to it any more', async () => {
    const id = await addSize()
    await ties.tie('bracket', id, 'M1', 'person')
    await board.person('bracket', { op: 'edit', id, size: { what: 'tray', value: '96 × 40', unit: 'mm', source: 'measured' } })
    await ties.reconcile('bracket')
    expect(await sizeOf(id)).not.toHaveProperty('tie')
    expect(await mark()).not.toHaveProperty('expected')
  })

  it("lets the agent tie only its own dimensions, and not untie the person's", async () => {
    const id = await addSize()
    await expect(ties.tie('bracket', id, 'M1', 'agent')).rejects.toThrow("the person's dimension")
    await marks.add('bracket', dimension({ author: 'agent' }), 'draft', MEASURED)
    await ties.tie('bracket', id, 'M2', 'agent')
    expect(await mark('M2')).toMatchObject({ expectedFrom: id, expected: 96.5 })
    await ties.tie('bracket', id, 'M1', 'person')
    await expect(ties.untie('bracket', id, 'agent')).rejects.toThrow('theirs to untie')
  })

  it('never takes a tie from the window: a size the person sends carries none', async () => {
    const forged = await board.person('bracket', { op: 'add', card: { kind: 'size', x: 0, y: 0, w: 1, h: 1, size: { what: 'x', value: '5', unit: 'mm', source: 'measured', tie: { mark: 'M1', tolerance: 1 } } } as never })
    expect(forged.cards.at(-1)!.size).not.toHaveProperty('tie')
  })

  it('refuses a change of the expected value or the tolerance of a tied dimension, from anyone but the tie', async () => {
    const id = await addSize()
    await ties.tie('bracket', id, 'M1', 'person')
    await expect(marks.update('bracket', 'M1', { expected: 90 })).rejects.toThrow(`takes its expected value and tolerance from ${id}`)
    await expect(marks.update('bracket', 'M1', { tolerance: 3 }, 'agent')).rejects.toThrow('of the brief')
    expect(await marks.update('bracket', 'M1', { note: 'the tray' })).toMatchObject({ expectedFrom: id, expected: 96.5 })
  })

  it('leaves a tie to a dimension that is not there alone, to be read as gone', async () => {
    const id = await addSize()
    await ties.tie('bracket', id, 'M1', 'person')
    await marks.remove('bracket', 'M1')
    await ties.reconcile('bracket')
    expect(await sizeOf(id)).toMatchObject({ tie: { mark: 'M1' } })
  })
})
