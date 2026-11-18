import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'
import { fromMore, newSession } from './helpers'

// Claude Code run headless does not ask whether to trust a folder that has settings of its own. torno asks before the
// first chat in such a folder: "Start the chat" remembers the folder, "Use the terminal" starts Claude Code's own
// terminal, which asks its own question. The agent is the stand-in; the window is hidden.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let home: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-chattrust-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-chattrust-home-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // The settings of a folder that came from elsewhere: hooks and servers the chat would load unasked.
  writeFileSync(join(root, 'bracket', '.mcp.json'), '{"mcpServers":{}}')
  writeFileSync(join(root, 'hollow', '.mcp.json'), '{"mcpServers":{}}')
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it. The config (and the folders
  // the person trusted, beside it) is the test's own.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root, TORNO_CONFIG: join(home, 'config.json') } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const question = () => dock().getByRole('alertdialog', { name: 'Start the chat in this folder?' })

test('a chat in a folder with settings of its own is asked about, and starts once the person says to', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok' })
  await newSession(dock())
  await expect(question()).toBeVisible()
  await expect(question()).toContainText('This folder has Claude Code settings of its own (.mcp.json) that the chat would load without asking. Start the chat anyway?')
  // Nothing was started, and nothing was written in the folder for it.
  await expect(chat()).toHaveCount(0)
  expect(existsSync(join(root, 'bracket', '.torno', 'agent'))).toBe(false)

  await question().getByRole('button', { name: 'Start the chat' }).click()
  await expect(question()).toHaveCount(0)
  await expect(chat()).toBeVisible()
  await expect(composer()).toBeEnabled()
  // The answer is on file, beside the config and not in the workspace.
  await expect.poll(() => existsSync(join(home, 'trusted.json'))).toBe(true)
  expect(existsSync(join(root, 'bracket', '.torno', 'trusted.json'))).toBe(false)

  // Not asked again for this folder.
  await fromMore(dock(), 'End')
  await expect(dock().getByRole('status').first()).toHaveText('Ended')
  await newSession(dock())
  await expect(composer()).toBeEnabled()
  await expect(question()).toHaveCount(0)
})

test('"Use the terminal" starts Claude Code\'s own terminal in place of the chat', async () => {
  await openListed(page, 'hollow')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ objectId: 'hollow', status: 'ok' })
  await newSession(dock())
  await expect(question()).toBeVisible()
  await question().getByRole('button', { name: 'Use the terminal' }).click()
  await expect(question()).toHaveCount(0)
  await expect(dock().locator('.xterm')).toBeVisible({ timeout: 15_000 })
  await expect(chat()).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__tornoTerm!.text()), { timeout: 15_000 }).toContain('READY')
  await expect(dock().getByRole('group', { name: 'View' }).getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
})
