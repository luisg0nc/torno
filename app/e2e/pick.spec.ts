import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inTerminal } from './terminal'
import type { TornoState } from '../src/renderer/state/store'
import { TOOLS } from '../src/renderer/state/tools'
import type { Hit } from '../src/renderer/viewport/picking'
import type { Camera } from '../src/shared/view'
import { openSection, newSession } from './helpers'
import { openListed } from './objects'

// Pointing at the parts: what is under the pointer, selecting it, what the
// kernel says of it, and putting its ref in the agent's prompt.
//
// The window is hidden. Picks are aimed through window.__tornoTest.project and
// read through .pickAt and .state; the few real pointer events are sent with
// page.mouse, which works on a hidden window. The agent is the stand-in.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

function copyFixtures(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-pick-'))
  cpSync(fixtures, dir, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  inTerminal(dir)
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
const termText = (p: Page = page): Promise<string> => p.evaluate(() => window.__tornoTerm!.text())
const readout = (p: Page = page) => p.locator('.pick-readout')
const chips = (p: Page = page) => p.locator('.hand-ref')

/** What is picked where a point of the object frame is drawn. */
function pickOver(point: Vec3, opts?: { edges?: boolean }, p: Page = page): Promise<Hit | null> {
  return p.evaluate(([at, o]) => {
    const [fx, fy] = window.__tornoTest!.project(at)
    return window.__tornoTest!.pickAt(fx, fy, o)
  }, [point, opts] as const)
}

/** Where a point of the object frame is drawn, in the page's pixels. */
async function pageXY(point: Vec3, p: Page = page): Promise<[number, number]> {
  const [fx, fy] = await p.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await p.locator('.viewport-canvas canvas').first().boundingBox())!
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

/** Open the bracket and look at it from above. Its base is 40 × 30 × 5 about the origin; its post stands on the middle, to z = 22.5. */
async function openFromAbove(p: Page = page): Promise<void> {
  await openListed(p, 'bracket')
  await expect.poll(async () => (await state(p)).build?.status, { timeout: 20_000 }).toBe('ok')
  await p.getByRole('button', { name: 'Top view, 4', exact: true }).click()
  await expect
    .poll(async () => {
      const c = await camera(p)
      return Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1]) < 0.01 * Math.abs(c.position[2] - c.target[2])
    })
    .toBe(true)
}

const ON_BASE: Vec3 = [14, 9, 2.5] // on the top of the base, clear of the post
const ON_POST: Vec3 = [0, 0, 22.5] // the middle of the top of the post, and above the middle of the base
const model = () => join(root, 'bracket', 'bracket.py')

test('the palette shows the tools, each with its key', async () => {
  await openFromAbove()
  const tools = page.getByRole('toolbar', { name: 'Tools' }).locator('button[data-tool]')
  // One button for every tool there is; the sheet of keys is at the foot of the rail.
  await expect(tools).toHaveCount(TOOLS.length)
  await expect(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button')).toHaveCount(TOOLS.length)
  // The key is on no button: it is in its own words for a reader of the screen, in the tip beside it (e2e/tools.spec.ts) and in the name of the tool in hand.
  await expect(page.getByRole('button', { name: 'Section', exact: true })).toHaveAttribute('aria-keyshortcuts', 'X')
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-keyshortcuts', 'V')
  await expect(page.getByRole('button', { name: 'Select', exact: true }).locator('.tool-key')).toHaveCount(0)
  for (const name of ['Pin', 'Arrow', 'Draw', 'Shape', 'Section']) await expect(page.getByRole('button', { name, exact: true })).toBeEnabled()
  await page.keyboard.press('s')
  await expect(page.getByRole('button', { name: 'Shape', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('v')
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('a pick names the face under the point, in the object frame', async () => {
  const base = (await pickOver(ON_BASE))!
  expect(base).toMatchObject({ partKey: 'assembly:base', part: 'base', kind: 'face' })
  expect(base.ref).toMatch(/^base\/F\d+$/)
  expect(base.ref).toBe(`base/F${base.index}`)
  for (const [i, c] of [0, 0, 1].entries()) expect(base.normal![i]).toBeCloseTo(c, 5)
  for (const [i, c] of ON_BASE.entries()) expect(base.point[i]).toBeCloseTo(c, 2)

  // Above the middle of the base stands the post: its top is what is hit there.
  const post = (await pickOver(ON_POST))!
  expect(post).toMatchObject({ part: 'post', kind: 'face' })
  expect(post.normal![2]).toBeCloseTo(1, 5)
  expect(post.point[2]).toBeCloseTo(22.5, 2)

  // The face is the one the kernel means by that ref.
  const said = await page.evaluate((ref) => window.torno.geometry.describe('bracket', 'assembly', ref), base.ref)
  expect(said).toMatchObject({ kind: 'face', ref: `assembly:${base.ref}`, type: 'plane' })
  expect(said.descriptor).toBe('plane, normal +Z, z = 2.5, 1200 mm²')
})

test('an edge within reach wins over the face under it, unless only faces are asked for', async () => {
  // The long edge of the top of the base at x = 20; 0.3 mm inside it is a few pixels at most.
  const edge = (await pickOver([19.7, 9, 2.5]))!
  expect(edge).toMatchObject({ part: 'base', kind: 'edge', normal: null })
  expect(edge.ref).toBe(`base/E${edge.index}`)
  expect(edge.point[0]).toBeCloseTo(20, 2)
  expect(edge.point[2]).toBeCloseTo(2.5, 2)
  const said = await page.evaluate((ref) => window.torno.geometry.describe('bracket', 'assembly', ref), edge.ref)
  expect(said).toMatchObject({ kind: 'edge', type: 'line', length: 30 })
  expect(said.descriptor).toBe('line, 30 mm')
  // Four edges of the base are lines of 30 mm. The kernel's is the one that was picked: a straight edge
  // along Y through the point picked, so its middle is that point brought to the middle of the base's
  // width, which is about y = 0.
  if (said.kind !== 'edge') throw new Error('not an edge')
  for (const [i, c] of [edge.point[0], 0, edge.point[2]].entries()) expect(said.center[i]).toBeCloseTo(c, 2)

  expect(await pickOver([19.7, 9, 2.5], { edges: false })).toMatchObject({ part: 'base', kind: 'face' })
  // Nothing beside the parts.
  expect(await page.evaluate(() => window.__tornoTest!.pickAt(0.01, 0.01))).toBeNull()
})

test('a hidden part is never picked; a see-through one is picked like any other', async () => {
  await openSection(page, 'Parts')
  await page.getByRole('button', { name: 'Show post' }).click()
  await expect.poll(async () => (await state()).layers.post?.visible).toBe(false)
  const through = (await pickOver(ON_POST))!
  expect(through).toMatchObject({ part: 'base', kind: 'face' })
  expect(through.point[2]).toBeCloseTo(2.5, 2)
  // Nowhere on the canvas: not its faces, not its edges.
  const parts = await page.evaluate(() => {
    const found = new Set<string>()
    for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) found.add(window.__tornoTest!.pickAt(i / 24, j / 24)?.part ?? 'nothing')
    return [...found].sort()
  })
  expect(parts).toEqual(['base', 'nothing'])

  await openSection(page, 'Parts')

  await page.getByRole('button', { name: 'Show post' }).click()
  await page.getByLabel('Opacity of post').fill('0.2')
  await expect.poll(async () => (await state()).layers.post).toMatchObject({ visible: true, opacity: 0.2 })
  expect(await pickOver(ON_POST)).toMatchObject({ part: 'post', kind: 'face' })
  await page.getByLabel('Opacity of post').fill('1')
})

test('the pointer is told what it is on, and a click selects it', async () => {
  const hit = (await pickOver(ON_BASE))!
  const [x, y] = await pageXY(ON_BASE)
  await page.mouse.move(x, y)
  await expect(readout()).toBeVisible()
  await expect(readout().locator('.pick-readout-ref')).toHaveText(hit.ref)
  // Once the pointer has rested, the kernel's line.
  await expect(readout().locator('.pick-readout-detail')).toHaveText('plane, normal +Z, z = 2.5, 1200 mm²')
  expect((await state()).selection).toEqual([])

  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(async () => (await state()).selection).toEqual([hit.ref])
  await expect(chips()).toHaveCount(1)
  await expect(chips().locator('.hand-ref-name')).toHaveText(hit.ref)
  await expect(chips().locator('.hand-ref-descriptor')).toContainText('plane')
  await expect(chips().locator('.hand-ref-descriptor')).toHaveText('plane, normal +Z, z = 2.5, 1200 mm²')
})

test('Shift adds to the selection, and takes out; Escape and a click on nothing clear it', async () => {
  const base = (await pickOver(ON_BASE))!
  const post = (await pickOver(ON_POST))!
  await clickOver(ON_POST, { shift: true })
  await expect.poll(async () => (await state()).selection).toEqual([base.ref, post.ref])
  await expect(chips().locator('.hand-ref-name')).toHaveText([base.ref, post.ref])
  await expect(chips().nth(1).locator('.hand-ref-descriptor')).toContainText('plane, normal +Z, z = 22.5')
  // The head holds them and says how many. Made taller than the card, it stops at 60 % of the card and scrolls inside itself.
  await expect(page.locator('.hand-said')).toHaveText('2 picked, shift-click adds')
  const cap = await page.evaluate(() => {
    const hand = document.querySelector<HTMLElement>('.route-hand')!
    const tall = document.createElement('div')
    tall.style.height = '4000px'
    hand.querySelector('.hand')!.append(tall)
    const out = { height: hand.getBoundingClientRect().height, card: document.querySelector('.route-card')!.getBoundingClientRect().height, scrolls: hand.scrollHeight > hand.clientHeight }
    tall.remove()
    return out
  })
  expect(cap.height).toBeCloseTo(cap.card * 0.6, 0)
  expect(cap.scrolls).toBe(true)
  await clickOver(ON_POST, { shift: true })
  await expect.poll(async () => (await state()).selection).toEqual([base.ref])

  await page.keyboard.press('Escape')
  await expect.poll(async () => (await state()).selection).toEqual([])
  await expect(page.locator('.hand-ref')).toHaveCount(0)

  await clickOver(ON_POST)
  await expect.poll(async () => (await state()).selection).toEqual([post.ref])
  // Off the parts, in a corner of the canvas.
  const box = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
  await page.mouse.move(box.x + box.width - 12, box.y + box.height - 60)
  await expect(readout()).toBeHidden()
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(async () => (await state()).selection).toEqual([])
})

test('Part takes the whole part, a double click in Any does too, and Note makes a mark of the part', async () => {
  const post = (await pickOver(ON_POST))!
  await expect(page.locator('.hand-ref')).toHaveCount(0)
  // A double click in Any: the part, not the face.
  // Well after the last click of the test before.
  await page.waitForTimeout(600)
  const [x, y] = await pageXY(ON_POST)
  await page.mouse.click(x, y)
  await expect.poll(async () => (await state()).selection).toEqual([post.ref])
  await page.mouse.click(x, y)
  await expect.poll(async () => (await state()).selection).toEqual([post.part])
  await page.keyboard.press('Escape')
  // The choice grown out of Select, asked for with a click on it: Part.
  await page.locator('.tool-button[data-tool="select"]').click()
  await page.getByRole('group', { name: 'What a click selects' }).getByRole('button', { name: 'Part' }).click()
  await clickOver(ON_BASE)
  await expect.poll(async () => (await state()).selection).toEqual([(await pickOver(ON_BASE))!.part])
  await expect(page.locator('.hand-said')).toHaveText('1 picked, shift-click adds')
  const before = (await state()).marks.length
  await page.getByRole('group', { name: 'Selection' }).getByRole('button', { name: 'Note', exact: true }).click()
  await expect.poll(async () => (await state()).marks.length).toBe(before + 1)
  const made = (await state()).marks.at(-1)!
  expect(made).toMatchObject({ kind: 'pick', target: 'part' })
  // As it was for the tests after: the note put away, and Any.
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await state()).noting).toBeNull()
  await page.getByRole('group', { name: 'What a click selects' }).getByRole('button', { name: 'Any' }).click()
  await page.waitForTimeout(500)
})

test('a drag turns the camera and selects nothing', async () => {
  const before = await camera()
  const [x, y] = await pageXY(ON_BASE)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 40, y + 10)
  await page.mouse.up()
  await expect.poll(async () => (await camera()).position).not.toEqual(before.position)
  expect((await state()).selection).toEqual([])
  await page.getByRole('button', { name: 'Top view, 4', exact: true }).click()
  // Straight down again (framed below the bars over the view, so not over the origin itself).
  await expect
    .poll(async () => {
      const now = await camera()
      return Math.abs(now.position[0] - now.target[0]) + Math.abs(now.position[1] - now.target[1])
    })
    .toBeLessThan(0.05)
})

test('a drag turns the view about the point of the part under the pointer', async () => {
  await page.getByRole('button', { name: 'Top view, 4', exact: true }).click()
  await expect.poll(async () => Math.abs((await camera()).zoom)).toBeGreaterThan(0)
  const [x, y] = await pageXY(ON_BASE)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 30, y + 8)
  await page.mouse.up()
  // The target moved along the view onto the top of the base (z = 2.5), the camera was not moved by that.
  await expect.poll(async () => (await camera()).target[2]).toBeCloseTo(2.5, 1)
  await page.getByRole('button', { name: 'Top view, 4', exact: true }).click()
})

test('F frames the selection, and pressed again all the parts', async () => {
  await page.keyboard.press('F')
  await expect.poll(async () => (await camera()).position).not.toBeNull()
  const dist = async () => {
    const c = await camera()
    return Math.hypot(...c.position.map((v, i) => v - c.target[i])) / c.zoom
  }
  await expect.poll(async () => (await camera()).target[2]).toBeGreaterThan(0)
  const all = await dist()
  await clickOver(ON_POST)
  await expect.poll(async () => (await state()).selection.length).toBe(1)
  await page.keyboard.press('F')
  await expect.poll(async () => Math.abs((await camera()).target[2] - 22.5) < 0.01).toBe(true)
  expect(await dist()).toBeLessThan(all)
  await page.keyboard.press('F')
  await expect.poll(async () => Math.abs((await camera()).target[2] - 22.5) > 1).toBe(true)
  await page.keyboard.press('Escape')
})

test('Insert puts the selected refs in the prompt of the running session, and does not send them', async () => {
  const base = (await pickOver(ON_BASE))!
  const post = (await pickOver(ON_POST))!
  await clickOver(ON_BASE)
  await clickOver(ON_POST, { shift: true })
  await expect.poll(async () => (await state()).selection).toEqual([base.ref, post.ref])

  // No session yet: nowhere to put them.
  const insert = page.getByRole('button', { name: 'Insert in prompt', exact: true })
  await expect(insert).toBeDisabled()
  await expect(insert).toHaveAttribute('title', 'Start a session to put the selection in its prompt')

  await newSession(page.locator('[data-region="session"]'))
  await expect.poll(termText).toContain('READY')
  await expect(insert).toBeEnabled()
  await insert.click()
  const pasted = `${base.ref} ${post.ref}`
  await expect.poll(termText).toContain(pasted)
  // Nothing was sent: the agent echoes a line only when it gets one.
  expect(await termText()).not.toContain('> ')
  // What is typed next goes after them, and Enter sends the lot as one paste.
  await page.keyboard.type(' is too thin')
  await page.keyboard.press('Enter')
  await expect.poll(termText).toContain(`> \\e[200~${pasted}\\e[201~ is too thin`)
  // The selection is still there to be used again.
  expect((await state()).selection).toEqual([base.ref, post.ref])
})

test('on a failed build or one under way the parts are still picked; a build that changes a part empties the selection, one of the same parts keeps it', async () => {
  const before = await state()
  expect(before.selection).toHaveLength(2)
  const source = readFileSync(model(), 'utf8')
  appendFileSync(model(), '\nthis is not python(\n')
  await expect.poll(async () => (await state()).build, { timeout: 20_000 }).toMatchObject({ status: 'failed', stale: true, revision: before.revision })

  const [x, y] = await pageXY([-14, -9, 2.5])
  await page.mouse.move(x, y)
  // The last good build is still there to point at: the pointer is told nothing of a wait.
  await expect(readout()).not.toHaveText(/picks wait/)
  await page.mouse.down()
  await page.mouse.up()
  // Select works on the build on show: the click picks the face, and the selection is of it.
  await expect.poll(async () => (await state()).selection.length).toBeGreaterThan(0)
  expect((await state()).selection).not.toEqual(before.selection)
  expect((await state()).selection).toHaveLength(1)

  // A model that takes its time: while it is built, the parts on screen are still the old ones.
  // And it changes a part: the base is a millimetre thicker.
  expect(source).toContain('Box(40, 30, 5)')
  writeFileSync(model(), `${source.replace('Box(40, 30, 5)', 'Box(40, 30, 6)')}\nimport time\n\ntime.sleep(2)\n`)
  await expect.poll(async () => (await state()).build, { timeout: 20_000 }).toMatchObject({ status: 'building', stale: true })
  await page.mouse.move(x + 1, y)
  await expect(readout()).not.toHaveText(/picks wait/)
  await expect.poll(async () => (await state()).build, { timeout: 20_000 }).toMatchObject({ status: 'ok', stale: false, revision: before.revision + 1 })
  expect((await state()).selection).toEqual([])
  await expect(page.locator('.hand-ref')).toHaveCount(0)
  writeFileSync(model(), source)
  await expect.poll(async () => (await state()).build, { timeout: 20_000 }).toMatchObject({ status: 'ok', stale: false, revision: before.revision + 2 })

  // And picking works again, on the new build.
  await clickOver(ON_BASE)
  await expect.poll(async () => (await state()).selection).toHaveLength(1)
  await expect(readout()).not.toHaveText(/picks wait/)

  // A build that makes the very same parts numbers their faces as before: what is selected still names it.
  const selected = (await state()).selection
  writeFileSync(model(), `${source}\n# the same parts\n`)
  await expect.poll(async () => (await state()).build, { timeout: 20_000 }).toMatchObject({ status: 'ok', stale: false, revision: before.revision + 3 })
  expect((await state()).selection).toEqual(selected)
  await expect(page.locator('.hand-ref')).toHaveCount(1)
})

test('the selection is of the layout shown: another layout empties it', async () => {
  expect((await state()).selection).toHaveLength(1)
  await page.getByRole('group', { name: 'Layout' }).getByRole('button').click()
  await page.getByRole('menuitem', { name: 'print', exact: true }).click()
  await expect.poll(async () => (await state()).layout).toBe('print')
  expect((await state()).selection).toEqual([])
})

// Set TORNO_SHOTS=<dir> to write pick-light.png and pick-dark.png there: the
// window with a face selected and an edge beside it. Each picture needs its own
// launch: on a hidden window capturePage() delivers one image and hangs on the
// next call, and page.screenshot() never returns.
for (const scheme of ['light', 'dark'] as const) {
  test(`screenshot of a selection, ${scheme}`, async () => {
    const dir = process.env.TORNO_SHOTS
    test.skip(!dir, 'TORNO_SHOTS is not set')
    test.setTimeout(120_000)
    mkdirSync(dir!, { recursive: true })
    const shotRoot = copyFixtures()
    const shotApp = await launch({ TORNO_WORKSPACE: shotRoot })
    try {
      const shotPage = await shotApp.firstWindow()
      await shotPage.emulateMedia({ colorScheme: scheme })
      await openListed(shotPage, 'bracket')
      await expect.poll(async () => (await state(shotPage)).build?.status, { timeout: 90_000 }).toBe('ok')
      await newSession(shotPage.locator('[data-region="session"]'))
      await expect.poll(() => termText(shotPage)).toContain('READY')
      await clickOver(ON_BASE, {}, shotPage)
      await clickOver([20, 0, 2.5], { shift: true }, shotPage)
      await expect(chips(shotPage)).toHaveCount(2)
      await expect(chips(shotPage).nth(1).locator('.hand-ref-descriptor')).not.toBeEmpty()
      // Rest on the post, so the hover and its readout are in the picture.
      const [x, y] = await pageXY([0, -4, 14], shotPage)
      await shotPage.mouse.move(x, y)
      await expect(readout(shotPage).locator('.pick-readout-detail')).not.toBeEmpty()
      await shotPage.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      const png = await shotApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
        return image.toPNG().toString('base64')
      })
      writeFileSync(join(dir!, `pick-${scheme}.png`), Buffer.from(png, 'base64'))
    } finally {
      await shotApp.close()
      rmSync(shotRoot, { recursive: true, force: true })
    }
  })
}
