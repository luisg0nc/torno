import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { Mark, MarksFile, PinMark } from '../src/shared/marks'
import { openListed } from './objects'

// Marks from the window to the file and back: the bridge, the store in main
// that owns <object>/.torno/marks.json, and the renderer's copy of the list.
// Nothing is drawn yet, so marks are added through window.torno.marks.
//
// The window is hidden: state is read through window.__tornoTest.state().
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page
let before: Record<string, string>

test.beforeAll(async () => {
  // A copy: marks are written into the object's folder.
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-marks-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({
    args: ['.'],
    cwd: appDir,
    env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root }
  })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const marksPath = (): string => join(root, 'bracket', '.torno', 'marks.json')
const marksOnDisk = (): MarksFile => JSON.parse(readFileSync(marksPath(), 'utf8'))

/** Every file of the bracket outside .torno/, with its contents. */
function bracketFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (prefix === '' && name === '.torno') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`)
      else files[`${prefix}${name}`] = readFileSync(path, 'base64')
    }
  }
  walk(join(root, 'bracket'), '')
  return files
}

async function openBracket(): Promise<void> {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
}

/** What a call through the bridge rejected with, or null when it did not. */
function rejection(call: 'unknownObject' | 'unknownMark' | 'notAMark'): Promise<string | null> {
  return page.evaluate(async (which) => {
    const calls = {
      unknownObject: () => window.torno.marks.list('ghost'),
      unknownMark: () => window.torno.marks.update('bracket', 'M9', { note: 'x' }),
      notAMark: () => window.torno.marks.add('bracket', { kind: 'dimension' } as never)
    }
    return calls[which]().then(
      () => null,
      (e: Error) => e.message
    )
  }, call)
}

test('an object opens with no marks, and no marks file is made for it', async () => {
  await openBracket()
  before = bracketFiles()
  expect(Object.keys(before)).toContain('bracket.py')
  expect((await state()).marks).toEqual([])
  expect((await state()).marksProblem).toBeNull()
  expect(await page.evaluate(() => window.torno.marks.list('bracket'))).toEqual([])
  expect(() => statSync(marksPath())).toThrow()
})

test('a pin added through the bridge is M1, in the window and in .torno/marks.json', async () => {
  const added = await page.evaluate(() =>
    window.torno.marks.add('bracket', {
      kind: 'pin',
      author: 'user',
      note: 'too thin here',
      layout: 'assembly',
      revision: 1,
      camera: window.__tornoTest!.camera(),
      // On the top of the base, clear of the post; the face number is a guess, as one from an older build would be.
      anchor: { point: [14, 9, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F999' }
    })
  )
  expect(added).toMatchObject({ id: 'M1', kind: 'pin', author: 'user', note: 'too thin here', status: 'draft', anchorState: 'ok' })
  expect(Number.isNaN(Date.parse(added.createdAt))).toBe(false)

  // The window is told, not asked: its list follows main's. Main has checked the new mark against
  // the build there is, so it names the face that is at its point, says what that is, and which build that was.
  const checked = { ...added, checkedRevision: 1, anchor: { ...(added as PinMark).anchor, ref: expect.stringMatching(/^base\/F\d$/), descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' } }
  await expect.poll(async () => (await state()).marks).toEqual([checked])
  expect(marksOnDisk()).toEqual({ next: 2, marks: (await state()).marks })
  // Beside it (a write in flight leaves its `.tmp` for a moment) only the state file, which follows the build and the marks by a second, and the picture of the object's card with what goes with it.
  expect(readdirSync(join(root, 'bracket', '.torno')).filter((name) => !name.endsWith('.tmp') && !['state.md', 'thumb.png', 'thumb.json', 'builds.jsonl', 'history', 'board', '.gitignore'].includes(name))).toEqual(['marks.json'])
})

test('a change made through the bridge reaches the window and the file', async () => {
  const updated = await page.evaluate(() => window.torno.marks.update('bracket', 'M1', { note: 'thicker: 4 mm' }))
  expect(updated).toMatchObject({ id: 'M1', note: 'thicker: 4 mm', status: 'draft' })
  await expect.poll(async () => (await state()).marks.map((m: Mark) => m.note)).toEqual(['thicker: 4 mm'])
  expect(marksOnDisk().marks).toEqual([updated])
})

test('what cannot be done is refused in plain words, and changes nothing', async () => {
  expect(await rejection('unknownObject')).toBe('no project named ghost in the open workspace')
  expect(await rejection('unknownMark')).toBe('no mark M9; marks: M1')
  expect(await rejection('notAMark')).toMatch(/^that is not a mark/)
  expect(marksOnDisk().next).toBe(2)
  expect((await state()).marks.map((m: Mark) => m.id)).toEqual(['M1'])
})

test('a mark made in the window is the person\'s, whatever it says of its author', async () => {
  const forged = await page.evaluate(async () => {
    const [first] = await window.torno.marks.list('bracket')
    const added = await window.torno.marks.add('bracket', { ...first, author: 'agent', note: 'not the agent' } as never)
    await window.torno.marks.remove('bracket', added.id)
    return added
  })
  expect(forged).toMatchObject({ id: 'M2', author: 'user', note: 'not the agent' })
  await expect.poll(async () => (await state()).marks.map((m: Mark) => m.id)).toEqual(['M1'])
  expect(marksOnDisk()).toMatchObject({ next: 3, marks: [{ id: 'M1', author: 'user' }] })
})

// geometry.describe and session.insert are backed now: e2e/pick.spec.ts.
test('what the bridge declares for later tasks is there, and does nothing yet', async () => {
  const sorts = await page.evaluate(() => {
    const offShow = window.torno.view.onShow(() => {})
    const offHighlight = window.torno.view.onHighlight(() => {})
    const inserted = window.torno.session.insert('no-session', 'text')
    return [typeof offShow, offShow(), typeof offHighlight, offHighlight(), inserted].map((v) => String(v))
  })
  expect(sorts).toEqual(['function', 'undefined', 'function', 'undefined', 'undefined'])
})

test('the mark is still there after the window is reloaded', async () => {
  const kept = marksOnDisk().marks
  await page.reload()
  await page.waitForSelector('[data-region="left"]')
  expect((await state()).objectId).toBeNull()
  await openBracket()
  await expect.poll(async () => (await state()).marks).toEqual(kept)
  expect((await state()).marksProblem).toBeNull()
  // And the next mark takes no id that was given out, not even that of the mark removed since.
  const second = await page.evaluate(
    (first) => window.torno.marks.add('bracket', { ...first, note: 'and here' } as never),
    kept[0]
  )
  expect(second.id).toBe('M3')
  await expect.poll(async () => (await state()).marks.map((m: Mark) => m.id)).toEqual(['M1', 'M3'])
})

test('nothing else in the object folder changed', async () => {
  expect(bracketFiles()).toEqual(before)
  // Beside it (a write in flight leaves its `.tmp` for a moment) only the state file, which follows the build and the marks by a second, and the picture of the object's card with what goes with it.
  expect(readdirSync(join(root, 'bracket', '.torno')).filter((name) => !name.endsWith('.tmp') && !['state.md', 'thumb.png', 'thumb.json', 'builds.jsonl', 'history', 'board', '.gitignore'].includes(name))).toEqual(['marks.json'])
  // The marks file did not set off a build: the bracket is still at its first.
  expect((await state()).build).toMatchObject({ status: 'ok', revision: 1, stale: false })
})
