import { describe, expect, it } from 'vitest'
import type { Param, Scene } from '../../shared/scene'
import { pickerRows, stepPick } from './pickerRows'

const part = (name: string, extra: object = {}) => ({ key: name, name, layout: 'assembly', ...extra })
const param = (name: string, doc: string | null = null): Param => ({ name, type: 'float', default: 3, literal: true, doc }) as unknown as Param
const scene = (parts: string[], groups: Scene['groups'], params: Param[] = []) => ({ parts: parts.map((n) => part(n)), groups, params }) as unknown as Scene

describe('pickerRows', () => {
  it('lists parts by group, then those in none, then the values', () => {
    const s = scene(['plate', 'side-left', 'side-right'], [{ name: 'sides', parts: ['side-left', 'side-right'] }], [param('leg_gap')])
    const { rows, found, total } = pickerRows(s, 'assembly', {}, '')
    expect(rows.map((r) => [r.kind, r.name, r.head])).toEqual([
      ['part', 'side-left', 'sides'],
      ['part', 'side-right', undefined],
      ['part', 'plate', 'Parts'],
      ['param', 'leg_gap', 'Values']
    ])
    expect([found, total]).toEqual([4, 4])
  })

  it('names no section of parts when the model has no groups', () => {
    const { rows } = pickerRows(scene(['a', 'b'], undefined, [param('x')]), 'assembly', {}, '')
    expect(rows.map((r) => r.head)).toEqual([undefined, undefined, 'Values'])
  })

  it('finds by every word, in a part by its name or its group and in a value by its name or its comment', () => {
    const s = scene(['runner-1', 'runner-2', 'hood'], [{ name: 'runners', parts: ['runner-1', 'runner-2'] }], [param('runner_wall', 'wall of the runner, mm'), param('leg_gap')])
    expect(pickerRows(s, 'assembly', {}, 'runner').rows.map((r) => r.name)).toEqual(['runner-1', 'runner-2', 'runner_wall'])
    expect(pickerRows(s, 'assembly', {}, 'runner 2').rows.map((r) => r.name)).toEqual(['runner-2'])
    expect(pickerRows(s, 'assembly', {}, 'wall mm').rows.map((r) => r.name)).toEqual(['runner_wall'])
    expect(pickerRows(s, 'assembly', {}, 'nothing').rows).toEqual([])
  })

  it('says a part is hidden or bought, and keeps to the layout', () => {
    const s = { parts: [part('a'), part('b', { role: 'reference' }), part('c', { layout: 'other' })], params: [] } as unknown as Scene
    const { rows } = pickerRows(s, 'assembly', { a: { visible: false } }, '')
    expect(rows).toMatchObject([{ name: 'a', hidden: true, bought: false }, { name: 'b', hidden: false, bought: true }])
  })

  it('draws at most the limit and counts what matched', () => {
    const s = scene(Array.from({ length: 100 }, (_, i) => `p${i}`), undefined)
    const { rows, found } = pickerRows(s, 'assembly', {}, 'p', 10)
    expect([rows.length, found]).toEqual([10, 100])
  })
})

describe('stepPick', () => {
  it('goes round, and starts at an end when nothing is chosen', () => {
    expect(stepPick(-1, 3, 1)).toBe(0)
    expect(stepPick(-1, 3, -1)).toBe(2)
    expect(stepPick(2, 3, 1)).toBe(0)
    expect(stepPick(0, 3, -1)).toBe(2)
    expect(stepPick(0, 0, 1)).toBe(-1)
  })
})
