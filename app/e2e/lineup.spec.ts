import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { Tracing, TracingCut } from '../src/shared/tracings'
import { png } from '../src/test/pngFixtures'
import { openListed } from './objects'

// A photo under a tracing, in the window: add one through the photo dialog, line it up by clicking the same spots on the photo and on the tracing,
// and see the straightened copy made, kept and drawn under the outline. The window is hidden: state is read through hooks (`__tornoLineup`, `__tornoTest`),
// and the clicks are made at the page's own places for the points (the panes' own sheets say where a photo pixel or a point of the plane is).
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page
let photo: string

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-lineup-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  photo = join(root, 'front.png')
  writeFileSync(photo, png(400, 300))
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const tracingOf = (): Promise<Tracing> => page.evaluate(async () => (await window.torno.tracings.list('bracket')).tracings[0])
const photosDir = (): string => join(root, 'bracket', '.torno', 'tracings', 'photos')
const lineup = (): Locator => page.locator('.lineup')
const bar = (): Locator => lineup().locator('.lu-fit')

/** Clicks a photo pixel, then a point of the plane, each where the pane stands now. */
async function clickPair(photoAt: [number, number], uv: [number, number]): Promise<void> {
  const [px, py] = await page.evaluate((at) => window.__tornoLineup!.client('photo', at), photoAt)
  await page.mouse.click(px, py)
  const [tx, ty] = await page.evaluate((at) => window.__tornoLineup!.client('tracing', at), uv)
  await page.mouse.click(tx, ty)
}
const clicks = (): Promise<{ photo: number[][]; tracing: Array<{ uv: number[]; snap?: unknown }> }> => page.evaluate(() => window.__tornoLineup!.clicks())

test('a tracing takes a photo from the dialog and opens the line-up, the photo on the left and the tracing on the right', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
  await page.evaluate(() => window.torno.tracings.make('bracket', { on: { main: 'XZ' }, layout: 'assembly', name: 'Front' }))
  await page.locator('.pboard-switch').getByRole('button', { name: 'Tracing', exact: true }).click()
  const panel = page.locator('.tr-panel')
  await expect(panel).toBeVisible()
  await expect.poll(() => page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1')) !== null), { timeout: 20_000 }).toBe(true)
  await expect(panel.getByRole('button', { name: 'Add photo' })).toBeVisible()
  await app.evaluate((_e, picked) => void ((globalThis as unknown as { __tornoMain: { pickPhotos: string[] } }).__tornoMain.pickPhotos = picked), [photo])
  await panel.getByRole('button', { name: 'Add photo' }).click()
  await expect(lineup()).toBeVisible()
  await expect(lineup().locator('[data-pane="photo"] img.lu-photo')).toBeVisible()
  await expect(lineup().locator('[data-pane="tracing"]')).toBeVisible()
  expect((await tracingOf()).photo).toMatchObject({ width: 400, height: 300, method: 'similar' })
  expect(readFileSync(join(photosDir(), '.gitignore'), 'utf8')).toBe('*\n')
})

test('clicks are numbered in pairs, Backspace takes the last away, and Done waits for 2 pairs (4 when straightening)', async () => {
  await expect(bar()).toHaveAttribute('data-state', 'waiting')
  await expect(lineup().getByRole('button', { name: 'Done' })).toBeDisabled()
  const cut: TracingCut = await page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1'))!)
  const [[u0, v0], [u1, v1]] = [cut.cut.bounds!.min, cut.cut.bounds!.max]
  const at = (f: number, g: number): [number, number] => [u0 + (u1 - u0) * f, v0 + (v1 - v0) * g]
  await clickPair([60, 220], at(0.25, 0.25))
  await expect(lineup().locator('[data-pane="photo"] .lu-marker')).toHaveCount(1)
  await expect(lineup().locator('[data-pane="tracing"] .lu-marker')).toHaveCount(1)
  // The same colour, and the same number, on both sides.
  const classes = await lineup().locator('.lu-marker').evaluateAll((els) => els.map((el) => [el.getAttribute('class'), el.querySelector('text')?.textContent]))
  expect(classes[0]).toEqual(classes[1])
  expect(classes[0][1]).toBe('1')
  await clickPair([340, 70], at(0.75, 0.75))
  await expect(lineup().locator('.lu-marker')).toHaveCount(4)
  await expect(bar()).toHaveAttribute('data-state', 'fit')
  await expect(bar()).toContainText(/scale [\d.]+ px\/mm · angle -?[\d.]+° · no spare point to check it \(2 points\)/)
  await expect(lineup().getByRole('button', { name: 'Done' })).toBeEnabled()
  // Backspace takes the last click (the tracing's) away.
  await page.keyboard.press('Backspace')
  expect((await clicks()).tracing).toHaveLength(1)
  expect((await clicks()).photo).toHaveLength(2)
  await expect(lineup().getByRole('button', { name: 'Done' })).toBeDisabled()
  // Put it back, then straighten: 4 pairs are needed.
  const [tx, ty] = await page.evaluate((p) => window.__tornoLineup!.client('tracing', p), at(0.75, 0.75))
  await page.mouse.click(tx, ty)
  await expect(lineup().getByRole('button', { name: 'Done' })).toBeEnabled()
  await page.keyboard.press('s')
  await expect(lineup().getByRole('switch', { name: /Straighten/ })).toHaveAttribute('aria-checked', 'true')
  await expect(lineup().getByRole('button', { name: 'Done' })).toBeDisabled()
  await page.keyboard.press('s')
  await expect(lineup().getByRole('switch', { name: /Straighten/ })).toHaveAttribute('aria-checked', 'false')
  await expect(lineup().getByRole('button', { name: 'Done' })).toBeEnabled()
  // What the window says under the bar.
  await expect(lineup()).toContainText("True only in the tracing's plane: what stands nearer the camera looks bigger.")
})

test('Cancel and Esc leave the photo as it was, and Line up opens the line-up again', async () => {
  await lineup().getByRole('button', { name: 'Cancel' }).click()
  await expect(lineup()).toHaveCount(0)
  expect((await tracingOf()).photo?.transform).toBeUndefined()
  await expect(page.locator('.tr-panel')).toContainText('not lined up yet')
  await page.locator('.tr-panel').getByRole('button', { name: 'Line up', exact: true }).click()
  await expect(lineup()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(lineup()).toHaveCount(0)
})

test('Done keeps the line-up, and the straightened copy is made, kept in the photos folder and drawn under the outline', async () => {
  await page.locator('.tr-panel').getByRole('button', { name: 'Line up', exact: true }).click()
  const cut: TracingCut = await page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1'))!)
  const [[u0, v0], [u1, v1]] = [cut.cut.bounds!.min, cut.cut.bounds!.max]
  const at = (f: number, g: number): [number, number] => [u0 + (u1 - u0) * f, v0 + (v1 - v0) * g]
  await clickPair([60, 220], at(0.25, 0.25))
  await clickPair([340, 70], at(0.75, 0.75))
  await lineup().getByRole('button', { name: 'Done' }).click()
  await expect(lineup()).toHaveCount(0)
  const lined = await tracingOf()
  expect(lined.photo?.pairs).toHaveLength(2)
  expect(lined.photo?.scale).toBeGreaterThan(0)
  expect(lined.photo?.transform).toHaveLength(9)
  // The copy is warped in the window and kept by main.
  await expect.poll(async () => (await tracingOf()).photo?.straightened, { timeout: 20_000 }).toMatch(/^s-[0-9a-f]{12}\.png$/)
  const copy = (await tracingOf()).photo!.straightened!
  expect(existsSync(join(photosDir(), copy))).toBe(true)
  expect(readdirSync(photosDir()).filter((f) => f.startsWith('p-'))).toHaveLength(1)
  // Under the outline, at its fade, by its rectangle in mm.
  const image = page.locator('.tr-drawing image[data-photo]')
  await expect(image).toHaveCount(1)
  await expect(image).toHaveAttribute('opacity', '0.5')
  expect(await image.getAttribute('href')).toMatch(/^blob:/)
  // The panel says what the line-up is, and that none of it is exact.
  const rows = page.locator('.tr-panel .tr-photo-rows')
  await expect(rows).toContainText(/px\/mm/)
  await expect(rows).toContainText('not exact')
  await expect(rows).toContainText('no spare point to check it')
  await expect(page.locator('.tr-block')).toContainText("not exact, and true only in the tracing's plane")
})

test('the fade is sent once, where the slider is let go, and Hide takes the photo off the sheet and puts it back', async () => {
  const slider = page.locator('.tr-panel').getByRole('slider', { name: 'Fade of the photo' })
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '0.25'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // Moved, not sent: the drawing follows, the file does not.
  await expect(page.locator('.tr-drawing image[data-photo]')).toHaveAttribute('opacity', '0.25')
  expect((await tracingOf()).photo?.fade).toBe(0.5)
  await slider.evaluate((el: HTMLInputElement) => el.dispatchEvent(new Event('change', { bubbles: true })))
  await expect.poll(async () => (await tracingOf()).photo?.fade).toBe(0.25)
  await page.locator('.tr-panel').getByRole('button', { name: 'Hide', exact: true }).click()
  await expect.poll(async () => (await tracingOf()).photo?.hidden).toBe(true)
  await expect(page.locator('.tr-drawing image[data-photo]')).toHaveCount(0)
  await page.locator('.tr-panel').getByRole('button', { name: 'Show', exact: true }).click()
  await expect(page.locator('.tr-drawing image[data-photo]')).toHaveCount(1)
})

test('the export draws the photo only when ticked', async () => {
  const out = join(root, 'out.svg')
  await app.evaluate((_e, to) => void ((globalThis as unknown as { __tornoMain: { pickSave: string | null } }).__tornoMain.pickSave = to), out)
  await page.evaluate(() => window.torno.export.saveTracing('bracket', 'T1', 'svg', { layers: true, marks: false, photo: false }))
  expect(readFileSync(out, 'utf8')).not.toContain('<image')
  await page.evaluate(() => window.torno.export.saveTracing('bracket', 'T1', 'svg', { layers: true, marks: false, photo: true }))
  const svg = readFileSync(out, 'utf8')
  expect(svg.match(/<image /g)).toHaveLength(1)
  expect(svg).toMatch(/href="data:image\/png;base64,/)
  expect(svg).toContain("not exact, and true only in the tracing's plane")
})

test('Swap photo keeps the tracing side and asks only for the photo clicks', async () => {
  const other = join(root, 'side.png')
  writeFileSync(other, png(300, 300, 200))
  await app.evaluate((_e, picked) => void ((globalThis as unknown as { __tornoMain: { pickPhotos: string[] } }).__tornoMain.pickPhotos = picked), [other])
  await page.locator('.tr-panel').getByRole('button', { name: 'Swap photo' }).click()
  await expect(lineup()).toBeVisible()
  const kept = await clicks()
  expect(kept.photo).toHaveLength(0)
  expect(kept.tracing).toHaveLength(2)
  await expect(lineup()).toContainText('Click point 1 on the photo')
  const was = (await tracingOf()).photo!
  expect(was).toMatchObject({ width: 300, height: 300 })
  expect(was.transform).toBeUndefined()
  expect(was.straightened).toBeUndefined()
  await page.keyboard.press('Escape')
  await expect(lineup()).toHaveCount(0)
  // The old photo and its copy are on the dropped list, not deleted.
  expect(readFileSync(join(photosDir(), 'dropped.json'), 'utf8')).toContain('"')
})
