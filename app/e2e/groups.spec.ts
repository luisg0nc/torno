import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'

// The model's groups of parts (groups(p)) in the layers list: a header each, which folds, hides or shows its
// parts, or shows only them; the fold is kept in scene.json. A model without groups draws the list as before.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-groups-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const rows = () => page.locator('.layers li').evaluateAll((items) => items.map((li) => li.getAttribute('data-group') ? `group ${li.getAttribute('data-group')}` : `${li.getAttribute('data-in-group') ? '  ' : ''}${li.getAttribute('data-layer')}`))
const visible = async (): Promise<string[]> => {
  const s = await state()
  return s.scene!.parts.filter((p) => p.layout === s.layout && s.layers[p.name]?.visible !== false).map((p) => p.name)
}

async function open(name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
  await expect.poll(async () => { const s = await state(); return s.objectId === name && s.build?.status }, { timeout: 30_000 }).toBe('ok')
}

test('the groups head the list, their parts under them, the parts in no group after', async () => {
  await open('grouped')
  await expect.poll(rows).toEqual(['group flat', '  flat-a', '  flat-b', 'group tall', '  tall-a', 'key'])
  await expect(page.locator('[data-group="flat"] .layer-count')).toHaveText('2 parts')
  await expect(page.locator('[data-group="tall"] .layer-count')).toHaveText('1 part')
})

test('the eye of a group hides and shows its parts, and says when some are shown', async () => {
  const eye = page.locator('[data-group="flat"] .layer-group-eye')
  await expect(eye).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Hide flat', exact: true }).click()
  await expect(page.locator('[data-layer="flat-a"]')).toHaveAttribute('data-hidden', '')
  await expect(page.locator('[data-layer="flat-b"]')).toHaveAttribute('data-hidden', '')
  await expect(eye).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Show flat-a', exact: true }).click()
  await expect(eye).toHaveAttribute('aria-pressed', 'mixed')
  await page.getByRole('button', { name: 'Hide flat', exact: true }).click()
  await page.getByRole('button', { name: 'Show flat', exact: true }).click()
  await expect(eye).toHaveAttribute('aria-pressed', 'true')
  expect(await visible()).toEqual(['flat-a', 'flat-b', 'tall-a', 'key'])
})

test('"Show only" leaves that group alone on screen', async () => {
  await page.locator('[data-group="tall"]').hover()
  await page.getByRole('button', { name: 'Show only tall', exact: true }).click()
  await expect.poll(visible).toEqual(['tall-a'])
  await page.locator('[data-group="flat"]').hover()
  await page.getByRole('button', { name: 'Show only flat', exact: true }).click()
  await expect.poll(visible).toEqual(['flat-a', 'flat-b'])
})

test('a group folds, and is still folded when the object is opened again', async () => {
  await page.getByRole('button', { name: 'Fold flat', exact: true }).click()
  await expect.poll(rows).toEqual(['group flat', 'group tall', '  tall-a', 'key'])
  await expect(page.getByRole('button', { name: 'Unfold flat', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => { try { return JSON.parse(readFileSync(join(root, 'grouped', '.torno', 'scene.json'), 'utf8')).folded } catch { return undefined } }).toEqual(['flat'])
  await open('bracket')
  await open('grouped')
  await expect.poll(rows).toEqual(['group flat', 'group tall', '  tall-a', 'key'])
})

test('a model without groups has the list as it was', async () => {
  await open('bracket')
  await expect(page.locator('.layer-group')).toHaveCount(0)
  await expect.poll(rows).toEqual(['base', 'post'])
  await expect(page.locator('[data-in-group]')).toHaveCount(0)
})
