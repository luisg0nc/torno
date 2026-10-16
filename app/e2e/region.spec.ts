import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inTerminal } from './terminal'
import type { TornoState } from '../src/renderer/state/store'
import type { ScanLayerState } from '../src/renderer/viewport/scans'
import type { RegionMark } from '../src/shared/marks'
import type { LookRequest } from '../src/shared/view'
import { grid, stl } from '../src/test/scanFixtures'

// Regions: a part of a scan is painted with the brush, kept as a mark whose triangles are a file beside the
// mesh, told to the agent, left out of a clash when the agent says so, and goes on as a mark when its scan is
// removed. The real import process, the real kernel and the SDK's MCP client against the app's own server.
//
// The window is hidden. Pictures come from window.__tornoTest.look; nothing here is the owner's scan.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page
const clients: Client[] = []

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-region-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  inTerminal(root)
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()))
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const scans = (): Promise<ScanLayerState[]> => page.evaluate(() => window.__tornoTest!.scans())
const tints = () => page.evaluate(() => window.__tornoTest!.regions())
const row = (id: string) => page.locator(`.scan-row[data-scan="${id}"]`)
const pickFile = (path: string | null) => app.evaluate((_electron, path) => void ((globalThis as unknown as { __tornoMain: { pickFile: string | null } }).__tornoMain.pickFile = path), path)
const terminal = (): Promise<string> => page.evaluate(() => window.__tornoTerm!.text())
/** What the terminal shows without its line breaks, which fall where the pane is wide. */
const said = async (): Promise<string> => (await terminal()).replace(/\s+/g, '')

async function open(name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
  await expect.poll(async () => ((await state()).objectId === name ? (await state()).build?.status : null), { timeout: 90_000 }).toBe('ok')
  await expect.poll(async () => (await state()).scene !== null).toBe(true)
}

async function prompt(): Promise<void> {
  await page.locator('.session-term textarea').focus()
  await page.keyboard.type('hook')
  await page.keyboard.press('Enter')
}

type Content = Array<{ type: string; text?: string }>
async function connect(objectId: string): Promise<Client> {
  const url = await app.evaluate((_electron, id) => (globalThis as unknown as { __tornoMain: { mcpUrlFor(id: string): string } }).__tornoMain.mcpUrlFor(id), objectId)
  const client = new Client({ name: 'torno-e2e', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  clients.push(client)
  return client
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args })
  return { isError: result.isError === true, text: (result.content as Content).find((block) => block.type === 'text')?.text ?? '' }
}

/** Where a point of the scan, in its own frame, is in the window. */
async function at(local: [number, number, number]): Promise<[number, number]> {
  const canvas = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
  const [fx, fy] = await page.evaluate((local) => window.__tornoTest!.projectScan('S1', local), local)
  return [canvas.x + fx * canvas.width, canvas.y + fy * canvas.height]
}

/** How many pixels two pictures of the same size differ in by more than a shade. */
function differing(one: LookRequest, other: LookRequest): Promise<number> {
  return page.evaluate(
    async ([one, other]) => {
      const pixels = async (request: LookRequest): Promise<Uint8ClampedArray> => {
        const made = await window.__tornoTest!.look(request)
        const bitmap = await createImageBitmap(new Blob([made.png as BlobPart], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [a, b] = [await pixels(one), await pixels(other)]
      if (a.length !== b.length) return -1
      let count = 0
      for (let n = 0; n < a.length; n += 4) if (Math.abs(a[n] - b[n]) + Math.abs(a[n + 1] - b[n + 1]) + Math.abs(a[n + 2] - b[n + 2]) > 24) count += 1
      return count
    },
    [one, other] as const
  )
}

const bar = () => page.locator('.regionbar')
const painted = async (): Promise<number> => Number((await bar().locator('.regionbar-count').innerText()).replace(/,/g, '').match(/(\d+) triangle/)?.[1] ?? Number.NaN)

test('a part of a scan is painted, named, kept as a mark with its mask, told to the agent and left out of a clash', async () => {
  await open('hollow')
  // A sheet inside the lid, which is 2 mm thick from z = 38: all 900 of its vertices are in it.
  const file = join(root, 'sheet.stl')
  writeFileSync(file, stl(grid(30, 1, () => 39)))
  await pickFile(file)
  await page.getByRole('button', { name: 'Import scan…' }).click()
  await expect.poll(async () => (await scans())[0]?.ready).toBe(true)
  await page.getByRole('button', { name: 'Top', exact: true }).click()
  // The view turns to it over a moment: what follows is aimed from above, and a press is answered from the camera as it then is.
  await expect.poll(async () => {
    const { position, target } = await page.evaluate(() => window.__tornoTest!.camera())
    return Math.hypot(position[0] - target[0], position[1] - target[1])
  }).toBeLessThan(0.01)
  await page.keyboard.press('b')
  await expect(bar()).toBeVisible()
  await expect(bar()).toContainText('Drag over the scan to paint the part to name')
  await bar().getByRole('textbox', { name: 'Brush radius' }).fill('3')
  await bar().getByRole('textbox', { name: 'Brush radius' }).press('Enter')
  // Fix round 1 (I1): the lid is over the sheet, and what is not seen is not painted. A press on it takes nothing: it is the camera's, as beside the scan.
  await page.mouse.move(...(await at([-10, -8, 39])))
  await page.mouse.down()
  await page.mouse.up()
  await expect(bar()).toContainText('0 triangles')
  expect((await tints()).painting).toBeNull()
  // The lid is switched off to paint.
  await page.locator('.layer-row[data-layer="lid"]').getByRole('button', { name: 'Show lid' }).click()
  // One stroke along the sheet's left side, from front to back.
  await page.mouse.move(...(await at([-10, -8, 39])))
  await page.mouse.down()
  for (const y of [-4, 0, 4, 8]) await page.mouse.move(...(await at([-10, y, 39])), { steps: 4 })
  await page.mouse.up()
  await expect(bar()).toContainText(/\d+ triangles/)
  const first = await painted()
  expect(first).toBeGreaterThan(20)
  // What is in hand is tinted on the scan as it was painted, and is no mark yet.
  expect(await tints()).toMatchObject({ regions: [], painting: { scan: 'S1', triangles: first, visible: true } })
  expect((await state()).marks).toEqual([])

  // Beyond the brief's test: the brush takes paint off with Ctrl held, a stroke is taken back, and a box adds what it goes round.
  await page.keyboard.down('Control')
  await page.mouse.move(...(await at([-10, 6, 39])))
  await page.mouse.down()
  await page.mouse.move(...(await at([-10, 8, 39])), { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  await expect.poll(painted).toBeLessThan(first)
  await bar().getByRole('button', { name: 'Undo' }).click()
  await expect.poll(painted).toBe(first)
  await page.keyboard.down('Shift')
  await page.mouse.move(...(await at([4, 4, 39])))
  await page.mouse.down()
  await page.mouse.move(...(await at([8, 8, 39])), { steps: 3 })
  await expect(page.locator('.region-box')).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(page.locator('.region-box')).toHaveCount(0)
  // The 4 × 4 cells of that corner: 32 triangles, each wholly or by its middle inside.
  await expect.poll(painted).toBeGreaterThan(first + 20)
  await page.keyboard.press('z')
  await expect.poll(painted).toBe(first)

  // Fix round 1 (I5): another tool, or Escape, and the painting waits: the Region tool's button says so, and it is in hand again with B.
  await page.keyboard.press('Escape')
  await expect(bar()).toHaveCount(0)
  await expect(page.locator('.tool-button[data-tool="region"]')).toHaveAttribute('data-waiting', '')
  expect((await tints()).painting).toBeNull()
  await page.keyboard.press('b')
  await expect(bar()).toContainText(`A painting of ${first} triangles on S1 is waiting: Keep or Clear, or paint on`)
  expect((await tints()).painting).toMatchObject({ triangles: first, visible: true })
  // Clear is the one way it goes, and Undo brings that back.
  await bar().getByRole('button', { name: 'Clear' }).click()
  await expect(bar()).toContainText('0 triangles')
  await bar().getByRole('button', { name: 'Undo' }).click()
  await expect.poll(painted).toBe(first)

  const camera = await page.evaluate(() => window.__tornoTest!.camera())
  await bar().getByRole('button', { name: 'Keep' }).click()
  // The stroke turned no camera, and the note of the new mark is open.
  expect(await page.evaluate(() => window.__tornoTest!.camera())).toEqual(camera)
  await expect.poll(async () => (await state()).marks.length).toBe(1)
  await page.keyboard.type('wiring loom, can be pushed aside')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await state()).marks[0]).toMatchObject({ id: 'M1', kind: 'region', scan: 'S1', status: 'draft', author: 'user', note: 'wiring loom, can be pushed aside' })
  const region = (await state()).marks[0] as RegionMark
  expect(region.triangles).toBe(first)
  // About a 6 mm band 16 mm long.
  expect(region.area).toBeGreaterThan(60)
  expect(region.area).toBeLessThan(200)
  expect(Math.abs(region.local.plane.normal[2])).toBeCloseTo(1, 6)
  // Its triangles are a file beside the mesh, a bit each; the marks file holds none of them.
  const mask = readFileSync(join(root, 'hollow', '.torno', 'scans', 'S1', 'M1.mask'))
  expect(mask.length).toBe(16 + Math.ceil(1682 / 8))
  expect([...mask.subarray(16)].reduce((sum, byte) => sum + byte.toString(2).split('1').length - 1, 0)).toBe(region.triangles)
  expect(readFileSync(join(root, 'hollow', '.torno', 'marks.json'), 'utf8')).not.toContain('bits')

  expect(region.mesh).toMatch(/^[0-9a-f]{64}\|900\|1682\|mm\|z$/)
  // On screen: the bar has nothing in hand, the region is tinted from its mask and has its number, and its row says what it is.
  await expect(bar()).toContainText('0 triangles')
  await expect.poll(async () => (await tints()).regions).toEqual([{ id: 'M1', scan: 'S1', triangles: region.triangles, visible: true, colour: expect.stringMatching(/^#[0-9a-f]{6}$/) }])
  expect((await tints()).painting).toBeNull()
  expect(await page.evaluate(() => window.__tornoTest!.markScreen('M1'))).toMatchObject({ visible: true })
  const markRow = page.locator('.mark-row[data-mark="M1"]')
  await expect(markRow.locator('.mark-kind')).toHaveAttribute('aria-label', `Region · S1 · ${region.triangles.toLocaleString('en-US')} triangles`)
  await expect(markRow.locator('.mark-value')).toHaveText('S1')
  // In a picture for the agent it is tinted and numbered like any mark, and not in one without the marks, or without its scan.
  // (The lid is off on screen, and so in these pictures: the sheet is seen from above.)
  expect(await differing({ view: 'top', size: 400 }, { view: 'top', size: 400, marks: false })).toBeGreaterThan(300)
  expect(await differing({ view: 'top', size: 400, scans: false }, { view: 'top', size: 400, scans: false, marks: false })).toBe(0)
  // With its scan switched off it is not drawn, and its row says so.
  await row('S1').getByRole('button', { name: 'Show S1' }).click()
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.markScreen('M1'))).toBeNull()
  await expect(markRow).toContainText('its scan is hidden')
  await row('S1').getByRole('button', { name: 'Show S1' }).click()
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.markScreen('M1'))).not.toBeNull()

  // Not aligned: the agent is told the region with no place, and a clash is refused.
  await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
  await expect.poll(terminal).toContain('READY')
  await prompt()
  await expect.poll(said).toContain('M1regiononscanS1(notalignedinassembly,soithasnoplaceinthemodel’sframe)')
  await expect.poll(async () => (await state()).marks[0].status).toBe('sent')
  const client = await connect('hollow')
  expect((await call(client, 'scan_clash', { part: 'lid', ignore: ['M1'] })).text).toContain('S1 is not aligned in layout assembly')
  await app.evaluate(() => (globalThis as any).__tornoMain.scans.align('hollow', 'S1', 'assembly', { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['typed'], frame: { tub: [0, 0, 0], lid: [0, 0, 0] }, at: new Date().toISOString() }))
  const marks = JSON.parse((await call(client, 'marks')).text).marks
  expect(marks[0].line).toMatch(/^M1 region on scan S1: [\d,]+ triangles, ≈ [\d.]+ mm², centre ≈ \(-?[\d.]+, -?[\d.]+, 39\), ≈ [\d.]+ × [\d.]+ × 0 mm, its long side along \(-?[\d.]+, (1|0\.99\d*), 0\), within a box of ≈ [\d.]+ × [\d.]+ × 0 mm, flat about a plane with normal ≈ \(0, 0, 1\): /)
  expect(marks[0].local).toBeUndefined()
  for (const key of ['local', 'mesh', 'mask']) expect(marks[0]).not.toHaveProperty(key)
  expect(marks[0]).toMatchObject({ scan: 'S1', triangles: region.triangles, toldIn: 'assembly', aligned: true, flat: true, bbox: { min: [expect.any(Number), expect.any(Number), 39], max: [expect.any(Number), expect.any(Number), 39] } })
  const all = JSON.parse((await call(client, 'scan_clash', { part: 'lid' })).text)
  expect(all.inside.count).toBe(900)
  const left = JSON.parse((await call(client, 'scan_clash', { part: 'lid', ignore: ['M1'] })).text)
  expect(left.points.ignored).toBeGreaterThan(10)
  expect(left.inside.count).toBe(900 - left.points.ignored)
  expect(left.reading).toMatch(/, \d+ points of M1 left out/)
  expect(left.ignore).toEqual(['M1'])
  const only = JSON.parse((await call(client, 'scan_deviation', { part: 'lid', region: 'M1', from: 'scan' })).text)
  // The points on the region's rim are its own when it is asked for alone, and still count when it is left out.
  expect(only.samples).toBeGreaterThan(left.points.ignored)
  expect(only.region).toBe('M1')
  // And as an end of a measurement: its middle, where the scan stands.
  const measured = JSON.parse((await call(client, 'measure', { kind: 'distance', a: 'M1', b: 'tub' })).text)
  expect(measured.reading).toMatch(/the centroid of region M1 \(S1\) at \(-?[\d.]+, -?[\d.]+, 39\) to tub/)
  expect(measured.exact).toBe(false)
})

test('a kept region is painted again from its row: a new mask, the same mark, and the agent is told it changed', async () => {
  const before = (await state()).marks[0] as RegionMark
  expect(before.status).toBe('sent')
  await page.locator('.mark-row[data-mark="M1"]').hover()
  await page.getByRole('button', { name: 'Edit M1', exact: true }).click()
  await expect(bar()).toContainText('Painting M1 again')
  await expect.poll(painted).toBe(before.triangles)
  // While it is in hand it is drawn as the painting, not as it was kept.
  await expect.poll(async () => (await tints()).regions).toEqual([])
  // A dab on the other side of the sheet.
  await page.mouse.move(...(await at([8, 0, 39])))
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(painted).toBeGreaterThan(before.triangles)
  const now = await painted()
  await page.keyboard.press('Enter')
  await expect.poll(async () => ((await state()).marks[0] as RegionMark).triangles).toBe(now)
  const after = (await state()).marks[0] as RegionMark
  expect(after).toMatchObject({ id: 'M1', note: 'wiring loom, can be pushed aside', status: 'draft', sentBefore: true, mask: 1, mesh: before.mesh })
  // No note opened: it has one.
  await expect(page.locator('.note-popover')).toHaveCount(0)
  expect(existsSync(join(root, 'hollow', '.torno', 'scans', 'S1', 'M1.mask'))).toBe(false)
  const mask = readFileSync(join(root, 'hollow', '.torno', 'scans', 'S1', 'M1.1.mask'))
  expect([...mask.subarray(16)].reduce((sum, byte) => sum + byte.toString(2).split('1').length - 1, 0)).toBe(now)
  await expect.poll(async () => (await tints()).regions).toMatchObject([{ id: 'M1', triangles: now }])
  // The kernel is given the new file: more points are left out than before.
  const client = await connect('hollow')
  const left = JSON.parse((await call(client, 'scan_clash', { part: 'lid', ignore: ['M1'] })).text)
  expect(left.inside.count).toBe(900 - left.points.ignored)
  expect(left.points.ignored).toBeGreaterThan(20)
  await prompt()
  await expect.poll(said).toContain('(changed)M1regiononscanS1:')
})

test('a region goes on as a mark when its scan is removed, and says so', async () => {
  // What is done with a scan is in its detail, under its row.
  const details = row('S1').getByRole('button', { name: 'Details of S1' })
  if ((await details.getAttribute('aria-expanded')) !== 'true') await details.click()
  await row('S1').getByRole('button', { name: 'Remove' }).click()
  // It is asked first, and the question says what goes with the scan.
  await expect(row('S1')).toContainText('It has 1 region painted on it')
  await page.getByRole('button', { name: 'Remove', exact: true }).last().click()
  await expect.poll(async () => (await state()).marks[0].anchorState).toBe('orphaned')
  await expect(page.locator('section.marks')).toContainText('its scan is gone')
  expect(existsSync(join(root, 'hollow', '.torno', 'scans', 'S1'))).toBe(false)
  // Nothing is tinted or numbered where there is no scan, and the agent is told what became of it.
  expect((await tints()).regions).toEqual([])
  expect(await page.evaluate(() => window.__tornoTest!.markScreen('M1'))).toBeNull()
  const client = await connect('hollow')
  expect(JSON.parse((await call(client, 'marks')).text).marks[0].line).toBe('M1 region on scan S1 [its scan is gone]: "wiring loom, can be pushed aside"')
  // Deleting the mark leaves nothing of it.
  await page.locator('.mark-row[data-mark="M1"]').hover()
  await page.getByRole('button', { name: 'Delete M1', exact: true }).click()
  await expect.poll(async () => (await state()).marks).toEqual([])
})

// Milestone 5 (R1): the brush is a ball round the point under the pointer. Beside a part it reaches under it, and takes nothing there.
test('a stamp beside a part takes nothing the part hides', async () => {
  await open('plain')
  // A sheet 3 mm under the plate, which is 20 mm square: seen from above, the plate hides its middle.
  const sheet = grid(60, 1, () => -3)
  const file = join(root, 'under.stl')
  writeFileSync(file, stl(sheet))
  await pickFile(file)
  await page.getByRole('button', { name: 'Import scan…' }).click()
  await expect.poll(async () => (await scans())[0]?.ready).toBe(true)
  await page.getByRole('button', { name: 'Top', exact: true }).click()
  await expect.poll(async () => {
    const { position, target } = await page.evaluate(() => window.__tornoTest!.camera())
    return Math.hypot(position[0] - target[0], position[1] - target[1])
  }).toBeLessThan(0.01)
  if (!(await bar().isVisible())) await page.keyboard.press('b')
  await expect(bar()).toBeVisible()
  await bar().getByRole('textbox', { name: 'Brush radius' }).fill('6')
  await bar().getByRole('textbox', { name: 'Brush radius' }).press('Enter')
  // From the plate's edge outwards, to the first pixel where no part is seen, and 3 px on.
  const canvas = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
  const onPlate = (x: number, y: number): Promise<boolean> => page.evaluate(([fx, fy]) => window.__tornoTest!.pickAt(fx, fy, { partsOnly: true, edges: false }) !== null, [(x - canvas.x) / canvas.width, (y - canvas.y) / canvas.height] as const)
  let [x, y] = await at([8, 0, -3])
  expect(await onPlate(x, y)).toBe(true)
  const [far] = await at([14, 0, -3])
  const outwards = Math.sign(far - x)
  while (await onPlate(x, y)) x += outwards
  x += 3 * outwards
  // A millimetre of the sheet is several pixels: the brush reaches well under the plate.
  expect(Math.abs(far - x)).toBeGreaterThan(20)
  // What of the sheet is under the pointer there: 3 px beside the plate's outline, in plain sight.
  const under = await page.evaluate(([fx, fy]) => window.__tornoTest!.pickScanAt(fx, fy), [(x - canvas.x) / canvas.width, (y - canvas.y) / canvas.height] as const)
  expect(under).toMatchObject({ scan: 'S1' })
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(painted).toBeGreaterThan(10)
  await bar().getByRole('button', { name: 'Keep' }).click()
  await expect.poll(async () => (await state()).marks.length).toBe(1)
  await page.keyboard.type('beside the plate')
  await page.keyboard.press('Enter')
  const region = (await state()).marks[0] as RegionMark
  const mask = readFileSync(join(root, 'plain', '.torno', 'scans', region.scan, `${region.id}.mask`)).subarray(16)
  const middles: Array<[number, number, number]> = []
  for (let t = 0; t < sheet.triangles.length / 3; t++) {
    if (!((mask[t >> 3] >> (t & 7)) & 1)) continue
    const corners = [0, 1, 2].map((n) => sheet.triangles[t * 3 + n] * 3)
    middles.push([0, 1, 2].map((axis) => (sheet.vertices[corners[0] + axis] + sheet.vertices[corners[1] + axis] + sheet.vertices[corners[2] + axis]) / 3) as [number, number, number])
  }
  expect(middles.length).toBe(region.triangles)
  // Fix round 1 (I1): the triangle under the pointer is painted. An edge of the plate is within reach of a pick there, and is no part in front.
  expect((mask[under!.triangle >> 3] >> (under!.triangle & 7)) & 1).toBe(1)
  // Not one of them is drawn where the plate is seen.
  const hidden = await page.evaluate((middles) => middles.filter((local) => window.__tornoTest!.pickAt(...window.__tornoTest!.projectScan('S1', local), { partsOnly: true, edges: false }) !== null).length, middles)
  expect(hidden).toBe(0)
  // And the ball did reach under it: a whole one would have taken more than was seen, about half as much again.
  const [cx] = middles.reduce((sum, m) => [sum[0] + m[0] / middles.length, 0, 0] as [number, number, number], [0, 0, 0] as [number, number, number])
  expect(Math.abs(cx)).toBeGreaterThan(10)
  expect(middles.every((m) => Math.abs(m[0]) > 9.9)).toBe(true)
  expect(region.triangles).toBeLessThan(Math.PI * 36 * 2 * 0.75)
})
