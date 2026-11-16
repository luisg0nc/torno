import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_TEXT_CHARS } from '../../shared/board'
import { liveFacts, readBrief } from './live'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-board-live-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the facts a board card shows', () => {
  it('reads the brief as a plain file, cut at the most a card holds', async () => {
    writeFileSync(join(root, 'brief.md'), 'é'.repeat(MAX_TEXT_CHARS + 500))
    expect(await readBrief(root)).toHaveLength(MAX_TEXT_CHARS)
  })
  it('reads no brief that is a link or is not there', async () => {
    expect(await readBrief(root)).toBeUndefined()
    writeFileSync(join(root, 'real.md'), 'secret')
    symlinkSync(join(root, 'real.md'), join(root, 'brief.md'))
    expect(await readBrief(root)).toBeUndefined()
    rmSync(join(root, 'brief.md'))
    mkdirSync(join(root, 'brief.md'))
    expect(await readBrief(root)).toBeUndefined()
  })
  it('gathers the marks, the last scene and the tries', async () => {
    writeFileSync(join(root, 'brief.md'), 'a bracket')
    const scene = { params: [{ name: 'wall' }], checks: [{ name: 'fit' }] } as never
    const facts = await liveFacts({ dir: root, marks: [{ id: 'M1' } as never], scene, overrides: () => ({ wall: { value: 3, default: 2 } }) })
    expect([...facts.marks.keys()]).toEqual(['M1'])
    expect(facts.params).toHaveLength(1)
    expect(facts.checks).toHaveLength(1)
    expect(facts.tried).toEqual({ wall: { value: 3, default: 2 } })
    expect(facts.brief).toBe('a bracket')
    expect(Object.keys(await liveFacts({ dir: undefined, marks: [], scene: undefined, overrides: () => ({}) }))).toEqual(['marks'])
  })
})
