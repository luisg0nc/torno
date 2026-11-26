import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { openSection } from './helpers'
import { openListed } from './objects'

// Renaming a part from the Parts tab (#359): torno writes the new name into the model, builds again, keeps what the
// window had of the part under its new name and leaves a notice for Claude's next prompt. A name it will not take is said
// under the field, and nothing is written.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-rename-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
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
const model = (): string => readFileSync(join(root, 'grouped', 'grouped.py'), 'utf8')
const names = async (): Promise<string[]> => {
  const s = await state()
  return s.scene!.parts.filter((p) => p.layout === s.layout).map((p) => p.name)
}

test('a part renamed in the Parts tab is renamed in the model, and what the window had of it follows', async () => {
  await openListed(page, 'grouped')
  await expect.poll(async () => { const s = await state(); return s.objectId === 'grouped' && s.build?.status }, { timeout: 30_000 }).toBe('ok')
  await openSection(page, 'Parts')
  // Switched off first: the setting is the part's, by its name, and goes with it.
  await page.getByRole('button', { name: 'Show key', exact: true }).click()
  await expect(page.locator('[data-layer="key"]')).toHaveAttribute('data-hidden', '')
  const before = (await state()).revision
  await page.locator('[data-layer="key"]').hover()
  await page.getByRole('button', { name: 'Rename key', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'New name of key' })
  await expect(field).toBeFocused()
  await field.fill('front key')
  await field.press('Enter')
  await expect.poll(model).toContain('"front key": Pos(0, 30, 0)')
  expect(model()).not.toContain('"key"')
  await expect.poll(async () => (await state()).revision, { timeout: 30_000 }).toBeGreaterThan(before)
  await expect.poll(names).toContain('front key')
  await expect(page.locator('[data-layer="front key"]')).toHaveAttribute('data-hidden', '')
  const notice = JSON.parse(readFileSync(join(root, 'grouped', '.torno', 'renamed.json'), 'utf8')) as { renames: Array<{ from: string; to: string; files: string[] }> }
  expect(notice.renames).toMatchObject([{ from: 'key', to: 'front key', files: ['grouped.py'] }])
})

test('F2 on a name makes it a field; a name that is taken is refused under it, and Esc leaves it as it was', async () => {
  const text = model()
  await page.locator('[data-layer="flat-b"] .layer-name').focus()
  await page.keyboard.press('F2')
  const field = page.getByRole('textbox', { name: 'New name of flat-b' })
  await expect(field).toBeFocused()
  await field.fill('flat-a')
  await field.press('Enter')
  await expect(page.locator('[data-layer="flat-b"] [role="alert"]')).toHaveText('flat-a is already the name of a part or a group.')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(page.locator('[data-layer="flat-b"] .layer-name')).toHaveText('flat-b')
  expect(model()).toBe(text)
})

test('a part named in groups(p) is renamed there too, and the group still holds it', async () => {
  await page.locator('[data-layer="flat-a"]').hover()
  await page.getByRole('button', { name: 'Rename flat-a', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'New name of flat-a' })
  await field.fill('base')
  await field.press('Enter')
  await expect.poll(model).toContain('"flat": ["base", "flat-b"]')
  await expect.poll(async () => (await state()).scene?.groups?.find((g) => g.name === 'flat')?.parts, { timeout: 30_000 }).toEqual(['base', 'flat-b'])
  await expect(page.locator('[data-in-group="flat"][data-layer="base"]')).toHaveCount(1)
  expect(existsSync(join(root, 'grouped', '.torno', 'renamed.json'))).toBe(true)
})
