import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { LookRequest, ViewState } from '../src/shared/view'
import { box, grid, stl } from '../src/test/scanFixtures'
import type { ScanLayerState } from '../src/renderer/viewport/scans'

// A scan on screen: imported from the panel with the real import process, drawn with the parts, switched and
// thinned from its row, cut open by the section, named in pictures, and kept in scene.json as it was looked at.
//
// The window is hidden. Pictures come from window.__tornoTest.look; nothing here is the owner's scan.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

function copyFixtures(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-scan-'))
  cpSync(fixtures, dir, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  return dir
}

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
function launch(env: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, ...env } })
}

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (p: Page = page): Promise<TornoState> => p.evaluate(() => window.__tornoTest!.state())

async function open(name: string, p: Page = page): Promise<void> {
  await p.getByRole('button', { name, exact: true }).click()
  await expect.poll(async () => ((await state(p)).objectId === name ? (await state(p)).build?.status : null), { timeout: 90_000 }).toBe('ok')
  await expect.poll(async () => (await state(p)).scene !== null).toBe(true)
}

// A scan made here: a plate 60 × 50 × 2 under the bracket's base, so that every view of the parts has it in frame.
const PLATE = stl(box([60, 50, 2], [0, 0, -10]))
let scanFile: string

const scans = (p: Page = page): Promise<ScanLayerState[]> => p.evaluate(() => window.__tornoTest!.scans())
const row = (id: string, p: Page = page) => p.locator(`.scan-row[data-scan="${id}"]`)
/** The detail of a scan's row, opened when it is not: what the row says beyond its one line is in it. */
const detail = async (id: string, p: Page = page) => {
  const button = row(id, p).getByRole('button', { name: `Details of ${id}` })
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  return row(id, p).locator('.scan-detail')
}
const pickFile = (path: string | null) => app.evaluate((_electron, path) => void ((globalThis as unknown as { __tornoMain: { pickFile: string | null } }).__tornoMain.pickFile = path), path)
const picture = (request: LookRequest, p: Page = page) =>
  p.evaluate(async (request) => {
    const made = await window.__tornoTest!.look(request)
    return { caption: made.caption, sum: made.png.reduce((a, b) => (a * 31 + b) % 1_000_000_007, 7) }
  }, request)
/**
 * Stands a scan `t` away from where it was imported, as three pairs of points that fit exactly would: an alignment
 * that is not rough, made on the build on show (main refuses one made on another).
 */
async function place(id: string, t: [number, number, number], p: Page = page): Promise<void> {
  await p.evaluate(
    ({ id, t }) => {
      const pairs = ([[0, 0, 0], [10, 0, 0], [0, 10, 0]] as [number, number, number][]).map((scan) => ({ scan, model: [scan[0] + t[0], scan[1] + t[1], scan[2] + t[2]] as [number, number, number], residual: 0 }))
      return window.torno.scans.align('bracket', id, 'assembly', { transform: { t, q: [0, 0, 0, 1], s: 1 }, steps: ['pairs'], pairs }, { revision: window.__tornoTest!.state().revision })
    },
    { id, t }
  )
  // Checked against the build on show: until then every report of it says that it was not.
  await expect.poll(() => p.evaluate((id) => { const s = window.__tornoTest!.state(); return s.scans.find((scan) => scan.id === id)?.checks.assembly?.revision === s.revision }, id)).toBe(true)
}
/** What a picture's caption says of a scan `place` aligned: what it rests on, and that no build can say whether it holds (its ends are on no part). */
const PLACED = '3 pairs, RMS under 0.1 mm; tied to no point of the model: not checked against builds'
const scansFile = () => JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'scans.json'), 'utf8'))

test.beforeAll(async () => {
  root = copyFixtures()
  scanFile = join(root, 'plate under.stl')   // outside every object folder, with a space in its name
  writeFileSync(scanFile, PLATE)
  app = await launch({ TORNO_WORKSPACE: root })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
  await open('bracket')
})

test('a scan is imported from the panel, drawn, and said in millimetres', async () => {
  await expect(page.getByRole('region', { name: 'Scans' })).toContainText('Drop a scan on the view, or import one.')
  await pickFile(scanFile)
  await page.getByRole('button', { name: 'Import scan…' }).click()
  await expect(row('S1')).toContainText('plate under.stl')
  await expect(row('S1').locator('.chip[data-state="unaligned"]')).toHaveText('unaligned')
  // Issue #21: a guess is asked about once, at the top of the panel, with the size another reading would give.
  const sheet = page.getByRole('dialog', { name: 'How is S1 read?' })
  await expect(sheet).toContainText('S1 was read as millimetres, Z up: torno guessed from the format and the size.')
  await expect(sheet.locator('[data-part="size"]')).toHaveText('Its size would be 60 × 50 × 2 mm')
  await sheet.getByRole('combobox', { name: 'Unit of S1' }).selectOption('cm')
  await expect(sheet.locator('[data-part="size"]')).toHaveText('Its size would be 600 × 500 × 20 mm')
  await sheet.getByRole('combobox', { name: 'Up axis of S1' }).selectOption('y')
  await expect(sheet.locator('[data-part="size"]')).toHaveText('Its size would be 600 × 20 × 500 mm')
  await sheet.getByRole('combobox', { name: 'Unit of S1' }).selectOption('mm')
  await sheet.getByRole('combobox', { name: 'Up axis of S1' }).selectOption('z')
  await expect(sheet.getByRole('button', { name: 'Apply' })).toBeDisabled()
  // Later: put away, and still to be answered, with a dot on the row and the question in its detail.
  await sheet.getByRole('button', { name: 'Later' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(row('S1').getByRole('img', { name: 'Read as assumed' })).toHaveAttribute('title', 'Read as millimetres, Z up: assumed')
  // The row is one line; what else it says waits in its detail.
  await expect(row('S1').locator('.scan-read')).toHaveCount(0)
  await expect(row('S1').getByRole('button', { name: 'Frame S1' })).toHaveCount(0)
  const head = (await row('S1').locator('.scan-head').boundingBox())!
  const line = await row('S1').locator('.scan-head .row-name').evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height)
  expect(head.height).toBeLessThanOrEqual(Math.max(28, 1.5 * line))
  await expect(row('S1').locator('.scan-head .row-name')).toHaveAttribute('title', `plate under.stl, from ${scanFile}`)
  await expect(row('S1').getByRole('button', { name: 'Show S1' })).toBeVisible()
  const open = await detail('S1')
  await expect(open).toContainText('60 × 50 × 2 mm, from mm, Z up (assumed)')
  await expect(open.locator('.scan-guess')).toContainText('Read as millimetres, Z up: right?')
  await expect(open.getByRole('combobox', { name: 'Unit of S1' })).toBeVisible()
  await expect(open.getByRole('button', { name: 'Apply' })).toBeDisabled()
  await expect(open.locator('.scan-said[data-part="state"]')).toHaveText('Not aligned in assembly: nothing is checked against it here')
  for (const action of ['Frame S1', 'Align S1', 'Rename S1']) await expect(open.getByRole('button', { name: action })).toBeVisible()
  await expect.poll(async () => (await scans())[0]).toMatchObject({ id: 'S1', loaded: true, triangles: 12, aligned: false, visible: true, opacity: 1 })
  expect((await state()).scans[0]).toMatchObject({ id: 'S1', sourceState: 'present', meshState: 'ok', source: { path: scanFile } })
  expect(scansFile()).toMatchObject({ next: 2, scans: [{ id: 'S1', source: { path: scanFile, bytes: PLATE.length } }] })
  expect(readFileSync(scanFile).equals(PLATE)).toBe(true)
  // Only .torno was written in the object's folder.
  expect(existsSync(join(root, 'bracket', '.torno', 'scans', 'S1', 'mesh.bin'))).toBe(true)
  expect(await app.evaluate(() => (globalThis as unknown as { __tornoMain: { filePicks: number } }).__tornoMain.filePicks)).toBe(1)
})

test('a picture has the scan unless it is asked without, and says which', async () => {
  const withScan = await picture({ view: 'iso', size: 256 })
  const without = await picture({ view: 'iso', size: 256, scans: false })
  // Changed in fix round 1 (I1): a scan that is not aligned is said not to be where the model is.
  expect(withScan.caption).toContain(' · scans S1 (not aligned in assembly: drawn where it was imported) · ')
  expect(without.caption).not.toContain('scans')
  await place('S1', [0, 0, 1])
  await expect(row('S1').locator('.chip[data-state="placed"]')).toHaveText('placed')
  expect((await picture({ view: 'iso', size: 256 })).caption).toContain(` · scans S1 (${PLACED}) · `)
  expect((await picture({ view: 'iso', size: 256, layout: 'print' })).caption).toContain(' · scans S1 (not aligned in print: drawn where it was imported) · ')
  await page.evaluate(() => window.torno.scans.align('bracket', 'S1', 'assembly', null))
  await expect(row('S1').locator('.chip[data-state="unaligned"]')).toHaveText('unaligned')
  expect(withScan.sum).not.toBe(without.sum)
  await expect(picture({ view: 'iso', size: 256, scans: ['S9'] })).rejects.toThrow('no scan S9; scans: S1')
})

test('opacity and the eye are kept in scene.json as the person set them, and are there again after a restart', async () => {
  // The slider takes room on the row only when it is pointed at.
  await row('S1').hover()
  await row('S1').getByRole('slider', { name: 'Opacity of S1' }).fill('0.6')
  await expect.poll(async () => (await scans())[0].opacity).toBe(0.6)
  expect((await picture({ view: 'iso', size: 256 })).caption).toContain('scans S1 at 60 % (not aligned in assembly')
  await row('S1').getByRole('button', { name: 'Show S1' }).click()
  await expect.poll(async () => (await scans())[0].visible).toBe(false)
  expect((await picture({ view: 'iso', size: 256 })).caption).not.toContain('scans')
  // The file is written half a second after the last change: until then there may be none.
  const saved = (): unknown => {
    const path = join(root, 'bracket', '.torno', 'scene.json')
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).scans : undefined
  }
  await expect.poll(saved).toEqual({ S1: { visible: false, opacity: 0.6 } })
  await app.close()
  app = await launch({ TORNO_WORKSPACE: root })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
  await open('bracket')
  await expect.poll(async () => (await scans())[0]).toMatchObject({ id: 'S1', loaded: true, visible: false, opacity: 0.6 })
  await row('S1').getByRole('button', { name: 'Show S1' }).click()
})

test('the section cuts a scan open, and what the view tells main names it', async () => {
  const whole = await picture({ view: 'front', size: 256, section: null })
  const cut = await picture({ view: 'front', size: 256, section: { origin: [0, 0, 0], normal: [0, -1, 0] } })
  expect(cut.sum).not.toBe(whole.sum)
  const view = await app.evaluate(() => (globalThis as unknown as { __tornoMain: { latestView(objectId: string): ViewState | undefined } }).__tornoMain.latestView('bracket'))
  expect(view?.scans).toEqual([{ id: 'S1', visible: true, opacity: 0.6, loaded: true }])
  // Fix round 1 (I5): with the parts left out only the scan can change the pixels. The plate is at z -11 to -9.
  const only = { view: 'iso', size: 256, parts: [], marks: false } satisfies LookRequest
  const none = await picture({ ...only, scans: false, section: { origin: [0, 0, -5], normal: [0, 0, -1] } })
  const gone = await picture({ ...only, scans: ['S1'], section: { origin: [0, 0, -5], normal: [0, 0, -1] } })
  const kept = await picture({ ...only, scans: ['S1'], section: { origin: [0, 0, -5], normal: [0, 0, 1] } })
  const through = await picture({ ...only, scans: ['S1'], section: { origin: [0, 0, 0], normal: [0, 1, 0] } })
  expect(gone.sum).toBe(none.sum) // all of the plate is on the side taken away: nothing of it is drawn
  expect(kept.sum).not.toBe(none.sum) // on the side kept, it is
  expect(new Set([none.sum, kept.sum, through.sum]).size).toBe(3) // and half of it when the plane goes through it
})

test('a unit that was assumed wrongly is changed on the row, without the source', async () => {
  rmSync(scanFile)
  await page.reload()
  await page.waitForSelector('[data-region="left"]')
  await open('bracket')
  await expect((await detail('S1')).locator('.scan-said[data-part="source"]')).toHaveText(`Source missing: ${scanFile} is no longer there. The scan goes on working from what torno made of it.`)
  // Changed for issue #21: a guess put off is still asked about in the detail, with what changes it.
  await expect(row('S1').locator('.scan-guess')).toContainText('Read as millimetres, Z up: right?')
  await row('S1').getByRole('combobox', { name: 'Unit of S1' }).selectOption('cm')
  await row('S1').getByRole('button', { name: 'Apply' }).click()
  await expect(row('S1')).toContainText('600 × 500 × 20 mm, from cm, Z up')
  await expect(row('S1').getByRole('img', { name: 'Read as assumed' })).toHaveCount(0)
  // Both were chosen by pressing Apply: neither is assumed any more.
  await expect.poll(async () => (await state()).scans[0].imported.assumed).toEqual({ unit: false, up: false })
  await expect(row('S1')).not.toContainText('assumed')
  await expect(row('S1').locator('.scan-guess')).toHaveCount(0)
  await expect(row('S1').getByRole('button', { name: 'Apply' })).toBeDisabled()
})

test('a file that is no scan is said to be none, and a scan is removed with its folder only', async () => {
  const other = join(root, 'part.3mf')
  writeFileSync(other, '')
  await pickFile(other)
  await page.getByRole('button', { name: 'Import scan…' }).click()
  await expect(page.getByRole('region', { name: 'Scans' })).toContainText('part.3mf is not a scan torno reads: .glb, .gltf, .obj, .ply or .stl')
  await (await detail('S1')).getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).last().click()
  await expect(row('S1')).toHaveCount(0)
  expect(existsSync(join(root, 'bracket', '.torno', 'scans', 'S1'))).toBe(false)
  expect(scansFile()).toMatchObject({ next: 2, scans: [] })
  expect(existsSync(other)).toBe(true)
})

// Beyond the brief's tests.

/** A file dropped on the view, as the page can make one: with a name, and no place on the disk. */
const drop = (name: string, p: Page = page) =>
  p.evaluate((name) => {
    const pane = document.querySelector('.viewport-pane')!
    const box = pane.getBoundingClientRect()
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['solid'], name))
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: box.left + 80, clientY: box.top + 80 })
    pane.dispatchEvent(over)
    pane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: box.left + 80, clientY: box.top + 80 }))
    return { taken: over.defaultPrevented, effect: dataTransfer.dropEffect }
  }, name)

test('what is dropped on the view that is no scan, or has no file behind it, is said in the panel until it is put away', async () => {
  // Changed in fix round 1 (I3): said in the panel, where it stays until it is put away, not at the pointer.
  const panel = page.getByRole('region', { name: 'Scans' })
  expect(await drop('notes.txt')).toMatchObject({ taken: true })
  await expect(panel.getByRole('alert')).toContainText('notes.txt is not a scan: torno reads .glb, .gltf, .obj, .ply and .stl scans')
  await page.mouse.move(400, 300)
  await page.mouse.move(420, 320)
  await expect(panel.getByRole('alert')).toContainText('notes.txt is not a scan')
  await drop('Plate.STL')
  await expect(panel.getByRole('alert')).toContainText('Plate.STL: That file has no place on the disk')
  await panel.getByRole('button', { name: 'Dismiss' }).click()
  await expect(panel.getByRole('alert')).toHaveCount(0)
  // A drag of something that is no file is none of the view's.
  const text = await page.evaluate(() => {
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', 'lid')
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })
    document.querySelector('.viewport-pane')!.dispatchEvent(over)
    return over.defaultPrevented
  })
  expect(text).toBe(false)
  expect((await state()).scans).toEqual([])
})

test('a scan with colours of its own is drawn in them, or plain, as its row says', async () => {
  // The plate again, each corner in a colour: an ASCII PLY, as a scanner's app writes one.
  const { vertices, triangles } = box([60, 50, 2], [0, 0, -10])
  const lines = ['ply', 'format ascii 1.0', 'element vertex 8', 'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue', 'element face 12', 'property list uchar int vertex_indices', 'end_header']
  for (let v = 0; v < 8; v++) lines.push(`${vertices.slice(3 * v, 3 * v + 3).join(' ')} ${v % 2 ? 200 : 40} ${v % 4 < 2 ? 180 : 60} ${v < 4 ? 160 : 30}`)
  for (let t = 0; t < 12; t++) lines.push(`3 ${triangles.slice(3 * t, 3 * t + 3).join(' ')}`)
  const coloured = join(root, 'plate.ply')
  writeFileSync(coloured, `${lines.join('\n')}\n`)

  await pickFile(coloured)
  await page.getByRole('button', { name: 'Import scan…' }).click()
  await expect(row('S2')).toContainText('plate.ply')
  await expect.poll(async () => (await scans())[0]).toMatchObject({ id: 'S2', loaded: true, triangles: 12 })
  expect((await state()).scans[0].imported.colours).toBe('vertex')
  // The guess was right: Keep says so, keeps the scan as it is, and no longer asks.
  const sheet = page.getByRole('dialog', { name: 'How is S2 read?' })
  await sheet.getByRole('button', { name: 'Keep' }).click()
  await expect(sheet).toHaveCount(0)
  await expect.poll(async () => (await state()).scans[0].imported.assumed).toEqual({ unit: false, up: false })
  await expect(row('S2').getByRole('img', { name: 'Read as assumed' })).toHaveCount(0)
  await expect((await detail('S2')).locator('.scan-guess')).toHaveCount(0)
  await expect(row('S2').getByRole('button', { name: 'Own colours' })).toHaveAttribute('title', 'Its own colours, toned down')
  await expect(row('S2').getByRole('button', { name: 'Own colours' })).toHaveAttribute('aria-pressed', 'true')
  const own = await picture({ view: 'bottom', size: 256, marks: false })
  await row('S2').getByRole('button', { name: 'Plain' }).click()
  await expect(row('S2').getByRole('button', { name: 'Plain' })).toHaveAttribute('aria-pressed', 'true')
  const plain = await picture({ view: 'bottom', size: 256, marks: false })
  expect(plain.sum).not.toBe(own.sum)
  await expect.poll(() => JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'scene.json'), 'utf8')).scans.S2).toEqual({ colour: 'plain' })
})

test('a scan whose mesh is gone says so, is not drawn, and has its source read again into the scan it is', async () => {
  rmSync(join(root, 'bracket', '.torno', 'scans', 'S2', 'mesh.bin'))
  await page.reload()
  await page.waitForSelector('[data-region="left"]')
  await open('bracket')
  await expect(row('S2').locator('.chip[data-state="mesh-missing"]')).toHaveText('missing')
  expect((await scans())[0]).toMatchObject({ id: 'S2', loaded: false })
  expect((await picture({ view: 'iso', size: 256 })).caption).not.toContain('scans')
  // Changed in fix round 1 (I2): beside what says the mesh is gone, and into the same scan: what it had stays.
  await place('S2', [0, 0, 1])
  await expect((await detail('S2')).locator('.scan-said')).toContainText('Its mesh is gone from the disk')
  await row('S2').locator('.scan-said').getByRole('button', { name: 'Import again' }).click()
  await expect.poll(async () => (await scans())[0], { timeout: 30_000 }).toMatchObject({ id: 'S2', loaded: true, aligned: true })
  await expect(row('S2').locator('.chip[data-state="placed"]')).toHaveText('placed')
  await expect(row('S3')).toHaveCount(0)
  expect((await picture({ view: 'iso', size: 256 })).caption).toContain(` · scans S2 (${PLACED}) · `)
})

// Task 4: pointing at a scan.

// Changed in Task 5 (the controller's ruling): what is seen through is pointed through. Only a scan drawn solid takes the pick.
test('a scan drawn solid in front of a part takes the pick, and one that is seen through does not; nor one the section takes away', async () => {
  // The plate 2.5 mm over the top of the post, which is at z = 22.5: from above, the post is behind it.
  await place('S2', [0, 0, 35])
  await expect.poll(async () => (await scans())[0]).toMatchObject({ id: 'S2', ready: true, how: 'worker', transform: { t: [0, 0, 35] } })
  const [fx, fy] = await page.evaluate(() => window.__tornoTest!.project([0, 0, 22.5]))
  const at = [fx, fy] as const
  const part = await page.evaluate(([fx, fy]) => window.__tornoTest!.pickAt(fx, fy, { partsOnly: true }), at)
  expect(part).toMatchObject({ part: 'post', kind: 'face' })
  const onScan = await page.evaluate(([fx, fy]) => window.__tornoTest!.pickScanAt(fx, fy), at)
  expect(onScan).toMatchObject({ scan: 'S2', normal: [0, 0, 1] })
  expect(onScan!.point[2]).toBeCloseTo(26, 6)
  expect(onScan!.local[2]).toBeCloseTo(-9, 6)
  expect(onScan!.distance).toBeLessThan(part!.distance)
  expect(await page.evaluate(([fx, fy]) => window.__tornoTest!.pickAt(fx, fy), at)).toBeNull()

  // Drawn solid, the scan hides the part: nothing is pointed at there, and nothing needs saying.
  const readout = page.locator('.pick-readout')
  const canvas = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
  const [x, y] = [canvas.x + fx * canvas.width, canvas.y + fy * canvas.height]
  await page.keyboard.press('v')
  await page.mouse.move(x + 3, y)
  await page.mouse.move(x, y)
  // Final fix wave (F15): nothing is picked there, and the pointer says why.
  await expect(readout).toHaveText('S2 hides the parts here: thin it on its row to point through it')
  // Drawn thin, the part shows through it, and is what is pointed at: the pointer names it, and a click selects it.
  // The slider takes room on the row only when it is pointed at.
  await row('S2').hover()
  await row('S2').getByRole('slider', { name: 'Opacity of S2' }).fill('0.4')
  await expect.poll(async () => (await scans())[0].opacity).toBe(0.4)
  expect(await page.evaluate(([fx, fy]) => window.__tornoTest!.pickAt(fx, fy), at)).toMatchObject({ part: 'post', kind: 'face' })
  // The scan itself can still be pointed at by what asks for scans.
  expect(await page.evaluate(([fx, fy]) => window.__tornoTest!.pickScanAt(fx, fy), at)).toMatchObject({ scan: 'S2' })
  await page.mouse.move(x + 3, y)
  await page.mouse.move(x, y)
  await expect(readout.locator('.pick-readout-ref')).toHaveText(/^post\/F/)
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(async () => (await state()).selection).toHaveLength(1)
  expect((await state()).selection[0]).toMatch(/^post\/F/)
  await page.keyboard.press('Escape')
  // Solid again for what follows.
  // The slider takes room on the row only when it is pointed at.
  await row('S2').hover()
  await row('S2').getByRole('slider', { name: 'Opacity of S2' }).fill('1')
  await expect.poll(async () => (await scans())[0].opacity).toBe(1)
  expect(await page.evaluate(([fx, fy]) => window.__tornoTest!.pickAt(fx, fy), at)).toBeNull()

  // A section that takes the plate away takes it out of the pointer's way: what it removes is not picked.
  const show = (request: object): Promise<void> => app.evaluate(({ BrowserWindow }, req) => BrowserWindow.getAllWindows()[0].webContents.send('view:show', { id: 987700, request: req }), request)
  await show({ objectId: 'bracket', section: { origin: [0, 0, 23.5], normal: [0, 0, 1] } })
  await expect.poll(async () => (await state()).section).toEqual({ origin: [0, 0, 23.5], normal: [0, 0, 1] })
  expect(await page.evaluate(([fx, fy]) => window.__tornoTest!.pickScanAt(fx, fy), at)).toBeNull()
  expect(await page.evaluate(([fx, fy]) => window.__tornoTest!.pickAt(fx, fy), at)).toMatchObject({ part: 'post' })
  await show({ objectId: 'bracket', section: null })
  await expect.poll(async () => (await state()).section).toBeNull()
  expect(await page.evaluate(([fx, fy]) => window.__tornoTest!.pickAt(fx, fy), at)).toBeNull()

  // Switched off, it is in nobody's way.
  await row('S2').getByRole('button', { name: 'Show S2' }).click()
  await expect.poll(async () => (await scans())[0].visible).toBe(false)
  expect(await page.evaluate(([fx, fy]) => window.__tornoTest!.pickScanAt(fx, fy), at)).toBeNull()
  expect(await page.evaluate(([fx, fy]) => window.__tornoTest!.pickAt(fx, fy), at)).toMatchObject({ part: 'post' })
  await page.mouse.move(x + 3, y)
  await page.mouse.move(x, y)
  await expect(readout.locator('.pick-readout-ref')).toHaveText(/^post\/F/)
})

// Milestone 5 (M11): "Frame" on a scan's row brings it into view with the parts, without turning the view.
test('"Frame" on its row brings a scan that stands far off into view, and does not turn the camera', async () => {
  await row('S2').getByRole('button', { name: 'Show S2' }).click()
  await expect.poll(async () => (await scans())[0].visible).toBe(true)
  // Stood a hundred metres off, it is further than the camera reaches for a scan (200 times the parts): its row says so.
  await place('S2', [100_000, 0, 35])
  await expect.poll(async () => (await scans())[0].clipped).toBe(true)
  await expect((await detail('S2')).locator('.scan-said[data-part="clipped"]')).toHaveText('Not all in view: Frame brings more of it in.')
  // The plate, 60 × 50 × 2 round (0, 0, -10) in its own frame, stood 400 mm along X: out of a view of the parts, and within reach.
  await place('S2', [400, 0, 35])
  await expect(row('S2').locator('.scan-said[data-part="clipped"]')).toHaveCount(0)
  await expect.poll(async () => (await scans())[0].transform.t).toEqual([400, 0, 35])
  await page.getByRole('button', { name: 'Iso', exact: true }).click()
  const corners: Array<[number, number, number]> = [[-30, -25, -11], [30, 25, -9], [30, -25, -11], [-30, 25, -9]]
  const drawn = () => page.evaluate((corners) => corners.map((local) => window.__tornoTest!.projectScan('S2', local)), corners)
  const inView = (points: Array<[number, number]>): boolean => points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)
  // Once the view has come to rest on the parts: the scan is not all in it.
  await expect.poll(async () => {
    const { position, target } = await page.evaluate(() => window.__tornoTest!.camera())
    return Math.hypot(...target) < 30 && position[0] > 0 && position[1] < 0
  }).toBe(true)
  await expect.poll(async () => inView(await drawn())).toBe(false)
  const before = await page.evaluate(() => window.__tornoTest!.camera())
  const towards = (camera: { position: number[]; target: number[] }): number[] => {
    const d = camera.target.map((t, i) => t - camera.position[i])
    const length = Math.hypot(...d)
    return d.map((c) => c / length)
  }
  await (await detail('S2')).getByRole('button', { name: 'Frame S2' }).click()
  await expect.poll(async () => inView(await drawn())).toBe(true)
  const after = await page.evaluate(() => window.__tornoTest!.camera())
  // Moved, not turned: it looks the same way, the same way up, through the same lens.
  expect(after.position).not.toEqual(before.position)
  for (const [i, c] of towards(after).entries()) expect(c).toBeCloseTo(towards(before)[i], 6)
  for (const [i, c] of after.up.entries()) expect(c).toBeCloseTo(before.up[i], 6)
  expect(after.ortho).toBe(before.ortho)
  // The parts are still in it.
  const [px, py] = await page.evaluate(() => window.__tornoTest!.project([0, 0, 0]))
  expect(inView([[px, py]])).toBe(true)
  // And the view is drawn as far as the scan reaches: its row has nothing to say of that.
  expect((await scans())[0].clipped).toBe(false)
  await expect(row('S2').locator('.scan-said[data-part="clipped"]')).toHaveCount(0)
})

// Issue #21.
test('a scan read with a guess is asked about once after its import, and Apply reads it as chosen', async () => {
  const again = join(root, 'plate again.stl')
  writeFileSync(again, PLATE)
  await pickFile(again)
  await page.getByRole('button', { name: 'Import scan…' }).click()
  const sheet = page.getByRole('dialog', { name: 'How is S3 read?' })
  await expect(sheet.locator('[data-part="size"]')).toHaveText('Its size would be 60 × 50 × 2 mm')
  await expect(row('S3').getByRole('img', { name: 'Read as assumed' })).toBeVisible()
  await sheet.getByRole('combobox', { name: 'Unit of S3' }).selectOption('cm')
  await expect(sheet.locator('[data-part="size"]')).toHaveText('Its size would be 600 × 500 × 20 mm')
  await sheet.getByRole('button', { name: 'Apply' }).click()
  await expect(sheet).toHaveCount(0)
  await expect.poll(async () => (await state()).scans.find((scan) => scan.id === 'S3')?.imported).toMatchObject({ unit: 'cm', assumed: { unit: false, up: false } })
  await expect(row('S3').getByRole('img', { name: 'Read as assumed' })).toHaveCount(0)
  // One detail open at a time.
  await detail('S2')
  await detail('S3')
  await expect(row('S2').locator('.scan-detail')).toHaveCount(0)
  await expect(row('S2').getByRole('button', { name: 'Details of S2' })).toHaveAttribute('aria-expanded', 'false')
})

test('a scan is renamed from its detail; an empty name is refused, and Escape leaves it as it was', async () => {
  const name = () => row('S3').locator('.scan-head .row-name')
  await (await detail('S3')).getByRole('button', { name: 'Rename S3' }).click()
  await row('S3').getByRole('textbox', { name: 'Name of S3' }).fill('hatch')
  await page.keyboard.press('Enter')
  await expect(name()).toHaveText('hatch')
  await expect.poll(async () => (await state()).scans.find((scan) => scan.id === 'S3')?.name).toBe('hatch')
  await row('S3').getByRole('button', { name: 'Rename S3' }).click()
  await row('S3').getByRole('textbox', { name: 'Name of S3' }).fill('')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Scans' }).getByRole('alert')).toContainText('a scan needs a name')
  await expect(name()).toHaveText('hatch')
  await row('S3').getByRole('button', { name: 'Rename S3' }).click()
  await row('S3').getByRole('textbox', { name: 'Name of S3' }).fill('other')
  await page.keyboard.press('Escape')
  await expect(name()).toHaveText('hatch')
  expect((await state()).scans.find((scan) => scan.id === 'S3')?.name).toBe('hatch')
})

test.describe('a large scan', () => {
  // A launch and a copy of its own: the one above is closed first, and the file's `afterAll` clears this one away.
  test.beforeAll(async () => {
    await app?.close()
    rmSync(root, { recursive: true, force: true })
    root = copyFixtures()
    app = await launch({ TORNO_WORKSPACE: root })
    page = await app.firstWindow()
    await page.waitForSelector('[data-region="left"]')
    await open('bracket')
  })

  test('200,000 triangles are drawn at once, and can be pointed at when their tree arrives from the worker', async () => {
    test.setTimeout(120_000)
    // A wavy sheet 316 mm square, 199,712 triangles: 10 MB of STL, written here and nowhere else.
    const wavy = join(root, 'wavy.stl')
    writeFileSync(wavy, stl(grid(317, 1, (x, y) => -20 + 3 * Math.sin(x / 20) * Math.cos(y / 20))))
    await pickFile(wavy)
    await page.getByRole('button', { name: 'Import scan…' }).click()
    await expect.poll(async () => (await scans())[0]?.loaded, { timeout: 60_000 }).toBe(true)
    // That the tree is made off the window's thread is said by `how` below: nothing here times the window meanwhile.
    await expect.poll(async () => (await scans())[0].ready, { timeout: 30_000 }).toBe(true)
    const cost = await page.evaluate(() => window.__tornoTest!.timeScanPicks(200))
    expect(cost.how).toEqual({ S1: 'worker' })
    expect(cost.hits).toBeGreaterThan(20)
    expect(cost.meanMs).toBeLessThan(2)
    // A point of the sheet, found again by pointing at where it is drawn.
    await page.evaluate(() => window.__tornoTest!.state())
    const [fx, fy] = await page.evaluate(() => window.__tornoTest!.projectScan('S1', [10.5, -20.5, -20 + 3 * Math.sin(10.5 / 20) * Math.cos(-20.5 / 20)]))
    const hit = await page.evaluate(([fx, fy]) => window.__tornoTest!.pickScanAt(fx, fy), [fx, fy])
    expect(hit).toMatchObject({ scan: 'S1' })
    expect(Math.hypot(hit!.local[0] - 10.5, hit!.local[1] + 20.5)).toBeLessThan(1.5)
    // The triangle told is the cell's own, by its number in the file: cell (i, j) of the sheet is triangles 2 (316 i + j) and the next.
    const cell = 2 * (316 * Math.floor(hit!.local[0] + 158) + Math.floor(hit!.local[1] + 158))
    expect([cell, cell + 1]).toContain(hit!.triangle)
  })
})
