import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { letGoText } from '../src/shared/build'
import type { Camera, LookRequest, LookResult, ViewState } from '../src/shared/view'
import { openPanel, railButton } from './helpers'
import { objectList, openListed } from './objects'

// The whole loop through the window: choose an object, see its parts, change
// layers and views, save the model and watch it rebuild, break it and mend it.
//
// The window is hidden, so nothing here waits on painted pixels or takes a
// screenshot: state is read through window.__tornoTest.state(), and pictures
// are made by __tornoTest.look(), which does not depend on frames.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

function copyFixtures(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-loop-'))
  cpSync(fixtures, dir, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  return dir
}

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
function launch(env: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', ...env } })
}

test.beforeAll(async () => {
  root = copyFixtures()
  // The stand-in agent, for the one test that starts a session: no test here runs `claude`.
  app = await launch({ TORNO_WORKSPACE: root, TORNO_AGENT_CMD: `node ${fakeAgent}` })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (p: Page = page): Promise<TornoState> => p.evaluate(() => window.__tornoTest!.state())
const camera = (): Promise<Camera> => page.evaluate(() => window.__tornoTest!.camera())
/** The layers listed in the Layers panel, which is opened first where the rail offers it (a project is open). */
async function layerNames(p: Page = page): Promise<(string | null)[]> {
  if ((await railButton(p, 'Layers').count()) > 0) await openPanel(p, 'Layers')
  return p.locator('[data-layer]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-layer')))
}
const status = (p: Page) => p.locator('[data-region="status"]')

interface Picture {
  base64: string
  width: number
  height: number
  caption: string
  /** Share of pixels that are neither the background nor as faint as the ground grid: the parts. */
  drawn: number
  /** What the window says it drew. */
  of: { objectId: string; revision: number; stale: boolean }
}

/** A picture through the renderer's look, measured in the page. */
function look(req: LookRequest, p: Page = page): Promise<Picture> {
  return p.evaluate(async (request) => {
    const result = await window.__tornoTest!.look(request)
    const bitmap = await createImageBitmap(new Blob([result.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    // --surface is #F1EFEA; the grid's hairlines are within 30 of it, the parts far from it.
    const background = [0xf1, 0xef, 0xea]
    let drawn = 0
    for (let i = 0; i < data.length; i += 4) {
      if (background.some((value, channel) => Math.abs(data[i + channel] - value) > 40)) drawn += 1
    }
    let binary = ''
    for (let i = 0; i < result.png.length; i += 0x8000) binary += String.fromCharCode(...result.png.subarray(i, i + 0x8000))
    return { base64: btoa(binary), width: result.width, height: result.height, caption: result.caption, drawn: drawn / (data.length / 4), of: { objectId: result.objectId, revision: result.revision, stale: result.stale } }
  }, req)
}

/** `requestLook` in main, as the MCP server will call it. */
function mainLook(req: LookRequest): Promise<{ caption: string; width: number; height: number; png: boolean } | { error: string }> {
  return app.evaluate(async ({ BrowserWindow }, request) => {
    const main = (globalThis as unknown as { __tornoMain: { requestLook(win: unknown, req: unknown, timeoutMs?: number): Promise<LookResult> } }).__tornoMain
    try {
      const r = await main.requestLook(BrowserWindow.getAllWindows()[0], request)
      const png = r.png[0] === 0x89 && r.png[1] === 0x50 && r.png[2] === 0x4e && r.png[3] === 0x47
      return { caption: r.caption, width: r.width, height: r.height, png }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, req)
}

function mainView(objectId: string): Promise<ViewState | undefined> {
  return app.evaluate((_electron, id) => {
    return (globalThis as unknown as { __tornoMain: { latestView(id: string): ViewState | undefined } }).__tornoMain.latestView(id)
  }, objectId)
}

const model = () => join(root, 'bracket', 'bracket.py')
const sceneFile = () => join(root, 'bracket', '.torno', 'scene.json')

test('the object list shows the objects; one that cannot be built is muted, with the reason', async () => {
  const rows = page.locator('.object-row')
  await expect(rows).toHaveText(['bracket', 'broken', 'chatty', 'crash', 'exits', 'gauge', 'grouped', 'hollow', 'housing608', 'makers', 'measures', 'morph', 'noscene', 'plain', 'slow', 'spread', 'two'])
  const two = page.getByRole('button', { name: 'two', exact: true })
  await expect(two).toHaveAttribute('title', /more than one model file in .*two: a\.py, b\.py/)
  await expect(two).toHaveAttribute('data-problem', '')
  await expect(page.getByRole('button', { name: 'bracket', exact: true })).not.toHaveAttribute('data-problem')
  await expect(page.locator('[data-region="left"] .workspace-name')).toHaveAttribute('title', root)
  await expect(page.locator('[data-region="viewport"]')).toContainText('No project open')
})

test('asked for a picture with no object open, the window says so at once', async () => {
  const started = Date.now()
  expect(await mainLook({ view: 'iso' })).toEqual({ error: 'no project open in the torno window' })
  // Not the ten seconds main would wait for an answer.
  expect(Date.now() - started).toBeLessThan(3000)
})

test('clicking an object builds it: status ok, revision 1, its parts as layers', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).build?.status, { timeout: 20_000 }).toBe('ok')
  const s = await state()
  expect(s.build).toMatchObject({ objectId: 'bracket', revision: 1, stale: false })
  expect(s).toMatchObject({ revision: 1, layout: 'assembly' })
  expect(await layerNames()).toEqual(['base', 'post'])

  await expect(status(page)).toContainText('bracket')
  await expect(status(page)).toContainText('Built in')
  await expect(status(page).locator('[data-part="revision"]')).toHaveText('r1')
  await expect(status(page).locator('[data-part="parts"]')).toHaveText('2 parts')
  await expect(status(page)).toContainText(/build123d \d+\.\d+/)
  // Every number and ref is in the monospace face.
  const face = await status(page).locator('[data-part="revision"] .num').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(face).toContain('IBM Plex Mono')
  // The list in the Projects panel marks the object open.
  await openPanel(page, 'Projects')
  await expect(objectList(page).getByRole('button', { name: 'bracket', exact: true })).toHaveAttribute('aria-current', 'true')
})

test('a look draws the parts', async () => {
  const picture = await look({ view: 'iso' })
  expect(picture.base64.startsWith('iVBORw0KGgo')).toBe(true) // the PNG signature
  expect(picture).toMatchObject({ width: 1280, height: 960 })
  expect(picture.caption).toBe('view iso · layout assembly · parts base, post · orthographic · 1280×960')
  expect(picture.drawn).toBeGreaterThan(0.02)

  // The view on screen, in the shape of the canvas, with a size asked for.
  const current = await look({ size: 640 })
  expect(current.caption).toContain('view current · layout assembly · parts base, post · perspective')
  expect(Math.max(current.width, current.height)).toBe(640)
  expect(current.drawn).toBeGreaterThan(0.02)
})

test('the layout switch shows the other layout; with one layout there is none', async () => {
  const layoutSwitch = page.getByRole('group', { name: 'Layout' })
  await expect(layoutSwitch.getByRole('button')).toHaveText(['assembly', 'print'])
  await layoutSwitch.getByRole('button', { name: 'print' }).click()
  expect((await state()).layout).toBe('print')
  expect((await look({ view: 'top' })).caption).toContain('layout print')
  await expect.poll(() => (existsSync(sceneFile()) ? JSON.parse(readFileSync(sceneFile(), 'utf8')).layout : null)).toBe('print')
  await layoutSwitch.getByRole('button', { name: 'assembly' }).click()
  expect((await state()).layout).toBe('assembly')
  await expect(layoutSwitch.getByRole('button', { name: 'assembly' })).toHaveAttribute('aria-pressed', 'true')
})

test('view buttons and keys move the camera; keys are left alone in the session dock', async () => {
  const toward = async () => {
    const c = await camera()
    const d = c.target.map((t, i) => t - c.position[i])
    const length = Math.hypot(...d)
    return d.map((v) => Math.round((v / length) * 100) / 100 + 0) // + 0: no negative zero
  }
  const arrived = async (expected: number[]) => expect.poll(toward, { timeout: 5_000 }).toEqual(expected)

  await page.keyboard.press('2')
  await arrived([0, 1, 0]) // front looks along +Y
  await page.keyboard.press('3')
  await arrived([-1, 0, 0])
  await page.keyboard.press('4')
  await arrived([0, 0, -1])
  await page.getByRole('button', { name: 'Front', exact: true }).click()
  await arrived([0, 1, 0])
  await page.getByRole('button', { name: 'More views' }).click()
  await page.getByRole('menuitem', { name: 'Back' }).click()
  await arrived([0, -1, 0])
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Focus in the session dock: the keys belong to the terminal that will live there.
  await page.getByRole('separator', { name: 'Resize session' }).focus()
  await page.keyboard.press('2')
  await page.keyboard.press('o')
  await page.waitForTimeout(400)
  expect(await toward()).toEqual([0, -1, 0])
  expect((await state()).ortho).toBe(false)
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())

  await page.keyboard.press('o')
  expect((await state()).ortho).toBe(true)
  expect((await camera()).ortho).toBe(true)
  await expect(page.getByRole('button', { name: 'Ortho' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Perspective' }).click()
  expect((await camera()).ortho).toBe(false)

  // Fit keeps the direction and frames the parts again.
  await page.keyboard.press('1')
  await arrived([-0.62, 0.62, -0.49])
  await page.waitForTimeout(400) // the move is over, not only its turn
  const fitted = await camera()
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, 600)
  await expect.poll(async () => (await camera()).position).not.toEqual(fitted.position)
  await page.keyboard.press('f')
  const again = await camera()
  for (let i = 0; i < 3; i++) expect(again.position[i]).toBeCloseTo(fitted.position[i], 3)

  // A view, then Fit at once, while the camera is still on its way: Fit is of where it is going, not of where
  // the turn has got to, and the turn is not left halfway.
  await page.keyboard.press('4')
  await page.waitForTimeout(400)
  await page.keyboard.press('1')
  await page.keyboard.press('f')
  await page.waitForTimeout(400)
  const quick = await camera()
  for (let i = 0; i < 3; i++) expect(quick.position[i]).toBeCloseTo(fitted.position[i], 3)
  for (let i = 0; i < 3; i++) expect(quick.target[i]).toBeCloseTo(fitted.target[i], 3)
})

test('dragging orbits the camera, and main is told where it came to rest', async () => {
  const before = await camera()
  const box = (await page.locator('.viewport-canvas').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 120, y + 40, { steps: 6 })
  await page.mouse.up()
  const after = await camera()
  expect(after.position).not.toEqual(before.position)
  // The turn is about the point under the pointer (#103), so the target has moved along the view.
  expect(after.target).not.toEqual(before.target)

  await expect.poll(async () => (await mainView('bracket'))?.camera.position, { timeout: 5_000 }).toEqual(after.position)
  expect(await mainView('bracket')).toMatchObject({
    objectId: 'bracket',
    layout: 'assembly',
    visible: ['assembly:base', 'assembly:post']
  })
  expect(await mainView('nope')).toBeUndefined()
})

test('clicking the object that is already open does nothing: its parts, its camera and its build stay as they are', async () => {
  const before = { camera: await camera(), state: await state() }
  expect(before.state.scene).not.toBeNull()
  await page.evaluate(() => {
    // Told of every state the window passes through from here on: opening an object empties it first.
    const w = window as unknown as { __emptied: number }
    w.__emptied = 0
    const seen = setInterval(() => {
      if (window.__tornoTest!.state().scene === null) w.__emptied += 1
    }, 5)
    setTimeout(() => clearInterval(seen), 1500)
  })
  await openListed(page, 'bracket')
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => (window as unknown as { __emptied: number }).__emptied)).toBe(0)
  expect(await camera()).toEqual(before.camera)
  expect(await state()).toMatchObject({ objectId: 'bracket', revision: before.state.revision, layout: before.state.layout, build: { status: 'ok', revision: before.state.revision } })
})

test('main gets a picture through requestLook; an unknown part or layout is refused by name', async () => {
  expect(await mainLook({ view: 'front', parts: ['post'], size: 800 })).toEqual({
    caption: 'view front · layout assembly · parts post · orthographic · 800×600',
    width: 800,
    height: 600,
    png: true
  })
  expect(await mainLook({ view: 'top', layout: 'print' })).toMatchObject({
    caption: 'view top · layout print · parts base, post · orthographic · 1280×960'
  })
  expect(await mainLook({ parts: ['base', 'x'] })).toEqual({ error: "unknown part 'x'; parts in layout assembly: base, post" })
  expect(await mainLook({ layout: 'exploded' })).toEqual({ error: 'No layout "exploded": the layouts are assembly, print' })
})

test('saving the model leads to the next revision', async () => {
  appendFileSync(model(), '# touch\n')
  await expect.poll(async () => (await state()).build?.revision, { timeout: 15_000 }).toBe(2)
  const s = await state()
  expect(s.build).toMatchObject({ status: 'ok', stale: false })
  expect(s.revision).toBe(2)
  await expect(status(page).locator('[data-part="revision"]')).toHaveText('r2')
})

test('a broken save fails the build and keeps the last good parts, dimmed; the error is one click away', async () => {
  const clean = await look({ view: 'iso' })
  expect(clean.of).toEqual({ objectId: 'bracket', revision: 2, stale: false })
  writeFileSync(model(), 'def assembly(p):\n    return {"base": Box(40, 30, 5)\n')
  await expect.poll(async () => (await state()).build?.status, { timeout: 15_000 }).toBe('failed')
  const s = await state()
  expect(s.build).toMatchObject({ revision: 2, stale: true, error: { kind: 'exception' } })
  expect(s.revision).toBe(2)
  expect(await layerNames()).toEqual(['base', 'post'])

  // The old parts are still drawn, fainter.
  const stale = await look({ view: 'iso' })
  expect(stale.of).toEqual({ objectId: 'bracket', revision: 2, stale: true })
  expect(stale.drawn).toBeGreaterThan(0.02)
  expect(stale.base64).not.toBe(clean.base64)

  const failed = page.getByRole('button', { name: 'Build failed' })
  await expect(failed).toBeVisible()
  expect(await failed.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(155, 43, 29)') // --fail
  await expect(status(page).locator('[data-part="revision"]')).toHaveText('showing r2')

  await failed.click()
  const sheet = page.getByRole('dialog', { name: 'Build error' })
  await expect(sheet).toContainText('bracket did not build')
  const traceback = sheet.locator('[data-part="traceback"]')
  await expect(traceback).toContainText('bracket.py')
  await expect(traceback).toContainText('SyntaxError')
  const style = await traceback.evaluate((el) => ({ face: getComputedStyle(el).fontFamily, select: getComputedStyle(el).userSelect }))
  expect(style.face).toContain('IBM Plex Mono')
  expect(style.select).toBe('text')
  await expect(sheet.getByRole('button', { name: 'Copy' })).toBeVisible()
  // What happened, in words and not as the kernel's word; who is told; and the one thing to press after an error in the model.
  await expect(sheet.locator('[data-part="kind"]')).toHaveText('Build after r2 failed · Python error in the model')
  await expect(sheet.locator('[data-part="told"]')).toHaveText('No session is running. Start one, and it is told with your first prompt.')
  await expect(sheet.getByRole('button', { name: 'Start a session to fix it' })).toHaveClass(/button-primary/)
  await expect(sheet.getByRole('button', { name: 'Rebuild' })).toHaveCount(0)
  // The same sources would give the same error: the status line's Rebuild is quiet.
  await expect(status(page).locator('.status-rebuild')).not.toHaveAttribute('data-primary', '')
  // The sheet lies over the viewport, between the rail and its panel and the session dock.
  const box = (await sheet.boundingBox())!
  const left = (await page.locator('[data-region="left"]').boundingBox())!
  expect(box.x).toBe(left.x + left.width)
  expect(box.x + box.width).toBe(1440 - 520)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await failed.click()
  await expect(sheet).toBeVisible()
})

test('a fillet that fails says why in the error sheet, under the message', async () => {
  writeFileSync(model(), 'from build123d import *\nplate = Box(20, 20, 5) - Box(12, 12, 5)\nplate = fillet(plate.edges().filter_by(Axis.Z), 6)\n')
  await expect.poll(async () => (await state()).build?.error?.diagnosis?.operation, { timeout: 30_000 }).toBe('fillet')
  const sheet = page.getByRole('dialog', { name: 'Build error' })
  if ((await sheet.count()) === 0) await page.getByRole('button', { name: 'Build failed' }).click()
  const why = sheet.locator('[data-part="diagnosis"]')
  await expect(why).toContainText('fillet R6 of 8 edges: each works alone; 4 pairs of adjacent edges fail (edges 4-5, 4-6, 5-7, 6-7: 12 mm apart, two R6 need more); the 8 together work up to R5.999')
  await expect(why).toContainText('4: line, 5 mm, along Z, between 2 planes')
  // Under the message, before the traceback; set as numbers are.
  const order = await sheet.locator('.sheet-message, [data-part="diagnosis"], [data-part="traceback"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-part') ?? 'message'))
  expect(order).toEqual(['message', 'diagnosis', 'traceback'])
  expect(await why.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('IBM Plex Mono')
  await expect(sheet.getByRole('heading', { name: 'Why' })).toBeVisible()
})

test('the error sheet hands the error to Claude Code without sending it: it starts a session when none runs, and fills the box of the one that does', async () => {
  const ASK = 'Fix the build of bracket: see the error.'
  const sheet = page.getByRole('dialog', { name: 'Build error' })
  if ((await sheet.count()) === 0) await page.getByRole('button', { name: 'Build failed' }).click()
  const dock = page.locator('[data-region="session"]')
  const box = dock.locator('[data-chat-composer]')
  // The dock is put away: asking shows it.
  await page.getByRole('button', { name: 'Hide session' }).click()
  await expect(dock).toBeHidden()
  await sheet.getByRole('button', { name: 'Start a session to fix it' }).click()
  await expect(dock).toBeVisible()
  await expect(box).toHaveValue(ASK, { timeout: 30_000 })
  // It fills the box and goes no further: nothing is sent, and the session waits.
  await expect(dock.locator('.chat-user')).toHaveCount(0)
  await expect.poll(async () => (await state()).sessions.bracket?.status).toBe('idle')
  await expect(sheet.locator('[data-part="told"]')).toHaveText('Claude Code is told this with your next prompt.')
  // A session runs: the same button now asks, and puts the words in the box again, after the person's own.
  await box.fill('')
  await page.getByRole('button', { name: 'Hide session' }).click()
  await expect(dock).toBeHidden()
  const ask = sheet.getByRole('button', { name: 'Ask Claude Code to fix it' })
  await expect(ask).toHaveClass(/button-primary/)
  await ask.click()
  await expect(dock).toBeVisible()
  await expect(box).toHaveValue(`${ASK} `)
  await expect(box).toBeFocused()
  await expect(dock.locator('.chat-user')).toHaveCount(0)
  await expect.poll(async () => (await state()).sessions.bracket?.status).toBe('idle')
  // The next prompt carries the failure, and the line above the box says so.
  await expect(dock.locator('.chat-next [data-part="build-failed"]')).toHaveText('build failed')
  await box.fill('')
})

test('mending the model builds the next revision and clears the failure', async () => {
  cpSync(join(fixtures, 'bracket', 'bracket.py'), model())
  await expect.poll(async () => (await state()).build?.revision, { timeout: 15_000 }).toBe(3)
  expect((await state()).build).toMatchObject({ status: 'ok', stale: false })
  await expect(page.getByRole('dialog', { name: 'Build error' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Build failed' })).toHaveCount(0)
  await expect(status(page).locator('[data-part="revision"]')).toHaveText('r3')
})

test('hiding a layer changes the picture and is recorded in .torno/scene.json', async () => {
  const both = await look({ view: 'iso' })
  await openPanel(page, 'Layers')
  await page.locator('[data-layer="post"]').hover()
  const toggle = page.getByRole('button', { name: 'Show post' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect((await state()).layers).toEqual({ post: { visible: false } })

  const without = await look({ view: 'iso' })
  expect(without.caption).toContain('parts base ·')
  expect(without.base64).not.toBe(both.base64)
  expect(without.drawn).toBeGreaterThan(0.02)
  // Naming the part shows it whatever its layer says.
  expect((await look({ view: 'iso', parts: ['post'] })).caption).toContain('parts post ·')

  await expect
    .poll(() => JSON.parse(readFileSync(sceneFile(), 'utf8')), { timeout: 5_000 })
    .toEqual({ layout: 'assembly', layers: { post: { visible: false } } })
  await expect.poll(async () => (await mainView('bracket'))?.visible).toEqual(['assembly:base'])

  // Opacity is set from the slider that the row reveals.
  const opacity = page.getByRole('slider', { name: 'Opacity of base' })
  await page.locator('[data-layer="base"]').hover()
  await opacity.fill('0.5')
  expect((await state()).layers.base).toEqual({ opacity: 0.5 })
  await expect.poll(() => JSON.parse(readFileSync(sceneFile(), 'utf8')).layers.base, { timeout: 5_000 }).toEqual({ opacity: 0.5 })
})

test('the layers come back as they were left when the object is opened again', async () => {
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => window.location.reload())])
  await page.waitForSelector('[data-region="left"]')
  expect((await state()).objectId).toBeNull()
  await openListed(page, 'bracket')
  // Built already: main sends the last scene again.
  await expect.poll(async () => (await state()).scene !== null, { timeout: 10_000 }).toBe(true)
  const s = await state()
  expect(s.build).toMatchObject({ status: 'ok', revision: 3 })
  expect(s.layers).toEqual({ post: { visible: false }, base: { opacity: 0.5 } })
  await expect(page.getByRole('button', { name: 'Show post' })).toHaveAttribute('aria-pressed', 'false')
  expect((await look({ view: 'iso' })).caption).toContain('parts base ·')
  // Nothing was touched, so nothing is written.
  const written = readFileSync(sceneFile(), 'utf8')
  await page.waitForTimeout(800)
  expect(readFileSync(sceneFile(), 'utf8')).toBe(written)
})

test('an object with two candidate models says what was looked for, and nothing breaks', async () => {
  await openListed(page, 'two')
  await expect.poll(async () => (await state()).build?.status).toBe('failed')
  const s = await state()
  expect(s).toMatchObject({ objectId: 'two', scene: null, revision: 0 })
  expect(s.build).toMatchObject({ revision: 0, stale: false, error: { kind: 'no_model' } })
  const reason = page.locator('[data-region="viewport"] [data-part="reason"]')
  await expect(reason).toContainText(/more than one model file in .*two: a\.py, b\.py/)
  await expect(page.locator('[data-region="viewport"]')).toContainText('two did not build')
  await expect(page.getByRole('button', { name: 'Build failed' })).toBeVisible()
  expect(await layerNames()).toEqual([])
  expect(await page.evaluate(() => window.__tornoTest!.look({ view: 'iso' }).catch((e: Error) => e.message))).toBe('no build yet')
  expect(await mainLook({ view: 'iso' })).toEqual({ error: 'no build yet' })
  // Nothing was written into the object's folder but the state file, which says why there is no build.
  const kept = join(root, 'two', '.torno')
  // And the line that has git pass over it: it changes with every build.
  await expect.poll(() => (existsSync(kept) ? readdirSync(kept).sort() : [])).toEqual(['.gitignore', 'state.md'])
  expect(readFileSync(join(kept, '.gitignore'), 'utf8')).toBe('state.md\n')
  expect(readFileSync(join(kept, 'state.md'), 'utf8')).toMatch(/## Build\n\nBUILD FAILED\. Nothing has been built yet\.\n\n```\nmore than one model file in .*two: a\.py, b\.py/)

  // An object with a model but no scene: the kernel's reason, the same way.
  await openListed(page, 'noscene')
  await expect.poll(async () => (await state()).build?.error?.kind, { timeout: 20_000 }).toBe('no_scene')
  await expect(reason).not.toBeEmpty()

  // And the app carries on: the bracket opens again, as it was.
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).scene !== null, { timeout: 20_000 }).toBe(true)
  expect(await layerNames()).toEqual(['base', 'post'])
})

// The parts fade for a build that takes a while, not at each save; picks are locked from the first moment either way.
test('a quick save never fades the parts; a build held past 600 ms does, and the pick lock does not wait', async () => {
  const faded = () => page.evaluate(() => window.__tornoTest!.faded())
  const before = (await state()).build!.revision
  await page.evaluate(() => {
    const w = window as unknown as { __fadedSeen: boolean; __fadedTimer: number }
    w.__fadedSeen = false
    w.__fadedTimer = window.setInterval(() => { if (window.__tornoTest!.faded()) w.__fadedSeen = true }, 10)
  })
  appendFileSync(model(), '# quick\n')
  await expect.poll(async () => (await state()).build?.revision, { timeout: 15_000 }).toBe(before + 1)
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => (window as unknown as { __fadedSeen: boolean }).__fadedSeen)).toBe(false)
  expect(await faded()).toBe(false)

  // Held by the model itself: it sleeps in the build.
  writeFileSync(model(), readFileSync(model(), 'utf8').replace('def assembly(p):\n', 'def assembly(p):\n    import time\n    time.sleep(1.5)\n'))
  await expect.poll(async () => (await state()).build?.status, { timeout: 15_000 }).toBe('building')
  // The lock holds from the first moment; the fade does not.
  expect((await state()).build).toMatchObject({ status: 'building', stale: true })
  expect(await faded()).toBe(false)
  await expect.poll(faded, { timeout: 5_000 }).toBe(true)
  expect((await state()).build?.status).toBe('building')
  await expect.poll(async () => (await state()).build?.revision, { timeout: 20_000 }).toBe(before + 2)
  await expect.poll(faded).toBe(false)
  await page.evaluate(() => window.clearInterval((window as unknown as { __fadedTimer: number }).__fadedTimer))
  cpSync(join(fixtures, 'bracket', 'bracket.py'), model())
  await expect.poll(async () => (await state()).build?.revision, { timeout: 15_000 }).toBe(before + 3)
})

// What a build changed is told when it lands: the status line names the part, and for a moment the old edges and the new are drawn.
test('a build that changes one part says which in the status line, shows its ghost for a moment, and a key puts it away', async () => {
  const ghosts = () => page.evaluate(() => window.__tornoTest!.ghosts())
  const landing = status(page).locator('[data-part="landing"]')
  const before = (await state()).build!.revision
  // The ghost is gone by itself, with no key or click.
  writeFileSync(model(), readFileSync(model(), 'utf8').replace('Box(40, 30, 5)', 'Box(40, 30, 7)'))
  await expect.poll(async () => (await state()).build?.revision, { timeout: 15_000 }).toBe(before + 1)
  await expect(landing).toHaveText('base changed, post same')
  await expect(landing).toHaveAttribute('title', /^Since the build before:\nbase: volume .* mm³/)
  expect(await ghosts()).toEqual(['assembly:base'])
  await expect.poll(ghosts, { timeout: 5_000 }).toEqual([])
  // A key puts it away at once.
  writeFileSync(model(), readFileSync(model(), 'utf8').replace('Box(40, 30, 7)', 'Box(40, 30, 5)'))
  await expect.poll(async () => (await state()).build?.revision, { timeout: 15_000 }).toBe(before + 2)
  await expect(landing).toHaveText('base changed, post same')
  expect(await ghosts()).toEqual(['assembly:base'])
  await page.keyboard.press('Shift')
  expect(await ghosts()).toEqual([])
  // A save that changes nothing drawn names no part, and leaves no ghost.
  appendFileSync(model(), '# touch\n')
  await expect.poll(async () => (await state()).build?.revision, { timeout: 15_000 }).toBe(before + 3)
  await expect(landing).toHaveText('no part changed')
  expect(await ghosts()).toEqual([])
})

// Milestone 5 (M11): the kernel let the build go to make room for another's. No test's kernel is short of memory,
// so main is told it was (`__tornoMain.letGo`): the status line says it in the words the tools use.
test('an object whose build the kernel let go says so in the status line', async () => {
  await expect.poll(async () => (await state()).build?.status, { timeout: 20_000 }).toBe('ok')
  await expect(page.locator('.status-letgo')).toHaveCount(0)
  await app.evaluate((_electron, id) => (globalThis as unknown as { __tornoMain: { letGo(id: string): void } }).__tornoMain.letGo(id), 'bracket')
  await expect.poll(async () => (await state()).build?.letGo).toBe('memory')
  await expect(page.locator('.status-letgo[data-part="let-go"]')).toHaveText(letGoText({ status: 'ok', letGo: 'memory' })!)
  expect(letGoText({ status: 'ok', letGo: 'memory' })).toBe('This build was let go to make room (memory): it is built again when something is asked of it.')
  // Nothing else of the build is said otherwise: it is the one there was.
  expect((await state()).build).toMatchObject({ objectId: 'bracket', status: 'ok', stale: false })
})

test('the workspace is written nowhere but under .torno/', async () => {
  const all = () => readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((path) => !existsSync(join(fixtures, path)) || path.includes('__pycache__'))
  // The builds kept (`.torno/history/`) are many and numbered: held to their own folder, and looked at by what they hold.
  const added = () => all().filter((path) => !path.includes('.torno/history/'))
  // Every object that was opened has its state file, built or not; it follows the last build by a second.
  // One that built has the picture of its card, what that is of, and the word to git to pass over the two.
  await expect
    .poll(() => added().sort())
    .toEqual(['bracket/.torno', 'bracket/.torno/.gitignore', 'bracket/.torno/builds.jsonl', 'bracket/.torno/history', 'bracket/.torno/scene.json', 'bracket/.torno/state.md', 'bracket/.torno/thumb.json', 'bracket/.torno/thumb.png', 'noscene/.torno', 'noscene/.torno/.gitignore', 'noscene/.torno/history', 'noscene/.torno/state.md', 'two/.torno', 'two/.torno/.gitignore', 'two/.torno/state.md'].sort())
  const kept = all().filter((path) => path.includes('.torno/history/'))
  expect(kept.length).toBeGreaterThan(0)
  // A build that failed is kept too (noscene has no scene to build), as an entry without a scene.
  expect(kept.every((path) => path.startsWith('bracket/.torno/history/') || path.startsWith('noscene/.torno/history/'))).toBe(true)
  expect(kept).toContain('bracket/.torno/history/index.json')
})

test.describe('the workspace is remembered', () => {
  test('one opened from the window is opened again at the next start', async () => {
    const home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-config-'))
    const config = join(home, 'torno', 'config.json')
    const workspace = join(home, 'objects')
    mkdirSync(join(workspace, 'thing'), { recursive: true })
    writeFileSync(join(workspace, 'thing', 'thing.py'), 'from build123d import Box\n\npart = Box(1, 2, 3)\n')
    try {
      // First launch: nothing remembered, so the prompt.
      const first = await launch({ TORNO_CONFIG: config })
      try {
        const firstPage = await first.firstWindow()
        await expect(firstPage.getByRole('button', { name: 'Open folder' })).toBeVisible()
        await expect(firstPage.locator('[data-region="left"]')).toHaveCount(0)
        // What choosing a folder in the dialog does, without the dialog.
        await firstPage.evaluate((dir) => window.torno.workspace.open(dir), workspace)
        await expect.poll(() => existsSync(config)).toBe(true)
        // And it is the first of the folders opened lately, which the first screen lists.
        expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({ workspace, recent: [workspace] })
      } finally {
        await first.close()
      }

      const second = await launch({ TORNO_CONFIG: config })
      try {
        const secondPage = await second.firstWindow()
        await expect(secondPage.locator('.object-row')).toHaveText(['thing'])
        await expect(secondPage.locator('.workspace-name')).toHaveText('objects')
      } finally {
        await second.close()
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

// Set TORNO_SHOTS=<dir> to write app-light.png and app-dark.png there: the
// whole window with an object open. TORNO_SHOTS_WORKSPACE and TORNO_SHOTS_OBJECT
// choose which (default: the fixture bracket). Each picture needs its own
// launch: on a hidden window capturePage() delivers one image and hangs on the
// next call, and page.screenshot() never returns.
for (const scheme of ['light', 'dark'] as const) {
  test(`screenshot of the window, ${scheme}`, async () => {
    const dir = process.env.TORNO_SHOTS
    test.skip(!dir, 'TORNO_SHOTS is not set')
    test.setTimeout(120_000)
    mkdirSync(dir!, { recursive: true })
    const objectId = process.env.TORNO_SHOTS_OBJECT ?? 'bracket'
    const shotApp = await launch({ TORNO_WORKSPACE: process.env.TORNO_SHOTS_WORKSPACE ?? root })
    try {
      const shotPage = await shotApp.firstWindow()
      await shotPage.emulateMedia({ colorScheme: scheme })
      await openListed(shotPage, objectId)
      await expect.poll(async () => (await state(shotPage)).build?.status, { timeout: 90_000 }).not.toBe('building')
      if (process.env.TORNO_SHOTS_ERROR) await shotPage.getByRole('button', { name: 'Build failed' }).click()
      await shotPage.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      const png = await shotApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
        return image.toPNG().toString('base64')
      })
      writeFileSync(join(dir!, `app-${scheme}${process.env.TORNO_SHOTS_ERROR ? '-error' : ''}.png`), Buffer.from(png, 'base64'))
    } finally {
      await shotApp.close()
    }
  })
}
