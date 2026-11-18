import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { openListed } from './objects'
import { newSession } from './helpers'

// A chat whose first turn could not authenticate (#117), as Claude Code's headless mode would under `--bare`: the
// stand-in (FAKE_AGENT_AUTH_ERROR) answers its first prompt with the typed `authentication_failed`. The chat says it
// could not use the login and offers the terminal, which the button switches the object to, resuming the same
// conversation there. The window is hidden: everything is read from the DOM.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-login-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root, FAKE_AGENT_AUTH_ERROR: 'Not logged in · Please run /login' } })
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
const views = () => dock().getByRole('group', { name: 'View' })
const onDisk = (object: string): unknown => existsSync(join(root, object, '.torno', 'agent.json')) && JSON.parse(readFileSync(join(root, object, '.torno', 'agent.json'), 'utf8'))

test('a first turn that could not authenticate says the chat could not use the login, and the offer runs the object in the terminal', async () => {
  await openListed(page, 'bracket')
  await newSession(dock())
  await expect(chat()).toBeVisible()
  await composer().focus()
  await page.keyboard.type('say hello')
  await page.keyboard.press('Enter')

  // What the CLI said, then the note, in the warn tone, with its button; the turn failed and the session is idle.
  await expect(chat().locator('.chat-text').first()).toContainText('Not logged in · Please run /login')
  const note = chat().locator('.chat-offer')
  await expect(note).toHaveCount(1)
  await expect(note).toHaveAttribute('data-tone', 'warn')
  await expect(note).toContainText("Claude Code's chat could not use your login")
  await expect(dock().locator('.session-status')).toHaveAttribute('data-status', 'idle')
  await expect(views().getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')

  // Taken while the agent works, it is asked about first, as a view picked is; and while asked it cannot be pressed again.
  const offer = note.getByRole('button', { name: 'Use the terminal' })
  await composer().focus()
  await page.keyboard.type('work 30')
  await page.keyboard.press('Enter')
  await expect(dock().locator('.session-status')).toHaveAttribute('data-status', 'working')
  await offer.click()
  const asked = dock().getByRole('alertdialog', { name: 'End the running session?' })
  await expect(asked).toBeVisible()
  await expect(offer).toBeDisabled()
  await expect(views().getByRole('button', { name: 'Terminal' })).toBeDisabled()

  // The offer: the chat ends, the view is the terminal in `agent.json`, and the conversation goes on there.
  await asked.getByRole('button', { name: 'End it and go on in the terminal' }).click()
  await expect(views().getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => onDisk('bracket')).toEqual({ agent: 'claude', view: 'terminal' })
  await expect(chat()).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__tornoTerm!.text()), { timeout: 15_000 }).toContain('READY')
  expect(await page.evaluate(() => window.__tornoTerm!.text())).toContain('--resume')
})
