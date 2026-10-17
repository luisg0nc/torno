import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { agentsIn, inTerminal } from './terminal'
import type { TornoState } from '../src/renderer/state/store'

// What torno asks before it ends a session that is in the middle of something:
// a new session in its place, or another workspace. The agent is the stand-in
// (test/fake-agent.mjs); the folder dialog is never opened: with TORNO_TEST=1
// main answers "Open folder" with the folder the test names, or with nothing.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let other: string
let app: ElectronApplication
let page: Page

function copyFixtures(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-confirm-'))
  cpSync(fixtures, dir, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  inTerminal(dir)
  return dir
}

test.beforeAll(async () => {
  root = copyFixtures()
  other = copyFixtures()
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({
    args: ['.'],
    cwd: appDir,
    env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root }
  })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  for (const dir of [root, other]) rmSync(dir, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const dock = () => page.locator('[data-region="session"]')
const left = () => page.locator('[data-region="left"]')
const text = (): Promise<string> => page.evaluate(() => window.__tornoTerm!.text())
const sessionStatus = () => dock().getByRole('status')
const sessionId = async (objectId: string) => (await state()).sessions[objectId]?.sessionId

async function typeLine(line: string): Promise<void> {
  await page.locator('.session-term textarea').focus()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

/** What "Open folder" will be answered with, and how often it has been asked. */
function pick(folder: string | null): Promise<void> {
  return app.evaluate((_electron, dir) => {
    ;(globalThis as unknown as { __tornoMain: { pickFolder: string | null } }).__tornoMain.pickFolder = dir
  }, folder)
}
const picks = (): Promise<number> => app.evaluate(() => (globalThis as unknown as { __tornoMain: { picks: number } }).__tornoMain.picks)

test('a new session takes the place of an idle one without asking', async () => {
  await page.getByRole('button', { name: 'bracket', exact: true }).click()
  await dock().getByRole('button', { name: 'New session' }).click()
  await expect.poll(text).toContain('READY')
  await expect(sessionStatus()).toHaveText('Idle')
  const first = await sessionId('bracket')

  await dock().getByRole('button', { name: 'New session' }).click()
  await expect.poll(() => sessionId('bracket')).not.toBe(first)
  await expect(dock().getByRole('alertdialog')).toHaveCount(0)
  await expect(sessionStatus()).toHaveText('Idle')
})

test('a new session while the agent is working is asked about first; "Keep it" changes nothing', async () => {
  await typeLine('hook')
  await expect(sessionStatus()).toHaveText('Working')
  const running = await sessionId('bracket')
  const [agent] = agentsIn(join(root, 'bracket'))

  await dock().getByRole('button', { name: 'New session' }).click()
  const ask = dock().getByRole('alertdialog', { name: 'End the running session?' })
  await expect(ask).toBeVisible()
  await expect(ask).toContainText('Claude Code is working. A new session ends this one.')
  await expect(ask.getByRole('button')).toHaveText(['Keep it', 'End it and start new'])
  // Nothing has been ended by asking.
  expect(await sessionId('bracket')).toBe(running)
  expect(agentsIn(join(root, 'bracket'))).toEqual([agent])

  await ask.getByRole('button', { name: 'Keep it' }).click()
  await expect(ask).toHaveCount(0)
  expect(await sessionId('bracket')).toBe(running)
  await expect(sessionStatus()).toHaveText('Working')
  await typeLine('still here')
  await expect.poll(text).toContain('> still here')
  expect(agentsIn(join(root, 'bracket'))).toEqual([agent])
})

test('Escape keeps the session too', async () => {
  const running = await sessionId('bracket')
  await dock().getByRole('button', { name: 'New session' }).click()
  await expect(dock().getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dock().getByRole('alertdialog')).toHaveCount(0)
  expect(await sessionId('bracket')).toBe(running)
})

test('"End it and start new" ends the session and starts another, also for one that waits for an answer', async () => {
  await typeLine('hook PermissionRequest')
  await expect(sessionStatus()).toHaveText('Needs input')
  const running = await sessionId('bracket')
  const [agent] = agentsIn(join(root, 'bracket'))

  await dock().getByRole('button', { name: 'New session' }).click()
  const ask = dock().getByRole('alertdialog', { name: 'End the running session?' })
  await expect(ask).toContainText('Claude Code is waiting for your answer. A new session ends this one.')
  await ask.getByRole('button', { name: 'End it and start new' }).click()
  await expect(ask).toHaveCount(0)
  await expect.poll(() => sessionId('bracket')).not.toBe(running)
  await expect(sessionStatus()).toHaveText('Idle')
  expect(await text()).not.toContain('> still here')
  await expect.poll(() => agentsIn(join(root, 'bracket'))).not.toContain(agent)
  await expect.poll(() => agentsIn(join(root, 'bracket'))).toHaveLength(1)
})

test('opening another folder while a session is working is asked about first; "Stay here" changes nothing', async () => {
  await typeLine('hook')
  await expect(sessionStatus()).toHaveText('Working')
  await pick(other)
  const before = await picks()

  // The folder button is a menu now: the dialog is one of its ways.
  await left().getByRole('button', { name: 'Folders' }).click()
  await left().getByRole('menuitem', { name: 'Open folder…' }).click()
  const ask = left().getByRole('alertdialog', { name: 'End the sessions of this folder?' })
  await expect(ask).toBeVisible()
  await expect(ask).toContainText('A session here is in the middle of its work. Opening another folder ends it.')
  await expect(ask.getByRole('button')).toHaveText(['Stay here', 'Open another folder'])

  await ask.getByRole('button', { name: 'Stay here' }).click()
  await expect(ask).toHaveCount(0)
  // The folder was not even asked for.
  expect(await picks()).toBe(before)
  expect((await state()).workspace?.root).toBe(root)
  await expect(sessionStatus()).toHaveText('Working')
  expect(agentsIn(join(root, 'bracket'))).toHaveLength(1)
})

test('"Open another folder" goes on to the folder, and the sessions end', async () => {
  // The folder button is a menu now: the dialog is one of its ways.
  await left().getByRole('button', { name: 'Folders' }).click()
  await left().getByRole('menuitem', { name: 'Open folder…' }).click()
  await left().getByRole('alertdialog').getByRole('button', { name: 'Open another folder' }).click()
  await expect.poll(async () => (await state()).workspace?.root).toBe(other)
  await expect(left().getByRole('alertdialog')).toHaveCount(0)
  expect((await state()).sessions).toEqual({})
  await expect.poll(() => agentsIn(join(root, 'bracket')), { timeout: 10_000 }).toEqual([])
})

test('with no session in the middle of anything, another folder is opened without asking', async () => {
  await page.getByRole('button', { name: 'plain', exact: true }).click()
  await dock().getByRole('button', { name: 'New session' }).click()
  await expect(sessionStatus()).toHaveText('Idle')
  await pick(root)
  // The folder button is a menu now: the dialog is one of its ways.
  await left().getByRole('button', { name: 'Folders' }).click()
  await left().getByRole('menuitem', { name: 'Open folder…' }).click()
  await expect.poll(async () => (await state()).workspace?.root).toBe(root)
  await expect(left().getByRole('alertdialog')).toHaveCount(0)
})
