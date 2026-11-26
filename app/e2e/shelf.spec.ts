import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { benchTab, newSession, openSection, switchTab } from './helpers'
import { openListed } from './objects'

// The Shelf tab of the bench (#351): the workspace's parts, each drawn from the kernel's side section at one scale, with its name, what it
// cuts, the rules of how sure its sizes are, found and filtered; and the page of a part opened in the view (#352): its drawing, its ledger of
// sizes and "I measured it". The fixture workspace has one part, common/parts/ec11, which hollow does not use.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-shelf-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
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
const shelf = () => page.locator('.left .shelf-tab')
const row = () => shelf().locator('[data-part="ec11"]')
const chip = (id: string) => shelf().locator(`.shelf-chip[data-filter="${id}"]`)

test('a workspace with a part on its shelf has the tab "Shelf 1", after Parameters and Parts', async () => {
  await openListed(page, 'hollow')
  await expect.poll(async () => { const s = await state(); return s.objectId === 'hollow' && s.build?.status }, { timeout: 30_000 }).toBe('ok')
  await expect(page.locator('.left .bench-tab')).toHaveText([/^Parameters\s*\d+$/, /^Parts\s*\d+$/, /^Shelf\s*1$/])
  await expect(benchTab(page, 'Shelf')).toHaveText(/^Shelf\s*1$/)
})

test('the tab lists the part under "Not in this project": its picture, its name, what it cuts, and no count, since hollow does not use it', async () => {
  await openSection(page, 'Shelf')
  await expect(shelf()).toBeVisible()
  await expect(row()).toBeVisible()
  await expect(row().locator('.shelf-name')).toHaveText('EC11 rotary encoder')
  await expect(shelf().locator('.shelf-group-title')).toHaveText([/^Not in this project\s*1$/])
  await expect(row().locator('.shelf-hole')).toHaveText('hole Ø7.2')
  // The numbers are in the face of numbers, the words are not.
  const face = (selector: string) => row().locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily)
  expect(await face('.shelf-hole .num')).toContain('Mono')
  expect(await face('.shelf-name')).not.toContain('Mono')
  await expect(row().locator('.shelf-used')).toHaveText('')
  await expect(shelf().locator('.shelf-foot')).toContainText('All at one scale. From common/parts/, which Claude keeps.')
  await expect(shelf().locator('.shelf-foot')).toContainText('Drag a part onto the model, or drop a datasheet, STEP or photo here.')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('torno.bench') ?? '{}'))).toEqual({ hollow: 'shelf' })
})

test('the picture is the part\'s side section at 1.25 px a mm, as a path of its own, and the rules say how sure its sizes are', async () => {
  const svg = row().locator('svg.shelf-draw')
  // The EC11's body: 12 mm across, 6.5 mm below the panel and the 15 mm shaft above it.
  await expect(svg).toHaveAttribute('width', '15')
  await expect(svg).toHaveAttribute('height', '26.875')
  expect(await svg.locator('path').getAttribute('d')).toMatch(/^M[\d. ]+(L[\d. ]+)+Z/)
  expect(await svg.locator('path').getAttribute('fill-rule')).toBe('evenodd')
  // Seven sizes: three with a datasheet, the body's width measured, two assumed, the hole worked out.
  await expect(row().locator('.shelf-rules i')).toHaveClass(['r-so', 'r-so', 'r-so', 'r-ck', 'r-as', 'r-mo', 'r-as'])
  await expect(row().locator('.shelf-rules')).toHaveAttribute('title', '7 sizes: 5 with a source, 2 assumed, 1 checked on the part')
})

test('the chips count the parts, and filter them', async () => {
  await expect(shelf().locator('.shelf-chip')).toHaveText(['All 1', 'In this project 0', 'Assumed sizes 1'])
  await expect(chip('all')).toHaveAttribute('aria-pressed', 'true')
  await chip('here').click()
  await expect(chip('here')).toHaveAttribute('aria-pressed', 'true')
  await expect(row()).toHaveCount(0)
  await expect(shelf().locator('.shelf-none')).toHaveText('No part matches')
  await chip('assumed').click()
  await expect(row()).toBeVisible()
  await chip('all').click()
  await expect(row()).toBeVisible()
})

test('find looks in the name, what it is and the value of a size, and Escape clears it', async () => {
  const find = page.getByRole('textbox', { name: 'Find a part or a size' })
  await find.fill('rotary')
  await expect(row()).toBeVisible()
  await find.fill('7.2')
  await expect(row()).toBeVisible()
  await find.fill('zzz')
  await expect(row()).toHaveCount(0)
  await expect(shelf().locator('.shelf-none')).toHaveText('No part matches')
  await find.press('Escape')
  await expect(find).toHaveValue('')
  await expect(row()).toBeVisible()
})

test('a row is a button: a click lights it and chooses the part', async () => {
  await expect(row()).toHaveJSProperty('tagName', 'BUTTON')
  await row().click()
  await expect(row()).toHaveClass(/\bhot\b/)
  expect((await state()).shelfOpen).toBe('ec11')
})

// ---- the part opened in the view (#352) ----

const pagePart = () => page.locator('main.viewport .part-page[data-part-page="ec11"]')
const partSwitch = () => page.locator('.pboard-switch .pboard-part')
const size = (name: string) => pagePart().locator(`.part-row[data-size="${name}"]`)
const stored = (key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), key)
const checkedFile = () => join(root, 'common', 'parts', 'ec11', '.torno', 'checked.json')

test('the row opened the part: its page is in the view, its id is a tab of the switch with a ×, and the window keeps which', async () => {
  await expect(pagePart()).toBeVisible()
  await expect(partSwitch()).toHaveText('ec11')
  await expect(partSwitch().locator('.pboard-part-button')).toHaveAttribute('aria-pressed', 'true')
  await expect(partSwitch().getByRole('button', { name: 'Close ec11' })).toBeVisible()
  // The id is in the face of numbers; the switch's other tabs are not.
  expect(await partSwitch().locator('.pboard-part-id').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')
  await expect(page.locator('.pboard-switch .pboard-switch-button[aria-pressed="true"]')).toHaveCount(0)
  expect(await stored('torno.board.shown')).toEqual({ hollow: 'part' })
  expect(await stored('torno.board.part')).toEqual({ hollow: 'ec11' })
})

test('the page has its name, what it is and its file in mono, and asks Claude about it by putting words in the box', async () => {
  await expect(pagePart().locator('h1')).toHaveText('EC11 rotary encoder')
  await expect(pagePart().locator('.part-meta')).toContainText('Alps-style rotary encoder')
  await expect(pagePart().locator('.part-meta .file')).toHaveText('common/parts/ec11/part.py')
  expect(await pagePart().locator('.part-meta .file').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')
  expect(await pagePart().locator('h1').evaluate((el) => getComputedStyle(el).fontFamily)).not.toContain('Mono')
  expect(await pagePart().locator('h1').evaluate((el) => getComputedStyle(el).fontSize)).toBe('22px')
  // Placing is the next piece: the button is there and says so.
  await expect(pagePart().getByRole('button', { name: 'Place on the model' })).toHaveAttribute('aria-disabled', 'true')
  await expect(pagePart().getByRole('button', { name: 'Place on the model' })).toHaveAttribute('title', 'Placing comes next')
})

test('the drawing has the four dimensions of the kernel\'s numbers, each in the line style of its size', async () => {
  const svg = pagePart().locator('svg.part-drawing')
  await expect(svg).toBeVisible()
  await expect(svg).toHaveAttribute('aria-label', /^EC11 rotary encoder, through a panel: cutout Ø 7\.2, 15 above the panel, 6\.5 below it, 12 wide$/)
  // The cutout is dimensioned twice, on the side section and from above.
  const dims = svg.locator('g[data-dim]')
  await expect(dims).toHaveCount(5)
  expect(await dims.evaluateAll((els) => els.map((el) => [el.getAttribute('data-dim'), el.textContent, el.getAttribute('data-style'), el.getAttribute('data-param')]))).toEqual([
    ['cutout', 'Ø 7.2', 'mo', 'hole_d'],
    ['above', '15', 'so', 'shaft_h'],
    ['below', '6.5', 'as', 'body_h'],
    ['width', '12', 'ck', 'body_w'],
    ['cutout', 'Ø 7.2', 'mo', 'hole_d']
  ])
  // A measured size is green with a ring tick; an assumed one is dashed.
  await expect(svg.locator('g[data-dim="width"] .okmark')).toHaveCount(1)
  await expect(svg.locator('g[data-dim="below"] .okmark')).toHaveCount(0)
  expect(await svg.locator('g[data-dim="below"] path:not(.ext):not(.tk)').evaluate((el) => getComputedStyle(el).strokeDasharray)).not.toBe('none')
  expect(await svg.locator('g[data-dim="above"] path:not(.ext):not(.tk)').evaluate((el) => getComputedStyle(el).strokeDasharray)).toBe('none')
  expect(await svg.locator('g[data-dim="width"] text').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')
  // The part, the panel in two pieces (the hole is between them), the keep-out and the cutout from above.
  await expect(svg.locator('path.body')).toHaveCount(1)
  await expect(svg.locator('.panel rect:not(.panel-hatch)')).toHaveCount(2)
  await expect(svg.locator('path.keep')).toHaveCount(2)
  await expect(svg.locator('text.klab')).toHaveText('keep clear')
  await expect(svg.locator('.cutplan .plab')).toHaveText('the cutout, from above')
  await expect(pagePart().locator('.part-legend')).toContainText('datasheet, listing, standard')
  await expect(pagePart().locator('.part-legend')).toContainText('measured on the part')
  await expect(pagePart().locator('.part-legend')).toContainText('assumed')
})

test('the ledger has a row for each of the seven sizes: the value with its unit, the words, the source, and what can be done', async () => {
  await expect(pagePart().locator('.part-row')).toHaveCount(7)
  await expect(size('hole_d').locator('.val')).toHaveText('7.2mm')
  await expect(size('shaft_h').locator('.what')).toContainText('the shaft above the panel')
  await expect(size('shaft_h').locator('.word')).toHaveText('datasheet EC11')
  await expect(size('body_h').locator('.word')).toHaveText('assumed')
  expect(await size('body_h').locator('.word').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')
  await expect(size('hole_d').locator('.end')).toHaveText('from the maker')
  await expect(size('body_h').getByRole('button', { name: 'I measured it…' })).toBeVisible()
  await expect(size('shaft_h').getByRole('button', { name: 'I measured it…' })).toBeVisible()
  await expect(size('hole_d').getByRole('button')).toHaveCount(0)
})

test('"I measured it…" turns the row into You measured [value] mm, with the value in the field and the keys in it; Escape puts it back', async () => {
  await size('body_h').getByRole('button', { name: 'I measured it…' }).click()
  const field = size('body_h').getByRole('textbox')
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('6.5')
  await expect(size('body_h')).toContainText('You measured')
  await expect(size('body_h').getByRole('button', { name: 'Ask Claude to change it' })).toBeEnabled()
  await expect(size('body_h').getByRole('button', { name: 'Cancel' })).toBeVisible()
  expect(await field.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')
  // A value that is no size cannot be asked.
  await field.fill('abc')
  await expect(size('body_h').getByRole('button', { name: 'Ask Claude to change it' })).toBeDisabled()
  await field.press('Escape')
  await expect(size('body_h').getByRole('textbox')).toHaveCount(0)
  await expect(size('body_h').getByRole('button', { name: 'I measured it…' })).toBeVisible()
  expect(existsSync(checkedFile())).toBe(false)
})

test('Ask Claude to change it writes the value and today into the part\'s .torno/checked.json, marks the size checked, and puts the request in the box without sending it', async () => {
  await newSession(page.locator('[data-region="session"]'))
  const composer = page.locator('[data-region="session"] [data-chat-composer]')
  await expect(composer).toBeVisible()
  await size('body_h').getByRole('button', { name: 'I measured it…' }).click()
  await size('body_h').getByRole('textbox').fill('6.6')
  await size('body_h').getByRole('button', { name: 'Ask Claude to change it' }).click()
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  await expect.poll(() => existsSync(checkedFile())).toBe(true)
  expect(JSON.parse(readFileSync(checkedFile(), 'utf8'))).toEqual({ body_h: { value: 6.6, date: today } })
  // The row says checked, with the value it was checked at (the part still says 6.5), and the drawing's line for it is green.
  await expect(size('body_h').locator('.ckd')).toContainText('checked')
  await expect(size('body_h').locator('.ckd')).toContainText('at 6.6')
  await expect(size('body_h').getByRole('button')).toHaveCount(0)
  await expect(pagePart().locator('g[data-dim="below"]')).toHaveAttribute('data-style', 'ck')
  await expect(pagePart().locator('g[data-dim="below"] .okmark')).toHaveCount(1)
  await expect(composer).toHaveValue("In the shelf's ec11, set body_h to 6.6: I measured it on the part. Make its comment measured. ")
  // Never sent: no turn of the chat holds it.
  await expect(page.locator('[data-region="session"] .chat-turn, [data-region="session"] .chat-text')).toHaveCount(0)
})

test('the tab of the shelf says the size is checked now, and the part still reads 6.5 in its file', async () => {
  await openSection(page, 'Shelf')
  await expect(row().locator('.shelf-rules')).toHaveAttribute('title', '7 sizes: 6 with a source, 1 assumed, 2 checked on the part')
  expect(readFileSync(join(root, 'common', 'parts', 'ec11', 'part.py'), 'utf8')).toContain('body_h: float = 6.5')
})

test('Ask Claude about it puts the first words in the box', async () => {
  const composer = page.locator('[data-region="session"] [data-chat-composer]')
  await composer.fill('')
  await pagePart().getByRole('button', { name: 'Ask Claude about it' }).click()
  await expect(composer).toHaveValue("About the shelf's ec11: ")
  await composer.fill('')
})

test('Model shows the model and leaves the tab; the tab shows the part again; × closes it back to the model', async () => {
  await switchTab(page, 'Model').click()
  await expect(pagePart()).toHaveCount(0)
  await expect(partSwitch()).toBeVisible()
  expect(await stored('torno.board.shown')).toEqual({ hollow: 'model' })
  await partSwitch().locator('.pboard-part-button').click()
  await expect(pagePart()).toBeVisible()
  await partSwitch().getByRole('button', { name: 'Close ec11' }).click()
  await expect(pagePart()).toHaveCount(0)
  await expect(partSwitch()).toHaveCount(0)
  await expect(switchTab(page, 'Model')).toHaveAttribute('aria-pressed', 'true')
  expect((await state()).shelfOpen).toBeNull()
  expect(await stored('torno.board.part')).toEqual({})
  await expect(row()).not.toHaveClass(/\bhot\b/)
})

test('Enter on a row opens the part, and the part leaving the shelf closes its page', async () => {
  await row().focus()
  await page.keyboard.press('Enter')
  await expect(pagePart()).toBeVisible()
  await expect(partSwitch()).toHaveText('ec11')
  rmSync(join(root, 'common', 'parts', 'ec11'), { recursive: true, force: true })
  await expect(pagePart()).toHaveCount(0, { timeout: 15_000 })
  await expect(partSwitch()).toHaveCount(0)
  await expect(switchTab(page, 'Model')).toHaveAttribute('aria-pressed', 'true')
  expect((await state()).shelfOpen).toBeNull()
})
