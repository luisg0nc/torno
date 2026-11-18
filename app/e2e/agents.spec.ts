import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { openListed, projectCrumb, projectMenu, switcher } from './objects'
import { fromMore, newSession } from './helpers'

// The agent of an object: Claude Code, the one torno runs, and what is said of an `.torno/agent.json` that names
// another (one an older torno ran, or one torno does not know). The agent is the stand-in (test/fake-agent.mjs,
// named by TORNO_AGENT_CMD); no test here runs `claude`.
//
// Every test works in an object of its own, starts what it needs there and ends it afterwards: each can be run
// alone, and one that fails leaves the others theirs.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-agents-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // As the torno that also ran Copilot CLI left it: that agent chosen, in its terminal.
  mkdirSync(join(root, 'hollow', '.torno'), { recursive: true })
  writeFileSync(join(root, 'hollow', '.torno', 'agent.json'), '{"agent":"copilot","view":"terminal"}')
  // An agent torno never had, as a later torno might write.
  mkdirSync(join(root, 'gauge', '.torno'), { recursive: true })
  writeFileSync(join(root, 'gauge', '.torno', 'agent.json'), '{"agent":"gemini"}')
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const term = (): Promise<string> => page.evaluate(() => window.__tornoTerm!.text())
const dock = () => page.locator('[data-region="session"]')
const note = () => dock().locator('.session-note')
const status = () => page.locator('.session-status')
const onDisk = (object: string): unknown => existsSync(join(root, object, '.torno', 'agent.json')) && JSON.parse(readFileSync(join(root, object, '.torno', 'agent.json'), 'utf8'))

async function open(name: string): Promise<void> {
  await openListed(page, name)
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ objectId: name, status: 'ok' })
}

/** The width a part of the dock takes, and the room it has. */
const fits = (selector: string) => dock().locator(selector).evaluate((el) => el.scrollWidth <= el.clientWidth)

// Whatever a test started is ended, so that the next finds no session in the way.
test.afterEach(async () => {
  await page.evaluate(async () => {
    const sessions = Object.values(window.__tornoTest!.state().sessions)
    await Promise.all(sessions.filter((s) => s.status !== 'exited').map((s) => window.torno.session.stop(s.sessionId)))
  })
  await expect.poll(async () => Object.values((await state()).sessions).every((s) => s.status === 'exited')).toBe(true)
})

test('Claude Code is the agent: the header names it, offers no list of agents, and keeps to the width of the dock', async () => {
  await open('plain')
  await expect(dock().getByRole('heading', { name: 'Claude Code' })).toBeVisible()
  await expect(dock().getByRole('combobox')).toHaveCount(0)
  await expect(dock()).toContainText('Claude Code runs here, in the folder of plain, and works on it with you. Write below and it starts with your prompt.')
  await expect(note()).toHaveCount(0)
  // In its terminal, as the person can choose: its hooks, its status.
  await dock().getByRole('group', { name: 'View' }).getByRole('button', { name: 'Terminal' }).click()
  await expect.poll(() => onDisk('plain')).toEqual({ agent: 'claude', view: 'terminal' })
  await page.locator('.session-actions .button-primary').click() // the button that starts a new session
  await expect.poll(term).toContain('--settings')
  await expect(status()).toHaveText('Idle')
  await expect(status()).toHaveAttribute('data-status', 'idle')
  expect(await fits('.session-head')).toBe(true)
  // Nothing is written for it in the object but the choice: no file of instructions, no file of marks.
  expect(existsSync(join(root, 'plain', '.torno', 'agent'))).toBe(false)
  expect(existsSync(join(root, 'plain', '.torno', 'prompt.md'))).toBe(false)
})

test('a file that names Copilot CLI is said, is the person\'s until they choose, and "Use Claude Code" puts it right', async () => {
  await open('hollow')
  await expect(note().locator('p')).toHaveText('agent.json names Copilot CLI, which torno no longer supports: Claude Code is used.')
  // Claude Code in its chat: the view in the file was that agent's.
  await expect(dock().getByRole('group', { name: 'View' }).getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
  await newSession(dock())
  await expect(status()).not.toHaveText('Starting')
  expect((await state()).sessions.hollow.view).toBe('chat')
  // While it runs the file is not written: the button waits, and says why.
  const use = note().getByRole('button', { name: 'Use Claude Code' })
  await expect(use).toBeDisabled()
  await expect(use).toHaveAttribute('title', 'End the session first')
  expect(await fits('.session-head')).toBe(true)
  expect(await fits('.session-note')).toBe(true)
  // The note is under "What Claude Code reads" too.
  await dock().getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'What Claude Code reads' }).click()
  await expect(page.locator('.session-reads-note')).toHaveText('agent.json names Copilot CLI, which torno no longer supports: Claude Code is used.')
  await page.keyboard.press('Escape')
  await fromMore(dock(), 'End')
  await expect(status()).toHaveText('Ended')
  expect(onDisk('hollow')).toEqual({ agent: 'copilot', view: 'terminal' })
  await use.click()
  await expect.poll(() => onDisk('hollow')).toEqual({ agent: 'claude', view: 'chat' })
  await expect(note()).toHaveCount(0)
})

test('a file that names an agent torno does not know is said, and choosing a view puts it right', async () => {
  await open('gauge')
  await expect(note().locator('p')).toHaveText('agent.json names "gemini", which torno does not know: Claude Code is used.')
  expect(onDisk('gauge')).toEqual({ agent: 'gemini' })
  await dock().getByRole('group', { name: 'View' }).getByRole('button', { name: 'Terminal' }).click()
  await expect.poll(() => onDisk('gauge')).toEqual({ agent: 'claude', view: 'terminal' })
  await expect(note()).toHaveCount(0)
})

test('a session at work or waiting for the answer shows on the rail\'s Projects icon, on its object\'s row of the list and in the status line while another object is open, with the dock shown or hidden; ended, it shows nothing', async () => {
  // The project crumb's menu has a row for each object.
  const item = (name: string) => projectMenu(page).getByRole('menuitem', { name, exact: true })
  /** The menu opened, what is said of an object's row looked at, and the menu put away. */
  const inMenu = async (look: () => Promise<void>): Promise<void> => {
    await projectCrumb(page).click()
    await look()
    await page.keyboard.press('Escape')
    await expect(projectMenu(page)).toHaveCount(0)
  }
  const needs = () => page.locator('.status-needs')
  const toggle = () => page.locator('.dock-toggle')
  // A session in its terminal, the stand-in posting the hooks the CLI would.
  mkdirSync(join(root, 'measures', '.torno'), { recursive: true })
  writeFileSync(join(root, 'measures', '.torno', 'agent.json'), '{"agent":"claude","view":"terminal"}')
  await open('measures')
  await newSession(dock())
  await expect(status()).toHaveText('Idle')
  const typeLine = async (line: string): Promise<void> => {
    await page.locator('.session-term textarea').focus()
    await page.keyboard.type(line)
    await page.keyboard.press('Enter')
  }
  // At work: a quiet dot, no words, and no button in the status line.
  await typeLine('hook')
  await expect(status()).toHaveText('Working')
  await open('bracket')
  await expect(switcher(page)).toHaveAttribute('data-session', 'working')
  await expect(switcher(page)).toHaveAttribute('aria-description', 'measures is working')
  await expect(switcher(page).locator('.session-sign-word')).toHaveCount(0)
  await inMenu(async () => {
    await expect(item('measures')).toHaveAttribute('data-session', 'working')
    await expect(item('measures')).toHaveAttribute('aria-description', 'session is working')
    await expect(item('measures').locator('.session-sign-word')).toHaveCount(0)
    await expect(item('bracket')).not.toHaveAttribute('data-session', /./)
  })
  await expect(needs()).toHaveCount(0)

  // Waiting: the Notification of the CLI posted for measures, bracket open.
  await open('measures')
  await typeLine('hook Notification')
  await expect(status()).toHaveText('Needs you')
  await open('bracket')
  await expect(switcher(page)).toHaveAttribute('data-session', 'needs_input')
  await expect(switcher(page)).toHaveAttribute('aria-description', 'measures needs you')
  // The icon is named Projects, whatever the sessions do; its description names the object whose session waits.
  await expect(page.getByRole('button', { name: 'Projects', exact: true, description: 'measures needs you' })).toHaveCount(1)
  await inMenu(async () => {
    await expect(item('measures')).toHaveAttribute('data-session', 'needs_input')
    // Still found by its name alone: the state is the row's description, not part of its name.
    await expect(projectMenu(page).getByRole('menuitem', { name: 'measures', exact: true, description: 'session needs you' })).toHaveCount(1)
    await expect(item('measures').locator('.session-sign-word')).toHaveText('needs you')
  })
  await expect(needs()).toContainText('measures needs you')
  // The title bar says it too: a pill for the other project, named by it, with the session said as its description.
  await expect(page.locator('.title-row').getByRole('button', { name: 'measures', exact: true, description: 'session needs you' })).toHaveAttribute('data-sign', 'needs_input')
  // The button opens it and shows the dock, hidden or not.
  for (const hidden of [false, true]) {
    await open('bracket')
    if (hidden) {
      await toggle().click()
      await expect(dock()).toBeHidden()
    }
    await expect(needs()).toBeVisible()
    await needs().click()
    await expect.poll(async () => (await state()).objectId).toBe('measures')
    await expect(dock()).toBeVisible()
    await expect(page.locator('.session-term textarea')).toBeFocused()
  }
  // Answered, it is gone from both.
  await typeLine('hook Stop')
  await expect(status()).toHaveText('Idle')
  await expect(needs()).toHaveCount(0)
  await expect(switcher(page)).not.toHaveAttribute('data-session', /./)
  // An ended session shows nothing either.
  await typeLine('hook Notification')
  await expect(status()).toHaveText('Needs you')
  await page.evaluate(() => window.torno.session.stop(window.__tornoTest!.state().sessions.measures.sessionId))
  await expect(status()).toHaveText('Ended')
  await expect(needs()).toHaveCount(0)
  await expect(switcher(page)).not.toHaveAttribute('data-session', /./)
  await inMenu(() => expect(item('measures')).not.toHaveAttribute('data-session', /./))
})

test('the error sheet starts a session in the terminal and leaves the request at its prompt, unsent', async () => {
  await open('plain')
  await dock().getByRole('group', { name: 'View' }).getByRole('button', { name: 'Terminal' }).click()
  await expect.poll(() => onDisk('plain')).toEqual({ agent: 'claude', view: 'terminal' })
  const model = join(root, 'plain', 'plain.py')
  const good = readFileSync(model, 'utf8')
  try {
    writeFileSync(model, `${good}\nraise ValueError("too tall")\n`)
    await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('failed')
    await page.getByRole('button', { name: 'Build failed' }).click()
    const sheet = page.getByRole('dialog', { name: 'Build error' })
    await sheet.getByRole('button', { name: 'Start a session to fix it' }).click()
    // Once its CLI is ready the words are at its prompt, and it has not been sent a line.
    await expect.poll(term, { timeout: 30_000 }).toContain('Fix the build of plain: see the error.')
    await expect(status()).toHaveText('Idle')
    await expect(sheet.locator('[data-part="told"]')).toHaveText('Claude Code is told this with your next prompt.')
  } finally {
    writeFileSync(model, good)
  }
})
