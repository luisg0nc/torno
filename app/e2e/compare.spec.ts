import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { HistoryEntry } from '../src/shared/history'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'
import { openStrip } from './helpers'

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
  const seen: string[] = []
  const t0 = Date.now()
  try {
  await expect.poll(async () => { const s = await state(); return s.build?.status === 'ok' && s.build.revision }, { timeout: 30_000 }).toBe(revision)
  } catch (e) {
    const s = await state().catch(() => null)
    throw new Error(`DIAG build=${JSON.stringify(s?.build)} compare=${JSON.stringify(s?.compare)} sceneRev=${s?.revision} after ${Date.now() - t0} ms; ${String(e).slice(0, 80)}`)
  }
}

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-compare-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
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
  // No corner boxes: what the later build changed is in the band's list, from its line, with how the checks and the dimensions moved.
  await expect(page.locator('.compare-box')).toHaveCount(0)
  const more = bar().getByRole('button', { name: 'What changed', exact: true })
  await more.click()
  await expect(page.locator('[data-part="compare-changed"]')).toContainText('tub, lid changed')
  await expect(page.locator('[data-part="compare-moved"]')).toBeVisible()
  await more.click()
  await expect(page.locator('[data-part="compare-changed"]')).toHaveCount(0)

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

test('what a turn changed is written on the parts as tags with leaders, four at most, and the rest are in the band\'s list', async () => {
  const [from, to] = kept().map((e) => e.id)
  const dim = { id: 'M3', now: 'pass' as const }
  const part = (name: string, before: number, after: number) => ({ id: `assembly:${name}`, name, layout: 'assembly', volume: { before, after, exact: true }, faces: { before: 6, after: 6 } })
  // The tub and the lid are in the build on show; the three after them are not (a part of an earlier build), so their tags are in the list.
  const changes = { files: [], added: [], sketched: [], resketched: [], resolved: [], dimensions: [dim], parts: [part('tub', 28400, 26000), part('lid', 4000, 3000), part('ghost1', 100, 600), part('ghost2', 100, 500), part('ghost3', 100, 400)] }
  await page.evaluate(([a, b, c]) => window.__tornoTest!.compare(a as string, b as string, 14, c as never), [from, to, changes] as const)
  await expect(bar()).toBeVisible()
  // The dimension M3 is no mark here, and ghost1 to ghost3 are no parts: only the tub and the lid stand on a part.
  const tag = (subject: string) => page.locator(`.viewport-pane [data-tag="change-${subject}"]`)
  await expect(tag('assembly:tub')).toContainText('tub volume 28400 → 26000 mm³')
  await expect(tag('assembly:lid')).toContainText('lid volume 4000 → 3000 mm³')
  await expect(page.locator('.viewport-pane [data-tag^="change-"]')).toHaveCount(2)
  await expect(page.locator('svg.leader-layer [data-leader="change-assembly:tub"]')).toHaveCount(1)
  await expect(page.locator('svg.leader-layer [data-leader="change-assembly:lid"]')).toHaveCount(1)
  // The band says how many are not on a part: M3 and ghost1 had tags and no place to stand, ghost2 and ghost3 were cut after the four.
  const more = bar().getByRole('button', { name: /^and \d+ more$/ })
  await expect(more).toHaveText('and 4 more')
  await more.click()
  await expect(page.locator('[data-part="compare-rest"]')).toContainText('M3 now passes')
  await expect(page.locator('[data-part="compare-rest"]')).toContainText('ghost3 volume 100 → 400 mm³')
  await more.click()
  // Side by side is no one's frame: no tags are written on it, and all are in the list.
  await bar().getByRole('button', { name: 'Side by side', exact: true }).click()
  await expect(page.locator('.viewport-pane [data-tag^="change-"]')).toHaveCount(0)
  await expect(page.locator('svg.leader-layer [data-leader^="change-"]')).toHaveCount(0)
  await bar().getByRole('button', { name: 'Back to live', exact: true }).click()
  await expect(page.locator('.viewport-pane [data-tag^="change-"]')).toHaveCount(0)
})

test('a node of the builds strip compares with the live build from its menu, "Stop comparing" ends it, and a double click compares too', async () => {
  await openStrip(page)
  const strip = page.locator('[data-region="session"] .strip')
  const nodes = strip.locator('.strip-node[data-kind="built"]')
  await expect.poll(() => nodes.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(3)
  const live = (await strip.locator('.strip-node[data-on-show]').getAttribute('data-build'))!
  const from = (await nodes.first().getAttribute('data-build'))!

  await nodes.first().click()
  await page.getByRole('menuitem', { name: 'Compare with live' }).click()
  await expect(page.getByRole('menu', { name: `Build ${from}` })).toHaveCount(0)
  await expect.poll(async () => (await state()).compare).toMatchObject({ from, to: live, mode: 'overlay' })
  await expect(bar()).toBeVisible()

  // The same node says "Stop comparing"; the build on show has nothing to compare with.
  await nodes.first().click()
  await page.getByRole('menuitem', { name: 'Stop comparing' }).click()
  await expect.poll(async () => (await state()).compare).toBeNull()
  await strip.locator('.strip-node[data-on-show]').click()
  await expect(page.getByRole('menuitem', { name: 'Star', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Compare with live' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // A double click compares, and leaves no menu open.
  const second = (await nodes.nth(1).getAttribute('data-build'))!
  await nodes.nth(1).dblclick()
  await expect.poll(async () => (await state()).compare).toMatchObject({ from: second, to: live })
  await expect(page.getByRole('menu')).toHaveCount(0)
  await bar().getByRole('button', { name: 'Back to live', exact: true }).click()
})

test('after a restart with the sources as they were, the build on show is a node of the strip, and its menu and a double click compare with it (#234)', async () => {
  const before = kept().length
  await app.close()
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
  await openListed(page, 'hollow')
  await builtRevision(1)
  await openStrip(page)

  // The sources are those of the newest kept build: nothing new is kept, and that build is the one on show.
  const strip = page.locator('[data-region="session"] .strip')
  const nodes = strip.locator('.strip-node[data-kind="built"]')
  await expect.poll(() => nodes.count(), { timeout: 15_000 }).toBe(before)
  await expect(strip.locator('.strip-node[data-on-show]')).toHaveCount(1)
  const live = (await strip.locator('.strip-node[data-on-show]').getAttribute('data-build'))!
  expect(live).toBe(kept().at(-1)!.id)

  const from = (await nodes.first().getAttribute('data-build'))!
  await nodes.first().click()
  await page.getByRole('menuitem', { name: 'Compare with live' }).click()
  await expect.poll(async () => (await state()).compare).toMatchObject({ from, to: live })
  await expect(bar()).toBeVisible()
  await bar().getByRole('button', { name: 'Back to live', exact: true }).click()

  const second = (await nodes.nth(1).getAttribute('data-build'))!
  await nodes.nth(1).dblclick()
  await expect.poll(async () => (await state()).compare).toMatchObject({ from: second, to: live })
  await bar().getByRole('button', { name: 'Back to live', exact: true }).click()
})
