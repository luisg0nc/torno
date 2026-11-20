import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watchBrief } from './watch'

let dir: string
let stop: () => void
let said: Array<{ files: boolean; board: boolean }>

const settle = (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const start = async (): Promise<void> => {
  stop = watchBrief(dir, (what) => said.push(what), 50)
  await settle(300)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-brief-watch-'))
  said = []
  stop = () => {}
})
afterEach(() => {
  stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('watching what the brief follows', () => {
  it('says so when a photo is added to or taken from reference/', async () => {
    mkdirSync(join(dir, 'reference'))
    await start()
    writeFileSync(join(dir, 'reference', 'photo-1.jpg'), 'x')
    await settle()
    expect(said).toEqual([{ files: true, board: false }])
    said.length = 0
    unlinkSync(join(dir, 'reference', 'photo-1.jpg'))
    await settle()
    expect(said).toEqual([{ files: true, board: false }])
  })

  it('says so when reference/ is made after the watch began, and when brief.md is made', async () => {
    await start()
    mkdirSync(join(dir, 'reference'))
    writeFileSync(join(dir, 'reference', 'a.step'), 'x')
    writeFileSync(join(dir, 'brief.md'), '# a\n')
    await settle()
    expect(said.length).toBeGreaterThan(0)
    expect(said.every((s) => s.files && !s.board)).toBe(true)
  })

  it('says so when board.json changes, also when .torno/board was not there yet', async () => {
    await start()
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'board', 'board.json'), '{}')
    await settle()
    expect(said).toEqual([{ files: false, board: true }])
  })

  it('puts a burst in one report', async () => {
    mkdirSync(join(dir, 'reference'))
    mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
    await start()
    writeFileSync(join(dir, 'reference', 'a.jpg'), 'x')
    writeFileSync(join(dir, '.torno', 'board', 'board.json'), '{}')
    await settle()
    expect(said).toEqual([{ files: true, board: true }])
  })

  it('says nothing of anything else: the model, the marks, the pictures and the told file', async () => {
    mkdirSync(join(dir, '.torno', 'board', 'pictures'), { recursive: true })
    await start()
    writeFileSync(join(dir, 'model.py'), 'x')
    writeFileSync(join(dir, '.torno', 'marks.json'), '[]')
    writeFileSync(join(dir, '.torno', 'board', 'told.json'), '{}')
    writeFileSync(join(dir, '.torno', 'board', 'pictures', 'p-0123456789ab.png'), 'x')
    writeFileSync(join(dir, '.torno', 'board', 'board.json.corrupt-2026-01-01T00-00-00-000Z'), 'x')
    await settle()
    expect(said).toEqual([])
  })

  it('says nothing once stopped', async () => {
    mkdirSync(join(dir, 'reference'))
    await start()
    stop()
    writeFileSync(join(dir, 'reference', 'a.jpg'), 'x')
    await settle()
    expect(said).toEqual([])
  })
})
