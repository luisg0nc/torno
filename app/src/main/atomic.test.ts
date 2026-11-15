import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from './atomic'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-atomic-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('writing a file atomically', () => {
  it('creates the folder, writes the file and leaves no temp file', async () => {
    const path = join(dir, 'a', 'b', 'file.json')
    await writeFileAtomic(path, 'one\n')
    expect(readFileSync(path, 'utf8')).toBe('one\n')
    expect(readdirSync(join(dir, 'a', 'b'))).toEqual(['file.json'])
  })

  it('writes bytes as well as text', async () => {
    await writeFileAtomic(join(dir, 'bytes'), new Uint8Array([1, 2, 3]))
    expect([...readFileSync(join(dir, 'bytes'))]).toEqual([1, 2, 3])
  })

  it('lands the writes of one file in the order they were made', async () => {
    const path = join(dir, 'file')
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(path, `${i}`)))
    expect(readFileSync(path, 'utf8')).toBe('19')
    expect(readdirSync(dir)).toEqual(['file'])
  })

  it('removes the temp file when the write fails, and the next write is not held up by it', async () => {
    // A folder where the file should be: the rename cannot replace it.
    const path = join(dir, 'taken')
    mkdirSync(join(path, 'inside'), { recursive: true })
    await expect(writeFileAtomic(path, 'x')).rejects.toThrow()
    expect(readdirSync(dir)).toEqual(['taken'])
    rmSync(path, { recursive: true })
    await writeFileAtomic(path, 'y')
    expect(readFileSync(path, 'utf8')).toBe('y')
  })

  it('does not follow a link planted at the temp name the way an older write named it', async () => {
    const victim = join(dir, 'victim')
    writeFileSync(victim, 'precious')
    const path = join(dir, 'file')
    // The name this process used to write through: a link there must lead nowhere now.
    symlinkSync(victim, `${path}.${process.pid}.tmp`)
    await writeFileAtomic(path, 'new')
    expect(readFileSync(victim, 'utf8')).toBe('precious')
    expect(readFileSync(path, 'utf8')).toBe('new')
    expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(true)
  })

  it('never writes through a temp name that is already there: the open is exclusive', async () => {
    const path = join(dir, 'file')
    const names = new Set<string>()
    for (let i = 0; i < 5; i++) {
      await writeFileAtomic(path, `${i}`)
      for (const n of readdirSync(dir)) names.add(n)
    }
    expect([...names]).toEqual(['file'])
  })
})
