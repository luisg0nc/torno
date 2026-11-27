import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { HistoryEntry } from '../src/shared/history'
import { openListed } from './objects'
import { newSession, timeline } from './helpers'

// The builds timeline (#332): a bar across the foot of the view, above the status line, folded by default, with a chip for each
// group of builds (a prompt's builds are one group, the person's saves in a row another); a drawer that opens upward from it, by
// its toggle and by the key, and folds back the same way; a group of several builds is a pile until a click shows them all. The
// agent is the stand-in in its stream mode (test/fake-agent.mjs); the window is hidden.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

const model = () => join(root, 'hollow', 'hollow.py')
const kept = (): HistoryEntry[] => JSON.parse(readFileSync(join(root, 'hollow', '.torno', 'history', 'index.json'), 'utf8')).entries
const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const dock = () => page.locator('[data-region="session"]')
const turns = () => dock().locator('.chat .chat-turn')
const bar = () => timeline(page).locator('.timeline-bar')
const toggle = () => timeline(page).locator('.timeline-toggle')
const drawer = () => timeline(page).locator('.timeline-drawer')
const chips = () => timeline(page).locator('.tl-chip')
const group = (label: string) => timeline(page).locator('.tl-group').filter({ has: page.locator('.tl-group-label', { hasText: label }) })
/** What each chip says: its label and its count, `Prompt 1 (2)`. */
const chipTexts = (): Promise<string[]> => chips().evaluateAll((els) => els.map((el) => [el.querySelector('.tl-chip-label')?.textContent, el.querySelector('.tl-chip-count')?.textContent].filter(Boolean).join(' ')))

async function say(lines: string[]): Promise<void> {
  await dock().locator('[data-chat-composer]').focus()
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Shift+Enter')
    await page.keyboard.type(line)
  }
  await page.keyboard.press('Enter')
}

const builtBy = (cause: string): number => kept().filter((e) => e.cause === cause && !e.failed).length

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-timeline-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

test('the builds of a project are a folded bar under the view, a chip for each prompt and for the saves in a row', async () => {
  await openListed(page, 'hollow')
  await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('ok')
  await newSession(dock())
  await expect(dock().locator('[data-chat-composer]')).toBeEnabled()
  // A prompt that builds twice, and one that builds once.
  await say(['edit hollow.py "wall: float = 2" "wall: float = 3"', 'work 4', 'edit hollow.py "wall: float = 3" "wall: float = 4"'])
  await expect.poll(() => builtBy('agent'), { timeout: 45_000 }).toBe(2)
  await expect(turns()).toHaveCount(1, { timeout: 30_000 })
  // The second asks to run a command and waits for the answer: the turn is at work for as long as the spec likes.
  await say(['edit hollow.py "wall: float = 4" "wall: float = 5"', 'ask Bash {"command":"python gen.py"}'])
  await expect.poll(() => builtBy('agent'), { timeout: 30_000 }).toBe(3)
  const ask = dock().locator('.chat .chat-ask').last()
  await expect(ask.getByRole('button', { name: 'Allow', exact: true })).toBeVisible()
  // Two saves of the person's in a row, the first while Claude's turn is at work (only its tool calls make a save
  // Claude's, #384), the second after it, putting the file back as it was.
  const was = readFileSync(model(), 'utf8')
  const saves = builtBy('person')
  writeFileSync(model(), `${was}\n# a note\n`)
  await expect.poll(() => builtBy('person'), { timeout: 30_000 }).toBe(saves + 1)
  expect((await state()).sessions.hollow?.status).toBe('needs_input')
  await ask.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(turns()).toHaveCount(2, { timeout: 30_000 })
  await expect.poll(async () => (await state()).sessions.hollow?.status, { timeout: 30_000 }).toBe('idle')
  expect(builtBy('agent')).toBe(3)
  writeFileSync(model(), was)
  await expect.poll(() => builtBy('person'), { timeout: 30_000 }).toBe(saves + 2)

  // Folded: one line across the foot of the view, on the status line, and no drawer.
  await expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer()).toBeHidden()
  const [line, status, view] = [(await bar().boundingBox())!, (await page.locator('[data-region="status"]').boundingBox())!, (await page.locator('[data-region="viewport"]').boundingBox())!]
  expect(line.height).toBeLessThan(40)
  expect(Math.abs(line.y + line.height - status.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(line.x - view.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(line.width - view.width)).toBeLessThanOrEqual(1)
  // One chip a group: the prompt's builds together with their count, "Manual edit" style labels with no words of the prompt.
  await expect.poll(chipTexts, { timeout: 15_000 }).toEqual(expect.arrayContaining(['Prompt 1 (2)', 'Prompt 2', 'Saved by you (2)']))
  const texts = await chipTexts()
  expect(texts.slice(-3)).toEqual(['Prompt 1 (2)', 'Prompt 2', 'Saved by you (2)'])
  expect(texts.join(' ')).not.toMatch(/you tried|prompt \d/)
  // The last group holds the build on show; the prompt's words are in the title.
  await expect(chips().last()).toHaveAttribute('data-on-show', '')
  await expect(chips().nth(-3)).toHaveAttribute('title', /wall: float = 2/)
  // The status line keeps its ticks: the last builds, the one on show taller and in the accent.
  const ticks = page.locator('[data-region="status"] [data-part="ticks"] .status-tick')
  await expect(ticks).toHaveCount(Math.min(8, kept().filter((e) => !e.failed).length))
  await expect(ticks.last()).toHaveAttribute('data-on-show', '')
  await expect(ticks.last()).toHaveAttribute('data-build', kept().at(-1)!.id)
})

test('its toggle opens the drawer upward over the view and folds it back, a click on a group shows each of its builds, and the key does it too', async () => {
  const pane = page.locator('.viewport-pane')
  const before = (await pane.boundingBox())!
  await toggle().click()
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer()).toBeVisible()
  // Over the view, which keeps its size: the camera is not fitted again.
  const [opened, line] = [(await drawer().boundingBox())!, (await bar().boundingBox())!]
  expect(Math.abs(opened.y + opened.height - line.y)).toBeLessThanOrEqual(1)
  expect((await pane.boundingBox())!.height).toBe(before.height)
  await expect(timeline(page).locator('.timeline-head')).toContainText('Builds of')

  // A group of two is a pile, its last build's picture; a click on its head shows both, again puts them back.
  const two = group('Prompt 1')
  const head = two.locator('.tl-group-head')
  await expect(head).toHaveAttribute('aria-expanded', 'false')
  await expect(head).toContainText('(2)')
  await expect(two.locator('.tl-pile')).toHaveCount(1)
  const made = kept().filter((e) => e.cause === 'agent' && !e.failed).slice(0, 2).map((e) => e.id)
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')
  await expect(two.locator('.strip-node[data-build]')).toHaveCount(2)
  await expect(two.locator('.strip-node[data-build]').first()).toHaveAttribute('data-build', made[0]!)
  // A build's menu says the prompt's words, which the label leaves out.
  await two.locator('.strip-node[data-build]').first().click()
  const menu = page.getByRole('menu', { name: `Build ${made[0]}` })
  await expect(menu).toBeVisible()
  await expect(page.locator('.node-menu-head')).toContainText('Prompt 1')
  await expect(page.locator('.node-menu-head')).toContainText('wall: float = 2')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await head.click()
  await expect(two.locator('.tl-pile')).toHaveCount(1)

  // Kept by the window, open or shut.
  expect(await page.evaluate(() => localStorage.getItem('torno.timeline'))).toBe('open')
  // The key folds it, and opens it again: it is heard everywhere, in the box of the chat too.
  await page.keyboard.press('Control+Shift+H')
  await expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer()).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('torno.timeline'))).toBe('shut')
  await page.keyboard.press('Control+Shift+H')
  await expect(drawer()).toBeVisible()
  await toggle().click()
  await expect(drawer()).toBeHidden()

  // A chip opens the drawer at its group, with all of its builds.
  await chips().filter({ hasText: 'Prompt 1' }).click()
  await expect(drawer()).toBeVisible()
  await expect(group('Prompt 1').locator('.strip-node[data-build]')).toHaveCount(2)
})

test('open is the window\'s, not the project\'s: another project keeps it open', async () => {
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).objectId, { timeout: 15_000 }).toContain('bracket')
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer()).toBeVisible()
  await toggle().click()
  await expect(drawer()).toBeHidden()
})
