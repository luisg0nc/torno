import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { agentsIn, inTerminal } from './terminal'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'

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
  await openListed(page, 'bracket')
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
  // A popover from the button that asked (Task 25): the safe button has the focus, the card stands against the button with its
  // stem to it, a card of 290 px with a title, and it is no strip of the dock.
  await expect(ask.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await expect(ask.getByRole('heading', { name: 'End the running session?' })).toBeVisible()
  const [card, from] = await Promise.all([ask.boundingBox(), dock().getByRole('button', { name: 'New session' }).boundingBox()])
  expect(card!.width).toBe(290)
  expect(card!.y >= from!.y + from!.height - 1 || card!.y + card!.height <= from!.y + 1).toBe(true)
  const stem = ask.locator('.popover-stem')
  const [tip] = await stem.evaluate((el) => [el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2])
  expect(tip).toBeGreaterThanOrEqual(from!.x - 2)
  expect(tip).toBeLessThanOrEqual(from!.x + from!.width + 2)
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
  // The focus is not lost: it stays in the dock ("Keep it" goes on with the terminal).
  expect(await page.evaluate(() => document.activeElement?.closest('[data-region="session"]') !== null)).toBe(true)
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

  // The folder crumb of the title bar is a menu: the dialog is one of its ways.
  await page.getByRole('button', { name: /^Folder / }).click()
  await page.getByRole('menuitem', { name: 'Open folder…' }).click()
  // A dialog over the whole window, not a strip of the left column: it names the object whose session is at work.
  const ask = page.getByRole('alertdialog', { name: 'End the sessions of this folder?' })
  await expect(ask).toBeVisible()
  expect(await left().getByRole('alertdialog').count()).toBe(0)
  await expect(ask.getByRole('listitem')).toHaveText(['bracket: Claude Code is working'])
  await expect(ask.getByRole('button')).toHaveText(['bracket', 'Stay here', 'Open another folder'])
  await expect(ask.getByRole('button', { name: 'Stay here' })).toBeFocused()
  const [dialog, window] = await ask.evaluate((el) => [el.getBoundingClientRect(), { width: innerWidth, height: innerHeight }] as const)
  expect(Math.abs(dialog.x + dialog.width / 2 - window.width / 2)).toBeLessThan(2)
  expect(Math.abs(dialog.y + dialog.height / 2 - window.height / 2)).toBeLessThan(2)
  // Tab goes round within it.
  await page.keyboard.press('Tab')
  await expect(ask.getByRole('button', { name: 'Open another folder' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(ask.getByRole('button', { name: 'bracket' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(ask.getByRole('button', { name: 'Open another folder' })).toBeFocused()
  // The name is a link to the object, and puts the question away: nothing was asked of the dialog.
  await ask.getByRole('button', { name: 'bracket' }).click()
  await expect(ask).toHaveCount(0)
  expect(await picks()).toBe(before)
  expect(await state()).toMatchObject({ page: 'object', objectId: 'bracket' })
  await page.getByRole('button', { name: /^Folder / }).click()
  await page.getByRole('menuitem', { name: 'Open folder…' }).click()
  await expect(ask).toBeVisible()

  // Modal after a click on its backdrop too: the focus stays in it, no key reaches the view or the window behind
  // it, and Escape presses "Stay here", which nothing behind it takes first.
  const measure = page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Measure', exact: true })
  await expect(measure).toHaveAttribute('aria-pressed', 'false')
  const built = (await state()).build
  await page.mouse.click(4, 4)
  await expect(ask).toBeVisible()
  expect(await ask.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('m')
  await page.keyboard.press('Control+Shift+B')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await expect(measure).toHaveAttribute('aria-pressed', 'false')
  expect((await state()).build).toEqual(built)
  // Enter went to the button in focus: the question stands until it is answered, and nothing else was asked for.
  await expect(ask).toHaveCount(0)
  expect(await picks()).toBe(before)
  await page.getByRole('button', { name: /^Folder / }).click()
  await page.getByRole('menuitem', { name: 'Open folder…' }).click()
  await expect(ask).toBeVisible()
  await page.mouse.click(4, 4)
  await page.keyboard.press('Escape')
  await expect(ask).toHaveCount(0)
  expect(await picks()).toBe(before)
  expect((await state()).workspace?.root).toBe(root)
  await page.getByRole('button', { name: /^Folder / }).click()
  await page.getByRole('menuitem', { name: 'Open folder…' }).click()
  await expect(ask).toBeVisible()

  await ask.getByRole('button', { name: 'Stay here' }).click()
  await expect(ask).toHaveCount(0)
  // The folder was not even asked for.
  expect(await picks()).toBe(before)
  expect((await state()).workspace?.root).toBe(root)
  await expect(sessionStatus()).toHaveText('Working')
  expect(agentsIn(join(root, 'bracket'))).toHaveLength(1)
})

test('"Open another folder" goes on to the folder, and the sessions end', async () => {
  // The folder crumb of the title bar is a menu: the dialog is one of its ways.
  await page.getByRole('button', { name: /^Folder / }).click()
  await page.getByRole('menuitem', { name: 'Open folder…' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Open another folder' }).click()
  await expect.poll(async () => (await state()).workspace?.root).toBe(other)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect((await state()).sessions).toEqual({})
  await expect.poll(() => agentsIn(join(root, 'bracket')), { timeout: 10_000 }).toEqual([])
})

test('with no session in the middle of anything, another folder is opened without asking', async () => {
  await openListed(page, 'plain')
  await dock().getByRole('button', { name: 'New session' }).click()
  await expect(sessionStatus()).toHaveText('Idle')
  await pick(root)
  // The folder crumb of the title bar is a menu: the dialog is one of its ways.
  await page.getByRole('button', { name: /^Folder / }).click()
  await page.getByRole('menuitem', { name: 'Open folder…' }).click()
  await expect.poll(async () => (await state()).workspace?.root).toBe(root)
  await expect(left().getByRole('alertdialog')).toHaveCount(0)
})
