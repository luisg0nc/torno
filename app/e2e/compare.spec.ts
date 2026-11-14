import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { HistoryEntry } from '../src/shared/history'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'

// Two kept builds compared in the view: the bar, the line in the status line, the way back, and a live build that lands
// meanwhile. The comparing is started by the test hook that does what a turn of the chat does (`actions.compare`).
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

const model = () => join(root, 'hollow', 'hollow.py')
const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const kept = (): HistoryEntry[] => JSON.parse(readFileSync(join(root, 'hollow', '.torno', 'history', 'index.json'), 'utf8')).entries
const earlier = () => page.evaluate(() => window.__tornoTest!.earlier())
const bar = () => page.locator('[data-part="compare"].comparebar')

async function builtRevision(revision: number): Promise<void> {
  await expect.poll(async () => { const s = await state(); return s.build?.status === 'ok' && s.build.revision }, { timeout: 30_000 }).toBe(revision)
}

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-compare-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

test('comparing shows the bar and the line, survives a build landing, and Back to the live build ends it', async () => {
  await openListed(page, 'hollow')
  await builtRevision(1)
  const source = readFileSync(model(), 'utf8')
  writeFileSync(model(), source.replace('wall: float = 2', 'wall: float = 3'))
  await builtRevision(2)
  await expect.poll(() => kept().length).toBe(2)
  const [from, to] = kept().map((e) => e.id)
  const before = readFileSync(model(), 'utf8')

  await expect(bar()).toHaveCount(0)
  await page.evaluate(([a, b]) => window.__tornoTest!.compare(a, b, 14), [from, to])
  await expect(bar()).toBeVisible()
  for (const name of ['Before', 'Overlay', 'After', 'Side by side', 'Back to the live build']) await expect(bar().getByRole('button', { name, exact: true })).toBeVisible()
  await expect(bar().getByRole('button', { name: 'Overlay', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.status-compare')).toHaveText(`comparing prompt 14 · ${from} → ${to}`)
  await expect.poll(earlier).toEqual(['assembly:tub', 'assembly:lid'])
  // The boxes say what the later build changed, from its line.
  await expect(page.locator('[data-part="compare-changed"]')).toContainText('tub, lid changed')
  await expect(page.locator('[data-part="compare-moved"]')).toBeVisible()

  await bar().getByRole('button', { name: 'Side by side', exact: true }).click()
  await expect(bar().getByRole('button', { name: 'Side by side', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect((await state()).compare?.mode).toBe('side')
  // Nothing in a split view is pointed at.
  expect(await page.evaluate(() => window.__tornoTest!.pickAt(0.75, 0.5))).toBeNull()

  // A live build lands meanwhile: the comparing goes on, with the earlier build still drawn.
  writeFileSync(model(), source.replace('wall: float = 2', 'wall: float = 4'))
  await builtRevision(3)
  expect((await state()).compare).toMatchObject({ from, to, mode: 'side', prompt: 14 })
  await expect(bar()).toBeVisible()
  await expect(page.locator('.status-compare')).toContainText(`${from} → ${to}`)
  expect(await earlier()).toEqual(['assembly:tub', 'assembly:lid'])

  await bar().getByRole('button', { name: 'Back to the live build', exact: true }).click()
  await expect(bar()).toHaveCount(0)
  await expect(page.locator('.status-compare')).toHaveCount(0)
  expect(await earlier()).toEqual([])
  expect((await state()).compare).toBeNull()
  // Looking changed no file and no build.
  expect(readFileSync(model(), 'utf8')).not.toBe(before)
  expect((await state()).build?.revision).toBe(3)
})

test('Esc ends it, and a build that is not kept says why in the view instead of drawing nothing', async () => {
  const [from, to] = kept().map((e) => e.id)
  await page.evaluate(([a, b]) => window.__tornoTest!.compare(a, b), [from, to])
  await expect(bar()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(bar()).toHaveCount(0)
  expect(await earlier()).toEqual([])

  await page.evaluate((b) => window.__tornoTest!.compare('h9999', b), to)
  await expect(page.locator('[data-part="compare-refused"]')).toContainText('h9999 is not in the history')
  await expect(bar()).toBeVisible()
  expect(await earlier()).toEqual([])
  await bar().getByRole('button', { name: 'Back to the live build', exact: true }).click()
  await expect(page.locator('[data-part="compare-refused"]')).toHaveCount(0)
})
