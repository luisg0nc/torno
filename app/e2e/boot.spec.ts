import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { keysButton, profileChip } from './helpers'
import { openListed } from './objects'

const appDir = resolve(__dirname, '..')

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
// With a workspace the window shows its shell; without one, the prompt to open a folder.
function launch(workspace?: string): Promise<ElectronApplication> {
  const env = { ...process.env, TORNO_TEST: '1', ...(workspace ? { TORNO_WORKSPACE: workspace } : {}) }
  return electron.launch({ args: ['.'], cwd: appDir, env })
}

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // An empty folder: the shell with nothing in it.
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-boot-'))
  app = await launch(root)
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

// The route card stands at the left only while a project is open: a window of its own for the tests of the card's width.
let cardApp: ElectronApplication | undefined
let cardRoot: string | undefined
async function cardWindow(): Promise<Page> {
  if (!cardApp) {
    cardRoot = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-boot-card-'))
    mkdirSync(join(cardRoot, 'part'))
    writeFileSync(join(cardRoot, 'part', 'part.py'), 'from build123d import Box\n\nplate = Box(20, 20, 2)\n')
    cardApp = await launch(cardRoot)
  }
  const window = await cardApp.firstWindow()
  await window.waitForSelector('[data-region="viewport"]')
  await openListed(window, 'part')
  await window.waitForSelector('[data-region="left"] .route-card')
  return window
}

test.afterAll(async () => {
  await app?.close()
  await cardApp?.close()
  rmSync(root, { recursive: true, force: true })
  if (cardRoot) rmSync(cardRoot, { recursive: true, force: true })
})

test('with no folder open, the window is one prompt with its ways in', async () => {
  const bare = await launch()
  try {
    const barePage = await bare.firstWindow()
    await expect(barePage.locator('[data-region="viewport"]')).toContainText('torno')
    // The way in, and, run from the repository, its example. (When all is ready, "What torno needs" is one more
    // button above them, the fold of its lines: it is the first screen's, not a way in.)
    await expect(barePage.locator('.welcome-ways').getByRole('button')).toHaveText(['Open folder', 'Open the example'])
    await expect(barePage.locator('[data-region="left"], [data-region="session"], [data-region="status"]')).toHaveCount(0)
    // The plate at the left, the ways in at the right of it, and what is in the side starts 64 px from its edge.
    const plate = (await barePage.locator('[data-plate]').boundingBox())!
    const side = (await barePage.locator('.welcome-side').boundingBox())!
    expect(Math.abs(side.x - (plate.x + plate.width))).toBeLessThan(1)
    const button = (await barePage.getByRole('button', { name: 'Open folder' }).boundingBox())!
    expect(Math.abs(button.x - (side.x + 64))).toBeLessThan(1)
  } finally {
    await bare.close()
  }
})

test('on macOS the menu has Edit, Window and a Quit that is no role', async () => {
  test.skip(process.platform !== 'darwin', 'the application menu is macOS only')
  const items = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? [])
  expect(items).toEqual(expect.arrayContaining(['torno', 'Edit', 'Window']))
  const quit = await app.evaluate(({ Menu }) => {
    const found = Menu.getApplicationMenu()?.getMenuItemById('quit') ?? null
    return found === null ? null : found.role ?? null
  })
  expect(quit).toBeNull()
})

test('there is no menu: a lone Alt has no menu bar to show', async () => {
  test.skip(process.platform === 'darwin', 'the menu bar is global on macOS, and torno has a menu there')
  const menu = await app.evaluate(({ BrowserWindow, Menu }) => ({
    application: Menu.getApplicationMenu() === null,
    visible: BrowserWindow.getAllWindows()[0].isMenuBarVisible()
  }))
  expect(menu).toEqual({ application: true, visible: false })
  // Pressed and let go, it resizes nothing.
  const before = await page.evaluate(() => [window.innerWidth, window.innerHeight])
  await page.keyboard.press('Alt')
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual(before)
})

test('the window is hidden, 1440 × 900, and titled torno', async () => {
  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const [width, height] = w.getSize()
    return { visible: w.isVisible(), width, height }
  })
  expect(win).toEqual({ visible: false, width: 1440, height: 900 })
  expect(await page.title()).toBe('torno')
})

test('the leader layer covers the window, takes no pointer, and is empty until a tool gives it a leader', async () => {
  const layer = page.locator('svg.leader-layer')
  await expect(layer).toHaveCount(1)
  await expect(layer).toHaveCSS('pointer-events', 'none')
  await expect(layer).toHaveCSS('position', 'fixed')
  expect(await layer.locator('.leader').count()).toBe(0)
})

test('the four shell regions exist with their placeholders', async () => {
  await expect(page.locator('.title-row .workspace-name')).toHaveText(root.split('/').pop()!)
  // Said once, by the page of objects, which is where a workspace with none starts.
  await expect(page.locator('main[data-region="viewport"]')).toContainText(`No projects in ${root.split('/').pop()!}. Say what you want made and Claude Code writes the model.`)
  await expect(page.locator('aside[data-region="left"]')).not.toContainText('No projects here yet')
  await expect(page.getByRole('button', { name: /^Folder / })).toBeVisible()
  await expect(page.locator('main[data-region="viewport"]')).toContainText('No project open')
  await expect(page.locator('aside[data-region="session"]')).toBeVisible()
  await expect(page.locator('footer[data-region="status"]')).toBeVisible()
})

test('the shell is one grid: a title row, the left column, the view, the dock and the status line', async () => {
  const page = await cardWindow()
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!
  const win = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  // A title row of 40 across the window: the title bar.
  expect(await box('.title-row')).toEqual({ x: 0, y: 0, width: win.w, height: 40 })
  const left = await box('[data-region="left"]')
  expect(left.x).toBe(0)
  expect(left.y).toBe(40)
  // The card (296): no rail.
  expect(left.width).toBe(296)
  const session = await box('[data-region="session"]')
  expect(session.width).toBe(420)
  expect(session.x + session.width).toBe(win.w)
  expect(session.y).toBe(40)
  const status = await box('[data-region="status"]')
  expect(status.height).toBe(28)
  expect(status.y + status.height).toBe(win.h)
  expect(status.width).toBe(win.w)
  // The view is what is left, beside the card, the dock, the title row and the status line.
  expect(await box('[data-region="viewport"]')).toEqual({ x: 296, y: 40, width: win.w - 296 - 420, height: win.h - 40 - 28 })
  expect(left.height).toBe(win.h - 40 - 28)
  expect(session.height).toBe(win.h - 40 - 28)
})

test('there is no rail: Keys is a button of the status line, and the left is empty with no project open', async () => {
  await expect(page.locator('.rail')).toHaveCount(0)
  await expect(page.locator('[data-region="left"]').getByRole('button')).toHaveCount(0)
  const keys = keysButton(page)
  await expect(keys).toHaveAccessibleName('Keys')
  await expect(keys).toHaveAttribute('aria-keyshortcuts', '?')
  // With no project open there is no print profile to choose.
  await expect(profileChip(page)).toHaveCount(0)
})

test('the renderer is isolated and the bridge is exposed', async () => {
  const probe = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    return { hasRequire: typeof w.require, hasProcess: typeof w.process, groups: Object.keys(window.torno).sort() }
  })
  expect(probe).toEqual({
    hasRequire: 'undefined',
    hasProcess: 'undefined',
    groups: ['asks', 'board', 'chat', 'export', 'geometry', 'git', 'history', 'home', 'marks', 'notes', 'object', 'objects', 'profile', 'ready', 'scans', 'session', 'sets', 'show', 'tracings', 'view', 'window', 'workspace']
  })
})

test('WebGL2 runs on the GPU, not a software rasteriser', async () => {
  // CI has no GPU and draws in software on purpose (TORNO_E2E_SOFTWARE_GL=1); this check is for a desktop.
  test.skip(process.env.TORNO_E2E_SOFTWARE_GL === '1', 'a runner without a GPU draws WebGL in software')
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return null
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  })
  expect(renderer, 'a WebGL2 context').not.toBeNull()
  expect(renderer).not.toContain('SwiftShader')
  expect(renderer).not.toContain('llvmpipe')
})

test('the session dock is resized by dragging its edge, within limits', async () => {
  const page = await cardWindow()
  const dock = page.locator('[data-region="session"]')
  const handle = page.getByRole('separator', { name: 'Resize session' })
  const width = async () => (await dock.boundingBox())!.width
  const dragEdgeBy = async (dx: number) => {
    const edge = (await handle.boundingBox())!
    const x = edge.x + edge.width / 2
    const y = edge.y + edge.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y, { steps: 4 })
    await page.mouse.up()
  }

  expect(await width()).toBe(420)
  await dragEdgeBy(-100)
  expect(await width()).toBe(520)
  // What is dragged is kept by the window.
  expect(await page.evaluate(() => localStorage.getItem('torno.dock'))).toBe('520')

  // It stops at a minimum width rather than vanishing...
  await dragEdgeBy(900)
  expect(await width()).toBe(320)
  // ...and at a maximum that keeps 420 px of viewport free beside the card.
  await dragEdgeBy(-1400)
  expect((await dock.boundingBox())!.x).toBe(296 + 420)

  // The edge also answers to the arrow keys, 16 px a press.
  await handle.focus()
  const widest = await width()
  await page.keyboard.press('ArrowRight')
  expect(await width()).toBe(widest - 16)
  await page.keyboard.press('ArrowLeft')
  expect(await width()).toBe(widest)

  await dragEdgeBy(widest - 420)
  expect(await width()).toBe(420)
  expect(await page.evaluate(() => localStorage.getItem('torno.dock'))).toBe('420')
})

test('the card is made wider by dragging its edge, within limits, and kept by the window', async () => {
  const page = await cardWindow()
  const left = page.locator('[data-region="left"]')
  const handle = page.getByRole('separator', { name: 'Resize panel' })
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('torno.column') ?? '{}'))
  const width = async () => (await left.boundingBox())!.width
  const dragEdgeBy = async (dx: number) => {
    const edge = (await handle.boundingBox())!
    const x = edge.x + edge.width / 2
    const y = edge.y + edge.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y, { steps: 4 })
    await page.mouse.up()
  }
  // The card.
  expect(await width()).toBe(296)

  await dragEdgeBy(100)
  expect(await width()).toBe(396)
  // What is kept is how wide the card is.
  expect(await stored()).toEqual({ width: 396 })

  // Never narrower than the default, and never wider than leaves 420 px of viewport beside the dock.
  await dragEdgeBy(-900)
  expect(await width()).toBe(296)
  await dragEdgeBy(3000)
  const dockWidth = (await page.locator('[data-region="session"]').boundingBox())!.width
  expect(await width()).toBe((await page.evaluate(() => window.innerWidth)) - dockWidth - 420)

  // Keys: 16 px a press; a double click puts the default back.
  await dragEdgeBy(-3000)
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(width).toBe(312)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(width).toBe(296)
  await dragEdgeBy(60)
  await handle.dblclick()
  await expect.poll(width).toBe(296)
  // The default is kept as the narrowest the window keeps (264): a window of 1440 shows 296.
  expect((await stored()).width).toBe(264)
})

test('the session dock collapses and comes back at the same width', async () => {
  const dock = page.locator('[data-region="session"]')
  const before = (await dock.boundingBox())!.width
  await page.getByRole('button', { name: 'Hide session' }).click()
  await expect(dock).toBeHidden()
  await expect(dock).toBeAttached()
  await page.getByRole('button', { name: 'Show session' }).click()
  await expect(dock).toBeVisible()
  expect((await dock.boundingBox())!.width).toBe(before)
})

test("a dock width the person set is the window's: a reload leaves it", async () => {
  const dock = page.locator('[data-region="session"]')
  const handle = page.getByRole('separator', { name: 'Resize session' })
  const edge = (await handle.boundingBox())!
  const x = edge.x + edge.width / 2
  const y = edge.y + edge.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 130, y, { steps: 4 })
  await page.mouse.up()
  expect((await dock.boundingBox())!.width).toBe(550)
  await page.reload()
  await page.waitForSelector('[data-region="session"]')
  expect((await page.locator('[data-region="session"]').boundingBox())!.width).toBe(550)
  expect(await page.evaluate(() => localStorage.getItem('torno.dock'))).toBe('550')
  // Back to the default, which the next tests (and the pictures) expect.
  await page.evaluate(() => localStorage.removeItem('torno.dock'))
  await page.reload()
  await page.waitForSelector('[data-region="session"]')
  expect((await page.locator('[data-region="session"]').boundingBox())!.width).toBe(420)
})

test("a drag of the dock's edge that ends where it began leaves the window's default to follow its width", async () => {
  const dock = page.locator('[data-region="session"]')
  const width = async () => (await dock.boundingBox())!.width
  const edge = (await page.getByRole('separator', { name: 'Resize session' }).boundingBox())!
  const x = edge.x + edge.width / 2
  const y = edge.y + edge.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 100, y, { steps: 4 })
  await expect.poll(width).toBe(520)
  await page.mouse.move(x, y, { steps: 4 })
  await page.mouse.up()
  expect(await width()).toBe(420)
  expect(await page.evaluate(() => localStorage.getItem('torno.dock'))).toBeNull()

  // Under 1360 px of window the default is 384.
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
  const resize = async ([w, h]: number[]) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h])
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(w)
  }
  try {
    await resize([1280, size[1]])
    await expect.poll(width).toBe(384)
  } finally {
    await resize(size)
  }
  await expect.poll(width).toBe(420)
})

// Set TORNO_SHOTS=<dir> to write shell-light.png and shell-dark.png there.
// Each picture needs its own launch: on a hidden window capturePage() delivers
// one image and hangs on the next call, and page.screenshot() never returns.
for (const scheme of ['light', 'dark'] as const) {
  test(`screenshot, ${scheme}`, async () => {
    const dir = process.env.TORNO_SHOTS
    test.skip(!dir, 'TORNO_SHOTS is not set')
    mkdirSync(dir!, { recursive: true })
    const shotApp = await launch(root)
    try {
      const shotPage = await shotApp.firstWindow()
      await shotPage.emulateMedia({ colorScheme: scheme })
      await shotPage.waitForSelector('[data-region="viewport"]')
      await shotPage.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      const png = await shotApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
        return image.toPNG().toString('base64')
      })
      writeFileSync(join(dir!, `shell-${scheme}.png`), Buffer.from(png, 'base64'))
    } finally {
      await shotApp.close()
    }
  })
}
