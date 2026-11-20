import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { benchTab, openSection, newSession, openProfile, profileChip } from './helpers'
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
  await page.waitForSelector('[data-region="viewport"]')
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

test('a model with no Params has no Parameters tab: the bench is Parts alone, and there are no rows', async () => {
  await open('plain')
  await expect(page.locator('.left .layers')).toBeVisible()
  await expect(benchTab(page, 'Parameters')).toHaveCount(0)
  await expect(page.locator('.left .bench-tab')).toHaveCount(1)
  await expect(section()).toHaveCount(0)
  await expect(section().locator('[data-param]')).toHaveCount(0)
})

test('the Parameters tab says its count, is the bench\'s first, and has a row for each field', async () => {
  await open('hollow')
  await openSection(page, 'Parameters')
  await expect(section()).toBeVisible()
  await expect(page.locator('.left .route-section')).toHaveCount(0)
  await expect(benchTab(page, 'Parameters')).toHaveText(/^Parameters\s*5$/)
  await expect(benchTab(page, 'Parts')).toBeVisible()
  await expect.poll(() => section().locator('[data-param]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-param')))).toEqual(['side', 'wall', 'gap', 'inner', 'ribs'])
})

test('a row has the name and the value in the monospace face, the comment as written, and says a default is worked out in the model', async () => {
  const row = (name: string) => section().locator(`[data-param="${name}"]`)
  // The value is said once, in the field that takes another.
  await expect(row('side').getByRole('spinbutton', { name: 'Try side' })).toHaveValue('40')
  await expect(row('side').locator('.param-doc')).toHaveText('Outer width, mm')
  // A comment above the field is the field's, a field with none shows none.
  await expect(row('gap').locator('.param-doc')).toHaveText('Room left round the post, 0.2 mm at least')
  await expect(row('wall').locator('.param-doc')).toHaveCount(0)
  await expect(row('ribs').getByRole('spinbutton', { name: 'Try ribs' })).toHaveValue('4')
  // The numbers of a comment are in the monospace face too, the words round them are not.
  await expect(row('gap').locator('.param-doc .num')).toHaveText(['0.2'])
  expect(await face('.left .param-doc .num')).toBe(await face('.left .param-input'))
  expect(await face('.left .param-input')).toContain('Mono')
  // Four digits at most, the whole value in the title.
  await expect(row('gap').getByRole('spinbutton', { name: 'Try gap' })).toHaveValue('0.1235')
  await expect(row('gap').getByRole('spinbutton', { name: 'Try gap' })).toHaveAttribute('title', '0.123456')
  // An expression is worked out in the model, has no field, and its value is still shown, after an equals sign.
  await expect(row('inner')).toHaveAttribute('data-worked', '')
  await expect(row('inner').locator('.param-value')).toHaveText('36')
  await expect(row('inner').locator('.param-value')).toHaveAttribute('title', 'Worked out in the model')
  await expect(row('inner').locator('.param-input')).toHaveCount(0)
  expect(await row('inner').locator('.param-value').evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"="')
  await expect(row('side')).not.toHaveAttribute('data-worked', '')
  // The face of the numbers: the monospace one, a name of a field too.
  expect(await face('.left .param-name')).toBe(await face('.left .param-input'))
  expect(await face('.left .param-doc')).not.toBe(await face('.left .param-input'))
})

test('a field with a range in its metadata fills its field to where its value stands, and a field without one does not', async () => {
  const fill = section().locator('[data-param="ribs"] .param-fill')
  await expect(fill).toHaveCount(1)
  await expect(fill).toHaveAttribute('aria-label', '4, inside 1 to 8')
  // 4 in 1 to 8 is three sevenths of the field.
  const share = await fill.evaluate((el) => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width)
  expect(share).toBeGreaterThan(0.38)
  expect(share).toBeLessThan(0.46)
  await expect(section().locator('[data-param="side"] .param-fill')).toHaveCount(0)
  await expect(section().locator('.param-fill')).toHaveCount(1)
  // One line a value: a row at rest is no taller than 30 px.
  expect(await section().locator('[data-param="side"]').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(30)
})

test('the print profile chip of the status line says what the project is made for, and opens its choosers', async () => {
  await expect(page.locator('.left [data-section="profile"]')).toHaveCount(0)
  await expect(profileChip(page)).toHaveText('Print profile')
  const card = await openProfile(page)
  await expect(card.getByRole('combobox', { name: 'Printer' })).toBeVisible()
  await card.getByRole('combobox', { name: 'Material' }).selectOption('PLA')
  await expect(profileChip(page)).toHaveText('PLA')
  await card.getByRole('combobox', { name: 'Material' }).selectOption({ label: 'None' })
  await expect(profileChip(page)).toHaveText('Print profile')
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
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
  await expect(row.locator('.param-differs')).toContainText('Kept by torno, not in the model file yet. The file has 2.')
  await expect(box).toHaveValue('3')
  // A tried row stays open, the file's default is in its kept line, and the scene says what the build used.
  await expect(row).toHaveAttribute('data-open', '')
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

test('resting on a field lights the faces it drives on the model, kept until the next build, and writes nothing', async () => {
  await open('hollow')
  const lit = (): Promise<readonly string[]> => page.evaluate(() => window.__tornoTest!.highlighted().drives)
  const row = section().locator('[data-param="wall"]')
  expect(await lit()).toEqual([])
  await row.hover()
  // After half a second at rest the row says it is working, then the faces the wall drives are lit.
  await expect.poll(async () => (await lit()).length, { timeout: 60_000 }).toBeGreaterThan(0)
  await expect(row.locator('.param-drives')).toHaveCount(0)
  expect((await lit()).every((ref) => /^[a-z]+(\/F\d+)?$/.test(ref))).toBe(true)
  // Out of the row it goes out; the second rest is answered from what main kept, with no trial.
  await section().locator('[data-param="side"]').hover()
  await page.mouse.move(0, 0)
  await expect.poll(lit).toEqual([])
  const started = Date.now()
  await row.hover()
  await expect.poll(async () => (await lit()).length, { timeout: 5000 }).toBeGreaterThan(0)
  expect(Date.now() - started).toBeLessThan(4000)
  // Nothing was written: the model is the file's, and no value is tried.
  expect(readFileSync(join(root, 'hollow', 'hollow.py'), 'utf8')).toContain('wall: float = 2\n')
  await expect(row).not.toHaveAttribute('data-tried', '')
  await page.mouse.move(0, 0)
})

test('the open tab is kept for each project, by the window', async () => {
  await expect(benchTab(page, 'Parameters')).toHaveAttribute('aria-selected', 'true')
  await openSection(page, 'Parts')
  await expect(page.locator('.left .layers')).toBeVisible()
  await expect(section()).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('torno.bench') ?? '{}'))).toEqual({ hollow: 'parts' })
  await open('plain')
  await open('hollow')
  await expect(benchTab(page, 'Parts')).toHaveAttribute('aria-selected', 'true')
  await openSection(page, 'Parameters')
  await expect(section().locator('[data-param="wall"]')).toBeVisible()
})

test('find narrows the rows, / goes to it, and the tally filters by the source the comment names', async () => {
  const find = page.getByRole('textbox', { name: 'Find a value' })
  await openSection(page, 'Parts')
  await page.locator('[data-region="viewport"]').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('/')
  await expect(benchTab(page, 'Parameters')).toHaveAttribute('aria-selected', 'true')
  await expect(find).toBeFocused()
  await page.keyboard.type('ribs')
  await expect(section().locator('[data-param]')).toHaveCount(1)
  await expect(page.locator('.params-match')).toContainText('1 of 5')
  await page.keyboard.press('Escape')
  await expect(section().locator('[data-param]')).toHaveCount(5)
  // Four counts that are the filters; the fixture's five sizes name no source.
  const count = (word: string) => section().locator('.params-tally').getByRole('button', { name: new RegExp(`${word}$`) })
  await expect(section().locator('.params-tally button')).toHaveText(['5all', '0assumed', '0brief', '5no source'])
  await expect(section().locator('.params-sources')).toHaveCount(0)
  await expect(count('no source')).toHaveAttribute('title', /^No source: side, wall, gap, inner, ribs\./)
  await count('assumed').click()
  await expect(count('assumed')).toHaveAttribute('aria-pressed', 'true')
  await expect(section().locator('[data-param]')).toHaveCount(0)
  await count('no source').click()
  await expect(section().locator('[data-param]')).toHaveCount(5)
  await expect(page.locator('.params-match')).toContainText('5 of 5')
  await count('all').click()
  await expect(section().locator('[data-param]')).toHaveCount(5)
})
