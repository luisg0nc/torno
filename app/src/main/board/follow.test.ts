import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BoardFile } from '../../shared/board'
import type { Mark } from '../../shared/marks'
import type { Round } from '../../shared/reviews'
import { foundRounds, reconcileProject } from './follow'
import { BoardStore } from './store'

let dir: string
let board: BoardStore
let marks: Array<{ id: string; layout: string; round?: string; author?: 'user' | 'agent'; intent?: 'want' | 'dont' }>
let rounds: Round[]
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
  rounds: async () => rounds,
  scans: async () => scans,
  tracings: async () => tracings
})
const read = (): BoardFile => JSON.parse(readFileSync(join(dir, '.torno', 'board', 'board.json'), 'utf8'))
const sources = (): string[] => read().cards.map((c) => `${c.kind}:${c.source}`)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-board-follow-'))
  board = new BoardStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  marks = []
  rounds = []
  scans = []
  tracings = []
  fail = false
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const round = (id: string, build: string, over: Partial<Round> = {}): Round => ({ id, build, sources: 'abc', line: '', layout: 'lid', startedAt: '2026-11-17T10:00:00Z', ...over })

describe('foundRounds', () => {
  it('names a round by its counts and lists the marks that are its items, with where it was carried from', () => {
    const list = [
      { id: 'M1', author: 'user', kind: 'pin', intent: 'dont', round: 'R1' },
      { id: 'M2', author: 'user', kind: 'pin', intent: 'want', round: 'R2' },
      { id: 'M3', author: 'user', kind: 'pin', round: 'R2' }
    ] as unknown as Mark[]
    expect(foundRounds([round('R1', 'h41'), round('R2', 'h42', { from: 'R1' })], list)).toEqual([
      { id: 'R1', name: 'Review of h41 · 1 −', items: ['M1'] },
      { id: 'R2', name: 'Review of h42 · 1 +', items: ['M2', 'M3'], from: 'R1' }
    ])
  })
})

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

  it('shows the tracings, and leaves the board alone when they cannot be read', async () => {
    tracings = [{ id: 'T1' }]
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['tracing:T1'])
    tracings = []
    await reconcileProject({ ...deps(), tracings: async () => Promise.reject(new Error('unreadable')) }, 'bracket')
    expect(sources()).toEqual(['tracing:T1'])
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual([])
  })

  it('leaves the board alone when the marks cannot be read', async () => {
    marks = [{ id: 'M1', layout: 'lid' }]
    await reconcileProject(deps(), 'bracket')
    fail = true
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['mark:M1'])
  })

  it('puts the frame of a round with its first item, names it for its counts and renames it as they change', async () => {
    rounds = [round('R1', 'h41')]
    marks = [{ id: 'M1', layout: 'lid', round: 'R1', author: 'user', intent: 'dont' }]
    await reconcileProject(deps(), 'bracket')
    let board = read()
    const frame = board.cards.find((c) => c.kind === 'frame')
    expect(frame).toMatchObject({ source: 'R1', by: 'torno', name: 'Review of h41 · 1 −' })
    expect(board.cards.find((c) => c.source === 'M1')?.frame).toBe(frame?.id)

    marks = [...marks, { id: 'M2', layout: 'lid', round: 'R1', author: 'user', intent: 'want' }]
    await reconcileProject(deps(), 'bracket')
    board = read()
    expect(board.cards.filter((c) => c.kind === 'frame')).toHaveLength(1)
    expect(board.cards.find((c) => c.kind === 'frame')?.name).toBe('Review of h41 · 1 − · 1 +')
    expect(board.cards.find((c) => c.source === 'M2')?.frame).toBe(frame?.id)
  })

  it('leaves the board as it is when the rounds cannot be read', async () => {
    marks = [{ id: 'M1', layout: 'lid' }]
    await reconcileProject(deps(), 'bracket')
    rounds = null as never
    marks = [...marks, { id: 'M2', layout: 'lid' }]
    await reconcileProject(deps(), 'bracket')
    expect(sources()).toEqual(['mark:M1'])
  })

  it('is quiet for a project that is not open', async () => {
    await expect(reconcileProject(deps(), 'nope')).resolves.toBeUndefined()
  })
})
