import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInsideFolder } from './inside'

describe('isInsideFolder', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'torno-inside-')))
  const real = join(base, 'real')
  const link = join(base, 'link')
  mkdirSync(join(real, 'sub'), { recursive: true })
  writeFileSync(join(real, 'model.py'), '')
  writeFileSync(join(base, 'outside.py'), '')
  symlinkSync(real, link)

  it('takes a file inside, as it is written or as the real path', () => {
    expect(isInsideFolder(real, join(real, 'model.py'))).toBe(true)
    expect(isInsideFolder(real, 'model.py')).toBe(true)
    expect(isInsideFolder(real, 'sub/new.py')).toBe(true)
  })
  it('takes a file inside when the folder is reached through a link and the file by its real path, and the other way', () => {
    expect(isInsideFolder(link, join(real, 'model.py'))).toBe(true)
    expect(isInsideFolder(real, join(link, 'model.py'))).toBe(true)
    expect(isInsideFolder(link, join(real, 'sub', 'not-yet', 'new.py'))).toBe(true)
  })
  it('keeps a file outside outside', () => {
    expect(isInsideFolder(link, join(base, 'outside.py'))).toBe(false)
    expect(isInsideFolder(real, '../outside.py')).toBe(false)
    expect(isInsideFolder(link, join(link, '..', 'outside.py'))).toBe(false)
    expect(isInsideFolder(real, real)).toBe(false)
  })
})
