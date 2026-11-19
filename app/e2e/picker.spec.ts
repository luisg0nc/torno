import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { benchTab, openSection } from './helpers'
import { openListed } from './objects'

// The picker (Ctrl+P): the parts of the layout and the model's values in one list, found by what is typed; Enter takes a
// part to the selection and the view, a value to the Parameters tab with its control in focus.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-picker-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  const model = join(root, 'hollow', 'hollow.py')
  const source = readFileSync(model, 'utf8')
  const written = source.replace(/    side: float = 40\n    wall: float = 2\n/, '    side: float = 40  # Outer width, mm\n    wall: float = 2\n    ribs: int = 4\n')
  expect(written).not.toBe(source)
  writeFileSync(model, written)
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const picker = () => page.getByRole('dialog', { name: 'Find a part or a value' })
const find = () => page.getByRole('combobox', { name: 'Find a part or a value' })

test('Ctrl+P brings the picker up with the parts and the values, and Esc puts it away', async () => {
  await openListed(page, 'hollow')
  await expect.poll(async () => { const s = await state(); return s.objectId === 'hollow' && s.build?.status }, { timeout: 30_000 }).toBe('ok')
  await page.locator('[data-region="viewport"]').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+p')
  await expect(picker()).toBeVisible()
  await expect(find()).toBeFocused()
  expect(await picker().locator('[data-kind="part"]').count()).toBeGreaterThan(0)
  await expect(picker().locator('[data-kind="param"]')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(picker()).toHaveCount(0)
})

test('a value taken opens the Parameters tab with its control in focus', async () => {
  await openSection(page, 'Parts')
  await page.keyboard.press('Control+p')
  await page.keyboard.type('ribs')
  await expect(picker().locator('[data-kind]')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(picker()).toHaveCount(0)
  await expect(benchTab(page, 'Parameters')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Try ribs', { exact: true })).toBeFocused()
})

test('a part taken is selected, and Alt+H hides it from the picker', async () => {
  const name = (await state()).scene!.parts[0].name
  await page.locator('[data-region="viewport"]').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+p')
  await page.keyboard.type(name)
  await page.keyboard.press('Alt+h')
  await expect.poll(async () => (await state()).layers[name]?.visible).toBe(false)
  await expect(picker().locator(`[data-kind="part"][data-hidden]`)).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(picker()).toHaveCount(0)
  await expect.poll(async () => (await state()).selection).toEqual([name])
  expect((await state()).layers[name]?.visible).not.toBe(false)
})

test('a value taken shows the column if it was hidden', async () => {
  await page.locator('[data-region="viewport"]').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+Shift+L')
  await expect.poll(async () => (await state()).leftOpen).toBe(false)
  await page.keyboard.press('Control+p')
  await page.keyboard.type('ribs')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await state()).leftOpen).toBe(true)
  await expect(page.getByLabel('Try ribs', { exact: true })).toBeFocused()
})
