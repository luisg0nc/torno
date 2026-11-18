import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { MarksFile, SketchMark } from '../src/shared/marks'
import { openListed } from './objects'
import { newSession } from './helpers'

// A 3D sketch drawn in the hidden window, on the `gauge` fixture: a 40 × 30 × 6 plate with one Ø8 hole at (10, 0). A line on
// the XZ plane begins on the hole's centre (snapped, so told as exact), a freehand stroke goes on the plane of the top face,
// the sketch is a flow of ⌀19, and Done keeps it. It is a row of the Marks list and a card of the board, and it goes to the
// agent, in words, with the next prompt. The window is hidden: the pointer is aimed through window.__tornoTest.project and
// moved with page.mouse, and what was made is read from marks.json, the store, the DOM and what the stand-in says back.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

type Vec3 = [number, number, number]

let root: string
let home: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-sketch-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-sketch-home-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const camera = () => page.evaluate(() => window.__tornoTest!.camera())
const canvas = () => page.locator('.viewport-canvas canvas').first()
const panel = () => page.getByRole('complementary', { name: 'Sketch' })
const pens = () => page.getByRole('group', { name: 'Pens of the sketch' })
const tool = (name: string) => page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const sketches = (): SketchMark[] => {
  try {
    const file = JSON.parse(readFileSync(join(root, 'gauge', '.torno', 'marks.json'), 'utf8')) as MarksFile
    return file.marks.filter((m): m is SketchMark => m.kind === 'sketch')
  } catch {
    return []
  }
}

/** Where a point of the object frame is drawn, in the page's pixels. */
async function pageXY(point: Vec3): Promise<[number, number]> {
  const [fx, fy] = await page.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await canvas().boundingBox())!
  return [box.x + fx * box.width, box.y + fy * box.height]
}

/** Press where the first point is drawn and draw through the others, one move each, then let go. */
async function drag(points: Vec3[]): Promise<void> {
  const at: [number, number][] = []
  for (const point of points) at.push(await pageXY(point))
  await page.mouse.move(...at[0])
  await page.mouse.down()
  for (const [x, y] of at.slice(1)) await page.mouse.move(x, y)
  await page.mouse.up()
}

/** Waits until the camera has stopped: a view asked for by key is gone to over a quarter of a second. */
async function atRest(): Promise<void> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await camera())
        const still = now === last
        last = now
        return still
      },
      { intervals: [120] }
    )
    .toBe(true)
}

test('D opens a sketch: the panel is the head of the card, the pens are over the view, and nothing is written yet', async () => {
  await openListed(page, 'gauge')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok' })
  await page.keyboard.press('1')
  await atRest()
  await page.keyboard.press('d')
  await expect(tool('Draw')).toHaveAttribute('aria-pressed', 'true')
  await expect(panel()).toBeVisible()
  await expect(pens()).toBeVisible()
  // The pens are real buttons with their keys; the freehand pen is in hand, snapping is on and the parts are solid.
  await expect(pens().getByRole('button')).toHaveCount(4)
  await expect(pens().getByRole('button', { name: /^Free/ })).toHaveAttribute('aria-pressed', 'true')
  // The sketch is the head of the route card, where the two switches are, and the selection is not shown beside it.
  await expect(page.locator('.route-hand').getByRole('complementary', { name: 'Sketch' })).toBeVisible()
  await expect(page.locator('.route-hand .hand')).toHaveAttribute('data-kind', 'sketch')
  await expect(page.locator('[data-region="viewport"] .sketchpanel')).toHaveCount(0)
  // The head caps at 60 % of the card and the sections stay reachable under it.
  const heights = await page.locator('.route-hand').evaluate((el) => ({ head: el.getBoundingClientRect().height, card: el.parentElement!.getBoundingClientRect().height, scroll: el.nextElementSibling!.getBoundingClientRect().height }))
  expect(heights.head).toBeLessThanOrEqual(heights.card * 0.6 + 1)
  expect(heights.scroll).toBeGreaterThan(heights.card * 0.3)
  await expect(panel().getByRole('switch', { name: /^Snap/ })).toHaveAttribute('aria-checked', 'true')
  await expect(panel().getByRole('switch', { name: /^X-ray/ })).toHaveAttribute('aria-checked', 'false')
  // The hint at the foot of the view holds the sketch's standing line: whether it snaps, and where x-ray is.
  await expect(page.locator('.view-hint[data-kind="sketch"]')).toContainText('Snapping on, hold Ctrl to drop it.')
  await panel().getByRole('switch', { name: /^X-ray/ }).click()
  await expect(panel().getByRole('switch', { name: /^X-ray/ })).toHaveAttribute('aria-checked', 'true')
  await panel().getByRole('switch', { name: /^X-ray/ }).click()
  await expect(panel().getByRole('switch', { name: /^X-ray/ })).toHaveAttribute('aria-checked', 'false')
  // The key and the button are one: each says what the other did.
  await page.keyboard.press('l')
  await expect(pens().getByRole('button', { name: /^Line/ })).toHaveAttribute('aria-pressed', 'true')
  await pens().getByRole('button', { name: /^Free/ }).click()
  await expect(pens().getByRole('button', { name: /^Free/ })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('l')
  // X shows or hides the view's cut and is not the Section tool's while sketching: with no cut it does nothing, and the sketch stays open.
  await page.keyboard.press('x')
  await expect(tool('Draw')).toHaveAttribute('aria-pressed', 'true')
  await expect(tool('Section')).toHaveAttribute('aria-pressed', 'false')
  await expect(panel()).toBeVisible()
  // Nothing is written until the first stroke.
  expect(sketches()).toHaveLength(0)
})

test('a line on XZ begins on the hole\'s centre: the point is snapped, and told as exact', async () => {
  // The plane XZ through the middle of the parts (y = 0), where the hole's centre is (10, 0, 6).
  await page.keyboard.press('Shift+2')
  await expect(panel()).toContainText('XZ at y = 0.0')
  // The plane's handle has a tag tied to it by a leader: its name, the place on the axis it is across, and the key that types it.
  const planeTag = page.locator('.viewport-pane [data-tag="sketch-plane"]')
  await expect(planeTag).toContainText('XZ plane')
  await expect(planeTag).toContainText('y')
  await expect(planeTag.locator('.sketch-plane-value')).toHaveText('0.0')
  await expect(planeTag).toContainText('Tab')
  await expect(page.locator('svg.leader-layer [data-leader="sketch-plane"]')).toHaveCount(1)
  const centre: Vec3 = [10, 0, 6]
  const hit = await page.evaluate((c) => {
    const [fx, fy] = window.__tornoTest!.project(c)
    return window.__tornoTest!.chipAt(fx, fy)
  }, centre)
  expect(hit, 'no chip over the hole').toBeNull()
  await drag([centre, [-10, 0, 14], [-14, 0, 14]])
  await expect.poll(() => sketches().length).toBe(1)
  const first = sketches()[0]
  expect(first).toMatchObject({ author: 'user', status: 'draft', take: 'rough' })
  expect(first.planes).toHaveLength(1)
  expect(first.strokes).toHaveLength(1)
  expect(first.strokes[0]).toMatchObject({ pen: 'line', plane: 1 })
  // The first point is the centre of the hole's circle, main's own check having borne it out.
  const snap = first.strokes[0].snaps?.find((s) => s.i === 0)
  expect(snap, 'the first point snapped').toBeDefined()
  expect(snap).toHaveProperty('centre')
  expect((snap as { radius: number }).radius).toBeCloseTo(4, 3)
  const [u, v] = first.strokes[0].points2d![0]
  expect(first.planes[0].origin[0] + u).toBeCloseTo(10, 2)
  expect(first.planes[0].origin[2] + v).toBeCloseTo(6, 2)
  // Counted in the panel: one stroke on the plane.
  await expect(panel().getByRole('button', { name: /^XZ at y = 0\.0/ })).toContainText('1')
})

test('N takes the plane of the face under the pointer, and a freehand stroke goes on it', async () => {
  await page.keyboard.press('b')
  await expect(pens().getByRole('button', { name: /^Free/ })).toHaveAttribute('aria-pressed', 'true')
  // The top of the plate, clear of the hole and of the panel over the left of the view.
  const [x, y] = await pageXY([16, -10, 6])
  const hit = await page.evaluate((at) => {
    const [fx, fy] = window.__tornoTest!.project(at)
    return window.__tornoTest!.pickAt(fx, fy, { edges: false })
  }, [16, -10, 6] as Vec3)
  expect(hit?.kind).toBe('face')
  await page.mouse.move(x, y)
  await page.keyboard.press('n')
  await expect(panel().getByRole('list', { name: 'Planes and strokes' })).toContainText('plane through plate/F', { timeout: 10_000 })
  await drag([[16, -10, 6], [18, -4, 6], [15.5, 3, 6], [17.5, 10, 6]])
  await expect.poll(() => sketches()[0].strokes.length).toBe(2)
  const stroke = sketches()[0].strokes[1]
  expect(stroke).toMatchObject({ pen: 'free', plane: 2 })
  expect(stroke.points2d!.length).toBeGreaterThan(2)
  // Freehand points snap to nothing: they are told as approximate.
  expect(stroke.snaps ?? []).toHaveLength(0)
})

test('flow with a diameter of 19 and Done: the sketch is kept, with its card of the board', async () => {
  await panel().getByRole('radio', { name: 'Flow' }).click()
  await panel().getByLabel('Diameter').fill('19')
  await panel().getByLabel('Diameter').press('Enter')
  await panel().getByLabel('Name').fill('Hose route')
  await expect.poll(() => sketches()[0].diameter).toBe(19)
  await expect.poll(() => sketches()[0].name).toBe('Hose route')
  expect(sketches()[0].take).toBe('flow')
  await panel().getByRole('button', { name: 'Done' }).click()
  await expect(panel()).toHaveCount(0)
  await expect(pens()).toHaveCount(0)
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  // The picture of its card is drawn from its camera and kept.
  await expect.poll(() => sketches()[0].picture, { timeout: 20_000 }).toMatch(/\.png$/)

  // The marks list has its row, in the words of the window.
  const id = sketches()[0].id
  const row = page.locator(`.mark-row[data-mark="${id}"]`)
  await expect(row).toBeVisible()
  await expect(row).toContainText('Hose route')
  await expect(row).toContainText('flow ⌀19 mm')
  await expect(row).toContainText('2 strokes')

  // The board has its card.
  await page.keyboard.press('Control+Tab')
  const card = page.locator('.pboard-card[data-kind="mark"]', { hasText: id })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Hose route')
  await page.keyboard.press('Control+Tab')
  await expect(page.locator('.pboard')).toHaveCount(0)
})

test('a click on the chip of a draft sketch opens it again for editing, not a note', async () => {
  await page.keyboard.press('v')
  const id = sketches()[0].id
  const chip = await page.evaluate((mark) => {
    const t = window.__tornoTest!
    const at = t.markScreen(mark)
    return at?.visible && t.chipAt(at.x, at.y) === mark ? at : null
  }, id)
  expect(chip, 'the chip of the sketch is in view').not.toBeNull()
  const box = (await canvas().boundingBox())!
  await page.mouse.click(box.x + chip!.x * box.width, box.y + chip!.y * box.height)
  await expect(panel()).toBeVisible()
  await expect(panel().getByLabel('Name')).toHaveValue('Hose route')
  await expect(page.locator('.note-card')).toHaveCount(0)
  await panel().getByRole('button', { name: 'Done' }).click()
  await expect(panel()).toHaveCount(0)
  await page.keyboard.press('v')
})

test('the next prompt carries the sketch in words: what is exact, the diameter and how to take it', async () => {
  await newSession(dock())
  await expect(chat()).toBeVisible()
  await expect(composer()).toBeEnabled()
  await composer().focus()
  await page.keyboard.type('say received')
  await page.keyboard.press('Enter')
  // What torno added to the prompt, the exact text the agent was given: the sketch in words, and no picture of it.
  const added = chat().locator('.chat-added').first()
  await expect(added).toContainText('torno added', { timeout: 30_000 })
  await expect(added.locator('.ref-chip[data-ref="M1"]')).toBeVisible()
  await added.getByRole('button', { name: 'Show text' }).click()
  const text = added.locator('.chat-added-text')
  await expect(text).toContainText('Sketch M1 "Hose route"')
  await expect(text).toContainText('exact: centre of')
  await expect(text).toContainText('⌀19')
  await expect(text).toContainText('Take it as a route: follow its path loosely, and keep its diameter clear.')
  await expect(text).toContainText('approximate')
  await expect(text).toContainText('This is text only: no picture goes with it.')
  // No picture went with the prompt.
  await expect(chat().locator('.chat-user').last().locator('.chat-thumb')).toHaveCount(0)
  // Sent: the sketch is no draft now.
  await expect.poll(() => sketches()[0].status).toBe('sent')
})
