import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { newSession as fromDock } from './helpers'
import { openListed } from './objects'

// The header of the dock names the model of the session whole: a real id (`claude-opus-5-5`) is not cut at the width the dock has
// by default. The agent is the stand-in, which says it runs that model. The window is hidden: sizes are read from the DOM.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')
const MODEL = 'claude-opus-5-5'

let root: string
let home: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-dockhead-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-dockhead-home-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, FAKE_AGENT_INIT: JSON.stringify({ model: MODEL }), TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

test('the dock header shows the whole model id at the default width, and the button is named by it', async () => {
  test.setTimeout(90_000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
  await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1440, 900])
  await openListed(page, 'bracket')
  const dock = page.locator('[data-region="session"]')
  await fromDock(dock)
  // The CLI says which model it runs with its first answer.
  const box = dock.locator('[data-chat-composer]')
  await box.focus()
  await page.keyboard.type('say hello')
  await page.keyboard.press('Enter')
  await expect(dock.locator('.chat-turn')).toHaveCount(1, { timeout: 30_000 })
  // The button's name is the whole id, and it says it as `opus-5-5` (the header's room is short).
  const button = dock.getByRole('button', { name: new RegExp(`^${MODEL}$`) })
  await expect(button).toBeVisible({ timeout: 30_000 })
  // Not clipped: what the button holds fits in it; and the dock is at its default width.
  const sizes = await button.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    head: [...el.closest('header')!.children].map((c) => `${c.className.toString().split(' ')[0]}:${Math.round(c.getBoundingClientRect().width)}`).join(' ')
  }))
  expect(sizes.scroll, sizes.head).toBeLessThanOrEqual(sizes.client)
  await expect(button.locator('.session-model-id')).toHaveText('opus-5-5')
  // Nor is the state (a dot and a word) squeezed to nothing by it.
  const status = dock.locator('.session-status')
  const said = await status.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, box: el.parentElement!.getBoundingClientRect().width }))
  expect(said.scroll, JSON.stringify(said)).toBeLessThanOrEqual(said.client)
  expect(said.box + 1).toBeGreaterThanOrEqual(said.scroll)
  expect((await dock.boundingBox())!.width).toBeGreaterThanOrEqual(384)
})
