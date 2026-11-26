import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { benchTab, openSection } from './helpers'
import { openListed } from './objects'

// The Shelf tab of the bench (#351): the workspace's parts, each drawn from the kernel's side section at one scale, with its name, what it
// cuts, the rules of how sure its sizes are, found and filtered. The fixture workspace has one part, common/parts/ec11, which hollow does not use.
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
