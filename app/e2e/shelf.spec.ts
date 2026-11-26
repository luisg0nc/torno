import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { benchTab, clickHere, newSession, openSection, switchTab } from './helpers'
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

test('the tab "Shelf 1" is the last, after Parameters and Parts', async () => {
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
  await expect(pagePart().getByRole('button', { name: 'Place on the model' })).toBeEnabled()
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

// ---- placing a part on the model (#353) ----

type Face = { fx: number; fy: number; ref: string }
const band = () => page.locator('[data-band="place"]')
const composer = () => page.locator('[data-region="session"] [data-chat-composer]')
const canvasBox = async () => (await page.locator('.viewport-canvas canvas').first().boundingBox())!
const REQUEST = "cut its cutout and keep its keep-out clear."
const pinsOfShelf = async () => (await state()).marks.filter((m) => m.kind === 'pin' && m.note === 'ec11 from the shelf')

/** Points of the canvas that are on a face of the model, as fractions of it, in a grid, each with the face it is on and clear of any mark's chip. */
async function faces(): Promise<Face[]> {
  return page.evaluate(() => {
    const t = window.__tornoTest!
    const found: Face[] = []
    for (let i = 1; i < 14; i++)
      for (let j = 1; j < 14; j++) {
        const fx = i / 14
        const fy = j / 14
        const hit = t.pickAt(fx, fy, { edges: false })
        // A chip is wider than a point: none within about 30 px of it.
        const clear = [[0, 0], [0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]].every(([dx, dy]) => t.chipAt(fx + dx, fy + dy) === null)
        if (hit && hit.kind === 'face' && hit.normal && clear) found.push({ fx, fy, ref: hit.ref })
      }
    return found
  })
}

/** A face the model has and a point on it at least `apart` canvas fractions from the given ones. */
function onSameFace(all: Face[], away: Face[], apart = 0.12): [Face, Face] | null {
  for (const a of all) for (const b of all) if (a !== b && a.ref === b.ref && Math.hypot(a.fx - b.fx, a.fy - b.fy) > apart && away.every((o) => Math.hypot(o.fx - a.fx, o.fy - a.fy) > apart && Math.hypot(o.fx - b.fx, o.fy - b.fy) > apart)) return [a, b]
  return null
}

async function aim(f: Face): Promise<[number, number]> {
  const box = await canvasBox()
  return [box.x + f.fx * box.width, box.y + f.fy * box.height]
}

test('"Place on the model" shows the model and takes the place tool: the band says Placing ec11 from the shelf, 0 placed, and nothing is in the box', async () => {
  await row().click()
  await expect(pagePart()).toBeVisible()
  await composer().fill('')
  await pagePart().getByRole('button', { name: 'Place on the model' }).click()
  // The view's switch gives way to the band, as it does to any band.
  await expect(pagePart()).toHaveCount(0)
  await expect(band()).toBeVisible()
  await expect(band()).toHaveText(/^Placing\s*ec11\s*from the shelf,\s*0\s*placed\s*Ask ClaudeStop$/)
  // The id and the count are in the face of numbers, the words are not.
  expect(await band().locator('.num').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')
  await expect(band().getByRole('button', { name: 'Ask Claude' })).toBeVisible()
  await expect(band().getByRole('button', { name: 'Stop' })).toBeVisible()
  await expect(composer()).toHaveValue('')
})

test('over a face the ghost of the cutout and the keep-out follows the pointer, and beside the model there is none', async () => {
  await expect.poll(async () => (await faces()).length, { timeout: 20_000 }).toBeGreaterThan(10)
  const [face] = await faces()
  const [x, y] = await aim(face)
  await page.mouse.move(x, y)
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.placing()?.ghost !== null && window.__tornoTest!.placing()?.ghost !== undefined)).toBe(true)
  const ghost = await page.evaluate(() => window.__tornoTest!.placing()!.ghost!)
  expect(Math.hypot(...ghost.normal)).toBeCloseTo(1, 5)
  const box = await canvasBox()
  await page.mouse.move(box.x + 2, box.y + box.height - 2)
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.placing()?.ghost ?? null)).toBeNull()
})

test('a click on a face leaves a pin, "ec11 from the shelf", with no note to write; the band counts it and the box holds the request, unsent', async () => {
  const [a] = onSameFace(await faces(), [])!
  const [x, y] = await aim(a)
  await page.mouse.move(x, y)
  await clickHere(page)
  await expect.poll(async () => (await pinsOfShelf()).length).toBe(1)
  const [pin] = await pinsOfShelf()
  expect(pin).toMatchObject({ kind: 'pin', author: 'user', note: 'ec11 from the shelf' })
  await expect(page.locator('.note-card')).toHaveCount(0)
  await expect(band()).toContainText('1 placed')
  await expect(composer()).toHaveValue(`Put the shelf's ec11 at ${pin.id} on the face: ${REQUEST} `)
  // The tag says what it cuts and keeps clear, from the kernel's numbers, and the ring of the cutout stays.
  const tag = page.locator('[data-part="place-tag"]')
  await expect(tag).toContainText(`ec11 on the face, ${pin.id}`)
  await expect(tag).toContainText(/cuts Ø 7\.2, keeps [\d.]+ × [\d.]+ clear/)
  expect(await page.evaluate(() => window.__tornoTest!.placing()!.placed.length)).toBe(1)
  // Never sent.
  await expect(page.locator('[data-region="session"] .chat-turn, [data-region="session"] .chat-text')).toHaveCount(0)
})

test('the tag goes when the pointer goes on', async () => {
  const box = await canvasBox()
  await page.mouse.move(box.x + 3, box.y + box.height - 3)
  await expect(page.locator('[data-part="place-tag"]')).toHaveCount(0)
})

test('more clicks make the sentence longer in place, round the words the person wrote, and name the faces when they differ', async () => {
  const [first] = await pinsOfShelf()
  const all = await faces()
  const pair = onSameFace(all, [])!
  const [b, c] = pair
  await composer().fill(`Please. ${(await composer().inputValue()).trim()} Thanks.`)
  for (const f of [b, c]) {
    const [x, y] = await aim(f)
    await page.mouse.move(x, y)
    await clickHere(page)
    await expect.poll(async () => (await pinsOfShelf()).length).toBe(2 + (f === c ? 1 : 0))
  }
  const pins = await pinsOfShelf()
  expect(pins).toHaveLength(3)
  const refs = new Set(pins.map((m) => ('anchor' in m && m.anchor ? m.anchor.ref : '')))
  const ids = pins.map((m) => m.id)
  const words = `${ids[0]}, ${ids[1]} and ${ids[2]}`
  await expect(composer()).toHaveValue(`Please. Put the shelf's ec11 at ${words} on the ${refs.size > 1 ? 'faces' : 'face'}: ${REQUEST} Thanks.`)
  expect(first.id).toBe(ids[0])
  await expect(band()).toContainText('3 placed')
})

test('a box the person changed gets a sentence of its own for the next mark, and keeps their words', async () => {
  await composer().fill('Make it quick.')
  const [a] = onSameFace(await faces(), [])!
  const [x, y] = await aim(a)
  await page.mouse.move(x, y)
  await clickHere(page)
  await expect.poll(async () => (await pinsOfShelf()).length).toBe(4)
  const pins = await pinsOfShelf()
  const id = pins[3].id
  await expect(composer()).toHaveValue(new RegExp(`^Make it quick\\.\\s*Put the shelf's ec11 at ${id} on the face: ${REQUEST}\\s*$`))
})

test('Stop ends placing: the band goes, the pins stay, and Select is in hand again', async () => {
  await band().getByRole('button', { name: 'Stop' }).click()
  await expect(band()).toHaveCount(0)
  expect((await pinsOfShelf()).length).toBe(4)
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.placing())).toBeNull()
})

test('Escape ends placing too', async () => {
  await row().click()
  await pagePart().getByRole('button', { name: 'Place on the model' }).click()
  await expect(band()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(band()).toHaveCount(0)
})

test('Ask Claude ends placing and gives the keys to the box, with the request in it unsent', async () => {
  await composer().fill('')
  await row().click()
  await pagePart().getByRole('button', { name: 'Place on the model' }).click()
  const [a] = onSameFace(await faces(), [])!
  const [x, y] = await aim(a)
  await page.mouse.move(x, y)
  await clickHere(page)
  await expect.poll(async () => (await pinsOfShelf()).length).toBe(5)
  const id = (await pinsOfShelf())[4].id
  await band().getByRole('button', { name: 'Ask Claude' }).click()
  await expect(band()).toHaveCount(0)
  await expect(composer()).toBeFocused()
  await expect(composer()).toHaveValue(`Put the shelf's ec11 at ${id} on the face: ${REQUEST} `)
  await expect(page.locator('[data-region="session"] .chat-turn, [data-region="session"] .chat-text')).toHaveCount(0)
  await composer().fill('')
})

/** A drag of the row onto the model, made of the events a drag makes: the browser's own drag cannot be driven on a hidden window. */
async function dragOver(type: 'dragover' | 'drop', at: Face | [number, number], dt: Awaited<ReturnType<Page['evaluateHandle']>>): Promise<void> {
  const [x, y] = Array.isArray(at) ? at : await aim(at)
  await page.locator('.viewport-pane').dispatchEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })
}

test('a row dragged onto a face: it is lifted, the ghost follows over the model, a drop off the model does nothing, and a drop on a face places the part and starts placing', async () => {
  await switchTab(page, 'Model').click()
  await expect(band()).toHaveCount(0)
  const dt = await page.evaluateHandle(() => new DataTransfer())
  await row().dispatchEvent('dragstart', { dataTransfer: dt })
  await expect(row()).toHaveClass(/\blifted\b/)
  expect(await dt.evaluate((d) => d.types.includes('application/x-torno-shelf-part') && !d.types.includes('text/plain'))).toBe(true)
  const [a] = onSameFace(await faces(), [])!
  await dragOver('dragover', a, dt)
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.placing()?.ghost !== null && window.__tornoTest!.placing() !== null)).toBe(true)
  // Beside the model: no ghost, and a drop does nothing.
  const box = await canvasBox()
  const off: [number, number] = [box.x + 2, box.y + box.height - 2]
  await dragOver('dragover', off, dt)
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.placing()?.ghost ?? null)).toBeNull()
  await dragOver('drop', off, dt)
  await page.waitForTimeout(300)
  expect((await pinsOfShelf()).length).toBe(5)
  await expect(band()).toHaveCount(0)
  // On a face: a pin, placing begins, the request is in the box.
  await dragOver('dragover', a, dt)
  await dragOver('drop', a, dt)
  await expect.poll(async () => (await pinsOfShelf()).length).toBe(6)
  await expect(band()).toContainText('1 placed')
  const id = (await pinsOfShelf())[5].id
  await expect(composer()).toHaveValue(new RegExp(`Put the shelf's ec11 at ${id} on the face: ${REQUEST}`))
  await row().dispatchEvent('dragend', { dataTransfer: dt })
  await expect(row()).not.toHaveClass(/\blifted\b/)
  // The box had the keys: Escape is the view's once they are given back, as after a real drag, which leaves them where they were not.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Escape')
  await expect(band()).toHaveCount(0)
  await composer().fill('')
})

test('files dropped on the view are still the view\'s: a drag of ours is not taken for one, and one of files is not taken for ours', async () => {
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer()
    d.items.add(new File(['x'], 'cloud.ply'))
    return d
  })
  const [a] = onSameFace(await faces(), [])!
  await dragOver('dragover', a, dt)
  expect(await page.evaluate(() => window.__tornoTest!.placing())).toBeNull()
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
