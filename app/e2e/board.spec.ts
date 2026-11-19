import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { BoardFile } from '../src/shared/board'
import type { TornoState } from '../src/renderer/state/store'
import type { HistoryEntry } from '../src/shared/history'
import { cardSection, foldSection, openSection, openStrip, newSession } from './helpers'
import { openListed } from './objects'

// The board in the window: it swaps with the model on Ctrl+Tab, shows the project's marks and brief as cards, and its
// camera moves with the wheel and the minimap without a card being drawn again. The window is hidden: state is read
// through hooks (`__tornoTest`, `__tornoBoardRenders`, `__tornoBoardCamera`), never pixels.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // A copy: the brief is written into the project, and the board into its .torno.
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-board-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  writeFileSync(join(root, 'bracket', 'brief.md'), '# A bracket\n\nHolds the lid shut. Two screws.\n')
  // A view the person saved, for the strip to pin to the board.
  mkdirSync(join(root, 'bracket', '.torno'), { recursive: true })
  writeFileSync(
    join(root, 'bracket', '.torno', 'scene.json'),
    JSON.stringify({ layers: {}, views: [{ name: 'front-latch', author: 'user', layout: 'assembly', camera: { position: [0, -120, 20], target: [0, 0, 6], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }, hidden: [], at: '2026-11-16T10:00:00.000Z' }] })
  )
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const switchButton = (name: 'Board' | 'Model'): Locator => page.locator('.pboard-switch').getByRole('button', { name, exact: true })
const camera = (): Promise<{ x: number; y: number; k: number }> => page.evaluate(() => window.__tornoBoardCamera!())
const renders = (): Promise<number> => page.evaluate(() => window.__tornoBoardRenders ?? 0)
const note = (text: string) => ({
  kind: 'pin' as const,
  author: 'user' as const,
  note: text,
  layout: 'assembly',
  revision: 1,
  camera: { position: [120, -90, 60], target: [0, 0, 6], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
  anchor: { point: [14, 9, 2.5] as [number, number, number], normal: [0, 0, 1] as [number, number, number], part: 'base', ref: 'base/F999' }
})

test('a project opens on the model, with the switch at the top left and no board drawn', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
  await expect(switchButton('Model')).toHaveAttribute('aria-pressed', 'true')
  await expect(switchButton('Board')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.pboard')).toHaveCount(0)
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(false)
  // The switch comes first in the region, so that F6 lands on it.
  expect(await page.evaluate(() => document.querySelector('[data-region="viewport"] button')?.className)).toContain('pboard-switch-button')
})

test('the compass stands clear of the switch: every button of it can be pressed', async () => {
  const at = async (selector: string) => (await page.locator(selector).first().boundingBox())!
  const switchBox = await at('.pboard-switch')
  const bar = await at('.compass')
  // At the top right, beside the switch at the top left: they do not meet.
  expect(bar.x).toBeGreaterThanOrEqual(switchBox.x + switchBox.width)
  for (const button of await page.locator('.compass button').all()) {
    const b = (await button.boundingBox())!
    const over = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.pboard-switch') !== null, { x: b.x + b.width / 2, y: b.y + b.height / 2 })
    expect(over).toBe(false)
  }
})

test('Ctrl+Tab shows the board and stops the view drawing; Ctrl+Tab again brings the model back', async () => {
  await page.keyboard.press('Control+Tab')
  await expect(page.locator('.pboard')).toBeVisible()
  await expect(switchButton('Board')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(true)
  await expect(page.locator('.viewport-pane')).toBeHidden()
  await page.keyboard.press('Control+Tab')
  await expect(page.locator('.pboard')).toHaveCount(0)
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(false)
  await expect(page.locator('.viewport-pane')).toBeVisible()
  // The buttons do the same.
  await switchButton('Board').click()
  await expect(page.locator('.pboard')).toBeVisible()
  await switchButton('Model').click()
  await expect(page.locator('.pboard')).toHaveCount(0)
})

test('a project with 3 marks shows 3 mark cards and a brief card, each with what it says', async () => {
  for (const text of ['too thin here', 'round this edge', 'is this tall enough']) await page.evaluate((m) => window.torno.marks.add('bracket', m as never), note(text))
  await expect.poll(async () => (await state()).marks.length).toBe(3)
  await page.keyboard.press('Control+Tab')
  const cards = page.locator('.pboard-card')
  await expect(page.locator('.pboard-card[data-kind="mark"]')).toHaveCount(3)
  await expect(page.locator('.pboard-card[data-kind="brief"]')).toHaveCount(1)
  await expect(cards).toHaveCount(4)
  // What a mark card says is the mark's own, read live: its chip, its note and its status.
  const first = page.locator('.pboard-card[data-kind="mark"]', { hasText: 'M1' })
  await expect(first).toContainText('too thin here')
  await expect(first.locator('.mark-chip')).toHaveText('M1')
  await expect(page.locator('.pboard-card[data-kind="brief"]')).toContainText('Holds the lid shut')
  // The marks were not made by the person on the board: main's own cards have no green edge.
  await expect(page.locator('.pboard-card[data-by="torno"]')).toHaveCount(4)
})

test('a mark changed elsewhere changes its card', async () => {
  const drawn = await renders()
  await page.evaluate(() => window.torno.marks.update('bracket', 'M2', { note: 'rounder, 2 mm' }))
  await expect(page.locator('.pboard-card[data-kind="mark"]', { hasText: 'M2' })).toContainText('rounder, 2 mm')
  await expect(page.locator('.pboard-card[data-kind="mark"]', { hasText: 'M1' })).toContainText('too thin here')
  // The counter does count: a real change draws the layer.
  expect(await renders()).toBeGreaterThan(drawn)
})

test('50 wheel pans, and a zoom, move the camera and draw the cards no more', async () => {
  const stage = page.locator('.pboard-stage')
  const box = (await stage.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const before = await camera()
  const drawn = await renders()
  expect(drawn).toBeGreaterThan(0)
  for (let i = 0; i < 50; i++) await page.mouse.wheel(0, 30)
  await expect.poll(async () => (await camera()).y).toBeLessThan(before.y - 1000)
  expect(await renders()).toBe(drawn)
  // Ctrl and the wheel zoom about the pointer.
  const panned = await camera()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -200)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await camera()).k).toBeGreaterThan(panned.k)
  expect(await renders()).toBe(drawn)
  // The layer carries the camera as a transform, set where it moved.
  const view = await camera()
  const set = await page.locator('.pboard-layer').evaluate((el) => (el as HTMLElement).style.transform)
  const [x, y, k] = [...set.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map((m) => Number(m[0]))
  expect([x, y, k].map((n) => Math.round(n * 100) / 100)).toEqual([view.x, view.y, view.k].map((n) => Math.round(n * 100) / 100))
})

test('Shift+1 fits all the cards in the stage', async () => {
  await page.locator('.pboard-stage').focus()
  await page.keyboard.press('Shift+1')
  const view = await camera()
  const stage = (await page.locator('.pboard-stage').boundingBox())!
  for (const card of await page.locator('.pboard-card').all()) {
    const b = (await card.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(stage.x - 1)
    expect(b.y).toBeGreaterThanOrEqual(stage.y - 1)
    expect(b.x + b.width).toBeLessThanOrEqual(stage.x + stage.width + 1)
    expect(b.y + b.height).toBeLessThanOrEqual(stage.y + stage.height + 1)
  }
  expect(view.k).toBeLessThanOrEqual(1)
})

test('a click in the minimap moves the camera there, and the box of what is shown follows', async () => {
  await page.locator('.pboard-stage').focus()
  // Zoomed in on the middle, so that there is somewhere to go.
  const stage = (await page.locator('.pboard-stage').boundingBox())!
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200)
  await page.keyboard.up('Control')
  const before = await camera()
  const drawn = await renders()
  const mini = (await page.locator('.pboard-minimap').boundingBox())!
  const view = page.locator('.pboard-mini-view')
  const viewBefore = await view.boundingBox()
  await page.mouse.click(mini.x + 6, mini.y + 6)
  await expect.poll(async () => (await camera()).x).toBeGreaterThan(before.x)
  const after = await camera()
  expect(after.k).toBe(before.k)
  expect(after.y).toBeGreaterThan(before.y)
  const viewAfter = await view.boundingBox()
  expect(viewAfter!.x).toBeLessThan(viewBefore!.x)
  expect(await renders()).toBe(drawn)
})

test('a click selects a card, Shift adds one, and a click on the ground lets go', async () => {
  await page.locator('.pboard-stage').focus()
  await page.keyboard.press('Shift+1')
  await page.locator('.pboard-card[data-kind="mark"]', { hasText: 'M1' }).click()
  await expect(page.locator('.pboard-card[data-selected]')).toHaveCount(1)
  await page.locator('.pboard-card[data-kind="mark"]', { hasText: 'M3' }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.pboard-card[data-selected]')).toHaveCount(2)
  const stage = (await page.locator('.pboard-stage').boundingBox())!
  await page.mouse.click(stage.x + 4, stage.y + stage.height - 4)
  await expect(page.locator('.pboard-card[data-selected]')).toHaveCount(0)
})

test('the keys of the view are not the board\'s while it is shown', async () => {
  const before = (await state()).section
  await page.locator('.pboard-stage').focus()
  // X is the Section tool of the view: with the board shown it cuts nothing.
  await page.keyboard.press('x')
  expect((await state()).section).toEqual(before)
})

test('the board is in the tokens of each theme: a card is the panel\'s colour in light and in dark', async () => {
  const colours = async (): Promise<{ card: string; panel: string }> =>
    page.evaluate(() => {
      const probe = document.createElement('i')
      probe.style.background = 'var(--panel)'
      document.body.append(probe)
      const panel = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { card: getComputedStyle(document.querySelector('.pboard-card[data-kind="mark"]')!).backgroundColor, panel }
    })
  await page.emulateMedia({ colorScheme: 'light' })
  const light = await colours()
  expect(light.card).toBe(light.panel)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(async () => (await colours()).panel).not.toBe(light.panel)
  const dark = await colours()
  expect(dark.card).toBe(dark.panel)
  await page.emulateMedia({ colorScheme: null })
})

// ---- Making and changing cards: the tools, selecting, moving, hiding and undoing ----
const readBoard = (): Promise<BoardFile> => page.evaluate(() => window.torno.board.read('bracket'))
const stageBox = async () => (await page.locator('.pboard-stage').boundingBox())!
const textCard = () => page.locator('.pboard-card[data-kind="text"]')

/** A drag with the pointer from one point of the page to another, in steps (the board hears pointer moves, not the end alone). */
async function drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
}

test('N then a click on the ground makes a text card; typing sets its words and Esc ends', async () => {
  await expect(page.locator('.pboard')).toBeVisible()
  await page.locator('.pboard-stage').focus()
  // Zoomed out about the middle, so that there is ground to put things on.
  const stage = await stageBox()
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 200)
  await page.keyboard.up('Control')
  await page.keyboard.press('n')
  await expect(page.locator('.pboard-tool[data-tool="text"]')).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.click(stage.x + stage.width * 0.2, stage.y + stage.height * 0.7)
  const field = page.locator('.pboard-editor')
  await expect(field).toBeFocused()
  await page.keyboard.type('check the clearance, see M1')
  await page.keyboard.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(textCard()).toHaveCount(1)
  await expect(textCard()).toContainText('check the clearance')
  await expect(textCard()).toHaveAttribute('data-by', 'person')
  const saved = (await readBoard()).cards.find((c) => c.kind === 'text')!
  expect(saved.text).toBe('check the clearance, see M1')
  expect(saved.by).toBe('person')
  // A text with no words makes nothing: a card with none is never kept.
  await page.keyboard.press('n')
  await page.mouse.click(stage.x + stage.width * 0.2, stage.y + stage.height * 0.4)
  await page.keyboard.press('Escape')
  await expect(textCard()).toHaveCount(1)
  expect((await readBoard()).cards.filter((c) => c.kind === 'text')).toHaveLength(1)
})

test('a frame is drawn with a drag and named; a text card moved into it belongs to it and follows it', async () => {
  const text = (await textCard().boundingBox())!
  await page.keyboard.press('f')
  await expect(page.locator('.pboard-tool[data-tool="frame"]')).toHaveAttribute('aria-pressed', 'true')
  const from = { x: text.x + text.width + 90, y: text.y - 60 }
  await drag(from, { x: from.x + 220, y: from.y + 200 })
  const name = page.locator('.pboard-editor')
  await expect(name).toBeFocused()
  await page.keyboard.type('Latch')
  await page.keyboard.press('Enter')
  const frame = page.locator('.pboard-card[data-kind="frame"]')
  await expect(frame).toHaveCount(1)
  await expect(frame).toContainText('Latch')
  let board = await readBoard()
  const frameId = board.cards.find((c) => c.kind === 'frame')!.id
  expect(board.cards.find((c) => c.kind === 'text')!.frame).toBeUndefined()

  // Back to Select, and the card is dragged to the middle of the frame.
  await page.keyboard.press('v')
  const frameBox = (await frame.boundingBox())!
  const cardBox = (await textCard().boundingBox())!
  await drag({ x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 }, { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 })
  await expect.poll(async () => (await readBoard()).cards.find((c) => c.kind === 'text')!.frame).toBe(frameId)
  board = await readBoard()
  const before = board.cards.find((c) => c.kind === 'text')!
  const frameBefore = board.cards.find((c) => c.id === frameId)!

  // The frame is moved by its name, and what is in it goes along.
  const head = frame.locator('.pboard-head')
  const h = (await head.boundingBox())!
  await drag({ x: h.x + 20, y: h.y + h.height / 2 }, { x: h.x + 20 + 60, y: h.y + h.height / 2 + 40 })
  await expect.poll(async () => (await readBoard()).cards.find((c) => c.id === frameId)!.x).not.toBe(frameBefore.x)
  board = await readBoard()
  const after = board.cards.find((c) => c.kind === 'text')!
  const frameAfter = board.cards.find((c) => c.id === frameId)!
  expect(after.x - before.x).toBeCloseTo(frameAfter.x - frameBefore.x, 5)
  expect(after.y - before.y).toBeCloseTo(frameAfter.y - frameBefore.y, 5)
  expect(frameAfter.x).toBeGreaterThan(frameBefore.x)
  expect(after.frame).toBe(frameId)
})

test('an arrow is drawn from one card to another, and a double click gives it a word', async () => {
  await page.keyboard.press('a')
  await expect(page.locator('.pboard-tool[data-tool="arrow"]')).toHaveAttribute('aria-pressed', 'true')
  const text = (await textCard().boundingBox())!
  const mark = (await page.locator('.pboard-card[data-kind="mark"]', { hasText: 'M1' }).boundingBox())!
  await drag({ x: text.x + text.width / 2, y: text.y + text.height / 2 }, { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 })
  await expect(page.locator('.pboard-arrow')).toHaveCount(1)
  expect((await readBoard()).arrows).toHaveLength(1)
  await page.keyboard.press('v')
  await page.locator('.pboard-arrow-hit').dblclick()
  await expect(page.locator('.pboard-editor')).toBeFocused()
  await page.keyboard.type('like this')
  await page.keyboard.press('Enter')
  await expect(page.locator('.pboard-arrow text')).toHaveText('like this')
  const arrows = (await readBoard()).arrows
  expect(arrows).toHaveLength(1)
  expect(arrows[0]).toMatchObject({ label: 'like this', by: 'person' })
})

test('Delete on a mark card hides it; "Hidden cards" lists it and "Show again" brings it back', async () => {
  const mark = page.locator('.pboard-card[data-kind="mark"]', { hasText: 'M3' })
  await mark.click()
  await expect(mark).toHaveAttribute('data-selected', '')
  await page.keyboard.press('Delete')
  await expect(page.locator('.pboard-card[data-kind="mark"]')).toHaveCount(2)
  expect((await readBoard()).cards.find((c) => c.kind === 'mark' && c.source === 'M3')!.hidden).toBe(true)
  const button = page.getByRole('button', { name: /Hidden cards/ })
  await expect(button).toContainText('1')
  await button.click()
  const item = page.locator('.pboard-hidden-item')
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('M3')
  await item.getByRole('button', { name: 'Show again' }).click()
  await expect(page.locator('.pboard-card[data-kind="mark"]')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /Hidden cards/ })).toHaveCount(0)
})

test('Ctrl+Z after deleting a text card brings it back, with its words and its frame', async () => {
  const card = textCard()
  await card.click()
  await page.keyboard.press('Delete')
  await expect(card).toHaveCount(0)
  expect((await readBoard()).cards.some((c) => c.kind === 'text')).toBe(false)
  await page.keyboard.press('Control+z')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('check the clearance')
  const back = (await readBoard()).cards.find((c) => c.kind === 'text')!
  expect(back.frame).toBeDefined()
  expect(back.text).toBe('check the clearance, see M1')
  // The arrow of the card went with it, and came back with it.
  expect((await readBoard()).arrows).toHaveLength(1)
})

test('Ctrl+Z takes a move back', async () => {
  const before = (await readBoard()).cards.find((c) => c.kind === 'mark' && c.source === 'M2')!
  const mark = page.locator('.pboard-card[data-kind="mark"]', { hasText: 'M2' })
  const b = (await mark.boundingBox())!
  await drag({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: b.x + b.width / 2 + 50, y: b.y + b.height / 2 + 30 })
  await expect.poll(async () => (await readBoard()).cards.find((c) => c.id === before.id)!.x).toBeGreaterThan(before.x)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await readBoard()).cards.find((c) => c.id === before.id)!.x).toBe(before.x)
})

test('M then a click makes a size card from a form; a double click edits it, Ctrl+Z takes each back, and board.json holds the facts', async () => {
  const sizeCard = () => page.locator('.pboard-card[data-kind="size"]')
  const sizes = async () => (await readBoard()).cards.filter((c) => c.kind === 'size')
  const form = page.locator('.pboard-sizeform')
  await page.locator('.pboard-stage').focus()
  const stage = await stageBox()
  await page.keyboard.press('m')
  await expect(page.locator('.pboard-tool[data-tool="size"]')).toHaveAttribute('aria-pressed', 'true')
  // Halfway down: the minimap stands at the stage's foot, and the form opens at the click, so a click low on the stage opens it under the minimap.
  await page.mouse.click(stage.x + stage.width * 0.75, stage.y + stage.height * 0.5)
  await expect(form).toBeVisible()
  await expect(form.getByLabel('What it measures')).toBeFocused()

  // Done says what is missing and keeps the form.
  await form.getByLabel('What it measures').fill('battery tray')
  await form.getByRole('button', { name: 'Done' }).click()
  await expect(form).toBeVisible()
  await expect(form.locator('.pboard-sizeform-help')).toContainText('value')
  expect(await sizes()).toHaveLength(0)

  await form.getByLabel('Value').fill('186 x 128')
  await form.getByLabel('Where it came from').selectOption('from a manual or datasheet')
  await form.getByLabel('Note').fill('with the lip')
  await form.getByLabel('Value').press('Enter')
  await expect(form).toHaveCount(0)
  await expect(sizeCard()).toHaveCount(1)
  await expect(sizeCard()).toContainText('186 x 128 mm')
  await expect(sizeCard()).toContainText('battery tray')
  await expect(sizeCard()).toContainText('from a manual or datasheet: with the lip')
  await expect(sizeCard().locator('li.num[data-big]')).toHaveText('186 x 128 mm')
  await expect(sizeCard()).toHaveAttribute('data-by', 'person')
  const made = (await sizes())[0]
  expect(made.by).toBe('person')
  expect(made.size).toEqual({ what: 'battery tray', value: '186 x 128', unit: 'mm', source: 'from a manual or datasheet', note: 'with the lip' })
  // The tool is put back to Select after one card.
  await expect(page.locator('.pboard-tool[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true')

  // A double click edits it: the form holds what it had; a new value is kept, in degrees too.
  await sizeCard().dblclick()
  await expect(form).toBeVisible()
  await expect(form.getByLabel('Value')).toHaveValue('186 x 128')
  await form.getByLabel('Value').fill('190 x 128')
  await form.getByLabel('Unit').selectOption('°')
  await form.getByLabel('Value').press('Enter')
  await expect(sizeCard()).toContainText('190 x 128°')
  expect((await sizes())[0].size).toMatchObject({ value: '190 x 128', unit: '°' })

  // Ctrl+Z takes the edit back, then the card away.
  await page.keyboard.press('Control+z')
  await expect(sizeCard()).toContainText('186 x 128 mm')
  expect((await sizes())[0].size).toEqual(made.size)
  await page.keyboard.press('Control+z')
  await expect(sizeCard()).toHaveCount(0)
  expect(await sizes()).toHaveLength(0)

  // Left half-written, Esc makes nothing.
  await page.keyboard.press('m')
  await page.mouse.click(stage.x + stage.width * 0.75, stage.y + stage.height * 0.8)
  await form.getByLabel('What it measures').fill('half')
  await page.keyboard.press('Escape')
  await expect(form).toHaveCount(0)
  expect(await sizes()).toHaveLength(0)
})

test('a picture dropped on the board makes a picture card', async () => {
  const stage = await stageBox()
  const dataTransfer = await page.evaluateHandle(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#3366aa'
    ctx.fillRect(0, 0, 64, 48)
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'bay.png', { type: 'image/png' }))
    return dt
  })
  await page.dispatchEvent('.pboard-stage', 'drop', { dataTransfer, clientX: stage.x + stage.width * 0.8, clientY: stage.y + stage.height * 0.8 })
  await expect(page.locator('.pboard-card[data-kind="picture"]')).toHaveCount(1)
  const picture = (await readBoard()).cards.find((c) => c.kind === 'picture')!
  expect(picture.by).toBe('person')
  expect(picture.picture).toMatch(/^p-[0-9a-f]{12}\.png$/)
  await expect(page.locator('.pboard-card[data-kind="picture"] img')).toHaveCount(1)
})

test('S opens the ink pad, and what is drawn becomes a doodle card', async () => {
  await page.locator('.pboard-stage').focus()
  await page.keyboard.press('s')
  const pad = page.getByRole('dialog', { name: 'Doodle for the board' })
  await expect(pad).toBeVisible()
  const area = (await pad.getByLabel('Drawing area').boundingBox())!
  await drag({ x: area.x + area.width * 0.2, y: area.y + area.height * 0.3 }, { x: area.x + area.width * 0.7, y: area.y + area.height * 0.6 })
  await pad.getByRole('button', { name: 'Done' }).click()
  await expect(pad).toHaveCount(0)
  await expect(page.locator('.pboard-card[data-kind="sketch"]')).toHaveCount(1)
  const sketch = (await readBoard()).cards.find((c) => c.kind === 'sketch')!
  expect(sketch.by).toBe('person')
  expect(sketch.picture).toMatch(/^p-[0-9a-f]{12}\.png$/)
})

test('the choice is kept for the project, in the window storage', async () => {
  expect(await page.evaluate(() => localStorage.getItem('torno.board.shown'))).toContain('"bracket":"board"')
  await page.keyboard.press('Control+Tab')
  await expect(page.locator('.pboard')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('torno.board.shown'))).toContain('"bracket":"model"')
})

// ---- Pins, double clicks, and what goes with a prompt ----
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const turns = () => chat().locator('.chat-turn')
const kept = (): HistoryEntry[] => JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'history', 'index.json'), 'utf8')).entries
const cardOf = (kind: string) => page.locator(`.pboard-card[data-kind="${kind}"]`)
const cardsOf = async (kind: string) => (await readBoard()).cards.filter((c) => c.kind === kind)

async function say(prompt: string): Promise<void> {
  await composer().focus()
  await page.keyboard.type(prompt)
  await page.keyboard.press('Enter')
}

// The board is the project's brief (#216): builds, the Parameters and the Checks have no "Pin to board". The star keeps a build.
test('a build is starred from the strip and has no Pin to board; Parameters and Checks have none either', async () => {
  await expect(page.locator('.pboard')).toHaveCount(0)
  await newSession(dock())
  await expect(composer()).toBeEnabled()
  await say('edit bracket.py "width: float = 40" "width: float = 41"')
  await expect(turns()).toHaveCount(1, { timeout: 30_000 })
  await expect.poll(() => kept().filter((e) => e.cause === 'agent' && !e.failed).length, { timeout: 30_000 }).toBeGreaterThan(0)
  await openStrip(page)
  const strip = dock().locator('.strip .strip-node[data-kind="built"]')
  await expect.poll(() => strip.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
  const id = (await strip.first().getAttribute('data-build'))!
  await strip.first().click()
  await expect(page.getByRole('menuitem', { name: 'Star' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Pin to board' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Star' }).click()
  await expect.poll(() => kept().find((e) => e.id === id)?.starred, { timeout: 10_000 }).toBe(true)
  await expect(strip.first()).toHaveAttribute('data-starred', '')
  expect(await cardsOf('build')).toHaveLength(0)
  await openSection(page, 'Parameters')
  await expect(page.locator('[data-pin="params"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pin to board' })).toHaveCount(0)
})

test('a saved view is pinned from its menu in the strip, and a view that is not saved is refused by main', async () => {
  await switchButton('Model').click()
  await expect(page.locator('.pboard')).toHaveCount(0)
  // The view is not the one on screen: its menu is in the list behind "1 more".
  await page.getByRole('button', { name: /more$/ }).click()
  await page.getByRole('menuitem', { name: 'Actions for front-latch' }).click()
  await page.getByRole('menuitem', { name: 'Pin to board' }).click()
  await expect(cardOf('view')).toHaveCount(0)
  await switchButton('Board').click()
  await expect(cardOf('view')).toHaveCount(1)
  expect((await cardsOf('view'))[0]).toMatchObject({ by: 'person', source: 'front-latch', layout: 'assembly' })
  expect(await page.evaluate(() => window.torno.board.pin('bracket', { kind: 'view', name: 'nowhere' }))).toEqual({ refused: expect.stringContaining('nowhere') })
  expect(await cardsOf('view')).toHaveLength(1)
})

test('a double click on a mark card shows the model with the mark selected', async () => {
  await expect(page.locator('.pboard')).toBeVisible()
  await page.locator('.pboard-card[data-kind="mark"]', { hasText: 'M2' }).dblclick()
  await expect(page.locator('.pboard')).toHaveCount(0)
  await expect(switchButton('Model')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await state()).activeMark).toBe('M2')
})

test('a double click on a view card shows the model with that view on', async () => {
  await switchButton('Board').click()
  await cardOf('view').dblclick()
  await expect(page.locator('.pboard')).toHaveCount(0)
  await expect.poll(async () => (await state()).activeView).toBe('front-latch')
})

test('a double click on the Params card shows the Parameters section, and on the brief card has the system open brief.md', async () => {
  await switchButton('Board').click()
  await foldSection(page, 'Parameters')
  await cardOf('params').dblclick()
  await expect(page.locator('.pboard')).toHaveCount(0)
  await expect(cardSection(page, 'Parameters')).not.toHaveAttribute('data-folded', '')
  await switchButton('Board').click()
  await cardOf('brief').dblclick()
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __tornoMain: { openedFiles: string[] } }).__tornoMain.openedFiles)).toEqual([join(root, 'bracket', 'brief.md')])
  // The board stays: the brief is the editor's.
  await expect(page.locator('.pboard')).toBeVisible()
})

test('a double click on a build card opens Compare with the live build', async () => {
  const build = (await cardsOf('build'))[0]
  await cardOf('build').dblclick()
  await expect(page.locator('.pboard')).toHaveCount(0)
  const live = kept().filter((e) => !e.failed).at(-1)!
  await expect.poll(async () => (await state()).compare).toMatchObject({ from: build.source, to: live.id })
  // The compare band holds the top left, so the switch is away until it is put away.
  await expect(page.locator('.pboard-switch')).toHaveCount(0)
  await page.locator('[data-band="compare"]').getByRole('button', { name: 'Back to live', exact: true }).click()
  await expect(page.locator('.pboard-switch')).toBeVisible()
})

test('a double click on a picture opens it large, and Esc puts it away', async () => {
  await switchButton('Board').click()
  await expect(page.locator('.pboard')).toBeVisible()
  await cardOf('picture').dblclick()
  const large = page.getByRole('dialog', { name: /^Picture C\d+/ })
  await expect(large).toBeVisible()
  await expect(large.locator('img')).toBeVisible()
  // The board under it hears nothing: Esc is the picture's.
  await page.keyboard.press('Escape')
  await expect(large).toHaveCount(0)
  await expect(page.locator('.pboard')).toBeVisible()
})

test('a double click on a doodle opens the ink pad on its drawing, and Done gives the card its new drawing', async () => {
  const before = (await cardsOf('sketch'))[0]
  await cardOf('sketch').dblclick()
  const pad = page.getByRole('dialog', { name: 'Doodle for the board' })
  await expect(pad).toBeVisible()
  // Its drawing is under the ink.
  await expect(pad.getByLabel('Drawing area')).toHaveAttribute('data-ground', '')
  const area = (await pad.getByLabel('Drawing area').boundingBox())!
  await drag({ x: area.x + area.width * 0.2, y: area.y + area.height * 0.7 }, { x: area.x + area.width * 0.8, y: area.y + area.height * 0.8 })
  await pad.getByRole('button', { name: 'Done' }).click()
  await expect(pad).toHaveCount(0)
  await expect.poll(async () => (await cardsOf('sketch'))[0].picture).not.toBe(before.picture)
  expect(await cardsOf('sketch')).toHaveLength(1)
  expect((await cardsOf('sketch'))[0].id).toBe(before.id)
  // Ctrl+Z takes the drawing back, as it takes any change to a card.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await cardsOf('sketch'))[0].picture).toBe(before.picture)
})

/** A picture of `w` x `h` made of noise, as a file a phone might give: far more than main takes (2000 px, 3.75 MB). */
async function drop(name: string, w: number, h: number): Promise<void> {
  const stage = await stageBox()
  const dataTransfer = await page.evaluateHandle(
    async ([n, width, height]) => {
      const canvas = document.createElement('canvas')
      canvas.width = width as number
      canvas.height = height as number
      const ctx = canvas.getContext('2d')!
      const pixels = ctx.createImageData(width as number, height as number)
      for (let at = 0; at < pixels.data.length; at += 65_536) crypto.getRandomValues(pixels.data.subarray(at, Math.min(at + 65_536, pixels.data.length)))
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255
      ctx.putImageData(pixels, 0, 0)
      const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], n as string, { type: 'image/png' }))
      return dt
    },
    [name, w, h]
  )
  await page.dispatchEvent('.pboard-stage', 'drop', { dataTransfer, clientX: stage.x + stage.width * 0.5, clientY: stage.y + stage.height * 0.5 })
}

test('a photo far larger than main takes is scaled in the window first, so a phone photo works', async () => {
  const before = (await cardsOf('picture')).length
  await drop('phone.png', 2600, 1800)
  await expect.poll(async () => (await cardsOf('picture')).length, { timeout: 30_000 }).toBe(before + 1)
  const card = (await cardsOf('picture')).at(-1)!
  const size = await page.evaluate(async (file) => {
    const bytes = await window.torno.board.picture('bracket', file)
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
    return { w: bitmap.width, h: bitmap.height, bytes: bytes!.length }
  }, card.picture!)
  expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(1280)
  expect(size.bytes).toBeLessThanOrEqual(3_750_000)
  // The shape is kept.
  expect(size.w / size.h).toBeCloseTo(2600 / 1800, 1)
  expect(await page.locator('.pboard-problem').count()).toBe(0)
  // Taken off again, so that it lies over nothing.
  await page.locator(`.pboard-card[data-card="${card.id}"]`).click()
  await page.keyboard.press('Delete')
  await expect(page.locator(`.pboard-card[data-card="${card.id}"]`)).toHaveCount(0)
})

/** The ids of cards of these kinds whose middle shows them and no other card: the ones a click lands on. */
const clickable = (kinds: string[]): Promise<string[]> =>
  page.evaluate((wanted) => {
    const out: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('.pboard-card')) {
      if (!wanted.includes(el.dataset.kind!)) continue
      const b = el.getBoundingClientRect()
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest<HTMLElement>('.pboard-card')
      if (top === el) out.push(el.dataset.card!)
    }
    return out
  }, kinds)

test('two cards selected go with the next prompt: the composer holds "2 cards", and the prompt carries them', async () => {
  await page.locator('.pboard-stage').focus()
  await page.keyboard.press('Shift+1')
  const [one, two] = await clickable(['mark', 'brief'])
  expect(two).toBeDefined()
  await page.locator(`.pboard-card[data-card="${one}"]`).click()
  await page.locator(`.pboard-card[data-card="${two}"]`).click({ modifiers: ['Shift'] })
  await expect(page.locator('.pboard-card[data-selected]')).toHaveCount(2)
  await page.getByRole('button', { name: 'Send with the next prompt' }).click()
  const chip = dock().getByRole('group', { name: 'Board attached' })
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('2 cards')
  // What is attached is read when the prompt is sent.
  await composer().focus()
  await page.keyboard.type('say what is attached')
  await page.keyboard.press('Enter')
  await expect(chip).toHaveCount(0)
  const user = chat().locator('.chat-user').last()
  await expect(user.locator('.chat-user-board')).toHaveText('board: 2 cards')
  // The stand-in says each line it was given: the attachment is in the prompt, one block for each card.
  await expect(chat()).toContainText('Attached from the board by the person (2 cards)', { timeout: 20_000 })
  await expect(chat()).toContainText(new RegExp(`${one} · (mark|brief) · by torno`))
  await expect(chat()).toContainText(new RegExp(`${two} · (mark|brief) · by torno`))
  // The line the prompt itself carried of the board, under it.
  await expect(chat().locator('.chat-added-board').last()).toContainText(/board: \d+ cards?/)
})

test('"Send the whole board" holds every card, and Ctrl+Enter sends the selection; the chip can be taken off', async () => {
  const board = await readBoard()
  const cards = board.cards.filter((c) => !c.hidden && c.kind !== 'frame')
  await page.getByRole('button', { name: 'Send the whole board' }).click()
  const chip = dock().getByRole('group', { name: 'Board attached' })
  await expect(chip).toContainText(`${cards.length} cards`)
  await expect(chip).toContainText('The whole board')
  await chip.getByRole('button', { name: 'Remove' }).click()
  await expect(chip).toHaveCount(0)
  // Ctrl+Enter, with the board's keys.
  await page.locator('.pboard-stage').focus()
  await page.locator(`.pboard-card[data-card="${(await clickable(['mark', 'brief']))[0]}"]`).click()
  await page.keyboard.press('Control+Enter')
  await expect(chip).toContainText('1 card')
  await chip.getByRole('button', { name: 'Remove' }).click()
  // With nothing selected, or an arrow alone, there is nothing to send.
  await page.locator('.pboard-stage').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Send with the next prompt' })).toBeDisabled()
  await page.locator('.pboard-arrow-hit').first().click()
  await expect(page.getByRole('button', { name: 'Send with the next prompt' })).toBeDisabled()
  await page.keyboard.press('Control+Enter')
  await expect(chip).toHaveCount(0)
})

test('a picture card goes with a prompt as a picture, scaled by main to at most 1280 px', async () => {
  const card = (await cardsOf('picture'))[0]
  await page.locator('.pboard-stage').focus()
  await page.keyboard.press('Shift+1')
  expect(await clickable(['picture'])).toContain(card.id)
  await page.locator(`.pboard-card[data-card="${card.id}"]`).click()
  await page.getByRole('button', { name: 'Send with the next prompt' }).click()
  await composer().focus()
  await page.keyboard.type('images')
  await page.keyboard.press('Enter')
  const user = chat().locator('.chat-user').last()
  await expect(user.locator('.chat-user-board')).toHaveText('board: 1 card')
  await expect(user.locator('.chat-thumb')).toHaveCount(1, { timeout: 20_000 })
  const said = chat().locator('.chat-text').filter({ hasText: /^images: 1 / }).last()
  await expect(said).toBeVisible({ timeout: 20_000 })
  const [w, h] = /images: 1 (\d+)x(\d+)/.exec((await said.innerText()))!.slice(1).map(Number)
  expect(Math.max(w, h)).toBeLessThanOrEqual(1280)
  expect(w).toBeGreaterThan(0)
})

test('a ref to a card in the chat is a chip, and clicking it shows the board with that card selected', async () => {
  const target = (await readBoard()).cards.find((c) => c.kind === 'mark' && c.source === 'M2')!
  await switchButton('Model').click()
  await expect(page.locator('.pboard')).toHaveCount(0)
  await say(`say look at ${target.id} and ${target.id.replace(/\d+/, '999')}`)
  const chip = chat().locator('.chat-text').last().locator(`.ref-chip[data-ref="${target.id}"]`)
  await expect(chip).toBeVisible({ timeout: 20_000 })
  await expect(chip).toHaveAttribute('data-kind', 'card')
  // A card the board has not is only text.
  await expect(chat().locator('.chat-text').last().locator('.ref-chip[data-ref="C999"]')).toHaveCount(0)
  await chip.click()
  await expect(page.locator('.pboard')).toBeVisible()
  await expect(page.locator('.pboard-card[data-selected]')).toHaveCount(1)
  await expect(page.locator(`.pboard-card[data-card="${target.id}"]`)).toHaveAttribute('data-selected', '')
})

test('a board file that cannot be read is kept aside and said on the board, with Dismiss', async () => {
  // What a git merge leaves: conflict markers where the file was.
  mkdirSync(join(root, 'two', '.torno', 'board'), { recursive: true })
  writeFileSync(join(root, 'two', '.torno', 'board', 'board.json'), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n')
  await openListed(page, 'two')
  await expect.poll(async () => (await state()).objectId, { timeout: 20_000 }).toBe('two')
  await switchButton('Board').click()
  const notice = page.locator('.pboard-file-problem')
  await expect(notice).toBeVisible({ timeout: 20_000 })
  await expect(notice).toContainText('could not be read')
  await expect(notice).toContainText('board.json.corrupt-')
  await notice.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notice).toHaveCount(0)
  expect(await page.evaluate(() => window.torno.board.problem('two'))).toBeNull()
})

test('the card of a view note shows its picture with the ink and its comment, and a double click on it opens its sheet', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).objectId, { timeout: 20_000 }).toBe('bracket')
  await expect.poll(async () => (await state()).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
  const made = await page.evaluate(async (camera) => {
    const canvas = new OffscreenCanvas(160, 100)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#d9d4c8'
    ctx.fillRect(0, 0, 160, 100)
    const plain = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    ctx.strokeStyle = '#d4342c'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(20, 30)
    ctx.lineTo(120, 60)
    ctx.stroke()
    const inked = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    return window.torno.notes.make({
      objectId: 'bracket', revision: 1, layout: 'assembly', camera, caption: 'the bracket from the front', size: { w: 160, h: 100 }, plain, inked, inkColour: '#d4342c',
      strokes: [{ width: 6, points: [[20, 30], [120, 60]] }], labels: [], under: [{ box: [20, 30, 120, 60], refs: [], cuts: [], scans: [], bare: true }], comment: 'make the base thicker here', references: []
    } as never)
  }, note('').camera)
  await switchButton('Board').click()
  const card = page.locator('.pboard-card[data-kind="mark"]', { hasText: made.id })
  await expect(card).toContainText('make the base thicker here')
  await expect(card.locator('img.pboard-picture')).toBeVisible()
  // A double click opens the sheet over the note, and shows the model it lies over.
  await card.dblclick()
  await expect(page.getByRole('dialog', { name: 'Drawing on the view' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pboard')).toHaveCount(0)
  await page.keyboard.press('Escape')
})
