import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSetsFile, sanitiseSetsFile, saveSetsFile } from './file'

const member = { face: 'block/F1', point: [1, 2, 3], normal: [0, 0, 1], state: 'ok' }
const raw = (extra: Record<string, unknown> = {}) => ({ id: 'N1', name: 'deck', comment: 'top', colour: 2, layout: 'assembly', by: 'person', members: [member], createdAt: '2026-11-17T10:00:00.000Z', ...extra })
const file = (...sets: unknown[]) => ({ next: 5, sets })

describe('sanitiseSetsFile', () => {
  it('keeps a whole set, and gives it the slug of its name', () => {
    const { file: got, problem } = sanitiseSetsFile(file(raw({ name: 'Deck face' })))
    expect(problem).toBeUndefined()
    expect(got.sets).toHaveLength(1)
    expect(got.sets[0]).toMatchObject({ id: 'N1', name: 'Deck face', slug: 'deck-face', colour: 2, layout: 'assembly', by: 'person', members: [{ face: 'block/F1', point: [1, 2, 3], state: 'ok' }] })
  })

  it('drops a set with a bad id, name or layout, and says so', () => {
    const got = sanitiseSetsFile(file(raw({ id: 'M3' }), raw({ id: 'N2', name: '9lives' }), raw({ id: 'N3', layout: '' }), raw({ id: 'N4', name: 'ok' })))
    expect(got.file.sets.map((s) => s.id)).toEqual(['N4'])
    expect(got.problem).toMatch(/3 named sets/)
  })

  it('drops a member that is malformed and keeps the set', () => {
    const got = sanitiseSetsFile(file(raw({ members: [member, { face: 'block/F2', point: [1, 'x', 3], state: 'ok' }, { face: 'nonsense', point: [0, 0, 0], state: 'ok' }, { stroke: 'M1' }, 7, { part: 'lid' }] })))
    expect(got.file.sets[0].members).toEqual([expect.objectContaining({ face: 'block/F1' }), { part: 'lid' }])
  })

  it('drops a form with an order terminal or text in it, and keeps the member', () => {
    const order = { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { order: 2, index: 1 } }
    const text = { of: 'faces', prefix: { by: 'type', type: 'PLANE) or True or (1' }, terminal: { only: true } }
    const radius = { of: 'edges', prefix: { by: 'radius', type: 'CIRCLE', radius: '4' }, terminal: { only: true } }
    const good = { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { end: 2, at: -1 } }
    const got = sanitiseSetsFile(
      file(raw({ members: [{ ...member, face: 'block/F1', selector: order }, { ...member, face: 'block/F2', selector: text }, { edge: 'block/E1', point: [0, 0, 0], state: 'ok', selector: radius }, { ...member, face: 'block/F3', selector: good }] }))
    )
    const members = got.file.sets[0].members
    expect(members).toHaveLength(4)
    expect(members.map((m) => ('selector' in m ? m.selector : undefined))).toEqual([undefined, undefined, undefined, good])
  })

  it('keeps the first of two sets of one name and says so', () => {
    const got = sanitiseSetsFile(file(raw({ id: 'N1', name: 'Deck' }), raw({ id: 'N2', name: 'deck' }), raw({ id: 'N3', name: 'deck-x' })))
    expect(got.file.sets.map((s) => s.id)).toEqual(['N1', 'N3'])
    expect(got.problem).toMatch(/N2/)
    expect(got.problem).toMatch(/N1/)
  })

  it('clamps the colour into 0 to 7', () => {
    const got = sanitiseSetsFile(file(raw({ id: 'N1', name: 'a', colour: 9 }), raw({ id: 'N2', name: 'b', colour: -3 }), raw({ id: 'N3', name: 'c', colour: 'x' })))
    expect(got.file.sets.map((s) => s.colour)).toEqual([7, 0, 0])
  })

  it('raises next above every N<n>, kept or not', () => {
    expect(sanitiseSetsFile({ next: 1, sets: [raw({ id: 'N4' })] }).file.next).toBe(5)
    expect(sanitiseSetsFile({ next: 1, sets: [raw({ id: 'N9', name: '#bad' })] }).file.next).toBe(10)
    expect(sanitiseSetsFile({ next: 20, sets: [] }).file.next).toBe(20)
    expect(sanitiseSetsFile({ sets: [] }).file.next).toBe(1)
  })

  it('makes a proposal only of the agent, and a person set by default', () => {
    const got = sanitiseSetsFile(file(raw({ id: 'N1', name: 'a', proposed: true }), raw({ id: 'N2', name: 'b', by: 'agent', proposed: true }), raw({ id: 'N3', name: 'c', by: 'robot' })))
    expect(got.file.sets.map((s) => [s.by, s.proposed])).toEqual([['person', undefined], ['agent', true], ['person', undefined]])
  })

  it('reads what is not a sets file as empty', () => {
    expect(sanitiseSetsFile('x').file).toEqual({ next: 1, sets: [] })
    expect(sanitiseSetsFile(null).file).toEqual({ next: 1, sets: [] })
    expect(sanitiseSetsFile({ sets: 'x' }).file).toEqual({ next: 1, sets: [] })
  })
})

describe('the sets file on disk', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'torno-sets-file-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads a missing file as empty and writes nothing', async () => {
    const got = await loadSetsFile(dir)
    expect(got).toEqual({ file: { next: 1, sets: [] } })
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('writes atomically and reads it back', async () => {
    const { file: made } = sanitiseSetsFile(file(raw()))
    await saveSetsFile(dir, made)
    expect(readdirSync(join(dir, '.torno'))).toEqual(['sets.json'])
    expect((await loadSetsFile(dir)).file).toEqual(made)
  })

  it('sets a file that is not JSON aside, starts a new list and says so', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'sets.json'), '{"next": 4, "sets": [{"id": "N7", ')
    const got = await loadSetsFile(dir, () => new Date('2026-11-17T12:00:00.000Z'))
    expect(got.file).toEqual({ next: 8, sets: [] })
    expect(got.problem).toMatch(/sets\.json\.corrupt-/)
    expect(readdirSync(join(dir, '.torno')).sort()).toEqual(['sets.json', 'sets.json.corrupt-2026-11-17T12-00-00-000Z'])
    expect(JSON.parse(readFileSync(join(dir, '.torno', 'sets.json'), 'utf8'))).toEqual({ next: 8, sets: [] })
  })

  it('copies a file with sets it had to drop aside, keeps the rest and says so', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'sets.json'), JSON.stringify(file(raw(), raw({ id: 'N2', name: '#bad' }))))
    const got = await loadSetsFile(dir, () => new Date('2026-11-17T12:00:00.000Z'))
    expect(got.file.sets.map((s) => s.id)).toEqual(['N1'])
    expect(got.problem).toMatch(/sets\.json\.dropped-/)
    expect(readdirSync(join(dir, '.torno')).sort()).toEqual(['sets.json', 'sets.json.dropped-2026-11-17T12-00-00-000Z'])
  })
})
