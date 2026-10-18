import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { EXAMPLE_MARKER, EXAMPLE_OBJECTS, copyExample, exampleSource, removeExample, sweepExamples } from './example'
import { MAX_RECENT, configOf, listed, recentWith, recentWithout } from './recent'

const made: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'torno-recent-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('keeps the folders opened last, the newest first, each once, eight at most', () => {
  expect(recentWith([], '/a')).toEqual(['/a'])
  expect(recentWith(['/a', '/b'], '/b')).toEqual(['/b', '/a'])
  const nine = Array.from({ length: 9 }, (_, i) => `/f${i}`).reduce<string[]>((list, root) => recentWith(list, root), [])
  expect(nine).toHaveLength(MAX_RECENT)
  expect(MAX_RECENT).toBe(8)
  expect(nine[0]).toBe('/f8')
  expect(nine).not.toContain('/f0')
  expect(recentWithout(['/a', '/b'], '/a')).toEqual(['/b'])
  expect(recentWithout(['/a'], '/x')).toEqual(['/a'])
})

it('reads a config file of any age, and nothing from what is not one', () => {
  expect(configOf({ workspace: '/a' })).toEqual({ workspace: '/a', recent: [] })
  expect(configOf({ workspace: '/a', recent: ['/a', 3, '', 'relative', '/b', '/a'] })).toEqual({ workspace: '/a', recent: ['/a', '/b'] })
  expect(configOf({ recent: Array.from({ length: 20 }, (_, i) => `/f${i}`) }).recent).toHaveLength(8)
  expect(configOf(null)).toEqual({ recent: [] })
  expect(configOf('text')).toEqual({ recent: [] })
  expect(configOf({ workspace: 4, recent: 'no' })).toEqual({ recent: [] })
})

it('says which of them is no longer a folder', async () => {
  const dir = temp()
  mkdirSync(join(dir, 'here'))
  writeFileSync(join(dir, 'file'), '')
  expect(await listed([join(dir, 'here'), join(dir, 'gone'), join(dir, 'file')])).toEqual([
    { root: join(dir, 'here'), missing: false },
    { root: join(dir, 'gone'), missing: true },
    { root: join(dir, 'file'), missing: true }
  ])
})

it('offers the example only from the repository, and copies it without touching it', async () => {
  const repo = temp()
  const ws = join(repo, 'kernel', 'tests', 'fixtures', 'ws')
  for (const name of [...EXAMPLE_OBJECTS, 'broken']) {
    mkdirSync(join(ws, name, '__pycache__'), { recursive: true })
    writeFileSync(join(ws, name, `${name}.py`), `# ${name}\n`)
    writeFileSync(join(ws, name, '__pycache__', 'x.pyc'), 'x')
    mkdirSync(join(ws, name, '.torno'))
    writeFileSync(join(ws, name, '.torno', 'marks.json'), '{}')
  }
  writeFileSync(join(ws, 'gauge', 'variant.txt'), 'a\n')
  expect(exampleSource(join(repo, 'app'), false)).toBe(ws)
  // A repository without its fixtures has none.
  // A packaged app carries the objects in its resources, and has none of them without all four.
  expect(exampleSource(join(repo, 'app'), true, join(repo, 'Resources'))).toBeNull()
  expect(exampleSource(join(repo, 'app'), true, join(repo, 'kernel', 'tests', 'fixtures'))).toBeNull()
  cpSync(ws, join(repo, 'Resources', 'example'), { recursive: true })
  expect(exampleSource(join(repo, 'elsewhere', 'app'), true, join(repo, 'Resources'))).toBe(join(repo, 'Resources', 'example'))
  rmSync(join(repo, 'Resources', 'example', 'hollow'), { recursive: true })
  expect(exampleSource(join(repo, 'app'), true, join(repo, 'Resources'))).toBeNull()
  expect(exampleSource(join(repo, 'elsewhere', 'app'), false)).toBeNull()

  const into = temp()
  const before = readdirSync(ws, { recursive: true }).sort()
  const copy = await copyExample(ws, into)
  expect(copy.startsWith(join(into, 'torno-example-'))).toBe(true)
  // The objects that build and show something, their files beside them, and nothing torno or Python wrote there.
  expect(readdirSync(copy).sort()).toEqual([EXAMPLE_MARKER, ...EXAMPLE_OBJECTS].sort())
  // Its marker says whose it is: the torno that made it.
  expect(JSON.parse(readFileSync(join(copy, EXAMPLE_MARKER), 'utf8'))).toMatchObject({ torno: 'example', pid: process.pid })
  expect(readdirSync(join(copy, 'gauge')).sort()).toEqual(['gauge.py', 'variant.txt'])
  expect(readFileSync(join(copy, 'hollow', 'hollow.py'), 'utf8')).toBe('# hollow\n')
  expect(readdirSync(ws, { recursive: true }).sort()).toEqual(before)
  // Each asking is a copy of its own.
  expect(await copyExample(ws, into)).not.toBe(copy)
})

it('sweeps the copies a crash left: only folders its own marker names, of a torno that is gone, and never through a link', async () => {
  const repo = temp()
  const ws = join(repo, 'ws')
  for (const name of EXAMPLE_OBJECTS) {
    mkdirSync(join(ws, name), { recursive: true })
    writeFileSync(join(ws, name, `${name}.py`), '')
  }
  const into = temp()
  const mine = await copyExample(ws, into)
  const left = await copyExample(ws, into)
  // As a torno that crashed left it: its process is gone. (No process has this pid: it is above what the kernel gives.)
  writeFileSync(join(left, EXAMPLE_MARKER), JSON.stringify({ torno: 'example', pid: 2 ** 22 + 1, at: '2026-10-09T10:00:00.000Z' }))
  // A folder that only has the name; one whose marker is not torno's; a link of that name to a folder that is someone's.
  const named = join(into, 'torno-example-notmine')
  mkdirSync(join(named, 'work'), { recursive: true })
  const other = join(into, 'torno-example-other')
  mkdirSync(other)
  writeFileSync(join(other, EXAMPLE_MARKER), '{"torno": "something else", "pid": 4194305}')
  const theirs = temp()
  writeFileSync(join(theirs, EXAMPLE_MARKER), JSON.stringify({ torno: 'example', pid: 2 ** 22 + 1 }))
  writeFileSync(join(theirs, 'kept.txt'), 'kept')
  symlinkSync(theirs, join(into, 'torno-example-link'))
  expect(await sweepExamples(into)).toEqual([left])
  expect(existsSync(left)).toBe(false)
  // The one of a torno that still runs (this process) stays, and so does everything that is not a copy of torno's own.
  expect(existsSync(mine)).toBe(true)
  expect(existsSync(join(named, 'work'))).toBe(true)
  expect(existsSync(other)).toBe(true)
  expect(readFileSync(join(theirs, 'kept.txt'), 'utf8')).toBe('kept')
  // At the end of a run its own copy goes: only a folder with the marker, never whatever a path names.
  await removeExample(mine)
  expect(existsSync(mine)).toBe(false)
  await removeExample(named)
  await removeExample(join(into, 'torno-example-link'))
  expect(existsSync(join(named, 'work'))).toBe(true)
  expect(readFileSync(join(theirs, 'kept.txt'), 'utf8')).toBe('kept')
  // A temporary folder that is not there is nothing to sweep.
  expect(await sweepExamples(join(into, 'nowhere'))).toEqual([])
})
