import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { Mark, Vec3 } from '../src/shared/marks'
import { SESSION_HEADER } from '../src/main/http'
import { openListed } from './objects'

// Explode, through the window and through the agent's tools: the parts are drawn apart, and nothing that is
// picked, kept, measured or told is of a part as it is drawn apart. The agent in the session pane is the stand-in.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')
/** Where a picture of the exploded parts is left for whoever wants to look at one: outside the workspace. */
const pictures = process.env.TORNO_E2E_PICTURES

test.describe.configure({ mode: 'serial' })

const NOTE = 'the parts are drawn apart for display: every position, ref and number told is of the parts as assembled'
const NOT_BOTH = 'a section is not drawn exploded: give explode or section, not both (explode: null draws the parts together, section: null draws them whole)'
const TOOLS_WAIT = 'The parts are drawn apart: put them together (E, or the slider at 0) to mark, measure or cut'

let root: string
let app: ElectronApplication
let page: Page
let client: Client

type Content = Array<{ type: string; text?: string; data?: string }>

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-explode-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
  // The rail takes 56 px more than the column did: the window is that much wider, so the view is as wide as the tests were written for.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1496, 900))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1496)
  await page.emulateMedia({ colorScheme: 'light' })
  await openListed(page, 'hollow')
  await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('ok')
  const { url, token } = await app.evaluate((_electron, id) => (globalThis as unknown as { __tornoMain: { mcpFor(id: string): { url: string; token: string } } }).__tornoMain.mcpFor(id), 'hollow')
  client = new Client({ name: 'torno-e2e', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { [SESSION_HEADER]: token } } }))
})

test.afterAll(async () => {
  await client?.close()
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const amount = async (): Promise<number> => (await state()).explode.assembly?.amount ?? 0
const project = (point: Vec3, part?: string): Promise<[number, number]> => page.evaluate(([p, name]) => window.__tornoTest!.project(p as Vec3, name as string | undefined), [point, part] as const)
const pickAt = ([x, y]: [number, number]) => page.evaluate(([fx, fy]) => window.__tornoTest!.pickAt(fx, fy), [x, y] as const)
/** The viewport has the parts where the store says, and is not on its way there. */
const settled = async (apart: boolean): Promise<void> => {
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.exploded())).toBe(apart)
  // A move under way ends on a frame: the parts are at rest once two looks a moment apart see them in one place.
  await expect
    .poll(async () => {
      const first = await project([0, 0, 40], 'lid')
      await page.waitForTimeout(60)
      const second = await project([0, 0, 40], 'lid')
      return Math.hypot(first[0] - second[0], first[1] - second[1])
    })
    .toBe(0)
}
const slider = () => page.getByRole('slider', { name: 'Explode' })
const toggle = () => page.getByRole('toolbar', { name: 'View' }).getByRole('button', { name: /^Explode/ })
const bar = () => page.locator('.explodebar')
const barNote = () => page.locator('.explodebar-note')
const readout = () => page.locator('.pick-readout')
const canvas = async () => (await page.locator('.viewport-canvas canvas').first().boundingBox())!
const clickAt = async ([fx, fy]: [number, number]): Promise<void> => {
  const box = await canvas()
  await page.mouse.click(box.x + fx * box.width, box.y + fy * box.height)
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; content: Content; text: string }> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Content
  return { isError: result.isError === true, content, text: content.find((block) => block.type === 'text')?.text ?? '' }
}
const caption = (result: { text: string }): string => result.text.split('\n')[0]
const sceneFile = (): Record<string, unknown> => JSON.parse(readFileSync(join(root, 'hollow', '.torno', 'scene.json'), 'utf8'))

let lidTop: Vec3

test('the parts are drawn apart, what is picked is where the part is, and nothing is marked meanwhile', async () => {
  const lid = (await state()).scene!.parts.find((p) => p.name === 'lid')!
  lidTop = [0, 0, lid.bbox.max[2]]
  const before = await project(lidTop)
  expect((await pickAt(before))?.point[2]).toBeCloseTo(lidTop[2], 3)

  // One button in the compass; its bar opens under it.
  await expect(bar()).toHaveCount(0)
  await expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  await toggle().click()
  await expect(barNote()).toHaveText('For display only')
  await slider().fill('100')
  await expect.poll(amount).toBe(1)
  await expect(page.locator('.explode-amount')).toHaveText('100 %')
  await expect(slider()).toHaveAttribute('aria-valuetext', '100 %')
  await expect(toggle()).toHaveText('Explode 100 %')
  await expect(toggle()).toHaveAttribute('aria-pressed', 'true')
  await settled(true)
  // Drawn somewhere else now: as a point of the lid it is drawn away from where it is as a point of space. (The
  // slider let go far apart may have framed the parts anew: the camera is not where it was.)
  const moved = await project(lidTop, 'lid')
  const space = await project(lidTop)
  expect(Math.hypot(moved[0] - space[0], moved[1] - space[1])).toBeGreaterThan(0.05)
  // Fit frames the parts where they are drawn: the lid, which went up and out of the middle, is in view, clear of the bars.
  await page.keyboard.press('f')
  const after = await project(lidTop, 'lid')
  expect(after[1]).toBeGreaterThan(0.12)
  expect(after[1]).toBeLessThan(0.9)
  const there = await project(lidTop)
  // Picked where it is drawn, answered where it is.
  const hit = await pickAt(after)
  expect(hit?.ref.startsWith('lid/F')).toBe(true)
  expect(Math.abs(hit!.point[0])).toBeLessThan(1e-3)
  expect(Math.abs(hit!.point[1])).toBeLessThan(1e-3)
  expect(Math.abs(hit!.point[2] - lidTop[2])).toBeLessThan(1e-3)
  // What the window tells main of the view says the parts are apart, and nothing in it is of a part drawn apart.
  expect((await state()).scene!.parts.find((p) => p.name === 'lid')!.bbox).toEqual(lid.bbox)
  await expect(barNote()).toHaveText('For display only · E puts them together')

  // A pin is not placed: the pointer says why, and no mark is kept.
  await page.keyboard.press('p')
  await clickAt(after)
  await expect(readout()).toContainText(TOOLS_WAIT)
  await page.waitForTimeout(300)
  expect((await state()).marks).toHaveLength(0)
  // Nor is anything measured: by a click, or by the key that measures the wall under the pointer.
  await page.keyboard.press('m')
  await clickAt(after)
  await page.keyboard.press('t')
  await expect(readout()).toContainText(TOOLS_WAIT)
  await page.waitForTimeout(300)
  expect((await state()).marks).toHaveLength(0)

  // Selecting works, and names the face at its own point.
  await page.keyboard.press('v')
  await clickAt(after)
  await expect.poll(async () => (await state()).selection).toEqual([hit!.ref])
  const picked = (await state()).picked[hit!.ref]
  expect(Math.abs(picked.point[2] - lidTop[2])).toBeLessThan(1e-3)
  // A note cannot be left on it meanwhile, and the button says why.
  const note = page.getByRole('group', { name: 'Selection' }).getByRole('button', { name: 'Note' })
  await expect(note).toBeDisabled()
  await expect(note).toHaveAttribute('title', TOOLS_WAIT)

  // Put together with E, the pin goes where it was aimed.
  await page.keyboard.press('Escape')
  await page.keyboard.press('e')
  await expect.poll(amount).toBe(0)
  await settled(false)
  await expect(bar()).toHaveCount(0)
  await expect(toggle()).toHaveText('Explode')
  await expect(note).toHaveCount(0)
  await page.keyboard.press('p')
  await clickAt(there)
  await expect.poll(async () => (await state()).marks.length).toBe(1)
  const pin = (await state()).marks[0] as Extract<Mark, { kind: 'pin' }>
  expect(pin.anchor.part).toBe('lid')
  expect(Math.abs(pin.anchor.point[2] - lidTop[2])).toBeLessThan(1e-3)
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
})

test('a mark is drawn with its part, and E goes back to how far apart the parts last were', async () => {
  const together = (await page.evaluate(() => window.__tornoTest!.markScreen('M1')))!
  const from = await project(lidTop)
  await page.keyboard.press('e')
  await expect.poll(amount).toBe(1)
  await settled(true)
  const to = await project(lidTop, 'lid')
  const apart = (await page.evaluate(() => window.__tornoTest!.markScreen('M1')))!
  // The label went where the lid went (it hangs off its point by a leader whose length in pixels is the same).
  expect(apart.x - together.x).toBeCloseTo(to[0] - from[0], 2)
  expect(apart.y - together.y).toBeCloseTo(to[1] - from[1], 2)
  // The mark itself is where it was put.
  expect(((await state()).marks[0] as Extract<Mark, { kind: 'pin' }>).anchor.point[2]).toBeCloseTo(lidTop[2], 3)
  await page.keyboard.press('e')
  await expect.poll(amount).toBe(0)
  await settled(false)
  expect((await page.evaluate(() => window.__tornoTest!.markScreen('M1')))!.y).toBeCloseTo(together.y, 3)
})

test('dragging the slider moves the parts and keeps nothing until it is let go', async () => {
  const edits = (await state()).edits
  await toggle().click()
  await slider().evaluate((input: HTMLInputElement) => {
    input.value = '40'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(page.locator('.explode-amount')).toHaveText('40 %')
  expect(await page.evaluate(() => window.__tornoTest!.exploded())).toBe(true)
  expect([await amount(), (await state()).edits]).toEqual([0, edits])
  // The parts are apart on the screen and the store does not know it yet: no tool but Select is handed anything
  // all the same (I1). A stroke drawn now would be kept where the parts are drawn.
  const marks = (await state()).marks.length
  await page.keyboard.press('f')
  await page.keyboard.press('d')
  const on = await project(lidTop, 'lid')
  const box = await canvas()
  await page.mouse.move(box.x + on[0] * box.width, box.y + on[1] * box.height)
  await page.mouse.down()
  await page.mouse.move(box.x + on[0] * box.width + 30, box.y + on[1] * box.height + 4, { steps: 4 })
  await page.mouse.up()
  await expect(readout()).toContainText(TOOLS_WAIT)
  await page.waitForTimeout(300)
  expect((await state()).marks).toHaveLength(marks)
  await page.keyboard.press('v')
  await slider().evaluate((input: HTMLInputElement) => input.dispatchEvent(new Event('change', { bubbles: true })))
  await expect.poll(amount).toBe(0.4)
  expect((await state()).edits).toBe(edits + 1)
  // Along what, and how far, in the bar.
  await page.getByRole('group', { name: 'Direction' }).getByRole('button', { name: 'Z', exact: true }).click()
  await page.getByRole('group', { name: 'Distance' }).getByRole('button', { name: '×2' }).click()
  expect((await state()).explode.assembly).toEqual({ amount: 0.4, scale: 2, axis: 'z' })
  // Along z the lid goes straight up: as a point of the lid, its top is drawn above where it is.
  await settled(true)
  const [at, drawn] = [await project(lidTop), await project(lidTop, 'lid')]
  expect(drawn[1]).toBeLessThan(at[1] - 0.02)
  // Kept in the scene file, as the person's own.
  await expect.poll(() => { try { return sceneFile().explode } catch { return undefined } }, { timeout: 5000 }).toEqual({ assembly: { amount: 0.4, scale: 2, axis: 'z' } })
})

test('a section puts the parts together, and they are not drawn apart while it is there', async () => {
  await page.keyboard.press('x')
  await page.getByRole('toolbar', { name: 'Section' }).getByRole('button', { name: 'Cut across Z' }).click()
  await expect.poll(async () => (await state()).section?.normal).toEqual([0, 0, 1])
  expect(await amount()).toBe(0)
  await settled(false)
  // The bar was there because the parts were apart: it is gone with that.
  await expect(bar()).toHaveCount(0)
  await expect(toggle()).toHaveText('Explode')
  // E says why not, in the bar, and changes nothing.
  await page.keyboard.press('v')
  await page.keyboard.press('e')
  await expect(barNote()).toHaveText('Take the section away to draw the parts apart')
  await expect(slider()).toBeDisabled()
  await expect(slider()).toHaveAttribute('title', 'Take the section away to draw the parts apart')
  await expect(page.locator('.explode-amount')).toHaveText('0 %')
  expect(await amount()).toBe(0)
  // The agent is refused both, in a picture and on the screen.
  expect((await call('look', { explode: 0.5 })).text).toBe(NOT_BOTH)
  expect((await call('show', { explode: 0.5 })).text).toBe(NOT_BOTH)
  expect(await page.evaluate(() => window.__tornoTest!.exploded())).toBe(false)
  await page.getByRole('toolbar', { name: 'Section' }).getByRole('button', { name: 'Off' }).click()
  await expect.poll(async () => (await state()).section).toBeNull()
  // Seen on a visible screen: the bar went on saying to take the section away after it was gone. It says at once
  // what explode is, with the pointer nowhere near the view.
  await expect(barNote()).toHaveText(/^For display only/, { timeout: 1000 })
  // Only how far apart they were is forgotten.
  expect((await state()).explode.assembly).toEqual({ amount: 0, scale: 2, axis: 'z' })
  await expect(slider()).toBeEnabled()
  await page.getByRole('group', { name: 'Direction' }).getByRole('button', { name: 'From centre' }).click()
  await page.getByRole('group', { name: 'Distance' }).getByRole('button', { name: '×1' }).click()
  expect((await state()).explode.assembly).toEqual({ amount: 0, scale: 1, axis: 'centre' })
  // The button closes the bar again.
  await toggle().click()
  await expect(bar()).toHaveCount(0)
})

test('the agent sees an exploded picture as one, and measures the parts as they are', async () => {
  const assembled = (await call('measure', { kind: 'bbox', a: 'lid' })).text
  const sceneBefore = JSON.parse((await call('scene')).text)
  expect(sceneBefore.explode).toBeNull()
  const look = await call('look', { explode: { amount: 1, axis: 'z' }, view: 'front' })
  expect(look.isError).toBe(false)
  expect(caption(look)).toContain(`exploded 100 % along z (${NOTE})`)
  if (pictures) {
    mkdirSync(pictures, { recursive: true })
    writeFileSync(join(pictures, 'exploded-front.png'), Buffer.from(look.content.find((block) => block.type === 'image')!.data!, 'base64'))
    const iso = await call('look', { explode: 0.6, view: 'iso' })
    writeFileSync(join(pictures, 'exploded-iso.png'), Buffer.from(iso.content.find((block) => block.type === 'image')!.data!, 'base64'))
    writeFileSync(join(pictures, 'captions.txt'), `${look.text}\n\n${iso.text}\n`)
  }
  expect((await call('measure', { kind: 'bbox', a: 'lid' })).text).toBe(assembled)
  // The person's view was not changed by the picture, nor are the parts left apart on their screen.
  expect(await amount()).toBe(0)
  expect(await page.evaluate(() => window.__tornoTest!.exploded())).toBe(false)
  expect(caption(await call('look'))).not.toContain('exploded')

  // What is nearly an explode is refused, not made into one: a percentage is no amount.
  expect((await call('look', { explode: 50 })).text).toMatch(/^explode is a number from 0 to 1/)
  expect((await call('show', { explode: { amount: 0.5, axix: 'z' } })).text).toContain('did you mean axis?')
  const shown = await call('show', { explode: 0.5 })
  expect(shown.text).toContain(`exploded 50 % from the centre (${NOTE})`)
  await settled(true)
  const scene = JSON.parse((await call('scene')).text)
  expect(scene.explode).toEqual({ amount: 0.5, scale: 1, axis: 'centre' })
  expect(scene.note).toContain(`The user's view is exploded 50 % from the centre: ${NOTE}.`)
  // Every part is told where it is built, as before.
  expect(scene.parts).toEqual(sceneBefore.parts)
  expect((await call('measure', { kind: 'bbox', a: 'lid' })).text).toBe(assembled)
  // What they see is what a picture of their view shows, and says; asked together, it is drawn together.
  expect(caption(await call('look'))).toContain(`exploded 50 % from the centre (${NOTE})`)
  expect(caption(await call('look', { explode: null }))).not.toContain('exploded')
  expect(caption(await call('look', { explode: 0 }))).not.toContain('exploded')
  // A cut of the picture's own is drawn of the parts together, though the screen has them apart.
  const cut = caption(await call('look', { section: { axis: 'z', at: 20 } }))
  expect(cut).toContain('cut at z = 20')
  expect(cut).not.toContain('exploded')
  // For now only: not what their scene file keeps.
  await page.waitForTimeout(900)
  expect(sceneFile().explode).toBeUndefined()
  // The agent's mark on the lid is where the ref is, not where the lid is drawn.
  const added = await call('add_mark', { kind: 'pin', note: 'top', ref: (await pickAt(await project(lidTop, 'lid')))!.ref, point: lidTop })
  expect(added.isError).toBe(false)
  const marks = JSON.parse((await call('marks')).text).marks as Array<{ id: string; anchor?: { point: Vec3 } }>
  expect(marks.at(-1)!.anchor!.point[2]).toBeCloseTo(lidTop[2], 3)
  expect((await call('show', { explode: null })).text).not.toContain('exploded')
  await settled(false)
  expect(JSON.parse((await call('scene')).text).explode).toBeNull()
})

test('a dimension between two parts drawn apart is drawn dashed between them, says so on its row, and keeps its value', async () => {
  // From the lid's top to a side of the tub: its two ends are on two parts.
  const top = (await pickAt(await project(lidTop)))!
  const sides = [await pickAt(await project([20, 0, 19])), await pickAt(await project([0, -20, 19])), await pickAt(await project([-20, 0, 19])), await pickAt(await project([0, 20, 19]))]
  const side = sides.find((hit) => hit?.ref.startsWith('tub/F'))!
  expect(side).toBeTruthy()
  const across = await call('add_mark', { kind: 'dimension', note: 'lid to tub', measure: 'distance', a: { ref: top.ref, point: lidTop }, b: { ref: side.ref, point: side.point } })
  expect(across.isError).toBe(false)
  const id = /M\d+/.exec(across.text)![0]
  await expect.poll(async () => (await state()).marks.some((mark) => mark.id === id)).toBe(true)
  const value = ((await state()).marks.find((mark) => mark.id === id) as Extract<Mark, { kind: 'dimension' }>).value
  // From the standard view, fitted: drawing the parts apart may frame them anew when one would leave the view, and the same view is gone back to below.
  const iso = async (): Promise<{ x: number; y: number }> => {
    await page.keyboard.press('1')
    let last = { x: NaN, y: NaN }
    await expect.poll(async () => {
      const now = (await page.evaluate((mark) => window.__tornoTest!.markScreen(mark), id))!
      const still = Math.hypot(now.x - last.x, now.y - last.y) < 1e-4
      last = now
      return still
    }).toBe(true)
    return last
  }
  const together = await iso()
  const row = page.locator(`.mark-row[data-mark="${id}"]`)
  await expect(row.locator('.row-note')).toHaveCount(0)

  await page.keyboard.press('e')
  await expect.poll(amount).toBeGreaterThan(0)
  await settled(true)
  // Still drawn, between its parts where they are drawn: its label is elsewhere.
  const apart = (await page.evaluate((mark) => window.__tornoTest!.markScreen(mark), id))!
  expect(Math.hypot(apart.x - together.x, apart.y - together.y)).toBeGreaterThan(0.02)
  await expect(row.locator('.row-note')).toHaveText('spans parts drawn apart')
  // Its value is the kernel's, of the parts as built: the same as before, in the store and to the agent.
  expect(((await state()).marks.find((mark) => mark.id === id) as Extract<Mark, { kind: 'dimension' }>).value).toBe(value)
  // And a picture of the view says which mark is drawn so, as what the agent is shown does.
  const look = await call('look', { view: 'iso' })
  expect(caption(look)).toContain(`${id} spans parts drawn apart: it is drawn dashed between them, as long as they are apart, which measures nothing`)
  if (pictures) writeFileSync(join(pictures, 'exploded-spanning.png'), Buffer.from(look.content.find((block) => block.type === 'image')!.data!, 'base64'))
  expect((await call('show', { view: 'iso' })).text).toContain(`${id} spans parts drawn apart`)

  await page.keyboard.press('e')
  await expect.poll(amount).toBe(0)
  await settled(false)
  expect((await iso()).y).toBeCloseTo(together.y, 1)
  await expect(row.locator('.row-note')).toHaveCount(0)
})

test('the compass fits at 1280 × 800 for an object with two layouts, apart or together; and a stroke begun as the parts come together keeps nothing of where they were drawn', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('ok')
  // The narrowest window the compass is held to: its view is 1280 - 52 - 264 - 384 wide below 1360.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([1280, 800])
  const compass = async () => (await page.locator('.compass').boundingBox())!
  const fits = async (): Promise<void> => {
    const pane = (await page.locator('.viewport-pane').boundingBox())!
    const box = await compass()
    // Inside the view, at its top right, under nothing of the panels.
    expect(box.x).toBeGreaterThanOrEqual(pane.x)
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width)
    expect(box.y).toBeGreaterThanOrEqual(pane.y)
    expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height)
    expect(pane.x + pane.width - (box.x + box.width)).toBeLessThan(20)
    // Every button of it is whole, and none is under another.
    const buttons = await page.locator('.compass button').all()
    for (const button of buttons) {
      const b = (await button.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1)
    }
    // Clear of the reed at the left.
    const reed = (await page.getByRole('toolbar', { name: 'Tools' }).boundingBox())!
    expect(box.x).toBeGreaterThan(reed.x + reed.width)
  }
  await fits()
  // The tile is 118 x 112, with the layout, Fit and Explode in a row of their own.
  const tile = (await page.locator('.compass > .cube').boundingBox())!
  expect([Math.round(tile.width), Math.round(tile.height)]).toEqual([118, 112])
  await expect(page.getByRole('group', { name: 'Layout' })).toBeVisible()
  await page.keyboard.press('e')
  await expect.poll(amount).toBe(0.5)
  await settled(true)
  await expect(toggle()).toHaveText('Explode 50 %')
  // Apart, the saved views are folded to one pill, and the explode bar stands within the view beside the compass.
  await expect(page.getByRole('button', { name: /^Saved views/ })).toBeVisible()
  await fits()
  const pane = (await page.locator('.viewport-pane').boundingBox())!
  const explodebar = (await page.locator('.explodebar').boundingBox())!
  // Within the view, and clear of the compass (the bar becomes a track and a tag, which keep clear of it too).
  expect(explodebar.x).toBeGreaterThanOrEqual(pane.x)
  expect(explodebar.x + explodebar.width).toBeLessThanOrEqual((await compass()).x)
  // E, and at once a stroke: the store says together, the parts are still on their way. Nothing is drawn of it (I1).
  await page.keyboard.press('f')
  await page.keyboard.press('d')
  const post = (await state()).scene!.parts.find((p) => p.layout === 'assembly' && p.name === 'post')!
  const at = await project([0, 0, post.bbox.max[2]], 'post')
  const box = await canvas()
  await page.mouse.move(box.x + at[0] * box.width, box.y + at[1] * box.height)
  await page.keyboard.press('e')
  await page.mouse.down()
  const moving = await page.evaluate(() => window.__tornoTest!.exploded())
  await page.mouse.move(box.x + at[0] * box.width + 12, box.y + at[1] * box.height + 3, { steps: 3 })
  await page.mouse.up()
  await settled(false)
  await page.waitForTimeout(300)
  // Whenever the press came while they were still apart, it was handed to no tool.
  if (moving) expect((await state()).marks.filter((mark) => mark.kind === 'stroke')).toHaveLength(0)
  expect(moving).toBe(true)
  await page.keyboard.press('v')
  // The width the other tests were written for.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1496, 900))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1496)
})

test('drawn apart by any way, every part stays in sight and clear of the bars; together, the camera goes back to where it was', async () => {
  await openListed(page, 'hollow')
  await expect.poll(async () => (await state()).objectId).toBe('hollow')
  await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('ok')
  if ((await amount()) > 0) await page.keyboard.press('e')
  await settled(false)
  const camera = () => page.evaluate(() => window.__tornoTest!.camera())
  /** The camera once it is at rest: two looks a moment apart see it in one place. */
  const rest = async () => {
    let was = await camera()
    await expect
      .poll(async () => {
        await page.waitForTimeout(120)
        const now = await camera()
        const still = now.zoom === was.zoom && now.position.every((c, i) => Math.abs(c - was.position[i]) < 1e-6)
        was = now
        return still
      })
      .toBe(true)
    return was
  }
  /** Whether every corner of every part of the layout, where it is drawn, is on the canvas and below the bars over its top. */
  const inClearView = async (): Promise<string[]> => {
    const box = await canvas()
    const bars = (await page.locator('.viewbars').boundingBox())!
    const s = await state()
    const out: string[] = []
    for (const part of s.scene!.parts.filter((p) => p.layout === s.layout)) {
      for (let c = 0; c < 8; c++) {
        const corner = [0, 1, 2].map((i) => ((c >> i) & 1 ? part.bbox.max[i] : part.bbox.min[i])) as Vec3
        const [fx, fy] = await project(corner, part.name)
        const y = box.y + fy * box.height
        if (fx < 0 || fx > 1 || y > box.y + box.height || y < bars.y + bars.height) out.push(`${part.name} ${corner.join(',')}`)
      }
    }
    return out
  }
  const sameAs = (a: { position: number[]; zoom: number }, b: { position: number[]; zoom: number }): void => {
    for (let i = 0; i < 3; i++) expect(a.position[i]).toBeCloseTo(b.position[i], 4)
    expect(a.zoom).toBeCloseTo(b.zoom, 6)
  }
  await page.keyboard.press('1')
  const home = await rest()
  // A standard view frames the parts below the bars.
  expect(await inClearView()).toEqual([])

  // E, along z four times as far: the lid goes up, and the parts are framed anew below the bars, the explode bar among them.
  await page.keyboard.press('e')
  await page.getByRole('group', { name: 'Direction' }).getByRole('button', { name: 'Z', exact: true }).click()
  await page.getByRole('group', { name: 'Distance' }).getByRole('button', { name: '×4' }).click()
  await settled(true)
  await rest()
  await expect(bar()).toBeVisible()
  expect(await inClearView()).toEqual([])
  // E again: together, and the camera is where it was.
  await page.keyboard.press('e')
  await settled(false)
  sameAs(await rest(), home)

  // The slider let go far apart: the same rule.
  await toggle().click()
  await slider().evaluate((input: HTMLInputElement) => {
    input.value = '100'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect.poll(amount).toBe(1)
  await settled(true)
  await rest()
  expect(await inClearView()).toEqual([])
  // Slid back to nothing: together, and back.
  await slider().evaluate((input: HTMLInputElement) => {
    input.value = '0'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect.poll(amount).toBe(0)
  await settled(false)
  sameAs(await rest(), home)

  // The agent's show: the same rule, and the same way back.
  expect((await call('show', { explode: { amount: 1, axis: 'z', scale: 4 } })).isError).toBe(false)
  await settled(true)
  await rest()
  expect(await inClearView()).toEqual([])
  expect((await call('show', { explode: null })).isError).toBe(false)
  await settled(false)
  sameAs(await rest(), home)

  // Moved by the person meanwhile, the camera is theirs: together, it stays where they put it.
  await page.keyboard.press('e')
  await settled(true)
  await page.keyboard.press('2')
  const theirs = await rest()
  await page.keyboard.press('e')
  await settled(false)
  sameAs(await rest(), theirs)
})
