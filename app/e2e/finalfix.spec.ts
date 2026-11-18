import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inTerminal } from './terminal'
import type { TornoState } from '../src/renderer/state/store'
import { EXAMPLE_NOTE } from '../src/shared/workspace'
import { openSection, railButton } from './helpers'
import { openListed } from './objects'

// The final fix wave of Milestone 5, through the hidden window: what was made easier to use (a real Rebuild,
// a cut at once, fields that give the keys back, the line that says what the next prompt carries), the folder
// menu, and the sheet of keys as a dialog.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let home: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-finalfix-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-finalfix-home-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  inTerminal(root)
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it. The config is the test's own.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root, TORNO_CONFIG: join(home, 'config.json'), TORNO_AGENT_CMD: `node ${fakeAgent}` } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const tool = (): Promise<string | null> => page.locator('.toolbox [aria-pressed="true"]').first().getAttribute('data-tool')
const focused = (): Promise<string> => page.evaluate(() => document.activeElement?.tagName ?? '')
const canvas = () => page.locator('[data-region="viewport"] canvas').first()

async function open(id: string): Promise<void> {
  await openListed(page, id)
  await expect.poll(async () => ((await state()).objectId === id ? (await state()).build?.status : null), { timeout: 30_000 }).toBe('ok')
  await expect.poll(async () => (await state()).scene !== null).toBe(true)
}

test('Rebuild builds the open object again: the button in the status line, and its key from anywhere', async () => {
  await open('hollow')
  const first = (await state()).build!.revision
  const button = page.locator('[data-region="status"]').getByRole('button', { name: 'Rebuild' })
  await expect(button).toBeVisible()
  await expect(button).not.toHaveAttribute('data-primary', '')
  await button.click()
  await expect.poll(async () => (await state()).build?.revision, { timeout: 30_000 }).toBe(first + 1)
  await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('ok')
  await canvas().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+Shift+B')
  await expect.poll(async () => (await state()).build?.revision, { timeout: 30_000 }).toBe(first + 2)
  await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('ok')
})

test('X cuts at once, through the middle of the parts and open towards the viewer; Enter and Escape in its field give the keys back to the view', async () => {
  expect((await state()).section).toBeNull()
  const camera = await page.evaluate(() => window.__tornoTest!.camera())
  await canvas().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('x')
  const cut = (await state()).section!
  expect(cut).not.toBeNull()
  // Across one axis, and the half taken away (the side the normal points to) is the one the camera is on.
  const axis = cut.normal.findIndex((c) => Math.abs(c) === 1)
  expect(axis).toBeGreaterThanOrEqual(0)
  expect(Math.sign(cut.normal[axis])).toBe(Math.sign(camera.position[axis] - camera.target[axis]) || 1)
  // To the hundredth of a millimetre, where the middle of the parts is.
  for (const c of cut.origin) expect(Math.abs(c * 100 - Math.round(c * 100))).toBeLessThan(1e-6)
  // Pressed again with a cut there, nothing is cut anew.
  expect(await tool()).toBe('section')

  // The offset typed and kept with Enter: the plane moves, and the next letter is a tool's, not a figure in the field.
  const field = page.getByLabel('Plane position in millimetres')
  await field.click()
  await field.fill('2')
  await page.keyboard.press('Enter')
  expect(await focused()).toBe('BODY')
  const moved = (await state()).section!
  expect(Math.abs(moved.origin[axis] - cut.origin[axis])).toBeCloseTo(2, 6)
  await page.keyboard.press('p')
  expect(await tool()).toBe('pin')
  // Escape leaves the field as it was and gives the keys back as well.
  await field.click()
  await field.fill('9')
  await page.keyboard.press('Escape')
  expect(await focused()).toBe('BODY')
  expect((await state()).section).toEqual(moved)
  await expect(field).toHaveValue('2')
  // The bar's own axis opens towards the viewer too: across Y from the standard view it is the -Y half that goes.
  await page.getByRole('group', { name: 'Plane across an axis' }).getByRole('button', { name: 'Y' }).click()
  const acrossY = (await state()).section!
  expect(acrossY.normal).toEqual([0, Math.sign(camera.position[1] - camera.target[1]) || 1, 0])
  await page.getByRole('toolbar', { name: 'Section' }).getByRole('button', { name: 'Off' }).click()
  await page.keyboard.press('Escape')
  expect((await state()).section).toBeNull()
})

test('E on an object of one part opens no bar: the button says why for a moment', async () => {
  await open('measures')
  await canvas().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('e')
  await expect(page.locator('.explode-said')).toHaveText('One part: nothing to draw apart')
  await expect(page.locator('[data-tag="explode"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Explode' }).click()
  await expect(page.locator('[data-tag="explode"]')).toHaveCount(0)
  await expect(page.locator('.explode-said')).toHaveText('One part: nothing to draw apart')
})

test('the session pane says what goes with the next prompt, before a session and with one', async () => {
  await open('hollow')
  const next = page.locator('.session-next')
  await expect(next).toHaveCount(0)
  await page.evaluate(async () => {
    const hooks = window.__tornoTest!
    for (const fx of [0.5, 0.45, 0.55, 0.4, 0.6]) for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6]) {
      const hit = hooks.pickAt(fx, fy, { edges: false, partsOnly: true })
      if (!hit) continue
      const { layout, revision } = hooks.state()
      await window.torno.marks.add('hollow', { kind: 'pin', author: 'user', note: 'here', layout, revision, camera: hooks.camera(), anchor: { point: hit.point, part: hit.part, ref: hit.ref } } as never)
      return
    }
    throw new Error('no part is drawn near the middle of the canvas')
  })
  await expect(next).toHaveText('1 mark is not sent yet: start a session, and it goes with your first prompt')
  await page.getByRole('button', { name: 'New session' }).first().click()
  await expect(next).toHaveText('1 mark goes with your next prompt')
  // Its number is set in the face of numbers.
  expect(await next.locator('.num').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Martian Mono')
  // Sent with a prompt, there is nothing more to say.
  await expect.poll(() => page.evaluate(() => window.__tornoTerm!.text())).toContain('READY')
  await page.locator('.session-term textarea').focus()
  await page.keyboard.type('hook')
  await page.keyboard.press('Enter')
  await expect(next).toHaveCount(0)
})

test('the folder button opens a menu: the folders opened lately, the dialog and the example; the page of objects keeps the marks and puts the layers away', async () => {
  // The folder torno was started with is one opened lately.
  await expect.poll(() => { try { return JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).recent } catch { return null } }).toEqual([root])
  // The folder crumb is in the title bar.
  const button = page.getByRole('button', { name: /^Folder / })
  await button.click()
  const menu = page.getByRole('menu', { name: 'Folders' })
  await expect(menu).toBeVisible()
  // Whole when it comes: never the dialog alone first, with the list arriving after.
  expect(await menu.getByRole('menuitem').count()).toBe(4)
  await expect(menu.getByRole('menuitem')).toHaveText([/torno-e2e-finalfix-/, 'Open folder…', 'Open the example', 'Check what torno needs'])
  // The open one is marked, and is not to be opened again.
  await expect(menu.locator('.folder-row[data-open]')).toContainText('current')
  await expect(menu.getByRole('menuitem').first()).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(button).toBeFocused()
  await expect(page.locator('.workspace-example')).toHaveCount(0)

  // While the page of objects is up the sections of the card act on a view that is not there: the card is away.
  await openSection(page, 'Parts')
  await expect(page.getByRole('region', { name: 'Parts' })).toBeVisible()
  await canvas().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('w')
  await expect.poll(async () => (await state()).page).toBe('objects')
  await expect(page.getByRole('region', { name: 'Parts' })).toHaveCount(0)
  await expect(railButton(page, 'Parts')).toHaveCount(0)
  await expect(page.locator('[data-region="left"] .route-card')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await state()).page).toBe('object')
  await expect(railButton(page, 'Parts')).toBeVisible()
})

test('the sheet of keys is a dialog: a click inside it keeps the keys in it, and it is counted aloud, not read out', async () => {
  await canvas().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('?')
  const sheet = page.getByRole('dialog', { name: 'Keys' })
  await expect(sheet).toBeVisible()
  const before = await tool()
  // A click on a line of the list under the keyboard: the focus stays within the sheet, and a letter takes no tool behind it.
  await sheet.locator('.keys-chords li span').last().click()
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-label'))).toBe('Keys')
  await page.keyboard.press('a')
  expect(await tool()).toBe(before)
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('[aria-live]')).toHaveCount(1)
  await expect(sheet.locator('.keys-count')).toHaveAttribute('aria-live', 'polite')
  await expect(sheet.locator('.keys-count')).toContainText('keys')
  // It rises from the foot, 400 px high, and a scrim fades in above it: not a centred sheet.
  const box = (await sheet.boundingBox())!
  const win = await page.evaluate(() => [window.innerWidth, window.innerHeight])
  expect(box.height).toBe(400)
  expect(Math.round(box.y + box.height)).toBe(win[1] - 28)
  expect(await page.locator('.keys-layer').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient')
  // The rail and the status line stay: the keyboard does not cover them.
  expect(Math.round(box.x)).toBe(52)
  // What is not in a chip is found by a search: the keys for working on torno, in a sentence.
  await sheet.getByRole('textbox').fill('developer')
  await expect(sheet.locator('.keys-said').last()).toContainText('are developer tools.')
  await sheet.getByRole('button', { name: 'With a tool in hand' }).click()
  await expect(sheet).toContainText('Shift+Arrows')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  expect(await tool()).toBe(before)
})

// Re-review I-1: the sheet was 989 px high whatever the window, and nothing in it scrolled. The window is no lower than 700 px; the keyboard is 400.
test('the sheet of keys ends inside the window, and its list under the keyboard stays within it and scrolls when it is longer', async () => {
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 700))
  try {
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(700)
    await canvas().click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('?')
    const sheet = page.getByRole('dialog', { name: 'Keys' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Everywhere' }).click()
    const box = (await sheet.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(700)
    // The list under the keyboard ends within the sheet and is the one that scrolls: the sheet itself never does.
    const list = sheet.locator('.keys-chords')
    const inside = (await list.boundingBox())!
    expect(inside.y + inside.height).toBeLessThanOrEqual(box.y + box.height)
    expect(await list.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto')
    expect(await sheet.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)
    expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  } finally {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), size)
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(size[1])
  }
})

test('Rebuild takes no press while a build runs: it says Building, and the key starts nothing over', async () => {
  // An object whose model takes a minute.
  await openListed(page, 'slow')
  await expect.poll(async () => ((await state()).objectId === 'slow' ? (await state()).build?.status : null)).toBe('building')
  const started = (await state()).build!.startedAt
  expect(started).toBeGreaterThan(0)
  const button = page.locator('[data-region="status"] .status-rebuild')
  await expect(button).toHaveText('Building…')
  await expect(button).toBeDisabled()
  await page.keyboard.press('Control+Shift+B')
  // Asked of main outright as well: it starts none either.
  await page.evaluate(() => window.torno.object.rebuild('slow'))
  await page.waitForTimeout(500)
  // The build under way is the one that was: it was not started over.
  expect((await state()).build).toMatchObject({ status: 'building', startedAt: started })
  await open('hollow')
  await expect(button).toHaveText('Rebuild')
  await expect(button).toBeEnabled()
})

test('a folder that went away after the menu was read is said not to open, under the folder button, until the next action', async () => {
  // A folder of the list that is there when the menu is read, and gone when it is chosen: an unmounted disk.
  const gone = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-finalfix-gone-'))
  writeFileSync(join(home, 'config.json'), JSON.stringify({ workspace: root, recent: [root, gone] }))
  const folders = page.getByRole('button', { name: /^Folder / })
  await folders.click()
  const row = page.getByRole('menu', { name: 'Folders' }).getByRole('menuitem', { name: new RegExp(basename(gone)) })
  await expect(row).toBeEnabled()
  rmSync(gone, { recursive: true, force: true })
  await row.click()
  const said = page.getByRole('alert').filter({ hasText: 'could not be opened' })
  // A session may run here, and leaving then asks first (it would end it): the folder is asked for once that is answered.
  const leave = page.getByRole('alertdialog').getByRole('button', { name: 'Open another folder' })
  await expect(leave.or(said)).toBeVisible()
  if (await leave.isVisible()) await leave.click()
  await expect(said).toHaveText(new RegExp(`^${basename(gone)} could not be opened: .+`))
  // The workspace is as it was.
  expect((await state()).workspace!.root).toBe(root)
  // The next action takes it away.
  await folders.click()
  await page.getByRole('menu', { name: 'Folders' }).getByRole('menuitem', { name: 'Open folder…' }).click()
  await expect(said).toHaveCount(0)
  // With a session here that asks first: it stays.
  const stay = page.getByRole('alertdialog').getByRole('button', { name: 'Stay here' })
  if (await stay.isVisible()) await stay.click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect((await state()).workspace!.root).toBe(root)
})

test('the example says for as long as it is open that it is a temporary copy', async () => {
  await page.getByRole('button', { name: /^Folder / }).click()
  await page.getByRole('menu', { name: 'Folders' }).getByRole('menuitem', { name: 'Open the example' }).click()
  // A session runs here (the stand-in says nothing of being at work once it has answered): leaving may ask first.
  const leave = page.getByRole('button', { name: 'Open another folder' })
  if (await leave.isVisible().catch(() => false)) await leave.click()
  await expect(page.locator('.workspace-example')).toContainText(EXAMPLE_NOTE)
  expect(EXAMPLE_NOTE).toBe('A temporary copy: it is removed when torno quits')
  expect((await state()).workspace!.example).toBe(true)
})
