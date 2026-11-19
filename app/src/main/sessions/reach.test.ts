import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deniedAnswer, refusalOf } from './reach'

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
