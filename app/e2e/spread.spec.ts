import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { MarksFile, PinMark } from '../src/shared/marks'
import { clickHere, onBrief } from './helpers'
import { openListed } from './objects'

// Marks in a print layout whose parts the kernel sets side by side: a mark on
// a later part stays where it was put on that part when an earlier part
// grows and pushes it along.
//
// The model is the fixture `spread`: a tray whose width `width.txt` gives, and
// a lid, both posed at the origin. With the tray 30 mm wide the lid is moved
// 35 mm along X; with it 40 mm wide, 40 mm.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-spread-'))
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

type Vec3 = [number, number, number]
const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const marks = (): Promise<PinMark[]> => page.evaluate(() => window.torno.marks.list('spread')) as Promise<PinMark[]>
const marksOnDisk = (): MarksFile => JSON.parse(readFileSync(join(root, 'spread', '.torno', 'marks.json'), 'utf8'))
const row = (id: string) => page.locator(`.mark-row[data-mark="${id}"]`)
const canvas = () => page.locator('.viewport-canvas canvas').first()
const arranged = async (name: string) => (await state()).scene?.parts.find((p) => p.name === name)?.arranged

/** What is drawn where a point of the object is: the part and the face there, if any. */
const under = (point: Vec3) =>
  page.evaluate((at) => {
    const hooks = window.__tornoTest!
    const [fx, fy] = hooks.project(at)
    const hit = hooks.pickAt(fx, fy, { edges: false })
    return hit && { part: hit.part, ref: hit.ref, point: hit.point }
  }, point)

let placed: PinMark

test('a pin placed with the pointer on the lid records how far the lid was moved for display', async () => {
  await openListed(page, 'spread')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 1 })
  expect((await state()).scene?.layouts).toEqual(['print'])
  expect(await arranged('tray')).toBeUndefined()
  expect(await arranged('lid')).toEqual([35, 0, 0])

  // Off the middle of the lid's top, so that it tells one place on the lid from another.
  const at: Vec3 = [39, 3, 2]
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Pin', exact: true }).click()
  const [fx, fy] = await page.evaluate((point) => window.__tornoTest!.project(point), at)
  const box = (await canvas().boundingBox())!
  await page.mouse.move(box.x + fx * box.width, box.y + fy * box.height)
  await clickHere(page)
  await expect(page.locator('.note-card textarea')).toBeFocused()
  await page.keyboard.type('a vent here')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  await expect.poll(async () => (await marks())[0]?.checkedRevision).toBe(1)
  ;[placed] = await marks()
  expect(placed).toMatchObject({ id: 'M1', kind: 'pin', anchorState: 'ok', layout: 'print', anchor: { part: 'lid', arranged: [35, 0, 0] } })
  expect(placed.anchor.ref).toMatch(/^lid\/F\d+$/)
  expect(placed.anchor.point[0]).toBeCloseTo(39, 0)
  expect(placed.anchor.point[2]).toBeCloseTo(2, 6)
  expect(marksOnDisk().marks[0]).toEqual(placed)
})

test('when the tray grows by 10 mm the lid is set 5 mm further along, and the pin goes with it: the same face, ok, at the same place on the lid', async () => {
  writeFileSync(join(root, 'spread', 'width.txt'), '40\n')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 2, stale: false })
  expect(await arranged('lid')).toEqual([40, 0, 0])
  await expect.poll(async () => (await marks())[0].checkedRevision, { timeout: 15_000 }).toBe(2)

  const [moved] = await marks()
  const [x, y, z] = placed.anchor.point
  expect(moved.anchorState).toBe('ok')
  expect(moved.anchor.ref).toBe(placed.anchor.ref)
  expect(moved.anchor.part).toBe('lid')
  expect(moved.anchor.arranged).toEqual([40, 0, 0])
  expect(moved.anchor.point[0]).toBeCloseTo(x + 5, 9)
  expect(moved.anchor.point.slice(1)).toEqual([y, z])
  expect(moved.note).toBe('a vent here')
  expect(marksOnDisk().marks[0]).toEqual(moved)

  // On the lid, where it is drawn now; where the pin was is on the lid still, 5 mm from the pin.
  expect(await under(moved.anchor.point)).toMatchObject({ part: 'lid', ref: placed.anchor.ref })
  // Its row says nothing of having moved or of not being checked.
  await onBrief(page, async () => {
    await expect(row('M1').locator('.mark-anchor')).toHaveCount(0)
    await expect(row('M1').locator('.mark-note')).toHaveText('a vent here')
  })
  // The window draws it there: its label is on the canvas.
  expect(await page.evaluate(() => window.__tornoTest!.markScreen('M1'))).toMatchObject({ visible: true })
})

test('back at its first width, the pin is back where it was put', async () => {
  writeFileSync(join(root, 'spread', 'width.txt'), '30\n')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 3, stale: false })
  await expect.poll(async () => (await marks())[0].checkedRevision, { timeout: 15_000 }).toBe(3)
  const [back] = await marks()
  expect(back.anchorState).toBe('ok')
  expect(back.anchor.arranged).toEqual([35, 0, 0])
  expect(back.anchor.point[0]).toBeCloseTo(placed.anchor.point[0], 9)
})
