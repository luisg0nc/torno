import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inTerminal } from './terminal'
import { describeMark } from '../src/main/marks/describe'
import type { TornoState } from '../src/renderer/state/store'
import type { PinMark } from '../src/shared/marks'
import type { Camera } from '../src/shared/view'
import { grid, stl } from '../src/test/scanFixtures'

// What the agent is given, through the real path: the SDK's MCP client in this
// process against the app's own server, answered by the window's renderer. The
// agent in the session pane is the stand-in (test/fake-agent.mjs).
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page
const clients: Client[] = []

type Content = Array<{ type: string; text?: string; data?: string; mimeType?: string }>

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-mcp-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  inTerminal(root)
  // A plate with a blind pocket in the middle of its top: the centre of that face is over the pocket, not on the face.
  mkdirSync(join(root, 'pocket'))
  writeFileSync(join(root, 'pocket', 'pocket.py'), 'from build123d import Box, Pos\n\nplate = Box(40, 30, 5) - Pos(0, 0, 1.5) * Box(10, 10, 2)\n')
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({
    args: ['.'],
    cwd: appDir,
    env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root }
  })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()))
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())

/** How many checks of an object's marks against its build main has started, and how many have ended. */
function checks(objectId: string): Promise<{ started: number; finished: number }> {
  return app.evaluate((_electron, id) => (globalThis as unknown as { __tornoMain: { marksChecks(id: string): { started: number; finished: number } } }).__tornoMain.marksChecks(id), objectId)
}

/**
 * Wait until main has checked the marks of an object against its build since
 * `before` was read (read it before the marks are added): a check has ended
 * since, and none is under way or waiting.
 */
async function checked(objectId: string, before: { finished: number }): Promise<void> {
  await expect
    .poll(async () => {
      const now = await checks(objectId)
      return now.started === now.finished && now.finished > before.finished
    })
    .toBe(true)
}
const terminal = (): Promise<string> => page.evaluate(() => window.__tornoTerm!.text())

/** The address an agent working on that object is given. */
function mcpUrl(objectId: string): Promise<string> {
  return app.evaluate((_electron, id) => (globalThis as unknown as { __tornoMain: { mcpUrlFor(id: string): string } }).__tornoMain.mcpUrlFor(id), objectId)
}

async function connect(objectId: string): Promise<Client> {
  const client = new Client({ name: 'torno-e2e', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(await mcpUrl(objectId))))
  clients.push(client)
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; content: Content; text: string }> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Content
  return { isError: result.isError === true, content, text: content.find((block) => block.type === 'text')?.text ?? '' }
}

/** Share of a PNG's pixels that are neither the background nor as faint as the ground grid: the parts. */
function drawn(base64: string): Promise<{ width: number; height: number; drawn: number }> {
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    // --surface is #F1EFEA; the grid's hairlines are within 30 of it, the parts far from it.
    const background = [0xf1, 0xef, 0xea]
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (background.some((value, channel) => Math.abs(pixels[i + channel] - value) > 40)) count += 1
    }
    return { width: bitmap.width, height: bitmap.height, drawn: count / (pixels.length / 4) }
  }, base64)
}

async function openObject(name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
  await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('ok')
}

let bracket: Client
let whole: string

test('before an object has been built, scene and look say there is no build', async () => {
  await page.emulateMedia({ colorScheme: 'light' })
  bracket = await connect('bracket')
  expect((await bracket.listTools()).tools.map((t) => t.name).sort()).toEqual(['add_mark', 'check', 'describe', 'diff', 'highlight', 'look', 'marks', 'measure', 'resolve_mark', 'save_view', 'scan_clash', 'scan_deviation', 'scans', 'scene', 'section', 'show'])
  const asked: Array<[string, Record<string, unknown>]> = [
    ['scene', {}],
    ['look', {}],
    ['describe', { ref: 'base' }],
    ['highlight', { refs: ['base'] }],
    ['show', { view: 'top' }],
    ['add_mark', { kind: 'pin', note: '', ref: 'base' }]
  ]
  for (const [name, args] of asked) {
    const result = await call(bracket, name, args)
    expect(result.isError, name).toBe(true)
    expect(result.text, name).toBe('no build yet: bracket has not been opened in the torno window')
  }
  // The marks are the object's, built or not: there are none yet.
  expect(await call(bracket, 'marks')).toMatchObject({ isError: false, text: '{"revision":null,"marks":[]}' })
  const nothing = await call(await connect('no such object'), 'scene')
  expect(nothing).toMatchObject({ isError: true, text: 'unknown object: no such object' })
})

test('scene reports the build, the parts and what the window shows', async () => {
  await openObject('bracket')
  // The window reports its camera once the first build is on screen.
  await expect.poll(async () => JSON.parse((await call(bracket, 'scene')).text).camera).not.toBeNull()
  const result = await call(bracket, 'scene')
  expect(result.isError).toBe(false)
  const scene = JSON.parse(result.text)
  expect(scene).toMatchObject({
    object: 'bracket',
    model: 'bracket.py',
    build: { status: 'ok', revision: 1, stale: false },
    layout: 'assembly',
    layouts: ['assembly', 'print'],
    camera: { ortho: false }
  })
  expect(scene).not.toHaveProperty('note')
  expect(scene.parts.map((p: { layout: string; name: string }) => `${p.layout}:${p.name}`)).toEqual(['assembly:base', 'assembly:post', 'print:base', 'print:post'])
  expect(scene.parts[0]).toMatchObject({ name: 'base', visible: true, size: [40, 30, 5], bbox: { min: [-20, -15, -2.5], max: [20, 15, 2.5] }, volume: 6000, faces: 6, edges: 12, valid: true })
  expect(scene.parts[1]).toMatchObject({ name: 'post', visible: true, size: [8, 8, 20], volume: 1005.31 })
})

test('look returns the picture the window draws, and keeps a copy under .torno/views', async () => {
  const result = await call(bracket, 'look', { view: 'iso' })
  expect(result.isError).toBe(false)
  const image = result.content.find((block) => block.type === 'image')!
  expect(image.mimeType).toBe('image/png')
  expect(image.data!.startsWith('iVBORw0KGgo')).toBe(true) // the PNG signature
  whole = image.data!
  const saved = join(root, 'bracket', '.torno', 'views', '1.png')
  expect(result.text).toBe(`view iso · layout assembly · parts base, post · orthographic · 1280×960\nrevision r1\nsaved as ${saved}`)
  expect(readFileSync(saved).toString('base64')).toBe(whole)
  const measured = await drawn(whole)
  expect(measured).toMatchObject({ width: 1280, height: 960 })
  expect(measured.drawn).toBeGreaterThan(0.02)

  // With no arguments: the person's own view, in the shape of their viewport.
  const current = await call(bracket, 'look')
  expect(current.text).toContain('view current · layout assembly · parts base, post · perspective')
  expect(current.text).toContain(join(root, 'bracket', '.torno', 'views', '2.png'))
  expect((await drawn(current.content[0].data!)).drawn).toBeGreaterThan(0.02)

  // The size is held to what the agent's CLI passes on unscaled.
  expect((await call(bracket, 'look', { view: 'front', size: 9000 })).text).toContain('2000×1500')
  // Whether the marks are drawn is the agent's to say; here there are none either way.
  expect((await call(bracket, 'look', { view: 'front', marks: false })).isError).toBe(false)
  expect((await call(bracket, 'look', { view: 'front', marks: 'no' })).isError).toBe(true)
  expect((await call(bracket, 'look', { view: 'front', layout: 'print', parts: ['post'], size: 100 })).text).toContain('view front · layout print · parts post · orthographic · 256×192')
})

test('a layer the person hides is gone from the next look, and scene says it is hidden', async () => {
  await page.locator('[data-layer="post"]').hover()
  await page.getByRole('button', { name: 'Show post' }).click()
  await expect.poll(async () => JSON.parse((await call(bracket, 'scene')).text).parts[1].visible).toBe(false)

  const result = await call(bracket, 'look', { view: 'iso' })
  expect(result.text).toContain('view iso · layout assembly · parts base · orthographic')
  const image = result.content[0].data!
  expect(image).not.toBe(whole)
  const [before, after] = [await drawn(whole), await drawn(image)]
  expect(after.drawn).toBeGreaterThan(0.02)
  expect(Math.abs(after.drawn - before.drawn)).toBeGreaterThan(0.005)

  // Asked for by name, a hidden part is drawn all the same.
  expect((await call(bracket, 'look', { view: 'iso', parts: ['post'] })).text).toContain('parts post ·')
})

test('an unknown part or layout is an error that names the ones there are', async () => {
  const part = await call(bracket, 'look', { parts: ['lid'] })
  expect(part).toMatchObject({ isError: true, text: "unknown part 'lid'; parts in layout assembly: base, post" })
  const layout = await call(bracket, 'look', { layout: 'exploded' })
  expect(layout.isError).toBe(true)
  expect(layout.text).toContain('assembly, print')
})

test('the pictures saved did not start a build', async () => {
  expect(existsSync(join(root, 'bracket', '.torno', 'views', '5.png'))).toBe(true)
  // Longer than the watcher waits before it builds.
  await page.waitForTimeout(1000)
  expect((await state()).build).toMatchObject({ status: 'ok', revision: 1 })
})

test('the agent is told of torno in its system prompt, and of the build with every prompt', async () => {
  await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
  await expect.poll(terminal).toContain('READY')
  const argv: string[] = JSON.parse(/READY (\[.*\])/s.exec((await terminal()).replace(/\n/g, ''))![1])
  const prompt = argv[argv.indexOf('--append-system-prompt') + 1]
  expect(argv).toContain('--append-system-prompt')
  expect(prompt).toContain('mcp__torno__look')
  expect(argv[argv.indexOf('--mcp-config') + 1]).toContain(await mcpUrl('bracket'))

  await page.locator('.session-term textarea').focus()
  await page.keyboard.type('hook')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await terminal()).replace(/\s+/g, ' ')).toMatch(
    /context: \[torno\] bracket · build ok · r1 \((?:\d+\.\d|under 0\.1) s\) · layout assembly · parts: base, post \(hidden: post\)\./
  )
  for (const tool of ['marks', 'describe', 'highlight', 'show', 'add_mark', 'resolve_mark']) expect(prompt).toContain(`mcp__torno__${tool}`)
})

// Final review M15: the port can be found by any process of this machine; the secret in the address cannot.
test('the address the agent is given has a secret of the run, which is in no file of the workspace; without it there is nothing', async () => {
  const url = new URL(await mcpUrl('bracket'))
  const [, mcp, secret, object] = url.pathname.split('/')
  expect([mcp, object]).toEqual(['mcp', 'bracket'])
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  // The stand-in was given it for its hooks too, and has just posted one with it.
  const hook = new RegExp(`http://127\\.0\\.0\\.1:${url.port}/hooks/${secret}/[0-9a-f-]{36}/UserPromptSubmit`).exec(await said())?.[0]
  expect(hook).toBeDefined()

  // By now the workspace has every file a session and a build leave: the state file, the scene, the marks.
  await expect.poll(() => existsSync(stateFile())).toBe(true)
  const files = readdirSync(root, { withFileTypes: true, recursive: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
  expect(files.length).toBeGreaterThan(10)
  for (const file of files) expect([file, readFileSync(file).includes(secret)]).toEqual([file, false])

  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  for (const path of ['/mcp/bracket', `/mcp/${'A'.repeat(43)}/bracket`, `/hooks/${hook!.split('/').slice(-2).join('/')}`]) {
    const reply = await fetch(`${url.origin}${path}`, { method: 'POST', headers, body })
    expect([path, reply.status]).toEqual([path, 404])
  }
  expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(200)
})

// ---- Marks and the window, from the agent's side ----

const camera = (): Promise<Camera> => page.evaluate(() => window.__tornoTest!.camera())
const canvas = () => page.locator('.viewport-canvas canvas').first()
const ON_BASE: [number, number, number] = [14, 9, 2.5] // on the top of the base, clear of the post
/** What the terminal shows without its line breaks, which fall where the pane is wide. */
const said = async (): Promise<string> => (await terminal()).replace(/\s+/g, '')
const times = (text: string, part: string): number => text.split(part.replace(/\s+/g, '')).length - 1
const stateFile = () => join(root, 'bracket', '.torno', 'state.md')

async function prompt(): Promise<void> {
  await page.locator('.session-term textarea').focus()
  await page.keyboard.type('hook')
  await page.keyboard.press('Enter')
}

let pin: PinMark

test("show changes what the user sees for now, not the layers they saved, and waits while they have a button down", async () => {
  const sceneFile = join(root, 'bracket', '.torno', 'scene.json')
  // As the person left it, by hand, in the test above: the post hidden.
  await expect.poll(() => (existsSync(sceneFile) ? JSON.parse(readFileSync(sceneFile, 'utf8')).layers : null)).toEqual({ post: { visible: false } })
  const saved = readFileSync(sceneFile, 'utf8')

  // In the middle of a drag in the viewport, the view is theirs.
  const box = (await canvas().boundingBox())!
  await page.mouse.move(box.x + box.width - 40, box.y + box.height - 80)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 90, { steps: 2 })
  const refused = await call(bracket, 'show', { parts: ['base', 'post'], layout: 'print' })
  expect(refused).toMatchObject({ isError: true, text: 'the user is in the middle of a stroke or drag; try again' })
  expect(await state()).toMatchObject({ layout: 'assembly', layers: { post: { visible: false } } })
  await page.mouse.up()

  const shown = await call(bracket, 'show', { parts: ['base', 'post'], layout: 'print' })
  expect(shown.isError).toBe(false)
  expect(await state()).toMatchObject({ layout: 'print', layers: { post: { visible: true } } })
  // Longer than a change made by hand takes to be written.
  await page.waitForTimeout(900)
  expect(readFileSync(sceneFile, 'utf8')).toBe(saved)
  // A change the person then makes by hand is saved, without what the agent had shown.
  await page.locator('[data-layer="base"]').getByRole('button', { name: 'Show base' }).click()
  await expect.poll(() => JSON.parse(readFileSync(sceneFile, 'utf8'))).toEqual({ layout: 'assembly', layers: { base: { visible: false }, post: { visible: false } } })
  await page.locator('[data-layer="base"]').getByRole('button', { name: 'Show base' }).click()
  await expect.poll(() => JSON.parse(readFileSync(sceneFile, 'utf8')).layers.base.visible).toBe(true)
  // Back as the tests that follow expect it: assembly, the post hidden by the person.
  expect((await call(bracket, 'show', { layout: 'assembly', parts: ['base'] })).isError).toBe(false)
  expect(await state()).toMatchObject({ layout: 'assembly', layers: { post: { visible: false } } })
})

test("show changes the user's layers and camera, and says what they see then", async () => {
  // The post was hidden by hand above: the agent brings it back.
  const parts = await call(bracket, 'show', { parts: ['base', 'post'] })
  expect(parts).toMatchObject({ isError: false, text: "view current · layout assembly · parts base, post · perspective\nrevision r1\nThe user's viewport now shows this." })
  expect((await state()).layers.post.visible).toBe(true)
  await expect(page.locator('[data-layer="post"]').getByRole('button', { name: 'Show post' })).toHaveAttribute('aria-pressed', 'true')

  const before = await camera()
  const top = await call(bracket, 'show', { view: 'top' })
  expect(top.text).toBe("view top · layout assembly · parts base, post · perspective\nrevision r1\nThe user's viewport now shows this.")
  // The camera travels there: straight above what it looks at.
  await expect
    .poll(async () => {
      const c = await camera()
      return c.position[2] > c.target[2] && Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1]) < 0.01 * (c.position[2] - c.target[2])
    })
    .toBe(true)
  expect(await camera()).not.toEqual(before)
  // What main is told the user sees follows.
  await expect.poll(async () => JSON.parse((await call(bracket, 'scene')).text).camera.position[2]).toBeGreaterThan(20)

  const unknown = await call(bracket, 'show', { parts: ['lid'] })
  expect(unknown).toMatchObject({ isError: true, text: "unknown part 'lid'; parts in layout assembly: base, post" })
  expect(await call(bracket, 'show', { layout: 'exploded' })).toMatchObject({ isError: true, text: "no layout 'exploded'; layouts: assembly, print" })
  expect((await state()).layers.post.visible).toBe(true)
})

test('a pin the user places with the pointer is in marks, with the face it is on', async () => {
  // By its button: the keys are the terminal's while it has the focus.
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Pin', exact: true }).click()
  const [fx, fy] = await page.evaluate((at) => window.__tornoTest!.project(at), ON_BASE)
  const box = (await canvas().boundingBox())!
  await page.mouse.move(box.x + fx * box.width, box.y + fy * box.height)
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.locator('.note-card textarea')).toBeFocused()
  await page.keyboard.type('make this corner thicker')
  await page.keyboard.press('Enter')
  await expect(page.locator('.note-card')).toHaveCount(0)
  await page.keyboard.press('Escape') // back to Select
  await expect.poll(async () => (await state()).marks[0]?.note).toBe('make this corner thicker')

  const listed: { revision: number; marks: Array<PinMark & { line: string }> } = JSON.parse((await call(bracket, 'marks')).text)
  expect(listed.revision).toBe(1)
  expect(listed).not.toHaveProperty('stale')
  expect(listed.marks).toHaveLength(1)
  const { line: _line, ...asListed } = listed.marks[0]
  pin = asListed as PinMark
  // Checked against the build it was placed on, the moment it was kept.
  expect(pin.checkedRevision).toBe(1)
  expect(pin).toMatchObject({ id: 'M1', kind: 'pin', author: 'user', status: 'draft', anchorState: 'ok', layout: 'assembly', note: 'make this corner thicker' })
  expect(pin.anchor).toMatchObject({ part: 'base', descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' })
  expect(pin.anchor.ref).toMatch(/^base\/F\d+$/)
  expect(JSON.parse((await call(bracket, 'marks', { status: 'draft' })).text).marks).toHaveLength(1)
  expect((await call(bracket, 'marks', { status: 'sent' })).text).toBe('{"revision":1,"marks":[]}')

  // The same face, asked of the kernel, and the mark by its number.
  const face = JSON.parse((await call(bracket, 'describe', { ref: pin.anchor.ref! })).text)
  expect(face).toMatchObject({ layout: 'assembly', revision: 1, kind: 'face', ref: `assembly:${pin.anchor.ref}`, type: 'plane', area: 1200, normal: [0, 0, 1], descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' })
  expect(JSON.parse((await call(bracket, 'describe', { ref: 'M1' })).text)).toEqual({ revision: 1, mark: listed.marks[0] })
  expect(await call(bracket, 'describe', { ref: 'base/F99' })).toMatchObject({ isError: true, text: 'base has 6 faces, F0 to F5: there is no F99' })
  expect(await call(bracket, 'describe', { ref: 'M7' })).toMatchObject({ isError: true, text: 'no mark M7; marks: M1' })
})

test('the next prompt carries the pin as one line, and turns it sent', async () => {
  const line = describeMark(pin)
  expect(line).toMatch(/^M1 pin on base\/F\d \(plane, normal \+Z, z = 2\.5, 1200 mm²\) at \(1\d(\.\d+)?, \d(\.\d+)?, 2\.5\): "make this corner thicker"$/)
  // A hook that is not a prompt takes nothing with it.
  await page.locator('.session-term textarea').focus()
  await page.keyboard.type('hook Stop')
  await page.keyboard.press('Enter')
  await expect.poll(said).toContain('Stop:ok')
  expect((await state()).marks[0].status).toBe('draft')

  await prompt()
  await expect.poll(said).toContain(`Marks from the user (drawn in look pictures with these numbers): ${line}`.replace(/\s+/g, ''))
  await expect.poll(async () => (await state()).marks[0].status).toBe('sent')
  await expect(page.getByRole('list', { name: 'With the agent' }).locator('.mark-row[data-mark="M1"]')).toHaveCount(1)
})

test("add_mark places the agent's own marks, by ref and by point, which the user sees in green", async () => {
  const unchecked = await checks('bracket')
  const byRef = await call(bracket, 'add_mark', { kind: 'pin', note: '<i>this</i> face?', ref: pin.anchor.ref })
  expect(byRef.isError).toBe(false)
  expect(byRef.text).toBe(`placed in layout assembly: (yours) M2 pin on ${pin.anchor.ref} (plane, normal +Z, z = 2.5, 1200 mm²) at (0, 0, 2.5): "<i>this</i> face?"\nrevision r1`)

  const row = page.locator('.mark-row[data-mark="M2"]')
  await expect(row).toHaveAttribute('data-author', 'agent')
  // --agent-mark, outlined: the user's own are filled with --user-mark.
  await expect(row.locator('.mark-chip')).toHaveCSS('border-top-color', 'rgb(40, 129, 86)')
  await expect(row.locator('.mark-chip')).toHaveCSS('color', 'rgb(40, 129, 86)')
  await expect(row.locator('.mark-chip')).toHaveAttribute('title', /The agent's mark/)
  // What the agent wrote is text, whatever it looks like.
  await expect(row.locator('.mark-note')).toHaveText('<i>this</i> face?')
  await expect(row.locator('.mark-note i')).toHaveCount(0)
  const agents = (await state()).marks[1] as PinMark
  expect(agents).toMatchObject({ id: 'M2', kind: 'pin', author: 'agent', status: 'sent', anchorState: 'ok', revision: 1 })
  expect(agents.anchor).toMatchObject({ point: [0, 0, 2.5], part: 'base', descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' })

  // By a point alone: the kernel says which part it is on.
  const byPoint = await call(bracket, 'add_mark', { kind: 'arrow', note: 'taller', point: [0, 0, 22.5], by: [0, 0, 10] })
  expect(byPoint.text).toMatch(/^placed in layout assembly: \(yours\) M3 arrow from post\/F\d \(plane, normal \+Z, z = 22\.5, 50\.27 mm²\) at \(0, 0, 22\.5\) by \(0, 0, 10\), 10 mm: "taller"\nrevision r1$/)
  const inAir = await call(bracket, 'add_mark', { kind: 'shape', note: 'keep clear', shape: 'box', size: [10, 10, 4], position: [30, 30, 30], intent: 'keep-out' })
  expect(inAir.text).toBe('placed in layout assembly: (yours) M4 box 10 × 10 × 4 mm centred at (30, 30, 30), intent keep-out: "keep clear"\nrevision r1')
  await expect.poll(async () => (await state()).marks.map((m) => `${m.id} ${m.author} ${m.kind}`)).toEqual(['M1 user pin', 'M2 agent pin', 'M3 agent arrow', 'M4 agent shape'])

  // Main checks each new mark against the build at once: what was answered still holds afterwards.
  await checked('bracket', unchecked)
  const kept = (await state()).marks
  expect(kept.map((m) => m.anchorState)).toEqual(['ok', 'ok', 'ok', 'ok'])
  expect(byRef.text).toBe(`placed in layout assembly: ${describeMark(kept[1])}\nrevision r1`)
  expect(byPoint.text).toBe(`placed in layout assembly: ${describeMark(kept[2])}\nrevision r1`)
  // Each was checked against that build.
  expect(kept.map((m) => m.checkedRevision)).toEqual([1, 1, 1, 1])
  // Each mark comes with its line.
  const listed: { revision: number; marks: Array<{ id: string; line: string }> } = JSON.parse((await call(bracket, 'marks')).text)
  expect(listed.marks.map((m) => m.line)).toEqual(kept.map((m) => describeMark(m, { revision: 1 })))

  expect(await call(bracket, 'add_mark', { kind: 'pin', note: '', ref: 'lid/F1' })).toMatchObject({ isError: true, text: "no part 'lid' in layout assembly (parts: base, post)" })
  expect(await call(bracket, 'add_mark', { kind: 'pin', note: '', ref: 'base', point: [0, 0, 90] })).toMatchObject({ isError: true, text: expect.stringMatching(/^the point \(0, 0, 90\) is 87\.5 mm from the surface of base: /) })
  expect((await state()).marks).toHaveLength(4)
})

test('a second prompt does not repeat the pin, and tells the agent none of its own marks', async () => {
  const before = await said()
  expect(times(before, 'Marks from the user')).toBe(1)
  await prompt()
  await expect.poll(async () => times(await said(), 'Open marks: M1, M2, M3, M4')).toBe(1)
  const after = await said()
  expect(times(after, 'Marks from the user')).toBe(1)
  expect(times(after, describeMark(pin))).toBe(1)
  expect((await state()).marks.map((m) => m.status)).toEqual(['sent', 'sent', 'sent', 'sent'])
})

test('highlight shows the user what the agent means, until they click', async () => {
  const line = page.locator('.agent-line')
  await expect(line).toHaveCount(0)
  const result = await call(bracket, 'highlight', { refs: [pin.anchor.ref!, 'post', 'M1'], note: '<b>this one?</b>' })
  expect(result).toMatchObject({
    isError: false,
    text: `highlighted ${pin.anchor.ref}, post in layout assembly for the user, with the note "<b>this one?</b>", until they click in the viewport or 60 s pass.`
  })
  await expect(line).toBeVisible()
  await expect(line.locator('[data-ref]')).toHaveText([pin.anchor.ref!, 'post'])
  await expect(line.locator('[data-ref]').first()).toHaveCSS('border-top-color', 'rgb(40, 129, 86)')
  await expect(line.locator('.agent-note')).toHaveText('<b>this one?</b>')
  await expect(line.locator('.agent-note b')).toHaveCount(0)

  // Turning the part to see it leaves it there; a click anywhere in the viewport puts it away.
  const box = (await canvas().boundingBox())!
  const before = await camera()
  await page.mouse.move(box.x + box.width - 12, box.y + box.height - 60)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 80, box.y + box.height - 100, { steps: 4 })
  await page.mouse.up()
  await expect.poll(camera).not.toEqual(before)
  await expect(line).toBeVisible()
  await page.mouse.click(box.x + box.width - 12, box.y + box.height - 60)
  await expect(line).toHaveCount(0)

  // A part that is switched off cannot be pointed at: the user would see nothing.
  await call(bracket, 'show', { parts: ['base'] })
  const hidden = await call(bracket, 'highlight', { refs: ['post/F1'] })
  expect(hidden).toMatchObject({ isError: true, text: 'nothing was highlighted: post is hidden, so the user would see nothing of it. Call show with parts ["base","post"] first, which changes what the user sees' })
  await expect(line).toHaveCount(0)
  await call(bracket, 'show', { parts: ['base', 'post'] })

  // So does its own control.
  await call(bracket, 'highlight', { refs: ['base/E0'] })
  await expect(line.locator('[data-ref]')).toHaveText(['base/E0'])
  await expect(line.locator('.agent-note')).toHaveCount(0)
  await line.getByRole('button', { name: 'Dismiss what the agent points at' }).click()
  await expect(line).toHaveCount(0)

  const wrong = await call(bracket, 'highlight', { refs: ['base/F1', 'lid', 'post/E9'] })
  expect(wrong).toMatchObject({ isError: true, text: "nothing was highlighted: no part 'lid' in layout assembly (parts: base, post); post has 3 edges, E0 to E2: there is no E9" })
  const elsewhere = await call(bracket, 'highlight', { refs: ['base'], layout: 'print' })
  expect(elsewhere).toMatchObject({ isError: true, text: 'layout print is not the one on screen (assembly): call show with that layout first, which changes what the user sees' })
  await expect(line).toHaveCount(0)
})

test('resolve_mark resolves a mark, which the user sees as resolved by the agent with what it did, and then moves under Resolved', async () => {
  const result = await call(bracket, 'resolve_mark', { id: 'M1', note: 'made the corner 2 mm thicker' })
  expect(result).toMatchObject({ isError: false, text: `resolved: ${describeMark(pin)}\nnote: made the corner 2 mm thicker` })
  const marks = page.getByRole('region', { name: 'Marks' })
  // Still in the list, saying who resolved it and what was done, in words on the row.
  await expect(marks.locator('.marks-review')).toContainText('The agent resolved 1 mark.')
  await marks.locator('.marks-review').getByRole('button', { name: 'Review' }).click()
  const awaiting = marks.getByRole('list', { name: 'To review' }).locator('[data-mark="M1"]')
  await expect(marks.locator('.mark-row[data-mark]')).toHaveCount(4)
  await expect(awaiting).toHaveAttribute('data-awaiting', '')
  await expect(awaiting.locator('.mark-resolution-note')).toHaveText('Resolved by the agent: made the corner 2 mm thicker')
  await awaiting.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(marks.locator('.marks-review')).toHaveCount(0)
  await expect(marks.locator('.mark-row[data-mark]')).toHaveCount(3)
  await marks.getByRole('button', { name: /Resolved/ }).click()
  const resolved = marks.getByRole('list', { name: 'Resolved marks' }).locator('[data-mark="M1"]')
  await expect(resolved).toHaveAttribute('data-status', 'resolved')
  // Its tooltip says what the row does not: the note too, unless the row is the active one, which shows it whole.
  const whole = (await resolved.getAttribute('aria-current')) === 'true'
  await expect(resolved.locator('.mark-note')).toHaveText('make this corner thicker')
  await expect(resolved.locator('.mark-note')).toHaveAttribute('title', `${whole ? '' : 'make this corner thicker\n'}Resolved: made the corner 2 mm thicker`)
  expect((await call(bracket, 'marks', { status: 'open' })).text).not.toContain('"M1"')

  expect(await call(bracket, 'resolve_mark', { id: 'M9' })).toMatchObject({ isError: true, text: 'no mark M9; marks: M1, M2, M3, M4' })
})

test('state.md says the same to an agent without the tools, and writing it starts no build', async () => {
  // It follows the marks by a second: wait for the one that tells of the mark just resolved.
  await expect.poll(() => (existsSync(stateFile()) ? readFileSync(stateFile(), 'utf8') : ''), { timeout: 10_000 }).toMatch(/In layout assembly:\n\n- \(yours\) M2 pin[^]*- \(yours\) M4 box/)
  const text = readFileSync(stateFile(), 'utf8')
  expect(text).toContain('# bracket\n')
  expect(text).toContain('## Build\n\nBuild ok, r1.\n')
  expect(text).toContain('- assembly: base 40 × 30 × 5 mm, post 8 × 8 × 20 mm\n')
  expect(text).toContain(`In layout assembly:\n\n- (yours) M2 pin on ${pin.anchor.ref} (plane, normal +Z, z = 2.5, 1200 mm²) at (0, 0, 2.5): "<i>this</i> face?"\n- (yours) M3 arrow from post/F`)
  // Resolved: no longer something to act on.
  expect(text).not.toContain('M1 pin')
  // Longer than the watcher waits before it builds, and than the file waits to be written again.
  await page.waitForTimeout(1500)
  expect(readFileSync(stateFile(), 'utf8')).toBe(text)
  expect((await state()).build).toMatchObject({ status: 'ok', revision: 1 })
  expect(readdirSync(join(root, 'bracket', '.torno')).filter((name) => name.includes('.tmp'))).toEqual([])
})

test('for an object that is not the one open, look refuses and scene says what it cannot know', async () => {
  await openObject('plain')
  const look = await call(bracket, 'look', { view: 'iso' })
  expect(look).toMatchObject({ isError: true, text: 'bracket is not the object open in the torno window (open: plain). Ask the user to open it.' })
  // Nor is the user shown anything of an object they are not looking at.
  for (const [name, args] of [['show', { view: 'top' }], ['highlight', { refs: ['base'] }]] as const) {
    expect(await call(bracket, name, args)).toMatchObject({ isError: true, text: 'bracket is not the object open in the torno window (open: plain). Ask the user to open it.' })
  }
  await expect(page.locator('.agent-line')).toHaveCount(0)
  // Its marks and its geometry are still there to ask about.
  expect(JSON.parse((await call(bracket, 'marks', { status: 'open' })).text).marks).toHaveLength(3)
  expect(JSON.parse((await call(bracket, 'describe', { ref: 'post' })).text)).toMatchObject({ layout: 'assembly', kind: 'part' })
  const scene = JSON.parse((await call(bracket, 'scene')).text)
  expect(scene).toMatchObject({ object: 'bracket', build: { status: 'ok', revision: 1 }, layout: null, camera: null })
  expect(scene.note).toContain('not the object open in the torno window (open: plain)')
  expect(scene.parts).toHaveLength(4)
  expect(scene.parts[0]).not.toHaveProperty('visible')

  // The object that is open answers at its own address.
  const plain = await call(await connect('plain'), 'look', { view: 'top' })
  expect(plain.text).toContain('view top · layout main · parts plate')
})

test('add_mark by a face whose centre is not on it puts the pin on the face under the point, says so, and keeps what it said', async () => {
  await openObject('pocket')
  const pocket = await connect('pocket')
  const faces: Array<{ ref: string; descriptor: string }> = []
  for (let i = 0; i < 11; i += 1) {
    const face = JSON.parse((await call(pocket, 'describe', { ref: `plate/F${i}` })).text)
    faces.push({ ref: `plate/F${i}`, descriptor: face.descriptor })
  }
  // The top, with the mouth of the pocket in its middle, and the floor of the pocket 2 mm under it.
  const top = faces.find((f) => /^plane, normal \+Z, z = 2\.5, /.test(f.descriptor))!
  const floor = faces.find((f) => /^plane, normal \+Z, z = 0\.5, /.test(f.descriptor))!
  expect(top.descriptor).toBe('plane, normal +Z, z = 2.5, 1100 mm²')
  expect(floor.descriptor).toBe('plane, normal +Z, z = 0.5, 100 mm²')

  const unchecked = await checks('pocket')
  const placed = await call(pocket, 'add_mark', { kind: 'pin', note: 'deeper?', ref: top.ref })
  expect(placed.isError).toBe(false)
  expect(placed.text).toBe(
    `placed in layout main: (yours) M1 pin on ${floor.ref} (${floor.descriptor}) at (0, 0, 0.5): "deeper?"\nThe centre of ${top.ref} is not on it: the mark is placed on ${floor.ref}, the face under that point. Give a point on ${top.ref} to put it there.\nrevision r1`
  )
  // The check that follows the adding finds it as it was said to be.
  await checked('pocket', unchecked)
  const [kept] = (await state()).marks as PinMark[]
  expect(kept).toMatchObject({ id: 'M1', anchorState: 'ok', anchor: { point: [0, 0, 0.5], part: 'plate', ref: floor.ref, descriptor: floor.descriptor } })
  expect(placed.text.split('\n')[0]).toBe(`placed in layout main: ${describeMark(kept)}`)
  const [listed] = (JSON.parse((await call(pocket, 'marks')).text) as { marks: Array<{ line: string }> }).marks
  expect(listed.line).toBe(describeMark(kept))
})

/** The colour of one pixel of a PNG, at fractions of its width and height, and its size. */
function pixelAt(base64: string, fx: number, fy: number): Promise<{ width: number; height: number; rgb: [number, number, number] }> {
  return page.evaluate(
    async ({ data, fx, fy }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const [r, g, b] = ctx.getImageData(Math.round(fx * bitmap.width), Math.round(fy * bitmap.height), 1, 1).data
      return { width: bitmap.width, height: bitmap.height, rgb: [r, g, b] as [number, number, number] }
    },
    { data: base64, fx, fy }
  )
}

interface Loop { points: [number, number][]; closed: boolean; area: number }
interface CutJson {
  layout: string
  revision: number
  plane: { origin: number[]; normal: number[]; x: number[]; y: number[]; axis?: string; at?: number }
  parts: Array<{ part: string; area: number; areaExact: boolean; open: number; how: string; loops: Loop[]; arranged?: number[] }>
  bounds: { min: [number, number]; max: [number, number] }
  extent: [number, number]
  reading: string
  image: string
}

let measures: Client
/** The faces of the measures plate, by what the kernel says of each. */
let plateFaces: Array<{ ref: string; descriptor: string }>

test('measure answers with the exact value, how it was taken and a reading, through refs, points and marks', async () => {
  await openObject('measures')
  measures = await connect('measures')
  expect((await measures.listTools()).tools.map((t) => t.name).sort()).toEqual(['add_mark', 'check', 'describe', 'diff', 'highlight', 'look', 'marks', 'measure', 'resolve_mark', 'save_view', 'scan_clash', 'scan_deviation', 'scans', 'scene', 'section', 'show'])
  const whole = JSON.parse((await call(measures, 'describe', { ref: 'plate' })).text) as { faceCount: number }
  plateFaces = []
  for (let i = 0; i < whole.faceCount; i += 1) plateFaces.push({ ref: `plate/F${i}`, descriptor: JSON.parse((await call(measures, 'describe', { ref: `plate/F${i}` })).text).descriptor })
  const top = plateFaces.find((f) => /^plane, normal \+Z, z = 3,/.test(f.descriptor))!
  const bottom = plateFaces.find((f) => /^plane, normal -Z, z = -3,/.test(f.descriptor))!
  const holes = plateFaces.filter((f) => /^cylinder, radius 4\b/.test(f.descriptor))
  expect(holes).toHaveLength(2)

  // The wall of the plate, from a point of its top that is over no hole and no pocket.
  const wall = await call(measures, 'measure', { kind: 'thickness', a: { ref: top.ref, point: [-15, -10, 3] } })
  expect(wall.isError, wall.text).toBe(false)
  expect(JSON.parse(wall.text)).toMatchObject({ layout: 'assembly', revision: 1, kind: 'thickness', value: 6, unit: 'mm', how: 'wall, along the normal', exact: true, reading: `6 mm wall, along the normal, ${top.ref} at (-15, -10, 3)` })

  const planes = JSON.parse((await call(measures, 'measure', { kind: 'distance', a: top.ref, b: bottom.ref })).text)
  expect(planes).toMatchObject({ value: 6, how: 'between planes', exact: true, reading: `6 mm between planes, ${top.ref} to ${bottom.ref}` })
  const axes = JSON.parse((await call(measures, 'measure', { kind: 'distance', a: holes[0].ref, b: holes[1].ref })).text)
  expect(axes).toMatchObject({ value: 20, how: 'axis to axis' })
  expect(JSON.parse((await call(measures, 'measure', { kind: 'diameter', a: holes[0].ref })).text)).toMatchObject({ value: 8, reading: `⌀ 8 mm, ${holes[0].ref}` })
  const above = JSON.parse((await call(measures, 'measure', { kind: 'distance', a: { point: [0, 0, 10] }, b: top.ref })).text)
  expect(above).toMatchObject({ value: 7, reading: `7 mm point to plane, (0, 0, 10) to ${top.ref}` })
  const mass = JSON.parse((await call(measures, 'measure', { kind: 'mass', a: 'plate' })).text)
  expect(mass.reading).toMatch(/^mass [\d.]+ g, PLA 1\.24 g\/cm³ \(default\), plate \(volume \d+ mm³\)$/)
  expect(mass.value).toBeCloseTo((mass.volume * 1.24) / 1000, 6)

  // What cannot be measured is said in the kernel's words, the refs as the agent writes them.
  const flat = await call(measures, 'measure', { kind: 'radius', a: top.ref })
  expect(flat.isError).toBe(true)
  expect(flat.text).toContain(top.ref)
  expect(flat.text).not.toContain('assembly:')
  const none = await call(measures, 'measure', { kind: 'radius', a: 'plate/F99' })
  expect(none).toMatchObject({ isError: true, text: `plate has ${whole.faceCount} faces, F0 to F${whole.faceCount - 1}: there is no F99` })
})

test('section answers with a drawing of the outlines the kernel cut, and with the outlines', async () => {
  // Under the floor of the pocket: the plate and its two holes.
  const cut = await call(measures, 'section', { plane: { axis: 'z', at: -2 } })
  expect(cut.isError, cut.text).toBe(false)
  const [image] = cut.content
  expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' })
  const json = JSON.parse(cut.text) as CutJson
  expect(json).toMatchObject({ layout: 'assembly', revision: 1, plane: { origin: [0, 0, -2], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0], axis: 'z', at: -2 }, bounds: { min: [-20, -15], max: [20, 15] }, extent: [40, 30] })
  expect(json.parts).toHaveLength(1)
  const [plate] = json.parts
  expect(plate).toMatchObject({ part: 'plate', open: 0, areaExact: true, how: 'cross-section of the solid' })
  expect(plate.loops).toHaveLength(3)
  expect(plate.loops.every((loop) => loop.closed)).toBe(true)
  // The plate less two holes of radius 4, to the kernel's precision, not the polygon's.
  expect(plate.area).toBeCloseTo(1200 - 2 * Math.PI * 16, 6)
  expect(plate.loops.map((loop) => Math.sign(loop.area))).toEqual([1, -1, -1])
  expect(json.reading).toBe('plane normal +Z at z = -2 · layout assembly: plate 1099 mm² in 3 loops; the cut is 40 × 30 mm')
  // The outlines are asked of the kernel within 0.01 mm, so that a round hole is drawn round; all of them fit, and none is thinned.
  expect(plate.loops.every((loop) => (loop as { deflection?: number }).deflection === 0.01)).toBe(true)
  expect(json).not.toHaveProperty('thinned')
  // What is no plane is answered with what one looks like, through the server as the agent calls it.
  expect(await call(measures, 'section', { plane: { z: -2 } })).toMatchObject({ isError: true, text: 'that is not a plane: give {"axis": "z", "at": 3} for the plane across x, y or z at that coordinate in mm, or {"origin": [x, y, z], "normal": [x, y, z]} with a normal that is not all zeros' })
  expect(json.image).toMatch(/^1280×\d+, the parts in the colours the user sees them in, saved as .+\/measures\/\.torno\/views\/\d+\.png$/)

  // The drawing: 1280 on its long edge, the plate in its colour, and the sheet showing through both holes.
  const size = await pixelAt(image.data!, 0.5, 0.5)
  expect(Math.max(size.width, size.height)).toBe(1280)
  const fractions = await findOnSheet(image.data!)
  // The sheet is --surface (#F1EFEA); the plate is the first colour of the palette (#7B93B4) laid on it four fifths opaque.
  expect(fractions.plate).toBeGreaterThan(0.2)
  for (const hole of fractions.holes) expect(hole).toEqual([0xf1, 0xef, 0xea])
  fractions.solid.forEach((channel, i) => expect(Math.abs(channel - [147, 165, 191][i])).toBeLessThanOrEqual(2))

  // One part alone is given in full, and a plane that misses the part cuts nothing, with no drawing.
  const missed = await call(measures, 'section', { plane: { axis: 'z', at: 50 }, parts: ['plate'] })
  expect(missed.content).toHaveLength(1)
  expect(JSON.parse(missed.text)).toMatchObject({ bounds: null, image: 'not drawn: there is nothing to draw', reading: 'plane normal +Z at z = 50 · layout assembly: the plane cuts none of these parts' })
  const none = await call(measures, 'section', { plane: 'current' })
  expect(none).toMatchObject({ isError: true, text: 'the user has no section on screen: give a plane, as {origin, normal} or {axis, at}' })
})

/**
 * What a drawing of the plate cut across Z shows: the share of it in the
 * plate's colour, the colour inside each hole (off the lines of the grid,
 * which show through it), and the colour of a point of the plate between them. The plot is found from the pixels: the box
 * of everything in the plate's colour is the plate, 40 × 30 mm.
 */
function findOnSheet(base64: string): Promise<{ plate: number; holes: number[][]; solid: number[] }> {
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const { width, height } = bitmap
    const pixels = ctx.getImageData(0, 0, width, height).data
    // #7B93B4 at 80 % over the sheet, or over a line of the grid, which shows faintly through it.
    const isPlate = (i: number): boolean => [147, 165, 191].every((value, channel) => Math.abs(pixels[i + channel] - value) <= 8)
    let [x0, y0, x1, y1, count] = [width, height, 0, 0, 0]
    // Below the legend, whose swatch is in the same colour.
    for (let y = Math.round(height * 0.15); y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!isPlate((y * width + x) * 4)) continue
        count += 1
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
    }
    // u from -20 to 20 runs right, v from -15 to 15 runs up.
    const at = (u: number, v: number): number[] => {
      const x = Math.round(x0 + ((u + 20) / 40) * (x1 - x0))
      const y = Math.round(y1 - ((v + 15) / 30) * (y1 - y0))
      return [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3)]
    }
    return { plate: count / (width * height), holes: [at(-11.2, 6.3), at(8.8, 6.3)], solid: at(1.3, 5.6) }
  }, base64)
}

test('check says how far apart two parts are, what they share, and whether a mesh is closed', async () => {
  // In the assembly the post stands on the base; laid out for printing it lies beside it, its axis 40 mm from the
  // base's edge and 1.5 mm above it: the round side is that far less its radius of 4.
  const touching = JSON.parse((await call(bracket, 'check', { kind: 'clearance', a: 'base', b: 'post', layout: 'assembly' })).text)
  expect(touching).toMatchObject({ layout: 'assembly', kind: 'clearance', distance: 0, overlapping: false, reading: 'clearance 0 mm between base and post: the parts touch' })
  const apart = JSON.parse((await call(bracket, 'check', { kind: 'clearance', a: 'base', b: 'post', layout: 'print' })).text)
  expect(apart.distance).toBeCloseTo(Math.hypot(40, 1.5) - 4, 6)
  expect(apart).toMatchObject({ overlapping: false, how: 'minimum', reading: 'clearance 36.03 mm between base and post' })
  expect(apart.points).toHaveLength(2)
  expect(JSON.parse((await call(bracket, 'check', { kind: 'overlap', a: 'base', b: 'post', layout: 'assembly' })).text)).toMatchObject({ bbox: null, reading: 'no overlap between base and post' })
  const mesh = JSON.parse((await call(bracket, 'check', { kind: 'mesh', a: 'post', layout: 'assembly' })).text)
  expect(mesh).toMatchObject({ watertight: true, openEdges: 0, where: [] })
  expect(mesh.reading).toBe(`mesh of post: closed, ${mesh.triangles.toLocaleString('en-US')} triangles`)
  const face = await call(bracket, 'check', { kind: 'mesh', a: 'post/F0', layout: 'assembly' })
  expect(face).toMatchObject({ isError: true, text: 'check mesh is of whole parts, and post/F0 is a face: give post' })
})

test("add_mark with a dimension leaves a check of the agent's that the user sees with its verdict, measured by the kernel", async () => {
  const hole = plateFaces.find((f) => /^cylinder, radius 4\b/.test(f.descriptor))!
  const top = plateFaces.find((f) => /^plane, normal \+Z, z = 3,/.test(f.descriptor))!
  const bottom = plateFaces.find((f) => /^plane, normal -Z, z = -3,/.test(f.descriptor))!
  const unchecked = await checks('measures')
  const placed = await call(measures, 'add_mark', { kind: 'dimension', note: 'for an M8 bolt', measure: 'diameter', a: hole.ref, expected: 8.4, tolerance: 0.1 })
  expect(placed.isError, placed.text).toBe(false)
  expect(placed.text).toBe(`placed in layout assembly: (yours) M1 diameter 8 mm, ${hole.ref} (expected 8.4 ± 0.1: FAIL, 0.4 under): "for an M8 bolt"\nrevision r1`)
  const thick = await call(measures, 'add_mark', { kind: 'dimension', note: '', measure: 'distance', a: { ref: top.ref, point: [-15, -10, 3] }, b: { ref: bottom.ref, point: [-15, -10, -3] }, expected: 6 })
  expect(thick.text).toBe(`placed in layout assembly: (yours) M2 distance 6 mm between planes, ${top.ref} to ${bottom.ref} (expected 6 ± 0.05: pass)\nrevision r1`)

  // The check every new mark sets off leaves both as they were said to be: on what was named, with their values.
  await checked('measures', unchecked)
  await expect.poll(async () => (await state()).marks.map((m) => [m.id, m.checkedRevision])).toEqual([['M1', 1], ['M2', 1]])
  const marks = (await state()).marks
  expect(marks[0]).toMatchObject({ id: 'M1', kind: 'dimension', author: 'agent', status: 'sent', anchorState: 'ok', measure: 'diameter', value: 8, expected: 8.4, tolerance: 0.1, verdict: 'fail', measuredRevision: 1, a: { ref: hole.ref } })
  expect(marks[1]).toMatchObject({ id: 'M2', author: 'agent', status: 'sent', anchorState: 'ok', value: 6, verdict: 'pass', a: { ref: top.ref }, b: { ref: bottom.ref } })
  const row = page.locator('.mark-row[data-mark="M1"]')
  await expect(row).toHaveAttribute('data-author', 'agent')
  await expect(row.locator('.mark-value')).toHaveAttribute('data-verdict', 'fail')
  await expect(page.locator('.mark-row[data-mark="M2"] .mark-value')).toHaveAttribute('data-verdict', 'pass')

  // A dimension has two ends, or is of one thing at a point: its number stands for neither in measure.
  expect(await call(measures, 'measure', { kind: 'radius', a: 'M1' })).toMatchObject({ isError: true, text: 'M1 is a dimension: name the ref or point of the end you mean' })
  // scene counts how the checks stand on the build.
  expect(JSON.parse((await call(measures, 'scene')).text).dimensions).toEqual({ pass: 1, fail: 1, notMeasured: 0 })

  // What the kernel cannot measure is not kept.
  const flat = await call(measures, 'add_mark', { kind: 'dimension', note: '', measure: 'radius', a: { ref: top.ref, point: [-15, -10, 3] } })
  expect(flat.isError).toBe(true)
  expect(flat.text).toContain(top.ref)
  expect((await state()).marks).toHaveLength(2)
})

test("show with a section cuts the user's view, look draws it or another, and scene says which it is", async () => {
  expect(JSON.parse((await call(measures, 'scene')).text).section).toBeNull()
  const whole = await drawn((await call(measures, 'look', { view: 'front', marks: false })).content[0].data!)
  const shown = await call(measures, 'show', { section: { axis: 'y', at: 0 } })
  expect(shown.isError, shown.text).toBe(false)
  expect(shown.text).toContain('cut at y = 0, +Y side removed')
  expect((await state()).section).toEqual({ origin: [0, 0, 0], normal: [0, 1, 0] })
  await expect.poll(async () => JSON.parse((await call(measures, 'scene')).text).section).toEqual({ origin: [0, 0, 0], normal: [0, 1, 0], axis: 'y', at: 0 })
  // For now only: the file that keeps the user's view has no section in it.
  const kept = join(root, 'measures', '.torno', 'scene.json')
  await page.waitForTimeout(700)
  expect(existsSync(kept) ? JSON.parse(readFileSync(kept, 'utf8')).section ?? null : null).toBeNull()

  // A section tool call with 'current' is now of that plane.
  const theirs = JSON.parse((await call(measures, 'section', { plane: 'current' })).text) as CutJson
  expect(theirs.plane).toMatchObject({ axis: 'y', at: 0 })

  // look: as the user sees it by default; cut by a plane of its own; or whole.
  const current = await call(measures, 'look', { view: 'top', marks: false })
  expect(current.text).toContain('cut at y = 0, +Y side removed')
  const own = await call(measures, 'look', { view: 'front', marks: false, section: { axis: 'x', at: 0 } })
  expect(own.text).toContain('cut at x = 0, +X side removed')
  const half = await drawn(own.content[0].data!)
  expect(half.drawn).toBeLessThan(whole.drawn * 0.7)
  expect(half.drawn).toBeGreaterThan(whole.drawn * 0.3)
  const uncut = await call(measures, 'look', { view: 'front', marks: false, section: null })
  expect(uncut.text).not.toContain('cut at')
  expect((await drawn(uncut.content[0].data!)).drawn).toBeCloseTo(whole.drawn, 2)

  expect((await call(measures, 'show', { section: null })).isError).toBe(false)
  expect((await state()).section).toBeNull()
})

test('in a print layout torno spread, nothing between two parts is told as the model\'s, and a section says where its parts were moved', async () => {
  await openObject('spread')
  const spread = await connect('spread')
  const scene = JSON.parse((await call(spread, 'scene')).text) as { layouts: string[]; parts: Array<{ name: string; layout: string; arranged?: number[] }> }
  const moved = scene.parts.filter((p) => p.layout === 'print' && p.arranged)
  expect(moved.length).toBeGreaterThan(0)
  const [a, b] = scene.parts.filter((p) => p.layout === 'print').map((p) => p.name)
  const others = scene.layouts.filter((l) => l !== 'print')
  const where = others.length > 0 ? `Ask in a layout that places the parts as assembled (layouts: ${others.join(', ')}), or check each part by itself.` : 'This object has no layout that places its parts as assembled: check each part by itself.'
  for (const [kind, what] of [['overlap', 'what is shared between'], ['clearance', 'the distance between']] as const) {
    const refused = await call(spread, 'check', { kind, a, b, layout: 'print' })
    expect(refused).toMatchObject({ isError: true, text: `In layout print torno spread these parts apart for display (they overlapped as the model placed them), so ${what} ${a} and ${b} there is torno's, not the model's. ${where}` })
  }
  expect((await call(spread, 'measure', { kind: 'distance', a, b, layout: 'print' })).isError).toBe(true)
  // Nor is a dimension between them kept as a check of the part: not the agent's, and not one the window asks for.
  const sentence = `In layout print torno spread these parts apart for display (they overlapped as the model placed them), so the distance between ${a} and ${b} there is torno's, not the model's. ${where}`
  const pinned = await call(spread, 'add_mark', { kind: 'dimension', note: '', measure: 'distance', a: `${a}/F0`, b: `${b}/F0`, layout: 'print', expected: 5 })
  expect(pinned).toMatchObject({ isError: true, text: sentence })
  const asked = await page.evaluate(
    ([first, second]) => {
      const s = window.__tornoTest!.state()
      const end = (part: string) => ({ point: [0, 0, 0] as [number, number, number], part, ref: `${part}/F0` })
      return window.torno.marks.add(s.objectId!, { kind: 'dimension', measure: 'distance', author: 'user', note: '', layout: 'print', revision: s.revision, camera: window.__tornoTest!.camera(), a: end(first), b: end(second) }).then(
        () => 'kept',
        (e: Error) => e.message
      )
    },
    [a, b]
  )
  expect(asked).toBe(sentence)
  expect((await state()).marks).toEqual([])
  // One part is the same wherever it is put: answered, with how far it was moved.
  const volume = JSON.parse((await call(spread, 'measure', { kind: 'volume', a: moved[0].name, layout: 'print' })).text)
  expect(volume).toMatchObject({ exact: true, arranged: moved[0].arranged })
  const mesh = await call(spread, 'check', { kind: 'mesh', a: moved[0].name, layout: 'print' })
  expect(mesh.isError).toBe(false)

  const cut = JSON.parse((await call(spread, 'section', { plane: { axis: 'z', at: 1 }, layout: 'print' })).text) as CutJson & { note?: string }
  expect(cut.note).toBe('The parts of the print layout overlapped as the model placed them, so they were spread along X for display; arranged is how far each was moved.')
  expect(cut.reading).toContain('· layout print (parts spread for display): ')
  expect(cut.parts.find((p) => p.part === moved[0].name)?.arranged).toEqual(moved[0].arranged)
})

// ---- Scans, from the agent's side ----

let hollow: Client
const DEVIATION = { near: [0x8a, 0x45, 0x94], far: [0xd3, 0xd8, 0xdf], inside: [0x22, 0x25, 0x2a] }
const near = (rgb: number[], to: number[]): boolean => rgb.every((c, i) => Math.abs(c - to[i]) <= 3)
/** Where the sheet is put: as it was imported, by three pairs of points that are not in a line and that it leaves nothing apart. */
/** What a picture's caption says of that alignment: what it rests on, and that no build can say whether it holds. */
const BASIS = '3 pairs, RMS under 0.1 mm; tied to no point of the model: not checked against builds'
const AS_IMPORTED = {
  transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 },
  steps: ['pairs'],
  pairs: [[-9.5, -9.5, 1], [9.5, -9.5, 1], [0.5, 9.5, 1]].map((point) => ({ scan: point, model: point, residual: 0 })),
  frame: { tub: [0, 0, 0], lid: [0, 0, 0] }
}

test('the agent lists a scan, is refused until it is aligned, and then reads a clash, a deviation, a distance and a cut of it', async () => {
  await openObject('hollow')
  hollow = await connect('hollow')
  // A sheet in the tub's floor, which is 2 mm thick from z = 0: 400 vertices, each 1 mm deep.
  const file = join(root, 'sheet.stl')
  writeFileSync(file, stl(grid(20, 1, () => 1)))
  await app.evaluate((_electron, file) => (globalThis as any).__tornoMain.scans.import('hollow', file), file)
  const listed = JSON.parse((await call(hollow, 'scans')).text)
  expect(listed.scans).toMatchObject([{ id: 'S1', name: 'sheet.stl', triangles: 722, mesh: 'ok', source: { state: 'present' }, alignment: { state: 'not aligned' }, alignedIn: [] }])
  expect(listed.reading).toMatch(/^S1 sheet\.stl: 722 triangles, 19 × 19 × 0 mm, from mm, Z up \(assumed\), not aligned in assembly, /)
  expect(JSON.parse((await call(hollow, 'scene')).text)).toMatchObject({ scans: [{ id: 'S1', name: 'sheet.stl', triangles: 722, alignment: 'not aligned' }], note: 'How each scan is aligned is said for layout assembly, in a word (aligned, rough, in doubt, not checked, not aligned): call scans for the whole of it.' })
  const NOT_ALIGNED = 'S1 is not aligned in layout assembly (it is aligned in no layout), so nothing is checked against it there: the user aligns it in assembly with the Align tool (an alignment is of one layout)'
  for (const [name, args] of [['scan_clash', { part: 'tub' }], ['scan_deviation', { part: 'tub' }], ['measure', { kind: 'distance', a: { scan: 'S1', point: [0, 0, 1] }, b: 'lid' }], ['section', { plane: { axis: 'x', at: 0.25 }, scan: 'S1' }], ['look', { scanColour: { part: 'tub' } }]] as const) {
    expect(await call(hollow, name, args), name).toMatchObject({ isError: true, text: NOT_ALIGNED })
  }
  // The picture draws it all the same, and says that it is not where the model is.
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.scans()))[0]?.loaded).toBe(true)
  expect((await call(hollow, 'look', { view: 'front', size: 256 })).text).toContain('scans S1 (not aligned in assembly: drawn where it was imported)')

  await app.evaluate((_electron, alignment) => (globalThis as any).__tornoMain.scans.align('hollow', 'S1', 'assembly', { ...alignment, at: new Date().toISOString() }), AS_IMPORTED)
  // Task 5's fix round 1: an alignment says so until it was checked against the build there is. Kept through the store, as here, it is
  // checked by nobody: what the check finds of one tied to no point of the model is put there by hand.
  await app.evaluate((_electron, revision) => (globalThis as any).__tornoMain.scans.checked('hollow', 'S1', 'assembly', { revision, of: 0, off: 0, worst: 0, moved: [] }), (await state()).revision)
  const clash = JSON.parse((await call(hollow, 'scan_clash', { part: 'tub' })).text)
  expect(clash).toMatchObject({ layout: 'assembly', scan: 'S1', exact: false, alignment: { state: 'aligned', by: 'by 3 pairs (RMS under 0.1 mm, worst under 0.1 mm)', pairs: 3 }, inside: { count: 400, crossing: 0 }, points: { scan: 400, touching: 0 } })
  expect(clash.deepest.depth).toBeCloseTo(1, 6)
  expect(clash.reading).toMatch(/^scan_clash tub vs S1 \(assembly, r\d+\): ≈ 400 scan points inside the part in 1 cluster, deepest 1 mm at .* under tub\/F\d+; no scan triangle crosses its surface\. S1 is aligned by 3 pairs \(RMS under 0\.1 mm, worst under 0\.1 mm\): that RMS is of the clicked points, and says nothing of how true the scan is \(tied to no point of the model: not checked against builds\)\.$/)
  // What was applied is said back, and a key the tool does not take is refused by name, never dropped.
  expect(clash.ignore).toEqual([])
  expect(await call(hollow, 'scan_clash', { part: 'tub', ignored: ['M7'] })).toMatchObject({ isError: true, text: 'scan_clash takes no "ignored": did you mean ignore? An unknown key is not ignored: nothing was done. It takes: part, scan, ignore, margin, layout.' })
  const lid = JSON.parse((await call(hollow, 'scan_clash', { part: 'lid' })).text)
  expect(lid.inside.count).toBe(0)
  expect(lid.reading).toContain('no scan point is within 5 mm of the part')
  // The lid's underside is at z = 38: the sheet is 37 mm under it.
  const far = JSON.parse((await call(hollow, 'scan_deviation', { part: 'lid', from: 'scan', within: 100 })).text)
  expect(far.distance.min).toBeGreaterThanOrEqual(37 - 1e-6)
  expect(far.distance.min).toBeLessThan(37.2)
  expect(far).toMatchObject({ samples: 400, sampling: { asked: 10000, partial: false } })
  expect(far.reading).toMatch(/^scan_deviation lid vs S1 \(assembly, r\d+\): ≈ 37 mm at the nearest; of the 400 scan points that have the part within 100 mm \(further is not looked at\): ≈ 37 mm median, /)
  const distance = JSON.parse((await call(hollow, 'measure', { kind: 'distance', a: { scan: 'S1', point: [0.5, 0.5, 1] }, b: 'lid' })).text)
  expect(distance).toMatchObject({ exact: false, scan: 'S1', approximate: 'a scan is a mesh measured by a phone or a scanner: nothing from it is exact' })
  expect(distance.value).toBeCloseTo(37, 6)
  expect(distance.reading).toMatch(/^≈ 37 mm .*approximate \(S1 is a scan\), \(0\.5, 0\.5, 1\) given as a point of S1 to lid\. S1 is aligned by 3 pairs/)

  const cut = await call(hollow, 'section', { plane: { axis: 'x', at: 0.25 }, scan: 'S1', size: 256 })
  const cutData = JSON.parse(cut.text)
  // Across 19 cells, each cut at its side and at its diagonal.
  expect(cutData.scan).toMatchObject({ id: 'S1', exact: false, points: 39, of: 39 })
  expect(cutData.scan.polylines).toHaveLength(1)
  expect(cutData.reading).toContain('≈ S1 (a scan, approximate) crosses the plane in 1 line. S1 is aligned by 3 pairs')
  expect(cut.content.some((block) => block.type === 'image')).toBe(true)
  expect(cutData.image).toMatch(/^\d+×\d+, the parts in the colours the user sees them in/)
})

test('look draws the scans or leaves them out, and colours one by its distance to a part in the colours its caption gives', async () => {
  const withScan = await call(hollow, 'look', { view: 'front', size: 256 })
  const without = await call(hollow, 'look', { view: 'front', size: 256, scans: false })
  // Task 5's fix round 1: the caption says what the alignment rests on, and what no build can say of it.
  expect(withScan.text).toContain(` · scans S1 (${BASIS}) · `)
  expect(without.text).not.toContain('scans')
  // From below, with the tub left out: the sheet is seen in front of the lid, and every point of it is in the tub's floor.
  const inside = await call(hollow, 'look', { view: 'bottom', size: 256, parts: ['lid'], scanColour: { part: 'tub' } })
  expect(inside.isError).toBe(false)
  expect(inside.text).toContain(` · scans S1 (${BASIS}) · scan S1 coloured by the distance of its points to tub: 0 to 20 mm, inside the part marked and drawn over it (0 mm #8A4594, 20 mm and beyond #D3D8DF, inside the part #22252A; the colours are of the scan's points, shaded, and approximate; beyond 20 mm the scan is seen through) · `)
  expect(near((await pixelAt(inside.content[0].data!, 0.5, 0.5)).rgb, DEVIATION.inside)).toBe(true)
  // Against the lid it is 37 mm away. Final fix wave (F4): the colours are shaded, so a pixel is about its swatch, not on it;
  // beyond 20 mm the scan is seen through (the lid behind it shows), and within 74 mm it is half way along the ramp: more purple than beyond it.
  const beyond = await call(hollow, 'look', { view: 'bottom', size: 256, parts: ['lid'], scanColour: { part: 'lid' } })
  const far = (await pixelAt(beyond.content[0].data!, 0.5, 0.5)).rgb
  expect(near(far, DEVIATION.inside)).toBe(false)
  const half = await call(hollow, 'look', { view: 'bottom', size: 256, parts: ['lid'], scanColour: { part: 'lid', range: 74 } })
  expect(half.text).toContain('0 to 74 mm')
  const ramp = (await pixelAt(half.content[0].data!, 0.5, 0.5)).rgb
  // The ramp's own hue: less green against red and blue than the grey beyond it.
  expect(ramp[1] - (ramp[0] + ramp[2]) / 2).toBeLessThan(far[1] - (far[0] + far[2]) / 2 - 8)
  // The scan is as it was on screen afterwards: in its own look, and where it stood.
  const after = await call(hollow, 'look', { view: 'bottom', size: 256, parts: ['lid'] })
  expect(after.text).not.toContain('coloured')
  expect(near((await pixelAt(after.content[0].data!, 0.5, 0.5)).rgb, DEVIATION.inside)).toBe(false)
  expect(await call(hollow, 'look', { scanColour: { part: 'cap' } })).toMatchObject({ isError: true, text: "no part 'cap' in layout assembly (parts: tub, lid)" })
})

test("show switches the scans for now, not in the user's saved view, and the prompt tells the agent of them in one line", async () => {
  const thin = await call(hollow, 'show', { scans: ['S1'], scanOpacity: 0.5 })
  expect(thin.isError).toBe(false)
  expect(thin.text).toContain(` · scans S1 at 50 % (${BASIS}) · `)
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.scans()))[0].opacity).toBe(0.5)
  const shown = await call(hollow, 'show', { scans: [] })
  expect(shown.isError).toBe(false)
  expect(shown.text).not.toContain('scans')
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.scans()))[0].visible).toBe(false)
  // For now only: the person's scene file does not say the scan is hidden, nor thinned.
  const sceneFile = join(root, 'hollow', '.torno', 'scene.json')
  await page.waitForTimeout(700)
  expect((existsSync(sceneFile) ? JSON.parse(readFileSync(sceneFile, 'utf8')) : {}).scans).toBeUndefined()
  expect((await state()).shownByAgent?.scans).toEqual({ S1: undefined })
  expect(await call(hollow, 'show', { scanOpacity: 3 })).toMatchObject({ isError: true })

  await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
  await expect.poll(terminal).toContain('READY')
  const argv: string[] = JSON.parse(/READY (\[.*\])/s.exec((await terminal()).replace(/\n/g, ''))![1])
  // Claude Code is told of the scans in one line that names the skill; the skill names the scan tools (#4).
  expect(argv[argv.indexOf('--append-system-prompt') + 1]).toContain('see the skill torno:scans')
  expect(argv[argv.indexOf('--plugin-dir') + 1]).toMatch(/agent-plugin$/)
  await prompt()
  await expect.poll(async () => times(await said(), 'Scans: S1 sheet.stl, aligned in assembly by 3 pairs (RMS under 0.1 mm, worst under 0.1 mm) (tied to no point of the model: not checked against builds), hidden.')).toBe(1)
})

// Set TORNO_SHOTS=<dir> to write the drawings the agent is given of a section there: the measures plate
// cut across Z through its pocket (section-drawing-plate.png) and the hollow box cut through its cavity
// (section-drawing-hollow.png).
test('design shots of the section drawing', async () => {
  const dir = process.env.TORNO_SHOTS
  test.skip(!dir, 'TORNO_SHOTS is not set')
  mkdirSync(dir!, { recursive: true })
  const plate = await call(measures, 'section', { plane: { axis: 'z', at: 0 } })
  writeFileSync(join(dir!, 'section-drawing-plate.png'), Buffer.from(plate.content[0].data!, 'base64'))
  await openObject('hollow')
  const cut = await call(hollow, 'section', { plane: { axis: 'y', at: 0 } })
  writeFileSync(join(dir!, 'section-drawing-hollow.png'), Buffer.from(cut.content[0].data!, 'base64'))
  // With the scan the same plane cuts, and the scan coloured by its distance to a part (the legend, top left).
  const scanned = await call(hollow, 'section', { plane: { axis: 'y', at: 0.25 }, scan: 'S1' })
  writeFileSync(join(dir!, 'section-drawing-scan.png'), Buffer.from(scanned.content[0].data!, 'base64'))
  for (const [name, args] of [['inside', { part: 'tub' }], ['ramp', { part: 'lid', range: 74 }]] as const) {
    const coloured = await call(hollow, 'look', { view: { position: [60, -90, -50], target: [0, 0, 15] }, parts: ['lid'], scanColour: args })
    writeFileSync(join(dir!, `look-scan-coloured-${name}.png`), Buffer.from(coloured.content[0].data!, 'base64'))
  }
})
