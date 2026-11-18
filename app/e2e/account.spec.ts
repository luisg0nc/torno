import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { openListed } from './objects'
import { newSession } from './helpers'

// What Claude Code says of itself (its `init`, `api_retry`) as the chat shows it. The stand-in plays a CLI whose
// plugin of skills did not load, that bills an API key, that is newer than torno was checked with, and whose API is
// being retried (FAKE_AGENT_INIT, `retry`). The window is hidden: everything is read from the DOM.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-account-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  const init = JSON.stringify({ plugins: [], apiKeySource: 'user', claude_code_version: '2.2.0' })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root, FAKE_AGENT_INIT: init } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')

test('the chat says that torno\'s skills did not load, that an API key is billed and that the CLI is a newer minor, and shows a retry while it lasts; the whole prompt is offered and restarts the session', async () => {
  await openListed(page, 'bracket')
  await newSession(dock())
  await expect(chat()).toBeVisible()
  await composer().focus()
  await page.keyboard.type('retry 2 2')
  await page.keyboard.press('Enter')
  // While the API is retried the status line says so.
  await expect(dock().locator('.session-status')).toContainText('retrying (attempt 2)')
  await expect(chat().locator('.chat-turn').first()).toBeVisible()
  await expect(dock().locator('.session-status')).not.toContainText('retrying')

  const notes = chat().locator('.chat-note')
  await expect(notes.filter({ hasText: "torno's skills did not load" }).first()).toHaveAttribute('data-tone', 'warn')
  await expect(notes.filter({ hasText: 'billed to an API key' })).toHaveAttribute('data-tone', 'quiet')
  await expect(notes.filter({ hasText: 'Claude Code 2.2.0 is newer' })).toHaveCount(1)

  // The offer; taking it ends this session and starts another on the same conversation, which expects no plugin.
  const first = await chat().getAttribute('data-session')
  await dock().getByRole('button', { name: 'Restart with the whole prompt' }).click()
  await expect(dock().getByRole('button', { name: 'Restart with the whole prompt' })).toHaveCount(0)
  await expect.poll(() => chat().getAttribute('data-session')).not.toBe(first)
  await composer().focus()
  await page.keyboard.type('argv')
  await page.keyboard.press('Enter')
  await expect(chat().locator('.chat-text').last()).toContainText('--append-system-prompt', { timeout: 20_000 })
  expect(await chat().locator('.chat-text').last().innerText()).not.toContain('--plugin-dir')
})
