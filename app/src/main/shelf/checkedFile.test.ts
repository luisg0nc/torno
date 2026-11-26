import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHECKED_BYTES, readCheckedText } from './checkedFile'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-checkedfile-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readCheckedText', () => {
  it('gives the text of a plain file and null for a file that is not there', async () => {
    writeFileSync(join(dir, 'c.json'), '{"a":1}')
    expect(await readCheckedText(join(dir, 'c.json'))).toBe('{"a":1}')
    expect(await readCheckedText(join(dir, 'none.json'))).toBeNull()
  })

  it('refuses a link, even to a plain file, with a plain reason', async () => {
    writeFileSync(join(dir, 'secret'), 'password')
    symlinkSync(join(dir, 'secret'), join(dir, 'c.json'))
    await expect(readCheckedText(join(dir, 'c.json'))).rejects.toThrow(/is a link/)
  })

  it('refuses a pipe without waiting on it', async () => {
    execFileSync('mkfifo', [join(dir, 'c.json')])
    await expect(readCheckedText(join(dir, 'c.json'))).rejects.toThrow(/not a plain file/)
  })

  it('refuses a file over 64 KB before reading it, and one that is exactly 64 KB is read', async () => {
    writeFileSync(join(dir, 'c.json'), 'x'.repeat(CHECKED_BYTES + 1))
    await expect(readCheckedText(join(dir, 'c.json'))).rejects.toThrow(/over 64 KB/)
    writeFileSync(join(dir, 'c.json'), ' '.repeat(CHECKED_BYTES))
    expect((await readCheckedText(join(dir, 'c.json')))?.length).toBe(CHECKED_BYTES)
  })
})
