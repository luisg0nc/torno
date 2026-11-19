import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { BoardFile } from '../src/shared/board'
import type { SizeFact, SizeSource } from '../src/shared/size'
import type { TornoState } from '../src/renderer/state/store'
import { newSession } from './helpers'
import { openListed } from './objects'

// The Brief page in the window: it swaps with the model on Ctrl+Tab, reads the project's board file as an inspection
// sheet (what we are making, sizes, rules, notes), and changes it through main. The window is hidden: state is read
// through hooks (`__tornoTest`) and the page's elements, never pixels.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-brief-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  writeFileSync(join(root, 'bracket', 'brief.md'), '# A bracket\n\nHolds the lid shut. Two screws.\n')
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const switchButton = (name: 'Model' | 'Brief' | 'Tracing'): Locator => page.locator('.pboard-switch').getByRole('button', { name, exact: true })
const readBoard = (id = 'bracket'): Promise<BoardFile> => page.evaluate((o) => window.torno.board.read(o), id)
const boardPath = (id: string): string => join(root, id, '.torno', 'board', 'board.json')
const sheet = (): Locator => page.locator('.brief-page')
const sizeRows = (): Locator => page.locator('.brief-row[data-card]:not(.brief-rule)')
const size = (what: string, value: string, source: SizeSource = 'measured'): SizeFact => ({ what, value, unit: 'mm', source })

test('a project opens on the model, with the switch Model, Brief, Tracing at the top left and no brief drawn', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
  await expect(page.locator('.pboard-switch button')).toHaveText(['Model', 'Brief', 'Tracing'])
  await expect(switchButton('Model')).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet()).toHaveCount(0)
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(false)
  // The switch comes first in the region, so that F6 lands on it.
  expect(await page.evaluate(() => document.querySelector('[data-region="viewport"] button')?.className)).toContain('pboard-switch-button')
})

test('Ctrl+Tab shows the brief and stops the view drawing; Ctrl+Tab again brings the model back', async () => {
  await page.keyboard.press('Control+Tab')
  await expect(sheet()).toBeVisible()
  await expect(switchButton('Brief')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(true)
  await expect(page.locator('.viewport-pane')).toBeHidden()
  await page.keyboard.press('Control+Tab')
  await expect(sheet()).toHaveCount(0)
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(false)
  await switchButton('Brief').click()
  await expect(sheet()).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('torno.board.shown'))).toContain('"bracket":"brief"')
})

test('the brief card shows brief.md read only, and a project with nothing else says so', async () => {
  await expect(page.getByRole('heading', { name: 'What we are making' })).toBeVisible()
  await expect(sheet()).toContainText('Holds the lid shut', { timeout: 20_000 })
  await expect(sheet().getByRole('button', { name: 'brief.md' })).toBeVisible()
  await expect(sizeRows()).toHaveCount(0)
  await expect(sheet().getByRole('region', { name: 'Sizes' })).toContainText('none yet')
})

test('Add a size opens a form that says what is missing, then puts the size in the ledger and in board.json', async () => {
  await sheet().getByRole('button', { name: 'Add a size' }).click()
  const form = page.locator('.brief-sizeform')
  await expect(form.getByLabel('What it measures')).toBeFocused()
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(form).toContainText('A size has what it measures')
  await form.getByLabel('What it measures').fill('tab hole')
  await form.getByLabel('Value').fill('Ø6,6')
  await form.getByLabel('Note').fill('probably 7')
  await page.keyboard.press('Enter')
  await expect(form).toHaveCount(0)
  const row = sizeRows().first()
  await expect(row).toContainText('Ø 6.6')
  await expect(row).toContainText('tab hole')
  await expect(row).toContainText('measured · probably 7')
  // Nothing checks it yet: the column says so, and the head counts it.
  await expect(row).toContainText('nothing checks this')
  await expect(sheet().getByRole('region', { name: 'Sizes' })).toContainText('1 size, 1 not checked')
  const saved = (await readBoard()).cards.filter((c) => c.kind === 'size')
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ by: 'person', size: { what: 'tab hole', value: 'Ø6,6', unit: 'mm', source: 'measured', note: 'probably 7' } })
})

test('Edit changes a size of yours, and Remove takes it off with an Undo that brings it back', async () => {
  const row = sizeRows().first()
  await row.hover()
  await row.getByRole('button', { name: 'Edit tab hole' }).click()
  const form = page.locator('.brief-sizeform')
  await form.getByLabel('Value').fill('6.8')
  await form.getByRole('button', { name: 'Done' }).click()
  await expect(sizeRows().first()).toContainText('6.8')
  expect((await readBoard()).cards.find((c) => c.kind === 'size')?.size?.value).toBe('6.8')
  await sizeRows().first().hover()
  await sizeRows().first().getByRole('button', { name: 'Remove tab hole' }).click()
  await expect(sizeRows()).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Removed tab hole' })).toBeVisible()
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect(sizeRows()).toHaveCount(1)
  expect((await readBoard()).cards.find((c) => c.kind === 'size')?.size?.value).toBe('6.8')
})

test('Add a rule makes the frame named Rules once, and a rule and a note are fields: Enter keeps, Esc leaves', async () => {
  await sheet().getByRole('button', { name: 'Add a rule' }).click()
  await page.getByLabel('New rule').fill('Must not go soft next to the hot cooler')
  await page.keyboard.press('Enter')
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('Must not go soft')
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('1 rule, 1 not checked')
  await sheet().getByRole('button', { name: 'Add a rule' }).click()
  await page.getByLabel('New rule').fill('Printed in ABS')
  await page.keyboard.press('Enter')
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('2 rules')
  const frames = (await readBoard()).cards.filter((c) => c.kind === 'frame')
  expect(frames.map((f) => f.name)).toEqual(['Rules'])
  expect((await readBoard()).cards.filter((c) => c.kind === 'text' && c.frame === frames[0].id)).toHaveLength(2)
  // A note, the other text; Esc leaves a half-written one.
  await sheet().getByRole('button', { name: 'Add a note' }).click()
  await page.getByLabel('New note').fill('the datasheet is in reference')
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('New note')).toHaveCount(0)
  expect((await readBoard()).cards.filter((c) => c.kind === 'text')).toHaveLength(2)
  await sheet().getByRole('button', { name: 'Add a note' }).click()
  await page.getByLabel('New note').fill('ask about the screws')
  await page.keyboard.press('Enter')
  await expect(sheet().getByRole('region', { name: 'Notes' })).toContainText('ask about the screws')
  // A rule is not a note.
  await expect(sheet().getByRole('region', { name: 'Notes' })).not.toContainText('Printed in ABS')
})

test('a ref to a card in the chat is a chip, and clicking it shows the brief with that card lit', async () => {
  const note = (await readBoard()).cards.find((c) => c.kind === 'text' && c.text === 'ask about the screws')!
  await switchButton('Model').click()
  await expect(sheet()).toHaveCount(0)
  await newSession(page.locator('[data-region="session"]'))
  const composer = page.locator('[data-region="session"] [data-chat-composer]')
  await composer.focus()
  await page.keyboard.type(`say look at ${note.id} and C999`)
  await page.keyboard.press('Enter')
  const chat = page.locator('[data-region="session"] .chat')
  const chip = chat.locator('.chat-text').last().locator(`.ref-chip[data-ref="${note.id}"]`)
  await expect(chip).toBeVisible({ timeout: 20_000 })
  await expect(chat.locator('.chat-text').last().locator('.ref-chip[data-ref="C999"]')).toHaveCount(0)
  await chip.click()
  await expect(sheet()).toBeVisible()
  await expect(page.locator(`.brief-note[data-card="${note.id}"]`)).toHaveAttribute('data-lit', '')
})

test('"Send with the next prompt" holds the whole brief, and the prompt carries it; the chip can be taken off', async () => {
  const dock = page.locator('[data-region="session"]')
  await page.getByRole('button', { name: 'Send with the next prompt' }).click()
  const chip = dock.getByRole('group', { name: 'Brief attached' })
  await expect(chip).toContainText('The whole brief')
  await chip.getByRole('button', { name: 'Remove' }).click()
  await expect(chip).toHaveCount(0)
  await page.getByRole('button', { name: 'Send with the next prompt' }).click()
  await dock.locator('[data-chat-composer]').focus()
  await page.keyboard.type('say what is attached')
  await page.keyboard.press('Enter')
  await expect(chip).toHaveCount(0)
  await expect(dock.locator('.chat-user-board').last()).toContainText(/^brief: /)
  await expect(dock.locator('.chat')).toContainText('Attached from the board by the person', { timeout: 20_000 })
})

test('an old board (the project `plain`) keeps every card: frames, arrows, view and build cards are in the file and not on the page, and Claude\'s notes keep their green edge', async () => {
  mkdirSync(join(root, 'plain', '.torno', 'board'), { recursive: true })
  const old: BoardFile = {
    tidied: true,
    next: 20,
    cards: [
      { id: 'C1', kind: 'frame', x: 0, y: 0, w: 400, h: 300, by: 'person', name: 'Latch' },
      { id: 'C2', kind: 'size', x: 10, y: 40, w: 240, h: 120, by: 'person', frame: 'C1', size: size('over the tabs', '327', 'from a manual or datasheet') },
      { id: 'C3', kind: 'size', x: 10, y: 170, w: 240, h: 120, by: 'agent', size: { what: 'cooler depth', value: '50.5', unit: 'mm', source: 'from Claude' } },
      { id: 'C4', kind: 'view', x: 500, y: 0, w: 240, h: 120, by: 'person', source: 'front' },
      { id: 'C5', kind: 'build', x: 500, y: 200, w: 240, h: 120, by: 'person' },
      { id: 'C6', kind: 'text', x: 0, y: 400, w: 280, h: 160, by: 'agent', text: 'Claude: widen the latch by 2 mm' },
      { id: 'C7', kind: 'frame', x: 0, y: 700, w: 300, h: 200, by: 'person', name: 'Rules' },
      { id: 'C8', kind: 'text', x: 10, y: 740, w: 280, h: 100, by: 'person', frame: 'C7', text: 'Strong: it carries the cooler' }
    ],
    arrows: [{ id: 'C9', from: 'C2', to: 'C3', by: 'person', label: 'like this' }]
  }
  writeFileSync(boardPath('plain'), JSON.stringify(old, null, 2))
  await openListed(page, 'plain')
  await expect.poll(async () => (await state()).objectId, { timeout: 20_000 }).toBe('plain')
  await switchButton('Brief').click()
  await expect(sizeRows()).toHaveCount(2)
  await expect(sizeRows().nth(0)).toContainText('327')
  await expect(sizeRows().nth(0)).toContainText('from a datasheet')
  await expect(sizeRows().nth(1)).toHaveAttribute('data-by', 'agent')
  await expect(sizeRows().nth(1)).toContainText('from Claude')
  await expect(page.locator('.brief-note[data-by="agent"]')).toContainText('widen the latch')
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('Strong: it carries the cooler')
  // A rule is a judgement: no measure says it.
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('a judgement: no measure says it')
  // The view, the build, the frames and the arrow are not drawn, and an agent's size has no Edit.
  await expect(sheet()).not.toContainText('Latch')
  await sizeRows().nth(1).hover()
  await expect(sizeRows().nth(1).getByRole('button', { name: /^Edit/ })).toHaveCount(0)
  // A change on top: every card of the file is still there.
  await sheet().getByRole('button', { name: 'Add a note' }).click()
  await page.getByLabel('New note').fill('one more')
  await page.keyboard.press('Enter')
  await expect(sheet().getByRole('region', { name: 'Notes' })).toContainText('one more')
  const after = JSON.parse(readFileSync(boardPath('plain'), 'utf8')) as BoardFile
  expect(after.cards.slice(0, old.cards.length)).toEqual(old.cards)
  expect(after.arrows).toEqual(old.arrows)
})

test('a window that kept "board" as its choice opens the project on the brief', async () => {
  await page.evaluate(() => localStorage.setItem('torno.board.shown', JSON.stringify({ plain: 'board' })))
  await switchButton('Model').click()
  await page.evaluate(() => localStorage.setItem('torno.board.shown', JSON.stringify({ plain: 'board' })))
  await openListed(page, 'bracket')
  await openListed(page, 'plain')
  await expect(sheet()).toBeVisible({ timeout: 20_000 })
  await expect(switchButton('Brief')).toHaveAttribute('aria-pressed', 'true')
})

test('a board file that cannot be read is kept aside and said on the page, with Dismiss', async () => {
  mkdirSync(join(root, 'two', '.torno', 'board'), { recursive: true })
  writeFileSync(join(root, 'two', '.torno', 'board', 'board.json'), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n')
  await openListed(page, 'two')
  await expect.poll(async () => (await state()).objectId, { timeout: 20_000 }).toBe('two')
  await switchButton('Brief').click()
  const notice = sheet().locator('.brief-problem')
  await expect(notice).toBeVisible({ timeout: 20_000 })
  await expect(notice).toContainText('could not be read')
  await expect(notice).toContainText('board.json.corrupt-')
  await notice.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notice).toHaveCount(0)
  expect(await page.evaluate(() => window.torno.board.problem('two'))).toBeNull()
})
