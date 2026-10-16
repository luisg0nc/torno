import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { box, stl } from '../src/test/scanFixtures'

// The app is driven by single letters. After a click or an action, wherever it was, the next letter is the
// view's: it takes a tool in hand, and is never typed into what was clicked, nor swallowed by it. One walk
// through a session of work, pressing P after each step: the pin tool is in hand every time.
//
// The window is hidden; the pointer and the keys are Playwright's, on it.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-focus-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  for (const [name, at] of [['plate.stl', -10], ['floor.stl', -20]] as const) writeFileSync(join(root, name), stl(box([60, 50, 2], [0, 0, at])))
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
  await page.getByRole('button', { name: 'bracket', exact: true }).click()
  await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('ok')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const pin = () => page.locator('.tool-button[data-tool="pin"]')
const canvas = async () => (await page.locator('.viewport-canvas canvas').first().boundingBox())!
const pickFile = (path: string) => app.evaluate((_electron, path) => void ((globalThis as unknown as { __tornoMain: { pickFile: string | null } }).__tornoMain.pickFile = path), path)

/** P, as the next key after whatever was just done: the pin tool is in hand. Then it is put down again. */
async function pinIsInHand(after: string): Promise<void> {
  await page.keyboard.press('p')
  await expect(pin(), after).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(pin()).toHaveAttribute('aria-pressed', 'false')
}

/** A choice in a list, made with the pointer: pressed on, then an option taken, as a person picks one. */
async function choose(list: Locator, value: string): Promise<void> {
  await list.dispatchEvent('pointerdown')
  await list.focus()
  await list.selectOption(value)
}

test('after each step of a session of work, P takes the pin tool', async () => {
  // The view bar's buttons, and Fit.
  await page.getByRole('toolbar', { name: 'View' }).getByRole('button', { name: 'Front', exact: true }).click()
  await pinIsInHand('a standard view')
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await pinIsInHand('Fit')
  // The explode bar: its button, a direction, and together again.
  await page.getByRole('toolbar', { name: 'View' }).getByRole('button', { name: /^Explode/ }).click()
  await page.getByRole('group', { name: 'Direction' }).getByRole('button', { name: 'Z', exact: true }).click()
  await page.getByRole('toolbar', { name: 'View' }).getByRole('button', { name: /^Explode/ }).click()
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.exploded())).toBe(false)
  await pinIsInHand('the explode bar')
  // The section: cut, a number typed and kept, a click in the view while one is being typed, off.
  await page.keyboard.press('x')
  const offset = page.getByRole('textbox', { name: 'Offset in millimetres' })
  await offset.fill('3')
  await offset.press('Enter')
  await pinIsInHand('the offset kept with Enter')
  await page.keyboard.press('x')
  await offset.fill('4')
  const view = await canvas()
  await page.mouse.click(view.x + 20, view.y + view.height - 40)
  await pinIsInHand('a click in the view while a number was being typed')
  await page.getByRole('button', { name: 'Off', exact: true }).click()
  await pinIsInHand('the section taken off')
  // A view saved under a name.
  await page.getByRole('button', { name: 'Save view' }).click()
  await page.getByRole('textbox', { name: 'Name of the view' }).fill('From the front')
  await page.keyboard.press('Enter')
  await expect(page.locator('.view-chip[data-view="From the front"]')).toBeVisible()
  await pinIsInHand('a view saved')
  // The folder menu, opened and closed.
  await page.getByRole('button', { name: 'Folders' }).click()
  await expect(page.getByRole('menu', { name: 'Folders' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Folders' })).toHaveCount(0)
  await pinIsInHand('the folder menu')
  // The export sheet, put away.
  await page.getByRole('button', { name: 'Export…' }).click()
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Export' })).toHaveCount(0)
  await pinIsInHand('the export sheet')
  // The session pane made wider by its edge.
  const edge = page.getByRole('separator', { name: 'Resize session' })
  const at = (await edge.boundingBox())!
  await page.mouse.move(at.x + at.width / 2, at.y + 300)
  await page.mouse.down()
  await page.mouse.move(at.x - 40, at.y + 300, { steps: 4 })
  await page.mouse.up()
  await pinIsInHand('the session pane resized')
  // Two scans: a unit chosen on a row, and in the align bar which scan to align.
  for (const name of ['plate.stl', 'floor.stl']) {
    await pickFile(join(root, name))
    await page.getByRole('button', { name: 'Import scan…' }).click()
  }
  await expect(page.locator('.scan-row')).toHaveCount(2)
  await page.getByRole('button', { name: 'Details of S1' }).click()
  await pinIsInHand('a scan\'s detail opened')
  const unit = page.locator('.scan-row').getByRole('combobox', { name: 'Unit of S1' })
  await choose(unit, 'cm')
  await pinIsInHand('a unit chosen for a scan')
  await choose(unit, 'mm')
  await page.keyboard.press('l')
  await choose(page.getByRole('combobox', { name: 'Scan to align' }), 'S2')
  await pinIsInHand('a scan chosen to align')
  // A part switched off and on in the layers.
  await page.getByRole('button', { name: 'Show post' }).click()
  await page.getByRole('button', { name: 'Show post' }).click()
  await pinIsInHand('a part switched off and on')
})

test('a choice made with the keys keeps them: the next arrow is the list\'s', async () => {
  const unit = page.locator('.scan-row').getByRole('combobox', { name: 'Unit of S1' })
  await unit.focus()
  await unit.selectOption('cm')
  await expect(unit).toBeFocused()
  await unit.selectOption('mm')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
})
