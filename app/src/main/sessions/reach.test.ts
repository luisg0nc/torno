import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRIEF_REFUSAL, deniedAnswer, refusalOf } from './reach'

describe('refusalOf', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'torno-reach-')))
  const dir = join(root, 'a')
  mkdirSync(join(dir, 'sub'), { recursive: true })
  mkdirSync(join(root, 'b'))
  mkdirSync(join(root, 'common'))
  symlinkSync(join(root, 'b'), join(dir, 'link'))

  it('lets the project\'s own files and common/ through, for every tool that writes', () => {
    for (const name of ['Write', 'Edit', 'MultiEdit']) {
      expect(refusalOf(dir, name, { file_path: join(dir, 'part.py') })).toBeUndefined()
      expect(refusalOf(dir, name, { file_path: join(dir, 'sub', 'new.py') })).toBeUndefined()
      expect(refusalOf(dir, name, { file_path: join(root, 'common', 'shared.py') })).toBeUndefined()
    }
    expect(refusalOf(dir, 'NotebookEdit', { notebook_path: join(dir, 'n.ipynb') })).toBeUndefined()
  })
  it('refuses another project, the workspace\'s root and a new folder, and says why', () => {
    for (const file of [join(root, 'b', 'part.py'), join(root, 'top.py'), join(root, 'fresh', 'model.py'), join(dir, '..', 'b', 'x.py'), join(dir, 'link', 'x.py')]) {
      expect(refusalOf(dir, 'Write', { file_path: file })).toContain(`works on the project in ${dir}`)
    }
    expect(refusalOf(dir, 'NotebookEdit', { notebook_path: join(root, 'b', 'n.ipynb') })).toContain('NotebookEdit')
  })
  it('refuses a write under .torno/ of the project and names the tool to use, and lets a Read be', () => {
    const under = (file: string) => refusalOf(dir, 'Write', { file_path: join(dir, '.torno', file) })
    expect(under('marks.json')).toContain('Use add_mark and resolve_mark instead')
    expect(under('sets.json')).toContain('add_set')
    expect(under('tracings.json')).toContain('add_layer')
    expect(under('board/board.json')).toContain('add_card')
    expect(under('anything.txt')).toContain('may not write under .torno/')
    expect(refusalOf(dir, 'Edit', { file_path: join(dir, '.torno', 'marks.json') })).toContain('Edit may not write')
    expect(refusalOf(dir, 'Read', { file_path: join(dir, '.torno', 'marks.json') })).toBeUndefined()
    expect(refusalOf(dir, 'Write', { file_path: join(dir, 'torno', 'x.py') })).toBeUndefined()
  })
  it('refuses a write of brief.md, the person\'s own words, and names add_card, unless the turn may move Claude\'s old sections out of it (#337, #341)', () => {
    for (const name of ['Write', 'Edit', 'MultiEdit']) {
      const said = refusalOf(dir, name, { file_path: join(dir, 'brief.md') })
      expect(said).toContain(`${name} may not write brief.md`)
      expect(said).toContain('add_card')
    }
    expect(refusalOf(dir, 'Edit', { file_path: join(dir, 'sub', '..', 'brief.md') })).toBe(BRIEF_REFUSAL('Edit'))
    expect(refusalOf(dir, 'Edit', { file_path: join(dir, 'brief.md') }, { brief: true })).toBeUndefined()
    expect(refusalOf(dir, 'Read', { file_path: join(dir, 'brief.md') })).toBeUndefined()
    expect(refusalOf(dir, 'Write', { file_path: join(dir, 'notes', 'brief.md') })).toBeUndefined()
  })
  it('leaves other tools and inputs it cannot read to the CLI', () => {
    expect(refusalOf(dir, 'Bash', { command: 'echo > ../b/x' })).toBeUndefined()
    expect(refusalOf(dir, 'Read', { file_path: join(root, 'b', 'part.py') })).toBeUndefined()
    expect(refusalOf(dir, 'Write', {})).toBeUndefined()
    expect(refusalOf(dir, 'Write', null)).toBeUndefined()
  })
  it('answers as the CLI reads a refusal', () => {
    expect(deniedAnswer('no')).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } })
  })
})
