import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { EXAMPLE_OBJECTS } from '../src/main/example'
import { KEYS } from '../src/shared/keys'
import { POINTER } from '../src/shared/pointer'
import { openListed } from './objects'

// The first screen, and the sheet of keys: what someone who has never seen torno meets, and where they look a key up.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const exampleSource = resolve(appDir, 'resources/example')
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
  await openListed(page, id)
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
    const tree = first.getByRole('figure', { name: 'How a folder of projects is laid out' })
    await expect(tree.locator('.num')).toHaveText(['projects/', 'bracket/', 'bracket.py'])
    await expect(tree).toContainText('the folder you open')
    await expect(says).toContainText('An empty folder is fine: torno helps you make the first project.')
    await expect(says).toContainText('A temporary copy, removed when torno quits.')
    await expect(says).toContainText('torno writes only into a .torno folder inside each project, and the new folder when you make a project.')
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
    await expect(first.locator('.welcome-ways').getByRole('button')).toHaveText(['Open folder', 'Open the example'])
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
    await expect(says).toContainText(`No projects in ${name} yet`)
    await expect(says.getByRole('heading', { name: 'Make your first project' })).toBeVisible()
    // New object leads and the example is offered beside it; the manual route and the pyproject note are in a closed fold.
    await expect(says.getByRole('button').first()).toHaveText('New project')
    await expect(says.getByRole('button', { name: 'open the example to look around' })).toBeVisible()
    await expect(says.getByText('part/part.py')).toBeHidden()
    await says.getByText('Already have build123d models?').click()
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
    await expect(first.getByRole('figure', { name: 'How a folder of projects is laid out' })).toHaveCount(0)
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
  const before = readdirSync(exampleSource, { recursive: true }).filter((path) => !String(path).includes('__pycache__')).sort()
  const bare = await launch({ TORNO_CONFIG: config })
  let copy = ''
  try {
    const first = await bare.firstWindow()
    await first.getByRole('button', { name: 'Open the example' }).click()
    await first.waitForSelector('[data-region="left"]')
    copy = (await first.evaluate(() => window.__tornoTest!.state())).workspace!.root
    expect(copy.startsWith(join(tmpdir(), 'torno-example-')) || copy.startsWith(join(realpathSync(tmpdir()), 'torno-example-'))).toBe(true)
    expect(copy.startsWith(exampleSource)).toBe(false)
    await expect(first.locator('.object-row')).toHaveText([...EXAMPLE_OBJECTS].sort())
    // It builds, in the copy, and its marks and views are there.
    await first.locator('.object-row', { hasText: 'enclosure' }).click()
    await expect.poll(async () => (await first.evaluate(() => window.__tornoTest!.state())).build?.status, { timeout: 60_000 }).toBe('ok')
    expect(existsSync(join(copy, 'enclosure', '.torno', 'marks.json'))).toBe(true)
    expect(existsSync(config)).toBe(false)
  } finally {
    await bare.close()
    rmSync(home, { recursive: true, force: true })
  }
  expect(readdirSync(exampleSource, { recursive: true }).filter((path) => !String(path).includes('__pycache__')).sort()).toEqual(before)
  // The copy went with the run.
  expect(existsSync(copy)).toBe(false)
})

test('the example can be kept as a folder: a new one at the path chosen, never over one that is there, opened and remembered', async () => {
  const home = temp('keep')
  const config = join(home, 'config.json')
  const bare = await launch({ TORNO_CONFIG: config })
  const choose = (to: string | null): Promise<void> => bare.evaluate((_e, path) => void ((globalThis as unknown as { __tornoMain: { pickSave: string | null } }).__tornoMain.pickSave = path), to)
  try {
    const first = await bare.firstWindow()
    await first.getByRole('button', { name: 'Open the example' }).click()
    await first.waitForSelector('[data-region="left"]')
    const copy = (await first.evaluate(() => window.__tornoTest!.state())).workspace!.root
    const keep = first.getByRole('button', { name: 'Keep this as a folder…' })
    // A name that is taken is refused, and said under the folder's name; nothing is written and the example stays open.
    mkdirSync(join(home, 'taken'))
    await choose(join(home, 'taken'))
    await keep.click()
    await expect(first.locator('.workspace-problem')).toContainText('is there already')
    expect(readdirSync(join(home, 'taken'))).toEqual([])
    expect((await first.evaluate(() => window.__tornoTest!.state())).workspace!.root).toBe(copy)
    // The dialog cancelled: nothing happens.
    await choose(null)
    await keep.click()
    expect((await first.evaluate(() => window.__tornoTest!.state())).workspace!.root).toBe(copy)
    // A new name: the folder is there whole, opened in place of the copy, and remembered.
    const kept = join(home, 'my-enclosure')
    await choose(kept)
    await keep.click()
    await expect(first.locator('.workspace-name')).toHaveText('my-enclosure')
    await expect(first.locator('.workspace-example')).toHaveCount(0)
    expect((await first.evaluate(() => window.__tornoTest!.state())).workspace!.root).toBe(realpathSync(kept))
    expect(readdirSync(kept, { recursive: true }).map(String).sort()).toEqual(['enclosure', 'enclosure/.torno', 'enclosure/.torno/marks.json', 'enclosure/.torno/scene.json', 'enclosure/brief.md', 'enclosure/enclosure.py'])
    expect(readdirSync(home).filter((name) => name.includes('torno-new'))).toEqual([])
    await expect.poll(() => (JSON.parse(readFileSync(config, 'utf8')) as { recent: string[] }).recent[0]).toBe(realpathSync(kept))
    // It is a folder of the person's own: it builds, and its marks came with it.
    await first.locator('.object-row', { hasText: 'enclosure' }).click()
    await expect.poll(async () => (await first.evaluate(() => window.__tornoTest!.state())).build?.status, { timeout: 60_000 }).toBe('ok')
  } finally {
    await bare.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('? shows every key of the one table; what is typed searches it, and no tool behind it hears a key', async () => {
  await open('plain')
  await page.locator('[data-region="viewport"] canvas').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('?')
  await expect(sheet()).toBeVisible()
  await expect(sheet()).toHaveAttribute('aria-modal', 'true')
  for (const line of ['Pin: click a point and leave a note', 'Draw the parts apart, or together again', 'Region: undo the last stroke', 'Export to one HTML file, or to STEP, STL or 3MF']) await expect(sheet()).toContainText(line)
  // `P` is the Pin tool, with a sketch open the point to point pen, and in a tracing the Pin tool of the sheet: three rows, each in its own group.
  await expect(sheet().locator('kbd', { hasText: /^P$/ })).toHaveCount(3)
  // Every row that is shown is there, under where it is listened to, its keys in the monospace face.
  await expect(sheet().locator('li')).toHaveCount(POINTER.length + KEYS.filter((row) => !row.hidden).length)
  // The pointer first: gestures, not keys, so no cap of its own.
  await expect(sheet().locator('h3')).toHaveText(['Pointer', 'Everywhere', 'Viewport', 'With a tool in hand', 'With a shape in hand', 'Board', 'Tracing', 'Page of projects', 'New project', 'Session', 'In a field, a menu or a sheet', 'For working on torno'])
  expect(await sheet().locator('kbd').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('IBM Plex Mono')
  // The focus is in its field: a letter searches, and is no tool's key.
  await expect(sheet().getByRole('textbox', { name: 'Search the keys' })).toBeFocused()
  await page.keyboard.type('m')
  expect(await tool()).toBe('select')
  await page.keyboard.type('easure wall')
  await expect(sheet().locator('li')).toHaveText(['TMeasure: the wall under the pointer'])
  // A search that only the pointer answers: the count says so, beside the group it shows.
  await sheet().getByRole('textbox').fill('towards')
  await expect(sheet().locator('.keys-count')).toHaveText('0 keys found, 1 of the pointer')
  await expect(sheet().locator('li')).toHaveText(['ScrollZoom, towards the pointer'])
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
  await expect(button).toHaveAttribute('aria-keyshortcuts', '?')
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
  await expect(page.getByRole('textbox', { name: 'Filter the projects by name' })).toHaveValue('')
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

// What torno needs, said on the first screen before anything fails (`ui/Readiness.tsx`, `main/ready.ts`). Under TORNO_TEST=1
// the CLI is looked for on the PATH and never run: no version, no account.

/** The line of one thing, the block opened if it is folded to a sentence. */
async function readyLine(window: Page, id: string) {
  const fold = window.locator('.ready-fold[aria-expanded="false"]')
  if ((await fold.count()) > 0) await fold.click()
  return window.locator(`.ready-line[data-line="${id}"]`)
}

test('the first screen says Claude Code is found, or that it is not on the PATH, before anything is tried', async () => {
  const found = await launch()
  const lost = await launch({ TORNO_AGENT_CMD: join(tmpdir(), 'torno-no-such-claude') })
  try {
    const here = await found.firstWindow()
    await expect(here.locator('.ready')).toBeVisible()
    const claude = await readyLine(here, 'claude')
    await expect(claude).toHaveAttribute('data-tone', 'ok')
    await expect(claude).toContainText('found at')
    // The CLI was not run: nothing of its version or its account.
    await expect(claude).not.toContainText('version')
    await expect(claude).not.toContainText('signed in')

    const gone = await lost.firstWindow()
    const missing = await readyLine(gone, 'claude')
    await expect(missing).toHaveAttribute('data-tone', 'fail')
    await expect(missing).toContainText('Not found on PATH. Install Claude Code and log in, then reopen torno. See Requirements in the README.')
    await expect(missing.locator('.ready-note')).toContainText('Looked in')
    // Something is missing: the block is open, not folded to a sentence.
    await expect(gone.locator('.ready-fold')).toHaveCount(0)
    await expect(gone.getByRole('heading', { name: 'Ready to work' })).toBeVisible()
    // The ways in are there all the same.
    await expect(gone.getByRole('button', { name: 'Open folder' })).toBeEnabled()
  } finally {
    await found.close()
    await lost.close()
  }
})

/**
 * A folder of links to every command the PATH has but `uv`, to put in its place: the PATH of the person with one command
 * fewer. (A PATH of nothing but `node` keeps the app from starting.)
 */
function pathWithout(command: string): string {
  const bin = temp('path')
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      if (name === command || existsSync(join(bin, name))) continue
      try {
        symlinkSync(join(dir, name), join(bin, name))
      } catch {
        // A name twice, or one that cannot be linked: the command is not wanted for the check.
      }
    }
  }
  return bin
}

test('the first screen says uv is missing on a PATH without it', async () => {
  const bin = pathWithout('uv')
  const bare = await launch({ PATH: bin })
  try {
    const first = await bare.firstWindow()
    const uv = await readyLine(first, 'uv')
    await expect(uv).toHaveAttribute('data-tone', 'fail')
    await expect(uv).toContainText('Not found on PATH. Install it from docs.astral.sh/uv, then reopen torno.')
    // The stand-in is found (node is on that PATH): only uv is missing.
    await expect(first.locator('.ready-line[data-line="claude"]')).toHaveAttribute('data-tone', 'ok')
  } finally {
    await bare.close()
    rmSync(bin, { recursive: true, force: true })
  }
})

test('the empty workspace and the page of a new object say what is missing, and the folder menu checks it again', async () => {
  const empty = temp('ready-empty')
  const project = temp('ready-project')
  writeFileSync(join(project, 'pyproject.toml'), '[project]\nname = "mine"\nversion = "0.1.0"\n')
  const lost = await launch({ TORNO_WORKSPACE: empty, TORNO_AGENT_CMD: join(tmpdir(), 'torno-no-such-claude') })
  const ok = await launch({ TORNO_WORKSPACE: empty })
  const own = await launch({ TORNO_WORKSPACE: project })
  try {
    const gone = await lost.firstWindow()
    await gone.waitForSelector('[data-region="left"]')
    const block = gone.locator('.show-empty .ready')
    await expect(block.locator('.ready-line[data-line="claude"]')).toContainText('Not found on PATH')
    // The page of a new object has the line above Start, and says what that means for the object.
    await gone.locator('.show-empty').getByRole('button', { name: 'New project' }).click()
    const foot = gone.locator('.new-foot .ready[data-variant="missing"]')
    await expect(foot.locator('.ready-line[data-line="claude"]')).toHaveAttribute('data-tone', 'fail')
    await expect(foot).toContainText('The project will be made, but Claude Code cannot start in it until this is put right.')
    // Above Start, not under it.
    expect(await foot.evaluate((el) => !!(el.compareDocumentPosition(document.querySelector('.new-start')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)

    // With Claude Code found the new object's page has no such block.
    const fine = await ok.firstWindow()
    await fine.waitForSelector('[data-region="left"]')
    await fine.locator('.show-empty').getByRole('button', { name: 'New project' }).click()
    await expect(fine.locator('.new-foot')).toBeVisible()
    await expect(fine.locator('.new-foot .ready')).toHaveCount(0)
    await fine.keyboard.press('Escape')
    await expect(fine.locator('.show-empty')).toBeVisible()

    // The folder menu has the check, as a dialog over the window.
    await fine.getByRole('button', { name: 'Folders' }).click()
    await fine.getByRole('menuitem', { name: 'Check what torno needs' }).click()
    const sheet = fine.getByRole('dialog', { name: 'What torno needs' })
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.ready-line[data-line="claude"]')).toContainText('found at')
    await expect(sheet.getByRole('button', { name: 'Check again' })).toBeVisible()
    await fine.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    // A folder with a pyproject.toml and no .venv: said before the first build, and nothing is made there.
    const mine = await own.firstWindow()
    await mine.waitForSelector('[data-region="left"]')
    const line = await readyLine(mine, 'project')
    await expect(line).toHaveAttribute('data-tone', 'fail')
    await expect(line).toContainText('has a pyproject.toml but no .venv. Run uv sync in it once and open it again: torno never does that.')
    expect(readdirSync(project)).toEqual(['pyproject.toml'])
  } finally {
    await lost.close()
    await ok.close()
    await own.close()
    rmSync(empty, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
