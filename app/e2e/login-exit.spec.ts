import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { openListed } from './objects'
import { newSession } from './helpers'

// A CLI that gives up after a turn that could not authenticate (#117): the stand-in exits 1 after it
// (FAKE_AGENT_AUTH_ERROR, FAKE_AGENT_AUTH_EXIT). The chat has ended, and its offer still brings up the terminal: the
// view is written and a terminal session resumes the conversation, also when the view was already the terminal. The
// window is hidden: everything is read from the DOM.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-login-exit-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  const env = { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root, FAKE_AGENT_AUTH_ERROR: 'Not logged in · Please run /login', FAKE_AGENT_AUTH_EXIT: '1' }
  app = await electron.launch({ args: ['.'], cwd: appDir, env })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
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
const term = (): Promise<string> => page.evaluate(() => window.__tornoTerm!.text())

/** A chat in `object` whose first turn could not authenticate, after which the CLI left: the ended chat and its note. */
async function failedChat(object: string) {
  await openListed(page, object)
  await newSession(dock())
  await expect(chat()).toBeVisible()
  await composer().focus()
  await page.keyboard.type('say hello')
  await page.keyboard.press('Enter')
  const note = chat().locator('.chat-offer')
  await expect(note).toContainText("Claude Code's chat could not use your login")
  await expect(dock().locator('.session-status')).toHaveAttribute('data-status', 'exited')
  await expect(chat().locator('.chat-note').filter({ hasText: 'Claude Code stopped (exit code 1)' })).toHaveCount(1)
  return note
}

test('the offer of an ended chat writes the terminal view and starts a terminal session that resumes the conversation', async () => {
  const note = await failedChat('bracket')
  await note.getByRole('button', { name: 'Use the terminal' }).click()
  await expect.poll(() => onDisk('bracket')).toEqual({ agent: 'claude', view: 'terminal' })
  await expect(chat()).toHaveCount(0)
  await expect(views().getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(term, { timeout: 15_000 }).toContain('READY')
  expect(await term()).toContain('--resume')
})

test('when the view is already the terminal and the ended chat is still shown, the offer brings the terminal up', async () => {
  const note = await failedChat('hollow')
  // Picked with no session running, the view only changes what the next session runs: the ended chat stays shown.
  await views().getByRole('button', { name: 'Terminal' }).click()
  await expect.poll(() => onDisk('hollow')).toEqual({ agent: 'claude', view: 'terminal' })
  await expect(chat()).toBeVisible()
  await note.getByRole('button', { name: 'Use the terminal' }).click()
  await expect(chat()).toHaveCount(0)
  await expect.poll(term, { timeout: 15_000 }).toContain('READY')
  expect(await term()).toContain('--resume')
})
