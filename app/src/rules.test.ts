import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// `.claude/rules/*.md` are loaded when a file their `paths:` name is read or edited. A path that names nothing
// loads nothing, so a rule left behind by a file that moved or went is a rule nobody sees. Each glob must match
// at least one tracked file.

const ROOT = join(__dirname, '..', '..')
const RULES = join(ROOT, '.claude', 'rules')

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)

/** A glob as a regular expression: `**` crosses folders, `*` and `?` do not. Braces and classes are not used by the rules. */
export function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let at = 0; at < glob.length; at += 1) {
    const ch = glob[at]
    if (ch === '*' && glob[at + 1] === '*') {
      at += 1
      if (glob[at + 1] === '/') {
        at += 1
        out += '(?:.*/)?'
      } else out += '.*'
    } else if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

/** The `paths:` globs of a rule's front matter. */
export function pathsOf(text: string): string[] {
  const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
  const block = /^paths:\n((?:\s+- .*\n?)+)/m.exec(`${head}\n`)?.[1] ?? ''
  return [...block.matchAll(/^\s+- "?([^"\n]+?)"?\s*$/gm)].map((match) => match[1])
}

describe('globToRegExp', () => {
  it('matches the way the rules write their paths', () => {
    expect(globToRegExp('app/e2e/**').test('app/e2e/loop.spec.ts')).toBe(true)
    expect(globToRegExp('app/e2e/**').test('app/e2e/sub/a.ts')).toBe(true)
    expect(globToRegExp('app/src/renderer/ui/card/*.ts').test('app/src/renderer/ui/card/a.ts')).toBe(true)
    expect(globToRegExp('app/src/renderer/ui/card/*.ts').test('app/src/renderer/ui/card/sub/a.ts')).toBe(false)
    expect(globToRegExp('app/src/renderer/ui/card/*.ts').test('app/src/renderer/ui/card/a.tsx')).toBe(false)
    expect(globToRegExp('app/src/**/a.ts').test('app/src/a.ts')).toBe(true)
    expect(globToRegExp('app/src/a.ts').test('app/src/aXts')).toBe(false)
  })

  it('reads the paths of a rule', () => {
    expect(pathsOf('---\npaths:\n  - "a/b.ts"\n  - "c/**"\n---\n\n# Heading\n- not a path\n')).toEqual(['a/b.ts', 'c/**'])
  })
})

describe('.claude/rules', () => {
  const files = readdirSync(RULES).filter((name) => name.endsWith('.md'))

  it('finds rules to look at', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it('has `paths:` in every rule', () => {
    const without = files.filter((name) => pathsOf(readFileSync(join(RULES, name), 'utf8')).length === 0)
    expect(without).toEqual([])
  })

  it('names no path that matches nothing: a rule left behind by a file that moved or went loads for nobody', () => {
    const found: string[] = []
    for (const name of files) {
      for (const glob of pathsOf(readFileSync(join(RULES, name), 'utf8'))) {
        const pattern = globToRegExp(glob)
        if (!tracked.some((file) => pattern.test(file))) found.push(`${name}: ${glob}`)
      }
    }
    expect(found).toEqual([])
  })
})
