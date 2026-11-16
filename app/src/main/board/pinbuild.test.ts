import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BoardFile } from '../../shared/board'
import { PICTURE_NAME } from '../../shared/board'
import type { HistoryEntry } from '../../shared/history'
import type { ObjectInfo } from '../../shared/workspace'
import { pinBuild } from './pinbuild'
import { BoardStore } from './store'

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

const entry = (n: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: `h${n}`, at: '2026-11-16T10:00:00Z', run: 'r', revision: n, sources: `hash${n}`, model: 'model.py', files: [], parts: 1, seconds: 1, line: `build ${n}`, cause: 'agent', ...extra
})

let dir: string
let obj: ObjectInfo
let board: BoardStore
let starred: string[]

const deps = () => ({
  board,
  object: (id: string) => (id === 'bracket' ? obj : undefined),
  history: { star: async (_o: ObjectInfo, id: string, on: boolean) => (starred.push(`${id}:${on}`), true) }
})

function keep(entries: HistoryEntry[], thumbs: Record<string, Uint8Array> = {}): void {
  const folder = join(dir, '.torno', 'history')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'index.json'), JSON.stringify({ next: 99, drawnGone: 0, entries }))
  for (const [id, bytes] of Object.entries(thumbs)) {
    mkdirSync(join(folder, id), { recursive: true })
    writeFileSync(join(folder, id, 'thumb.png'), bytes)
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-board-pin-'))
  obj = { id: 'bracket', name: 'bracket', dir, model: 'model.py' }
  board = new BoardStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  starred = []
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const onDisk = (): BoardFile => JSON.parse(readFileSync(join(dir, '.torno', 'board', 'board.json'), 'utf8'))

describe('pinBuild', () => {
  it('stars the build, keeps its picture and pins a card with a copy of what the entry says', async () => {
    keep([entry(40), entry(41, { thumb: true, cause: 'person', line: 'lid thinner' })], { h41: png(320, 240) })
    const result = await pinBuild(deps(), 'bracket', 'h41')
    expect('refused' in result).toBe(false)
    expect(starred).toEqual(['h41:true'])
    const saved = onDisk()
    expect(saved.cards).toHaveLength(1)
    const card = saved.cards[0]
    expect(card).toMatchObject({ kind: 'build', by: 'person', source: 'h41', copy: { id: 'h41', line: 'lid thinner', cause: 'person', sources: 'hash41' } })
    expect(card.picture).toMatch(PICTURE_NAME)
    expect(existsSync(join(dir, '.torno', 'board', 'pictures', card.picture as string))).toBe(true)
  })

  it('pins a build without a picture when it has none', async () => {
    keep([entry(7)])
    await pinBuild(deps(), 'bracket', 'h7')
    expect(onDisk().cards[0].picture).toBeUndefined()
    expect(existsSync(join(dir, '.torno', 'board', 'pictures'))).toBe(false)
  })

  it('names a cause the entry does not say as unknown', async () => {
    const { cause: _c, ...bare } = entry(3)
    keep([bare as HistoryEntry])
    await pinBuild(deps(), 'bracket', 'h3')
    expect(onDisk().cards[0].copy?.cause).toBe('unknown')
  })

  it('refuses a build that is not kept, and stars and writes nothing', async () => {
    keep([entry(1)])
    expect(await pinBuild(deps(), 'bracket', 'h2')).toEqual({ refused: expect.stringContaining('h2') })
    expect(await pinBuild(deps(), 'bracket', 'not an id')).toHaveProperty('refused')
    expect(starred).toEqual([])
    expect(existsSync(join(dir, '.torno', 'board'))).toBe(false)
  })

  it('refuses a project that is not open', async () => {
    expect(await pinBuild(deps(), 'nope', 'h1')).toEqual({ refused: expect.stringContaining('not open') })
  })

  it('leaves no star when the star cannot be set', async () => {
    keep([entry(1)])
    const none = { ...deps(), history: { star: async () => false } }
    expect(await pinBuild(none, 'bracket', 'h1')).toHaveProperty('refused')
    expect(readdirSync(dir)).toEqual(['.torno'])
    expect(existsSync(join(dir, '.torno', 'board'))).toBe(false)
  })
})
