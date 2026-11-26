import { describe, expect, it } from 'vitest'
import type { Param, Scene } from '../../shared/scene'
import type { ShelfPart } from '../../shared/shelf'
import { findShelf, shelfCounts } from './shelfFind'

const size = (name: string, doc: string | null, value = 1): Param => ({ name, type: 'float', default: value, literal: true, doc })
const part = (id: string, name: string, over: Partial<ShelfPart> = {}): ShelfPart => ({ id, file: `common/parts/${id}/part.py`, name, what: '', params: [], checked: {}, files: [], ...over })
const scene = { model: 'm', layouts: [], parts: [], seconds: 0, output: '', shelf: { ec11: 2 } } as Scene

const PARTS = [
  part('ec11', 'EC11 rotary encoder', { what: 'Alps-style encoder with a push switch', params: [size('hole_d', 'derived: bush and play', 7.2), size('body_h', 'assumed: below the panel', 6.5)] }),
  part('mts', 'MTS-101 mini toggle', { params: [size('hole_d', 'datasheet: x', 6.2)] }),
  part('bearing', '608 ball bearing', { params: [size('od', 'checked', 22)], checked: { od: { value: 22, date: '2026-11-26' } } })
]

describe('finding a part on the shelf', () => {
  it('keeps every part for All and an empty find', () => {
    expect(findShelf(PARTS, scene, '', 'all').map((p) => p.id)).toEqual(['ec11', 'mts', 'bearing'])
  })
  it('finds by id, name or what it is, every word, any case', () => {
    expect(findShelf(PARTS, scene, 'EC11', 'all').map((p) => p.id)).toEqual(['ec11'])
    expect(findShelf(PARTS, scene, 'mini toggle', 'all').map((p) => p.id)).toEqual(['mts'])
    expect(findShelf(PARTS, scene, 'push switch', 'all').map((p) => p.id)).toEqual(['ec11'])
    expect(findShelf(PARTS, scene, 'push nothing', 'all')).toEqual([])
  })
  it('finds a size by its value as written', () => {
    expect(findShelf(PARTS, scene, '7.2', 'all').map((p) => p.id)).toEqual(['ec11'])
    expect(findShelf(PARTS, scene, '6.2', 'all').map((p) => p.id)).toEqual(['mts'])
    expect(findShelf(PARTS, scene, '22', 'all').map((p) => p.id)).toEqual(['bearing'])
  })
  it('filters to the parts this project uses', () => {
    expect(findShelf(PARTS, scene, '', 'here').map((p) => p.id)).toEqual(['ec11'])
    expect(findShelf(PARTS, null, '', 'here')).toEqual([])
  })
  it('filters to the parts with an assumed size, a checked one no longer assumed', () => {
    const checked = [...PARTS, part('chk', 'Checked', { params: [size('a', 'assumed: x')], checked: { a: { value: 1, date: '2026-11-26' } } })]
    expect(findShelf(checked, scene, '', 'assumed').map((p) => p.id)).toEqual(['ec11'])
    expect(findShelf(checked, scene, 'mts', 'assumed')).toEqual([])
  })
  it('counts each chip', () => {
    expect(shelfCounts(PARTS, scene)).toEqual({ all: 3, here: 1, assumed: 1 })
  })
})
