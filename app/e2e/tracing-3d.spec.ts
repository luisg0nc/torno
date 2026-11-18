import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { openSection } from './helpers'
import { openListed } from './objects'

// A tracing in the 3D view: the switch in the panel puts it in the model view, `scene.json` keeps it as `tracingsShown`, the layers list has a row for it that
// puts it away, and a picture for Claude draws it and says so. The window is hidden, so what the view holds is read through `__tornoTest.tracings()`, not pixels.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-tracing-3d-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const drawn = (): Promise<Array<{ id: string; outline: boolean; photo: boolean; layers: number }>> => page.evaluate(() => window.__tornoTest!.tracings())
/** The scene file as it is on the disk now; the window gives it after a moment, so a poll reads it again. */
const sceneFile = (): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'scene.json'), 'utf8'))
  } catch {
    return {}
  }
}

test('Show in 3D puts the tracing in the model view with its outline, and the scene file keeps it', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
  await page.evaluate(() => window.torno.tracings.make('bracket', { on: { main: 'XZ' }, layout: 'assembly', name: 'Front' }))
  await page.locator('.pboard-switch').getByRole('button', { name: 'Tracing', exact: true }).click()
  await expect(page.locator('.tr-panel')).toBeVisible()
  expect(await drawn()).toEqual([])

  const button = page.locator('.tr-panel').getByRole('button', { name: 'Show in 3D' })
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.tr-palette [data-tool="show3d"]')).toHaveAttribute('aria-pressed', 'true')
  // Its outline is the build's cut, asked for and drawn.
  await expect.poll(drawn, { timeout: 20_000 }).toEqual([{ id: 'T1', layout: 'assembly', outline: true, photo: false, layers: 0 }])
  await expect.poll(() => sceneFile().tracingsShown).toEqual(['T1'])
})

test('a picture for Claude draws the tracing shown and says so; it is back in the model view', async () => {
  await page.locator('.pboard-switch').getByRole('button', { name: 'Model', exact: true }).click()
  await expect(page.locator('.tr-panel')).toHaveCount(0)
  const caption = await page.evaluate(async () => (await window.__tornoTest!.look({ view: 'front', size: 128 })).caption)
  expect(caption).toContain(' · tracing T1 shown in its plane')
})

test('the layers list has a row for it, and its eye puts the tracing away', async () => {
  await openSection(page, 'Tracings')
  const row = page.locator('.layer-tracings [data-tracing="T1"]')
  await expect(row).toBeVisible()
  await expect(row).toContainText('Front')
  await row.getByRole('button', { name: 'Hide T1 in 3D' }).click()
  await expect(row).toHaveCount(0)
  await expect.poll(drawn).toEqual([])
  await expect.poll(() => sceneFile().tracingsShown).toBeUndefined()
  const caption = await page.evaluate(async () => (await window.__tornoTest!.look({ view: 'front', size: 128 })).caption)
  expect(caption).not.toContain('tracing T1')
})
