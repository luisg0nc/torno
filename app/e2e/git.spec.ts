import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'

// What git says of a project, on the card and in the status line, and what a build is made from. A workspace that is a
// git work tree with one file changed since the commit. torno only reads git: the index is as it was at the end.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page
let indexBefore: { mtimeMs: number; size: number; ino: number }

const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' })
const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const card = (id: string) => page.locator(`.card[data-object="${id}"]`)

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-git-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'the fixtures')
  // One model changed since the commit.
  writeFileSync(join(root, 'hollow', 'hollow.py'), `${readFileSync(join(root, 'hollow', 'hollow.py'), 'utf8')}\n# edited\n`)
  indexBefore = statSync(join(root, '.git', 'index'))
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

test('the card says what changed since the last commit, and the page writes nothing', async () => {
  await expect(card('hollow').locator('[data-part="git"]')).toHaveText(/^1 file changed since [0-9a-f]{7}$/)
  await expect(card('hollow').locator('[data-part="git"]')).toHaveAttribute('title', 'hollow/hollow.py')
  await expect(card('bracket').locator('[data-part="git"]')).toHaveText(/^No changes since [0-9a-f]{7}$/)
  // Asking git for the cards left the folder as it was.
  expect(existsSync(join(root, 'hollow', '.torno'))).toBe(false)
})

test('the status line says it for the open project, and a build is recorded with what it was made from', async () => {
  await card('hollow').click()
  await expect.poll(async () => (await state()).build?.status).toBe('ok')
  const line = page.locator('.status [data-part="git"]')
  await expect(line).toHaveText(/^1 file changed since [0-9a-f]{7}$/)
  const head = git('rev-parse', '--short=7', 'HEAD').trim()
  await expect(line).toContainText(head)
  // The record of the build: ignored by git, and with the commit and the dirty flag.
  const file = join(root, 'hollow', '.torno', 'builds.jsonl')
  await expect.poll(() => existsSync(file)).toBe(true)
  const record = JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0])
  expect(record).toMatchObject({ revision: 1, head, dirty: true })
  expect(record.sources).toMatch(/^[0-9a-f]{12}$/)
  expect(readFileSync(join(root, 'hollow', '.torno', '.gitignore'), 'utf8').split('\n')).toContain('builds.jsonl')
  expect(git('check-ignore', 'hollow/.torno/builds.jsonl').trim()).toBe('hollow/.torno/builds.jsonl')
})

test('torno never wrote the index', async () => {
  const after = statSync(join(root, '.git', 'index'))
  expect({ mtimeMs: after.mtimeMs, size: after.size, ino: after.ino }).toEqual({ mtimeMs: indexBefore.mtimeMs, size: indexBefore.size, ino: indexBefore.ino })
})
