import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { openListed } from './objects'

// The pane with no session, for the chat: the box is there from the start, and a send starts the session and sends the
// prompt to it; with a conversation on file its last turns are shown read-only, and "Continue" resumes it or "New
// conversation" begins another. The agent is the stand-in (test/fake-agent.mjs); its `argv` command tells how it was started.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')
const CONVERSATION = '6c9664ef-90c4-4c7f-b6d5-180948ac85ee'

test.describe.configure({ mode: 'serial' })

let root: string
let home: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-startchat-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-startchat-home-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // `plain` has a conversation on file, as a session of an earlier run leaves it.
  const torno = join(root, 'plain', '.torno')
  mkdirSync(join(torno, 'chat'), { recursive: true })
  writeFileSync(join(torno, 'session.json'), JSON.stringify({ conversationId: CONVERSATION, agent: 'claude', updatedAt: new Date().toISOString() }))
  const lines = [
    { kind: 'user', id: 'u1', text: 'make the wall thicker', images: [], state: 'sent', at: 1 },
    { kind: 'tool', id: 't1', toolUseId: 'x', name: 'Bash', torno: false, input: { command: 'ls' }, state: 'done', images: [] },
    { kind: 'text', id: 'a1', text: 'The wall is 3 mm now.', streaming: false },
    { kind: 'turn', id: 'k1', ok: true, stopped: false, seconds: 4, pulled: {} }
  ]
  writeFileSync(join(torno, 'chat', `${CONVERSATION}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(''))
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const start = () => dock().locator('.chat-start')
const box = () => start().getByRole('textbox', { name: 'Message to Claude Code' })

test('with no session the box is there: Enter starts a session and sends the prompt to it; Shift+Enter breaks the line', async () => {
  await openListed(page, 'bracket')
  await expect(start()).toBeVisible()
  // Nothing was started by looking.
  await expect(chat()).toHaveCount(0)
  // No conversation here: no choice, no last turns.
  await expect(start().getByRole('group', { name: 'Conversation' })).toHaveCount(0)
  await expect(start().getByRole('region', { name: 'Last conversation' })).toHaveCount(0)
  await expect(start().getByRole('button', { name: 'Send' })).toBeDisabled()

  await box().focus()
  await page.keyboard.type('say first')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('and second')
  await expect(box()).toHaveValue('say first\nand second')
  await page.keyboard.press('Enter')

  await expect(chat()).toBeVisible()
  await expect(start()).toHaveCount(0)
  await expect(chat().locator('.chat-user').first()).toContainText('say first')
  await expect(chat().locator('.chat-turn').first()).toContainText('Done in')
})

test('with a conversation on file its last turns are shown, Continue resumes it, and a send waits for no other button', async () => {
  await openListed(page, 'plain')
  await expect(start()).toBeVisible()
  const last = start().getByRole('region', { name: 'Last conversation' })
  await expect(last.getByRole('heading')).toHaveText('Last conversation, just now')
  await expect(last).toContainText('make the wall thicker')
  await expect(last).toContainText('The wall is 3 mm now.')
  // The tools between are not shown.
  await expect(last.locator('.chat-tool')).toHaveCount(0)
  const choice = start().getByRole('group', { name: 'Conversation' })
  await expect(choice.getByRole('button', { name: 'Continue' })).toHaveAttribute('aria-pressed', 'true')
  // Looking at it started nothing and wrote nothing.
  await expect(chat()).toHaveCount(0)

  await box().fill('argv')
  await box().press('Enter')
  await expect(chat().locator('.chat-user').last()).toContainText('argv')
  await expect(chat().locator('.chat-text').last()).toContainText(`"--resume","${CONVERSATION}"`)
})

test('"New conversation" begins another conversation, not a resumed one', async () => {
  // Another object with a conversation on file.
  const torno = join(root, 'two', '.torno')
  mkdirSync(join(torno, 'chat'), { recursive: true })
  writeFileSync(join(torno, 'session.json'), JSON.stringify({ conversationId: CONVERSATION, agent: 'claude' }))
  writeFileSync(join(torno, 'chat', `${CONVERSATION}.jsonl`), `${JSON.stringify({ kind: 'text', id: 'a1', text: 'earlier answer', streaming: false })}\n`)
  await openListed(page, 'two')
  await expect(start()).toBeVisible()
  await expect(start().getByRole('region', { name: 'Last conversation' })).toContainText('earlier answer')
  await start().getByRole('group', { name: 'Conversation' }).getByRole('button', { name: 'New conversation' }).click()
  await box().fill('argv')
  await box().press('Enter')
  await expect(chat().locator('.chat-text').last()).toContainText('--session-id')
  expect(await chat().locator('.chat-text').last().innerText()).not.toContain('--resume')
})

test('"New session" starts with no prompt and keeps what was written in the box of the chat, unsent', async () => {
  await openListed(page, 'gauge')
  await expect(start()).toBeVisible()
  await box().fill('half a thought')
  await start().getByRole('button', { name: 'New session' }).click()
  await expect(chat()).toBeVisible()
  await expect(dock().locator('[data-chat-composer]')).toHaveValue('half a thought')
  await expect(chat().locator('.chat-user')).toHaveCount(0)
})
