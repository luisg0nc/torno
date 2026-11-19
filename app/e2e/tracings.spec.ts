import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { OffsetMark } from '../src/shared/marks'
import type { Tracing, TracingCut } from '../src/shared/tracings'
import { png } from '../src/test/pngFixtures'
import { openListed } from './objects'
import { newSession } from './helpers'

// A tracing from start to file, in the hidden window: made on a flat face of the `bracket` fixture, a photo of the part lined up under it by two
// corners of its outline, a layer of Claude's (the stand-in plays `add_layer` through torno's own MCP server), a shape of it dragged to where it should be,
// the next prompt carrying that, the tracing shown in 3D, and an SVG written at true scale. The pieces have specs of their own (`lineup`,
// `tracing-marks`, `tracing-measures`, `tracing-3d`, `export`); this is the way through them. The window is hidden: the clicks are made at the places
// the sheet and the line-up say for a point, state is read through hooks and files, and the photo is a PNG the spec writes itself.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let home: string
let app: ElectronApplication
let page: Page
let photo: string
let out: string

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-tracings-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-tracings-home-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  photo = join(root, 'front.png')
  out = join(home, 'tracing.svg')
  writeFileSync(photo, png(400, 300))
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it. The HOME is the run's own.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

type MainHooks = { pickPhotos: string[]; pickSave: string | null; savePicks: number }
const setMain = (patch: Partial<MainHooks>): Promise<void> => app.evaluate((_e, to) => void Object.assign((globalThis as unknown as { __tornoMain: MainHooks }).__tornoMain, to), patch)

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const tracingOf = (): Promise<Tracing> => page.evaluate(async () => (await window.torno.tracings.list('bracket')).tracings[0])
const outlineOf = (): Promise<TracingCut> => page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1'))!)
const marks = (): Promise<OffsetMark[]> => page.evaluate(() => window.torno.marks.list('bracket') as Promise<OffsetMark[]>)
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const panel = () => page.locator('.tr-panel')
const lineup = () => page.locator('.lineup')
const switchTo = (view: 'Board' | 'Model' | 'Tracing') => page.locator('.pboard-switch').getByRole('button', { name: view, exact: true }).click()

/** Where a point of the plane is on the page now: the sheet's corner and zoom, the stage's place, and v running up the screen (the plane of the top face has +Y for v). */
async function client(uv: readonly [number, number]): Promise<[number, number]> {
  const view = await page.evaluate(() => window.__tornoTracingSheet!())
  const box = (await page.locator('.tr-stage').boundingBox())!
  return [box.x + view.x + uv[0] * view.k, box.y + view.y - uv[1] * view.k]
}

/** Sends a prompt as a person does: into the composer, then Enter. */
async function say(prompt: string): Promise<void> {
  await expect(composer()).toBeEnabled()
  await composer().focus()
  await page.keyboard.type(prompt)
  await page.keyboard.press('Enter')
}

test('a tracing on a flat face of the part is T1, with the outline the kernel cut', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
  // The base is a box: the face whose normal is +Z is its top.
  const top = await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      const found = await window.torno.geometry.describe('bracket', 'assembly', `base/F${i}`)
      if (found.kind === 'face' && found.type === 'plane' && found.normal !== null && found.normal[2] > 0.99) return `base/F${i}`
    }
    return null
  })
  expect(top, 'the base has a face looking up').not.toBeNull()
  await page.evaluate((ref) => window.torno.tracings.make('bracket', { on: { face: ref! }, layout: 'assembly', name: 'Top of the base' }), top)
  await switchTo('Tracing')
  await expect(panel()).toBeVisible()
  await expect(panel()).toHaveAttribute('data-tracing', 'T1')
  // The panel is in the card: the Tracings section opened by itself when the view came, with the tracing's row above the panel.
  await expect(page.locator('[data-section="tracings"] .tracing-row[data-tracing="T1"] .tr-panel')).toBeVisible()
  await expect(page.locator('[data-section="tracings"] .tracing-row[data-open]')).toHaveCount(1)
  await expect(panel().locator('.tr-id')).toHaveText('T1')
  await expect.poll(() => page.evaluate(async () => (await window.torno.tracings.outline('bracket', 'T1')) !== null), { timeout: 20_000 }).toBe(true)
  // The outline is drawn: the kernel's cut of the plane, the base and not the post that stands on it.
  await expect(page.locator('.tr-drawing path[data-part="base"]')).toHaveCount(1, { timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => window.__tornoTracingSheet?.().k ?? 0)).toBeGreaterThan(0)
  const t = await tracingOf()
  expect(t).toMatchObject({ id: 'T1', by: 'person', plane: { from: { kind: 'face' } } })
  // v runs up the screen for this plane: the clicks below rely on it.
  expect(t.plane.y[1]).toBeGreaterThan(0.99)
  const cut = await outlineOf()
  expect(cut.cut.parts.map((p) => p.part)).toContain('base')
  expect(cut.snaps.filter((s) => s.kind === 'corner').length).toBeGreaterThanOrEqual(4)
})

test('a photo is added through the dialog and lined up by two snapped corners; the straightened copy is kept and drawn under the outline', async () => {
  await setMain({ pickPhotos: [photo] })
  await panel().getByRole('button', { name: 'Add photo' }).click()
  await expect(lineup()).toBeVisible()
  const cut = await outlineOf()
  const corners = cut.snaps.filter((s) => s.kind === 'corner')
  // Two corners as far apart as the outline has: opposite ends of its diagonal.
  const [u0, v0] = cut.cut.bounds!.min
  const [u1, v1] = cut.cut.bounds!.max
  const near = (u: number, v: number) => corners.reduce((best, c) => (Math.hypot(c.uv[0] - u, c.uv[1] - v) < Math.hypot(best.uv[0] - u, best.uv[1] - v) ? c : best))
  const a = near(u0, v0)
  const b = near(u1, v1)
  const pair = async (photoAt: [number, number], uv: readonly number[]): Promise<void> => {
    const [px, py] = await page.evaluate((at) => window.__tornoLineup!.client('photo', at), photoAt)
    await page.mouse.click(px, py)
    const [tx, ty] = await page.evaluate((at) => window.__tornoLineup!.client('tracing', at), [uv[0], uv[1]] as [number, number])
    await page.mouse.click(tx, ty)
  }
  await pair([60, 240], a.uv)
  await pair([340, 60], b.uv)
  const clicked = await page.evaluate(() => window.__tornoLineup!.clicks())
  expect(clicked.tracing).toHaveLength(2)
  // Both clicks on the tracing's side were taken by a corner of the cut, not left free.
  expect(clicked.tracing.every((c) => c.snap !== undefined)).toBe(true)
  await lineup().getByRole('button', { name: 'Done' }).click()
  await expect(lineup()).toHaveCount(0)
  await expect.poll(async () => (await tracingOf()).photo?.straightened, { timeout: 20_000 }).toMatch(/^s-[0-9a-f]{12}\.png$/)
  const lined = (await tracingOf()).photo!
  expect(lined.pairs).toHaveLength(2)
  expect(lined.scale).toBeGreaterThan(0)
  expect(existsSync(join(root, 'bracket', '.torno', 'tracings', 'photos', lined.straightened!))).toBe(true)
  await expect(page.locator('.tr-drawing image[data-photo]')).toHaveCount(1)
  await expect(panel().locator('.tr-photo-rows')).toContainText('not exact')
})

test('Claude adds a layer through the stand-in, and its row says by Claude', async () => {
  await newSession(dock())
  await expect(chat()).toBeVisible()
  const cut = await outlineOf()
  const [u, v] = [(cut.cut.bounds!.min[0] + cut.cut.bounds!.max[0]) / 2, (cut.cut.bounds!.min[1] + cut.cut.bounds!.max[1]) / 2]
  const args = { tracing: 'T1', name: 'bolts', colour: 'blue', shapes: [{ kind: 'circle', centre: [u, v], radius: 3, name: 'bolt 1' }] }
  await say(`tool mcp__torno__add_layer ${JSON.stringify(args)}`)
  const row = panel().locator('.tr-layer-row[data-layer]')
  await expect(row).toHaveCount(1, { timeout: 30_000 })
  await expect(row).toContainText('bolts')
  await expect(row).toContainText('by Claude')
  await expect(row).toHaveAttribute('data-by', 'agent')
  // Its circle is drawn on the sheet, in mm, where Claude said.
  await expect(page.locator('.tr-drawing .tr-layer circle')).toHaveCount(1)
  expect((await tracingOf()).layers[0]).toMatchObject({ by: 'agent', name: 'bolts', shapes: [{ kind: 'circle', radius: 3 }] })
})

test('Should be here drags Claude\'s shape to where it belongs, and the next prompt carries the offset and the tracing it is on', async () => {
  const circle = (await tracingOf()).layers[0].shapes[0] as { centre: [number, number]; radius: number }
  await page.locator('.tr-palette [data-tool="offset"]').click()
  await expect(page.locator('.tr-palette [data-tool="offset"]')).toHaveAttribute('aria-pressed', 'true')
  // The circle's rim, at its right: the pointer takes it there, and it is dragged 3 mm to the right.
  const [x, y] = await client([circle.centre[0] + circle.radius, circle.centre[1]])
  const [mx, my] = await client([circle.centre[0] + circle.radius + 3, circle.centre[1]])
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(mx, my, { steps: 4 })
  // Its words are a tag tied to the shape's ghost (Task 24), no longer a line at the pointer.
  await expect(page.locator('[data-tag="tracing-offset"]')).toContainText('bolt 1 should be here')
  await page.mouse.up()
  await expect.poll(async () => (await marks()).filter((m) => m.kind === 'offset').length).toBe(1)
  const offset = (await marks()).find((m) => m.kind === 'offset')!
  expect(offset).toMatchObject({ author: 'user', tracing: 'T1', layer: { name: 'bolts' }, shape: { index: 0, name: 'bolt 1' }, status: 'draft' })
  expect(offset.by[0]).toBeGreaterThan(2.5)
  expect(offset).not.toHaveProperty('intent')

  await say('say received')
  // The line of this prompt, not the one before it that is last until this one lands: it names the mark.
  const added = chat().locator('.chat-added').filter({ hasText: 'M1' }).last()
  await expect(added.locator('.chat-added-label')).toHaveText('with', { timeout: 30_000 })
  await added.getByRole('button', { name: 'Show text' }).click()
  const text = added.locator('.chat-added-text')
  await expect(text).toContainText('offset')
  await expect(text).toContainText('bolt 1')
  await expect(text).toContainText('on T1')
  await expect.poll(async () => (await marks()).find((m) => m.kind === 'offset')?.status).toBe('sent')
})

test('Show in 3D puts the tracing in the model view, and the picture Claude gets says it is shown', async () => {
  const button = panel().getByRole('button', { name: 'Show in 3D' })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__tornoTest!.tracings()), { timeout: 20_000 }).toEqual([{ id: 'T1', layout: 'assembly', outline: true, photo: true, layers: 1 }])
  await switchTo('Model')
  const caption = await page.evaluate(async () => (await window.__tornoTest!.look({ view: 'top', size: 128 })).caption)
  expect(caption).toContain(' · tracing T1 shown in its plane')
})

test('an SVG of the tracing is saved at true scale, in millimetres, with nothing of this machine in it', async () => {
  await switchTo('Tracing')
  await expect(panel()).toBeVisible()
  await panel().getByRole('button', { name: 'Export', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Export' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'Tracing', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet.getByRole('group', { name: 'Tracing file' }).getByRole('button', { name: 'SVG', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await setMain({ pickSave: out })
  await sheet.getByRole('button', { name: 'Export SVG', exact: true }).click()
  await expect(page.locator('[data-part="saved-file"]')).toContainText('tracing', { timeout: 30_000 })
  await expect(sheet).toHaveCount(0)
  const svg = readFileSync(out, 'utf8')
  expect(svg).toMatch(/^<\?xml/)
  // True scale: the sheet is named in millimetres, and its units are millimetres.
  const sized = /width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!
  expect([sized[1], sized[2]]).toEqual([sized[3], sized[4]])
  // The cut of the base, Claude's layer and the title block that says what it is.
  expect(svg).toContain('data-part="base"')
  expect(svg).toContain('bolts')
  expect(svg).toContain('>bracket<')
  // The photo is left out unless it is ticked: it may show the real world.
  expect(svg).not.toContain('<image')
  // Nothing of this machine is in it (the one address is the SVG namespace, which a file on its own needs).
  for (const own of [root, home, homedir(), 'front.png']) expect(svg).not.toContain(own)
  expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//)
})
