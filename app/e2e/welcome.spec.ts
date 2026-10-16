import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { EXAMPLE_OBJECTS } from '../src/main/example'
import { KEYS } from '../src/shared/keys'

// The first screen, and the sheet of keys: what someone who has never seen torno meets, and where they look a key up.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

type Main = { pickFolder: string | null; picks: number }
const temp = (name: string): string => mkdtempSync(join(realpathSync(tmpdir()), `torno-e2e-${name}-`))

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
const launch = (env: Record<string, string> = {}): Promise<ElectronApplication> => electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, ...env } })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = temp('welcome')
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await launch({ TORNO_WORKSPACE: root })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const tool = (): Promise<string | null> => page.locator('.toolbox [aria-pressed="true"]').first().getAttribute('data-tool')
const sheet = () => page.getByRole('dialog', { name: 'Keys' })

async function open(id: string): Promise<void> {
  await page.getByRole('button', { name: id, exact: true }).click()
  await expect.poll(async () => ((await state()).objectId === id ? (await state()).build?.status : null), { timeout: 30_000 }).toBe('ok')
  await expect.poll(async () => (await state()).scene !== null).toBe(true)
}

test('the first run shows what to open and how a folder of objects is laid out, and a folder with nothing in it says what to make', async () => {
  const bare = await launch()
  const empty = temp('empty')
  try {
    const first = await bare.firstWindow()
    expect(await bare.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    const says = first.locator('[data-region="viewport"]')
    await expect(says).toContainText('Make CAD parts with an AI agent: it writes the model, you point at what to change.')
    const tree = first.getByRole('figure', { name: 'How a folder of objects is laid out' })
    await expect(tree.locator('.num')).toHaveText(['objects/', 'bracket/', 'bracket.py'])
    await expect(tree).toContainText('the folder you open')
    await expect(says).toContainText('An empty folder is fine: torno helps you make the first object.')
    await expect(says).toContainText('A temporary copy, removed when torno quits.')
    await expect(says).toContainText('torno writes only into a .torno folder inside each object.')
    await expect(says).not.toContainText('for the keys')
    // The main way in is the one primary button; the example is a quiet one.
    await expect(first.locator('.welcome-page .button-primary')).toHaveText(['Open folder'])
    await expect(first.getByRole('button', { name: 'Open the example' })).toHaveClass(/button-quiet/)
    // Over the name, the logo as the icon has it: the vise in the ink, the part it holds in the accent.
    await expect(first.locator('.welcome-head').getByRole('heading', { name: 'torno', level: 1 })).toBeVisible()
    const logo = await first.evaluate(() => {
      const probe = document.createElement('i')
      document.body.append(probe)
      const token = (name: string): string => ((probe.style.color = `var(${name})`), getComputedStyle(probe).color)
      const [accent, ink] = [token('--accent'), token('--ink')]
      probe.remove()
      const svg = document.querySelector('.welcome-head svg.logo')
      const part = svg?.querySelectorAll('.logo-part')
      return { parts: part?.length, part: part?.[0] && getComputedStyle(part[0]).fill, vise: svg && getComputedStyle(svg).color, accent, ink }
    })
    expect(logo).toEqual({ parts: 1, part: logo.accent, vise: logo.ink, accent: logo.accent, ink: logo.ink })
    // Run from the repository it has its example beside it; with no folder ever opened there is no list.
    await expect(first.getByRole('button')).toHaveText(['Open folder', 'Open the example'])
    await expect(first.getByRole('navigation', { name: 'Recent folders' })).toHaveCount(0)
    // The keys are there before any folder is.
    await first.keyboard.press('?')
    await expect(first.getByRole('dialog', { name: 'Keys' })).toBeVisible()
    await first.keyboard.press('Escape')
    await expect(first.getByRole('dialog', { name: 'Keys' })).toBeHidden()
    // The dialog is main's test hook under TORNO_TEST: a folder with nothing in it says what to make.
    await bare.evaluate((_e, folder) => void ((globalThis as unknown as { __tornoMain: Main }).__tornoMain.pickFolder = folder), empty)
    await first.getByRole('button', { name: 'Open folder' }).click()
    expect(await bare.evaluate(() => (globalThis as unknown as { __tornoMain: Main }).__tornoMain.picks)).toBe(1)
    const name = empty.split('/').pop()!
    await expect(says).toContainText(`No objects in ${name} yet`)
    await expect(says).toContainText(`Make a folder with a Python model in it, for example part/part.py, and it appears here.`)
    await expect(says).toContainText('This folder has no pyproject.toml: models are built with torno\'s own build123d.')
    // Nothing was made in it for the opening.
    expect(readdirSync(empty)).toEqual([])
  } finally {
    await bare.close()
    rmSync(empty, { recursive: true, force: true })
  }
})

test('the folders opened lately are listed from torno\'s own file: one that is gone is struck and can be removed, one that is there opens', async () => {
  const home = temp('recent')
  const config = join(home, 'config.json')
  const here = join(home, 'parts')
  const gone = join(home, 'gone')
  mkdirSync(join(here, 'plate'), { recursive: true })
  writeFileSync(join(here, 'plate', 'plate.py'), 'from build123d import Box\n\nplate = Box(20, 20, 2)\n')
  const others = Array.from({ length: 7 }, (_, i) => join(home, `old${i}`))
  for (const dir of others) mkdirSync(dir)
  writeFileSync(config, JSON.stringify({ recent: [gone, here, ...others] }))
  const bare = await launch({ TORNO_CONFIG: config })
  try {
    const first = await bare.firstWindow()
    const list = first.getByRole('navigation', { name: 'Recent folders' })
    // Eight at most, whatever the file holds.
    await expect(list.locator('li')).toHaveCount(8)
    // Coming back, the list is what is shown first, and the explanation is not.
    await expect(first.getByRole('figure', { name: 'How a folder of objects is laid out' })).toHaveCount(0)
    await expect(first.locator('.welcome-page').getByText('An empty folder is fine', { exact: false })).toHaveCount(0)
    const missing = list.locator('li[data-missing]')
    await expect(missing).toHaveCount(1)
    await expect(missing).toContainText('gone')
    await expect(missing).toContainText('Not found')
    expect(await missing.locator('.recent-name').evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('line-through')
    await expect(missing.locator('.recent-row')).toBeDisabled()
    // The path is a path: in the monospace face.
    expect(await list.locator('.recent-path').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('IBM Plex Mono')
    await missing.getByRole('button', { name: 'Remove gone from the list' }).click()
    await expect(list.locator('li')).toHaveCount(7)
    await expect.poll(() => (JSON.parse(readFileSync(config, 'utf8')) as { recent: string[] }).recent).toEqual([here, ...others.slice(0, 6)])
    // One that is there opens, and is then the newest.
    await list.getByRole('button', { name: /^parts/ }).click()
    await expect(first.locator('aside[data-region="left"] .workspace-name')).toHaveText('parts')
    await expect.poll(() => JSON.parse(readFileSync(config, 'utf8')) as unknown).toEqual({ workspace: here, recent: [here, ...others.slice(0, 6)] })
    // Nothing of the list is in the folder that was opened.
    expect(readdirSync(here)).toEqual(['plate'])
  } finally {
    await bare.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('the example is a copy in a temporary folder: the repository\'s own is neither opened nor written, and the copy is not remembered', async () => {
  const home = temp('example')
  const config = join(home, 'config.json')
  const before = readdirSync(fixtures, { recursive: true }).filter((path) => !String(path).includes('__pycache__')).sort()
  const bare = await launch({ TORNO_CONFIG: config })
  let copy = ''
  try {
    const first = await bare.firstWindow()
    await first.getByRole('button', { name: 'Open the example' }).click()
    await first.waitForSelector('[data-region="left"]')
    copy = (await first.evaluate(() => window.__tornoTest!.state())).workspace!.root
    expect(copy.startsWith(join(tmpdir(), 'torno-example-')) || copy.startsWith(join(realpathSync(tmpdir()), 'torno-example-'))).toBe(true)
    expect(copy.startsWith(fixtures)).toBe(false)
    await expect(first.locator('.object-row')).toHaveText([...EXAMPLE_OBJECTS].sort())
    // One of them builds, in the copy.
    await first.locator('.object-row', { hasText: 'hollow' }).click()
    await expect.poll(async () => (await first.evaluate(() => window.__tornoTest!.state())).build?.status, { timeout: 60_000 }).toBe('ok')
    expect(existsSync(join(copy, 'hollow', '.torno'))).toBe(true)
    expect(existsSync(config)).toBe(false)
  } finally {
    await bare.close()
    rmSync(home, { recursive: true, force: true })
  }
  expect(readdirSync(fixtures, { recursive: true }).filter((path) => !String(path).includes('__pycache__')).sort()).toEqual(before)
  expect(existsSync(join(fixtures, 'hollow', '.torno'))).toBe(false)
  // The copy went with the run.
  expect(existsSync(copy)).toBe(false)
})

test('? shows every key of the one table; what is typed searches it, and no tool behind it hears a key', async () => {
  await open('plain')
  await page.locator('[data-region="viewport"] canvas').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('?')
  await expect(sheet()).toBeVisible()
  await expect(sheet()).toHaveAttribute('aria-modal', 'true')
  for (const line of ['Pin: click a point and leave a note', 'Draw the parts apart, or together again', 'Region: undo the last stroke', 'Export to one HTML file']) await expect(sheet()).toContainText(line)
  await expect(sheet().locator('kbd', { hasText: /^P$/ })).toHaveCount(1)
  // Every row that is shown is there, under where it is listened to, its keys in the monospace face.
  await expect(sheet().locator('li')).toHaveCount(KEYS.filter((row) => !row.hidden).length)
  await expect(sheet().locator('h3')).toHaveText(['Everywhere', 'Viewport', 'With a tool in hand', 'With a shape in hand', 'Page of objects', 'New object', 'Session', 'In a field, a menu or a sheet', 'For working on torno'])
  expect(await sheet().locator('kbd').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('IBM Plex Mono')
  // The focus is in its field: a letter searches, and is no tool's key.
  await expect(sheet().getByRole('textbox', { name: 'Search the keys' })).toBeFocused()
  await page.keyboard.type('m')
  expect(await tool()).toBe('select')
  await page.keyboard.type('easure wall')
  await expect(sheet().locator('li')).toHaveText(['TMeasure: the wall under the pointer'])
  await sheet().getByRole('textbox').fill('nothing does this')
  await expect(sheet()).toContainText('No key says nothing does this.')
  await sheet().getByRole('textbox').fill('')
  // Tab goes round within it.
  await page.keyboard.press('Tab')
  await expect(sheet().getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(sheet().getByRole('textbox')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(sheet().getByRole('button', { name: 'Close' })).toBeFocused()
  // Escape puts the sheet away, not the tool down: Measure, taken before, is still in hand.
  await page.keyboard.press('Escape')
  await expect(sheet()).toBeHidden()
  await page.keyboard.press('m')
  expect(await tool()).toBe('measure')
  await page.keyboard.press('?')
  await expect(sheet()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet()).toBeHidden()
  expect(await tool()).toBe('measure')
  // ? again puts it away too, also from its field; and so does a press beside it.
  await page.keyboard.press('?')
  await expect(sheet()).toBeVisible()
  await page.keyboard.press('?')
  await expect(sheet()).toBeHidden()
  // The button at the foot of the tools, to which the focus comes back.
  const button = page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Keys' })
  await expect(button).toHaveAttribute('title', 'Keys (?)')
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(sheet()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(button).toBeFocused()
  await button.click()
  await expect(sheet()).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(sheet()).toBeHidden()
  await page.keyboard.press('Escape')
  expect(await tool()).toBe('select')
})

test('in a field ? is a question mark, and on the page of objects it is the sheet', async () => {
  await page.getByRole('button', { name: 'Save view' }).click()
  await page.getByRole('textbox', { name: 'Name of the view' }).pressSequentially('Why?')
  await expect(sheet()).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Name of the view' })).toHaveValue('Why?')
  await page.keyboard.press('Escape')
  await page.locator('[data-region="viewport"] canvas').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('w')
  await expect(page.locator('.show')).toBeVisible()
  await page.keyboard.press('?')
  await expect(sheet()).toBeVisible()
  // Nothing went into the page's filter, and Escape puts away the sheet, not the page.
  await expect(page.getByRole('textbox', { name: 'Filter the objects by name' })).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(sheet()).toBeHidden()
  await expect(page.locator('.show')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.show')).toBeHidden()
})

test('Ctrl+Shift+E brings up the export sheet, also from a field, where it types nothing', async () => {
  const exporting = page.getByRole('dialog', { name: 'Export' })
  await page.locator('[data-region="viewport"] canvas').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+Shift+E')
  await expect(exporting).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(exporting).toBeHidden()
  await page.getByRole('button', { name: 'Save view' }).click()
  const field = page.getByRole('textbox', { name: 'Name of the view' })
  await field.pressSequentially('Top')
  await page.keyboard.press('Control+Shift+E')
  await expect(exporting).toBeVisible()
  await expect(field).toHaveValue('Top')
  await page.keyboard.press('Escape')
  await expect(exporting).toBeHidden()
  // The plain letter is still explode's, outside a field.
  await page.keyboard.press('Escape')
  expect((await state()).explode).toEqual({})
})
