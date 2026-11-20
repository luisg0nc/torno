import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { Hit } from '../src/renderer/viewport/picking'
import type { ArrowMark, MarksFile, PickMark, PinMark, ShapeMark, SketchMark } from '../src/shared/marks'
import { TOOL_KEYS, doesOf } from '../src/shared/keys'
import { pointerLine } from '../src/shared/pointer'
import type { Camera, LookRequest } from '../src/shared/view'
import { clickHere, onBrief, showBrief, showModel } from './helpers'
import { openListed } from './objects'
import { stableBox } from './stable'

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
  await page.waitForSelector('[data-region="viewport"]')
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

/** A press over a mark's chip is the chip's, whatever tool is in hand: a point a tool is to be handed has none on it. */
async function clearOfChips(point: Vec3, p: Page): Promise<void> {
  const chip = await p.evaluate((at) => {
    const [fx, fy] = window.__tornoTest!.project(at)
    return window.__tornoTest!.chipAt(fx, fy)
  }, point)
  expect(chip, `the chip of ${chip} is drawn over ${JSON.stringify(point)}`).toBeNull()
}

async function clickOver(point: Vec3, opts: { shift?: boolean } = {}, p: Page = page): Promise<void> {
  await clearOfChips(point, p)
  const [x, y] = await pageXY(point, p)
  await p.mouse.move(x, y)
  if (opts.shift) await p.keyboard.down('Shift')
  await clickHere(p)
  if (opts.shift) await p.keyboard.up('Shift')
}

/** Press where one point is drawn, drag to where another is, and let go unless told to hold. */
async function dragOver(from: Vec3, to: Vec3, opts: { hold?: boolean } = {}, p: Page = page): Promise<void> {
  await clearOfChips(from, p)
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
  await clearOfChips(points[0], p)
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

const lockOf = (view: string, p: Page = page) => p.locator(`.compass [data-view="${view}"]`)
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
  await openListed(p, 'bracket')
  await expect.poll(async () => (await state(p)).build?.status, { timeout: 30_000 }).toBe('ok')
  await fromAbove(p)
}

async function fromAbove(p: Page = page): Promise<void> {
  await p.getByRole('button', { name: 'Top view, 4', exact: true }).click()
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

test('the reed is in three groups, each a pill: the tools that inspect, those that mark, and the scan’s; the keys still take each tool', async () => {
  await openFromAbove()
  const tools = page.getByRole('toolbar', { name: 'Tools' })
  const inGroup = (name: string) => tools.getByRole('group', { name, exact: true }).locator('[data-tool]').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('data-tool')))
  await expect.poll(() => inGroup('Inspect')).toEqual(['select', 'measure', 'section'])
  await expect.poll(() => inGroup('Mark')).toEqual(['pin', 'arrow', 'draw', 'shape', 'region'])
  await expect.poll(() => inGroup('Scan')).toEqual(['align'])
  // Each group is a pill of its own.
  await expect(tools.getByRole('group')).toHaveCount(3)
  await expect(tools).toHaveAttribute('data-tag-avoid', '')
  for (const [key, name] of [['m', 'Measure'], ['p', 'Pin'], ['l', 'Align scan'], ['v', 'Select']] as const) {
    await page.keyboard.press(key)
    await expect(tool(name)).toHaveAttribute('aria-pressed', 'true')
  }
})

const tip = (name: string, p: Page = page) => p.locator(`.tool-tip[data-tip="${name}"]`)
/** The caption by the pointer: what the tool in hand waits for. */
const hintLine = (p: Page = page) => p.locator('.tool-hint')
/** The hint at the foot of the view that says how the pointer moves the view, once. */
const pointerHint = (p: Page = page) => p.locator('.view-hint[data-kind="pointer"]')

test('pointing at a tool shows at once what it does and its key; a scan’s tool with no scan says to import one', async () => {
  await openFromAbove()
  // Nothing native: the words are torno's own, and the button keeps them for a reader of the screen.
  for (const t of TOOL_KEYS) {
    const button = tool(t.label)
    await expect(button).not.toHaveAttribute('title', /.+/)
    await button.hover()
    // At once: a native title comes after about a second.
    await expect(tip(t.name)).toBeVisible({ timeout: 200 })
    await expect(tip(t.name)).toContainText(t.label)
    await expect(tip(t.name)).toContainText(doesOf(t.name))
    await expect(tip(t.name).locator('kbd')).toHaveText(t.key)
    expect(await button.getAttribute('aria-description')).toContain(doesOf(t.name))
    // Only the tool pointed at has one.
    await expect(page.locator('.tool-tip')).toHaveCount(1)
  }
  // The pointer leaves: the tip goes.
  await page.mouse.move(400, 300)
  await expect(page.locator('.tool-tip')).toHaveCount(0)
  // No scan in this object: the scan's tools are quieter, not disabled, and the tip says why.
  for (const [name, label] of [['region', 'Region of a scan'], ['align', 'Align scan']] as const) {
    await expect(tool(label)).toBeEnabled()
    await expect(tool(label)).toHaveAttribute('data-quiet', '')
    await tool(label).hover()
    await expect(tip(name)).toContainText('Import a scan first', { timeout: 200 })
  }
  await expect(tool('Pin')).not.toHaveAttribute('data-quiet', /.*/)
  // The keys' focus shows it too, as the pointer does.
  await page.mouse.move(400, 300)
  await page.keyboard.press('Shift')
  await tool('Pin').focus()
  await expect(tip('pin')).toBeVisible()
  // A key puts it away, as it does a tooltip.
  await page.keyboard.press('Shift')
  await expect(page.locator('.tool-tip')).toHaveCount(0)
  await tool('Pin').blur()
  await page.keyboard.press('Escape')
})

test('with a tool in hand the caption says what it waits for, and Measure’s goes on after the first click', async () => {
  await openFromAbove()
  await atRest()
  await page.keyboard.press('v')
  await page.mouse.move(400, 300)
  for (const t of TOOL_KEYS.filter((k) => k.next !== null && !['region', 'align', 'section'].includes(k.name))) {
    await page.keyboard.press(t.key.toLowerCase())
    await expect(hintLine()).toContainText(t.next!)
    // It names no key of a tool: only the way back.
    await expect(hintLine().locator('kbd')).toHaveText(['Esc'])
    for (const other of TOOL_KEYS) await expect(hintLine().locator('.tool-hint-text')).not.toHaveText(new RegExp(`\\b${other.key}\\b`))
  }
  // Select waits for nothing: no step (the pointer hint may still be due, on this window that has not turned yet).
  await page.keyboard.press('v')
  await expect(page.locator('.tool-hint[data-kind="step"]')).toHaveCount(0)
  // Measure: the first end, then the second.
  await page.keyboard.press('m')
  await expect(hintLine()).toContainText('Measure: click the first end')
  await clickOver(ON_BASE)
  await expect(hintLine()).toContainText('Measure: click the second end')
  await page.keyboard.press('Escape')
  await expect(hintLine()).toContainText('Measure: click the first end')
  await clickOver(ON_BASE)
  await expect(hintLine()).toContainText('Measure: click the second end')
  await clickOver(ON_POST)
  await expect(hintLine()).toContainText('Measure: click the first end')
  // A scan's tool with no scan waits for one.
  await page.keyboard.press('b')
  await expect(hintLine()).toContainText('Region of a scan: import a scan first')
  await page.keyboard.press('v')
  await expect(page.locator('.tool-hint[data-kind="step"]')).toHaveCount(0)
})

test('the caption is an ink pill 18 px below and right of the pointer; its words are always there, and it is shown at once for a tool’s first uses, then where the pointer rests', async () => {
  await openFromAbove()
  await page.keyboard.press('v')
  await page.evaluate(() => localStorage.removeItem('torno.toolUses'))
  const view = (await canvas().boundingBox())!
  const at: [number, number] = [view.x + 150, view.y + 70]
  await page.mouse.move(...at)
  await expect(readout()).toBeHidden()
  await page.keyboard.press('m')
  await expect(hintLine()).toContainText('Measure: click the first end')
  // The words are in a polite live region, and the caption takes no pointer.
  await expect(page.locator('.tool-hint-live')).toHaveAttribute('aria-live', 'polite')
  expect(await hintLine().evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
  // The first uses: shown at once, 18 px below and to the right.
  await expect(hintLine()).toHaveAttribute('data-shown', '')
  await page.mouse.move(at[0] + 3, at[1] + 2)
  await expect(hintLine()).toHaveAttribute('data-shown', '')
  await expect
    .poll(async () => {
      const box = (await hintLine().boundingBox())!
      return [Math.round(box.x - (at[0] + 3)), Math.round(box.y - (at[1] + 2))]
    })
    .toEqual([18, 18])
  // An ink pill: the ink ground, the surface's text.
  const look = await hintLine().evaluate((el) => {
    const css = getComputedStyle(document.documentElement)
    const probe = document.createElement('i')
    const colour = (name: string) => {
      probe.style.color = css.getPropertyValue(name)
      document.body.append(probe)
      const c = getComputedStyle(probe).color
      probe.remove()
      return c
    }
    const own = getComputedStyle(el)
    return { ground: own.backgroundColor, text: own.color, ink: colour('--ink'), surface: colour('--surface') }
  })
  expect(look.ground).toBe(look.ink)
  expect(look.text).toBe(look.surface)
  // After ten uses it shows only where the pointer rests: put away by a move, back after half a second.
  await page.evaluate(() => localStorage.setItem('torno.toolUses', '40'))
  await page.keyboard.press('a')
  await page.keyboard.press('m')
  await page.mouse.move(at[0], at[1] + 6)
  await expect(hintLine()).not.toHaveAttribute('data-shown', /.*/)
  await expect(hintLine()).toContainText('Measure: click the first end')
  await expect(hintLine()).toHaveAttribute('data-shown', '')
  await page.mouse.move(at[0], at[1] + 12)
  await expect(hintLine()).not.toHaveAttribute('data-shown', /.*/)
  await page.evaluate(() => localStorage.removeItem('torno.toolUses'))
  await page.keyboard.press('v')
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
  await clickHere(page)

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
  // The row is on the Brief page.
  await onBrief(page, () => expect(page.locator('.mark-row[data-mark="M1"] .mark-note')).toHaveText('add a rib here, 1 mm thick, V-shaped'))
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
  await onBrief(page, () => expect(page.locator('.mark-row')).toHaveCount(3))
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
  const note = page.getByRole('group', { name: 'Selection' }).getByRole('button', { name: 'Note each', exact: true })
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
  await page.getByRole('group', { name: 'Layout' }).getByRole('button').click()
  await page.getByRole('menuitem', { name: 'print', exact: true }).click()
  await expect.poll(async () => (await state()).layout).toBe('print')
  await expect(card()).toHaveCount(0)
  await page.getByRole('group', { name: 'Layout' }).getByRole('button').click()
  await page.getByRole('menuitem', { name: 'assembly', exact: true }).click()
  await expect.poll(async () => (await state()).layout).toBe('assembly')
  await expect(card()).toHaveCount(0)
})

test('on a failed build the tools work on the last good build: the pointer waits for nothing, and a pin hovers the face as ever', async () => {
  const before = marksOnDisk().marks.length
  const source = readFileSync(model(), 'utf8')
  appendFileSync(model(), '\nthis is not python(\n')
  await expect.poll(async () => (await state()).build, { timeout: 20_000 }).toMatchObject({ status: 'failed', stale: true })

  // Hovering only, so that no mark is made and the ids of the tests after this one stay as they are.
  await page.keyboard.press('p')
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  const [x, y] = await pageXY(ON_BASE)
  await page.mouse.move(x, y)
  await expect(readout()).toBeVisible()
  await expect(readout()).not.toHaveText(/picks wait|build failed/i)
  await page.keyboard.press('Escape')
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
  await expect(lockOf('top').locator('svg.view-lock')).toBeVisible()

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

// A sketch is drawn in `e2e/sketch.spec.ts`: planes, pens, snapping, the panel and what the agent is told.
test('D takes the draw tool and opens a sketch that writes nothing until its first stroke; Escape leaves it', async () => {
  await expect(tool('Draw')).toBeEnabled()
  await page.keyboard.press('1')
  await atRest()
  const before = marksOnDisk().marks.length
  await page.keyboard.press('d')
  await expect(tool('Draw')).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas()).toHaveCSS('cursor', 'crosshair')
  await expect(page.getByRole('complementary', { name: 'Sketch' })).toBeVisible()
  expect(marksOnDisk().marks).toHaveLength(before)
  // Alt-drag turns the camera with Draw in hand, and leaves no stroke.
  const view = await camera()
  const box = (await canvas().boundingBox())!
  await page.mouse.move(box.x + box.width - 30, box.y + box.height - 80)
  await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 70, box.y + box.height - 80)
  await page.mouse.move(box.x + box.width - 110, box.y + box.height - 90)
  await page.mouse.up()
  await page.keyboard.up('Alt')
  expect((await camera()).position).not.toEqual(view.position)
  expect(marksOnDisk().marks).toHaveLength(before)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('complementary', { name: 'Sketch' })).toHaveCount(0)
  expect(marksOnDisk().marks).toHaveLength(before)
})

const shapeButton = () => tool('Shape')
const shapeChoice = () => page.getByRole('group', { name: 'Shape to place' })
let box = '' // the id of the shape the next tests work on

test('S takes the shape tool; its name grows out with a box, a cylinder, a sphere and a plane, and keeps the one chosen', async () => {
  await expect(shapeButton()).toBeEnabled()
  await expect(shapeChoice()).toHaveCount(0)
  await page.keyboard.press('s')
  await expect(shapeButton()).toHaveAttribute('aria-pressed', 'true')
  await expect(shapeButton()).toHaveAttribute('data-shape', 'box')
  await expect(canvas()).toHaveCSS('cursor', 'crosshair')
  // The key takes the tool and its name grows out with the four shapes, the box pressed: no button to press first.
  await expect(shapeChoice().getByRole('button')).toHaveCount(4)
  await expect(shapeChoice().getByRole('button', { name: 'Box' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.reed-pill[data-pill="shape"] .reed-key')).toHaveText('S')
  await shapeChoice().getByRole('button', { name: 'Cylinder' }).click()
  await expect(shapeButton()).toHaveAttribute('data-shape', 'cylinder')
  await expect(shapeButton()).toHaveAttribute('aria-pressed', 'true')
  await expect(shapeChoice().getByRole('button', { name: 'Cylinder' })).toHaveAttribute('aria-pressed', 'true')

  // Remembered through another tool, which has taken the name away.
  await page.keyboard.press('v')
  await expect(shapeChoice()).toHaveCount(0)
  await page.keyboard.press('s')
  await expect(shapeButton()).toHaveAttribute('data-shape', 'cylinder')
  await expect(shapeChoice().getByRole('button', { name: 'Cylinder' })).toHaveAttribute('aria-pressed', 'true')
  await shapeChoice().getByRole('button', { name: 'Box' }).click()
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
  // (Its row and numbers are on the Brief page, the gizmo on the view: each is looked at where it is.)
  const row = page.locator(`.mark-row[data-mark="${box}"]`)
  await expect(canvas()).toHaveAttribute('data-gizmo', 'translate')
  await onBrief(page, async () => {
    await expect(row).toHaveAttribute('data-expanded', '')
    await expect(row.locator('.mark-kind')).toHaveAttribute('aria-label', 'Shape · box, add')
    await expect(page.locator('.shape-fields')).toHaveCount(1)
    await expect(fieldsButton('Add')).toHaveAttribute('aria-pressed', 'true')
    await expect(numberField('Size along X')).toHaveValue('8')
    await expect(numberField('Position Z')).toHaveValue('6.5')
    await expect(numberField('Rotation about Z')).toHaveValue('0')
    for (const input of await page.locator('.shape-fields input').all()) await expect(input).toHaveCSS('font-family', /Martian Mono/)
  })
})

test('the fields set what the shape is for and its size, in exact millimetres; a picture shows it', async () => {
  // The fields are in the shape's row, on the Brief page; the view is shown again for the picture.
  await showBrief(page)
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
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await showModel(page)
  // (The palette is not drawn on the Brief page: the tool in hand is read on the view.)
  await expect(shapeButton()).toHaveAttribute('aria-pressed', 'true')

  // The agent's picture shows the shape where it is, and not the gizmo it is held by.
  const centre = shapeOnDisk(box).position
  expect(await differingNear({ view: 'current' }, { view: 'current', marks: false }, centre)).toBeGreaterThan(50)
  await expect(canvas()).toHaveAttribute('data-gizmo', 'translate')
  expect(await gizmoPixels()).toBe(0)
})

test('G, R and T choose what the gizmo does while a shape is active, and only then', async () => {
  for (const [key, label, mode] of [['r', 'Rotate', 'rotate'], ['t', 'Size', 'scale'], ['g', 'Move', 'translate']] as const) {
    await page.keyboard.press(key)
    await onBrief(page, () => expect(fieldsButton(label)).toHaveAttribute('aria-pressed', 'true'))
    await expect(canvas()).toHaveAttribute('data-gizmo', mode)
  }
  // The tool in hand is still the shape tool: T and G are no tools, and S did not come into it.
  await expect(shapeButton()).toHaveAttribute('aria-pressed', 'true')
  await onBrief(page, () => fieldsButton('Rotate').click())
  await expect(canvas()).toHaveAttribute('data-gizmo', 'rotate')
  await onBrief(page, () => fieldsButton('Move').click())

  // Another mark is the active one: no gizmo, and the keys do nothing.
  await atRest()
  const [held, view] = [await pictureNow(), await camera()]
  await onBrief(page, async () => {
    await page.locator('.mark-row[data-mark="M1"] .mark-note').click({ position: { x: 4, y: 8 } })
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await state()).activeMark).toBe('M1')
    await expect(page.locator('.shape-fields')).toHaveCount(0)
  })
  await expect(canvas()).not.toHaveAttribute('data-gizmo')
  // The agent's picture is the same with the gizmo on the shape and without: to the pixel, the triad's corner too.
  await atRest()
  expect(await camera()).toEqual(view)
  expect(await differing(held, await pictureNow())).toBe(0)
  await page.keyboard.press('r')
  await onBrief(page, async () => {
    await page.locator(`.mark-row[data-mark="${box}"] .mark-note`).click({ position: { x: 4, y: 8 } })
    await page.keyboard.press('Escape')
  })
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
  await onBrief(page, () => expect(numberField('Position X')).toHaveValue(String(Math.round(moved.position[0] * 100) / 100)))

  // A click on a handle is no click on the part: nothing is placed, nothing changed.
  await ontoHandle(moved.position, 'X')
  await clickHere(page)
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
  await onBrief(page, () => expect(numberField('Size along X')).toHaveValue(String(Math.round(sized.size[0] * 100) / 100)))
  await page.keyboard.press('g')
})

test('rotation is typed as degrees about X, Y and Z and kept as a quaternion; the numbers typed do not jump', async () => {
  await showBrief(page)
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
  await showModel(page)
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

  // A sketch is made, with its first stroke; the press that began on the part was the pen's, not the handle's.
  await expect.poll(() => marksOnDisk().marks.length).toBe(marks + 1)
  const sketch = marksOnDisk().marks.at(-1) as SketchMark
  expect(sketch).toMatchObject({ kind: 'sketch', author: 'user' })
  expect(sketch.strokes).toHaveLength(1)
  // Every sample is there, the one taken over the handle too.
  expect((sketch.strokes[0].points ?? sketch.strokes[0].points2d)!.length).toBeGreaterThanOrEqual(3)
  // The shape was not moved by it.
  expect(shapeOnDisk(box).position).toEqual(shape.position)
  await page.keyboard.press('Escape') // leaves the sketch, which is kept
  await expect(page.getByRole('complementary', { name: 'Sketch' })).toHaveCount(0)
  await page.keyboard.press('s')
})

test('a click beside the parts places the shape on the ground at the middle of the view; resolving a shape takes its gizmo away', async () => {
  const marks = marksOnDisk().marks.length
  const pane = (await canvas().boundingBox())!
  await page.mouse.move(pane.x + pane.width - 40, pane.y + pane.height - 90)
  await clickHere(page)
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

  await onBrief(page, async () => {
    await page.locator(`.mark-row[data-mark="${placed.id}"]`).hover()
    await page.getByRole('button', { name: `Resolve ${placed.id}`, exact: true }).click()
    await expect.poll(() => shapeOnDisk(placed.id).status).toBe('resolved')
    await expect(page.locator('.shape-fields')).toHaveCount(0)
  })
  await expect(canvas()).not.toHaveAttribute('data-gizmo')
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
// note open on a fresh pin, an arrow being dragged with its readout, a sketch
// with a stroke on the XZ plane and its panel, and a box to remove with its gizmo and
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
      await openListed(shotPage, 'bracket')
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
        // The shape's fields are on the Brief page.
        await showBrief(shotPage)
        await fieldsButton('Remove', shotPage).click()
        await typeNumber('Size along X', '12', shotPage)
        await typeNumber('Size along Y', '9', shotPage)
        await typeNumber('Size along Z', '4', shotPage)
        await typeNumber('Rotation about Z', '15', shotPage)
        await expect.poll(async () => (await state(shotPage)).marks[0]).toMatchObject({ intent: 'remove', size: [12, 9, 4] })
        await shotPage.evaluate(() => (document.activeElement as HTMLElement).blur())
        await showModel(shotPage)
        await expect(canvas(shotPage)).toHaveAttribute('data-gizmo', 'translate')
      } else if (shot.startsWith('draw')) {
        await shotPage.keyboard.press('d')
        // A gusset between the base and the post, drawn by hand on the plane the view faces: not quite straight.
        const profile: Vec3[] = [[17, 0, 2.6], [16.2, 0, 4.4], [14.1, 0, 7.2], [11.8, 0, 10.5], [9.2, 0, 13.4], [7.1, 0, 16.6], [5.2, 0, 19.3], [4.1, 0, 20.4]]
        await shotPage.keyboard.press('Shift+2')
        await strokeOver(profile, {}, shotPage)
        await expect(shotPage.getByRole('complementary', { name: 'Sketch' })).toBeVisible()
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

test('the pointer hint shows the first time an object is drawn, goes at the first move of the camera, and is not shown again in this window’s storage', async () => {
  const fresh = copyFixtures()
  const first = await launch({ TORNO_WORKSPACE: fresh })
  try {
    const win = await first.firstWindow()
    await win.waitForSelector('[data-region="viewport"]')
    await openListed(win, 'bracket')
    await expect.poll(async () => (await state(win)).build?.status, { timeout: 30_000 }).toBe('ok')
    // On first open: how the pointer moves the view, and the key of the sheet of keys; no tool in hand.
    await expect(pointerHint(win)).toContainText(pointerLine())
    await expect(pointerHint(win).locator('kbd')).toHaveText(['?'])
    await expect(pointerHint(win)).toContainText('for every key')
    // A key that moves the camera by itself is not the person turning it; neither is a click that moves nothing.
    await win.getByRole('button', { name: 'Top view, 4', exact: true }).click()
    await atRest(win)
    await expect(pointerHint(win)).toBeVisible()
    // A tool's step is the caption's: the hint at the foot goes while the tool is in hand, and is back when it is put down.
    await win.keyboard.press('p')
    await expect(hintLine(win)).toContainText('Pin: click the part')
    await expect(pointerHint(win)).toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(pointerHint(win)).toContainText(pointerLine())
    // The section's tag stands clear of it, and it takes no pointer.
    await win.keyboard.press('x')
    await win.keyboard.press('v')
    await expect(win.locator('[data-tag="section"]')).toBeVisible()
    const foot = await stableBox(pointerHint(win))
    const bar = await stableBox(win.locator('[data-tag="section"]'))
    expect(bar.y + bar.height <= foot.y || bar.y >= foot.y + foot.height || bar.x + bar.width <= foot.x || bar.x >= foot.x + foot.width).toBe(true)
    expect(await pointerHint(win).evaluate((el) => getComputedStyle(el.parentElement!).pointerEvents)).toBe('none')
    await win.locator('[data-tag="section"] button[title="Show the parts whole again"]').click()
    await expect.poll(async () => (await state(win)).section).toBeNull()
    // The line does not take the pointer: a drag that starts under it turns the view.
    const view = (await canvas(win).boundingBox())!
    const before = await camera(win)
    await win.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
    await win.mouse.down()
    await win.mouse.move(view.x + view.width / 2 + 40, view.y + view.height / 2 + 20, { steps: 4 })
    await win.mouse.up()
    await expect(pointerHint(win)).toBeHidden()
    expect(await camera(win)).not.toEqual(before)
    expect(await win.evaluate(() => localStorage.getItem('torno.pointerHint'))).toBe('seen')
    // Nothing of it in the workspace.
    expect(existsSync(join(fresh, 'bracket', '.torno', 'pointerHint'))).toBe(false)
  } finally {
    await first.close()
    rmSync(fresh, { recursive: true, force: true })
  }
})

test('the wheel is a move of the camera too, and a storage that refuses leaves the hint to show again', async () => {
  const fresh = copyFixtures()
  const second = await launch({ TORNO_WORKSPACE: fresh })
  try {
    const win = await second.firstWindow()
    await win.waitForSelector('[data-region="viewport"]')
    // The window’s storage refuses: the hint is shown, and nothing breaks when it cannot be remembered.
    await win.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new Error('blocked')
      }
    })
    await openListed(win, 'bracket')
    await expect.poll(async () => (await state(win)).build?.status, { timeout: 30_000 }).toBe('ok')
    await expect(pointerHint(win)).toContainText(pointerLine())
    const view = (await canvas(win).boundingBox())!
    await win.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
    await win.mouse.wheel(0, -200)
    await expect(pointerHint(win)).toBeHidden()
    expect(await win.evaluate(() => localStorage.getItem('torno.pointerHint'))).toBeNull()
  } finally {
    await second.close()
    rmSync(fresh, { recursive: true, force: true })
  }
})
