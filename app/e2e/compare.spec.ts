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
const bar = () => page.locator('[data-band="compare"]')

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

test('comparing shows the bar and the line, survives a build landing, and Back to live ends it', async () => {
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
  await expect(bar()).toContainText(`Comparing ${from} with live ${to}`)
  // The switch of Board and Model steps aside for the band.
  await expect(page.locator('.pboard-switch')).toHaveCount(0)
  for (const name of ['Before', 'Overlay', 'After', 'Side by side', 'Back to live']) await expect(bar().getByRole('button', { name, exact: true })).toBeVisible()
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

  await bar().getByRole('button', { name: 'Back to live', exact: true }).click()
  await expect(bar()).toHaveCount(0)
  await expect(page.locator('.pboard-switch')).toBeVisible()
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
  await bar().getByRole('button', { name: 'Back to live', exact: true }).click()
  await expect(page.locator('[data-part="compare-refused"]')).toHaveCount(0)
})

test('a later build that is not the live one stands in for it for the whole comparing, and the live build is back after', async () => {
  const source = readFileSync(model(), 'utf8').replace('wall: float = 4', 'wall: float = 2')
  const withPin = source.replace('return {"tub": tub, "lid": lid}', 'return {"tub": tub, "lid": lid, "pin": Pos(0, 0, 50) * Cylinder(1, 5)}')
  expect(withPin).not.toBe(source)
  const revision = (await state()).build!.revision
  writeFileSync(model(), withPin)
  await builtRevision(revision + 1)
  writeFileSync(model(), source)
  await builtRevision(revision + 2)
  await expect.poll(() => kept().length).toBeGreaterThanOrEqual(5)
  const all = kept()
  const [from, pinned, live] = [all[0].id, all[all.length - 2].id, all[all.length - 1].id]
  const parts = () => page.evaluate(() => (window.__tornoTest!.state().scene?.parts ?? []).map((p) => p.key))
  expect(await parts()).toEqual(['assembly:tub', 'assembly:lid'])

  // The build with the pin is compared while the build after it is live: it is drawn in the live one's place, with the pin it alone has.
  await page.evaluate(([a, b]) => window.__tornoTest!.compare(a, b, 3), [from, pinned])
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.later())).toEqual(['assembly:tub', 'assembly:lid', 'assembly:pin'])
  expect(await earlier()).toEqual(['assembly:tub', 'assembly:lid'])
  await bar().getByRole('button', { name: 'After', exact: true }).click()
  expect(await page.evaluate(() => window.__tornoTest!.later())).toContain('assembly:pin')
  // A live build that lands meanwhile changes the live model unseen: the stand-in stays, and so does the comparing.
  writeFileSync(model(), source.replace('wall: float = 2', 'wall: float = 3'))
  await builtRevision(revision + 3)
  expect(await page.evaluate(() => window.__tornoTest!.later())).toContain('assembly:pin')
  expect((await state()).compare).toMatchObject({ from, to: pinned, mode: 'after' })
  expect(await parts()).toEqual(['assembly:tub', 'assembly:lid'])

  await bar().getByRole('button', { name: 'Back to live', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.later())).toEqual([])
  expect(await earlier()).toEqual([])
  expect((await state()).build?.revision).toBe(revision + 3)

  // The later build that is the live one is drawn as it is: nothing stands in for it.
  const newest = kept().at(-1)!.id
  expect(newest).not.toBe(live)
  await page.evaluate(([a, b]) => window.__tornoTest!.compare(a, b), [from, newest])
  await expect.poll(earlier).toEqual(['assembly:tub', 'assembly:lid'])
  expect(await page.evaluate(() => window.__tornoTest!.later())).toEqual([])
  await bar().getByRole('button', { name: 'Back to live', exact: true }).click()
})
