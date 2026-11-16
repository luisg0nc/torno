import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BoardFile } from '../../shared/board'
import { reconcileProject } from './follow'
import { BoardStore } from './store'

let dir: string
let board: BoardStore
let marks: Array<{ id: string; layout: string }>
let scans: string[]
let fail: boolean

const deps = () => ({
  board,
  object: (id: string) => (id === 'bracket' ? { id, name: id, dir, model: null } : undefined),
  marks: async () => {
    if (fail) throw new Error('unreadable')
    return marks
  },
  scans: async () => scans
})
const read = (): BoardFile => JSON.parse(readFileSync(join(dir, '.torno', 'board', 'board.json'), 'utf8'))
const sources = (): string[] => read().cards.map((c) => `${c.kind}:${c.source}`)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-board-follow-'))
  board = new BoardStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  marks = []
  scans = []
  fail = false
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

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

  it('shows the reference files, the marks and the scans', async () => {
    mkdirSync(join(dir, 'reference'))
    writeFileSync(join(dir, 'reference', 'photo-1.jpg'), 'x')
    writeFileSync(join(dir, 'reference', 'notes.txt'), 'x')
    marks = [{ id: 'M1', layout: 'lid' }]
    scans = ['S1']
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['reference:reference/photo-1.jpg', 'mark:M1', 'scan:S1'])
  })

  it('leaves the board alone when the marks cannot be read', async () => {
    marks = [{ id: 'M1', layout: 'lid' }]
    await reconcileProject(deps(), 'bracket')
    fail = true
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['mark:M1'])
  })

  it('is quiet for a project that is not open', async () => {
    await expect(reconcileProject(deps(), 'nope')).resolves.toBeUndefined()
  })
})
