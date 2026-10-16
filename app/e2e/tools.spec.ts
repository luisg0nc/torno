import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { Hit } from '../src/renderer/viewport/picking'
import type { ArrowMark, MarksFile, PickMark, PinMark, ShapeMark, StrokeMark } from '../src/shared/marks'
import type { Camera, LookRequest } from '../src/shared/view'

// The tools that leave marks with the pointer: pin, arrow, a note on the
// selection, draw and shape; the note that opens beside a mark just made; and
// the gizmo and the fields a shape is changed with.
//
// The window is hidden. The pointer is aimed through window.__tornoTest.project
// and moved with page.mouse, which works on a hidden window; what was made is
// read from the object's marks.json and from .state.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')
const FAILED = 'The last build failed: picks wait for a build that works'

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

function copyFixtures(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-tools-'))
  cpSync(fixtures, dir, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  return dir
}

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
function launch(env: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, ...env } })
}

test.beforeAll(async () => {
  root = copyFixtures()
  app = await launch({ TORNO_WORKSPACE: root })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

type Vec3 = [number, number, number]
const state = (p: Page = page): Promise<TornoState> => p.evaluate(() => window.__tornoTest!.state())
const camera = (p: Page = page): Promise<Camera> => p.evaluate(() => window.__tornoTest!.camera())
const marksOnDisk = (): MarksFile => {
  try {
    return JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'marks.json'), 'utf8'))
  } catch {
    return { next: 1, marks: [] }
  }
}
const readout = (p: Page = page) => p.locator('.pick-readout')
const card = (p: Page = page) => p.locator('.note-card')
const field = (p: Page = page) => p.locator('.note-card textarea')
const tool = (name: string, p: Page = page) => p.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })
const canvas = (p: Page = page) => p.locator('.viewport-canvas canvas').first()
const length = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function pickOver(point: Vec3, p: Page = page): Promise<Hit | null> {
  return p.evaluate((at) => {
    const [fx, fy] = window.__tornoTest!.project(at)
    return window.__tornoTest!.pickAt(fx, fy)
  }, point)
}

/** Where a point of the object frame is drawn, in the page's pixels. */
async function pageXY(point: Vec3, p: Page = page): Promise<[number, number]> {
  const [fx, fy] = await p.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await canvas(p).boundingBox())!
  return [box.x + fx * box.width, box.y + fy * box.height]
}

async function clickOver(point: Vec3, opts: { shift?: boolean } = {}, p: Page = page): Promise<void> {
  const [x, y] = await pageXY(point, p)
  await p.mouse.move(x, y)
  if (opts.shift) await p.keyboard.down('Shift')
  await p.mouse.down()
  await p.mouse.up()
  if (opts.shift) await p.keyboard.up('Shift')
}

/** Press where one point is drawn, drag to where another is, and let go unless told to hold. */
async function dragOver(from: Vec3, to: Vec3, opts: { hold?: boolean } = {}, p: Page = page): Promise<void> {
  const [x0, y0] = await pageXY(from, p)
  const [x1, y1] = await pageXY(to, p)
  await p.mouse.move(x0, y0)
  await p.mouse.down()
  await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2)
  await p.mouse.move(x1, y1)
  if (!opts.hold) await p.mouse.up()
}

/** Press where the first point is drawn and draw through the others, one move each; let go unless told to hold. */
async function strokeOver(points: Vec3[], opts: { hold?: boolean } = {}, p: Page = page): Promise<void> {
  const at: [number, number][] = []
  for (const point of points) at.push(await pageXY(point, p))
  await p.mouse.move(...at[0])
  await p.mouse.down()
  for (const [x, y] of at.slice(1)) await p.mouse.move(x, y)
  if (!opts.hold) await p.mouse.up()
}

/** Waits until the camera has stopped: a view asked for by key is gone to over a quarter of a second. */
async function atRest(p: Page = page): Promise<void> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await camera(p))
        const still = now === last
        last = now
        return still
      },
      { intervals: [120] }
    )
    .toBe(true)
}

const lockOf = (view: string, p: Page = page) => p.locator(`.viewbar [data-view="${view}"]`)
const shapeOnDisk = (id: string): ShapeMark => marksOnDisk().marks.find((m) => m.id === id) as ShapeMark
const numberField = (name: string, p: Page = page) => p.locator('.shape-fields').getByRole('textbox', { name, exact: true })
const fieldsButton = (name: string, p: Page = page) => p.locator('.shape-fields').getByRole('button', { name, exact: true })

/** Type a number into one of a shape's fields and press Enter. */
async function typeNumber(name: string, value: string, p: Page = page): Promise<void> {
  await numberField(name, p).fill(value)
  await numberField(name, p).press('Enter')
}

/**
 * Two pictures of the same view, compared near a point of the object: how many
 * pixels differ within `reach` (a share of the width) of where it is drawn.
 */
function differingNear(a: LookRequest, b: LookRequest, point: Vec3, reach = 0.03, p: Page = page): Promise<number> {
  return p.evaluate(
    async ([first, second, at, r]) => {
      const pixels = async (req: LookRequest) => {
        const picture = await window.__tornoTest!.look(req)
        const bitmap = await createImageBitmap(new Blob([picture.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const [fx, fy] = window.__tornoTest!.project(at)
      const [one, two] = [await pixels(first), await pixels(second)]
      let near = 0
      for (let y = 0; y < one.height; y++) {
        for (let x = 0; x < one.width; x++) {
          if (Math.abs(x - fx * one.width) > r * one.width || Math.abs(y - fy * one.height) > r * one.width) continue
          const i = (y * one.width + x) * 4
          if (Math.abs(one.data[i] - two.data[i]) + Math.abs(one.data[i + 1] - two.data[i + 1]) + Math.abs(one.data[i + 2] - two.data[i + 2]) >= 24) near += 1
        }
      }
      return near
    },
    [a, b, point, reach] as const
  )
}

/**
 * How many pixels of a picture of the current view are one of the gizmo's three axis colours. The triad in the
 * picture's bottom left corner is drawn in the same three, and is left out: it is no gizmo.
 */
function gizmoPixels(p: Page = page): Promise<number> {
  return p.evaluate(async () => {
    const css = getComputedStyle(document.documentElement)
    const axes = ['--axis-x', '--axis-y', '--axis-z'].map((name) => {
      const hex = css.getPropertyValue(name).trim()
      return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
    })
    const picture = await window.__tornoTest!.look({ view: 'current' })
    const bitmap = await createImageBitmap(new Blob([picture.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    let found = 0
    const corner = 150 * Math.max(Math.max(bitmap.width, bitmap.height) / 1280, 0.5)
    for (let i = 0; i < data.length; i += 4) {
      const [x, y] = [(i / 4) % bitmap.width, Math.floor(i / 4 / bitmap.width)]
      if (x < corner && y > bitmap.height - corner) continue
      if (axes.some(([r, g, b]) => Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) <= 6)) found += 1
    }
    return found
  })
}

/** A picture of the current view, as the agent gets it. */
const pictureNow = (p: Page = page): Promise<number[]> => p.evaluate(() => window.__tornoTest!.look({ view: 'current' }).then((picture) => Array.from(picture.png)))

/** How many pixels of two pictures of one size differ at all; -1 when they are not of one size. */
function differing(a: number[], b: number[], p: Page = page): Promise<number> {
  return p.evaluate(
    async ([first, second]) => {
      const pixels = async (png: number[]) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const [one, two] = [await pixels(first), await pixels(second)]
      if (one.width !== two.width || one.height !== two.height) return -1
      let count = 0
      for (let i = 0; i < one.data.length; i += 4) if (one.data[i] !== two.data[i] || one.data[i + 1] !== two.data[i + 1] || one.data[i + 2] !== two.data[i + 2]) count += 1
      return count
    },
    [a, b] as const
  )
}

/**
 * Bring the pointer onto the handle of the gizmo that runs along an axis of
 * the object frame from a point: out from where the point is drawn, a few
 * pixels at a time, until the canvas says the pointer is on that handle.
 * Returns where that is, in the page's pixels.
 */
async function ontoHandle(from: Vec3, axis: 'X' | 'Y' | 'Z', p: Page = page): Promise<[number, number]> {
  const out: Vec3 = [from[0] + (axis === 'X' ? 10 : 0), from[1] + (axis === 'Y' ? 10 : 0), from[2] + (axis === 'Z' ? 10 : 0)]
  const [x0, y0] = await pageXY(from, p)
  const [x1, y1] = await pageXY(out, p)
  const length = Math.hypot(x1 - x0, y1 - y0)
  for (let px = 30; px <= 130; px += 8) {
    const at: [number, number] = [x0 + ((x1 - x0) / length) * px, y0 + ((y1 - y0) / length) * px]
    await p.mouse.move(...at)
    if ((await canvas(p).getAttribute('data-gizmo-axis')) === axis) return at
  }
  throw new Error(`no ${axis} handle found along the axis from the shape`)
}

/** Counts the times main tells of the marks from now on; returns what reads the count. */
async function countChanges(p: Page = page): Promise<() => Promise<number>> {
  await p.evaluate(() => {
    const w = window as unknown as { __changes: number; __offChanges?: () => void }
    w.__offChanges?.()
    w.__changes = 0
    w.__offChanges = window.torno.marks.onChanged(() => (w.__changes += 1))
  })
  return () => p.evaluate(() => (window as unknown as { __changes: number }).__changes)
}

/** Open the bracket and look at it from above. Its base is 40 × 30 × 5 about the origin; its post stands on the middle, to z = 22.5. */
async function openFromAbove(p: Page = page): Promise<void> {
  await p.getByRole('button', { name: 'bracket', exact: true }).click()
  await expect.poll(async () => (await state(p)).build?.status, { timeout: 30_000 }).toBe('ok')
  await fromAbove(p)
}

async function fromAbove(p: Page = page): Promise<void> {
  await p.getByRole('button', { name: 'Top', exact: true }).click()
  await expect
    .poll(async () => {
      const c = await camera(p)
      return Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1]) < 0.01 * Math.abs(c.position[2] - c.target[2])
    })
    .toBe(true)
}

/** The box of the note and, in the same pixels, where a point of the object is drawn. */
async function noteAndPoint(point: Vec3): Promise<{ box: { x: number; y: number; width: number; height: number }; at: [number, number] }> {
  return { box: (await card().boundingBox())!, at: await pageXY(point) }
}

const inside = (box: { x: number; y: number; width: number; height: number }, [x, y]: [number, number], pad = 0): boolean =>
  x >= box.x - pad && x <= box.x + box.width + pad && y >= box.y - pad && y <= box.y + box.height + pad

const ON_BASE: Vec3 = [14, 9, 2.5] // on the top of the base, clear of the post
const ON_POST: Vec3 = [0, 0, 22.5] // the middle of the top of the post
const model = () => join(root, 'bracket', 'bracket.py')

test('the palette is in three groups, split by a rule: the tools that inspect, those that mark, and the scan’s; the keys still take each tool', async () => {
  await openFromAbove()
  const tools = page.getByRole('toolbar', { name: 'Tools' })
  const inGroup = (name: string) => tools.getByRole('group', { name, exact: true }).locator('[data-tool]').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('data-tool')))
  await expect.poll(() => inGroup('Inspect')).toEqual(['select', 'measure', 'section'])
  await expect.poll(() => inGroup('Mark')).toEqual(['pin', 'arrow', 'draw', 'shape', 'region'])
  await expect.poll(() => inGroup('Scan')).toEqual(['align'])
  // Two rules between the groups, and the one above the keys.
  await expect(tools.locator('.toolbox-rule')).toHaveCount(3)
  for (const [key, name] of [['m', 'Measure'], ['p', 'Pin'], ['l', 'Align scan'], ['v', 'Select']] as const) {
    await page.keyboard.press(key)
    await expect(tool(name)).toHaveAttribute('aria-pressed', 'true')
  }
})

test('P takes the pin tool; a click on the part leaves a pin and opens its note beside it', async () => {
  await openFromAbove()
  await expect(tool('Pin')).toBeEnabled()
  await expect(tool('Arrow')).toBeEnabled()
  await page.keyboard.press('p')
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas()).toHaveCSS('cursor', 'crosshair')

  // Beside the parts: nothing.
  const box = (await canvas().boundingBox())!
  await page.mouse.move(box.x + box.width - 12, box.y + box.height - 60)
  await page.mouse.down()
  await page.mouse.up()

  const hit = (await pickOver(ON_BASE))!
  await clickOver(ON_BASE)
  await expect(card()).toBeVisible()
  await expect(card().locator('.mark-chip')).toHaveText('M1')
  await expect(card().locator('.note-ref')).toHaveText(hit.ref)
  await expect(card().locator('.note-detail')).toHaveText('plane, normal +Z, z = 2.5, 1200 mm²')
  await expect(field()).toBeFocused()
  await expect(field()).toHaveAttribute('placeholder', 'What should change here?')
  await expect(field()).toHaveAttribute('maxlength', '2000')
  expect(marksOnDisk().marks).toHaveLength(1)
  expect((await state()).activeMark).toBe('M1')

  // The note is beside the pin, not on it, and inside the viewport.
  const { box: note, at } = await noteAndPoint(ON_BASE)
  expect(inside(note, at, 6)).toBe(false)
  expect(note.x).toBeGreaterThanOrEqual(box.x)
  expect(note.x + note.width).toBeLessThanOrEqual(box.x + box.width)

  // Typing in it is typing: the keys of the tools and the views do nothing.
  const before = await camera()
  await page.keyboard.type('add a rib here, 1 mm thick, V-shaped')
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  expect(await camera()).toEqual(before)
  await page.keyboard.press('Enter')
  await expect(card()).toHaveCount(0)

  await expect.poll(() => marksOnDisk().marks[0]?.note).toBe('add a rib here, 1 mm thick, V-shaped')
  const s = await state()
  const pin = marksOnDisk().marks[0] as PinMark
  expect(pin).toMatchObject({ id: 'M1', kind: 'pin', author: 'user', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: s.revision })
  expect(pin.anchor).toMatchObject({ part: 'base', ref: hit.ref, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' })
  expect(pin.anchor.ref).toMatch(/^base\/F\d+$/)
  for (const [i, c] of ON_BASE.entries()) expect(pin.anchor.point[i]).toBeCloseTo(c, 1)
  for (const [i, c] of [0, 0, 1].entries()) expect(pin.anchor.normal![i]).toBeCloseTo(c, 5)
  for (const [i, c] of before.position.entries()) expect(pin.camera.position[i]).toBeCloseTo(c, 3)
  await expect(page.locator('.mark-row[data-mark="M1"] .mark-note')).toHaveText('add a rib here, 1 mm thick, V-shaped')
})

test('the tool stays in hand: the next click is the next pin; Escape leaves its note empty', async () => {
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  await clickOver([-14, -9, 2.5])
  await expect(card().locator('.mark-chip')).toHaveText('M2')
  await expect(field()).toBeFocused()
  await page.keyboard.type('not kept')
  await page.keyboard.press('Escape')
  await expect(card()).toHaveCount(0)
  // The mark is kept, with the note it had; the tool is still the pin.
  expect(marksOnDisk().marks.map((m) => [m.id, m.note])).toEqual([['M1', 'add a rib here, 1 mm thick, V-shaped'], ['M2', '']])
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  expect((await state()).activeMark).toBe('M2')
})

test('the note follows its mark when the camera moves, and a press elsewhere keeps what was written', async () => {
  await clickOver(ON_POST)
  await expect(card().locator('.mark-chip')).toHaveText('M3')
  await expect(field()).toBeFocused()
  const first = (await card().boundingBox())!
  await page.keyboard.type('shorter')
  // Shift+Enter is a new line, not the end.
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('by 2 mm')
  await expect(field()).toHaveValue('shorter\nby 2 mm')

  // Zoom in about a corner of the base: the post, and its note, move on screen.
  const before = await camera()
  const [x, y] = await pageXY([-18, -13, 2.5])
  await page.mouse.move(x, y)
  await page.mouse.wheel(0, -300)
  await expect.poll(async () => (await camera()).position).not.toEqual(before.position)
  await expect
    .poll(async () => {
      const now = (await card().boundingBox())!
      return Math.hypot(now.x - first.x, now.y - first.y)
    })
    .toBeGreaterThan(5)
  const { box, at } = await noteAndPoint(ON_POST)
  expect(inside(box, at, 6)).toBe(false)
  await expect(field()).toHaveValue('shorter\nby 2 mm')
  // The view bar is pressed, which is not the note: the note is saved and closed.
  await fromAbove()
  await expect(card()).toHaveCount(0)
  await expect.poll(() => marksOnDisk().marks[2]?.note).toBe('shorter\nby 2 mm')
})

test('the delete button of the note takes the mark away', async () => {
  await clickOver([14, -9, 2.5])
  await expect(card().locator('.mark-chip')).toHaveText('M4')
  await card().getByRole('button', { name: 'Delete mark M4' }).click()
  await expect(card()).toHaveCount(0)
  await expect.poll(() => marksOnDisk().marks.map((m) => m.id)).toEqual(['M1', 'M2', 'M3'])
  await expect(page.locator('.mark-row')).toHaveCount(3)
})

test('A takes the arrow tool; a drag from the part leaves an arrow of the length dragged', async () => {
  await page.keyboard.press('a')
  await expect(tool('Arrow')).toHaveAttribute('aria-pressed', 'true')
  const from: Vec3 = [14, 9, 2.5]
  const to: Vec3 = [-12, -4, 2.5] // seen from above, the plane that faces the camera is the top of the base
  const hit = (await pickOver(from))!
  const view = await camera()
  await dragOver(from, to, { hold: true })
  // While it is dragged: its length and its vector, and the camera stays put.
  const wanted = length(from, to)
  await expect(readout()).toBeVisible()
  const said = (await readout().locator('.pick-readout-ref').textContent())!
  expect(said).toMatch(/^\d+\.\d mm$/)
  expect(Math.abs(Number.parseFloat(said) - wanted) / wanted).toBeLessThan(0.05)
  await expect(readout().locator('.pick-readout-detail')).toHaveText(/^-2\d\.\d, -1\d\.\d, -?0\.\d$/)
  expect(marksOnDisk().marks).toHaveLength(3)
  await page.mouse.up()

  await expect(card().locator('.mark-chip')).toHaveText('M5')
  await expect(readout()).toBeHidden()
  expect(await camera()).toEqual(view)
  const arrow = marksOnDisk().marks.find((m) => m.id === 'M5') as ArrowMark
  expect(arrow).toMatchObject({ kind: 'arrow', author: 'user', layout: 'assembly', from: { part: 'base', ref: hit.ref, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' } })
  for (const [i, c] of from.entries()) expect(arrow.from.point[i]).toBeCloseTo(c, 1)
  expect(Math.abs(length(arrow.from.point, arrow.to) - wanted) / wanted).toBeLessThan(0.05)
  expect(length(arrow.to, to)).toBeLessThan(0.05 * wanted)
  // Its note says how long it is, and Enter with nothing written leaves it at that.
  await expect(card().locator('.note-ref')).toHaveText(`${length(arrow.from.point, arrow.to).toFixed(1)} mm`)
  await expect(field()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(card()).toHaveCount(0)
})

test('with Shift the arrow runs along an axis; a drag of a pixel or two is no arrow', async () => {
  const from: Vec3 = [14, -9, 2.5]
  await page.keyboard.down('Shift')
  await dragOver(from, [-10, -7, 2.5]) // 5° off -X
  await page.keyboard.up('Shift')
  await expect(card().locator('.mark-chip')).toHaveText('M6')
  const arrow = marksOnDisk().marks.find((m) => m.id === 'M6') as ArrowMark
  expect(arrow.to[1]).toBeCloseTo(arrow.from.point[1], 6)
  expect(arrow.to[2]).toBeCloseTo(arrow.from.point[2], 6)
  expect(arrow.to[0]).toBeLessThan(-8)
  await page.keyboard.press('Escape') // the note
  await expect(card()).toHaveCount(0)

  const [x, y] = await pageXY([-14, 9, 2.5])
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 2, y + 1)
  await page.mouse.up()
  await page.mouse.move(x + 30, y)
  await expect(readout()).toBeVisible() // the tool has gone on: it names what is under the pointer again
  expect(marksOnDisk().marks.map((m) => m.id)).toEqual(['M1', 'M2', 'M3', 'M5', 'M6'])
  await expect(card()).toHaveCount(0)
})

test('Escape drops an arrow that is being dragged, then puts the tool down for Select; so does V', async () => {
  await dragOver([14, 9, 2.5], [-12, 9, 2.5], { hold: true })
  await expect(readout()).toBeVisible()
  const view = await camera()
  await page.keyboard.press('Escape')
  await expect(readout()).toBeHidden()
  await expect(tool('Arrow')).toHaveAttribute('aria-pressed', 'true')
  // The rest of the drag is nobody's: it draws nothing and does not turn the camera.
  const [x, y] = await pageXY([-12, -9, 2.5])
  await page.mouse.move(x, y)
  await page.mouse.up()
  expect(await camera()).toEqual(view)
  await expect(readout()).toBeHidden()
  expect(marksOnDisk().marks).toHaveLength(5)

  await page.keyboard.press('Escape')
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas()).toHaveCSS('cursor', 'default')
  await page.keyboard.press('p')
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('v')
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  expect((await state()).selection).toEqual([])
})

test('Note on the selection leaves a pick on each ref, where it was clicked, and opens the first', async () => {
  const face = (await pickOver(ON_BASE))!
  const edgeAt: Vec3 = [19.7, 9, 2.5] // within reach of the long edge of the base at x = 20
  const edge = (await pickOver(edgeAt))!
  expect(edge.kind).toBe('edge')
  await clickOver(ON_BASE)
  await clickOver(edgeAt, { shift: true })
  await expect.poll(async () => (await state()).selection).toEqual([face.ref, edge.ref])
  const note = page.getByRole('group', { name: 'Selection' }).getByRole('button', { name: 'Note', exact: true })
  await expect(note).toBeEnabled()
  await note.click()

  await expect(card().locator('.mark-chip')).toHaveText('M7')
  await expect(field()).toBeFocused()
  await expect.poll(async () => (await state()).selection).toEqual([])
  const [onFace, onEdge] = marksOnDisk().marks.slice(-2) as PickMark[]
  expect(onFace).toMatchObject({ id: 'M7', kind: 'pick', target: 'face', author: 'user', anchor: { part: 'base', ref: face.ref, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' } })
  expect(onEdge).toMatchObject({ id: 'M8', kind: 'pick', target: 'edge', author: 'user', anchor: { part: 'base', ref: edge.ref, descriptor: 'line, 30 mm' } })
  for (const [i, c] of ON_BASE.entries()) expect(onFace.anchor.point[i]).toBeCloseTo(c, 1)
  expect(onEdge.anchor.point[0]).toBeCloseTo(20, 1)
  expect(onEdge.anchor.point[1]).toBeCloseTo(9, 0)
  expect(onEdge.anchor.normal).toBeUndefined()
  await page.keyboard.type('these two')
  await page.keyboard.press('Enter')
  await expect.poll(() => marksOnDisk().marks.find((m) => m.id === 'M7')?.note).toBe('these two')
})

test('the note closes when another layout is shown', async () => {
  await page.keyboard.press('p')
  await clickOver([-14, 9, 2.5])
  await expect(card().locator('.mark-chip')).toHaveText('M9')
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await page.keyboard.press('Escape') // nothing is being typed: the tool is put down, the note stays
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  await expect(card()).toBeVisible()
  await page.getByRole('button', { name: 'print', exact: true }).click()
  await expect.poll(async () => (await state()).layout).toBe('print')
  await expect(card()).toHaveCount(0)
  await page.getByRole('button', { name: 'assembly', exact: true }).click()
  await expect.poll(async () => (await state()).layout).toBe('assembly')
  await expect(card()).toHaveCount(0)
})

test('on a stale build the tools leave nothing, and the pointer is told why', async () => {
  const before = marksOnDisk().marks.length
  const source = readFileSync(model(), 'utf8')
  appendFileSync(model(), '\nthis is not python(\n')
  await expect.poll(async () => (await state()).build, { timeout: 20_000 }).toMatchObject({ status: 'failed', stale: true })

  await page.keyboard.press('p')
  await clickOver(ON_BASE)
  await expect(readout()).toHaveText(FAILED)
  await page.keyboard.press('a')
  await dragOver(ON_BASE, [-12, 9, 2.5])
  await expect(readout()).toHaveText(FAILED)
  // The drag was not taken by the tool: nothing is drawn, nothing is kept.
  await expect(card()).toHaveCount(0)
  expect(marksOnDisk().marks).toHaveLength(before)

  writeFileSync(model(), source)
  await expect.poll(async () => (await state()).build, { timeout: 20_000 }).toMatchObject({ status: 'ok', stale: false })
  await page.keyboard.press('v')
})

test('an orthographic standard view is locked, and says so on its button; turning it or perspective unlocks it', async () => {
  await fromAbove() // the drag on the stale build turned the camera
  await page.waitForTimeout(250) // the camera comes to rest, and says where
  expect((await state()).lockedView).toBeNull() // from above, but in perspective
  await expect(lockOf('top')).not.toHaveAttribute('data-locked')
  await page.getByRole('button', { name: 'Ortho', exact: true }).click()
  await expect.poll(async () => (await state()).lockedView).toBe('top')
  await expect(lockOf('top')).toHaveAttribute('data-locked', '')
  await expect(lockOf('top').locator('svg')).toBeVisible()

  await page.keyboard.press('2')
  await expect.poll(async () => (await state()).lockedView).toBe('front')
  await expect(lockOf('front')).toHaveAttribute('data-locked', '')
  await expect(lockOf('front')).toHaveAttribute('title', 'Front view (2). Locked to this view: strokes are flat profiles. Turning the view unlocks it')
  await expect(lockOf('top')).not.toHaveAttribute('data-locked')

  // Zooming keeps it.
  const before = await camera()
  const box = (await canvas().boundingBox())!
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4)
  await page.mouse.wheel(0, -200)
  await expect.poll(async () => (await camera()).zoom).toBeGreaterThan(before.zoom)
  await page.waitForTimeout(250) // the camera comes to rest, and says where
  expect((await state()).lockedView).toBe('front')

  // A drag beside the part turns the camera: no lock.
  await page.mouse.move(box.x + box.width - 30, box.y + box.height - 80)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 80)
  await page.mouse.up()
  await expect.poll(async () => (await state()).lockedView).toBeNull()
  await expect(lockOf('front')).not.toHaveAttribute('data-locked')

  // One of the views behind the chevron: the lock is on the chevron's button, and in the menu.
  const more = page.getByRole('button', { name: /^More views/ })
  await more.click()
  await page.getByRole('menuitem', { name: 'Back' }).click()
  await expect.poll(async () => (await state()).lockedView).toBe('back')
  await expect(more).toHaveAttribute('data-locked', '')
  await expect(more).toHaveAccessibleName('More views: locked on back')
})

test('D takes the draw tool; on the locked front view a stroke beside the part is a profile on XZ, in millimetres', async () => {
  await expect(tool('Draw')).toBeEnabled()
  await page.keyboard.press('2')
  await atRest()
  await expect.poll(async () => (await state()).lockedView).toBe('front')
  await page.keyboard.press('d')
  await expect(tool('Draw')).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas()).toHaveCSS('cursor', 'crosshair')

  // Beside the post and above the base: three segments, 10 mm wide and 14 mm high, on the plane y = 0.
  const path: Vec3[] = [[8, 0, 6], [18, 0, 10], [8, 0, 16], [18, 0, 20]]
  for (const point of path) expect(await pickOver(point)).toBeNull()
  const view = await camera()
  const before = marksOnDisk().marks.length
  await strokeOver(path, { hold: true })
  // While it is drawn: the plane, and how large the drawing is on it; nothing is kept yet, and the camera stays put.
  await expect(readout().locator('.pick-readout-ref')).toHaveText('XZ at y = 0.0 (u = +X, v = +Z)')
  await expect(readout().locator('.pick-readout-detail')).toHaveText(/^\d+\.\d × \d+\.\d mm$/)
  expect(marksOnDisk().marks).toHaveLength(before)
  await page.mouse.up()

  await expect(card()).toBeVisible()
  await expect(field()).toBeFocused()
  await expect(readout()).toBeHidden()
  expect(await camera()).toEqual(view)
  const stroke = marksOnDisk().marks.at(-1) as StrokeMark
  expect(marksOnDisk().marks).toHaveLength(before + 1)
  expect(stroke).toMatchObject({ kind: 'stroke', space: 'plane', author: 'user', status: 'draft', layout: 'assembly', plane: { x: [1, 0, 0], y: [0, 0, 1] } })
  // The label says which way the plane's axes run: the same plane drawn on from the back would say u = -X.
  expect(stroke.plane!.label).toMatch(/^XZ at y = -?\d+\.\d \(u = \+X, v = \+Z\)$/)
  expect(stroke.plane!.label).toBe('XZ at y = 0.0 (u = +X, v = +Z)')
  expect(stroke.points).toBeUndefined()
  expect(stroke.anchor.part).toBeUndefined()
  // Millimetres on the plane, from its origin: the extents are those of the drag.
  const us = stroke.points2d!.map((p) => p[0])
  const vs = stroke.points2d!.map((p) => p[1])
  expect(stroke.points2d).toHaveLength(4)
  expect(Math.abs(Math.max(...us) - Math.min(...us) - 10) / 10).toBeLessThan(0.05)
  expect(Math.abs(Math.max(...vs) - Math.min(...vs) - 14) / 14).toBeLessThan(0.05)
  // And they are where they were drawn: origin + u·x + v·y.
  for (const [i, [u, v]] of stroke.points2d!.entries()) {
    expect(stroke.plane!.origin[0] + u).toBeCloseTo(path[i][0], 0)
    expect(stroke.plane!.origin[2] + v).toBeCloseTo(path[i][2], 0)
  }
  expect(stroke.plane!.origin[1]).toBeCloseTo(0, 6)
  for (const [i, c] of path[0].entries()) expect(stroke.anchor.point[i]).toBeCloseTo(c, 0)

  // The note is at the stroke's first point, and says which plane and how large.
  await expect(card().locator('.note-ref')).toHaveText('XZ at y = 0.0 (u = +X, v = +Z)')
  await expect(card().locator('.note-detail')).toHaveText(/^\d+\.\d × \d+\.\d mm$/)
  const { box: note, at } = await noteAndPoint(path[0])
  expect(inside(note, at, 6)).toBe(false)
  expect(inside(note, at, 140)).toBe(true)
  await page.keyboard.type('this profile, 3 mm thick')
  await page.keyboard.press('Enter')
  await expect.poll(() => marksOnDisk().marks.at(-1)?.note).toBe('this profile, 3 mm thick')
  await expect(page.locator(`.mark-row[data-mark="${stroke.id}"] .mark-kind`)).toHaveAttribute('aria-label', 'Stroke')
})

test('while a stroke is drawn the wheel still zooms, the view stays locked, and Escape drops the stroke', async () => {
  const before = marksOnDisk().marks.length
  const view = await camera()
  await strokeOver([[8, 0, 6], [14, 0, 12]], { hold: true })
  await expect(readout()).toBeVisible()
  await page.mouse.wheel(0, -200)
  await expect.poll(async () => (await camera()).zoom).toBeGreaterThan(view.zoom)
  // Zoomed, not turned.
  // (Read back from the camera's turn, to a float's noise.)
  const up = await page.evaluate(() => window.__tornoTest!.camera().up)
  for (let i = 0; i < 3; i++) expect(up[i]).toBeCloseTo(view.up[i], 12)
  await page.keyboard.press('Escape')
  await expect(readout()).toBeHidden()
  await expect(tool('Draw')).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.up()
  await expect(card()).toHaveCount(0)
  expect(marksOnDisk().marks).toHaveLength(before)
  await expect.poll(async () => (await state()).lockedView).toBe('front')
})

test('on a locked view with Draw in hand the pointer is told which plane a stroke would be on; Alt-drag turns the view', async () => {
  await page.keyboard.press('2')
  await atRest()
  await expect.poll(async () => (await state()).lockedView).toBe('front')
  const before = marksOnDisk().marks.length
  const [x, y] = await pageXY([12, 0, 12])
  await page.mouse.move(x, y)
  await expect(readout()).toHaveText('Draws on XZ at y = 0.0. Alt-drag or Iso (1) to turn the view')

  // With Alt the press is the camera's: no stroke, and the view is turned, so no longer locked.
  const view = await camera()
  await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.mouse.move(x + 30, y)
  await page.mouse.move(x + 60, y + 10)
  await page.mouse.up()
  await page.keyboard.up('Alt')
  expect((await camera()).position).not.toEqual(view.position)
  await expect.poll(async () => (await state()).lockedView).toBeNull()
  await expect(lockOf('front')).not.toHaveAttribute('data-locked')
  await expect(card()).toHaveCount(0)
  expect(marksOnDisk().marks).toHaveLength(before)
  await expect(tool('Draw')).toHaveAttribute('aria-pressed', 'true')
})

test('on a free view a stroke across the top of the base lies on the surface', async () => {
  await page.keyboard.press('1') // iso: not a view to lock on
  await atRest()
  await expect.poll(async () => (await state()).lockedView).toBeNull()
  await expect(tool('Draw')).toHaveAttribute('aria-pressed', 'true')
  const before = marksOnDisk().marks.length
  const path: Vec3[] = [[15, 11, 2.5], [10, 0, 2.5], [16, -6, 2.5], [12, -12, 2.5]]
  const hit = (await pickOver(path[0]))!
  expect(hit.part).toBe('base')
  await strokeOver(path)
  await expect(card()).toBeVisible()
  const stroke = marksOnDisk().marks.at(-1) as StrokeMark
  expect(marksOnDisk().marks).toHaveLength(before + 1)
  expect(stroke).toMatchObject({ kind: 'stroke', space: 'surface', author: 'user', anchor: { part: 'base', descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' } })
  expect(stroke.plane).toBeUndefined()
  expect(stroke.points2d).toBeUndefined()
  expect(stroke.points).toHaveLength(4)
  for (const point of stroke.points!) expect(Math.abs(point[2] - 2.5)).toBeLessThan(0.01)
  for (const [i, point] of stroke.points!.entries()) expect(length(point, path[i])).toBeLessThan(0.6)
  expect(stroke.anchor.point).toEqual(stroke.points![0])
  await page.keyboard.press('Escape') // the note
  await expect(card()).toHaveCount(0)

  // A press beside the part is no stroke: it turns the camera as ever.
  const view = await camera()
  const box = (await canvas().boundingBox())!
  await page.mouse.move(box.x + box.width - 30, box.y + box.height - 80)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 70, box.y + box.height - 80)
  await page.mouse.up()
  expect((await camera()).position).not.toEqual(view.position)
  expect(marksOnDisk().marks).toHaveLength(before + 1)
  await page.keyboard.press('v')
})

const shapeButton = () => tool('Shape')
const shapeChoice = () => page.getByRole('menu', { name: 'Shape to place' })
let box = '' // the id of the shape the next tests work on

test('S takes the shape tool; its button offers box, cylinder, sphere and plane, and keeps the one chosen', async () => {
  await expect(shapeButton()).toBeEnabled()
  await page.keyboard.press('s')
  await expect(shapeButton()).toHaveAttribute('aria-pressed', 'true')
  await expect(shapeButton()).toHaveAttribute('data-shape', 'box')
  await expect(canvas()).toHaveCSS('cursor', 'crosshair')
  await expect(shapeChoice()).toHaveCount(0) // the key takes the tool; the button opens the choice

  await shapeButton().click()
  await expect(shapeChoice().getByRole('menuitemradio')).toHaveCount(4)
  await expect(shapeChoice().getByRole('menuitemradio', { name: 'Box' })).toHaveAttribute('aria-checked', 'true')
  await shapeChoice().getByRole('menuitemradio', { name: 'Cylinder' }).click()
  await expect(shapeChoice()).toHaveCount(0)
  await expect(shapeButton()).toHaveAttribute('data-shape', 'cylinder')
  await expect(shapeButton()).toHaveAttribute('aria-pressed', 'true')

  // Remembered through another tool.
  await page.keyboard.press('v')
  await page.keyboard.press('s')
  await expect(shapeButton()).toHaveAttribute('data-shape', 'cylinder')
  await shapeButton().click()
  await expect(shapeChoice().getByRole('menuitemradio', { name: 'Cylinder' })).toHaveAttribute('aria-checked', 'true')
  // Escape closes the choice and leaves the tool in hand.
  await page.keyboard.press('Escape')
  await expect(shapeChoice()).toHaveCount(0)
  await expect(shapeButton()).toHaveAttribute('aria-pressed', 'true')
  await shapeButton().click()
  await shapeChoice().getByRole('menuitemradio', { name: 'Box' }).click()
  await expect(shapeButton()).toHaveAttribute('data-shape', 'box')
})

test('a click on the base places a box there to add, sitting on the surface, with its fields open and a gizmo on it', async () => {
  await page.keyboard.press('1')
  await atRest()
  const before = marksOnDisk().marks.length
  const hit = (await pickOver(ON_BASE))!
  expect(hit.part).toBe('base')
  await expect(canvas()).not.toHaveAttribute('data-gizmo')
  await clickOver(ON_BASE)
  await expect(card()).toBeVisible()
  await expect(field()).toBeFocused()
  const placed = marksOnDisk().marks.at(-1) as ShapeMark
  box = placed.id
  expect(marksOnDisk().marks).toHaveLength(before + 1)
  // 15% of the bracket from corner to corner (55.9 mm) is 8 mm.
  expect(placed).toMatchObject({ kind: 'shape', shape: 'box', intent: 'add', author: 'user', status: 'draft', layout: 'assembly', size: [8, 8, 8], rotation: [0, 0, 0, 1], anchor: { part: 'base', ref: hit.ref } })
  // Where the pointer was, to the pixel; its bottom on the top of the base.
  expect(Math.abs(placed.position[0] - ON_BASE[0])).toBeLessThan(0.5)
  expect(Math.abs(placed.position[1] - ON_BASE[1])).toBeLessThan(0.5)
  expect(placed.position[2]).toBeCloseTo(6.5, 2)
  expect(placed.position).toEqual([placed.anchor!.point[0], placed.anchor!.point[1], placed.anchor!.point[2] + 4])
  await page.keyboard.type('a pocket here')
  await page.keyboard.press('Enter')
  await expect.poll(() => shapeOnDisk(box).note).toBe('a pocket here')

  // It is the active mark: its row is open on its numbers, and the gizmo is on it, to move it.
  expect((await state()).activeMark).toBe(box)
  const row = page.locator(`.mark-row[data-mark="${box}"]`)
  await expect(row).toHaveAttribute('data-expanded', '')
  await expect(row.locator('.mark-kind')).toHaveAttribute('aria-label', 'Shape · box, add')
  await expect(page.locator('.shape-fields')).toHaveCount(1)
  await expect(canvas()).toHaveAttribute('data-gizmo', 'translate')
  await expect(fieldsButton('Add')).toHaveAttribute('aria-pressed', 'true')
  await expect(numberField('Size along X')).toHaveValue('8')
  await expect(numberField('Position Z')).toHaveValue('6.5')
  await expect(numberField('Rotation about Z')).toHaveValue('0')
  for (const input of await page.locator('.shape-fields input').all()) await expect(input).toHaveCSS('font-family', /IBM Plex Mono/)
})

test('the fields set what the shape is for and its size, in exact millimetres; a picture shows it', async () => {
  await fieldsButton('Remove').click()
  await expect(fieldsButton('Remove')).toHaveAttribute('aria-pressed', 'true')
  await typeNumber('Size along X', '10')
  // Left by Tab: a field that is left keeps its number too.
  await numberField('Size along Y').fill('10')
  await page.keyboard.press('Tab')
  await expect(numberField('Size along Z')).toBeFocused()
  await page.keyboard.type('4')
  await page.keyboard.press('Enter')
  await expect.poll(() => shapeOnDisk(box).size).toEqual([10, 10, 4])
  expect(shapeOnDisk(box)).toMatchObject({ intent: 'remove', size: [10, 10, 4], rotation: [0, 0, 0, 1], note: 'a pocket here' })
  await expect(numberField('Size along X')).toHaveValue('10')
  await expect(numberField('Size along Z')).toHaveValue('4')

  // No size under 0.1 mm, and what is no number changes nothing; Escape puts back what was there.
  await typeNumber('Size along Z', '0')
  await expect.poll(() => shapeOnDisk(box).size).toEqual([10, 10, 0.1])
  await expect(numberField('Size along Z')).toHaveValue('0.1')
  await typeNumber('Size along Z', 'tall')
  await expect(numberField('Size along Z')).toHaveValue('0.1')
  await numberField('Size along Z').fill('99')
  await numberField('Size along Z').press('Escape')
  await expect(numberField('Size along Z')).toHaveValue('0.1')
  await typeNumber('Size along Z', '4')
  await expect.poll(() => shapeOnDisk(box).size).toEqual([10, 10, 4])

  // Typing in a field is typing: the keys of the tools, the views and the gizmo do nothing.
  const view = await camera()
  await numberField('Position X').focus()
  await page.keyboard.type('r1t2')
  await page.keyboard.press('Escape')
  expect(await camera()).toEqual(view)
  await expect(fieldsButton('Move')).toHaveAttribute('aria-pressed', 'true')
  await expect(shapeButton()).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())

  // The agent's picture shows the shape where it is, and not the gizmo it is held by.
  const centre = shapeOnDisk(box).position
  expect(await differingNear({ view: 'current' }, { view: 'current', marks: false }, centre)).toBeGreaterThan(50)
  await expect(canvas()).toHaveAttribute('data-gizmo', 'translate')
  expect(await gizmoPixels()).toBe(0)
})

test('G, R and T choose what the gizmo does while a shape is active, and only then', async () => {
  for (const [key, label, mode] of [['r', 'Rotate', 'rotate'], ['t', 'Size', 'scale'], ['g', 'Move', 'translate']] as const) {
    await page.keyboard.press(key)
    await expect(fieldsButton(label)).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas()).toHaveAttribute('data-gizmo', mode)
  }
  // The tool in hand is still the shape tool: T and G are no tools, and S did not come into it.
  await expect(shapeButton()).toHaveAttribute('aria-pressed', 'true')
  await fieldsButton('Rotate').click()
  await expect(canvas()).toHaveAttribute('data-gizmo', 'rotate')
  await fieldsButton('Move').click()

  // Another mark is the active one: no gizmo, and the keys do nothing.
  await atRest()
  const [held, view] = [await pictureNow(), await camera()]
  await page.locator('.mark-row[data-mark="M1"] .mark-note').click({ position: { x: 4, y: 8 } })
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await state()).activeMark).toBe('M1')
  await expect(canvas()).not.toHaveAttribute('data-gizmo')
  // The agent's picture is the same with the gizmo on the shape and without: to the pixel, the triad's corner too.
  await atRest()
  expect(await camera()).toEqual(view)
  expect(await differing(held, await pictureNow())).toBe(0)
  await expect(page.locator('.shape-fields')).toHaveCount(0)
  await page.keyboard.press('r')
  await page.locator(`.mark-row[data-mark="${box}"] .mark-note`).click({ position: { x: 4, y: 8 } })
  await page.keyboard.press('Escape')
  await expect(canvas()).toHaveAttribute('data-gizmo', 'translate')
})

test('dragging a handle of the gizmo moves the shape with it and has main keep it once, when it is let go', async () => {
  const from = shapeOnDisk(box)
  const view = await camera()
  const marks = marksOnDisk().marks.length
  const [x, y] = await ontoHandle(from.position, 'X')
  await expect(canvas()).toHaveCSS('cursor', 'grab')
  const [ax, ay] = await pageXY(from.position)
  const [bx, by] = await pageXY([from.position[0] - 6, from.position[1], from.position[2]])
  const changes = await countChanges()
  await page.mouse.down()
  await page.mouse.move(x + (bx - ax) / 2, y + (by - ay) / 2)
  await page.mouse.move(x + (bx - ax), y + (by - ay))
  // Still held: the viewport shows it there, and nothing has been kept.
  expect(await changes()).toBe(0)
  expect(shapeOnDisk(box).position).toEqual(from.position)
  await page.mouse.up()

  await expect.poll(() => shapeOnDisk(box).position[0]).not.toBe(from.position[0])
  const moved = shapeOnDisk(box)
  expect(moved.position[0]).toBeCloseTo(from.position[0] - 6, 0)
  expect(moved.position[1]).toBeCloseTo(from.position[1], 2)
  expect(moved.position[2]).toBeCloseTo(from.position[2], 2)
  // To the hundredth of a millimetre, and nothing else of it changed.
  for (const c of moved.position) expect(Math.abs(c * 100 - Math.round(c * 100))).toBeLessThan(1e-6)
  expect(moved).toMatchObject({ size: [10, 10, 4], rotation: [0, 0, 0, 1], intent: 'remove', note: 'a pocket here' })
  await page.waitForTimeout(300)
  expect(await changes()).toBe(1)
  // The drag was the gizmo's: the camera did not turn, and the shape tool placed nothing.
  expect(await camera()).toEqual(view)
  expect(marksOnDisk().marks).toHaveLength(marks)
  await expect(numberField('Position X')).toHaveValue(String(Math.round(moved.position[0] * 100) / 100))

  // A click on a handle is no click on the part: nothing is placed, nothing changed.
  await ontoHandle(moved.position, 'X')
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(300)
  expect(marksOnDisk().marks).toHaveLength(marks)
  expect(await changes()).toBe(1)
  await expect(card()).toHaveCount(0)
})

test('sizing with the gizmo changes the size in millimetres, never a scale', async () => {
  await page.keyboard.press('t')
  await expect(canvas()).toHaveAttribute('data-gizmo', 'scale')
  const from = shapeOnDisk(box)
  const [x, y] = await ontoHandle(from.position, 'X')
  const [ax, ay] = await pageXY(from.position)
  const [bx, by] = await pageXY([from.position[0] + 10, from.position[1], from.position[2]])
  const changes = await countChanges()
  await page.mouse.down()
  await page.mouse.move(x + (bx - ax) / 4, y + (by - ay) / 4)
  await page.mouse.move(x + (bx - ax) / 2, y + (by - ay) / 2)
  await page.mouse.up()
  await expect.poll(() => shapeOnDisk(box).size[0]).not.toBe(10)
  const sized = shapeOnDisk(box)
  expect(sized.size[0]).toBeGreaterThan(10.5)
  expect(sized.size.slice(1)).toEqual([10, 4])
  expect(Math.abs(sized.size[0] * 100 - Math.round(sized.size[0] * 100))).toBeLessThan(1e-6)
  expect(sized.position).toEqual(from.position)
  expect(sized.rotation).toEqual(from.rotation)
  expect('scale' in sized).toBe(false)
  await page.waitForTimeout(300)
  expect(await changes()).toBe(1)
  await expect(numberField('Size along X')).toHaveValue(String(Math.round(sized.size[0] * 100) / 100))
  await page.keyboard.press('g')
})

test('rotation is typed as degrees about X, Y and Z and kept as a quaternion; the numbers typed do not jump', async () => {
  await typeNumber('Rotation about Z', '30')
  const half = (15 * Math.PI) / 180
  await expect.poll(() => shapeOnDisk(box).rotation[3]).toBeCloseTo(Math.cos(half), 9)
  expect(shapeOnDisk(box).rotation[2]).toBeCloseTo(Math.sin(half), 9)
  // 100° about Y, typed after: as three angles read back from the quaternion that would be 180, 80, -150.
  await typeNumber('Rotation about Y', '100')
  await expect.poll(() => Math.abs(shapeOnDisk(box).rotation[1])).toBeGreaterThan(0.5)
  await expect(numberField('Rotation about X')).toHaveValue('0')
  await expect(numberField('Rotation about Y')).toHaveValue('100')
  await expect(numberField('Rotation about Z')).toHaveValue('30')
  // Back to upright, one field at a time.
  await typeNumber('Rotation about Y', '0')
  await typeNumber('Rotation about Z', '0')
  await expect.poll(() => shapeOnDisk(box).rotation.map((c) => Math.abs(Math.round(c * 1e9) / 1e9))).toEqual([0, 0, 0, 1])
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await expect(numberField('Rotation about Y')).toHaveValue('0')
})

test('a stroke drawn across the gizmo of the active shape is kept whole: the press began on the part, not on a handle', async () => {
  const shape = shapeOnDisk(box)
  expect((await state()).activeMark).toBe(box)
  await expect(canvas()).toHaveAttribute('data-gizmo', 'translate')
  // The middle of the gizmo is a handle: the pointer over it, with no button held, is the gizmo's.
  const [cx, cy] = await pageXY(shape.position)
  await page.mouse.move(cx, cy)
  await expect(canvas()).toHaveAttribute('data-gizmo-axis', /.+/)

  await page.keyboard.press('d')
  await expect(canvas()).toHaveAttribute('data-gizmo', 'translate') // still on the shape, with another tool in hand
  const marks = marksOnDisk().marks.length
  const from: Vec3 = [17, -11, 2.5]
  expect((await pickOver(from))?.part).toBe('base')
  const [x0, y0] = await pageXY(from)
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move((x0 + cx) / 2, (y0 + cy) / 2)
  await page.mouse.move(cx, cy) // over the handle, button held
  await page.mouse.move(cx + (cy - y0) / 3, cy - (cx - x0) / 3) // and on, round a corner: the sample over the handle is the corner
  await page.mouse.up()

  await expect(card()).toBeVisible()
  expect(marksOnDisk().marks).toHaveLength(marks + 1)
  const stroke = marksOnDisk().marks.at(-1) as StrokeMark
  expect(stroke).toMatchObject({ kind: 'stroke', space: 'surface', anchor: { part: 'base' } })
  // Every sample is there, the one taken over the handle too.
  expect(stroke.points!.length).toBeGreaterThanOrEqual(3)
  // The shape was not moved by it.
  expect(shapeOnDisk(box).position).toEqual(shape.position)
  await page.keyboard.press('Escape') // the note
  await expect(card()).toHaveCount(0)
  await page.keyboard.press('s')
})

test('a click beside the parts places the shape on the ground at the middle of the view; resolving a shape takes its gizmo away', async () => {
  const marks = marksOnDisk().marks.length
  const pane = (await canvas().boundingBox())!
  await page.mouse.move(pane.x + pane.width - 40, pane.y + pane.height - 90)
  await page.mouse.down()
  await page.mouse.up()
  await expect(card()).toBeVisible()
  const placed = marksOnDisk().marks.at(-1) as ShapeMark
  expect(marksOnDisk().marks).toHaveLength(marks + 1)
  expect(placed).toMatchObject({ kind: 'shape', shape: 'box', intent: 'add', size: [8, 8, 8], rotation: [0, 0, 0, 1] })
  expect(placed.anchor).toBeUndefined()
  // The ground is the lowest face of the base, z = -2.5, and the box stands on it.
  expect(placed.position[2]).toBeCloseTo(1.5, 6)
  const [fx, fy] = await page.evaluate((at) => window.__tornoTest!.project(at), [placed.position[0], placed.position[1], -2.5] as Vec3)
  expect(Math.abs(fx - 0.5)).toBeLessThan(0.02)
  expect(Math.abs(fy - 0.5)).toBeLessThan(0.02)
  await page.keyboard.press('Escape') // the note
  await expect(canvas()).toHaveAttribute('data-gizmo', 'translate')
  expect((await state()).activeMark).toBe(placed.id)

  await page.locator(`.mark-row[data-mark="${placed.id}"]`).hover()
  await page.getByRole('button', { name: `Resolve ${placed.id}`, exact: true }).click()
  await expect.poll(() => shapeOnDisk(placed.id).status).toBe('resolved')
  await expect(canvas()).not.toHaveAttribute('data-gizmo')
  await expect(page.locator('.shape-fields')).toHaveCount(0)
  await page.keyboard.press('v')
})

test('a note that goes away by itself keeps what was typed; Control+A selects all of it though there is no menu', async () => {
  await page.keyboard.press('1')
  await page.keyboard.press('p')
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  const at: Vec3 = [-16, -11, 2.5]
  expect((await pickOver(at))?.part).toBe('base')
  await clickOver(at)
  await expect(field()).toBeFocused()
  const id = (await state()).noting!
  await page.keyboard.type('first thought')
  await page.keyboard.press('Control+A')
  await page.keyboard.type('make this 8 mm')
  await expect(field()).toHaveValue('make this 8 mm')
  // Undo is the field's own too: it brings back what the typing replaced.
  await page.keyboard.press('Control+Z')
  await expect(field()).not.toHaveValue('make this 8 mm')
  await page.keyboard.press('Control+A')
  await page.keyboard.type('make this 8 mm')
  expect(marksOnDisk().marks.find((m) => m.id === id)?.note).toBe('')

  // Resolved from elsewhere, as the agent does: the card goes with no press and no key.
  await page.evaluate((mark) => window.torno.marks.update('bracket', mark, { status: 'resolved' }), id)
  await expect(card()).toHaveCount(0)
  await expect.poll(() => marksOnDisk().marks.find((m) => m.id === id)?.note).toBe('make this 8 mm')
  await page.keyboard.press('Escape')
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
})

// Set TORNO_SHOTS=<dir> to write tool-pin-light.png, tool-arrow-light.png,
// tool-draw-light.png, tool-shape-light.png and their -dark twins there: the
// note open on a fresh pin, an arrow being dragged with its readout, a profile
// being drawn on the locked front view, and a box to remove with its gizmo and
// its fields. Each picture needs its own launch: on a hidden
// window capturePage() delivers one image and hangs on the next call, and
// page.screenshot() never returns.
for (const shot of ['pin-light', 'pin-dark', 'arrow-light', 'arrow-dark', 'draw-light', 'draw-dark', 'shape-light', 'shape-dark'] as const) {
  test(`screenshot of the tools, ${shot}`, async () => {
    const dir = process.env.TORNO_SHOTS
    test.skip(!dir, 'TORNO_SHOTS is not set')
    test.setTimeout(120_000)
    mkdirSync(dir!, { recursive: true })
    const shotRoot = copyFixtures()
    const shotApp = await launch({ TORNO_WORKSPACE: shotRoot })
    try {
      const shotPage = await shotApp.firstWindow()
      await shotPage.emulateMedia({ colorScheme: shot.endsWith('dark') ? 'dark' : 'light' })
      await shotPage.getByRole('button', { name: 'bracket', exact: true }).click()
      await expect.poll(async () => (await state(shotPage)).build?.status, { timeout: 90_000 }).toBe('ok')
      if (shot.startsWith('pin')) {
        await shotPage.keyboard.press('p')
        await clickOver([-13, -9, 2.5], {}, shotPage)
        await expect(field(shotPage)).toBeFocused()
        await shotPage.keyboard.type('too thin under the post')
        await shotPage.keyboard.press('Enter')
        await clickOver([0, -4, 14], {}, shotPage)
        await expect(card(shotPage).locator('.mark-chip')).toHaveText('M2')
        await expect(field(shotPage)).toBeFocused()
      } else if (shot.startsWith('shape')) {
        await shotPage.keyboard.press('s')
        await clickOver([-12, -8, 2.5], {}, shotPage)
        await expect(field(shotPage)).toBeFocused()
        await shotPage.keyboard.type('pocket for the nut')
        await shotPage.keyboard.press('Enter')
        await fieldsButton('Remove', shotPage).click()
        await typeNumber('Size along X', '12', shotPage)
        await typeNumber('Size along Y', '9', shotPage)
        await typeNumber('Size along Z', '4', shotPage)
        await typeNumber('Rotation about Z', '15', shotPage)
        await expect.poll(async () => (await state(shotPage)).marks[0]).toMatchObject({ intent: 'remove', size: [12, 9, 4] })
        await shotPage.evaluate(() => (document.activeElement as HTMLElement).blur())
        await expect(canvas(shotPage)).toHaveAttribute('data-gizmo', 'translate')
      } else if (shot.startsWith('draw')) {
        await shotPage.keyboard.press('o')
        await shotPage.keyboard.press('2')
        await expect.poll(async () => (await state(shotPage)).lockedView).toBe('front')
        await shotPage.keyboard.press('d')
        // A gusset between the base and the post, drawn by hand: not quite straight.
        const profile: Vec3[] = [[17, 0, 2.6], [16.2, 0, 4.4], [14.1, 0, 7.2], [11.8, 0, 10.5], [9.2, 0, 13.4], [7.1, 0, 16.6], [5.2, 0, 19.3], [4.1, 0, 20.4]]
        await strokeOver(profile, { hold: true }, shotPage)
        await expect(readout(shotPage)).toBeVisible()
      } else {
        await shotPage.keyboard.press('a')
        await dragOver([0, -4, 16], [14, -15, 16], { hold: true }, shotPage)
        await expect(readout(shotPage)).toBeVisible()
      }
      await shotPage.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      const png = await shotApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
        return image.toPNG().toString('base64')
      })
      writeFileSync(join(dir!, `tool-${shot}.png`), Buffer.from(png, 'base64'))
    } finally {
      await shotApp.close()
      rmSync(shotRoot, { recursive: true, force: true })
    }
  })
}
