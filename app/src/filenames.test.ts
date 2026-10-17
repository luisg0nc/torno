import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// macOS and Windows keep one file for names that differ only in case, and resolve `./Welcome` to `welcome.ts`
// before `Welcome.tsx`. A Linux machine cannot see that, so this test does.

const ROOT = join(__dirname, '..', '..')

function tracked(folder: string): string[] {
  const out = execFileSync('git', ['ls-files', '--', folder], { cwd: ROOT, encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

/** The groups of names that are one when case is folded. */
function collisions(names: string[]): string[][] {
  const by = new Map<string, Set<string>>()
  for (const name of names) {
    const key = name.toLowerCase()
    by.set(key, (by.get(key) ?? new Set()).add(name))
  }
  return [...by.values()].filter((group) => group.size > 1).map((group) => [...group])
}

const withoutExtension = (path: string): string => path.replace(/\.[^./]+$/, '')

describe('tracked files', () => {
  const files = [...tracked('app/src'), ...tracked('kernel/src')]

  it('finds files to look at', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('has no two paths that differ only in case', () => {
    expect(collisions(files)).toEqual([])
  })

  it('has no two modules of a folder whose names differ only in case', () => {
    // `Welcome.tsx` beside `welcome.ts`: the import `./Welcome` is one module or the other, by the filesystem.
    expect(collisions(files.filter((f) => !/\.(test|itest)\.[jt]sx?$/.test(f)).map((f) => join(dirname(f), withoutExtension(f.slice(dirname(f).length + 1)).split('.')[0])).filter((m, i, all) => all.indexOf(m) === i))).toEqual([])
  })
})
