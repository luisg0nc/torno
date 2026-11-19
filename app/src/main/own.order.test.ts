import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The folder check of the first call is made slow, as a slow file system does: the second call's check ends first.
const slow = vi.hoisted(() => ({ first: true }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: (async (...args: Parameters<typeof actual.lstat>) => {
      if (slow.first) {
        slow.first = false
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
      return actual.lstat(...args)
    }) as typeof actual.lstat
  }
})

import { writeOwn } from './own'

let obj: string
beforeEach(() => {
  slow.first = true
  obj = join(mkdtempSync(join(realpathSync(tmpdir()), 'torno-own-order-')), 'lid')
  mkdirSync(obj, { recursive: true })
})
afterEach(() => rmSync(join(obj, '..'), { recursive: true, force: true }))

describe('writeOwn order', () => {
  it('lands two saves of one file in the order they were called, whatever the folder check takes', async () => {
    const first = writeOwn(obj, 'marks.json', 'one')
    const second = writeOwn(obj, 'marks.json', 'two')
    await Promise.all([first, second])
    expect(readFileSync(join(obj, '.torno', 'marks.json'), 'utf8')).toBe('two')
  })
})
