import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { Mark, PinMark, SketchMark } from '../src/shared/marks'
import type { TracingCut } from '../src/shared/tracings'
import { openListed } from './objects'

// Pins and ink on a tracing, in the window: Pin leaves a note on a point, Ink draws a stroke in the plane, Select picks a mark and Delete removes it
// (Undo puts it back). Each is a mark that names its tracing and lies in its plane; the ink's card picture is drawn from this view. The window is hidden:
// the clicks are made at the page's own places for the points (the sheet's view says where a point of the plane is).
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-tracing-marks-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const marks = (): Promise<Mark[]> => page.evaluate(() => window.torno.marks.list('bracket'))
const stage = () => page.locator('.tr-stage')

/** Where a point of the plane is on the page now: the sheet's corner and zoom, the stage's place, and v running up the screen (the plane's y is +Z). */
async function client(uv: [number, number]): Promise<[number, number]> {
  const view = await page.evaluate(() => window.__tornoTracingSheet!())
  const box = (await stage().boundingBox())!
  return [box.x + view.x + uv[0] * view.k, box.y + view.y - uv[1] * view.k]
}

test('a pin on the tracing is a mark in its plane, with its note typed where it is', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
  await page.evaluate(() => window.torno.tracings.make('bracket', { on: { main: 'XZ' }, layout: 'assembly', name: 'Front' }))
  await page.locator('.pboard-switch').getByRole('button', { name: 'Tracing', exact: true }).click()
  await expect(page.locator('.tr-panel')).toBeVisible()
  await expect.poll(() => page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1')) !== null), { timeout: 20_000 }).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__tornoTracingSheet?.().k ?? 0)).toBeGreaterThan(0)

  const cut: TracingCut = await page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1'))!)
  const [u, v] = [(cut.cut.bounds!.min[0] + cut.cut.bounds!.max[0]) / 2, (cut.cut.bounds!.min[1] + cut.cut.bounds!.max[1]) / 2]
  await page.locator('.tr-palette [data-tool="pin"]').click()
  const [x, y] = await client([u, v])
  await page.mouse.click(x, y)
  const field = page.getByLabel('Note of the pin')
  await expect(field).toBeFocused()
  await field.fill('check this wall')
  await field.press('Enter')
  await expect.poll(async () => (await marks()).length).toBe(1)
  const [pin] = (await marks()) as PinMark[]
  expect(pin).toMatchObject({ kind: 'pin', author: 'user', note: 'check this wall', tracing: 'T1', layout: 'assembly' })
  // In the plane (the XZ plane at y = 0), at the point clicked, and its uv are the plane's.
  expect(Math.abs(pin.anchor.point[1])).toBeLessThan(1e-6)
  expect(pin.uv?.[0][0]).toBeCloseTo(u, 1)
  expect(pin.uv?.[0][1]).toBeCloseTo(v, 1)
  await expect(page.locator('.tr-sheet-layer [data-mark="M1"]')).toBeVisible()
})

test('ink is a sketch of the plane, kept stroke by stroke, and its card is drawn from this view when the tool is put down', async () => {
  const cut: TracingCut = await page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1'))!)
  const [u0, v0] = [cut.cut.bounds!.min[0], cut.cut.bounds!.min[1]]
  await page.locator('.tr-palette [data-tool="ink"]').click()
  const [x, y] = await client([u0 + 2, v0 + 2])
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + 12 * i, y - 4 * i)
  await page.mouse.up()
  await expect.poll(async () => (await marks()).filter((m) => m.kind === 'sketch').length).toBe(1)
  const ink = (await marks()).find((m) => m.kind === 'sketch') as SketchMark
  expect(ink).toMatchObject({ tracing: 'T1', take: 'rough', author: 'user' })
  expect(ink.planes).toHaveLength(1)
  expect(ink.planes[0].from).toEqual({ kind: 'tracing', tracing: 'T1' })
  expect(ink.strokes[0]).toMatchObject({ plane: 1, pen: 'free' })
  expect(ink.strokes[0].points2d!.length).toBeGreaterThan(2)
  // Put down, the sketch is kept and its card is drawn from the tracing view.
  await page.locator('.tr-palette [data-tool="select"]').click()
  await expect.poll(async () => ((await marks()).find((m) => m.kind === 'sketch') as SketchMark).picture, { timeout: 15_000 }).toMatch(/^k-[0-9a-f]{12}\.png$/)
  const picture = ((await marks()).find((m) => m.kind === 'sketch') as SketchMark).picture!
  expect(existsSync(join(root, 'bracket', '.torno', 'notes', picture))).toBe(true)
})

test('Select picks the pin, Delete removes it, and Undo puts it back', async () => {
  const [pin] = (await marks()).filter((m): m is PinMark => m.kind === 'pin')
  const [u, v] = pin.uv![0]
  const [x, y] = await client([u, v])
  await page.mouse.click(x, y)
  await expect(page.locator('.tr-draft .tr-selected')).toBeVisible()
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await marks()).filter((m) => m.kind === 'pin').length).toBe(0)
  const undo = page.locator('.tr-undo-float').getByRole('button', { name: 'Undo' })
  await expect(undo).toBeVisible()
  await undo.click()
  await expect.poll(async () => (await marks()).filter((m) => m.kind === 'pin').length).toBe(1)
})
