import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { cardSection, foldSection, openSection, railButton, newSession } from './helpers'
import { openListed } from './objects'

// The model's Params in the left column, read only: a row for each field with its default in the monospace face and
// its comment as written, a default worked out in the model said so, and a click that puts `Params.<name>` at the
// cursor of the session's box. The model is written into the test's own copy of the fixtures (the fixtures are
// never touched): a commented field, a comment above, an expression default, an int and a long float.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-params-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  const model = join(root, 'hollow', 'hollow.py')
  const source = readFileSync(model, 'utf8')
  const fields = [
    '    side: float = 40  # Outer width, mm',
    '    wall: float = 2',
    '    # Room left round the post, 0.2 mm at least',
    '    gap: float = 0.123456',
    '    inner: float = 40 - 2 * 2  # Worked out from side and wall',
    "    ribs: int = field(default=4, metadata={'min': 1, 'max': 8})"
  ].join('\n')
  const written = source.replace(/    side: float = 40\n    wall: float = 2\n/, `${fields}\n`).replace('from dataclasses import dataclass', 'from dataclasses import dataclass, field')
  expect(written).not.toBe(source)
  writeFileSync(model, written)
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
const section = () => page.locator('.left .params')
const dock = () => page.locator('[data-region="session"]')
const composer = () => dock().locator('[data-chat-composer]')
const face = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily)

async function open(name: string): Promise<void> {
  await openListed(page, name)
  await expect.poll(async () => { const s = await state(); return s.objectId === name && s.build?.status }, { timeout: 30_000 }).toBe('ok')
}

test('a model with no Params says so in the head of its section, which does not unfold, and has no rows', async () => {
  await open('plain')
  await openSection(page, 'Parts')
  await expect(page.locator('.left .layers')).toBeVisible()
  await railButton(page, 'Parameters').click()
  await expect(cardSection(page, 'Parameters')).toContainText('none')
  await expect(cardSection(page, 'Parameters')).toHaveAttribute('data-empty', '')
  await expect(section()).toHaveCount(0)
  await expect(section().locator('[data-param]')).toHaveCount(0)
})

test('the Parameters section says its count in its head, and has a row for each field', async () => {
  await open('hollow')
  await openSection(page, 'Parameters')
  await expect(section()).toBeVisible()
  const order = await page.locator('.left .route-section').evaluateAll((els) => els.map((el) => el.getAttribute('data-section')))
  expect(order).toEqual(['needs', 'parts', 'params', 'checks', 'marks', 'scans', 'tracings', 'profile'])
  await expect(cardSection(page, 'Parameters').locator('.route-said')).toHaveText(/^5\b/)
  await expect.poll(() => section().locator('[data-param]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-param')))).toEqual(['side', 'wall', 'gap', 'inner', 'ribs'])
})

test('a row has the name and the value in the monospace face, the comment as written, and says a default is worked out in the model', async () => {
  const row = (name: string) => section().locator(`[data-param="${name}"]`)
  await expect(row('side').locator('.param-value')).toHaveText('40')
  await expect(row('side').locator('.param-doc')).toHaveText('Outer width, mm')
  // A comment above the field is the field's, a field with none shows none.
  await expect(row('gap').locator('.param-doc')).toHaveText('Room left round the post, 0.2 mm at least')
  await expect(row('wall').locator('.param-doc')).toHaveCount(0)
  await expect(row('ribs').locator('.param-value')).toHaveText('4')
  // The numbers of a comment are in the monospace face too, the words round them are not.
  await expect(row('gap').locator('.param-doc .num')).toHaveText(['0.2'])
  expect(await face('.left .param-doc .num')).toBe(await face('.left .param-value'))
  expect(await face('.left .param-value')).toContain('Mono')
  // Four digits at most, the whole value in the title.
  await expect(row('gap').locator('.param-value')).toHaveText('0.1235')
  await expect(row('gap').locator('.param-value')).toHaveAttribute('title', '0.123456')
  // An expression is worked out in the model, and its value is still shown.
  await expect(row('inner').locator('.param-worked')).toHaveText('worked out in the model')
  await expect(row('inner').locator('.param-value')).toHaveText('36')
  await expect(row('side').locator('.param-worked')).toHaveCount(0)
  // The face of the numbers: the monospace one, a name of a field too.
  expect(await face('.left .param-name')).toBe(await face('.left .param-value'))
  expect(await face('.left .param-doc')).not.toBe(await face('.left .param-value'))
})

test('a field with a range in its metadata has a gauge at the right of its row, and a field without one has none', async () => {
  const gauge = section().locator('[data-param="ribs"] svg.gauge')
  await expect(gauge).toHaveCount(1)
  await expect(gauge).toHaveAttribute('aria-label', '4, inside 1 to 8')
  expect(await gauge.evaluate((el) => `${el.getBoundingClientRect().width} x ${el.getBoundingClientRect().height}`)).toBe('64 x 16')
  // At the right of its row: its right edge is within the card's padding of the row's.
  const edges = await section().locator('[data-param="ribs"]').evaluate((li) => ({ row: li.getBoundingClientRect().right, gauge: li.querySelector('svg.gauge')!.getBoundingClientRect().right }))
  expect(edges.row - edges.gauge).toBeLessThan(16)
  await expect(section().locator('[data-param="side"] svg.gauge')).toHaveCount(0)
  await expect(section().locator('svg.gauge')).toHaveCount(1)
})

test('the head of the Print profile says what the project is made for, also while folded', async () => {
  await foldSection(page, 'Print profile')
  await expect(cardSection(page, 'Print profile').locator('.route-said')).toHaveText('none')
})

test('with no session running the rows are text, and say why', async () => {
  await expect(section().locator('button.param-button')).toHaveCount(0)
  await expect(section().locator('[data-param="wall"] .param-button')).toHaveAttribute('aria-description', 'Params.wall: float = 2. Start a session to put Params.wall in its prompt')
})

test('with a session, a click puts Params.<name> at the cursor of the box and sends nothing', async () => {
  await newSession(dock())
  await expect(dock().locator('.chat')).toBeVisible()
  await expect(composer()).toBeFocused()
  await composer().fill('make')
  const wall = section().getByRole('button', { name: 'Params.wall', exact: true })
  await expect(wall).toHaveAttribute('aria-description', "Params.wall: float = 2. Put it in the session's prompt")
  await wall.click()
  await expect(composer()).toHaveValue('make Params.wall ')
  await expect(composer()).toBeFocused()
  await page.keyboard.type('2.4')
  await expect(composer()).toHaveValue('make Params.wall 2.4')
  await expect(dock().locator('.chat-user')).toHaveCount(0)
  // Nothing was written: the model is as it was.
  expect(readFileSync(join(root, 'hollow', 'hollow.py'), 'utf8')).toContain('wall: float = 2\n')
})

test('trying a value builds the model with it, says it differs from the file, and Reset goes back; the file is never written', async () => {
  const before = (await state()).build?.revision ?? 0
  const row = section().locator('[data-param="wall"]')
  await expect(row).not.toHaveAttribute('data-tried', '')
  const box = row.getByRole('spinbutton', { name: 'Try wall' })
  await box.fill('3')
  await box.press('Enter')
  await expect(row).toHaveAttribute('data-tried', '', { timeout: 30_000 })
  await expect(row.locator('.param-differs')).toContainText('differs from the file')
  await expect(box).toHaveValue('3')
  // The file's default stays on the row, and the scene says what the build used.
  await expect(row.locator('.param-value')).toHaveText('2')
  expect((await state()).build?.revision ?? 0).toBeGreaterThan(before)
  expect(readFileSync(join(root, 'hollow', 'hollow.py'), 'utf8')).toContain('wall: float = 2\n')
  expect(JSON.parse(readFileSync(join(root, 'hollow', '.torno', 'params.json'), 'utf8'))).toEqual({ overrides: { wall: { value: 3, default: 2 } } })
  expect(readFileSync(join(root, 'hollow', '.torno', '.gitignore'), 'utf8')).toContain('params.json')
  // The agent's request to bake it in goes to the box and is not sent.
  await composer().fill('')
  await section().getByRole('button', { name: 'Ask the agent to bake it in' }).click()
  await expect(composer()).toHaveValue('Make Params.wall to 3 (the file has 2) the default in the model: I tried it in torno and want to keep it. ')
  await expect(dock().locator('.chat-user')).toHaveCount(0)
  await row.getByRole('button', { name: 'Reset wall to 2' }).click()
  await expect(row).not.toHaveAttribute('data-tried', '', { timeout: 30_000 })
  await expect(box).toHaveValue('2')
  expect(JSON.parse(readFileSync(join(root, 'hollow', '.torno', 'params.json'), 'utf8'))).toEqual({ overrides: {} })
})

test('the folding is the window\'s: it is kept when another project is opened', async () => {
  await expect(cardSection(page, 'Parameters')).not.toHaveAttribute('data-folded', '')
  await open('plain')
  await expect(cardSection(page, 'Parameters')).toContainText('none')
  await open('hollow')
  await expect(cardSection(page, 'Parameters')).not.toHaveAttribute('data-folded', '')
  await expect(section().locator('[data-param="wall"]')).toBeVisible()
  // A click on the head folds it to the head; the choice is kept by the window, not the folder.
  await foldSection(page, 'Parameters')
  await expect(section()).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('torno.column') ?? '{}').folded)).toContain('params')
  await openSection(page, 'Parameters')
})
