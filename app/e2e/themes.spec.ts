import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { contrast } from '../src/shared/contrast'
import { png } from '../src/test/pngFixtures'
import { grid, stl } from '../src/test/scanFixtures'

// Light and dark. In each theme the window is held to the contrasts its tokens promise, as it computes them,
// and pictures are made for someone to look at: of the parts, as the agent gets them, and of the window.
//
// The window is hidden. A picture of the parts comes from window.__tornoTest.look; one of the window from
// webContents.capturePage(), which gives one image a launch, so every capture has a launch of its own.
// The pictures are written to e2e/.results/themes (ignored by git, and emptied by every run of the suite).
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')
const out = resolve(appDir, 'e2e/.results/themes')

type Theme = 'light' | 'dark'
type Main = { mcpUrlFor(id: string): string; pickFile: string | null }
const temp = (name: string): string => mkdtempSync(join(realpathSync(tmpdir()), `torno-e2e-themes-${name}-`))

const CAMERA = { position: [120, -90, 60], target: [0, 0, 6], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }

/** A copy of the fixtures in which `hollow` has marks of both authors, a dimension that passes and one that fails. */
function workspace(): string {
  const root = temp('ws')
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  mkdirSync(join(root, 'hollow', '.torno'), { recursive: true })
  const base = { author: 'user', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 1, camera: CAMERA, createdAt: '2026-10-09T20:00:00.000Z' }
  writeFileSync(
    join(root, 'hollow', '.torno', 'marks.json'),
    JSON.stringify({
      next: 5,
      marks: [
        { ...base, id: 'M1', kind: 'pin', status: 'draft', note: 'too thin here', anchor: { point: [20, 0, 20], normal: [1, 0, 0], part: 'tub' } },
        { ...base, id: 'M2', kind: 'dimension', note: 'outer width', measure: 'distance', a: { point: [-20, 0, 10], normal: [-1, 0, 0], part: 'tub' }, b: { point: [20, 0, 10], normal: [1, 0, 0], part: 'tub' }, expected: 40 },
        { ...base, id: 'M3', kind: 'dimension', note: 'height with the lid', measure: 'distance', a: { point: [0, 0, 0], normal: [0, 0, -1], part: 'tub' }, b: { point: [0, 0, 40], normal: [0, 0, 1], part: 'lid' }, expected: 42 },
        { ...base, id: 'M4', kind: 'pin', author: 'agent', note: 'I thickened this wall to 2 mm', anchor: { point: [0, -20, 20], normal: [0, -1, 0], part: 'tub' } }
      ]
    })
  )
  return root
}

/** Starts torno hidden in a theme. TORNO_TEST=1 makes main create the window with show: false: never launch without it. */
async function start(theme: Theme, env: Record<string, string>): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, ...env } })
  // The theme of the system, as torno is told of it: the window's own ground and the tokens follow.
  await app.evaluate(({ nativeTheme }, theme) => void (nativeTheme.themeSource = theme), theme)
  const page = await app.firstWindow()
  await page.emulateMedia({ colorScheme: theme })
  return { app, page }
}

const state = (page: Page): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())

async function open(page: Page, id: string, status = 'ok'): Promise<void> {
  await page.locator('.object-row', { hasText: id }).click()
  await expect.poll(async () => ((await state(page)).objectId === id ? (await state(page)).build?.status : null), { timeout: 60_000 }).toBe(status)
  if (status === 'ok') await expect.poll(async () => (await state(page)).scene !== null).toBe(true)
}

async function agent(app: ElectronApplication, id: string): Promise<Client> {
  const url = await app.evaluate((_electron, object) => (globalThis as unknown as { __tornoMain: Main }).__tornoMain.mcpUrlFor(object), id)
  const client = new Client({ name: 'torno-e2e', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  return client
}

/** The whole window as it is drawn, once: its fonts loaded, a frame drawn, and its focus shown as in a window in use. */
async function capture(app: ElectronApplication, page: Page, name: string, dir = out): Promise<void> {
  const devtools = await page.context().newCDPSession(page)
  await devtools.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.png`), Buffer.from(png, 'base64'))
}

const TOKENS = ['--surface', '--panel', '--ink', '--muted', '--accent', '--hairline', '--user-mark', '--agent-mark', '--ok', '--warn', '--fail', '--scroll-thumb'] as const

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the window has the theme's tokens at their contrasts, and the pictures of the parts are made`, async () => {
    test.setTimeout(120_000)
    const root = workspace()
    const { app, page } = await start(theme, { TORNO_WORKSPACE: root })
    let client: Client | null = null
    try {
      await page.waitForSelector('[data-region="left"]')
      await open(page, 'hollow')
      // A mark of the agent's left as the agent leaves one, and a view saved under a name.
      client = await agent(app, 'hollow')
      const added = await client.callTool({ name: 'add_mark', arguments: { kind: 'pin', note: 'the post stands here', ref: 'lid' } })
      expect(added.isError === true).toBe(false)
      await page.getByRole('button', { name: 'Save view' }).click()
      await page.getByRole('textbox', { name: 'Name of the view' }).fill('From the front')
      await page.keyboard.press('Enter')
      await expect(page.locator('.view-chip[data-view="From the front"]')).toBeVisible()
      await expect.poll(async () => (await state(page)).marks.length).toBe(5)

      // The tokens as the window computes them, each a colour written #rrggbb.
      const tokens = await page.evaluate((names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()])), [...TOKENS])
      for (const name of TOKENS) expect([name, /^#[0-9a-fA-F]{6}$/.test(tokens[name])]).toEqual([name, true])
      // The window has the theme that was asked for: the ground is the light one or the dark one.
      expect(contrast(tokens['--surface'], '#ffffff') < 2).toBe(theme === 'light')
      for (const ground of ['--surface', '--panel']) {
        expect(contrast(tokens['--ink'], tokens[ground])).toBeGreaterThanOrEqual(7)
        expect(contrast(tokens['--muted'], tokens[ground])).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(tokens['--accent'], tokens['--panel'])).toBeGreaterThanOrEqual(4.5)
      for (const name of ['--user-mark', '--agent-mark', '--ok', '--warn', '--fail']) expect([name, contrast(tokens[name], tokens['--surface']) >= 3]).toEqual([name, true])
      const hairline = contrast(tokens['--hairline'], tokens['--surface'])
      expect(hairline).toBeGreaterThanOrEqual(1.15)
      expect(hairline).toBeLessThanOrEqual(2)
      // What is drawn has them: muted text is the muted token, and the window's own ground is the surface.
      const drawn = await page.evaluate(() => ({ muted: getComputedStyle(document.querySelector('.section-title')!).color, ground: getComputedStyle(document.body).backgroundColor }))
      const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`
      expect(drawn).toEqual({ muted: rgb(tokens['--muted']), ground: rgb(tokens['--surface']) })
      // What the system draws follows the theme too: on a visible screen the list of objects scrolled with the light
      // native bar in the dark theme. One scheme, said outright, and every scroller the thin one in the theme's grey.
      const scrolling = await page.evaluate(() => {
        const of = (el: Element) => ({ width: getComputedStyle(el).scrollbarWidth, colour: getComputedStyle(el).scrollbarColor })
        return { scheme: getComputedStyle(document.documentElement).colorScheme, objects: of(document.querySelector('nav.objects .rows')!), body: of(document.body) }
      })
      const thin = { width: 'thin', colour: `${rgb(tokens['--scroll-thumb'])} rgba(0, 0, 0, 0)` }
      expect(scrolling).toEqual({ scheme: theme, objects: thin, body: thin })

      // The parts as the agent gets them: as on screen, cut, and apart.
      mkdirSync(out, { recursive: true })
      const shots: Array<[string, object]> = [
        ['view', { size: 1280 }],
        ['section', { view: 'front', section: { origin: [0, 0, 3], normal: [0, -1, 0] } }],
        ['exploded', { explode: { amount: 1, scale: 1, axis: 'z' } }]
      ]
      const pictures: Buffer[] = []
      for (const [name, request] of shots) {
        const picture = await page.evaluate((request) => window.__tornoTest!.look(request as never).then((p) => ({ png: Array.from(p.png), caption: p.caption })), request)
        writeFileSync(join(out, `${theme}-${name}.png`), Buffer.from(picture.png))
        expect(picture.png.length).toBeGreaterThan(5000)
        pictures.push(Buffer.from(picture.png))
      }
      // The picture of the object's card, as it is on file: a clear ground, whatever the theme.
      const thumb = join(root, 'hollow', '.torno', 'thumb.png')
      await expect.poll(() => existsSync(thumb)).toBe(true)
      cpSync(thumb, join(out, `${theme}-thumb.png`))

      // The window, with the sheet of keys over it.
      await page.locator('[data-region="viewport"] canvas').first().click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('?')
      await expect(page.getByRole('dialog', { name: 'Keys' })).toBeVisible()
      await capture(app, page, `${theme}-window`)
      // What was captured is a picture, and of the whole window.
      const captured = readFileSync(join(out, `${theme}-window.png`))
      expect(captured.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      const size = await page.evaluate(() => [window.innerWidth, window.innerHeight])
      expect([captured.readUInt32BE(16) >= size[0], captured.readUInt32BE(20) >= size[1]]).toEqual([true, true])

      // The same view in the other theme is another picture, where asking twice in one theme gives the same one.
      const look = (): Promise<Buffer> => page.evaluate((request) => window.__tornoTest!.look(request as never).then((p) => Array.from(p.png)), shots[0][1]).then((png) => Buffer.from(png))
      expect((await look()).equals(pictures[0])).toBe(true)
      const other: Theme = theme === 'light' ? 'dark' : 'light'
      await app.evaluate(({ nativeTheme }, to) => void (nativeTheme.themeSource = to), other)
      await page.emulateMedia({ colorScheme: other })
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim())).not.toBe(tokens['--surface'])
      const again = await look()
      expect(again.length).toBeGreaterThan(5000)
      expect(again.equals(pictures[0])).toBe(false)
    } finally {
      await client?.close()
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
}

// Set TORNO_SHOTS=<dir>, as for the captures of the other specs, to capture the window in every state the pass
// over the themes looks at, one launch each, into <dir>/ui-<state>-<theme>.png.
const STATES = ['main', 'section', 'explode', 'views', 'scans', 'scan-read', 'region', 'page', 'export', 'error', 'welcome', 'empty', 'folders', 'chat', 'view-board', 'onboard', 'onboard-board'] as const

for (const theme of ['light', 'dark'] as const) {
  for (const shot of STATES) {
    test(`capture of the window, ${shot}, ${theme}`, async () => {
      test.skip(!process.env.TORNO_SHOTS, 'TORNO_SHOTS is not set')
      test.setTimeout(120_000)
      const root = shot === 'empty' || shot === 'welcome' ? temp('bare') : workspace()
      const env: Record<string, string> = {}
      if (shot === 'welcome') {
        // The first screen with folders opened lately, one of them gone. The file is this test's own.
        for (const name of ['objects', 'printer-parts']) mkdirSync(join(root, name))
        writeFileSync(join(root, 'config.json'), JSON.stringify({ recent: [join(root, 'objects'), join(root, 'helmet'), join(root, 'printer-parts')] }))
        env.TORNO_CONFIG = join(root, 'config.json')
      } else env.TORNO_WORKSPACE = root
      if (shot === 'folders') {
        // The menu of the folder button, with folders opened lately, one of them gone. The file is this test's own, outside the workspace.
        const home = temp('folders')
        mkdirSync(join(home, 'printer-parts'))
        writeFileSync(join(home, 'config.json'), JSON.stringify({ recent: [join(home, 'helmet'), join(home, 'printer-parts')] }))
        env.TORNO_CONFIG = join(home, 'config.json')
      }
      const { app, page } = await start(theme, env)
      let client: Client | null = null
      const canvas = page.locator('[data-region="viewport"] canvas').first()
      const scan = async (): Promise<void> => {
        const file = join(root, 'sheet.stl')
        writeFileSync(file, stl(grid(30, 1, (x, y) => 41 + 0.4 * Math.sin(x / 3) * Math.cos(y / 4))))
        await app.evaluate((_electron, path) => void ((globalThis as unknown as { __tornoMain: Main }).__tornoMain.pickFile = path), file)
        await page.getByRole('button', { name: 'Import scan…' }).click()
        await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.scans()))[0]?.ready, { timeout: 60_000 }).toBe(true)
      }
      try {
        if (shot === 'welcome') await expect(page.getByRole('navigation', { name: 'Recent folders' }).locator('li')).toHaveCount(3)
        else await page.waitForSelector('[data-region="left"]')
        if (shot === 'empty') await expect(page.locator('.show-empty')).toBeVisible()
        if (shot !== 'welcome' && shot !== 'empty' && shot !== 'error') await open(page, 'hollow')
        if (shot === 'main') {
          // A mark's row opened, as when it is being read.
          await page.locator('.mark-row').first().click()
        } else if (shot === 'section') {
          await page.keyboard.press('x')
          await page.getByRole('button', { name: 'Cut across Y' }).click()
          await expect.poll(async () => (await state(page)).section !== null).toBe(true)
        } else if (shot === 'explode') {
          await canvas.click({ position: { x: 5, y: 5 } })
          await page.keyboard.press('e')
          await expect(page.getByRole('slider', { name: 'Explode' })).toBeVisible()
        } else if (shot === 'views') {
          for (const name of ['From the front', 'Lid side']) {
            await page.getByRole('button', { name: 'Save view' }).click()
            await page.getByRole('textbox', { name: 'Name of the view' }).fill(name)
            await page.keyboard.press('Enter')
            await expect(page.locator(`.view-chip[data-view="${name}"]`)).toBeVisible()
          }
          client = await agent(app, 'hollow')
          const proposed = await client.callTool({ name: 'save_view', arguments: { name: 'Wall at the post', view: 'front', parts: ['tub'], note: 'the 2 mm wall M1 is about' } })
          expect(proposed.isError === true).toBe(false)
          await expect(page.locator('.view-chip[data-view="Wall at the post"]')).toBeVisible()
          await page.locator('.view-chip[data-view="Wall at the post"]').click()
        } else if (shot === 'scans') {
          await scan()
          // The question put off, the one-line row with its detail open under it.
          await page.getByRole('dialog', { name: 'How is S1 read?' }).getByRole('button', { name: 'Later' }).click()
          await page.getByRole('button', { name: 'Details of S1' }).click()
          await expect(page.locator('.scan-detail')).toBeVisible()
          await page.keyboard.press('l')
          await expect(page.locator('.alignbar')).toBeVisible()
        } else if (shot === 'scan-read') {
          // How a scan just imported is read, asked once: a sheet at the top of the Scans section.
          await scan()
          expect((await state(page)).scans[0].imported.assumed.unit).toBe(true)
          await expect(page.getByRole('dialog', { name: 'How is S1 read?' })).toBeVisible()
        } else if (shot === 'region') {
          await scan()
          await page.getByRole('button', { name: 'Top', exact: true }).click()
          await page.waitForTimeout(600)
          await page.keyboard.press('b')
          await expect(page.locator('.regionbar')).toBeVisible()
          const box = (await canvas.boundingBox())!
          const [fx, fy] = await page.evaluate(() => window.__tornoTest!.projectScan('S1', [0, 0, 41]))
          await page.mouse.move(box.x + fx * box.width - 20, box.y + fy * box.height)
          await page.mouse.down()
          await page.mouse.move(box.x + fx * box.width + 20, box.y + fy * box.height + 6, { steps: 6 })
          await page.mouse.up()
        } else if (shot === 'page') {
          for (const id of ['bracket', 'measures']) await open(page, id)
          appendFileSync(join(root, 'plain', 'plain.py'), '\nraise ValueError("the plate is thinner than its fillet")\n')
          await open(page, 'plain', 'failed')
          await open(page, 'hollow')
          await canvas.click({ position: { x: 5, y: 5 } })
          await page.keyboard.press('w')
          await expect(page.locator('.card[data-object="hollow"] img')).toHaveJSProperty('naturalWidth', 480)
        } else if (shot === 'export') {
          await canvas.click({ position: { x: 5, y: 5 } })
          await page.keyboard.press('Control+Shift+E')
          await expect(page.getByRole('dialog', { name: 'Export' })).toContainText('hollow')
        } else if (shot === 'folders') {
          await page.getByRole('button', { name: 'Folders' }).click()
          await expect(page.getByRole('menu', { name: 'Folders' }).getByRole('menuitem').first()).toBeVisible()
        } else if (shot === 'chat') {
          // A conversation: a prompt with a mark, what torno added, a torno tool with its picture, another tool, and the reply.
          await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
          const box = page.locator('[data-chat-composer]')
          await expect(box).toBeFocused()
          const script = ['say The tub wall at **M1** is 2 mm, thinner than the 3 mm in `hollow.py`. Looking at tub/F3 and tub/E1:', 'tool mcp__torno__look {"view":"iso"}', 'tool Read {"file_path":"hollow.py"}', 'say I will `widen` the wall to 3 mm and rebuild: r2 should pass the check.']
          for (const [n, line] of script.entries()) {
            if (n > 0) await page.keyboard.press('Shift+Enter')
            await page.keyboard.type(line)
          }
          await page.keyboard.press('Enter')
          await expect(page.locator('.chat-turn')).toContainText('Pulled from torno: look, 1 picture', { timeout: 30_000 })
          // Then a request to use a tool, waiting for the person, and a window of the rate limit half used.
          await page.keyboard.type('rate 72')
          await page.keyboard.press('Shift+Enter')
          await page.keyboard.type('ask Write {"file_path":"hollow.py","content":"WALL = 3\\nLID = 2\\n"}')
          await page.keyboard.press('Enter')
          await expect(page.locator('.chat-ask[data-state="open"]')).toBeVisible({ timeout: 30_000 })
          await expect(page.locator('.chat-rate')).toBeVisible()
          await page.keyboard.type('thicker than that, please')
        } else if (shot === 'view-board') {
          // The board over the view, from the chat's "Draw on view": a ring round the middle and an arrow to it.
          await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
          await expect(page.locator('[data-chat-composer]')).toBeFocused()
          await page.locator('[data-region="session"]').getByRole('button', { name: 'Draw on view' }).click()
          const board = page.getByRole('dialog', { name: 'Drawing on the view' })
          const box = (await board.locator('canvas').boundingBox())!
          const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + box.height * fy]
          await board.getByRole('button', { name: 'Thick pen' }).click()
          const ring = Array.from({ length: 25 }, (_, i) => [0.5 + 0.12 * Math.cos((i / 24) * Math.PI * 2), 0.5 + 0.1 * Math.sin((i / 24) * Math.PI * 2)])
          for (const points of [ring, [[0.85, 0.15], [0.62, 0.4]], [[0.62, 0.4], [0.68, 0.4]], [[0.62, 0.4], [0.62, 0.34]]]) {
            await page.mouse.move(...at(points[0][0], points[0][1]))
            await page.mouse.down()
            for (const [fx, fy] of points.slice(1)) await page.mouse.move(...at(fx, fy), { steps: 4 })
            await page.mouse.up()
          }
          await expect(board.locator('canvas')).toHaveAttribute('data-strokes', '4')
        } else if (shot === 'onboard' || shot === 'onboard-board') {
          // The page of a new object with something of every kind given, and, for the second, the doodle board open on a drawing.
          const new_ = page.getByRole('region', { name: 'New object' })
          await page.getByRole('navigation', { name: 'Objects' }).getByRole('button', { name: 'New object' }).click()
          await page.getByLabel('Name', { exact: true }).fill('cable-clip')
          await page.getByLabel('What is it?').fill('A clip that holds a 6 mm cable to the edge of a desk, printed in PETG. The desk is 18 mm thick; the cable must come out downwards.')
          const photos = [join(root, 'desk.png'), join(root, 'cable.png')]
          writeFileSync(photos[0], png(1600, 1000, 90))
          writeFileSync(photos[1], png(900, 1200, 200))
          await app.evaluate((_electron, picked) => void ((globalThis as unknown as { __tornoMain: Main & { pickPhotos: string[] } }).__tornoMain.pickPhotos = picked), photos)
          await new_.getByRole('button', { name: 'Add photos…' }).click()
          await expect(new_.locator('.ref-card[data-kind="photos"]')).toHaveCount(2)
          await new_.locator('.ref-card[data-kind="photos"]').first().getByLabel(/^Note for /).fill('the desk edge, seen from the front')
          const sketch = async (): Promise<void> => {
            await new_.getByRole('button', { name: 'Draw…' }).click()
            const board = page.getByRole('dialog', { name: 'Doodle board' })
            const box = (await board.locator('canvas').boundingBox())!
            const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + box.height * fy]
            await board.getByRole('button', { name: 'Thick pen' }).click()
            for (const points of [[[0.2, 0.3], [0.2, 0.7], [0.45, 0.7], [0.45, 0.55]], [[0.55, 0.4], [0.8, 0.4], [0.8, 0.7]]]) {
              await page.mouse.move(...at(points[0][0], points[0][1]))
              await page.mouse.down()
              for (const [fx, fy] of points.slice(1)) await page.mouse.move(...at(fx, fy), { steps: 6 })
              await page.mouse.up()
            }
          }
          await sketch()
          await page.getByRole('dialog', { name: 'Doodle board' }).getByRole('button', { name: 'Done' }).click()
          await new_.locator('.ref-card[data-kind="doodles"]').first().getByLabel(/^Note for /).fill('the jaw, about 30 mm deep')
          const sheet = join(root, 'desk-scan.stl')
          writeFileSync(sheet, stl(grid(30, 1, (x, y) => 41 + 0.4 * Math.sin(x / 3) * Math.cos(y / 4))))
          await app.evaluate((_electron, path) => void ((globalThis as unknown as { __tornoMain: Main }).__tornoMain.pickFile = path), sheet)
          await new_.getByRole('button', { name: 'Add a scan…' }).click()
          await new_.getByRole('button', { name: 'Refer to an object…' }).click()
          await page.getByRole('menuitem', { name: 'plain' }).click()
          await new_.locator('.ref-card[data-kind="objects"]').first().getByLabel(/^Note for /).fill('mounts on this')
          if (shot === 'onboard-board') {
            await new_.getByRole('button', { name: 'Change doodle 1' }).click()
            await expect(page.getByRole('dialog', { name: 'Doodle board' })).toBeVisible()
          } else await new_.getByLabel('Name', { exact: true }).focus()
        } else if (shot === 'error') {
          await open(page, 'bracket')
          appendFileSync(join(root, 'bracket', 'bracket.py'), '\nraise ValueError("the post is taller than the base is wide")\n')
          await expect.poll(async () => (await state(page)).build?.status, { timeout: 60_000 }).toBe('failed')
          await page.getByRole('button', { name: 'Build failed' }).click()
          await expect(page.getByRole('dialog', { name: 'Build error' })).toBeVisible()
        }
        await capture(app, page, `ui-${shot}-${theme}`, resolve(process.env.TORNO_SHOTS!))
      } finally {
        await client?.close()
        await app.close()
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
}
