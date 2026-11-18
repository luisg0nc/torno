import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { EXAMPLE_OBJECTS } from '../src/main/example'
import { KEYBOARD, PLACES } from '../src/shared/keyboard'
import { railButton } from './helpers'
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

test('the first run shows the dyed plate with the vise scribed on it, what to open, and a folder with nothing in it says what to make', async () => {
  const bare = await launch()
  const empty = temp('empty')
  try {
    const first = await bare.firstWindow()
    expect(await bare.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    const says = first.locator('[data-region="viewport"]')
    // The plate: the headline and the tagline in the words of the design, the plate 780 of 1440 of the window.
    const plate = first.locator('[data-plate]')
    await expect(plate).toBeVisible()
    await expect(plate.getByRole('heading', { name: 'torno', level: 1 })).toBeVisible()
    await expect(plate).toContainText('Make CAD parts with an AI agent. It writes the model in build123d; you point at what to change.')
    const box = (await plate.boundingBox())!
    const whole = (await first.locator('.welcome-page').boundingBox())!
    expect(Math.abs(box.width / whole.width - 780 / 1440)).toBeLessThan(0.005)
    expect(box.x).toBe(0)
    // The folder idea in a sentence, in place of a list, and the ways in.
    await expect(says.getByRole('heading', { name: 'Open a folder to work in' })).toBeVisible()
    await expect(first.getByRole('figure')).toHaveCount(0)
    await expect(says).toContainText('An empty folder is fine: torno helps you make the first project.')
    await expect(says).toContainText('The example is a temporary copy, removed when torno quits.')
    await expect(says).toContainText('torno writes only into a .torno folder inside each project, and the new folder when you make a project.')
    await expect(says).not.toContainText('for the keys')
    // The main way in is the one primary button (42 px, radius 10); the example is the other.
    await expect(first.locator('.welcome-page .button-primary')).toHaveText(['Open folder'])
    expect(await first.locator('.welcome-page .button-primary').evaluate((el) => [el.getBoundingClientRect().height, getComputedStyle(el).borderTopLeftRadius])).toEqual([42, '10px'])
    // The dye, the lines of the vise and the words, in the tokens of the theme.
    const dye = await first.evaluate(() => {
      const probe = document.createElement('i')
      document.body.append(probe)
      const colour = (name: string): string => ((probe.style.color = `var(${name})`), getComputedStyle(probe).color)
      const tokens = { dye: colour('--dye'), onDye: colour('--on-dye'), scribe: colour('--scribe'), muted: colour('--on-dye-muted'), wash: colour('--accent-wash') }
      probe.remove()
      const style = (selector: string): CSSStyleDeclaration => getComputedStyle(document.querySelector(selector)!)
      return {
        tokens,
        plate: style('[data-plate]').backgroundColor,
        headline: style('.plate-headline').color,
        lead: style('.plate-lead').color,
        outline: style('.plate-vise .vise-o').stroke,
        dimension: style('.plate-vise .vise-dim path').stroke,
        number: [style('.plate-vise .vise-text text').fill, style('.plate-vise .vise-text text').fontFamily],
        part: style('.plate-vise .vise-fill').fill,
        wash: tokens.wash
      }
    })
    expect(dye.plate).toBe(dye.tokens.dye)
    expect(dye.headline).toBe(dye.tokens.onDye)
    expect(dye.lead).toBe(dye.tokens.muted)
    expect(dye.outline).toBe(dye.tokens.onDye)
    expect(dye.dimension).toBe(dye.tokens.scribe)
    expect(dye.number[0]).toBe(dye.tokens.muted)
    expect(dye.number[1]).toContain('Martian Mono')
    expect(dye.part).toBe(dye.tokens.wash)
    // It draws itself once: the outline in 1.6 s, the dimensions fading in at 1.1 s and the part at 1.4 s, none for ever.
    const motion = await first.evaluate(() => {
      const of = (selector: string): CSSStyleDeclaration => getComputedStyle(document.querySelector(selector)!)
      return [of('.vise-o'), of('.vise-dim'), of('.vise-fill')].map((s) => [s.animationDuration, s.animationDelay, s.animationIterationCount])
    })
    expect(motion).toEqual([
      ['1.6s', '0s', '1'],
      ['0.6s', '1.1s', '1'],
      ['0.5s', '1.4s', '1']
    ])
    // The window has no frame: the top of the screen moves it, and the controls and the buttons are for clicking.
    const region = (selector: string): Promise<string> => first.locator(selector).first().evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))
    expect(await region('.welcome-drag')).toBe('drag')
    expect(await region('.title-bare')).toBe('no-drag')
    expect(await region('.welcome-ways .button-primary')).toBe('no-drag')
    expect(await first.locator('.welcome-drag').evaluate((el) => [el.getBoundingClientRect().top, el.getBoundingClientRect().height])).toEqual([0, 40])
    // With reduced motion it is shown drawn, with nothing animated.
    await first.emulateMedia({ reducedMotion: 'reduce' })
    expect(await first.evaluate(() => [...document.querySelectorAll('.plate-vise *')].map((el) => getComputedStyle(el).animationName).filter((name) => name !== 'none'))).toEqual([])
    expect(await first.evaluate(() => [getComputedStyle(document.querySelector('.vise-o')!).strokeDashoffset, getComputedStyle(document.querySelector('.vise-fill')!).opacity])).toEqual(['0px', '1'])
    await first.emulateMedia({ reducedMotion: null })
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
    // The dyed plate with nothing in the vise, and the composer: the words, the chips, the folder offered, Start.
    await expect(says.locator('[data-plate]')).toContainText(`No projects in ${name}`)
    await expect(says.getByRole('heading', { name: 'Nothing in the vise yet' })).toBeVisible()
    await expect(says.getByRole('heading', { name: 'What are we making?' })).toBeVisible()
    await expect(says.getByRole('button', { name: 'open the example' })).toBeVisible()
    await expect(says.getByRole('button', { name: 'open the full new project page' })).toBeVisible()
    for (const chip of ['Photo', 'Doodle', 'Bought part', 'Scan']) await expect(says.getByRole('button', { name: chip, exact: true })).toBeVisible()
    await expect(says.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
    await says.getByRole('textbox', { name: 'What are we making?' }).fill('A clip that holds a 6 mm cable to the edge of a desk')
    await expect(says.getByRole('button', { name: `Goes in ${name}/cable-clip` })).toBeVisible()
    await expect(says.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
    // The manual route and the pyproject note are in a closed fold.
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
    // Coming back, the list is what is shown first, beside the same plate, and the explanation is not.
    await expect(first.locator('[data-plate]').getByRole('heading', { name: 'torno', level: 1 })).toBeVisible()
    await expect(first.getByRole('heading', { name: 'Recent folders', level: 2 })).toBeVisible()
    await expect(first.locator('.welcome-page').getByText('An empty folder is fine', { exact: false })).toHaveCount(0)
    // A row is 68 px high, and one that is gone has a dashed box where the drawing goes.
    expect(await list.locator('li').first().evaluate((el) => el.getBoundingClientRect().height)).toBe(68)
    expect(await list.locator('li[data-missing] .recent-thumb').evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed')
    const missing = list.locator('li[data-missing]')
    await expect(missing).toHaveCount(1)
    await expect(missing).toContainText('gone')
    await expect(missing).toContainText('Not found')
    expect(await missing.locator('.recent-name').evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('line-through')
    await expect(missing.locator('.recent-row')).toBeDisabled()
    // The path is a path: in the monospace face.
    expect(await list.locator('.recent-path').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Martian Mono')
    await missing.getByRole('button', { name: 'Remove gone from the list' }).click()
    await expect(list.locator('li')).toHaveCount(7)
    await expect.poll(() => (JSON.parse(readFileSync(config, 'utf8')) as { recent: string[] }).recent).toEqual([here, ...others.slice(0, 6)])
    // One that is there opens, and is then the newest.
    await list.getByRole('button', { name: /^parts/ }).click()
    await expect(first.locator('.title-row .workspace-name')).toHaveText('parts')
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
    await expect(first.locator('.show .card .card-name')).toHaveText([...EXAMPLE_OBJECTS].sort())
    // It builds, in the copy, and its marks and views are there.
    await first.locator('.show .card[data-object="enclosure"]').click()
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
    await expect(first.locator('.title-row .workspace-name')).toHaveText('my-enclosure')
    await expect(first.locator('.workspace-example')).toHaveCount(0)
    expect((await first.evaluate(() => window.__tornoTest!.state())).workspace!.root).toBe(realpathSync(kept))
    expect(readdirSync(kept, { recursive: true }).map(String).sort()).toEqual(['enclosure', 'enclosure/.torno', 'enclosure/.torno/marks.json', 'enclosure/.torno/scene.json', 'enclosure/brief.md', 'enclosure/enclosure.py'])
    expect(readdirSync(home).filter((name) => name.includes('torno-new'))).toEqual([])
    await expect.poll(() => (JSON.parse(readFileSync(config, 'utf8')) as { recent: string[] }).recent[0]).toBe(realpathSync(kept))
    // It is a folder of the person's own: it builds, and its marks came with it.
    await first.locator('.show .card[data-object="enclosure"]').click()
    await expect.poll(async () => (await first.evaluate(() => window.__tornoTest!.state())).build?.status, { timeout: 60_000 }).toBe('ok')
  } finally {
    await bare.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('? raises the keyboard; what is typed or pointed at is answered in sentences, and no tool behind it hears a key', async () => {
  await open('plain')
  await page.locator('[data-region="viewport"] canvas').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('?')
  await expect(sheet()).toBeVisible()
  await expect(sheet()).toHaveAttribute('aria-modal', 'true')
  // The focus is in its field: a letter searches, and is no tool's key.
  await expect(sheet().getByRole('textbox', { name: 'Search the keys' })).toBeFocused()
  // The places are chips, the view the one chosen; the keyboard is drawn whole, and what a key does is in the place chosen.
  await expect(sheet().getByRole('group', { name: 'Where keys are heard' }).getByRole('button')).toHaveText(PLACES.map((place) => place.name))
  await expect(sheet().getByRole('button', { name: 'In the view' })).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet().locator('.keys-cap')).toHaveCount(KEYBOARD.flat().length)
  await expect(sheet().locator('[data-cap="KeyE"]')).toHaveText('Eexplode')
  await expect(sheet().locator('[data-cap="KeyE"]')).toHaveAttribute('data-kind', 'view')
  await expect(sheet().locator('[data-cap="KeyD"]')).toHaveAttribute('data-kind', 'tool')
  expect(await sheet().locator('[data-cap="KeyE"]').evaluate((el) => { const box = el.getBoundingClientRect(); return [box.width, box.height] })).toEqual([56, 48])
  await expect(sheet().locator('[data-cap="KeyQ"]')).not.toHaveAttribute('data-bound', 'true')
  await sheet().getByRole('button', { name: 'Sketching' }).click()
  await expect(sheet().locator('[data-cap="KeyB"]')).toHaveText('Bfree')
  await sheet().getByRole('button', { name: 'With a tool in hand' }).click()
  await expect(sheet().locator('.keys-chords')).toContainText('Shift+Arrows')
  await sheet().getByRole('button', { name: 'In the view' }).click()
  // The pointer is listed under the keyboard in the view, and the keys with a modifier, their caps in the monospace face.
  await expect(sheet().locator('.keys-chords')).toContainText('Zoom, towards the pointer')
  expect(await sheet().locator('.keys-chords kbd').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Martian Mono')
  // Pointing at a key asks the table about it: its cap is outlined in the accent, and what it does is told where it is heard.
  await sheet().locator('[data-cap="KeyE"]').hover()
  await expect(sheet().locator('[data-cap="KeyE"]')).toHaveAttribute('data-lit', 'true')
  await expect(sheet().locator('.keys-said')).toHaveText([
    'In the view, E draws the parts apart, or together again.Not while a field or the terminal has the keys.',
    'With Region of a scan in hand, E paints or rubs out.Not while a field or the terminal has the keys. The tool hears the key before the view does.'
  ])
  await expect(sheet().locator('.keys-said.on')).toHaveCount(1)
  // A press on a chip took the focus; the field is clicked and a letter searches, and is no tool's key.
  await sheet().getByRole('textbox', { name: 'Search the keys' }).click()
  await page.keyboard.type('m')
  expect(await tool()).toBe('select')
  await page.keyboard.type('easure wall')
  await expect(sheet().locator('.keys-said').first()).toContainText('With Measure in hand, T is the wall under the pointer.')
  // A search that only the pointer answers: the count says so, and the sentence is the pointer's.
  await sheet().getByRole('textbox').fill('towards')
  await expect(sheet().locator('.keys-count')).toHaveText('0 keys found, 1 of the pointer.')
  await expect(sheet().locator('.keys-said')).toHaveText(['In the view, Scroll zooms, towards the pointer.'])
  await sheet().getByRole('textbox').fill('nothing does this')
  await expect(sheet()).toContainText('No key says nothing does this.')
  await sheet().getByRole('textbox').fill('')
  await expect(sheet().locator('.keys-count')).toContainText('Tools are in the accent, keys heard in the view are outlined.')
  // Tab goes round within it: the places, the field, the key that puts it away.
  await page.keyboard.press('Tab')
  await expect(sheet().getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(sheet().getByRole('button', { name: 'Everywhere' })).toBeFocused()
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
  // The button at the foot of the rail, to which the focus comes back.
  const button = railButton(page, 'Keys')
  await expect(button).toHaveAttribute('aria-keyshortcuts', '?')
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(sheet()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(button).toBeFocused()
  await button.click()
  await expect(sheet()).toBeVisible()
  // The button is the rail's, which stays: pressed again it puts the keyboard away, and a press on the scrim above it does too.
  await button.click()
  await expect(sheet()).toBeHidden()
  await button.click()
  await expect(sheet()).toBeVisible()
  await page.mouse.click(700, 80)
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
    const block = gone.locator('.empty-folder .ready')
    await expect(block.locator('.ready-line[data-line="claude"]')).toContainText('Not found on PATH')
    // The page of a new object has the line above Start, and says what that means for the object.
    await gone.locator('.empty-folder').getByRole('button', { name: 'open the full new project page' }).click()
    const foot = gone.locator('.new-foot .ready[data-variant="missing"]')
    await expect(foot.locator('.ready-line[data-line="claude"]')).toHaveAttribute('data-tone', 'fail')
    await expect(foot).toContainText('The project will be made, but Claude Code cannot start in it until this is put right.')
    // Above Start, not under it.
    expect(await foot.evaluate((el) => !!(el.compareDocumentPosition(document.querySelector('.new-start')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)

    // With Claude Code found the new object's page has no such block.
    const fine = await ok.firstWindow()
    await fine.waitForSelector('[data-region="left"]')
    await fine.locator('.empty-folder').getByRole('button', { name: 'open the full new project page' }).click()
    await expect(fine.locator('.new-foot')).toBeVisible()
    await expect(fine.locator('.new-foot .ready')).toHaveCount(0)
    await fine.keyboard.press('Escape')
    await expect(fine.locator('.empty-folder')).toBeVisible()

    // The folder menu has the check, as a dialog over the window.
    await fine.getByRole('button', { name: /^Folder / }).click()
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
