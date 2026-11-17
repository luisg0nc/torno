import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { Mark, OffsetMark, SpanMark } from '../src/shared/marks'
import type { TracingCut } from '../src/shared/tracings'
import { openListed } from './objects'

// Measure and Should be here on a tracing, in the window: Measure between two of the cut's own corners is exact and says the build; Should be here
// drags a shape of a layer, Shift keeps one axis and an arrow key nudges it a tenth of a millimetre. Neither carries an intent. The window is hidden:
// the clicks are made at the page's own places for the points (the sheet's view says where a point of the plane is).
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-tracing-measures-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
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

test('Measure between two corners of the cut is exact, made by main from the kernel\'s points, and carries no intent', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
  await page.evaluate(() => window.torno.tracings.make('bracket', { on: { main: 'XZ' }, layout: 'assembly', name: 'Front' }))
  await page.locator('.pboard-switch').getByRole('button', { name: 'Tracing', exact: true }).click()
  await expect(page.locator('.tr-panel')).toBeVisible()
  await expect.poll(() => page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1')) !== null), { timeout: 20_000 }).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__tornoTracingSheet?.().k ?? 0)).toBeGreaterThan(0)

  const cut: TracingCut = await page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1'))!)
  const corners = cut.snaps.filter((s) => s.kind === 'corner')
  expect(corners.length).toBeGreaterThan(1)
  // Two corners that are far apart on the screen.
  const [a, b] = [corners[0], corners.find((c) => Math.hypot(c.uv[0] - corners[0].uv[0], c.uv[1] - corners[0].uv[1]) > 5) ?? corners[1]]
  await page.locator('.tr-palette [data-tool="measure"]').click()
  await expect(page.locator('.tr-palette [data-tool="measure"]')).toHaveAttribute('aria-pressed', 'true')
  const [ax, ay] = await client(a.uv)
  const [bx, by] = await client(b.uv)
  await page.mouse.click(ax, ay)
  await page.mouse.move(bx, by)
  await expect(page.locator('.tr-pointer-hint')).toContainText(/^\d/)
  await page.mouse.click(bx, by)
  await expect.poll(async () => (await marks()).filter((m) => m.kind === 'span').length).toBe(1)
  const span = (await marks()).find((m) => m.kind === 'span') as SpanMark
  expect(span).toMatchObject({ author: 'user', tracing: 'T1', exact: true, status: 'draft' })
  expect(span.how).toMatch(/^exact on build \d+$/)
  expect(span.value).toBeCloseTo(Math.hypot(b.uv[0] - a.uv[0], b.uv[1] - a.uv[1]), 6)
  expect(span).not.toHaveProperty('intent')
  expect(span).not.toHaveProperty('round')
  await expect(page.locator('.tr-sheet-layer [data-mark="M1"]')).toBeVisible()
})

test('a free Measure is ≈ and says freehand', async () => {
  const cut: TracingCut = await page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1'))!)
  const [u, v] = [(cut.cut.bounds!.min[0] + cut.cut.bounds!.max[0]) / 2, (cut.cut.bounds!.min[1] + cut.cut.bounds!.max[1]) / 2]
  const [x1, y1] = await client([u, v])
  const [x2, y2] = await client([u + 3, v + 4])
  // Ctrl turns snapping off, so that the corners and hole centres of the cut do not take the click.
  await page.keyboard.down('Control')
  await page.mouse.click(x1, y1)
  await page.mouse.click(x2, y2)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await marks()).filter((m) => m.kind === 'span').length).toBe(2)
  const span = (await marks()).filter((m) => m.kind === 'span')[1] as SpanMark
  expect(span).toMatchObject({ exact: false, how: 'freehand' })
  expect(span.value).toBeGreaterThan(4.9)
  expect(span.value).toBeLessThan(5.1)
})

test('Should be here drags a shape, Shift keeps one axis, an arrow nudges a tenth, and no intent goes with it', async () => {
  await page.evaluate(() => window.torno.tracings.layer('bracket', 'T1', { make: { name: 'bolts', colour: 'blue', shapes: [{ name: 'bolt 1', kind: 'circle', centre: [0, 0], radius: 4 }] } }))
  await expect.poll(() => page.evaluate(async () => (await window.torno.tracings.list('bracket')).tracings[0].layers.length)).toBe(1)
  await page.locator('.tr-palette [data-tool="offset"]').click()
  // The circle's rim, at its right: the pointer takes it there.
  const [x, y] = await client([4, 0])
  await page.mouse.move(x, y)
  await page.mouse.down()
  const [mx, my] = await client([4 + 3, 0.5])
  await page.keyboard.down('Shift')
  await page.mouse.move(mx, my, { steps: 4 })
  await expect(page.locator('.tr-pointer-hint')).toContainText('bolt 1 should be here · 3 mm right')
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await marks()).filter((m) => m.kind === 'offset').length).toBe(1)
  let offset = (await marks()).find((m) => m.kind === 'offset') as OffsetMark
  expect(offset).toMatchObject({ author: 'user', tracing: 'T1', layer: { id: 1, name: 'bolts' }, shape: { index: 0, name: 'bolt 1' }, status: 'draft' })
  expect(offset.by[1]).toBe(0)
  expect(offset.by[0]).toBeGreaterThan(2.5)
  expect(offset).not.toHaveProperty('intent')
  expect(offset.anchorState).toBe('ok')
  const first = offset.by[0]
  // An arrow key nudges the shape just placed a tenth of a millimetre to the left, changing the draft's by rather than adding a mark.
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => ((await marks()).find((m) => m.kind === 'offset') as OffsetMark).by[0]).toBeCloseTo(first - 0.1, 4)
  offset = (await marks()).find((m) => m.kind === 'offset') as OffsetMark
  expect(offset.id).toBe('M3')
  expect((await marks()).filter((m) => m.kind === 'offset')).toHaveLength(1)
})
