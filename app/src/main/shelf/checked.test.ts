import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShelfPart } from '../../shared/shelf'
import { localDay, recordMeasured } from './checked'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-checked-'))
  mkdirSync(join(root, 'common', 'parts', 'ec11'), { recursive: true })
  writeFileSync(join(root, 'common', 'parts', 'ec11', 'part.py'), '"""EC11"""\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const size = (name: string, v: number) => ({ name, type: 'float', default: v, literal: true, doc: 'assumed: x' })
const part = (id: string): ShelfPart => ({ id, file: `common/parts/${id}/part.py`, name: id, what: '', params: [size('body_h', 6.5), { name: 'label', type: 'str', default: 'x', literal: true, doc: null }], checked: {}, files: [] })

/** What the store gives: the workspace, the parts, and a way to be told a check was written. */
const shelfOf = (...parts: ShelfPart[]) => ({ workspaceRoot: () => root as string | null, list: () => parts, checkedChanged: vi.fn(async () => {}) })
const checkedFile = (id = 'ec11') => join(root, 'common', 'parts', id, '.torno', 'checked.json')
const day = new Date(2026, 10, 26, 23, 59) // local time, late in the day

describe('localDay', () => {
  it('is the date on the wall clock, not UTC', () => {
    expect(localDay(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05')
    expect(localDay(day)).toBe('2026-11-26')
  })
})

describe('recordMeasured', () => {
  it('writes common/parts/<id>/.torno/checked.json with the value and the day, and tells the store', async () => {
    const shelf = shelfOf(part('ec11'))
    const got = await recordMeasured(shelf, 'ec11', 'body_h', 6.6, day)
    expect(got).toEqual({ value: 6.6, date: '2026-11-26' })
    expect(JSON.parse(readFileSync(checkedFile(), 'utf8'))).toEqual({ body_h: { value: 6.6, date: '2026-11-26' } })
    expect(shelf.checkedChanged).toHaveBeenCalledTimes(1)
    // Only that file, and its folder: nothing else of the workspace is touched.
    expect(readdirSync(join(root, 'common', 'parts', 'ec11')).sort()).toEqual(['.torno', 'part.py'])
    expect(readdirSync(join(root, 'common', 'parts', 'ec11', '.torno'))).toEqual(['checked.json'])
    expect(readdirSync(join(root, 'common', 'parts'))).toEqual(['ec11'])
  })

  it('merges with what is there: another size stays, the same size is replaced', async () => {
    mkdirSync(join(root, 'common', 'parts', 'ec11', '.torno'))
    writeFileSync(checkedFile(), JSON.stringify({ body_w: { value: 12, date: '2026-11-01' }, body_h: { value: 6, date: '2026-11-02' } }))
    await recordMeasured(shelfOf(part('ec11')), 'ec11', 'body_h', 6.6, day)
    expect(JSON.parse(readFileSync(checkedFile(), 'utf8'))).toEqual({ body_w: { value: 12, date: '2026-11-01' }, body_h: { value: 6.6, date: '2026-11-26' } })
  })

  it('two measurements at once both stay', async () => {
    const shelf = shelfOf({ ...part('ec11'), params: [size('a', 1), size('b', 2)] })
    await Promise.all([recordMeasured(shelf, 'ec11', 'a', 1.5, day), recordMeasured(shelf, 'ec11', 'b', 2.5, day)])
    expect(JSON.parse(readFileSync(checkedFile(), 'utf8'))).toEqual({ a: { value: 1.5, date: '2026-11-26' }, b: { value: 2.5, date: '2026-11-26' } })
  })

  it('refuses an id that is not a part id or not on the shelf, writing nothing', async () => {
    const shelf = shelfOf(part('ec11'))
    await expect(recordMeasured(shelf, '../x', 'body_h', 6.6, day)).rejects.toThrow(/not a part/)
    await expect(recordMeasured(shelf, 'for', 'body_h', 6.6, day)).rejects.toThrow(/not a part/)
    await expect(recordMeasured(shelf, 'other', 'body_h', 6.6, day)).rejects.toThrow(/not on the shelf/)
    expect(readdirSync(join(root, 'common', 'parts'))).toEqual(['ec11'])
    expect(shelf.checkedChanged).not.toHaveBeenCalled()
  })

  it('refuses a name that is not a size of the part (a text, a name the part lacks, __proto__)', async () => {
    const shelf = shelfOf(part('ec11'))
    for (const name of ['label', 'nope', '__proto__', '']) await expect(recordMeasured(shelf, 'ec11', name, 6.6, day)).rejects.toThrow(/not a size/)
    expect(readdirSync(join(root, 'common', 'parts', 'ec11'))).toEqual(['part.py'])
  })

  it('refuses a value that is not a number above 0 and below 10,000', async () => {
    const shelf = shelfOf(part('ec11'))
    for (const value of [0, -1, NaN, Infinity, 10_000, 1e9, '6.6' as unknown as number, null as unknown as number]) {
      await expect(recordMeasured(shelf, 'ec11', 'body_h', value, day)).rejects.toThrow(/more than 0 and less than 10,000/)
    }
    expect(readdirSync(join(root, 'common', 'parts', 'ec11'))).toEqual(['part.py'])
    await expect(recordMeasured(shelf, 'ec11', 'body_h', 9999.5, day)).resolves.toBeTruthy()
  })

  it('refuses a link in the place of .torno, and writes through nothing', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'torno-checked-away-'))
    try {
      symlinkSync(elsewhere, join(root, 'common', 'parts', 'ec11', '.torno'))
      await expect(recordMeasured(shelfOf(part('ec11')), 'ec11', 'body_h', 6.6, day)).rejects.toThrow(/is a link/)
      expect(readdirSync(elsewhere)).toEqual([])
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('refuses a file in the place of .torno', async () => {
    writeFileSync(join(root, 'common', 'parts', 'ec11', '.torno'), 'x')
    await expect(recordMeasured(shelfOf(part('ec11')), 'ec11', 'body_h', 6.6, day)).rejects.toThrow(/is a file/)
  })

  it('refuses a part folder that is a link', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'torno-checked-away-'))
    try {
      symlinkSync(elsewhere, join(root, 'common', 'parts', 'linked'))
      await expect(recordMeasured(shelfOf(part('linked')), 'linked', 'body_h', 6.6, day)).rejects.toThrow(/is a link/)
      expect(readdirSync(elsewhere)).toEqual([])
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('does not overwrite a checked.json it cannot read', async () => {
    mkdirSync(join(root, 'common', 'parts', 'ec11', '.torno'))
    writeFileSync(checkedFile(), '{ not json')
    await expect(recordMeasured(shelfOf(part('ec11')), 'ec11', 'body_h', 6.6, day)).rejects.toThrow(/checked\.json/)
    expect(readFileSync(checkedFile(), 'utf8')).toBe('{ not json')
  })

  it('refuses with no workspace open', async () => {
    await expect(recordMeasured({ ...shelfOf(part('ec11')), workspaceRoot: () => null }, 'ec11', 'body_h', 6.6, day)).rejects.toThrow(/no workspace/)
  })
})
