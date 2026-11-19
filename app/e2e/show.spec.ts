import { createHash } from 'node:crypto'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { SESSION_HEADER } from '../src/main/http'
import { inTerminal } from './terminal'
import { foldSection, openSection, railButton, showProjects, newSession } from './helpers'
import { openListed, projectCard, projectCrumb, projectMenu, shelfOf } from './objects'
import type { TornoState } from '../src/renderer/state/store'
import type { ObjectCard } from '../src/shared/show'

// The page of objects: a card for each object of the workspace, with the picture the window drew of its last
// build, how it stands and what is open on it. Nothing is built for a card. The window is hidden throughout.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

function copyFixtures(name: string): string {
  const made = mkdtempSync(join(realpathSync(tmpdir()), name))
  cpSync(fixtures, made, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  return made
}

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
const launch = (workspace: string): Promise<ElectronApplication> => electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: workspace } })

test.beforeAll(async () => {
  root = copyFixtures('torno-e2e-show-')
  // One test here drives the agent's terminal, in plain.
  inTerminal(root, ['plain'])
  // bracket was last looked at with its post switched off and cut across: its picture is of that.
  mkdirSync(join(root, 'bracket', '.torno'), { recursive: true })
  writeFileSync(join(root, 'bracket', '.torno', 'scene.json'), JSON.stringify({ layout: 'assembly', layers: { post: { visible: false } }, section: { origin: [0, 0, 0], normal: [0, 1, 0] } }))
  app = await launch(root)
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
  await page.emulateMedia({ colorScheme: 'light' })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (p: Page = page): Promise<TornoState> => p.evaluate(() => window.__tornoTest!.state())
const opened = (a: ElectronApplication = app): Promise<string[]> => a.evaluate(() => (globalThis as unknown as { __tornoMain: { opened(): string[] } }).__tornoMain.opened())
const card = (id: string, p: Page = page) => p.locator(`.card[data-object="${id}"]`)
const thumb = (id: string, file = 'thumb.png'): string => join(root, id, '.torno', file)
const meta = (id: string): Record<string, unknown> => JSON.parse(readFileSync(thumb(id, 'thumb.json'), 'utf8'))
const focusedCard = (p: Page = page): Promise<string | null> => p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.object ?? null)
/** The alpha of a pixel of the picture a card shows, at fractions of its width and height. */
const alphaAt = (id: string, fx: number, fy: number): Promise<number> =>
  card(id).locator('img').evaluate((img: HTMLImageElement, [x, y]) => {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data[3]
  }, [fx, fy])

test('the page of objects shows a card each, builds nothing, and opens one with a click', async () => {
  // A workspace of several objects starts on the page.
  expect((await state()).page).toBe('objects')
  await expect(page.locator('.card')).toHaveCount((await state()).workspace!.objects.length)
  await expect(page.getByRole('region', { name: /^Projects of torno-e2e-show-/ })).toBeVisible()
  // Not built in this run: it says when its model was saved, read from the files; the plain fact is the tooltip.
  await expect(card('hollow')).toContainText(/Model saved .* ago|just now|Not opened in this run/)
  await expect(page.locator('.show-head')).toBeVisible()
  // A project with no picture has no size to draw: a dashed box says so, and no size is claimed.
  await expect(card('hollow')).toContainText('Size not known until it builds')
  await expect(card('hollow')).not.toContainText(' mm')
  const room = (await card('hollow').locator('.bench-ghost').boundingBox())!
  expect([Math.round(room.width), Math.round(room.height)]).toEqual([120, 80])
  await expect(card('hollow').locator('.bench-ghost')).toHaveCSS('border-top-style', 'dashed')
  await card('hollow').hover()
  // One that cannot be built says why, as the list does.
  await expect(card('two')).toContainText('more than one model file')
  // With no object open the rail holds Projects and Keys alone, and there is no card.
  await expect(page.locator('[data-region="left"] .route-card')).toHaveCount(0)
  // Looking at the page built nothing, and wrote nothing.
  expect(await opened()).toEqual([])
  expect(existsSync(join(root, 'hollow', '.torno'))).toBe(false)
  await card('hollow').click()
  await expect.poll(async () => (await state()).build?.status).toBe('ok')
  expect((await state()).page).toBe('object')
  // Its picture is made from that build, without anything more being asked of the kernel.
  await expect.poll(() => existsSync(thumb('hollow'))).toBe(true)
  const bytes = readFileSync(thumb('hollow'))
  expect([...bytes.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG')
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([480, 360])
  await expect.poll(() => existsSync(thumb('hollow', 'thumb.json'))).toBe(true)
  expect(meta('hollow')).toMatchObject({ layout: 'assembly', parts: 2, model: 'hollow.py' })
  expect(meta('hollow')).not.toHaveProperty('cut')
  // Git passes over the two: they change with every build.
  // And the state file, which changes with every build and every mark.
  await expect.poll(() => readFileSync(thumb('hollow', '.gitignore'), 'utf8').split('\n').filter(Boolean).sort()).toEqual(['builds.jsonl', 'history/', 'state.md', 'thumb.json', 'thumb.png'])
  // Nothing of it outside .torno.
  expect(readdirSync(join(root, 'hollow')).sort()).toEqual(['.torno', 'hollow.py'])
  await showProjects(page)
  await expect(card('hollow')).toContainText('Built, r1')
  // A build of this run is said in ink behind the status line's dot; an object not opened here has neither.
  await expect(card('hollow').locator('[data-part="build"]')).toHaveAttribute('data-status', 'ok')
  await expect(card('hollow').locator('[data-part="build"] .status-dot')).toHaveCount(1)
  await expect(card('plain').locator('[data-part="build"]')).not.toHaveAttribute('data-status')
  await expect(card('plain').locator('.status-dot')).toHaveCount(0)
  await expect(card('hollow')).toHaveAttribute('aria-current', 'true')
  await expect(card('hollow').locator('img')).toHaveJSProperty('naturalWidth', 480)
  // Parts on a clear ground: the card's own surface shows round them, in either theme.
  expect(await alphaAt('hollow', 0.01, 0.01)).toBe(0)
  expect(await alphaAt('hollow', 0.5, 0.5)).toBe(255)
  // The 3D view is under the page as it was, and takes nothing meanwhile.
  await expect(page.locator('.viewport-pane')).toHaveAttribute('inert', '')
  expect((await state()).objectId).toBe('hollow')
})

test('a card says when its picture is older than the model, and a second object gets its picture while the first is shown', async () => {
  await card('plain').click()
  await expect.poll(async () => (await state()).build?.status).toBe('ok')
  await expect.poll(() => existsSync(thumb('plain'))).toBe(true)
  // hollow is still watched, but plain is on screen: saved again, it is not built (#175). Its card says it is behind.
  const before = statSync(thumb('hollow')).mtimeMs
  await new Promise((r) => setTimeout(r, 1100)) // so that its save is newer than its picture, whatever the clock's grain
  appendFileSync(join(root, 'hollow', 'hollow.py'), '\n# touched\n')
  await new Promise((r) => setTimeout(r, 1500)) // past the watcher's wait: a build would have started
  await showProjects(page)
  await expect(card('hollow')).toContainText('A source has changed since')
  expect(statSync(thumb('hollow')).mtimeMs).toBe(before)
  // Opened, it is built and pictured.
  await card('hollow').click()
  await expect.poll(() => statSync(thumb('hollow')).mtimeMs, { timeout: 30_000 }).toBeGreaterThan(before)
  expect((await state()).objectId).toBe('hollow')
  // The picture's facts keep the kernel's size of what it is of, and say it is at the bench's scale.
  const kept = meta('hollow') as { box?: { x: number; y: number; z: number; exact: boolean }; bench?: boolean }
  expect(kept.bench).toBe(true)
  expect(kept.box).toEqual({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number), exact: expect.any(Boolean) })
  expect(kept.box!.x).toBeGreaterThan(0)
  // A picture older than its model says so.
  await expect.poll(() => meta('hollow').sourcesMtimeMs).toBe(statSync(join(root, 'hollow', 'hollow.py')).mtimeMs)
  // Its facts say which picture they are of: its size and what its bytes hash to.
  expect(meta('hollow')).toMatchObject({ bytes: statSync(thumb('hollow')).size, hash: createHash('sha256').update(readFileSync(thumb('hollow'))).digest('hex') })
  writeFileSync(thumb('hollow', 'thumb.json'), JSON.stringify({ ...meta('hollow'), sourcesMtimeMs: 1 }))
  await showProjects(page)
  await expect(card('hollow')).toContainText('A source has changed since')
  await expect(card('plain')).not.toContainText('A source has changed since')
  // The next test has plain on screen, as this one began.
  await card('plain').click()
  await expect.poll(async () => (await state()).objectId).toBe('plain')
  await showProjects(page)
})

test('the page is a bench: pictures side by side at one scale on a shelf, a size only where the kernel gave one, and True scale or Grid', async () => {
  expect((await state()).page).toBe('objects')
  // Nobody needs you and nothing works: the rest alone, on one shelf, with no bar.
  await expect(shelfOf(page, 'The rest').getByRole('heading', { level: 3 })).toContainText('most recently changed first, all at the same scale')
  await expect(shelfOf(page, 'Needs you')).toHaveCount(0)
  await expect(shelfOf(page, 'Working')).toHaveCount(0)
  await expect(page.locator('.shelf').first()).toHaveCSS('padding-left', '20px')
  await expect(page.locator('.sbar')).toHaveCount(0)
  expect(await page.locator('.shelf').first().evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none')
  await expect(page.locator('.show-head h2')).toHaveText(root.split('/').pop()!)
  // Their sizes are the kernel's, in the monospace face, and said only for a project with a picture at scale.
  const kept = (id: string) => meta(id) as { box: { x: number; y: number; z: number; exact: boolean } }
  for (const id of ['hollow', 'plain']) {
    await expect(card(id).locator('.card-size')).toHaveText(new RegExp(`^${kept(id).box.exact ? '' : '≈ '}[\\d.]+ × [\\d.]+ × [\\d.]+ mm$`))
    await expect(card(id).locator('.card-size')).toHaveCSS('font-family', /Martian Mono/)
  }
  await expect(card('gauge')).toContainText('Size not known until it builds')
  await expect(card('gauge').locator('.card-size')).toHaveCount(0)
  // One scale for the page: the width a picture takes is its box projected, over one factor, whichever project it is.
  const figure = async (id: string): Promise<{ w: number; h: number }> => {
    const box = (await card(id).locator('.bench-fig').boundingBox())!
    return { w: box.width, h: box.height }
  }
  const projected = (id: string): number => (kept(id).box.x + kept(id).box.y) * Math.SQRT1_2
  const [hollow, plain] = [await figure('hollow'), await figure('plain')]
  const perMm = (hollow.w - 4) / projected('hollow')
  expect((plain.w - 4) / projected('plain')).toBeGreaterThan(perMm * 0.85)
  expect((plain.w - 4) / projected('plain')).toBeLessThan(perMm * 1.15)
  // Nothing runs out of the page, and the pictures shown are the parts, not the picture's whole clear ground.
  const fits = await page.evaluate(() => {
    const show = document.querySelector<HTMLElement>('.show')!
    const bench = document.querySelector<HTMLElement>('.bench')!
    return { show: [show.scrollWidth, show.clientWidth], bench: [bench.offsetWidth, bench.scrollWidth, getComputedStyle(bench).zoom], innerHeight: window.innerHeight, shelves: [...document.querySelectorAll<HTMLElement>('.shelf')].map((shelf) => [shelf.scrollWidth, shelf.clientWidth]) }
  })
  expect(fits.shelves.every(([scroll, client]) => scroll <= client + 1) && fits.show[0] <= fits.show[1]).toBe(true)
  // The rest is by the last save of the model, newest first, unless By name is chosen (kept for the folder).
  const restIds = (): Promise<string[]> => shelfOf(page, 'The rest').locator('.card').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.object!))
  const orders = page.getByRole('group', { name: 'Order of the projects' })
  await expect(orders.getByRole('button', { name: 'Recently changed' })).toHaveAttribute('aria-pressed', 'true')
  const recent = await restIds()
  expect(recent[0]).toBe('hollow')
  await orders.getByRole('button', { name: 'By name' }).click()
  await expect(shelfOf(page, 'The rest').getByRole('heading', { level: 3 })).toContainText('by name, all at the same scale')
  expect(await restIds()).toEqual([...recent].sort((a, b) => (a < b ? -1 : 1)))
  expect(await page.evaluate(() => localStorage.getItem(`torno.show.order:${window.__tornoTest!.state().workspace!.root}`))).toBe('name')
  await orders.getByRole('button', { name: 'Recently changed' }).click()
  expect(await restIds()).toEqual(recent)
  // Grid: the same projects, every picture in a box of one size.
  await page.getByRole('group', { name: 'How the projects are drawn' }).getByRole('button', { name: 'Grid' }).click()
  await expect(page.locator('.bench')).toHaveAttribute('data-mode', 'grid')
  for (const id of ['hollow', 'plain']) {
    const box = (await card(id).locator('.bench-fig').boundingBox())!
    expect(box.width).toBeLessThanOrEqual(160.5)
    expect(box.height).toBeLessThanOrEqual(120.5)
  }
  expect(await page.evaluate(() => localStorage.getItem(`torno.show.mode:${window.__tornoTest!.state().workspace!.root}`))).toBe('grid')
  await page.getByRole('group', { name: 'How the projects are drawn' }).getByRole('button', { name: 'True scale' }).click()
  await expect(page.locator('.bench')).toHaveAttribute('data-mode', 'scale')
  await expect(page.locator('.sbar')).toHaveCount(0)
  // The one that is open stands with Open and a bar of the accent under its picture.
  await expect(card('plain')).toHaveAttribute('aria-current', 'true')
  await expect(card('plain').locator('.card-open')).toHaveText('Open')
  // At 1280 × 800 the page is drawn at 86 % rather than wrap the shelves, and nothing runs out of it.
  const was = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(800)
  await expect(page.locator('.bench')).toHaveCSS('zoom', '0.86')
  const small = await page.evaluate(() => ({ show: [document.querySelector<HTMLElement>('.show')!.scrollWidth, document.querySelector<HTMLElement>('.show')!.clientWidth], shelves: [...document.querySelectorAll<HTMLElement>('.shelf')].map((shelf) => [shelf.scrollWidth, shelf.clientWidth]) }))
  expect(small.show[0]).toBeLessThanOrEqual(small.show[1])
  for (const [scroll, client] of small.shelves) expect(scroll).toBeLessThanOrEqual(client + 1)
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), was)
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(was[1])
  await expect(page.locator('.bench')).toHaveCSS('zoom', '1')
})

test('a picture is of the object as it was last looked at, and says what it leaves out', async () => {
  await card('bracket').click()
  await expect.poll(async () => (await state()).build?.status).toBe('ok')
  await expect.poll(() => existsSync(thumb('bracket', 'thumb.json'))).toBe(true)
  expect(meta('bracket')).toMatchObject({ layout: 'assembly', parts: 1, cut: true, hidden: 1, model: 'bracket.py' })
  await page.keyboard.press('w')
  await expect(card('bracket')).toContainText('cut by its section, 1 part left out')
  await expect(card('bracket').locator('img')).toHaveJSProperty('naturalWidth', 480)
})

test('a picture costs a few milliseconds, and leaves the view as it was', async () => {
  await page.keyboard.press('Escape')
  expect(await state()).toMatchObject({ page: 'object', objectId: 'bracket' })
  /** A picture of the view through the `look` path, as a number that is another for another picture. */
  const looked = (): Promise<number> =>
    page.evaluate(async () => {
      const { png } = await window.__tornoTest!.look({ view: 'iso', size: 320, marks: false })
      let hash = 2166136261
      for (const byte of png) hash = Math.imul(hash ^ byte, 16777619) >>> 0
      return hash
    })
  const before = await looked()
  const timed = await page.evaluate(() => window.__tornoTest!.timeThumbnail(20))
  console.log(`[show] a thumbnail of bracket: mean ${timed.meanMs.toFixed(1)} ms, worst ${timed.worstMs.toFixed(1)} ms, ${(timed.bytes / 1024).toFixed(1)} KB`)
  expect(timed.bytes).toBeGreaterThan(1000)
  expect(timed.meanMs).toBeLessThan(100)
  // The same picture of the view as before: its target, its ground and its cut are as they were.
  expect(await looked()).toBe(before)
  // With a button held in the view the page does not come up: it would take the view from under the drag.
  const canvas = (await page.locator('.viewport-canvas').boundingBox())!
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width / 2 + 30, canvas.y + canvas.height / 2 + 10, { steps: 3 })
  await page.keyboard.press('w')
  expect((await state()).page).toBe('object')
  await page.mouse.up()
  await page.keyboard.press('w')
  expect((await state()).page).toBe('objects')
})

// What a picture of a large part costs: a mesh made here, of a million triangles in one face (a surface of
// 708 × 708 squares), handed to the thumbnailer as a build's meshes are. No kernel is asked for it.
// Measured with marks around each step (fix round 1): 7 ms to build the part, 21 to 49 ms to draw it, 6 to 35 ms
// to read it back; and then, in this hidden window, exactly 1,001 ms in which not even a zero timeout runs
// before the PNG comes: the second a hidden window waits for a frame it is never given. Hence the bound.
test('a picture of a part of a million triangles is drawn, and costs the window no more than a moment', async () => {
  test.setTimeout(120_000)
  await page.keyboard.press('Escape')
  const timed = await page.evaluate(async () => {
    const n = 708
    const vertices = new Float32Array((n + 1) * (n + 1) * 3)
    const normals = new Float32Array(vertices.length)
    for (let j = 0, v = 0; j <= n; j++) for (let i = 0; i <= n; i++, v += 3) {
      vertices.set([(i / n) * 200 - 100, (j / n) * 200 - 100, 12 * Math.sin(i / 40) * Math.cos(j / 55)], v)
      normals.set([0, 0, 1], v)
    }
    const triangles = new Uint32Array(n * n * 6)
    for (let j = 0, t = 0; j < n; j++) for (let i = 0; i < n; i++, t += 6) {
      const a = j * (n + 1) + i
      triangles.set([a, a + 1, a + n + 2, a, a + n + 2, a + n + 1], t)
    }
    const rim = new Float32Array([-100, -100, 0, 100, -100, 0])
    const counts = [new Uint32Array([n * n * 2]), new Uint32Array([1]), new Uint32Array([0]), new Uint32Array([0])]
    const pieces = [vertices, normals, triangles, rim, ...counts]
    const blob = new ArrayBuffer(pieces.reduce((sum, piece) => sum + piece.byteLength, 0))
    const bufs: Array<{ offset: number; length: number }> = []
    let offset = 0
    for (const piece of pieces) {
      new Uint8Array(blob, offset, piece.byteLength).set(new Uint8Array(piece.buffer))
      bufs.push({ offset, length: piece.byteLength })
      offset += piece.byteLength
    }
    const [v, nrm, tri, edges, trianglesPerFace, segmentsPerEdge, faceTypes, edgeTypes] = bufs
    const part = { key: 'main:sheet', name: 'sheet', layout: 'main', loc: { t: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number] }, bbox: { min: [-100, -100, -12] as [number, number, number], max: [100, 100, 12] as [number, number, number] }, volume: 0, faceCount: 1, edgeCount: 1, triangleCount: n * n * 2, valid: true, hash: 'sheet', mesh: { vertices: v, normals: nrm, triangles: tri, edges, trianglesPerFace, segmentsPerEdge, faceTypes, edgeTypes } }
    const scene = { model: 'sheet.py', layouts: ['main'], parts: [part], seconds: 0, output: '' }
    const first = await window.__tornoTest!.timeThumbnail(1, { scene, blob })
    const more = await window.__tornoTest!.timeThumbnail(5, { scene, blob })
    return { triangles: n * n * 2, megabytes: blob.byteLength / 2 ** 20, firstMs: first.meanMs, meanMs: more.meanMs, worstMs: more.worstMs, bytes: more.bytes }
  })
  console.log(`[show] a thumbnail of ${timed.triangles} triangles (${timed.megabytes.toFixed(1)} MB of meshes): first ${timed.firstMs.toFixed(0)} ms, then mean ${timed.meanMs.toFixed(0)} ms, worst ${timed.worstMs.toFixed(0)} ms, PNG ${(timed.bytes / 1024).toFixed(1)} KB`)
  expect(timed.bytes).toBeGreaterThan(1000)
  expect(timed.worstMs).toBeLessThan(3000)
  await page.keyboard.press('w')
})

test('the keys go from card to card, filter by name, open, and go back; none of them reaches a tool', async () => {
  // W brought the page up over bracket, whose card has the focus.
  expect((await state()).page).toBe('objects')
  await expect.poll(() => focusedCard()).toBe('bracket')
  const ids = (await state()).workspace!.objects.map((o) => o.id)
  // The cards are in the order the shelves show them, which is what the arrows follow.
  const order = (): Promise<string[]> => page.locator('.card').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.object!))
  const shown = await order()
  expect([...shown].sort()).toEqual([...ids].sort())
  const at = shown.indexOf('bracket')
  await page.keyboard.press('ArrowRight')
  expect(await focusedCard()).toBe(shown[at + 1])
  await page.keyboard.press('ArrowLeft')
  expect(await focusedCard()).toBe('bracket')
  // Up and down go by the shelves: to the line below, and back to the one above.
  const line = (id: string): Promise<number> => card(id).evaluate((el) => Number((el as HTMLElement).dataset.line))
  const lines = await page.locator('.card').evaluateAll((els) => new Set(els.map((el) => (el as HTMLElement).dataset.line)).size)
  expect(lines).toBeGreaterThan(1)
  await page.keyboard.press('Home')
  expect(await focusedCard()).toBe(shown[0])
  await page.keyboard.press('ArrowDown')
  const below = (await focusedCard())!
  expect(await line(below)).toBe((await line(shown[0])) + 1)
  await page.keyboard.press('ArrowUp')
  expect(await line((await focusedCard())!)).toBe(await line(shown[0]))
  await page.keyboard.press('End')
  expect(await focusedCard()).toBe(shown[shown.length - 1])
  // A letter goes into the filter: P is the Pin tool's key in the view, and is no tool's here.
  await page.keyboard.type('pl')
  const field = page.getByRole('textbox', { name: 'Filter the projects by name' })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('pl')
  await expect(page.locator('.card')).toHaveCount(1)
  await expect(page.locator('.show-count')).toHaveText(`1 of ${ids.length} projects in ${root}`)
  // Enter opens the first that is left.
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await state()).objectId).toBe('plain')
  expect((await state()).page).toBe('object')
  await expect(page.locator('.viewport-pane')).not.toHaveAttribute('inert')
  await expect(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: /^Pin/ })).toHaveAttribute('aria-pressed', 'false')
  // And back: W, then a name that is nobody's, Escape to see them all, Escape to the object.
  await page.keyboard.press('w')
  await expect(page.locator('.card')).toHaveCount(ids.length)
  await expect.poll(() => focusedCard()).toBe('plain')
  await page.keyboard.press('/')
  await expect(field).toBeFocused()
  await page.keyboard.type('zzz')
  await expect(page.locator('.show-none')).toContainText('No project is named like zzz')
  await page.keyboard.press('Escape')
  await expect(page.locator('.card')).toHaveCount(ids.length)
  expect((await state()).page).toBe('objects')
  await page.keyboard.press('Escape')
  expect(await state()).toMatchObject({ page: 'object', objectId: 'plain' })
})

test('main keeps a picture only of the last build of an object opened here, and only bytes that are one', async () => {
  const revision = (await state()).revision
  const kept = () => readFileSync(thumb('plain'))
  const before = kept()
  const result = await page.evaluate(async (rev) => {
    const png = new Uint8Array((await window.torno.show.thumbnail('plain'))!)
    const of = { layout: 'main', parts: 1 }
    // One that is kept: of the last build of an object opened here.
    window.torno.show.saveThumbnail('plain', rev, png, { ...of, layout: 'kept' })
    // Then: of an object not opened in this run; of another build than the last; no PNG; a PNG of another size;
    // one that is too heavy; of no layout; of an object that is no object of the workspace.
    window.torno.show.saveThumbnail('gauge', rev, png, of)
    window.torno.show.saveThumbnail('plain', rev + 1, png, { ...of, layout: 'another build' })
    window.torno.show.saveThumbnail('plain', rev, new Uint8Array(4000), { ...of, layout: 'no png' })
    const wide = png.slice()
    new DataView(wide.buffer).setUint32(16, 4000)
    window.torno.show.saveThumbnail('plain', rev, wide, { ...of, layout: 'too wide' })
    const heavy = new Uint8Array(600 * 1024)
    heavy.set(png)
    window.torno.show.saveThumbnail('plain', rev, heavy, { ...of, layout: 'too heavy' })
    window.torno.show.saveThumbnail('plain', rev, png, { layout: '', parts: 1 })
    window.torno.show.saveThumbnail('../plain', rev, png, { ...of, layout: 'elsewhere' })
    return { asked: await window.torno.show.thumbnail('gauge'), elsewhere: await window.torno.show.thumbnail('../plain') }
  }, revision)
  expect(result).toEqual({ asked: null, elsewhere: null })
  await expect.poll(() => meta('plain').layout).toBe('kept')
  // Each of the others was looked at before that one was on file, and a write takes a few milliseconds: none follows.
  await page.waitForTimeout(400)
  expect(meta('plain').layout).toBe('kept')
  expect(kept().equals(before)).toBe(true)
  expect(existsSync(join(root, 'gauge', '.torno'))).toBe(false)
  expect(await opened()).toEqual(['hollow', 'plain', 'bracket'])
})

test('a card counts what is open on an object from its file, and gives no verdict of a build it has not seen', async () => {
  // gauge was never opened in this run. Its marks are read from its file, which is left as it is.
  const camera = { position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0], ortho: true, fov: 35, zoom: 1 }
  const pin = (id: string, status: string) => ({ id, kind: 'pin', author: 'user', note: 'here', status, anchorState: 'ok', layout: 'main', revision: 1, camera, createdAt: '2026-10-08T21:00:00.000Z', anchor: { point: [0, 0, 0] } })
  const file = JSON.stringify({ next: 4, marks: [pin('M1', 'draft'), pin('M2', 'resolved'), { ...pin('M3', 'sent'), kind: 'dimension', measure: 'distance', a: { point: [0, 0, 0] }, b: { point: [0, 0, 6] }, value: 6, expected: 8, anchor: undefined }] })
  mkdirSync(join(root, 'gauge', '.torno'), { recursive: true })
  writeFileSync(join(root, 'gauge', '.torno', 'marks.json'), file)
  // A file that is no marks file is said, and neither set aside nor rewritten.
  mkdirSync(join(root, 'morph', '.torno'), { recursive: true })
  writeFileSync(join(root, 'morph', '.torno', 'marks.json'), '{ not json')
  await page.keyboard.press('w')
  const cards = (): Promise<ObjectCard[]> => page.evaluate(() => window.torno.show.cards())
  await expect.poll(async () => (await cards()).find((c) => c.id === 'gauge')).toMatchObject({ opened: false, marks: { open: 2, drafts: 1 }, dimensions: null, lastRun: { dimensions: 1, failed: 1 } })
  expect((await cards()).find((c) => c.id === 'morph')).toMatchObject({ opened: false, marks: null })
  // The page asks again when something a card says changes; a file changed by hand is seen at the next asking.
  await page.keyboard.press('Escape')
  await page.keyboard.press('w')
  await expect(card('gauge')).toContainText('2 open marks')
  await expect(card('gauge')).toContainText('1 not sent yet')
  await expect(card('gauge')).toContainText('1 dimension failed as of its last run')
  await expect(card('gauge').locator('.card-chip[data-tone="fail"], .card-chip[data-tone="ok"]')).toHaveCount(0)
  await expect(card('morph')).toContainText('Marks could not be read')
  expect(readFileSync(join(root, 'gauge', '.torno', 'marks.json'), 'utf8')).toBe(file)
  expect(readdirSync(join(root, 'morph', '.torno'))).toEqual(['marks.json'])
  expect(await opened()).toEqual(['hollow', 'plain', 'bracket'])
  await page.keyboard.press('Escape')
})

test('a build that fails wins over the picture, which stays and is dimmed', async () => {
  appendFileSync(join(root, 'plain', 'plain.py'), '\nraise ValueError("too thin")\n')
  await expect.poll(async () => (await state()).build?.status, { timeout: 20_000 }).toBe('failed')
  await page.keyboard.press('w')
  await expect(card('plain')).toContainText('Failed: too thin')
  await expect(card('plain').locator('[data-part="build"]')).toHaveAttribute('data-tone', 'fail')
  await expect(card('plain')).toContainText('of the last build that worked')
  await expect(card('plain').locator('.card-picture')).toHaveAttribute('data-dimmed', '')
  await page.keyboard.press('Escape')
})

test('the rail holds Projects and Keys alone while the page is up, and Escape closes what is on top first', async () => {
  // plain is open, and failed: the page comes up over it.
  await page.keyboard.press('w')
  expect((await state()).page).toBe('objects')
  // The sections of the card act on a view that is not on screen while the page is up: the card is away and the rail
  // has no icon for them (final fix wave). Projects, pressed, and Keys remain.
  for (const name of ['Needs you', 'Parts', 'Parameters', 'Checks', 'Marks', 'Scans', 'Tracings', 'Print profile'] as const) await expect(railButton(page, name)).toHaveCount(0)
  for (const name of ['Projects', 'Keys'] as const) await expect(railButton(page, name)).toBeVisible()
  await expect(railButton(page, 'Projects')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-region="left"] .route-card')).toHaveCount(0)
  await expect(page.locator('[data-region="left"]').getByRole('slider')).toHaveCount(0)
  // The build's error, opened from the status line, is over the page: Escape closes it, and the page stays.
  await page.locator('.status-fail').click()
  const sheet = page.getByRole('dialog', { name: 'Build error' })
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  expect((await state()).page).toBe('objects')
  // A question asked in the left column: Escape answers it with the answer that changes nothing, and the page stays.
  await newSession(page.locator('[data-region="session"]'))
  await expect.poll(() => page.evaluate(() => window.__tornoTerm!.text())).toContain('READY')
  await page.locator('.session-term textarea').focus()
  await page.keyboard.type('hook')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-region="session"]').getByRole('status')).toHaveText('Working')
  expect((await state()).page).toBe('objects')
  // The folder crumb of the title bar is a menu: the dialog is one of its ways.
  await page.getByRole('button', { name: /^Folder / }).click()
  await page.getByRole('menuitem', { name: 'Open folder…' }).click()
  const ask = page.getByRole('alertdialog', { name: 'End the sessions of this folder?' })
  await expect(ask).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ask).toHaveCount(0)
  expect((await state()).page).toBe('objects')
  expect(await app.evaluate(() => (globalThis as unknown as { __tornoMain: { picks: number } }).__tornoMain.picks)).toBe(0)
  // With nothing over it, Escape is the page's again.
  await page.keyboard.press('Escape')
  expect(await state()).toMatchObject({ page: 'object', objectId: 'plain' })
  // What had the focus when the page came up has it again when the page goes.
  const all = railButton(page, 'Projects')
  await all.focus()
  await page.keyboard.press('Enter')
  expect((await state()).page).toBe('objects')
  await expect.poll(() => focusedCard()).toBe('plain')
  await page.keyboard.press('Escape')
  expect((await state()).page).toBe('object')
  await expect(all).toBeFocused()
})

test('the page of projects has a card for every project, the project menu opens another, and what is folded in the card is the window\'s', async () => {
  // hollow open, from the project crumb, and the page has a card for every project of the workspace.
  expect((await state()).page).toBe('object')
  await openListed(page, 'hollow')
  await expect.poll(async () => (await state()).build).toMatchObject({ objectId: 'hollow', status: 'ok' })
  const count = (await state()).workspace!.objects.length
  expect(count).toBeGreaterThanOrEqual(15)
  await showProjects(page)
  await expect(page.locator('.title-row .workspace-name')).toBeVisible()
  await expect(page.locator('.show .card')).toHaveCount(count)
  await expect(projectCard(page, 'hollow')).toHaveAttribute('aria-current', 'true')
  // One that cannot be built is marked.
  await expect(projectCard(page, 'two')).toHaveAttribute('data-problem', '')
  // Another project, opened by its card; the card is back beside the rail.
  await projectCard(page, 'bracket').click()
  await expect.poll(async () => (await state()).objectId).toBe('bracket')
  await expect(page.locator('[data-region="left"] .route-card')).toHaveCount(1)
  await expect(railButton(page, 'Projects')).toHaveAttribute('aria-pressed', 'false')
  // The project crumb's menu has All projects at its head, then every project; the open one is current.
  await projectCrumb(page).click()
  const menu = projectMenu(page)
  await expect(menu.getByRole('menuitem')).toHaveCount(count + 1)
  await expect(menu.getByRole('menuitem').first()).toHaveText(/^All projects/)
  await expect(menu.getByRole('menuitem', { name: 'bracket', exact: true })).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Escape')
  // The window keeps which sections are folded, in its own storage: nothing of it is in the workspace.
  expect(readdirSync(join(root, 'hollow', '.torno'))).not.toContain('column.json')
  await foldSection(page, 'Parts')
  await expect(page.locator('[data-region="left"] .layers')).toHaveCount(0)
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('torno.column')))!).folded).toContain('parts')
  await openSection(page, 'Parts')
  await expect(page.locator('[data-region="left"]').getByRole('region', { name: 'Parts' })).toBeVisible()
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('torno.column')))!).folded).not.toContain('parts')
  await openSection(page, 'Marks')
})

// Who needs you stands first. Its own window: the sessions here are the stand-in's, and a chat of its own needs a home that is not the person's.
test('who needs you stands first: Claude\'s question with Answer, who works beside it, and the rest under them', async () => {
  test.setTimeout(120_000)
  const own = copyFixtures('torno-e2e-show-needs-')
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-show-home-'))
  inTerminal(own, ['measures'])
  const ownApp = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: own } })
  try {
    const p = await ownApp.firstWindow()
    await p.waitForSelector('[data-region="left"]')
    await p.emulateMedia({ colorScheme: 'light' })
    const dock = p.locator('[data-region="session"]')
    // measures: a session at work in its terminal, the stand-in posting the hooks the CLI would.
    await openListed(p, 'measures')
    await newSession(dock)
    await p.locator('.session-term textarea').focus()
    await p.keyboard.type('hook')
    await p.keyboard.press('Enter')
    await expect(dock.getByRole('status').first()).toHaveText('Working')
    // bracket: Claude asks, through torno's own ask.
    await openListed(p, 'bracket')
    await expect.poll(async () => (await state(p)).build, { timeout: 30_000 }).toMatchObject({ objectId: 'bracket', status: 'ok' })
    await newSession(dock)
    await expect(dock.locator('[data-chat-composer]')).toBeEnabled()
    const { url, token } = await ownApp.evaluate((_electron, id) => (globalThis as unknown as { __tornoMain: { mcpFor(id: string): { url: string; token: string } } }).__tornoMain.mcpFor(id), 'bracket')
    const client = new Client({ name: 'torno-e2e', version: '0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { [SESSION_HEADER]: token } } }))
    try {
      const waiting = client.callTool({ name: 'ask', arguments: { question: 'Which wall do you mean?', options: [{ label: 'The left wall', refs: [] }, { label: 'The right wall', refs: [] }] } })
      await expect(p.locator('.ask-question')).toBeVisible()
      await showProjects(p)
      const needs = shelfOf(p, 'Needs you')
      const working = shelfOf(p, 'Working')
      const rest = shelfOf(p, 'The rest')
      await expect(needs.getByRole('heading', { level: 3 })).toContainText('Needs you')
      await expect(needs.locator('.grp-n')).toHaveText('1')
      await expect(needs.locator('.card')).toHaveCount(1)
      await expect(needs.locator('.card')).toHaveAttribute('data-object', 'bracket')
      // What it waits on: Claude's question in a warning wash, how long, and the way to answer it.
      const ask = needs.locator('.askcard')
      await expect(ask).toContainText('Claude asks: Which wall do you mean?')
      await expect(ask).toContainText(/waiting (under 1 min|\d+ min)/)
      await expect(ask).toHaveCSS('max-width', '300px')
      await expect(needs.getByRole('heading', { level: 3 })).toHaveCSS('color', 'rgb(140, 92, 22)')
      // Working stands beside it, on a shelf of its own.
      await expect(working.locator('.card')).toHaveAttribute('data-object', 'measures')
      await expect(working.locator('.workcard')).toContainText('Claude Code is working')
      const [a, b] = [(await needs.boundingBox())!, (await working.boundingBox())!]
      expect(Math.abs(a.y - b.y)).toBeLessThan(2)
      expect(b.x).toBeGreaterThan(a.x + a.width - 1)
      // The rest are under them, and none of those two is among them.
      expect((await rest.boundingBox())!.y).toBeGreaterThan(a.y + a.height - 1)
      await expect(rest.locator('.card[data-object="bracket"], .card[data-object="measures"]')).toHaveCount(0)
      await expect(rest.locator('.card')).toHaveCount((await state(p)).workspace!.objects.length - 2)
      // The keys go through the shelves in the order of the page: who needs you first.
      expect(await p.locator('.card').first().getAttribute('data-object')).toBe('bracket')
      // Answer opens the project and brings the question up, where it is answered.
      await ask.getByRole('button', { name: 'Answer' }).click()
      await expect.poll(async () => (await state(p)).objectId).toBe('bracket')
      expect((await state(p)).page).toBe('object')
      await expect(p.locator('.ask-question')).toBeVisible()
      await p.locator('.ask-question').getByRole('button', { name: /The right wall/ }).click()
      await waiting
      await showProjects(p)
      await expect(needs).toHaveCount(0)
    } finally {
      await client.close()
    }
  } finally {
    await ownApp.close()
    rmSync(own, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

// Forty objects, none opened: what the page costs when it is the face of a full workspace. Thirty have a picture
// on file. Nothing is built, and only the pictures of the cards in view, or near it, are asked for.
test('with forty objects the page is there at once, builds nothing, and asks for the pictures in view only', async () => {
  test.setTimeout(90_000)
  const many = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-show-many-'))
  const picture = readFileSync(thumb('hollow'))
  const facts = { at: '2026-10-08T21:14:03.000Z', layout: 'assembly', parts: 2, bytes: picture.length, hash: createHash('sha256').update(picture).digest('hex') }
  const names = Array.from({ length: 40 }, (_, i) => `part-${String(i + 1).padStart(2, '0')}`)
  const later = Date.now() + 60_000
  for (const [i, name] of names.entries()) {
    mkdirSync(join(many, name, '.torno'), { recursive: true })
    writeFileSync(join(many, name, `${name.replace('-', '_')}.py`), readFileSync(join(fixtures, 'plain', 'plain.py')))
    // Saved a second apart, part-01 last: the shelf is in that order, newest first, and so the first rows are the first parts.
    utimesSync(join(many, name, `${name.replace('-', '_')}.py`), (later - 60_000 - i * 1000) / 1000, (later - 60_000 - i * 1000) / 1000)
    if (i % 4 !== 3) {
      writeFileSync(join(many, name, '.torno', 'thumb.png'), picture)
      writeFileSync(join(many, name, '.torno', 'thumb.json'), JSON.stringify({ ...facts, model: `${name.replace('-', '_')}.py`, sourcesMtimeMs: i % 8 === 0 ? 1 : later }))
    }
  }
  // part-02: another picture than its facts are of, of the same size. part-03: facts, and no picture.
  // part-05: a helper beside its model, saved after its picture was made.
  const other = Buffer.from(picture)
  other[other.length - 20] ^= 0xff
  writeFileSync(join(many, 'part-02', '.torno', 'thumb.png'), other)
  rmSync(join(many, 'part-03', '.torno', 'thumb.png'))
  writeFileSync(join(many, 'part-05', 'fits.py'), '# a helper\n')
  utimesSync(join(many, 'part-05', 'fits.py'), (later + 60_000) / 1000, (later + 60_000) / 1000)
  const manyApp = await launch(many)
  try {
    const manyPage = await manyApp.firstWindow()
    const started = Date.now()
    await expect(manyPage.locator('.card')).toHaveCount(40)
    const shownAfter = Date.now() - started
    const timed = await manyPage.evaluate(async () => {
      const times: number[] = []
      for (let i = 0; i < 10; i++) {
        const before = performance.now()
        await window.torno.show.cards()
        times.push(performance.now() - before)
      }
      times.sort((a, b) => a - b)
      return { median: times[5], worst: times[9] }
    })
    // Pictures: those of the cards in view have come; those far below have not been asked for.
    await expect(manyPage.locator('.card[data-object="part-01"] img')).toHaveJSProperty('naturalWidth', 480)
    const first = await manyPage.locator('.card img').count()
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(20)
    await expect(manyPage.locator('.card[data-object="part-38"] img')).toHaveCount(0)
    await expect(manyPage.locator('.card[data-object="part-01"]')).toContainText('A source has changed since')
    await expect(manyPage.locator('.card[data-object="part-04"]')).toContainText('Size not known until it builds')
    // A source that is not the model file: the helper beside it.
    await expect(manyPage.locator('.card[data-object="part-05"]')).toContainText('A source has changed since')
    await expect(manyPage.locator('.card[data-object="part-06"]')).not.toContainText('A source has changed since')
    // Facts without their picture, and a picture that is not the one its facts are of, are no picture: nothing is said of one.
    for (const id of ['part-02', 'part-03']) {
      await expect(manyPage.locator(`.card[data-object="${id}"]`)).toContainText('Size not known until it builds')
      await expect(manyPage.locator(`.card[data-object="${id}"]`)).not.toContainText('Picture of')
      await expect(manyPage.locator(`.card[data-object="${id}"] img`)).toHaveCount(0)
    }
    // The keys are said at the foot of the page, in view however far the cards go.
    await expect(manyPage.locator('.show-keys')).toBeInViewport()
    // Brought into view by the keys, the last ones get theirs.
    await manyPage.keyboard.press('End')
    await expect(manyPage.locator('.card[data-object="part-38"] img')).toHaveJSProperty('naturalWidth', 480)
    const atEnd = await manyPage.locator('.card img').count()
    expect(await opened(manyApp)).toEqual([])
    for (const name of names) expect(readdirSync(join(many, name, '.torno')).sort()).toEqual(name === 'part-03' ? ['thumb.json'] : names.indexOf(name) % 4 !== 3 ? ['thumb.json', 'thumb.png'] : [])
    console.log(`[show] 40 objects: cards on the page ${shownAfter} ms after the window; show.cards() median ${timed.median.toFixed(1)} ms, worst ${timed.worst.toFixed(1)} ms; pictures shown at first ${first} of 28, after End ${atEnd}`)
    expect(timed.median).toBeLessThan(250)
  } finally {
    await manyApp.close()
    rmSync(many, { recursive: true, force: true })
  }
})

// Set TORNO_SHOTS=<dir> to write show-light.png, show-dark.png, show-empty-light.png and show-empty-dark.png there:
// the page over a workspace whose objects stand in every way a card can say, and over one with no object. Each
// picture needs its own launch: on a hidden window capturePage() delivers one image and hangs on the next call,
// and page.screenshot() never returns.
for (const shot of ['light', 'dark', 'empty-light', 'empty-dark'] as const) {
  test(`screenshot of the page of objects, ${shot}`, async () => {
    const dir = process.env.TORNO_SHOTS
    test.skip(!dir, 'TORNO_SHOTS is not set')
    test.setTimeout(120_000)
    mkdirSync(dir!, { recursive: true })
    const empty = shot.startsWith('empty')
    const shotRoot = empty ? mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-show-empty-')) : copyFixtures('torno-e2e-show-shot-')
    if (!empty) {
      mkdirSync(join(shotRoot, 'bracket', '.torno'), { recursive: true })
      writeFileSync(join(shotRoot, 'bracket', '.torno', 'scene.json'), JSON.stringify({ layout: 'assembly', layers: {}, explode: { assembly: { amount: 0.5, scale: 1, axis: 'z' } } }))
      mkdirSync(join(shotRoot, 'measures', '.torno'), { recursive: true })
      writeFileSync(join(shotRoot, 'measures', '.torno', 'scene.json'), JSON.stringify({ layers: {}, section: { origin: [0, 0, 0], normal: [0, -1, 0] } }))
    }
    const shotApp = await launch(shotRoot)
    try {
      const shotPage = await shotApp.firstWindow()
      await shotPage.waitForSelector('[data-region="left"]')
      await shotPage.emulateMedia({ colorScheme: shot.endsWith('dark') ? 'dark' : 'light' })
      // A hidden window is not the one in use, and draws no focus: the page is told it is, so that the card in focus shows as it would.
      const devtools = await shotPage.context().newCDPSession(shotPage)
      await devtools.send('Emulation.setFocusEmulationEnabled', { enabled: true })
      const made = (id: string): string => join(shotRoot, id, '.torno', 'thumb.json')
      const open = async (id: string): Promise<void> => {
        await shotPage.locator(`.card[data-object="${id}"]`).click()
        await expect.poll(async () => (await state(shotPage)).build?.status, { timeout: 60_000 }).toBe('ok')
        await expect.poll(() => existsSync(made(id))).toBe(true)
        await shotPage.keyboard.press('w')
      }
      if (!empty) {
        for (const id of ['hollow', 'bracket', 'measures', 'spread', 'gauge', 'plain']) await open(id)
        // gauge and spread as a run before left them: pictures on file, the model of one saved since, marks in their files.
        const camera = { position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0], ortho: true, fov: 35, zoom: 1 }
        const pin = (id: string, status: string) => ({ id, kind: 'pin', author: 'user', note: 'here', status, anchorState: 'ok', layout: 'main', revision: 1, camera, createdAt: '2026-10-08T21:00:00.000Z', anchor: { point: [0, 0, 0] } })
        for (const [from, to] of [['gauge', 'morph'], ['spread', 'makers']] as const) {
          mkdirSync(join(shotRoot, to, '.torno'), { recursive: true })
          cpSync(join(shotRoot, from, '.torno', 'thumb.png'), join(shotRoot, to, '.torno', 'thumb.png'))
          writeFileSync(made(to), JSON.stringify({ ...JSON.parse(readFileSync(made(from), 'utf8')), at: '2026-10-02T09:41:00.000Z', model: `${to}.py`, sourcesMtimeMs: to === 'morph' ? 1 : Date.now() + 60_000 }))
        }
        writeFileSync(join(shotRoot, 'makers', '.torno', 'marks.json'), JSON.stringify({ next: 5, marks: [pin('M1', 'draft'), pin('M2', 'sent'), { ...pin('M3', 'sent'), kind: 'dimension', measure: 'distance', a: { point: [0, 0, 0] }, b: { point: [0, 0, 6] }, value: 6, expected: 8, anchor: undefined }, { ...pin('M4', 'sent'), kind: 'dimension', measure: 'distance', a: { point: [0, 0, 0] }, b: { point: [0, 0, 8] }, value: 8, expected: 8, anchor: undefined }] }))
        // On hollow: a pin of the person's, not sent yet.
        await shotPage.evaluate(() => window.torno.marks.add('hollow', { kind: 'pin', author: 'user', layout: 'assembly', revision: 1, camera: window.__tornoTest!.camera(), note: 'too thin here', anchor: { point: [20, 0, 20], part: 'tub' } }))
        // plain built, and then stopped building.
        appendFileSync(join(shotRoot, 'plain', 'plain.py'), '\nraise ValueError("the plate is thinner than its fillet")\n')
        await openListed(shotPage, 'plain')
        await expect.poll(async () => (await state(shotPage)).build?.status, { timeout: 30_000 }).toBe('failed')
        await openListed(shotPage, 'hollow')
        await expect.poll(async () => (await state(shotPage)).objectId).toBe('hollow')
        await shotPage.keyboard.press('w')
        await expect(shotPage.locator('.card[data-object="plain"]')).toContainText('Failed')
        await expect(shotPage.locator('.card[data-object="morph"] img')).toHaveJSProperty('naturalWidth', 480)
        await expect(shotPage.locator('.card[data-object="hollow"] img')).toHaveJSProperty('naturalWidth', 480)
        // Wide enough for four cards to a row: the session is put away for the picture.
        await shotPage.getByRole('button', { name: 'Hide session' }).click()
        // The focus on a card of the first row, and the page at its top.
        await shotPage.keyboard.press('Home')
        await shotPage.keyboard.press('ArrowRight')
        await shotPage.locator('.show').evaluate((el) => el.scrollTo(0, 0))
      } else {
        await expect(shotPage.locator('.empty-folder')).toBeVisible()
      }
      await shotPage.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      const png = await shotApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
        return image.toPNG().toString('base64')
      })
      writeFileSync(join(dir!, `show-${shot}.png`), Buffer.from(png, 'base64'))
      // The pictures themselves, as they are on file, for whoever wants to look at one.
      if (!empty) for (const id of ['hollow', 'bracket', 'measures', 'spread']) cpSync(join(shotRoot, id, '.torno', 'thumb.png'), join(dir!, `thumb-${id}.png`))
    } finally {
      await shotApp.close()
      rmSync(shotRoot, { recursive: true, force: true })
    }
  })
}
