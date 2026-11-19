import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BoardFile } from '../../shared/board'
import type { Mark } from '../../shared/marks'
import { reconcileProject } from './follow'
import { BoardStore } from './store'

let dir: string
let board: BoardStore
let marks: Array<{ id: string; layout: string; round?: string; author?: 'user' | 'agent'; intent?: 'want' | 'dont' }>
let scans: string[]
let tracings: Array<{ id: string }>
let fail: boolean

const deps = () => ({
  board,
  object: (id: string) => (id === 'bracket' ? { id, name: id, dir, model: null } : undefined),
  marks: async () => {
    if (fail) throw new Error('unreadable')
    return marks as Mark[]
  },
  scans: async () => scans,
  tracings: async () => tracings
})
const read = (): BoardFile => JSON.parse(readFileSync(join(dir, '.torno', 'board', 'board.json'), 'utf8'))
const sources = (): string[] => read().cards.map((c) => `${c.kind}:${c.source}`)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-board-follow-'))
  board = new BoardStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  marks = []
  scans = []
  tracings = []
  fail = false
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A board an earlier torno wrote: copies of a mark, a scan and a tracing on it, not yet looked at (#248). */
const seed = (): void => {
  mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
  const card = (id: number, kind: string, source: string) => ({ id: `C${id}`, kind, x: id * 300, y: 0, w: 240, h: 120, by: 'torno', source })
  const file = { next: 4, cards: [card(1, 'mark', 'M1'), card(2, 'scan', 'S1'), card(3, 'tracing', 'T1')], arrows: [] }
  writeFileSync(join(dir, '.torno', 'board', 'board.json'), JSON.stringify(file))
}

describe('reconcileProject', () => {
  it('writes nothing for a project with nothing to show', async () => {
    await reconcileProject(deps(), 'bracket')
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('puts the brief when brief.md is a plain file, and takes it away when it is gone', async () => {
    writeFileSync(join(dir, 'brief.md'), '# A bracket\n')
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['brief:brief'])
    rmSync(join(dir, 'brief.md'))
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual([])
  })

  it('does not take a brief.md that is a link for one', async () => {
    writeFileSync(join(dir, 'real.md'), 'x')
    symlinkSync(join(dir, 'real.md'), join(dir, 'brief.md'))
    await reconcileProject(deps(), 'bracket')
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('shows a STEP and a PDF of reference/ as cards, and not a link named so', async () => {
    mkdirSync(join(dir, 'reference'))
    writeFileSync(join(dir, 'reference', '608zz.step'), 'x')
    writeFileSync(join(dir, 'reference', 'datasheet.pdf'), 'x')
    symlinkSync(join(dir, 'reference', 'datasheet.pdf'), join(dir, 'reference', 'x.pdf'))
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['reference:reference/608zz.step', 'reference:reference/datasheet.pdf'])
  })

  it('shows the reference files and nothing for marks, scans, tracings and rounds', async () => {
    mkdirSync(join(dir, 'reference'))
    writeFileSync(join(dir, 'reference', 'photo-1.jpg'), 'x')
    writeFileSync(join(dir, 'reference', 'notes.txt'), 'x')
    marks = [{ id: 'M1', layout: 'lid', round: 'R1', author: 'user', intent: 'dont' }]
    scans = ['S1']
    tracings = [{ id: 'T1' }]
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['reference:reference/photo-1.jpg'])
    marks = [...marks, { id: 'M2', layout: 'lid' }]
    scans = ['S1', 'S2']
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['reference:reference/photo-1.jpg'])
  })

  it('writes no board file for a project that only has marks, scans and tracings', async () => {
    marks = [{ id: 'M1', layout: 'lid' }]
    scans = ['S1']
    tracings = [{ id: 'T1' }]
    await reconcileProject(deps(), 'bracket')
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('hides the old copies of an existing board, loses none, and takes a copy away with its thing', async () => {
    seed()
    marks = [{ id: 'M1', layout: 'lid' }]
    scans = ['S1']
    tracings = [{ id: 'T1' }]
    await reconcileProject(deps(), 'bracket')
    expect(read().cards.map((c) => [c.source, c.hidden === true])).toEqual([['M1', true], ['S1', true], ['T1', true]])
    scans = []
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['mark:M1', 'tracing:T1'])
  })

  it('leaves the board alone when the tracings or the marks cannot be read', async () => {
    seed()
    await reconcileProject({ ...deps(), tracings: async () => Promise.reject(new Error('unreadable')) }, 'bracket')
    expect(read().cards.every((c) => c.hidden === undefined)).toBe(true)
    fail = true
    await reconcileProject(deps(), 'bracket')
    expect(read().cards).toHaveLength(3)
    expect(read().cards.every((c) => c.hidden === undefined)).toBe(true)
  })

  it('is quiet for a project that is not open', async () => {
    await expect(reconcileProject(deps(), 'nope')).resolves.toBeUndefined()
  })
})
