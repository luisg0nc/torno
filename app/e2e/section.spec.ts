import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { BAR_SIDE, SCALE_BAR_MAX, SCREEN_UNIT, TRIAD_CLEAR } from '../src/renderer/viewport/overlay'
import type { Hit } from '../src/renderer/viewport/picking'
import type { Camera, LookRequest, SectionPlane, ViewState } from '../src/shared/view'
import { openPanel } from './helpers'
import { openListed } from './objects'
import { stableBox } from './stable'

// The section: a plane that takes half of the parts away and shows what they
// are inside. Set from the bar and with the tool, drawn in pictures, kept in
// scene.json, and what the pointer finds on a cut part.
//
// The window is hidden. Pictures come from window.__tornoTest.look and are
// read pixel by pixel in the page; the pointer is aimed with .project.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

// The bracket: a base 40 × 30 × 5 around the origin and a post Ø8 on it, from z = 2.5 to 22.5.
const HALF_POST = 12.5
// The cut face of the post: its colour (the second of the palette: the parts are base and post), a step darker.
const POST_CUT = [0xab, 0x7a, 0x5f]
const SURFACE = [0xf1, 0xef, 0xea]

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

function copyFixtures(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-section-'))
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
const section = async (p: Page = page): Promise<SectionPlane | null> => (await state(p)).section
const bar = (p: Page = page) => p.locator('.sectionbar')
const offset = (p: Page = page) => bar(p).getByRole('textbox', { name: 'Plane position in millimetres' })
const readout = (p: Page = page) => p.locator('.pick-readout')
const sceneFile = (object = 'bracket') => join(root, object, '.torno', 'scene.json')
const saved = (object = 'bracket'): { section?: SectionPlane } => (existsSync(sceneFile(object)) ? JSON.parse(readFileSync(sceneFile(object), 'utf8')) : {})

async function open(name: string, p: Page = page): Promise<void> {
  await openListed(p, name)
  await expect.poll(async () => ((await state(p)).objectId === name ? (await state(p)).build?.status : null), { timeout: 90_000 }).toBe('ok')
  await expect.poll(async () => (await state(p)).scene !== null).toBe(true)
}

/** Puts the plane across an axis at an offset from the middle of the parts, through the bar. */
async function cutAt(axis: 'X' | 'Y' | 'Z', mm: number, p: Page = page): Promise<void> {
  await bar(p).getByRole('button', { name: `Cut across ${axis}` }).click()
  await offset(p).fill(String(mm + (axis === 'Z' ? 10 : 0)))
  await offset(p).press('Enter')
  // Out of the field: the keys are the view's again.
  await offset(p).blur()
}

interface Sampled {
  caption: string
  /** The colour at each place asked for: fractions of the picture's width and height, from its top left. */
  at: number[][]
  base64: string
}

/** A picture through the renderer's look, and the colours at some places of it. */
function look(req: LookRequest, places: Array<[number, number]>, p: Page = page): Promise<Sampled> {
  return p.evaluate(
    async ([request, where]) => {
      const result = await window.__tornoTest!.look(request)
      const bitmap = await createImageBitmap(new Blob([result.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const at = where.map(([fx, fy]) => [...ctx.getImageData(Math.round(fx * bitmap.width), Math.round(fy * bitmap.height), 1, 1).data.slice(0, 3)])
      let binary = ''
      for (let i = 0; i < result.png.length; i += 0x8000) binary += String.fromCharCode(...result.png.subarray(i, i + 0x8000))
      return { caption: result.caption, at, base64: btoa(binary) }
    },
    [req, places] as const
  )
}

/** Whether two colours are the same to the eye: within a few levels on every channel. */
const near = (a: number[], b: number[], within = 4): boolean => a.every((v, i) => Math.abs(v - b[i]) <= within)

// A picture from the top is fitted to the parts, whose middle is the origin: the post is at its centre, and
// the picture is 33 mm high, so a quarter of its height below the centre is on the base, 8 mm from the post's axis.
const CENTRE: [number, number] = [0.5, 0.5]
const ON_BASE: [number, number] = [0.5, 0.75]

/** Goes to the view from the corner and waits until the camera has stopped there: what is aimed at is where it is drawn. */
async function fromTheCorner(p: Page = page): Promise<number[]> {
  await p.keyboard.press('1')
  const at = async (): Promise<number[]> => (await camera(p)).position.map((c) => Math.round(c * 100))
  let was = await at()
  await expect
    .poll(async () => {
      await p.waitForTimeout(120)
      const now = await at()
      const still = now.every((c, i) => c === was[i])
      was = now
      return still
    })
    .toBe(true)
  return was
}

function pickOver(point: Vec3, p: Page = page): Promise<Hit | null> {
  return p.evaluate((at) => {
    const [fx, fy] = window.__tornoTest!.project(at)
    return window.__tornoTest!.pickAt(fx, fy, { edges: false })
  }, point)
}

async function pageXY(point: Vec3, p: Page = page): Promise<[number, number]> {
  const [fx, fy] = await p.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await p.locator('.viewport-canvas canvas').first().boundingBox())!
  return [box.x + fx * box.width, box.y + fy * box.height]
}

function mainView(objectId: string): Promise<ViewState | undefined> {
  return app.evaluate((_electron, id) => {
    return (globalThis as unknown as { __tornoMain: { latestView(id: string): ViewState | undefined } }).__tornoMain.latestView(id)
  }, objectId)
}

test('the bar comes with the tool, and a plane across Z through the middle of the parts with its button', async () => {
  await open('bracket')
  await expect(bar()).toHaveCount(0)
  await page.keyboard.press('x')
  await expect(page.locator('.tool-button[data-tool="section"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(bar()).toBeVisible()
  // The tool taken in hand with nothing cut cuts at once (final fix wave): across the axis looked most along, open towards the viewer.
  const first = (await section())!
  expect(first).not.toBeNull()
  expect(first.normal.filter((c) => Math.abs(c) === 1)).toHaveLength(1)
  await expect(offset()).toBeEnabled()
  // "Off" leaves the tool in hand with nothing cut, as it was before that.
  await bar().getByRole('button', { name: 'Off' }).click()
  await expect(offset()).toBeDisabled()
  expect(await section()).toBeNull()

  await bar().getByRole('button', { name: 'Cut across Z' }).click()
  expect(await section()).toEqual({ origin: [0, 0, 10], normal: [0, 0, 1] })
  await expect(bar().getByRole('button', { name: 'Cut across Z' })).toHaveAttribute('aria-pressed', 'true')
  await expect(offset()).toHaveValue('10')
})

test('a picture from the top shows the post cut at half its height, in its own colour a step darker, and the base whole', async () => {
  const whole = await look({ view: 'top', marks: false }, [CENTRE, ON_BASE])
  expect(whole.caption).toContain('cut at z = 10')

  await cutAt('Z', HALF_POST - 10)
  expect(await section()).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })
  await expect(offset()).toHaveValue('12.5')

  const cut = await look({ view: 'top', marks: false }, [CENTRE, ON_BASE])
  expect(cut.caption).toBe('view top · layout assembly · parts base, post · cut at z = 12.5, +Z side removed · orthographic · 1280×960')
  // The cut face is unlit, whatever the light: the post's colour a step darker, with a fine hatch the sample does not meet.
  expect(near(cut.at[0], POST_CUT), `the cut face is ${cut.at[0]}`).toBe(true)
  // The base is below the plane, and is drawn as it is without one.
  const uncut = await look({ view: 'top', marks: false, section: null }, [CENTRE, ON_BASE])
  expect(uncut.caption).toBe('view top · layout assembly · parts base, post · orthographic · 1280×960')
  expect(near(cut.at[1], uncut.at[1], 1)).toBe(true)
  expect(near(uncut.at[1], SURFACE, 30)).toBe(false)
  // Without the cut, the middle of the picture is the lit top of the post: no cut face.
  expect(near(uncut.at[0], POST_CUT)).toBe(false)
  expect(near(uncut.at[0], SURFACE, 30)).toBe(false)
  // What is on screen is as it was: a picture cuts for itself.
  expect(await section()).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })
})

test('a picture can be cut by a plane of its own, which is not the one on screen', async () => {
  // Across X through the middle of the post, seen from the right: the post's cut face, and the base's below it.
  const own = await look({ view: 'right', marks: false, section: { origin: [0, 0, 0], normal: [2, 0, 0] } }, [[0.5, 0.3]])
  expect(own.caption).toContain('cut at x = 0, +X side removed')
  expect(near(own.at[0], POST_CUT), `the cut face is ${own.at[0]}`).toBe(true)
  expect(await section()).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })

  const refused = await page.evaluate(() => window.__tornoTest!.look({ section: { origin: [0, 0, 0], normal: [0, 0, 0] } }).then(() => null, (e: Error) => e.message))
  expect(refused).toBe('section is not a plane: give origin and normal as three numbers each, the normal not all zeros')
})

test('flipping shows the other half', async () => {
  await bar().getByRole('button', { name: 'Flip' }).click()
  expect(await section()).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, -1] })
  await expect(offset()).toHaveValue('12.5')

  // From the top, the upper half of the post is whole and the base is gone: where it was is the ground.
  const top = await look({ view: 'top', marks: false }, [CENTRE, ON_BASE])
  expect(near(top.at[0], POST_CUT)).toBe(false)
  expect(near(top.at[0], SURFACE, 30)).toBe(false)
  expect(near(top.at[1], SURFACE, 30)).toBe(true)
  // From below, the cut face of the post.
  const bottom = await look({ view: 'bottom', marks: false, parts: ['post'] }, [CENTRE])
  expect(near(bottom.at[0], POST_CUT), `the cut face is ${bottom.at[0]}`).toBe(true)

  await bar().getByRole('button', { name: 'Flip' }).click()
  expect(await section()).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })
})

test('the pointer finds nothing on the cut face and says what it is; what was taken away cannot be picked', async () => {
  await page.keyboard.press('v')
  const onCut: Vec3 = [0, 0, HALF_POST]
  expect(await pickOver(onCut)).toBeNull()
  // The top of the post is gone: what is under the pointer there is not it.
  const above = await pickOver([0, 0, 22.5])
  expect(above === null || above.point[2] <= HALF_POST + 1e-3, JSON.stringify(above)).toBe(true)
  // The side of the post below the plane is there as ever.
  expect(await pickOver([0, -4, 8])).toMatchObject({ part: 'post', kind: 'face' })

  const [x, y] = await pageXY(onCut)
  await page.mouse.move(x, y)
  await expect(readout()).toHaveText(/that is the cut face/i)
  await page.mouse.down()
  await page.mouse.up()
  expect((await state()).selection).toEqual([])
  await expect(readout()).toHaveText(/that is the cut face/i)
  // Beside the parts there is nothing, and nothing is said.
  const [besideX, besideY] = await pageXY([0, 0, 45])
  await page.mouse.move(besideX, besideY)
  await expect(readout()).toBeHidden()
  // The bar stays with another tool in hand.
  await expect(bar()).toBeVisible()
})

test('the section is told to main with the view, and kept in scene.json', async () => {
  await expect.poll(async () => (await mainView('bracket'))?.section, { timeout: 5_000 }).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })
  await expect.poll(() => saved().section, { timeout: 5_000 }).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })
})

test('a drag from the handle moves the plane along its normal; a drag from anywhere else turns the camera; the arrow keys nudge it', async () => {
  await page.keyboard.press('x')
  const canvas = page.locator('.viewport-canvas canvas').first()
  // The handle stands on the plane at the middle of the parts, on the post's axis: the cursor says it can be taken hold of there.
  const [x, y] = await pageXY([0, 0, HALF_POST])
  await page.mouse.move(x, y - 10)
  await expect.poll(() => canvas.evaluate((el: HTMLElement) => el.style.cursor)).toBe('ns-resize')
  // To where z = 18 is drawn on the post's axis.
  const [, toY] = await pageXY([0, 0, 18])
  await page.mouse.down()
  await page.mouse.move(x, (y - 10 + toY - 10) / 2)
  // Nothing is kept while the plane moves.
  expect(await section()).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })
  await expect(readout()).toHaveText(/mm$/)
  // The bar's number follows the drag, as the readout at the pointer does: the plane as it is drawn, not as kept.
  const midway = (await readout().textContent())!.replace(/ mm$/, '')
  expect(Number(midway)).toBeGreaterThan(11)
  await expect(offset()).toHaveValue(midway)
  await page.mouse.move(x, toY - 10)
  await page.mouse.up()
  const dragged = (await section())!
  expect(dragged.normal).toEqual([0, 0, 1])
  expect(dragged.origin[2]).toBeGreaterThan(17)
  expect(dragged.origin[2]).toBeLessThan(19)
  // Kept to the millionth of a millimetre, whatever the pointer made of it.
  expect(Math.abs(dragged.origin[2] * 1e6 - Math.round(dragged.origin[2] * 1e6))).toBeLessThan(1e-6)

  // Escape in the middle of a drag puts the plane back.
  const kept = await offset().inputValue()
  const [hx, hy] = await pageXY(dragged.origin)
  await page.mouse.move(hx, hy - 10)
  await page.mouse.down()
  await page.mouse.move(hx, hy - 60)
  await expect(offset()).toHaveValue((await readout().textContent())!.replace(/ mm$/, ''))
  expect(await offset().inputValue()).not.toBe(kept)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await section()).toEqual(dragged)
  // Put back, the number is the plane's again.
  await expect(offset()).toHaveValue(kept)
  await expect(page.locator('.tool-button[data-tool="section"]')).toHaveAttribute('aria-pressed', 'true')

  // Away from the handle the pointer turns the camera, as with any tool: the plane stays.
  const before = await camera()
  // A place of the view with nothing on it, off the plane's handle: a third in from the left, a third down. (The corner of the
  // base the test used before is under the bar at the foot of a view that is this narrow.)
  const box = (await canvas.boundingBox())!
  const [bx, by] = [box.x + box.width * 0.3, box.y + box.height * 0.33]
  await page.mouse.move(bx, by)
  expect(await canvas.evaluate((el: HTMLElement) => el.style.cursor)).toBe('')
  await page.mouse.down()
  await page.mouse.move(bx + 40, by + 10)
  await page.mouse.move(bx + 80, by + 25)
  await page.mouse.up()
  expect(await section()).toEqual(dragged)
  expect((await camera()).position).not.toEqual(before.position)
  await page.keyboard.press('1')

  await cutAt('Z', 2.5)
  await page.locator('.viewport-canvas').click({ position: { x: 5, y: 5 } }) // out of the field
  await page.keyboard.press('ArrowUp')
  expect((await section())!.origin[2]).toBe(13.5)
  await page.keyboard.press('Shift+ArrowDown')
  expect((await section())!.origin[2]).toBe(13.4)
  await expect(offset()).toHaveValue('13.4')
  // Up and down again leaves no trace of the sum: the number is the number.
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowUp')
  expect((await section())!.origin[2]).toBe(13.4)

  // Across X, seen from the corner, the arrow points aslant on screen, and so does the cursor over it: the drag
  // goes that way, not up and down.
  await bar().getByRole('button', { name: 'Cut across X' }).click()
  const across = (await section())!
  const [fx, fy] = await pageXY(across.origin)
  const [tx, ty] = await pageXY([across.origin[0] + across.normal[0] * 5, across.origin[1], across.origin[2]])
  expect(Math.abs(tx - fx)).toBeGreaterThan(Math.abs(ty - fy) / 3)
  await page.mouse.move(fx + (tx - fx) * 0.3, fy + (ty - fy) * 0.3)
  await expect.poll(() => canvas.evaluate((el: HTMLElement) => el.style.cursor)).toMatch(/^(nwse|nesw|ew)-resize$/)
})

test('a handle drag let go over the bar, off the canvas, is kept all the same, and the camera is the pointer\'s again', async () => {
  await cutAt('Z', HALF_POST - 10)
  await page.keyboard.press('x')
  const home = await fromTheCorner()
  const [x, y] = await pageXY([0, 0, HALF_POST])
  const over = await stableBox(bar().getByRole('button', { name: 'Flip' }))
  const [toX, toY] = [over.x + over.width / 2, over.y + over.height / 2]
  expect(toY).toBeGreaterThan(y + 100)
  await page.mouse.move(x, y - 10)
  await page.mouse.down()
  await page.mouse.move(x, y + 40)
  await page.mouse.move((x + toX) / 2, (y + toY) / 2)
  // Over the bar, which lies on the viewport: the plane still follows, in the view only.
  await page.mouse.move(toX, toY)
  expect(await section()).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })
  await page.mouse.up()
  // Kept where the drag had it, the moment it was let go: no button of the bar was pressed by that.
  const dragged = (await section())!
  expect(dragged.normal).toEqual([0, 0, 1])
  expect(dragged.origin[2]).toBeLessThan(HALF_POST - 2)
  await expect.poll(async () => (await mainView('bracket'))?.section).toEqual(dragged)
  // Back over the canvas with no button held, nothing more happens to it.
  await page.mouse.move(x + 150, y)
  expect(await section()).toEqual(dragged)
  // And a drag there turns the camera.
  const before = await camera()
  await page.mouse.down()
  await page.mouse.move(x + 190, y + 10)
  await page.mouse.move(x + 230, y + 25)
  await page.mouse.up()
  expect((await camera()).position).not.toEqual(before.position)
  expect(await section()).toEqual(dragged)
  // Back to the view from the corner, and at rest there.
  expect(await fromTheCorner()).toEqual(home)

  // Changed from the bar in the middle of a drag, the section is what the bar made it: the drag is dropped.
  const [hx, hy] = await pageXY(dragged.origin)
  await page.mouse.move(hx, hy - 10)
  await page.mouse.down()
  await page.mouse.move(hx, hy - 60)
  await page.evaluate(() => (document.querySelector('.sectionbar button[title="Show the parts whole again"]') as HTMLElement).click())
  expect(await section()).toBeNull()
  await page.mouse.move(hx, hy - 80)
  await page.mouse.up()
  await page.mouse.move(hx + 100, hy)
  expect(await section()).toBeNull()
  // The dropped drag turned nothing either.
  expect((await camera()).position.map((c) => Math.round(c * 100))).toEqual(home)
  await cutAt('Z', 3.4)
})

test('the slider moves the plane across the parts, and keeps it when it is let go', async () => {
  const slider = bar().getByRole('slider', { name: 'Offset along the normal' })
  expect(await slider.evaluate((el: HTMLInputElement) => [Number(el.min), Number(el.max)])).toEqual([-12.5, 12.5])
  await slider.focus()
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '-6'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // Moved in the view and in the number beside it, not kept yet.
  await expect(offset()).toHaveValue('4')
  expect((await section())!.origin[2]).toBe(13.4)
  await slider.evaluate((el: HTMLInputElement) => el.dispatchEvent(new Event('change', { bubbles: true })))
  expect(await section()).toEqual({ origin: [0, 0, 4], normal: [0, 0, 1] })
  // With the slider in focus the arrows are a millimetre, and a tenth with Shift, as everywhere.
  await page.keyboard.press('ArrowRight')
  expect(await section()).toEqual({ origin: [0, 0, 5], normal: [0, 0, 1] })
  await page.keyboard.press('Shift+ArrowLeft')
  expect(await section()).toEqual({ origin: [0, 0, 4.9], normal: [0, 0, 1] })
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(offset()).toHaveValue('4.8')
  // The slider is no field to type in: with it still in focus, as after a drag, the keys of the tools are the tools'.
  await slider.focus()
  const inHand = (name: string) => page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })
  await page.keyboard.press('m')
  await expect(inHand('Measure')).toHaveAttribute('aria-pressed', 'true')
  await slider.focus()
  await page.keyboard.press('x')
  await expect(inHand('Section')).toHaveAttribute('aria-pressed', 'true')
  await cutAt('Z', -6)
})

test('a part the plane only touches is not drawn at all: no sheet of the post on the base it stands on', async () => {
  // On the top of the base, where the post begins.
  await cutAt('Z', 2.5 - 10)
  expect(await section()).toEqual({ origin: [0, 0, 2.5], normal: [0, 0, 1] })
  const touching = await look({ view: 'top', marks: false }, [CENTRE, ON_BASE])
  const baseAlone = await look({ view: 'top', marks: false, section: null, parts: ['base'] }, [CENTRE, ON_BASE])
  // Under where the post stood, the top of the base in the base's own colour, as lit as beside it.
  expect(near(touching.at[0], baseAlone.at[0], 1), `where the post stood is ${touching.at[0]}, the base alone ${baseAlone.at[0]}`).toBe(true)
  expect(near(touching.at[0], touching.at[1], 2)).toBe(true)
  expect(near(touching.at[0], POST_CUT, 12)).toBe(false)
  // And it is the base that is pointed at there, not a cut face.
  await page.keyboard.press('v')
  expect(await pickOver([0, 0, 2.5])).toMatchObject({ part: 'base', kind: 'face' })
  const [x, y] = await pageXY([0, 0, 2.5])
  await page.mouse.move(x, y)
  await expect(readout().locator('.pick-readout-ref')).toHaveText(/^base\/F/)
  await page.keyboard.press('x')

  // Flipped there, it is the base that is gone whole and the post that stands whole.
  await bar().getByRole('button', { name: 'Flip' }).click()
  const flipped = await look({ view: 'bottom', marks: false }, [CENTRE, [0.5, 0.75]])
  const postAlone = await look({ view: 'bottom', marks: false, section: null, parts: ['post'] }, [CENTRE, [0.5, 0.75]])
  expect(near(flipped.at[0], postAlone.at[0], 1)).toBe(true)
  expect(near(flipped.at[1], SURFACE, 30)).toBe(true)
  await bar().getByRole('button', { name: 'Flip' }).click()
})

test('a plane that leaves nothing of the parts says so, with a way back to the middle', async () => {
  const note = bar().getByRole('status')
  await expect(note).toHaveCount(0)
  // It goes by the parts that are switched on. On the top of the base, the base taken away: the post is left to see.
  await cutAt('Z', 2.5 - 10)
  await bar().getByRole('button', { name: 'Flip' }).click()
  await expect(note).toHaveCount(0)
  // With the post switched off there is nothing.
  await openPanel(page, 'Layers')
  await page.locator('[data-layer="post"]').hover()
  await page.getByRole('button', { name: 'Show post' }).click()
  await expect(note).toHaveText('Everything is on the cut side')
  await page.getByRole('button', { name: 'Show post' }).click()
  await expect(note).toHaveCount(0)
  await bar().getByRole('button', { name: 'Flip' }).click()
  // A plane kept from another layout, or from before the parts shrank: far below everything.
  const show = (request: object): Promise<void> =>
    app.evaluate(({ BrowserWindow }, req) => BrowserWindow.getAllWindows()[0].webContents.send('view:show', { id: 987653, request: req }), request)
  await show({ objectId: 'bracket', section: { origin: [0, 0, -40], normal: [0, 0, 1] } })
  await expect(note).toHaveText('Everything is on the cut side')
  const empty = await look({ view: 'iso', marks: false }, [CENTRE])
  expect(near(empty.at[0], SURFACE, 30)).toBe(true)
  await bar().getByRole('button', { name: 'Middle' }).click()
  expect(await section()).toEqual({ origin: [0, 0, 10], normal: [0, 0, 1] })
  await expect(note).toHaveCount(0)
  await cutAt('Z', -6)
})

test('from face puts the plane on a flat face that is clicked, and refuses a round one', async () => {
  await bar().getByRole('button', { name: 'From face' }).click()
  await expect(bar().getByRole('button', { name: 'From face' })).toHaveAttribute('aria-pressed', 'true')
  // The side of the post is a cylinder.
  let [x, y] = await pageXY([0, -4, 3.5])
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
  await expect(readout()).toHaveText('That face is not flat: the plane needs a flat one')
  expect(await section()).toEqual({ origin: [0, 0, 4], normal: [0, 0, 1] })

  // The side of the base at x = 20, which the view from the corner shows (near its top edge: lower, the bar at the foot of the view is over it).
  ;[x, y] = await pageXY([20, 3, 2])
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(async () => (await section())?.normal).toEqual([1, 0, 0])
  // Where the kernel says the face is: its own point of it, exactly on x = 20.
  expect(await section()).toEqual({ origin: [20, 0, 0], normal: [1, 0, 0] })
  await expect(bar().getByRole('button', { name: 'From face' })).toHaveAttribute('aria-pressed', 'false')
  await expect(offset()).toHaveValue('20')
  // On the face nothing is cut yet: the face is still there to be picked.
  await page.keyboard.press('v')
  expect(await pickOver([20, 3, 0])).toMatchObject({ part: 'base', kind: 'face' })
})

test('the section survives leaving the object and coming back: it is read from scene.json', async () => {
  await page.keyboard.press('x')
  await cutAt('Z', HALF_POST - 10)
  await expect.poll(() => saved().section, { timeout: 5_000 }).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })

  await open('plain')
  expect(await section()).toBeNull()
  await page.keyboard.press('v')
  await expect(bar()).toHaveCount(0)

  await open('bracket')
  expect(await section()).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })
  await expect(bar()).toBeVisible()
  await expect(offset()).toHaveValue('12.5')
  const cut = await look({ view: 'top', marks: false }, [CENTRE])
  expect(near(cut.at[0], POST_CUT), `the cut face is ${cut.at[0]}`).toBe(true)
})

test('the agent\'s show cuts by a plane for now: the scene file goes on saying what the person had', async () => {
  const before = readFileSync(sceneFile(), 'utf8')
  const show = (request: object): Promise<void> =>
    app.evaluate(({ BrowserWindow }, req) => BrowserWindow.getAllWindows()[0].webContents.send('view:show', { id: 987654, request: req }), request)
  await show({ objectId: 'bracket', section: { origin: [5, 0, 0], normal: [1, 0, 0] } })
  await expect.poll(section).toEqual({ origin: [5, 0, 0], normal: [1, 0, 0] })
  await expect(bar().getByRole('button', { name: 'Cut across X' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await mainView('bracket'))?.section).toEqual({ origin: [5, 0, 0], normal: [1, 0, 0] })

  // A change of the person's own is saved, and with it their section, not the agent's.
  await openPanel(page, 'Layers')
  await page.locator('[data-layer="post"]').hover()
  await page.getByRole('button', { name: 'Show post' }).click()
  await expect.poll(() => JSON.parse(readFileSync(sceneFile(), 'utf8')).layers.post, { timeout: 5_000 }).toEqual({ visible: false })
  expect(saved().section).toEqual(JSON.parse(before).section)

  // Taken away by the agent, it is still the person's in the file, whatever else of theirs is saved meanwhile.
  await show({ objectId: 'bracket', section: null })
  await expect.poll(section).toBeNull()
  await page.getByRole('button', { name: 'Show post' }).click()
  await expect.poll(() => JSON.parse(readFileSync(sceneFile(), 'utf8')).layers.post, { timeout: 5_000 }).toEqual({ visible: true })
  expect(saved().section).toEqual({ origin: [0, 0, HALF_POST], normal: [0, 0, 1] })
})

test('a mark on what the plane took away stays, drawn dimmed: it no longer shows what it is on', async () => {
  await page.keyboard.press('x')
  await cutAt('Z', HALF_POST - 10)
  // A pin on the top of the post, 10 mm above the plane.
  const pin = await page.evaluate(() =>
    window.torno.marks.add('bracket', { kind: 'pin', author: 'user', note: '', layout: 'assembly', revision: window.__tornoTest!.state().revision, camera: window.__tornoTest!.camera(), anchor: { point: [0, 0, 22.5], normal: [0, 0, 1], part: 'post', ref: 'post/F1' } } as never)
  )
  // From the front the picture is 33 mm high around z = 10: the pin's dot is 12.5 mm above its middle.
  // Two pixels higher, in the half of the dot that stands clear of the post.
  const dot: [number, number] = [0.5, 0.5 - 12.5 / 33 - 2 / 960]
  const RED = [0xcf, 0x3f, 0x2c]
  const whole = await look({ view: 'front', section: null }, [dot])
  expect(near(whole.at[0], RED, 12), `the pin on the whole post is ${whole.at[0]}`).toBe(true)
  const cut = await look({ view: 'front' }, [dot])
  // Still there, over the empty ground, at about a third of its colour.
  expect(near(cut.at[0], RED, 40), `the pin over the cut is ${cut.at[0]}`).toBe(false)
  expect(near(cut.at[0], SURFACE, 12)).toBe(false)
  expect(cut.at[0][0]).toBeGreaterThan(cut.at[0][2] + 15) // reddish
  await page.evaluate((id) => window.torno.marks.remove('bracket', id), (pin as { id: string }).id)
})

test('off shows the parts whole again, and the file has no section', async () => {
  await page.keyboard.press('x')
  await cutAt('Z', HALF_POST - 10)
  await bar().getByRole('button', { name: 'Off' }).click()
  expect(await section()).toBeNull()
  expect(await pickOver([0, 0, 22.5])).toMatchObject({ part: 'post', kind: 'face' })
  await expect.poll(() => 'section' in saved(), { timeout: 5_000 }).toBe(false)
  const whole = await look({ view: 'top', marks: false }, [CENTRE])
  expect(whole.caption).not.toContain('cut')
  // With the tool put down too, the bar goes.
  await page.keyboard.press('Escape')
  await expect(bar()).toHaveCount(0)
})

test('a hollow part is closed where it is cut, each part in its own colour, and the hollow stays open', async () => {
  await open('hollow')
  await page.keyboard.press('x')
  // Across Y through the middle: a new cut opens towards the viewer, so the half towards the front is the one taken away.
  await cutAt('Y', 0)
  expect(await section()).toEqual({ origin: [0, 0, 20], normal: [0, -1, 0] })

  // From the front, 40 × 40 fitted to the picture's height: the lid's cut is the top 2 mm, the tub's wall the
  // outer 2 mm and its floor the bottom 2 mm, the post Ø6 stands in the middle of the floor, the rest is hollow.
  const places: Array<[number, number]> = [
    [0.5, 0.5 - (39 - 20) / 44], // the lid
    [0.5 - (19 / 44) * 0.75, 0.5], // the tub's left wall
    [0.5, 0.5 + (19 - 0) / 44], // the floor: z = 1
    [0.5, 0.5 + 0.2], // the post, at z = 11.2
    [0.5 - (10 / 44) * 0.75, 0.5 - 0.2] // the hollow: the inside of the far wall, lit
  ]
  const cut = await look({ view: 'front', marks: false }, places)
  expect(cut.caption).toContain('cut at y = 0, -Y side removed')
  const [lid, wall, floor, post, hollow] = cut.at
  // Sorted by name the lid is the first of the palette and the tub the second: their cut faces are those, a step darker.
  const LID_CUT = [0x6c, 0x82, 0x9f]
  expect(near(lid, LID_CUT), `the lid's cut face is ${lid}`).toBe(true)
  expect(near(wall, POST_CUT), `the wall's cut face is ${wall}`).toBe(true)
  expect(near(floor, POST_CUT), `the floor's cut face is ${floor}`).toBe(true)
  expect(near(post, POST_CUT), `the post's cut face is ${post}`).toBe(true)
  // The hollow is not closed: what is seen there is the far wall, lit, not a cut face and not the ground.
  expect(near(hollow, POST_CUT)).toBe(false)
  expect(near(hollow, LID_CUT)).toBe(false)
  expect(near(hollow, SURFACE, 30)).toBe(false)

  // The inside of the far wall can be pointed at through the cut; the cut wall cannot.
  await page.keyboard.press('v')
  await page.keyboard.press('2') // the front view
  await expect.poll(async () => (await pickOver([-10, 18, 28]))?.part, { timeout: 5_000 }).toBe('tub')
  expect((await pickOver([-10, 18, 28]))!.point[1]).toBeCloseTo(18, 3)
  expect(await pickOver([-19, 0, 20])).toBeNull()
})

test('a section costs a frame little', async () => {
  await page.keyboard.press('1')
  const cut = await page.evaluate(() => window.__tornoTest!.timeFrames(30))
  await bar().getByRole('button', { name: 'Off' }).click()
  const whole = await page.evaluate(() => window.__tornoTest!.timeFrames(30))
  test.info().annotations.push({ type: 'frame', description: `hollow: ${whole.meanMs.toFixed(2)} ms whole, ${cut.meanMs.toFixed(2)} ms cut (worst ${cut.worstMs.toFixed(2)})` })
  console.log(`frame, hollow: ${whole.meanMs.toFixed(2)} ms whole, ${cut.meanMs.toFixed(2)} ms cut (worst ${cut.worstMs.toFixed(2)} ms)`)

  await open('measures')
  await page.keyboard.press('x')
  await cutAt('Y', 0)
  const plate = await page.evaluate(() => window.__tornoTest!.timeFrames(30))
  console.log(`frame, measures cut: ${plate.meanMs.toFixed(2)} ms (worst ${plate.worstMs.toFixed(2)} ms)`)
  // Far inside a frame at 60 Hz, on parts this small.
  expect(cut.meanMs).toBeLessThan(16)
  expect(plate.meanMs).toBeLessThan(16)
  await bar().getByRole('button', { name: 'Off' }).click()
})

// Set TORNO_SHOTS=<dir> to write the design shots there: the bracket cut across
// Z through the post (section-light.png, section-dark.png), the hollow box cut
// through its cavity (section-hollow-light.png), and a picture as the agent
// gets it (section-look.png). Each capture of the window needs its own launch.
for (const shot of [
  { file: 'section-light', scheme: 'light', object: 'bracket' },
  { file: 'section-dark', scheme: 'dark', object: 'bracket' },
  { file: 'section-hollow-light', scheme: 'light', object: 'hollow' },
  { file: 'section-hollow-dark', scheme: 'dark', object: 'hollow' }
] as const) {
  test(`screenshot of a section, ${shot.file}`, async () => {
    const dir = process.env.TORNO_SHOTS
    test.skip(!dir, 'TORNO_SHOTS is not set')
    test.setTimeout(120_000)
    mkdirSync(dir!, { recursive: true })
    const shotRoot = copyFixtures()
    const shotApp = await launch({ TORNO_WORKSPACE: shotRoot })
    try {
      const shotPage = await shotApp.firstWindow()
      await shotPage.emulateMedia({ colorScheme: shot.scheme })
      await open(shot.object, shotPage)
      await shotPage.keyboard.press('x')
      if (shot.object === 'bracket') await cutAt('Z', HALF_POST - 10, shotPage)
      else {
        await cutAt('Y', 0, shotPage)
        await bar(shotPage).getByRole('button', { name: 'Flip' }).click()
      }
      await shotPage.locator('.viewport-canvas').click({ position: { x: 5, y: 5 } })
      if (shot.file === 'section-hollow-light') {
        const picture = await look({ view: 'iso' }, [], shotPage)
        writeFileSync(join(dir!, 'section-look.png'), Buffer.from(picture.base64, 'base64'))
      }
      await shotPage.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      const png = await shotApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
        return image.toPNG().toString('base64')
      })
      writeFileSync(join(dir!, `${shot.file}.png`), Buffer.from(png, 'base64'))
    } finally {
      await shotApp.close()
      rmSync(shotRoot, { recursive: true, force: true })
    }
  })
}

test('the bar stays clear of the triad bottom left and the scale bottom right, in a wide view and in a narrow one, raised or not', async () => {
  test.setTimeout(180_000)
  await open('bracket')
  if ((await section()) === null) {
    if ((await page.locator('.tool-button[data-tool="section"]').getAttribute('aria-pressed')) !== 'true') await page.keyboard.press('x')
    await bar().getByRole('button', { name: 'Cut across Z' }).click()
  }
  expect(await section()).not.toBeNull()
  await expect(bar()).toBeVisible()
  const was = await page.evaluate(() => [window.innerWidth, window.innerHeight])
  const widths: number[] = []
  try {
    for (const [selected, tool] of [[false, 'section'], [false, 'measure'], [true, 'section'], [true, 'measure']] as const) {
      if (selected && (await state()).selection.length === 0) {
        // A face of the post below the plane: the selection's bar takes the bottom row, and the section's stands a row up.
        await page.locator('.tool-button[data-tool="select"]').click()
        const [x, y] = await pageXY([0, -4, 8])
        await page.mouse.click(x, y)
        await expect.poll(async () => (await state()).selection.length).toBe(1)
      }
      if (selected) await expect(bar()).toHaveAttribute('data-raised', '1')
      else await expect(bar()).not.toHaveAttribute('data-raised')
      // The strip of the Measure tool is in the corner too: with it in hand the bar, which stays while a plane is cut, must clear it as well.
      const hand = page.locator(`.tool-button[data-tool="${tool}"]`)
      if ((await hand.getAttribute('aria-pressed')) !== 'true') await hand.click()
      await expect(hand).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.measure-choice')).toHaveCount(tool === 'measure' ? 1 : 0)
      // The window narrows the view with it: the pane is the window less the left column and the dock.
      // 1280 by 800 is a short window with the dock open: the palette, centred on the left, reaches low.
      for (const [width, height] of [[1100, 900], [1280, 800], [1300, 900], [1440, 900], [1700, 900], [2000, 900], [2600, 900]]) {
        await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height])
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
        // The attribute follows the view's width, set when the observer is told.
        await expect
          .poll(async () => {
            const pane = (await page.locator('.viewport-pane').boundingBox())!
            return (await page.locator('.viewport-pane').getAttribute('data-narrow')) === null === pane.width >= 560 + 2 * BAR_SIDE
          })
          .toBe(true)
        const pane = (await page.locator('.viewport-pane').boundingBox())!
        const box = await stableBox(bar())
        widths.push(Math.round(pane.width))
        const bottom = pane.y + pane.height
        // The corners as the overlay draws them: the triad's reach (its corner, arms and letters) and the scale bar or the grid's step at its longest.
        const triad = { left: pane.x, right: pane.x + Math.ceil((26 + 2 * 38 + 11 + 6) * SCREEN_UNIT), top: bottom - TRIAD_CLEAR }
        const scale = { left: pane.x + pane.width - Math.ceil(26 * SCREEN_UNIT + SCALE_BAR_MAX), right: pane.x + pane.width, top: bottom - Math.ceil(26 * SCREEN_UNIT + 20) }
        const meets = (corner: { left: number; right: number; top: number }): boolean => box.x < corner.right && box.x + box.width > corner.left && box.y + box.height > corner.top && box.y < bottom
        expect([width, 'triad', meets(triad)]).toEqual([width, 'triad', false])
        expect([width, 'scale', meets(scale)]).toEqual([width, 'scale', false])
        // Nor does it reach the palette of tools on the left, however high it is raised.
        const palette = (await page.getByRole('toolbar', { name: 'Tools' }).boundingBox())!
        const besides = box.x >= palette.x + palette.width || box.y + box.height <= palette.y || box.y >= palette.y + palette.height
        expect([width, height, selected, tool, 'palette', besides]).toEqual([width, height, selected, tool, 'palette', true])
        // In the room that leaves, all of it is there, nothing running past its edge: in a view as wide as the bar's least (about 490px,
        // in the wide mono) and its two sides (60px each) and wider. A narrower one has it run over: at 1280 by 800 the view is 580px
        // now, and the bar is 29px short of it. The bars at the foot of the view go with the tags and the hint (spec section 3).
        if (pane.width >= 490 + 2 * 60) {
          const fits = await bar().evaluate((el) => [...el.children].every((child) => child.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5))
          expect([width, height, 'bar whole', fits]).toEqual([width, height, 'bar whole', true])
        }
        if (tool === 'measure') {
          const strip = (await page.locator('.measure-choice').boundingBox())!
          // Above the triad, and not under the bar: one of them is wholly above the other.
          expect([width, 'strip over the triad', strip.y + strip.height <= triad.top]).toEqual([width, 'strip over the triad', true])
          const apart = (other: { x: number; y: number; width: number; height: number }): boolean =>
            strip.y + strip.height <= other.y || other.y + other.height <= strip.y || strip.x + strip.width <= other.x || other.x + other.width <= strip.x
          expect([width, selected, 'strip clear of the bar', apart(box)]).toEqual([width, selected, 'strip clear of the bar', true])
          if (selected) expect([width, 'strip clear of the selection', apart((await page.getByRole('group', { name: 'Selection' }).boundingBox())!)]).toEqual([width, 'strip clear of the selection', true])
        }
      }
    }
    // The widths cover both the lifted bar and the one between the corners.
    expect(Math.min(...widths)).toBeLessThan(560 + 2 * BAR_SIDE)
    expect(Math.max(...widths)).toBeGreaterThan(560 + 2 * BAR_SIDE)
  } finally {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), was)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(was[0])
    const section = page.locator('.tool-button[data-tool="section"]')
    if ((await section.getAttribute('aria-pressed')) !== 'true') await section.click()
  }
})
